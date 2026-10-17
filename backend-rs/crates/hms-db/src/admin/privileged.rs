//! Canonical proof ordering for privileged administration with target users.
use super::*;
use crate::auth::assurance::PrivilegedDeadline;
use crate::auth::{assurance::BusinessFactorActor, WebAuthnActor};
use sqlx::{Postgres, Transaction};

/// Facility, deterministic actor/target users, exact session/key, then sources.
/// Feature publication takes the exclusive facility lock before any user lock;
/// upgrading a shared facility lock after acquiring the actor would invert it.
pub(crate) async fn begin(
    tx: &mut Transaction<'_, Postgres>,
    proof: Option<&mut WebAuthnActor>,
    facility: Uuid,
    actor_user: Uuid,
    targets: &[Uuid],
    permission: PermissionCode,
    exclusive_facility: bool,
) -> anyhow::Result<Option<PrivilegedDeadline>> {
    let Some(actor) = proof else {
        return Ok(None);
    };
    if actor.facility_id != facility || actor.user_id != actor_user {
        return Err(crate::auth::assurance::FactorError::AuthorizationExpired.into());
    }
    let statement = if exclusive_facility {
        "SELECT id FROM facilities WHERE id=$1 AND is_active FOR UPDATE"
    } else {
        "SELECT id FROM facilities WHERE id=$1 AND is_active FOR SHARE"
    };
    if sqlx::query_scalar::<_, Uuid>(statement)
        .bind(facility)
        .fetch_optional(&mut **tx)
        .await?
        .is_none()
    {
        return Err(crate::auth::assurance::FactorError::AuthorizationExpired.into());
    }
    let mut users = targets.to_vec();
    users.push(actor_user);
    users.sort_unstable();
    users.dedup();
    // Lock inactive targets too: reactivation must not race their other writers.
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id=$1 AND id=ANY($2) ORDER BY id FOR NO KEY UPDATE",
    )
    .bind(facility)
    .bind(&users)
    .fetch_all(&mut **tx)
    .await?;
    let end = crate::auth::assurance::require_family_privileged_tx(
        tx,
        actor,
        facility,
        actor_user,
        permission,
        FeatureKey::Admin,
    )
    .await?;
    Ok(Some(end))
}

pub(crate) async fn finish(
    tx: &mut Transaction<'_, Postgres>,
    end: Option<PrivilegedDeadline>,
) -> anyhow::Result<()> {
    if let Some(end) = end {
        crate::auth::assurance::check_privileged_deadline_tx(tx, end).await?;
    }
    Ok(())
}

/// Business administration retains its resolved network proof after canonical
/// sorted actor/target locking. The policy publisher uses `begin` directly and
/// owns its distinct exclusive policy lock, avoiding a SHARE-to-UPDATE upgrade.
pub(crate) async fn begin_business(
    tx: &mut Transaction<'_, Postgres>,
    proof: Option<&mut BusinessFactorActor>,
    facility: Uuid,
    actor_user: Uuid,
    targets: &[Uuid],
    permission: PermissionCode,
    exclusive_facility: bool,
) -> anyhow::Result<Option<PrivilegedDeadline>> {
    let Some(actor) = proof else {
        return Ok(None);
    };
    let end = begin(
        tx,
        Some(&mut actor.identity),
        facility,
        actor_user,
        targets,
        permission,
        exclusive_facility,
    )
    .await?;
    crate::network::require_publication_tx(tx, facility, actor.resolved_network_policy_version)
        .await?;
    finish(tx, end).await?;
    Ok(end)
}
