//! Password+factor login, exact-session step-up, and existing-factor management.
mod ordinary;
pub use ordinary::confirm_password;

use crate::{
    error::ApiError,
    extractors::NetworkContext,
    state::{AppState, LoginOutcome},
};
use hms_auth::{StoredPasskey, WebAuthnConfig};
use hms_db::auth::{
    assurance::{self as db, FactorError},
    WebAuthnActor,
};
use hms_domain::auth_assurance::*;
use serde_json::{json, Value};
use uuid::Uuid;

pub enum LoginResult {
    Authenticated(LoginOutcome),
    Pending(PendingFactorLogin),
}
pub fn actor(ctx: &NetworkContext) -> WebAuthnActor {
    WebAuthnActor {
        facility_id: ctx.context.facility_id,
        user_id: ctx.context.user_id,
        session_id: ctx.context.session_id,
        session_version: ctx.context.session_version,
        permission_version: ctx.context.permission_version,
        active_profile: ctx.context.active_profile,
        valid_until: ctx.authorization_deadline,
        request_id: ctx.context.request_id.clone(),
    }
}
pub async fn login(
    state: &AppState,
    email: &str,
    password: &str,
    facility: &str,
    device: Option<&str>,
    request: Option<String>,
) -> Result<LoginResult, ApiError> {
    let (user, password_at) = state
        .verify_login_credentials(email, password, facility, device, request.clone())
        .await
        .map_err(|_| ApiError::unauthorized())?
        .ok_or_else(ApiError::unauthorized)?;
    if !user.auth_security.passkey_required && !user.auth_security.passkey_enrolled {
        return Ok(LoginResult::Authenticated(
            state
                .issue_session_for_user(&user, None, None, device, None, None, request, password_at)
                .await
                .map_err(|_| ApiError::unauthorized())?
                .ok_or_else(ApiError::unauthorized)?,
        ));
    }
    let raw = hms_db::provision::generate_secret_token();
    let grant = db::create_login_grant(state.db_pool(), &user, &hash(&raw)?, device, password_at)
        .await
        .map_err(error)?;
    Ok(LoginResult::Pending(pending(
        &raw,
        &grant,
        user.auth_security.recovery_codes_remaining > 0,
    )))
}
fn pending(raw: &str, g: &db::LoginGrant, recovery: bool) -> PendingFactorLogin {
    let setup = g.state == "setup";
    PendingFactorLogin {
        status: if setup {
            "setup_required"
        } else {
            "factor_required"
        }
        .to_owned(),
        login_grant: raw.to_owned(),
        expires_at: g.expires_at,
        methods: FactorMethods {
            passkey: !setup,
            recovery_code: !setup && recovery,
        },
        reason: setup.then(|| "operator_bootstrap_required".to_owned()),
    }
}
fn hash(raw: &str) -> Result<String, ApiError> {
    if raw.len() < 32 || raw.len() > 512 {
        return Err(error(FactorError::InvalidGrant.into()));
    }
    Ok(hms_db::provision::hash_refresh_token(raw))
}
fn stored(rows: &[hms_db::auth::WebAuthnCredentialRow]) -> Vec<StoredPasskey> {
    rows.iter()
        .map(|k| StoredPasskey {
            credential_id: k.credential_id.clone(),
            passkey: k.passkey.clone(),
        })
        .collect()
}
fn options(mut value: Value, id: Uuid) -> Value {
    if let Some(v) = value.as_object_mut() {
        v.insert("challenge_id".to_owned(), json!(id));
    }
    value
}
pub async fn login_options(
    state: &AppState,
    raw: &str,
    bootstrap: Option<&str>,
) -> Result<Value, ApiError> {
    let hashed = hash(raw)?;
    let grant = db::login_grant(state.db_pool(), &hashed)
        .await
        .map_err(error)?;
    let account = hms_db::auth::user_by_id(state.db_pool(), grant.user_id)
        .await
        .map_err(error)?
        .ok_or_else(ApiError::unauthorized)?;
    let bootstrap = bootstrap.map(hash).transpose()?;
    let ceremony = db::login_options(state.db_pool(), &hashed, bootstrap.as_deref())
        .await
        .map_err(error)?;
    let config = config(state)?;
    if bootstrap.is_some() {
        let start = hms_auth::start_passkey_registration(
            &config,
            account.id,
            &account.email,
            &account.display_name,
            &[],
        )
        .map_err(|_| error(FactorError::ManagementRequired.into()))?;
        let result = options(start.public_key, start.challenge_id);
        ceremony
            .save(start.challenge_id, start.state, start.expires_at)
            .await
            .map_err(error)?;
        Ok(result)
    } else {
        let start =
            hms_auth::start_passkey_authentication(&config, &stored(ceremony.credentials()))
                .map_err(|_| error(FactorError::ManagementRequired.into()))?;
        let result = options(start.public_key, start.challenge_id);
        ceremony
            .save(start.challenge_id, start.state, start.expires_at)
            .await
            .map_err(error)?;
        Ok(result)
    }
}
pub async fn verify_login(
    state: &AppState,
    input: LoginFactorVerifyRequest,
    setup: bool,
) -> Result<LoginResult, ApiError> {
    if input.credential.to_string().len() > 65536 {
        return Err(error(FactorError::InvalidInput.into()));
    }
    let _permit = state.auth_crypto_permit().await.map_err(error)?;
    let hashed = hash(&input.login_grant)?;
    let initial = db::login_grant(state.db_pool(), &hashed)
        .await
        .map_err(error)?;
    let user = hms_db::auth::user_by_id(state.db_pool(), initial.user_id)
        .await
        .map_err(error)?
        .ok_or_else(ApiError::unauthorized)?;
    let ceremony = db::begin_login_ceremony(state.db_pool(), &hashed, input.challenge_id, setup)
        .await
        .map_err(error)?;
    let config = config(state)?;
    if setup {
        let result =
            hms_auth::finish_passkey_registration(&config, input.credential, ceremony.state());
        let result = match result {
            Ok(r) => r,
            Err(_) => {
                ceremony.reject().await.map_err(error)?;
                return Err(error(FactorError::InvalidChallenge.into()));
            }
        };
        ceremony
            .complete_setup(result.credential_id, result.passkey)
            .await
            .map_err(error)?;
        let grant = db::login_grant(state.db_pool(), &hashed)
            .await
            .map_err(error)?;
        state.invalidate_auth_cache_for_user(grant.facility_id, grant.user_id);
        Ok(LoginResult::Pending(pending(
            &input.login_grant,
            &grant,
            false,
        )))
    } else {
        let result = hms_auth::finish_passkey_authentication(
            &config,
            input.credential,
            ceremony.state(),
            &stored(ceremony.credentials()),
        );
        let result = match result {
            Ok(r) => r,
            Err(_) => {
                ceremony.reject().await.map_err(error)?;
                return Err(error(FactorError::InvalidChallenge.into()));
            }
        };
        let g = ceremony.grant().ok_or_else(ApiError::unauthorized)?;
        let material = state
            .prepare_session(&user, None, None, g.device_label.as_deref(), None, None)
            .map_err(error)?
            .ok_or_else(ApiError::unauthorized)?;
        ceremony
            .complete(
                &result.credential_id,
                result.passkey,
                Some(&material.session),
                Some(&crate::middleware::request_id::current_request_id()),
            )
            .await
            .map_err(error)?;
        let outcome = state
            .finish_session(&user, material)
            .await
            .map_err(error)?
            .ok_or_else(ApiError::unauthorized)?;
        Ok(LoginResult::Authenticated(outcome))
    }
}
pub async fn recovery(
    state: &AppState,
    input: LoginRecoveryRequest,
) -> Result<LoginResult, ApiError> {
    if input.code.len() > 128 {
        return Err(error(FactorError::InvalidInput.into()));
    }
    let hashed = hash(&input.login_grant)?;
    let g = db::login_grant(state.db_pool(), &hashed)
        .await
        .map_err(error)?;
    let user = hms_db::auth::user_by_id(state.db_pool(), g.user_id)
        .await
        .map_err(error)?
        .ok_or_else(ApiError::unauthorized)?;
    let material = state
        .prepare_session(&user, None, None, g.device_label.as_deref(), None, None)
        .map_err(error)?
        .ok_or_else(ApiError::unauthorized)?;
    db::complete_recovery(
        state.db_pool(),
        &hashed,
        &hms_auth::hash_recovery_code(&input.code),
        &material.session,
        Some(&crate::middleware::request_id::current_request_id()),
    )
    .await
    .map_err(error)?;
    Ok(LoginResult::Authenticated(
        state
            .finish_session(&user, material)
            .await
            .map_err(error)?
            .ok_or_else(ApiError::unauthorized)?,
    ))
}
pub async fn step_up_options(
    state: &AppState,
    ctx: &NetworkContext,
    input: StepUpOptionsRequest,
) -> Result<Value, ApiError> {
    let confirmed = if let Some(password) = input.current_password {
        let account = hms_db::auth::user_by_id(state.db_pool(), ctx.context.user_id)
            .await
            .map_err(error)?
            .ok_or_else(ApiError::unauthorized)?;
        let result = state
            .verify_login_password_bounded(&account, &password)
            .await
            .map_err(error)?;
        let Some((true, _permit, password_at)) = result else {
            return Err(ApiError::forbidden(
                "password_confirmation_failed",
                "Current password could not be verified.",
            ));
        };
        Some((account.password_hash, password_at))
    } else {
        None
    };
    let _permit = state.auth_crypto_permit().await.map_err(error)?;
    let ceremony = db::step_up_options(
        state.db_pool(),
        actor(ctx),
        confirmed.as_ref().map(|(hash, at)| (hash.as_str(), *at)),
    )
    .await
    .map_err(error)?;
    let start =
        hms_auth::start_passkey_authentication(&config(state)?, &stored(ceremony.credentials()))
            .map_err(|_| error(FactorError::ManagementRequired.into()))?;
    let result = options(start.public_key, start.challenge_id);
    ceremony
        .save(start.challenge_id, start.state, start.expires_at)
        .await
        .map_err(error)?;
    Ok(result)
}
pub async fn step_up_verify(
    state: &AppState,
    ctx: &NetworkContext,
    input: StepUpVerifyRequest,
) -> Result<LoginOutcome, ApiError> {
    if input.credential.to_string().len() > 65536 {
        return Err(error(FactorError::InvalidInput.into()));
    }
    let _permit = state.auth_crypto_permit().await.map_err(error)?;
    let ceremony = db::begin_step_up(state.db_pool(), actor(ctx), input.challenge_id)
        .await
        .map_err(error)?;
    let result = hms_auth::finish_passkey_authentication(
        &config(state)?,
        input.credential,
        ceremony.state(),
        &stored(ceremony.credentials()),
    );
    let result = match result {
        Ok(r) => r,
        Err(_) => {
            ceremony.reject().await.map_err(error)?;
            return Err(error(FactorError::InvalidChallenge.into()));
        }
    };
    ceremony
        .complete(
            &result.credential_id,
            result.passkey,
            None,
            Some(&ctx.context.request_id),
        )
        .await
        .map_err(error)?;
    state.invalidate_auth_cache_for_session(
        ctx.context.facility_id,
        ctx.context.user_id,
        ctx.context.session_id,
    );
    state
        .existing_session_outcome(ctx.context.user_id, ctx.context.session_id)
        .await
        .map_err(error)?
        .ok_or_else(ApiError::unauthorized)
}
pub async fn replace_recovery(
    state: &AppState,
    ctx: &NetworkContext,
    password: &str,
) -> Result<Vec<String>, ApiError> {
    let account = hms_db::auth::user_by_id(state.db_pool(), ctx.context.user_id)
        .await
        .map_err(error)?
        .ok_or_else(ApiError::unauthorized)?;
    if !state
        .verify_login_password_bounded(&account, password)
        .await
        .map_err(error)?
        .is_some_and(|(valid, _, _)| valid)
    {
        return Err(ApiError::forbidden(
            "password_confirmation_failed",
            "Current password could not be verified.",
        ));
    }
    let codes = hms_auth::generate_recovery_codes(10);
    let hashes = codes
        .iter()
        .map(|c| hms_auth::hash_recovery_code(c))
        .collect::<Vec<_>>();
    db::replace_codes_authorized(state.db_pool(), actor(ctx), &account.password_hash, &hashes)
        .await
        .map_err(error)?;
    state.invalidate_auth_cache_for_user(ctx.context.facility_id, ctx.context.user_id);
    Ok(codes)
}
pub fn config(state: &AppState) -> Result<WebAuthnConfig, ApiError> {
    Ok(state.webauthn_config())
}
pub fn is_authority_error(error: &anyhow::Error) -> bool {
    error.is::<FactorError>() || error.is::<hms_db::network::NetworkPublicationError>()
}

pub fn error(e: anyhow::Error) -> ApiError {
    if let Some(error) = ApiError::network_publication(&e) {
        return error;
    }
    match e.downcast_ref::<FactorError>(){
      Some(FactorError::ManagementRequired)=>ApiError::conflict("factor_management_required","A stored passkey needs operator review. No key was omitted or password fallback enabled."),
      Some(FactorError::CredentialLimit)=>ApiError::conflict("passkey_limit_reached","Review the existing passkeys before adding another."),
      Some(FactorError::IssueLimit)=>ApiError::too_many_requests("factor_attempt_limit","Authentication attempts are temporarily limited. Keep the current request or retry later."),
      Some(FactorError::PasswordConfirmationRequired)=>ApiError::forbidden("password_confirmation_required","Confirm your current password and passkey to continue."),
      Some(FactorError::FactorRequired)=>ApiError::forbidden("passkey_verification_required","A fresh verification with an existing passkey is required."),
      Some(FactorError::LastCredential)=>ApiError::conflict("last_passkey_required","Add another passkey before disabling the last active passkey."),
      Some(FactorError::NotFound)=>ApiError::not_found("passkey_not_found","The passkey was not found in this account."),
      Some(FactorError::InvalidInput)=>ApiError::bad_request("invalid_factor_request","Review the supported authentication fields."),
      Some(FactorError::AuthorizationExpired)=>ApiError::forbidden("factor_authorization_expired","Current sign-in authority is required. Start verification again."),
      Some(FactorError::InvalidGrant|FactorError::InvalidChallenge)=>ApiError::bad_request("factor_verification_failed","Authentication could not be verified. Start a new verification when required."),
      None=>ApiError::conflict("factor_write_unconfirmed","The authentication change could not be confirmed. Refresh its status before repeating it."),
    }
}

pub async fn setup_start(
    state: &AppState,
    email: &str,
    password: &str,
    facility: &str,
    device: Option<&str>,
    request: Option<String>,
) -> Result<LoginResult, ApiError> {
    let (user, password_at) = state
        .verify_login_credentials(email, password, facility, device, request)
        .await
        .map_err(|_| ApiError::unauthorized())?
        .ok_or_else(ApiError::unauthorized)?;
    if user.auth_security.passkey_enrolled {
        return Err(ApiError::conflict(
            "existing_factor_required",
            "Use the existing passkey and verified management flow for this account.",
        ));
    }
    let raw = hms_db::provision::generate_secret_token();
    let grant = db::create_login_grant(state.db_pool(), &user, &hash(&raw)?, device, password_at)
        .await
        .map_err(error)?;
    Ok(LoginResult::Pending(pending(&raw, &grant, false)))
}

/// RequestContext preserves the exact token/session/authority deadline even for
/// older thin handlers. Missing proof is denied rather than guessed from now.
pub fn privileged_actor(
    ctx: &hms_access::RequestContext,
) -> Result<db::BusinessFactorActor, ApiError> {
    let version = ctx
        .resolved_network_policy_version
        .filter(|value| *value >= 0)
        .ok_or_else(|| error(hms_db::network::NetworkPublicationError::MissingProof.into()))?;
    Ok(db::BusinessFactorActor {
        identity: WebAuthnActor {
            facility_id: ctx.facility_id,
            user_id: ctx.user_id,
            session_id: ctx.session_id,
            session_version: ctx.session_version,
            permission_version: ctx.permission_version,
            active_profile: ctx.active_profile,
            valid_until: ctx
                .authorization_deadline
                .ok_or_else(|| error(FactorError::AuthorizationExpired.into()))?,
            request_id: ctx.request_id.clone(),
        },
        resolved_network_policy_version: version,
    })
}
