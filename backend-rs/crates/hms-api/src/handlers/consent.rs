use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::care::CursorListQuery;
use hms_domain::consent::{ConsentGrantListItem, CreateConsentGrantRequest};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/consents",
    operation_id = "getConsents",
    tag = "consent",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Consent grant list", body = ListResponse<ConsentGrantListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_consent_grants(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ConsentGrantListItem>>, ApiError> {
    Ok(Json(
        state
            .consent_service()
            .list_consent_grants(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/consents",
    operation_id = "postConsents",
    tag = "consent",
    security(("bearerAuth" = [])),
    request_body = CreateConsentGrantRequest,
    responses(
        (status = 200, description = "Consent grant created", body = ObjectResponse<ConsentGrantListItem>),
        (status = 400, description = "Invalid consent grant", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_consent_grant(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateConsentGrantRequest>,
) -> Result<Json<ObjectResponse<ConsentGrantListItem>>, ApiError> {
    Ok(Json(
        state
            .consent_service()
            .create_consent_grant(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/consents/{id}/revoke",
    operation_id = "postConsentRevoke",
    tag = "consent",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Consent grant id")),
    responses(
        (status = 200, description = "Consent grant revoked", body = ObjectResponse<ConsentGrantListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Consent grant not found", body = ApiErrorResponse)
    )
)]
pub async fn revoke_consent_grant(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ConsentGrantListItem>>, ApiError> {
    Ok(Json(
        state
            .consent_service()
            .revoke_consent_grant(&user, id)
            .await?,
    ))
}
