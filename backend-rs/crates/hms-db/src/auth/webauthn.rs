//! Session-bound WebAuthn ceremonies. No browser or network I/O occurs in these
//! transactions. Enrollment and assertion testing do not grant MFA assurance.

use chrono::{DateTime, Utc};
use hms_domain::deployment::DeploymentProfile;
use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use super::{WebAuthnCeremonyType, WebAuthnCredentialRow};
use crate::{codec, PgPool};

#[derive(Clone)]
pub struct WebAuthnActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub session_version: i64,
    pub permission_version: i64,
    pub active_profile: DeploymentProfile,
    pub valid_until: DateTime<Utc>,
    pub request_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WebAuthnError {
    InvalidChallenge,
    AuthorizationExpired,
    InvalidCredential,
}
impl std::fmt::Display for WebAuthnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidChallenge => "Passkey challenge is invalid.",
            Self::AuthorizationExpired => "Current sign-in authority is required.",
            Self::InvalidCredential => "Passkey verification failed.",
        })
    }
}
impl std::error::Error for WebAuthnError {}

#[derive(FromRow)]
struct Challenge {
    state: Value,
    expires_at: DateTime<Utc>,
}

/// Deliberately has no Debug implementation: state and credential material must
/// never be printed. Dropping a ceremony rolls back every credential/audit write.
pub struct WebAuthnCeremony {
    tx: Transaction<'static, Postgres>,
    actor: WebAuthnActor,
    id: Uuid,
    kind: WebAuthnCeremonyType,
    challenge: Challenge,
    credentials: Vec<WebAuthnCredentialRow>,
    privileged_deadline: Option<super::assurance::PrivilegedDeadline>,
}

async fn deadline(tx: &mut Transaction<'_, Postgres>, actor: &WebAuthnActor) -> anyhow::Result<()> {
    let valid: bool = sqlx::query_scalar("SELECT clock_timestamp() < $1")
        .bind(actor.valid_until)
        .fetch_one(&mut **tx)
        .await?;
    if !valid {
        return Err(WebAuthnError::AuthorizationExpired.into());
    }
    Ok(())
}

/// Canonical facility -> actor -> exact refresh session order. Password reset
/// locks the actor before sessions; session revocation never takes a later actor
/// lock. These SHARE locks serialize account/profile/session changes through
/// the final clock check and transaction commit.
async fn verify(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut WebAuthnActor,
) -> anyhow::Result<()> {
    let profile: Option<String> = sqlx::query_scalar(
        "SELECT deployment_profile FROM facilities WHERE id=$1 AND is_active FOR SHARE",
    )
    .bind(actor.facility_id)
    .fetch_optional(&mut **tx)
    .await?;
    let versions: Option<(i64, i64)> = sqlx::query_as(
        "SELECT session_version,permission_version FROM users WHERE facility_id=$1 AND id=$2 AND is_active FOR NO KEY UPDATE",
    )
    .bind(actor.facility_id)
    .bind(actor.user_id)
    .fetch_optional(&mut **tx)
    .await?;
    if profile != Some(codec::encode(actor.active_profile)?)
        || versions != Some((actor.session_version, actor.permission_version))
    {
        return Err(WebAuthnError::AuthorizationExpired.into());
    }
    let session: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at) FROM refresh_sessions WHERE facility_id=$1 AND user_id=$2 AND session_id=$3 AND session_version=$4 AND permission_version_at_issue=$5 AND revoked_at IS NULL FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(actor.user_id)
    .bind(actor.session_id)
    .bind(actor.session_version)
    .bind(actor.permission_version)
    .fetch_optional(&mut **tx)
    .await?;
    actor.valid_until = actor
        .valid_until
        .min(session.ok_or(WebAuthnError::AuthorizationExpired)?);
    deadline(tx, actor).await
}

pub async fn webauthn_credentials_authorized(
    pool: &PgPool,
    mut actor: WebAuthnActor,
) -> anyhow::Result<Vec<WebAuthnCredentialRow>> {
    let mut tx = pool.begin().await?;
    verify(&mut tx, &mut actor).await?;
    let credentials = credentials(&mut tx, &actor).await?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(credentials)
}

async fn credentials(
    tx: &mut Transaction<'_, Postgres>,
    actor: &WebAuthnActor,
) -> anyhow::Result<Vec<WebAuthnCredentialRow>> {
    super::assurance::bounded_credentials(tx, actor.facility_id, actor.user_id).await
}

pub async fn insert_webauthn_challenge_bound(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    id: Uuid,
    kind: WebAuthnCeremonyType,
    state: Value,
    expires_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    verify(&mut tx, &mut actor).await?;
    super::assurance::reserve_legacy_ceremony(&mut tx, actor.facility_id, actor.user_id, kind)
        .await?;
    sqlx::query(
        "INSERT INTO auth_webauthn_challenges(id,user_id,facility_id,ceremony_type,state,expires_at,initiating_session_id,session_version,permission_version,active_profile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(id)
    .bind(actor.user_id)
    .bind(actor.facility_id)
    .bind(kind.as_str())
    .bind(state)
    .bind(expires_at)
    .bind(actor.session_id)
    .bind(actor.session_version)
    .bind(actor.permission_version)
    .bind(codec::encode(actor.active_profile)?)
    .execute(&mut *tx)
    .await?;
    deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn begin_webauthn_ceremony(
    pool: &PgPool,
    mut actor: WebAuthnActor,
    id: Uuid,
    kind: WebAuthnCeremonyType,
) -> anyhow::Result<WebAuthnCeremony> {
    let mut tx = pool.begin().await?;
    verify(&mut tx, &mut actor).await?;
    // Deliberately do not qualify expiry before the row lock. Wall-clock expiry
    // is checked only after every potentially blocking lock has been acquired.
    let challenge: Challenge = sqlx::query_as(
        "SELECT state,expires_at FROM auth_webauthn_challenges WHERE id=$1 AND facility_id=$2 AND user_id=$3 AND initiating_session_id=$4 AND session_version=$5 AND permission_version=$6 AND active_profile=$7 AND ceremony_type=$8 AND consumed_at IS NULL FOR UPDATE",
    )
    .bind(id)
    .bind(actor.facility_id)
    .bind(actor.user_id)
    .bind(actor.session_id)
    .bind(actor.session_version)
    .bind(actor.permission_version)
    .bind(codec::encode(actor.active_profile)?)
    .bind(kind.as_str())
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(WebAuthnError::InvalidChallenge)?;
    let privileged_deadline = if matches!(kind, WebAuthnCeremonyType::Registration) {
        let end = super::assurance::require_privileged_tx(&mut tx, &mut actor).await?;
        if super::assurance::bounded_credentials(&mut tx, actor.facility_id, actor.user_id)
            .await?
            .len()
            >= hms_domain::auth_assurance::MAX_ACTIVE_PASSKEYS as usize
        {
            return Err(super::assurance::FactorError::CredentialLimit.into());
        }
        Some(end)
    } else {
        None
    };
    let credentials = match kind {
        WebAuthnCeremonyType::Authentication => credentials(&mut tx, &actor).await?,
        WebAuthnCeremonyType::Registration => Vec::new(),
    };
    let mut ceremony = WebAuthnCeremony {
        tx,
        actor,
        id,
        kind,
        challenge,
        credentials,
        privileged_deadline,
    };
    ceremony.check().await?;
    Ok(ceremony)
}

impl WebAuthnCeremony {
    pub fn state(&self) -> Value {
        self.challenge.state.clone()
    }

    pub fn credentials(&self) -> &[WebAuthnCredentialRow] {
        &self.credentials
    }

    async fn check(&mut self) -> anyhow::Result<()> {
        deadline(&mut self.tx, &self.actor).await?;
        if let Some(end) = self.privileged_deadline {
            super::assurance::check_privileged_deadline_tx(&mut self.tx, end).await?;
        }
        let valid: bool = sqlx::query_scalar("SELECT clock_timestamp() < $1")
            .bind(self.challenge.expires_at)
            .fetch_one(&mut *self.tx)
            .await?;
        if !valid {
            return Err(WebAuthnError::InvalidChallenge.into());
        }
        Ok(())
    }

    /// Matching invalid crypto still consumes its own challenge, atomically with
    /// the failure audit. Wrong session/purpose never enters this transaction.
    pub async fn reject(mut self) -> anyhow::Result<()> {
        self.finish(false).await?;
        self.tx.commit().await?;
        Ok(())
    }

    pub async fn complete(mut self, credential_id: String, passkey: Value) -> anyhow::Result<()> {
        self.check().await?;
        match self.kind {
            WebAuthnCeremonyType::Registration => {
                sqlx::query("INSERT INTO auth_webauthn_credentials(id,user_id,facility_id,credential_id,passkey) VALUES($1,$2,$3,$4,$5)")
                    .bind(Uuid::new_v4()).bind(self.actor.user_id).bind(self.actor.facility_id)
                    .bind(credential_id).bind(passkey).execute(&mut *self.tx).await?;
            }
            WebAuthnCeremonyType::Authentication => {
                let result = sqlx::query("UPDATE auth_webauthn_credentials SET passkey=$4,last_used_at=clock_timestamp() WHERE facility_id=$1 AND user_id=$2 AND credential_id=$3 AND disabled_at IS NULL")
                    .bind(self.actor.facility_id).bind(self.actor.user_id).bind(credential_id).bind(passkey)
                    .execute(&mut *self.tx).await?;
                if result.rows_affected() != 1 {
                    return Err(WebAuthnError::InvalidCredential.into());
                }
            }
        }
        self.finish(true).await?;
        self.tx.commit().await?;
        Ok(())
    }

    async fn finish(&mut self, verified: bool) -> anyhow::Result<()> {
        self.check().await?;
        sqlx::query(
            "UPDATE auth_webauthn_challenges SET consumed_at=clock_timestamp() WHERE id=$1",
        )
        .bind(self.id)
        .execute(&mut *self.tx)
        .await?;
        let event = match (self.kind, verified) {
            (WebAuthnCeremonyType::Registration, true) => "auth.webauthn.registration.verified",
            (WebAuthnCeremonyType::Authentication, true) => "auth.webauthn.authentication.verified",
            (_, false) => "auth.webauthn.verification.failed",
        };
        sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'auth_webauthn_challenge',$6,'{}'::jsonb)")
            .bind(Uuid::new_v4()).bind(self.actor.facility_id).bind(self.actor.user_id)
            .bind(&self.actor.request_id).bind(event).bind(self.id).execute(&mut *self.tx).await?;
        self.check().await
    }
}
