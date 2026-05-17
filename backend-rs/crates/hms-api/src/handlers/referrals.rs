use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::referrals::ReferralCursor;
use hms_domain::care::CursorListQuery;
use hms_domain::patients::PatientRecord;
use hms_domain::referrals::{
    AcceptReferralRequest, ClinicWaitlistEntryListItem, CompleteReferralRequest,
    CreateClinicWaitlistEntryRequest, CreateReferralRequest, DeclineReferralRequest,
    OfferNextClinicWaitlistEntryRequest, ReferralListItem, ReferralListQuery, ReferralSlaDashboard,
    ReferralSlaState,
};
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
    path = "/api/v2/referrals",
    operation_id = "getReferrals",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(ReferralListQuery),
    responses(
        (status = 200, description = "Referral list", body = ListResponse<ReferralListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_referrals(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<ReferralListQuery>,
) -> Result<Json<ListResponse<ReferralListItem>>, ApiError> {
    require_patient_workflow_access(&user, state.facility_id())?;
    let status = query.status;
    let (cursor, page_size) = page_request(CursorListQuery {
        cursor: query.cursor,
        limit: query.limit,
    })?;
    let rows = state
        .list_referrals(cursor, page_size as i64 + 1, status)
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
    RequestContext(user): RequestContext,
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
    get,
    path = "/api/v2/referrals/{id}",
    operation_id = "getReferralById",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Referral id")),
    responses(
        (status = 200, description = "Referral detail", body = ObjectResponse<ReferralListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Referral not found", body = ApiErrorResponse)
    )
)]
pub async fn get_referral(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ReferralListItem>>, ApiError> {
    require_referral_permission(&user, state.facility_id())?;
    let referral = load_referral_for_access(&state, &user, id).await?;
    Ok(Json(object(referral)))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/{id}/accept",
    operation_id = "postReferralAccept",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Referral id")),
    request_body = AcceptReferralRequest,
    responses(
        (status = 200, description = "Referral accepted", body = ObjectResponse<ReferralListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Referral not found", body = ApiErrorResponse)
    )
)]
pub async fn accept_referral(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<AcceptReferralRequest>,
) -> Result<Json<ObjectResponse<ReferralListItem>>, ApiError> {
    require_referral_permission(&user, state.facility_id())?;
    let _existing = load_referral_for_access(&state, &user, id).await?;
    let referral = state
        .accept_referral(id, user.id, optional_text(payload.acceptance_notes))
        .await
        .map_err(|_| {
            ApiError::conflict("referral_accept_failed", "Referral could not be accepted.")
        })?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

    Ok(Json(object(referral)))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/{id}/decline",
    operation_id = "postReferralDecline",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Referral id")),
    request_body = DeclineReferralRequest,
    responses(
        (status = 200, description = "Referral declined", body = ObjectResponse<ReferralListItem>),
        (status = 400, description = "Invalid decline request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Referral not found", body = ApiErrorResponse)
    )
)]
pub async fn decline_referral(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<DeclineReferralRequest>,
) -> Result<Json<ObjectResponse<ReferralListItem>>, ApiError> {
    require_referral_permission(&user, state.facility_id())?;
    let _existing = load_referral_for_access(&state, &user, id).await?;
    let decline_reason = required_text(payload.decline_reason, "decline_reason")?;
    let referral = state
        .decline_referral(id, decline_reason)
        .await
        .map_err(|_| {
            ApiError::conflict("referral_decline_failed", "Referral could not be declined.")
        })?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

    Ok(Json(object(referral)))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/{id}/complete",
    operation_id = "postReferralComplete",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Referral id")),
    request_body = CompleteReferralRequest,
    responses(
        (status = 200, description = "Referral completed", body = ObjectResponse<ReferralListItem>),
        (status = 400, description = "Invalid completion request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Referral not found", body = ApiErrorResponse)
    )
)]
pub async fn complete_referral(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CompleteReferralRequest>,
) -> Result<Json<ObjectResponse<ReferralListItem>>, ApiError> {
    require_referral_permission(&user, state.facility_id())?;
    let _existing = load_referral_for_access(&state, &user, id).await?;
    let specialist_notes = required_text(payload.specialist_notes, "specialist_notes")?;
    let referral = state
        .complete_referral(id, specialist_notes, optional_text(payload.recommendations))
        .await
        .map_err(|_| {
            ApiError::conflict(
                "referral_complete_failed",
                "Referral could not be completed.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

    Ok(Json(object(referral)))
}

#[utoipa::path(
    get,
    path = "/api/v2/referrals/{id}/sla-state",
    operation_id = "getReferralSlaState",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Referral id")),
    responses(
        (status = 200, description = "Referral SLA state", body = ObjectResponse<ReferralSlaState>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Referral not found", body = ApiErrorResponse)
    )
)]
pub async fn get_referral_sla_state(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ReferralSlaState>>, ApiError> {
    require_referral_permission(&user, state.facility_id())?;
    let _existing = load_referral_for_access(&state, &user, id).await?;
    let sla_state = state
        .referral_sla_state(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "referral_sla_state_failed",
                "Referral SLA state could not be loaded.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;

    Ok(Json(object(sla_state)))
}

#[utoipa::path(
    get,
    path = "/api/v2/referrals/sla-dashboard",
    operation_id = "getReferralSlaDashboard",
    tag = "referrals",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Referral SLA dashboard", body = ObjectResponse<ReferralSlaDashboard>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn get_referral_sla_dashboard(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ObjectResponse<ReferralSlaDashboard>>, ApiError> {
    require_patient_workflow_access(&user, state.facility_id())?;
    let dashboard = state.referral_sla_dashboard().await.map_err(|_| {
        ApiError::conflict(
            "referral_sla_dashboard_failed",
            "Referral SLA dashboard could not be loaded.",
        )
    })?;

    Ok(Json(object(dashboard)))
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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
    RequestContext(user): RequestContext,
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

async fn load_referral_for_access(
    state: &AppState,
    user: &hms_access::RequestContext,
    referral_id: Uuid,
) -> Result<ReferralListItem, ApiError> {
    let referral = state
        .get_referral(referral_id)
        .await
        .map_err(|_| ApiError::conflict("referral_load_failed", "Referral could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("referral_not_found", "Referral was not found."))?;
    let _patient = load_patient_for_access(state, user, referral.patient_id).await?;
    Ok(referral)
}

fn require_patient_workflow_access(
    user: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_referral_access(user, facility_id).map_err(|error| match error {
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient workflow lists.",
        ),
        other => ApiError::from(other),
    })
}

fn require_referral_permission(
    user: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_referral_access(user, facility_id).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })
}

fn page_request(query: CursorListQuery) -> Result<(Option<ReferralCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| ReferralCursor { occurred_at, id },
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

fn optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}
