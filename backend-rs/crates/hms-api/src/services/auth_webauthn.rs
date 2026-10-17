//! Existing enrollment/assertion ceremonies with live, exact-session authority.
//! These endpoints do not establish login MFA or privileged session assurance.

use chrono::Duration;
use hms_auth::{StoredPasskey, WebAuthnConfig};
use hms_db::auth::{WebAuthnActor, WebAuthnCeremonyType, WebAuthnError};
use serde_json::Value;
use uuid::Uuid;

use crate::{error::ApiError, extractors::NetworkContext, state::AppState};

fn actor(ctx: &NetworkContext) -> WebAuthnActor {
    WebAuthnActor {
        facility_id: ctx.context.facility_id,
        user_id: ctx.context.user_id,
        session_id: ctx.context.session_id,
        session_version: ctx.context.user.session_version,
        permission_version: ctx.context.user.permission_version,
        active_profile: ctx.context.active_profile,
        valid_until: ctx.authorization_deadline,
        request_id: ctx.context.request_id.clone(),
    }
}

pub async fn options(
    state: &AppState,
    ctx: &NetworkContext,
    kind: WebAuthnCeremonyType,
) -> Result<Value, ApiError> {
    let config = config()?;
    let credentials = hms_db::auth::webauthn_credentials_authorized(state.db_pool(), actor(ctx))
        .await
        .map_err(error)?;
    let (id, public, server_state, expires_at) = match kind {
        WebAuthnCeremonyType::Registration => {
            let ids = credentials
                .iter()
                .map(|credential| credential.credential_id.clone())
                .collect::<Vec<_>>();
            let start = hms_auth::start_passkey_registration(
                &config,
                ctx.context.user_id,
                &ctx.context.user.email,
                &ctx.context.user.display_name,
                &ids,
            )
            .map_err(|_| start_failed())?;
            (
                start.challenge_id,
                start.public_key,
                start.state,
                start.expires_at,
            )
        }
        WebAuthnCeremonyType::Authentication => {
            let passkeys = stored(&credentials);
            let start = hms_auth::start_passkey_authentication(&config, &passkeys)
                .map_err(|_| start_failed())?;
            (
                start.challenge_id,
                start.public_key,
                start.state,
                start.expires_at,
            )
        }
    };
    hms_db::auth::insert_webauthn_challenge_bound(
        state.db_pool(),
        actor(ctx),
        id,
        kind,
        server_state,
        expires_at,
    )
    .await
    .map_err(error)?;
    let mut result = public;
    if let Some(object) = result.as_object_mut() {
        object.insert("challenge_id".to_owned(), Value::String(id.to_string()));
        object.insert("mfa_session".to_owned(), Value::String(id.to_string()));
    }
    Ok(result)
}

pub async fn verify(
    state: &AppState,
    ctx: &NetworkContext,
    kind: WebAuthnCeremonyType,
    challenge: Option<&str>,
    credential: Value,
) -> Result<(), ApiError> {
    let id = challenge
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            ApiError::bad_request(
                "webauthn_challenge_required",
                "Passkey challenge is required.",
            )
        })?;
    let config = config()?;
    let ceremony = hms_db::auth::begin_webauthn_ceremony(state.db_pool(), actor(ctx), id, kind)
        .await
        .map_err(error)?;
    let result = match kind {
        WebAuthnCeremonyType::Registration => {
            hms_auth::finish_passkey_registration(&config, credential, ceremony.state())
                .map(|result| (result.credential_id, result.passkey))
        }
        WebAuthnCeremonyType::Authentication => hms_auth::finish_passkey_authentication(
            &config,
            credential,
            ceremony.state(),
            &stored(ceremony.credentials()),
        )
        .map(|result| (result.credential_id, result.passkey)),
    };
    let (credential_id, passkey) = match result {
        Ok(value) => value,
        Err(_) => {
            ceremony.reject().await.map_err(error)?;
            return Err(verification_failed());
        }
    };
    ceremony
        .complete(credential_id, passkey)
        .await
        .map_err(error)?;
    if matches!(kind, WebAuthnCeremonyType::Registration) {
        state.invalidate_auth_cache_for_user(ctx.context.facility_id, ctx.context.user_id);
    }
    Ok(())
}

fn stored(credentials: &[hms_db::auth::WebAuthnCredentialRow]) -> Vec<StoredPasskey> {
    credentials
        .iter()
        .map(|credential| StoredPasskey {
            credential_id: credential.credential_id.clone(),
            passkey: credential.passkey.clone(),
        })
        .collect()
}

fn config() -> Result<WebAuthnConfig, ApiError> {
    Ok(WebAuthnConfig {
        rp_id: std::env::var("HMS_WEBAUTHN_RP_ID").unwrap_or_else(|_| "localhost".to_owned()),
        rp_origin: std::env::var("HMS_WEBAUTHN_RP_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:8080".to_owned()),
        rp_name: std::env::var("HMS_WEBAUTHN_RP_NAME").unwrap_or_else(|_| "HMS".to_owned()),
        challenge_ttl: Duration::minutes(5),
    })
}

fn start_failed() -> ApiError {
    ApiError::bad_request("webauthn_start_failed", "Passkey ceremony could not start.")
}
fn verification_failed() -> ApiError {
    ApiError::bad_request("webauthn_verify_failed", "Passkey verification failed.")
}
fn error(error: anyhow::Error) -> ApiError {
    match error.downcast_ref::<WebAuthnError>() {
        Some(WebAuthnError::AuthorizationExpired) => ApiError::forbidden(
            "webauthn_authority_expired",
            "Current sign-in authority is required. Start a new passkey ceremony.",
        ),
        Some(WebAuthnError::InvalidChallenge) => ApiError::bad_request(
            "webauthn_challenge_invalid",
            "Passkey challenge is invalid.",
        ),
        _ => verification_failed(),
    }
}
