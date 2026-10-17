//! Canonical proof ordering for privileged administration with target users.
use super::*;
use crate::auth::assurance::PrivilegedDeadline;
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
