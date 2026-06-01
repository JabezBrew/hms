use axum::extract::Path;
use axum::extract::State;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue};
use axum::Json;
use chrono::{DateTime, Utc};
use cookie::{Cookie, SameSite};
use hms_auth::{AuthenticatedPasskey, RegisteredPasskey, StoredPasskey, WebAuthnConfig};
use hms_db::auth::{NewWebAuthnChallenge, NewWebAuthnCredential, WebAuthnCeremonyType};
use hms_domain::auth::{AuthUser, UpdateAuthProfileRequest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::{AuthenticatedSession, AuthenticatedUser, RequestContext};
use crate::response::{object, ObjectResponse};
use crate::state::{AppState, ChangePasswordOutcome, LoginOutcome};

const REFRESH_COOKIE_NAME: &str = "hms_refresh";
const CSRF_COOKIE_NAME: &str = "hms_v2_csrf";
const CSRF_HEADER_NAME: &str = "x-hms-csrf";
const DEVICE_LABEL_HEADER_NAME: &str = "x-device-label";
const MAX_DISPLAY_NAME_LEN: usize = 160;
const MAX_DEVICE_LABEL_LEN: usize = 120;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    pub facility_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AuthTokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in_seconds: u64,
    pub refresh_expires_at: DateTime<Utc>,
    pub session_idle_expires_at: DateTime<Utc>,
    pub session_absolute_expires_at: DateTime<Utc>,
    pub user: AuthUser,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LogoutResponse {
    pub logged_out: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PasswordResetRequest {
    pub email: String,
    pub facility_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PasswordResetRequestResponse {
    pub accepted: bool,
    pub debug_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PasswordResetCompleteRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PasswordResetCompleteResponse {
    pub completed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ChangePasswordResponse {
    pub changed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AuthSessionListResponse {
    pub results: Vec<AuthSessionItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AuthSessionItem {
    pub id: Uuid,
    pub device_label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub is_current: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RevokeSessionResponse {
    pub revoked: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct RevokeAllSessionsRequest {
    pub exclude_current: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RevokeAllSessionsResponse {
    pub revoked_count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct MfaStatusResponse {
    pub totp_enrolled: bool,
    pub webauthn_enrolled: bool,
    pub recovery_codes_remaining: i64,
    pub passkey_required: bool,
    pub privileged_user: bool,
    pub privileged_actions_allowed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct MfaSessionRequest {
    pub mfa_session: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WebAuthnVerifyRequest {
    pub credential: Value,
    pub mfa_session: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WebAuthnVerifyResponse {
    pub verified: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RecoveryCodeGenerateRequest {
    pub current_password: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RecoveryCodeGenerateResponse {
    pub codes: Vec<String>,
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/login",
    operation_id = "postAuthLogin",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login succeeded", body = ObjectResponse<AuthTokenResponse>),
        (status = 401, description = "Login failed", body = ApiErrorResponse)
    )
)]
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<ObjectResponse<AuthTokenResponse>>), ApiError> {
    let device_label = device_label_from_headers(&headers);
    let outcome = state
        .login(
            &payload.email,
            &payload.password,
            &payload.facility_code,
            device_label.as_deref(),
        )
        .await
        .map_err(|_| ApiError::unauthorized())?
        .ok_or_else(ApiError::unauthorized)?;

    Ok(auth_response(outcome, state.cookie_secure()))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/refresh",
    operation_id = "postAuthRefresh",
    tag = "auth",
    params(("x-hms-csrf" = String, Header, description = "CSRF token copied from the hms_v2_csrf cookie")),
    responses(
        (status = 200, description = "Refresh succeeded", body = ObjectResponse<AuthTokenResponse>),
        (status = 401, description = "Refresh failed", body = ApiErrorResponse)
    )
)]
pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ObjectResponse<AuthTokenResponse>>), ApiError> {
    let refresh_token = read_refresh_cookie(&headers).ok_or_else(ApiError::unauthorized)?;
    let csrf_token = require_csrf(&headers)?;
    let outcome = state
        .refresh(&refresh_token, &csrf_token)
        .await
        .map_err(|_| ApiError::unauthorized())?
        .ok_or_else(ApiError::unauthorized)?;

    Ok(auth_response(outcome, state.cookie_secure()))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/logout",
    operation_id = "postAuthLogout",
    tag = "auth",
    params(("x-hms-csrf" = String, Header, description = "CSRF token copied from the hms_v2_csrf cookie")),
    responses(
        (status = 200, description = "Logout succeeded", body = ObjectResponse<LogoutResponse>)
    )
)]
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ObjectResponse<LogoutResponse>>), ApiError> {
    if let Some(refresh_token) = read_refresh_cookie(&headers) {
        let csrf_token = require_csrf(&headers)?;
        state
            .logout(&refresh_token, &csrf_token)
            .await
            .map_err(|_| ApiError::unauthorized())?;
    }

    let mut headers = HeaderMap::new();
    headers.append(SET_COOKIE, expired_refresh_cookie(state.cookie_secure()));
    headers.append(SET_COOKIE, expired_csrf_cookie(state.cookie_secure()));

    Ok((headers, Json(object(LogoutResponse { logged_out: true }))))
}

#[utoipa::path(
    get,
    path = "/api/v2/auth/me",
    operation_id = "getAuthMe",
    tag = "auth",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Current user", body = ObjectResponse<AuthUser>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse)
    )
)]
pub async fn me(AuthenticatedUser(user): AuthenticatedUser) -> Json<ObjectResponse<AuthUser>> {
    Json(object(user))
}

#[utoipa::path(
    patch,
    path = "/api/v2/auth/me",
    operation_id = "patchAuthMe",
    tag = "auth",
    security(("bearerAuth" = [])),
    request_body = UpdateAuthProfileRequest,
    responses(
        (status = 200, description = "Current user profile updated", body = ObjectResponse<AuthUser>),
        (status = 400, description = "Invalid profile update", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 404, description = "User not found", body = ApiErrorResponse)
    )
)]
pub async fn update_me(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<UpdateAuthProfileRequest>,
) -> Result<Json<ObjectResponse<AuthUser>>, ApiError> {
    validate_profile_update(&payload)?;
    let updated = state
        .update_auth_profile(user.id, user.facility_id, payload)
        .await
        .map_err(|_| ApiError::conflict("profile_update_failed", "Profile could not be updated."))?
        .ok_or_else(|| ApiError::not_found("user_not_found", "User was not found."))?;
    Ok(Json(object(updated)))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/password-reset/request",
    operation_id = "postAuthPasswordResetRequest",
    tag = "auth",
    request_body = PasswordResetRequest,
    responses(
        (status = 200, description = "Password reset request accepted", body = ObjectResponse<PasswordResetRequestResponse>)
    )
)]
pub async fn request_password_reset(
    State(state): State<AppState>,
    Json(payload): Json<PasswordResetRequest>,
) -> Result<Json<ObjectResponse<PasswordResetRequestResponse>>, ApiError> {
    let outcome = state
        .request_password_reset(&payload.email, &payload.facility_code)
        .await
        .map_err(|_| ApiError::bad_request("password_reset_failed", "Password reset failed."))?;

    Ok(Json(object(PasswordResetRequestResponse {
        accepted: outcome.accepted,
        debug_token: outcome.debug_token,
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/password-reset/complete",
    operation_id = "postAuthPasswordResetComplete",
    tag = "auth",
    request_body = PasswordResetCompleteRequest,
    responses(
        (status = 200, description = "Password reset completed", body = ObjectResponse<PasswordResetCompleteResponse>),
        (status = 400, description = "Password reset failed", body = ApiErrorResponse)
    )
)]
pub async fn complete_password_reset(
    State(state): State<AppState>,
    Json(payload): Json<PasswordResetCompleteRequest>,
) -> Result<Json<ObjectResponse<PasswordResetCompleteResponse>>, ApiError> {
    let completed = state
        .complete_password_reset(&payload.token, &payload.new_password)
        .await
        .map_err(|_| ApiError::bad_request("password_reset_failed", "Password reset failed."))?;

    if !completed {
        return Err(ApiError::bad_request(
            "password_reset_invalid",
            "Password reset token or password is invalid.",
        ));
    }

    Ok(Json(object(PasswordResetCompleteResponse { completed })))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/password",
    operation_id = "postAuthPassword",
    tag = "auth",
    security(("bearerAuth" = [])),
    request_body = ChangePasswordRequest,
    responses(
        (status = 200, description = "Password changed", body = ObjectResponse<ChangePasswordResponse>),
        (status = 400, description = "Password change failed", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 404, description = "User not found", body = ApiErrorResponse)
    )
)]
pub async fn change_password(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<Json<ObjectResponse<ChangePasswordResponse>>, ApiError> {
    let outcome = state
        .change_password(
            user.id,
            user.facility_id,
            &payload.current_password,
            &payload.new_password,
        )
        .await
        .map_err(|_| ApiError::bad_request("password_change_failed", "Password change failed."))?;

    match outcome {
        ChangePasswordOutcome::Changed => {
            Ok(Json(object(ChangePasswordResponse { changed: true })))
        }
        ChangePasswordOutcome::UserNotFound => {
            Err(ApiError::not_found("user_not_found", "User was not found."))
        }
        ChangePasswordOutcome::InvalidCurrentPassword => Err(ApiError::bad_request(
            "current_password_invalid",
            "Current password is invalid.",
        )),
        ChangePasswordOutcome::WeakPassword => Err(ApiError::bad_request(
            "password_policy_failed",
            "New password does not meet the password policy.",
        )),
        ChangePasswordOutcome::PasswordReused => Err(ApiError::bad_request(
            "password_reused",
            "New password must not match a recent password.",
        )),
    }
}

#[utoipa::path(
    get,
    path = "/api/v2/auth/sessions",
    operation_id = "getAuthSessions",
    tag = "auth",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Active auth sessions", body = ObjectResponse<AuthSessionListResponse>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse)
    )
)]
pub async fn list_sessions(
    State(state): State<AppState>,
    AuthenticatedSession {
        context,
        session_id,
    }: AuthenticatedSession,
) -> Result<Json<ObjectResponse<AuthSessionListResponse>>, ApiError> {
    let sessions = state
        .list_auth_sessions(context.user_id, context.facility_id, session_id)
        .await
        .map_err(|_| {
            ApiError::bad_request("sessions_load_failed", "Sessions could not be loaded.")
        })?
        .into_iter()
        .map(|session| AuthSessionItem {
            id: session.id,
            device_label: session.device_label,
            created_at: session.created_at,
            last_seen_at: session.last_seen_at,
            expires_at: session.expires_at,
            is_current: session.is_current,
        })
        .collect();

    Ok(Json(object(AuthSessionListResponse { results: sessions })))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/sessions/{session_id}/revoke",
    operation_id = "postAuthSessionRevoke",
    tag = "auth",
    security(("bearerAuth" = [])),
    params(("session_id" = Uuid, Path, description = "Auth session ID")),
    responses(
        (status = 200, description = "Session revoked", body = ObjectResponse<RevokeSessionResponse>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse)
    )
)]
pub async fn revoke_session(
    State(state): State<AppState>,
    AuthenticatedSession { context, .. }: AuthenticatedSession,
    Path(session_id): Path<Uuid>,
) -> Result<Json<ObjectResponse<RevokeSessionResponse>>, ApiError> {
    let revoked = state
        .revoke_auth_session(context.user_id, context.facility_id, session_id)
        .await
        .map_err(|_| {
            ApiError::bad_request("session_revoke_failed", "Session could not be revoked.")
        })?;

    Ok(Json(object(RevokeSessionResponse { revoked })))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/sessions/revoke-all",
    operation_id = "postAuthSessionsRevokeAll",
    tag = "auth",
    security(("bearerAuth" = [])),
    request_body = RevokeAllSessionsRequest,
    responses(
        (status = 200, description = "Sessions revoked", body = ObjectResponse<RevokeAllSessionsResponse>),
        (status = 400, description = "Session revocation failed", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse)
    )
)]
pub async fn revoke_all_sessions(
    State(state): State<AppState>,
    AuthenticatedSession {
        context,
        session_id,
    }: AuthenticatedSession,
    Json(payload): Json<RevokeAllSessionsRequest>,
) -> Result<Json<ObjectResponse<RevokeAllSessionsResponse>>, ApiError> {
    if payload.exclude_current == Some(false) {
        let sessions = state
            .list_auth_sessions(context.user_id, context.facility_id, session_id)
            .await
            .map_err(|_| {
                ApiError::bad_request("sessions_load_failed", "Sessions could not be loaded.")
            })?;
        let mut revoked_count = 0;
        for session in sessions {
            if state
                .revoke_auth_session(context.user_id, context.facility_id, session.id)
                .await
                .map_err(|_| {
                    ApiError::bad_request("session_revoke_failed", "Session could not be revoked.")
                })?
            {
                revoked_count += 1;
            }
        }
        return Ok(Json(object(RevokeAllSessionsResponse { revoked_count })));
    }

    let revoked_count = state
        .revoke_other_auth_sessions(context.user_id, context.facility_id, session_id)
        .await
        .map_err(|_| {
            ApiError::bad_request("session_revoke_failed", "Sessions could not be revoked.")
        })?;

    Ok(Json(object(RevokeAllSessionsResponse { revoked_count })))
}

#[utoipa::path(
    get,
    path = "/api/v2/auth/mfa/status",
    operation_id = "getAuthMfaStatus",
    tag = "auth",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "MFA and privileged-action status", body = ObjectResponse<MfaStatusResponse>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 400, description = "MFA status could not be loaded", body = ApiErrorResponse)
    )
)]
pub async fn mfa_status(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ObjectResponse<MfaStatusResponse>>, ApiError> {
    let remaining =
        hms_db::auth::recovery_codes_remaining(state.db_pool(), user.facility_id, user.id)
            .await
            .map_err(|_| {
                ApiError::bad_request("mfa_status_failed", "MFA status could not be loaded.")
            })?;
    let credentials =
        hms_db::auth::list_webauthn_credentials(state.db_pool(), user.facility_id, user.id)
            .await
            .map_err(|_| {
                ApiError::bad_request("mfa_status_failed", "MFA status could not be loaded.")
            })?;
    let security = hms_domain::auth::AuthSecurityState::from_permissions(
        &user.permissions,
        !credentials.is_empty(),
        remaining,
    );

    Ok(Json(object(MfaStatusResponse {
        totp_enrolled: false,
        webauthn_enrolled: security.passkey_enrolled,
        recovery_codes_remaining: security.recovery_codes_remaining,
        passkey_required: security.passkey_required,
        privileged_user: security.privileged_user,
        privileged_actions_allowed: security.privileged_actions_allowed,
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/mfa/webauthn/register/options",
    operation_id = "postAuthWebauthnRegisterOptions",
    tag = "auth",
    security(("bearerAuth" = [])),
    request_body = MfaSessionRequest,
    responses(
        (status = 200, description = "WebAuthn registration options", body = ObjectResponse<Value>),
        (status = 400, description = "Passkey setup could not start", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse)
    )
)]
pub async fn webauthn_registration_options(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(_payload): Json<MfaSessionRequest>,
) -> Result<Json<ObjectResponse<Value>>, ApiError> {
    let existing =
        hms_db::auth::list_webauthn_credentials(state.db_pool(), user.facility_id, user.id)
            .await
            .map_err(|_| {
                ApiError::bad_request("webauthn_start_failed", "Passkey setup could not start.")
            })?;
    let existing_ids = existing
        .iter()
        .map(|credential| credential.credential_id.clone())
        .collect::<Vec<_>>();
    let start = hms_auth::start_passkey_registration(
        &webauthn_config()?,
        user.id,
        &user.email,
        &user.display_name,
        &existing_ids,
    )
    .map_err(|_| {
        ApiError::bad_request("webauthn_start_failed", "Passkey setup could not start.")
    })?;

    hms_db::auth::insert_webauthn_challenge(
        state.db_pool(),
        &NewWebAuthnChallenge {
            id: start.challenge_id,
            user_id: user.id,
            facility_id: user.facility_id,
            ceremony_type: WebAuthnCeremonyType::Registration,
            state: start.state,
            expires_at: start.expires_at,
        },
    )
    .await
    .map_err(|_| {
        ApiError::bad_request("webauthn_start_failed", "Passkey setup could not start.")
    })?;

    Ok(Json(object(with_mfa_session(
        start.public_key,
        start.challenge_id,
    ))))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/mfa/webauthn/register/verify",
    operation_id = "postAuthWebauthnRegisterVerify",
    tag = "auth",
    security(("bearerAuth" = [])),
    request_body = WebAuthnVerifyRequest,
    responses(
        (status = 200, description = "WebAuthn registration verified", body = ObjectResponse<WebAuthnVerifyResponse>),
        (status = 400, description = "Passkey verification failed", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse)
    )
)]
pub async fn webauthn_registration_verify(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<WebAuthnVerifyRequest>,
) -> Result<Json<ObjectResponse<WebAuthnVerifyResponse>>, ApiError> {
    let challenge_id = parse_mfa_session(payload.mfa_session.as_deref())?;
    let challenge = hms_db::auth::consume_webauthn_challenge(
        state.db_pool(),
        user.facility_id,
        user.id,
        challenge_id,
        WebAuthnCeremonyType::Registration,
    )
    .await
    .map_err(|_| ApiError::bad_request("webauthn_verify_failed", "Passkey verification failed."))?
    .ok_or_else(|| {
        ApiError::bad_request(
            "webauthn_challenge_invalid",
            "Passkey challenge is invalid.",
        )
    })?;
    let RegisteredPasskey {
        credential_id,
        passkey,
    } = hms_auth::finish_passkey_registration(
        &webauthn_config()?,
        payload.credential,
        challenge.state,
    )
    .map_err(|_| ApiError::bad_request("webauthn_verify_failed", "Passkey verification failed."))?;

    hms_db::auth::insert_webauthn_credential(
        state.db_pool(),
        &NewWebAuthnCredential {
            id: Uuid::new_v4(),
            user_id: user.id,
            facility_id: user.facility_id,
            credential_id,
            passkey,
            label: None,
        },
    )
    .await
    .map_err(|_| ApiError::bad_request("webauthn_verify_failed", "Passkey verification failed."))?;
    state.invalidate_auth_cache_for_user(user.facility_id, user.id);

    Ok(Json(object(WebAuthnVerifyResponse { verified: true })))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/mfa/webauthn/authenticate/options",
    operation_id = "postAuthWebauthnAuthenticateOptions",
    tag = "auth",
    security(("bearerAuth" = [])),
    request_body = MfaSessionRequest,
    responses(
        (status = 200, description = "WebAuthn authentication options", body = ObjectResponse<Value>),
        (status = 400, description = "Passkey verification could not start", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse)
    )
)]
pub async fn webauthn_authentication_options(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(_payload): Json<MfaSessionRequest>,
) -> Result<Json<ObjectResponse<Value>>, ApiError> {
    let stored = stored_passkeys(state.db_pool(), user.facility_id, user.id).await?;
    let start =
        hms_auth::start_passkey_authentication(&webauthn_config()?, &stored).map_err(|_| {
            ApiError::bad_request(
                "webauthn_start_failed",
                "Passkey verification could not start.",
            )
        })?;
    hms_db::auth::insert_webauthn_challenge(
        state.db_pool(),
        &NewWebAuthnChallenge {
            id: start.challenge_id,
            user_id: user.id,
            facility_id: user.facility_id,
            ceremony_type: WebAuthnCeremonyType::Authentication,
            state: start.state,
            expires_at: start.expires_at,
        },
    )
    .await
    .map_err(|_| {
        ApiError::bad_request(
            "webauthn_start_failed",
            "Passkey verification could not start.",
        )
    })?;

    Ok(Json(object(with_mfa_session(
        start.public_key,
        start.challenge_id,
    ))))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/mfa/webauthn/authenticate/verify",
    operation_id = "postAuthWebauthnAuthenticateVerify",
    tag = "auth",
    security(("bearerAuth" = [])),
    request_body = WebAuthnVerifyRequest,
    responses(
        (status = 200, description = "WebAuthn authentication verified", body = ObjectResponse<WebAuthnVerifyResponse>),
        (status = 400, description = "Passkey verification failed", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse)
    )
)]
pub async fn webauthn_authentication_verify(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<WebAuthnVerifyRequest>,
) -> Result<Json<ObjectResponse<WebAuthnVerifyResponse>>, ApiError> {
    let challenge_id = parse_mfa_session(payload.mfa_session.as_deref())?;
    let challenge = hms_db::auth::consume_webauthn_challenge(
        state.db_pool(),
        user.facility_id,
        user.id,
        challenge_id,
        WebAuthnCeremonyType::Authentication,
    )
    .await
    .map_err(|_| ApiError::bad_request("webauthn_verify_failed", "Passkey verification failed."))?
    .ok_or_else(|| {
        ApiError::bad_request(
            "webauthn_challenge_invalid",
            "Passkey challenge is invalid.",
        )
    })?;
    let stored = stored_passkeys(state.db_pool(), user.facility_id, user.id).await?;
    let AuthenticatedPasskey {
        credential_id,
        passkey,
    } = hms_auth::finish_passkey_authentication(
        &webauthn_config()?,
        payload.credential,
        challenge.state,
        &stored,
    )
    .map_err(|_| ApiError::bad_request("webauthn_verify_failed", "Passkey verification failed."))?;

    hms_db::auth::update_webauthn_credential_after_authentication(
        state.db_pool(),
        user.facility_id,
        user.id,
        &credential_id,
        &passkey,
    )
    .await
    .map_err(|_| ApiError::bad_request("webauthn_verify_failed", "Passkey verification failed."))?;

    Ok(Json(object(WebAuthnVerifyResponse { verified: true })))
}

#[utoipa::path(
    post,
    path = "/api/v2/auth/mfa/recovery-codes",
    operation_id = "postAuthRecoveryCodes",
    tag = "auth",
    security(("bearerAuth" = [])),
    request_body = RecoveryCodeGenerateRequest,
    responses(
        (status = 200, description = "Recovery codes regenerated", body = ObjectResponse<RecoveryCodeGenerateResponse>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Fresh reauthentication required", body = ApiErrorResponse),
        (status = 400, description = "Recovery codes could not be generated", body = ApiErrorResponse)
    )
)]
pub async fn generate_recovery_codes(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<RecoveryCodeGenerateRequest>,
) -> Result<Json<ObjectResponse<RecoveryCodeGenerateResponse>>, ApiError> {
    let account = hms_db::auth::user_by_id(state.db_pool(), user.id)
        .await
        .map_err(|_| ApiError::unauthorized())?
        .ok_or_else(ApiError::unauthorized)?;
    if account.facility_id != user.facility_id
        || !hms_auth::verify_password_hash(&account.password_hash, &payload.current_password)
    {
        return Err(ApiError::forbidden(
            "fresh_reauth_required",
            "Current password is required to regenerate recovery codes.",
        ));
    }

    let codes = hms_auth::generate_recovery_codes(10);
    let code_hashes = codes
        .iter()
        .map(|code| hms_auth::hash_recovery_code(code))
        .collect::<Vec<_>>();
    hms_db::auth::replace_recovery_codes(state.db_pool(), user.facility_id, user.id, code_hashes)
        .await
        .map_err(|_| {
            ApiError::bad_request(
                "recovery_codes_failed",
                "Recovery codes could not be generated.",
            )
        })?;
    state.invalidate_auth_cache_for_user(user.facility_id, user.id);

    Ok(Json(object(RecoveryCodeGenerateResponse { codes })))
}

fn validate_profile_update(payload: &UpdateAuthProfileRequest) -> Result<(), ApiError> {
    if let Some(value) = payload.display_name.as_ref() {
        if value.trim().is_empty() || value.len() > MAX_DISPLAY_NAME_LEN {
            return Err(ApiError::bad_request(
                "invalid_display_name",
                "Display name is invalid.",
            ));
        }
    }
    Ok(())
}

async fn stored_passkeys(
    pool: &hms_db::PgPool,
    facility_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<StoredPasskey>, ApiError> {
    let credentials = hms_db::auth::list_webauthn_credentials(pool, facility_id, user_id)
        .await
        .map_err(|_| {
            ApiError::bad_request(
                "webauthn_credentials_failed",
                "Passkeys could not be loaded.",
            )
        })?;
    Ok(credentials
        .into_iter()
        .map(|credential| StoredPasskey {
            credential_id: credential.credential_id,
            passkey: credential.passkey,
        })
        .collect())
}

fn webauthn_config() -> Result<WebAuthnConfig, ApiError> {
    Ok(WebAuthnConfig {
        rp_id: std::env::var("HMS_WEBAUTHN_RP_ID").unwrap_or_else(|_| "localhost".to_owned()),
        rp_origin: std::env::var("HMS_WEBAUTHN_RP_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:8080".to_owned()),
        rp_name: std::env::var("HMS_WEBAUTHN_RP_NAME").unwrap_or_else(|_| "HMS".to_owned()),
        challenge_ttl: chrono::Duration::minutes(5),
    })
}

fn with_mfa_session(mut value: Value, challenge_id: Uuid) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "challenge_id".to_owned(),
            Value::String(challenge_id.to_string()),
        );
        object.insert(
            "mfa_session".to_owned(),
            Value::String(challenge_id.to_string()),
        );
    }
    value
}

fn parse_mfa_session(value: Option<&str>) -> Result<Uuid, ApiError> {
    value
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            ApiError::bad_request(
                "webauthn_challenge_required",
                "Passkey challenge is required.",
            )
        })
}

fn device_label_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(DEVICE_LABEL_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(MAX_DEVICE_LABEL_LEN).collect())
}

fn auth_response(
    outcome: LoginOutcome,
    cookie_secure: bool,
) -> (HeaderMap, Json<ObjectResponse<AuthTokenResponse>>) {
    let mut headers = HeaderMap::new();
    let cookie_max_age = cookie_max_age_until(outcome.refresh_expires_at);
    headers.append(
        SET_COOKIE,
        refresh_cookie(&outcome.refresh_token, cookie_secure, cookie_max_age),
    );
    headers.append(
        SET_COOKIE,
        csrf_cookie(&outcome.csrf_token, cookie_secure, cookie_max_age),
    );

    (
        headers,
        Json(object(AuthTokenResponse {
            access_token: outcome.access_token,
            token_type: "Bearer".to_owned(),
            expires_in_seconds: outcome.access_token_expires_in_seconds,
            refresh_expires_at: outcome.refresh_expires_at,
            session_idle_expires_at: outcome.session_idle_expires_at,
            session_absolute_expires_at: outcome.session_absolute_expires_at,
            user: outcome.user,
        })),
    )
}

fn refresh_cookie(token: &str, secure: bool, max_age: cookie::time::Duration) -> HeaderValue {
    Cookie::build((REFRESH_COOKIE_NAME, token.to_owned()))
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .path("/api/v2/auth")
        .max_age(max_age)
        .build()
        .to_string()
        .parse()
        .expect("refresh cookie value is valid")
}

fn csrf_cookie(token: &str, secure: bool, max_age: cookie::time::Duration) -> HeaderValue {
    Cookie::build((CSRF_COOKIE_NAME, token.to_owned()))
        .secure(secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(max_age)
        .build()
        .to_string()
        .parse()
        .expect("csrf cookie value is valid")
}

fn cookie_max_age_until(expires_at: DateTime<Utc>) -> cookie::time::Duration {
    let seconds = expires_at
        .signed_duration_since(Utc::now())
        .num_seconds()
        .max(1);
    cookie::time::Duration::seconds(seconds)
}

fn expired_refresh_cookie(secure: bool) -> HeaderValue {
    Cookie::build((REFRESH_COOKIE_NAME, ""))
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .path("/api/v2/auth")
        .max_age(cookie::time::Duration::seconds(0))
        .build()
        .to_string()
        .parse()
        .expect("expired refresh cookie value is valid")
}

fn expired_csrf_cookie(secure: bool) -> HeaderValue {
    Cookie::build((CSRF_COOKIE_NAME, ""))
        .secure(secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(cookie::time::Duration::seconds(0))
        .build()
        .to_string()
        .parse()
        .expect("expired csrf cookie value is valid")
}

fn read_refresh_cookie(headers: &HeaderMap) -> Option<String> {
    read_cookie(headers, REFRESH_COOKIE_NAME)
}

fn read_csrf_cookie(headers: &HeaderMap) -> Option<String> {
    read_cookie(headers, CSRF_COOKIE_NAME)
}

fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let parsed = Cookie::parse(cookie.trim()).ok()?;
                (parsed.name() == name).then(|| parsed.value().to_owned())
            })
        })
}

fn require_csrf(headers: &HeaderMap) -> Result<String, ApiError> {
    let header = headers
        .get(CSRF_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::forbidden("csrf_required", "CSRF token is required."))?;
    let cookie = read_csrf_cookie(headers)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::forbidden("csrf_required", "CSRF token is required."))?;

    if hash_for_compare(&header) != hash_for_compare(&cookie) {
        return Err(ApiError::forbidden(
            "csrf_invalid",
            "CSRF token is invalid.",
        ));
    }

    Ok(header)
}

fn hash_for_compare(value: &str) -> String {
    crate::state::csrf_compare_hash(value)
}
