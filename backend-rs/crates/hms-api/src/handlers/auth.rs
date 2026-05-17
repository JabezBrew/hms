use axum::extract::Path;
use axum::extract::State;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue};
use axum::Json;
use chrono::{DateTime, Utc};
use cookie::{Cookie, SameSite};
use hms_domain::auth::{AuthUser, UpdateAuthProfileRequest};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::{AuthenticatedSession, RequestContext};
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
pub async fn me(RequestContext(user): RequestContext) -> Json<ObjectResponse<AuthUser>> {
    Json(object(user.auth_user().clone()))
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
    headers.append(
        SET_COOKIE,
        refresh_cookie(&outcome.refresh_token, cookie_secure),
    );
    headers.append(SET_COOKIE, csrf_cookie(&outcome.csrf_token, cookie_secure));

    (
        headers,
        Json(object(AuthTokenResponse {
            access_token: outcome.access_token,
            token_type: "Bearer".to_owned(),
            expires_in_seconds: 600,
            user: outcome.user,
        })),
    )
}

fn refresh_cookie(token: &str, secure: bool) -> HeaderValue {
    Cookie::build((REFRESH_COOKIE_NAME, token.to_owned()))
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .path("/api/v2/auth")
        .max_age(cookie::time::Duration::hours(12))
        .build()
        .to_string()
        .parse()
        .expect("refresh cookie value is valid")
}

fn csrf_cookie(token: &str, secure: bool) -> HeaderValue {
    Cookie::build((CSRF_COOKIE_NAME, token.to_owned()))
        .secure(secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(cookie::time::Duration::hours(12))
        .build()
        .to_string()
        .parse()
        .expect("csrf cookie value is valid")
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
