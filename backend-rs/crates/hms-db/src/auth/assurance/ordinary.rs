//! Password proof renews one ordinary session; it never creates factor evidence.
use super::{bounded_credentials, deadline, now, session, FactorError, WebAuthnActor};
use crate::{auth::UserAccount, codec, PgPool};
use chrono::{DateTime, Duration, Utc};
use hms_domain::auth::PRIVILEGED_PERMISSIONS;

pub async fn confirm_ordinary_password(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    verified: &UserAccount,
    admitted_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    if verified.id != actor.user_id
        || verified.facility_id != actor.facility_id
        || verified.session_version != actor.session_version
        || verified.permission_version != actor.permission_version
        || verified.active_profile != actor.active_profile
    {
        return Err(FactorError::AuthorizationExpired.into());
    }
    let mut tx = pool.begin().await?;
    let (factor_version, prior_password) = session(&mut tx, &mut actor).await?;
    let privileged = PRIVILEGED_PERMISSIONS
        .iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    // session() already retains this exact current user and session. The
    // effective permission view matches login policy; the original request
    // deadline fences every intervening managed-authority time boundary.
    let (hash, forced, privileged): (String, bool, bool) = sqlx::query_as(
        "SELECT password_hash,password_change_required,EXISTS(SELECT 1 FROM effective_user_permissions WHERE user_id=$2 AND permission_code=ANY($3)) FROM users WHERE facility_id=$1 AND id=$2 AND is_active",
    )
    .bind(actor.facility_id)
    .bind(actor.user_id)
    .bind(privileged)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(FactorError::AuthorizationExpired)?;
    if hash != verified.password_hash
        || forced
        || factor_version != verified.auth_security.factor_version
    {
        return Err(FactorError::AuthorizationExpired.into());
    }
    if privileged
        || !bounded_credentials(&mut tx, actor.facility_id, actor.user_id)
            .await?
            .is_empty()
    {
        return Err(FactorError::FactorRequired.into());
    }
    let at = now(&mut tx).await?;
    if admitted_at > at || prior_password > at {
        return Err(FactorError::AuthorizationExpired.into());
    }
    let end = actor.valid_until.min(admitted_at + Duration::minutes(15));
    deadline(&mut tx, end).await?;
    let changed = sqlx::query(
        "UPDATE refresh_sessions SET password_verified_at=GREATEST(password_verified_at,$4),assurance_version=assurance_version+1 WHERE facility_id=$1 AND user_id=$2 AND session_id=$3 AND revoked_at IS NULL",
    )
    .bind(actor.facility_id)
    .bind(actor.user_id)
    .bind(actor.session_id)
    .bind(admitted_at)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(FactorError::AuthorizationExpired.into());
    }
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES(gen_random_uuid(),$1,$2,$3,'auth.credential.reconfirmed','auth_session',$4,'{}'::jsonb)")
        .bind(actor.facility_id)
        .bind(actor.user_id)
        .bind(&actor.request_id)
        .bind(actor.session_id)
        .execute(&mut *tx)
        .await?;
    // This fresh clock follows all locks and publication/audit triggers.
    deadline(&mut tx, end).await?;
    tx.commit().await?;
    Ok(())
}
