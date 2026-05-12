use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::{require_patient_demographics_access, require_permission};
use hms_db::referrals::ReferralCursor;
use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use hms_domain::referrals::{
    ClinicWaitlistEntryListItem, CreateClinicWaitlistEntryRequest, CreateReferralRequest,
    OfferNextClinicWaitlistEntryRequest, ReferralListItem,
};
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
    path = "/api/v2/referrals",
    operation_id = "getReferrals",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Referral list", body = ListResponse<ReferralListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_referrals(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ReferralListItem>>, ApiError> {
    require_patient_workflow_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_referrals(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("referral_list_failed", "Referrals could not be loaded.")
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals",
    operation_id = "postReferrals",
    tag = "referrals",
    security(("bearerAuth" = [])),
    request_body = CreateReferralRequest,
    responses(
        (status = 200, description = "Referral created", body = ObjectResponse<ReferralListItem>),
        (status = 400, description = "Invalid referral", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_referral(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateReferralRequest>,
) -> Result<Json<ObjectResponse<ReferralListItem>>, ApiError> {
    require_referral_permission(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let to_service = required_text(payload.to_service, "to_service")?;
    let reason = payload
        .reason
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let referral = state
        .create_referral(
            payload.patient_id,
            to_service,
            payload.priority,
            reason,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("referral_create_failed", "Referral could not be created.")
        })?;

    Ok(Json(object(referral)))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/{id}/accept",
    operation_id = "postReferralAccept",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Referral id")),
    responses(
        (status = 200, description = "Referral accepted", body = ObjectResponse<ReferralListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Referral not found", body = ApiErrorResponse)
    )
)]
pub async fn accept_referral(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ReferralListItem>>, ApiError> {
    require_referral_permission(&user, state.facility_id())?;
    let existing = state
        .get_referral(id)
        .await
        .map_err(|_| ApiError::conflict("referral_load_failed", "Referral could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    let referral = state
        .accept_referral(id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict("referral_accept_failed", "Referral could not be accepted.")
        })?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

    Ok(Json(object(referral)))
}

#[utoipa::path(
    get,
    path = "/api/v2/referrals/clinic-waitlist",
    operation_id = "getClinicWaitlist",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Clinic waitlist entries", body = ListResponse<ClinicWaitlistEntryListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_clinic_waitlist_entries(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ClinicWaitlistEntryListItem>>, ApiError> {
    require_patient_workflow_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_clinic_waitlist_entries(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinic_waitlist_failed",
                "Clinic waitlist could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/clinic-waitlist",
    operation_id = "postClinicWaitlist",
    tag = "referrals",
    security(("bearerAuth" = [])),
    request_body = CreateClinicWaitlistEntryRequest,
    responses(
        (status = 200, description = "Clinic waitlist entry created", body = ObjectResponse<ClinicWaitlistEntryListItem>),
        (status = 400, description = "Invalid waitlist entry", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_clinic_waitlist_entry(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateClinicWaitlistEntryRequest>,
) -> Result<Json<ObjectResponse<ClinicWaitlistEntryListItem>>, ApiError> {
    require_referral_permission(&user, state.facility_id())?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let service = required_text(payload.service, "service")?;
    let entry = state
        .create_clinic_waitlist_entry(payload.patient_id, service, payload.priority, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinic_waitlist_create_failed",
                "Clinic waitlist entry could not be created.",
            )
        })?;

    Ok(Json(object(entry)))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/clinic-waitlist/offer-next",
    operation_id = "postClinicWaitlistOfferNext",
    tag = "referrals",
    security(("bearerAuth" = [])),
    request_body = OfferNextClinicWaitlistEntryRequest,
    responses(
        (status = 200, description = "Clinic waitlist entry offered", body = ObjectResponse<ClinicWaitlistEntryListItem>),
        (status = 400, description = "Invalid waitlist request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "No waiting entry", body = ApiErrorResponse)
    )
)]
pub async fn offer_next_clinic_waitlist_entry(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<OfferNextClinicWaitlistEntryRequest>,
) -> Result<Json<ObjectResponse<ClinicWaitlistEntryListItem>>, ApiError> {
    require_patient_workflow_access(&user, state.facility_id())?;
    let service = required_text(payload.service, "service")?;
    let entry = state
        .offer_next_clinic_waitlist_entry(&service, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "clinic_waitlist_offer_failed",
                "Clinic waitlist entry could not be offered.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("clinic_waitlist_empty", "No waiting entry was available.")
        })?;

    Ok(Json(object(entry)))
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

fn require_patient_workflow_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_referral_permission(user, facility_id)?;
    if user
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics)
    {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient workflow lists.",
        ))
    }
}

fn require_referral_permission(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_permission(user, PermissionCode::ReferralManage).map_err(|_| {
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

fn page_request(query: CursorListQuery) -> Result<(Option<ReferralCursor>, u8), ApiError> {
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

fn decode_cursor(value: &str) -> Result<ReferralCursor, ApiError> {
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
    Ok(ReferralCursor { occurred_at, id })
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
