//! Thin HTTP shape for restricted grants and verified session assurance.
use crate::{
    cursor_list,
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
    response::{object, ListResponse, ObjectResponse},
    services::auth_factor::{self as service, LoginResult},
    state::{AppState, LoginOutcome},
};
use axum::{
    extract::{
        rejection::{JsonRejection, PathRejection, QueryRejection},
        Path, Query, State,
    },
    http::HeaderMap,
    Json,
};
use hms_domain::{auth_assurance::*, care::CursorListQuery};
use serde_json::Value;
use uuid::Uuid;
fn invalid() -> ApiError {
    ApiError::bad_request(
        "invalid_factor_request",
        "Review the supported authentication fields.",
    )
}
fn payload<T>(body: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    Ok(body.map_err(|_| invalid())?.0)
}
pub(crate) fn tokens(outcome: LoginOutcome) -> AuthTokenResponse {
    AuthTokenResponse {
        access_token: outcome.access_token,
        token_type: "Bearer".to_owned(),
        expires_in_seconds: outcome.access_token_expires_in_seconds,
        refresh_expires_at: outcome.refresh_expires_at,
        session_idle_expires_at: outcome.session_idle_expires_at,
        session_absolute_expires_at: outcome.session_absolute_expires_at,
        user: outcome.user,
    }
}
pub(crate) fn login_response(
    result: LoginResult,
    secure: bool,
) -> (HeaderMap, Json<ObjectResponse<AuthLoginResponse>>) {
    match result {
        LoginResult::Authenticated(outcome) => {
            let (headers, Json(response)) = super::auth::auth_response(outcome, secure);
            (
                headers,
                Json(object(AuthLoginResponse::Authenticated {
                    token: response.data,
                })),
            )
        }
        LoginResult::Pending(p) => {
            let result = if p.status == "setup_required" {
                AuthLoginResponse::SetupRequired {
                    login_grant: p.login_grant,
                    expires_at: p.expires_at,
                    methods: p.methods,
                    reason: p.reason,
                }
            } else {
                AuthLoginResponse::FactorRequired {
                    login_grant: p.login_grant,
                    expires_at: p.expires_at,
                    methods: p.methods,
                    reason: p.reason,
                }
            };
            (HeaderMap::new(), Json(object(result)))
        }
    }
}
#[utoipa::path(post,path="/api/v2/auth/login/passkey/options",operation_id="postAuthLoginPasskeyOptions",tag="auth",request_body=LoginFactorOptionsRequest,responses((status=200,body=ObjectResponse<Value>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse),(status=429,body=ApiErrorResponse)))]
pub async fn login_options(
    State(s): State<AppState>,
    body: Result<Json<LoginFactorOptionsRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<Value>>, ApiError> {
    let p = payload(body)?;
    Ok(Json(object(
        service::login_options(&s, &p.login_grant, None).await?,
    )))
}
#[utoipa::path(post,path="/api/v2/auth/login/setup/options",operation_id="postAuthLoginSetupOptions",tag="auth",request_body=LoginSetupOptionsRequest,responses((status=200,body=ObjectResponse<Value>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse),(status=429,body=ApiErrorResponse)))]
pub async fn setup_options(
    State(s): State<AppState>,
    body: Result<Json<LoginSetupOptionsRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<Value>>, ApiError> {
    let p = payload(body)?;
    Ok(Json(object(
        service::login_options(&s, &p.login_grant, Some(&p.bootstrap_token)).await?,
    )))
}
#[utoipa::path(post,path="/api/v2/auth/login/passkey/verify",operation_id="postAuthLoginPasskeyVerify",tag="auth",request_body=LoginFactorVerifyRequest,responses((status=200,body=ObjectResponse<AuthLoginResponse>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn login_verify(
    State(s): State<AppState>,
    body: Result<Json<LoginFactorVerifyRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ObjectResponse<AuthLoginResponse>>), ApiError> {
    Ok(login_response(
        service::verify_login(&s, payload(body)?, false).await?,
        s.cookie_secure(),
    ))
}
#[utoipa::path(post,path="/api/v2/auth/login/setup/verify",operation_id="postAuthLoginSetupVerify",tag="auth",request_body=LoginFactorVerifyRequest,responses((status=200,body=ObjectResponse<AuthLoginResponse>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn setup_verify(
    State(s): State<AppState>,
    body: Result<Json<LoginFactorVerifyRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ObjectResponse<AuthLoginResponse>>), ApiError> {
    Ok(login_response(
        service::verify_login(&s, payload(body)?, true).await?,
        s.cookie_secure(),
    ))
}
#[utoipa::path(post,path="/api/v2/auth/login/recovery",operation_id="postAuthLoginRecovery",tag="auth",request_body=LoginRecoveryRequest,responses((status=200,body=ObjectResponse<AuthLoginResponse>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn recovery(
    State(s): State<AppState>,
    body: Result<Json<LoginRecoveryRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ObjectResponse<AuthLoginResponse>>), ApiError> {
    Ok(login_response(
        service::recovery(&s, payload(body)?).await?,
        s.cookie_secure(),
    ))
}
#[utoipa::path(get,path="/api/v2/auth/assurance",operation_id="getAuthAssurance",tag="auth",security(("bearerAuth"=[])),responses((status=200,body=ObjectResponse<FactorAssuranceStatus>),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn status(
    State(s): State<AppState>,
    ctx: NetworkContext,
) -> Result<Json<ObjectResponse<FactorAssuranceStatus>>, ApiError> {
    Ok(Json(object(
        hms_db::auth::assurance::status(s.db_pool(), service::actor(&ctx))
            .await
            .map_err(service::error)?,
    )))
}
#[utoipa::path(post,path="/api/v2/auth/reauthenticate",operation_id="postAuthReauthenticate",tag="auth",security(("bearerAuth"=[])),request_body=OrdinaryPasswordConfirmationRequest,responses((status=200,body=ObjectResponse<AuthLoginResponse>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse),(status=429,body=ApiErrorResponse)))]
pub async fn confirm_password(
    State(s): State<AppState>,
    ctx: NetworkContext,
    body: Result<Json<OrdinaryPasswordConfirmationRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<AuthLoginResponse>>, ApiError> {
    Ok(Json(object(AuthLoginResponse::Authenticated {
        token: tokens(service::confirm_password(&s, &ctx, payload(body)?).await?),
    })))
}
#[utoipa::path(post,path="/api/v2/auth/assurance/options",operation_id="postAuthAssuranceOptions",tag="auth",security(("bearerAuth"=[])),request_body=StepUpOptionsRequest,responses((status=200,body=ObjectResponse<Value>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse),(status=429,body=ApiErrorResponse)))]
pub async fn step_up_options(
    State(s): State<AppState>,
    ctx: NetworkContext,
    body: Result<Json<StepUpOptionsRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<Value>>, ApiError> {
    Ok(Json(object(
        service::step_up_options(&s, &ctx, payload(body)?).await?,
    )))
}
#[utoipa::path(post,path="/api/v2/auth/assurance/verify",operation_id="postAuthAssuranceVerify",tag="auth",security(("bearerAuth"=[])),request_body=StepUpVerifyRequest,responses((status=200,body=ObjectResponse<AuthLoginResponse>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn step_up_verify(
    State(s): State<AppState>,
    ctx: NetworkContext,
    body: Result<Json<StepUpVerifyRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<AuthLoginResponse>>, ApiError> {
    Ok(Json(object(AuthLoginResponse::Authenticated {
        token: tokens(service::step_up_verify(&s, &ctx, payload(body)?).await?),
    })))
}
#[utoipa::path(get,path="/api/v2/auth/mfa/passkeys",operation_id="getAuthPasskeys",tag="auth",security(("bearerAuth"=[])),params(CursorListQuery),responses((status=200,body=ListResponse<PasskeyMetadata>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse)))]
pub async fn keys(
    State(s): State<AppState>,
    ctx: NetworkContext,
    q: Result<Query<CursorListQuery>, QueryRejection>,
) -> Result<Json<ListResponse<PasskeyMetadata>>, ApiError> {
    let q = q.map_err(|_| invalid())?.0;
    let page = cursor_list::page_request(q.cursor.as_deref(), q.limit, 25, 100, |at, id| (at, id))?;
    let rows = hms_db::auth::assurance::list_keys(
        s.db_pool(),
        service::actor(&ctx),
        page.cursor,
        page.fetch_limit(),
    )
    .await
    .map_err(service::error)?;
    Ok(Json(cursor_list::page_response(rows, page.limit, |k| {
        cursor_list::encode_cursor(k.created_at, k.id)
    })))
}
#[utoipa::path(patch,path="/api/v2/auth/mfa/passkeys/{id}",operation_id="patchAuthPasskey",tag="auth",security(("bearerAuth"=[])),params(("id"=Uuid,Path,description="Own key")),request_body=RenamePasskeyRequest,responses((status=200,body=ObjectResponse<PasskeyMetadata>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn rename(
    State(s): State<AppState>,
    ctx: NetworkContext,
    id: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<RenamePasskeyRequest>, JsonRejection>,
) -> Result<Json<ObjectResponse<PasskeyMetadata>>, ApiError> {
    let p = payload(body)?;
    let id = id.map_err(|_| invalid())?.0;
    let key = hms_db::auth::assurance::change_key(
        s.db_pool(),
        service::actor(&ctx),
        id,
        Some(&p.label),
        false,
    )
    .await
    .map_err(service::error)?;
    Ok(Json(object(key)))
}
#[utoipa::path(post,path="/api/v2/auth/mfa/passkeys/{id}/disable",operation_id="postAuthPasskeyDisable",tag="auth",security(("bearerAuth"=[])),params(("id"=Uuid,Path,description="Own key")),request_body=EmptyFactorDecision,responses((status=200,body=ObjectResponse<PasskeyMetadata>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn disable(
    State(s): State<AppState>,
    ctx: NetworkContext,
    id: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<EmptyFactorDecision>, JsonRejection>,
) -> Result<Json<ObjectResponse<PasskeyMetadata>>, ApiError> {
    payload(body)?;
    let id = id.map_err(|_| invalid())?.0;
    let key =
        hms_db::auth::assurance::change_key(s.db_pool(), service::actor(&ctx), id, None, true)
            .await
            .map_err(service::error)?;
    s.invalidate_auth_cache_for_user(ctx.context.facility_id, ctx.context.user_id);
    Ok(Json(object(key)))
}

#[utoipa::path(post,path="/api/v2/auth/setup/start",operation_id="postAuthSetupStart",tag="auth",request_body=super::auth::LoginRequest,responses((status=200,body=ObjectResponse<AuthLoginResponse>),(status=400,body=ApiErrorResponse),(status=401,body=ApiErrorResponse),(status=409,body=ApiErrorResponse),(status=429,body=ApiErrorResponse)))]
pub async fn setup_start(
    State(s): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<super::auth::LoginRequest>, JsonRejection>,
) -> Result<(HeaderMap, Json<ObjectResponse<AuthLoginResponse>>), ApiError> {
    let p = payload(body)?;
    let device = super::auth::device_label_from_headers(&headers);
    Ok(login_response(
        service::setup_start(
            &s,
            &p.email,
            &p.password,
            &p.facility_code,
            device.as_deref(),
            Some(crate::middleware::request_id::current_request_id()),
        )
        .await?,
        s.cookie_secure(),
    ))
}
