//! Password proof, verified factor evidence and restricted pre-login workflow.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub const FACTOR_FRESH_MINUTES: i64 = 15;
pub const MAX_ACTIVE_PASSKEYS: i64 = 10;
pub const MAX_PENDING_FACTOR_CHALLENGES: i64 = 3;

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct SessionAssurance {
    pub method: Option<FactorMethod>,
    pub verified_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub credential_id: Option<Uuid>,
}
impl SessionAssurance {
    pub fn is_fresh_passkey_at(&self, now: DateTime<Utc>) -> bool {
        self.method == Some(FactorMethod::Passkey)
            && self
                .verified_at
                .zip(self.expires_at)
                .is_some_and(|(at, end)| {
                    at <= now
                        && now < end
                        && end <= at + chrono::Duration::minutes(FACTOR_FRESH_MINUTES)
                })
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FactorMethod {
    Passkey,
    Recovery,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FactorMethods {
    pub passkey: bool,
    pub recovery_code: bool,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
pub struct PendingFactorLogin {
    pub status: String,
    pub login_grant: String,
    pub expires_at: DateTime<Utc>,
    pub methods: FactorMethods,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AuthTokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in_seconds: u64,
    pub refresh_expires_at: DateTime<Utc>,
    pub session_idle_expires_at: DateTime<Utc>,
    pub session_absolute_expires_at: DateTime<Utc>,
    pub user: crate::auth::AuthUser,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AuthLoginResponse {
    Authenticated {
        #[serde(flatten)]
        token: AuthTokenResponse,
    },
    FactorRequired {
        login_grant: String,
        expires_at: DateTime<Utc>,
        methods: FactorMethods,
        reason: Option<String>,
    },
    SetupRequired {
        login_grant: String,
        expires_at: DateTime<Utc>,
        methods: FactorMethods,
        reason: Option<String>,
    },
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LoginFactorOptionsRequest {
    pub login_grant: String,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LoginFactorVerifyRequest {
    pub login_grant: String,
    pub challenge_id: Uuid,
    pub credential: serde_json::Value,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LoginRecoveryRequest {
    pub login_grant: String,
    pub code: String,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LoginSetupOptionsRequest {
    pub login_grant: String,
    pub bootstrap_token: String,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StepUpOptionsRequest {
    pub current_password: Option<String>,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StepUpVerifyRequest {
    pub challenge_id: Uuid,
    pub credential: serde_json::Value,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FactorAssuranceStatus {
    pub assurance: SessionAssurance,
    pub password_verified_at: DateTime<Utc>,
    pub password_fresh_until: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PasskeyMetadata {
    pub id: Uuid,
    pub label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub disabled_at: Option<DateTime<Utc>>,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RenamePasskeyRequest {
    pub label: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EmptyFactorDecision {}
