use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::{require_patient_demographics_access, require_permission};
use hms_db::consent::ConsentCursor;
use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::care::CursorListQuery;
use hms_domain::consent::{ConsentGrantListItem, CreateConsentGrantRequest};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    user: &AuthUser,
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

fn require_consent_list_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_consent_permission(user, facility_id)?;
    if user
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics)
    {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to consent lists.",
        ))
    }
}

fn require_consent_permission(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_permission(user, PermissionCode::ConsentManage).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })?;
    if user.facility_id == facility_id {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        ))
    }
}

fn page_request(query: CursorListQuery) -> Result<(Option<ConsentCursor>, u8), ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = query
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(decode_cursor)
        .transpose()?;
    Ok((cursor, limit))
}

fn page_response<T, F>(mut rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    let has_next = rows.len() > page_size as usize;
    if has_next {
        rows.truncate(page_size as usize);
    }
    let next_cursor = if has_next {
        rows.last().map(cursor_for)
    } else {
        None
    };

    list(
        rows,
        PageInfo {
            next_cursor,
            has_next,
            limit: page_size,
        },
    )
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    format!("{}:{}", occurred_at.timestamp_micros(), id)
}

fn decode_cursor(value: &str) -> Result<ConsentCursor, ApiError> {
    let (micros, id) = value
        .split_once(':')
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let occurred_at = DateTime::<Utc>::from_timestamp_micros(micros)
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let id = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    Ok(ConsentCursor { occurred_at, id })
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
