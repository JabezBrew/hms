use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::consent::ConsentCursor;
use hms_domain::care::CursorListQuery;
use hms_domain::consent::{ConsentGrantListItem, CreateConsentGrantRequest};
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;

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
    require_consent_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_consent_grants(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("consent_list_failed", "Consent grants could not be loaded.")
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
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
    require_consent_permission(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let purpose = required_text(payload.purpose, "purpose")?;
    if let Some(expires_at) = payload.expires_at {
        if expires_at <= Utc::now() {
            let mut error = ApiError::bad_request("invalid_request", "Request is invalid.");
            error.details = json!({ "expires_at": ["Expiration must be in the future."] });
            return Err(error);
        }
    }

    let grant = state
        .create_consent_grant(
            payload.patient_id,
            payload.scope,
            purpose,
            payload.expires_at,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "consent_create_failed",
                "Consent grant could not be created.",
            )
        })?;

    Ok(Json(object(grant)))
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
    require_consent_permission(&user, state.facility_id())?;
    let existing = state
        .get_consent_grant(id)
        .await
        .map_err(|_| {
            ApiError::conflict("consent_load_failed", "Consent grant could not be loaded.")
        })?
        .ok_or_else(|| ApiError::not_found("consent_not_found", "Consent grant was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    let grant = state
        .revoke_consent_grant(id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "consent_revoke_failed",
                "Consent grant could not be revoked.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("consent_not_found", "Consent grant was not found."))?;

    Ok(Json(object(grant)))
}

async fn load_patient_for_access(
    state: &AppState,
    user: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = state
        .get_patient(patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    require_patient_demographics_access(user, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;
    Ok(patient)
}

fn require_consent_list_access(
    user: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_consent_access(user, facility_id).map_err(|error| match error {
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to consent lists.",
        ),
        other => ApiError::from(other),
    })
}

fn require_consent_permission(
    user: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_consent_access(user, facility_id).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })
}

fn page_request(query: CursorListQuery) -> Result<(Option<ConsentCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| ConsentCursor { occurred_at, id },
    )?;
    Ok((page.cursor, page.limit))
}

fn page_response<T, F>(rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    cursor_list::page_response(rows, page_size, cursor_for)
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
}

fn required_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        let mut error = ApiError::bad_request("invalid_request", "Request is invalid.");
        error.details = json!({ field: ["This field is required."] });
        return Err(error);
    }
    Ok(value.to_owned())
}
