use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::care::CursorListQuery;
use hms_domain::referrals::{
    AcceptReferralRequest, CancelClinicWaitlistEntryRequest, ClinicWaitlistEntryListItem,
    CompleteReferralRequest, CreateClinicWaitlistEntryRequest, CreateReferralRequest,
    DeclineReferralRequest, OfferNextClinicWaitlistEntryRequest, PromoteClinicWaitlistEntryRequest,
    ReferralListItem, ReferralListQuery, ReferralSlaDashboard, ReferralSlaState,
    ScheduleReferralAppointmentRequest,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

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
    Ok(Json(
        state
            .referrals_service()
            .list_referrals(&user, query)
            .await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .create_referral(&user, payload)
            .await?,
    ))
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
    Ok(Json(
        state.referrals_service().get_referral(&user, id).await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .accept_referral(&user, id, payload)
            .await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .decline_referral(&user, id, payload)
            .await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .complete_referral(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/{id}/schedule",
    operation_id = "postReferralSchedule",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Referral id")),
    request_body = ScheduleReferralAppointmentRequest,
    responses(
        (status = 200, description = "Referral scheduled to appointment", body = ObjectResponse<ReferralListItem>),
        (status = 400, description = "Invalid appointment request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Referral not found", body = ApiErrorResponse)
    )
)]
pub async fn schedule_referral_appointment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<ScheduleReferralAppointmentRequest>,
) -> Result<Json<ObjectResponse<ReferralListItem>>, ApiError> {
    Ok(Json(
        state
            .referrals_service()
            .schedule_referral_appointment(&user, id, payload)
            .await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .get_referral_sla_state(&user, id)
            .await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .get_referral_sla_dashboard(&user)
            .await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .list_clinic_waitlist_entries(&user, query)
            .await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .create_clinic_waitlist_entry(&user, payload)
            .await?,
    ))
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
    Ok(Json(
        state
            .referrals_service()
            .offer_next_clinic_waitlist_entry(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/clinic-waitlist/{id}/promote",
    operation_id = "postClinicWaitlistPromote",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Clinic waitlist entry id")),
    request_body = PromoteClinicWaitlistEntryRequest,
    responses(
        (status = 200, description = "Clinic waitlist entry promoted to appointment", body = ObjectResponse<ClinicWaitlistEntryListItem>),
        (status = 400, description = "Invalid promotion request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Clinic waitlist entry not found", body = ApiErrorResponse)
    )
)]
pub async fn promote_clinic_waitlist_entry(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<PromoteClinicWaitlistEntryRequest>,
) -> Result<Json<ObjectResponse<ClinicWaitlistEntryListItem>>, ApiError> {
    Ok(Json(
        state
            .referrals_service()
            .promote_clinic_waitlist_entry(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/referrals/clinic-waitlist/{id}/cancel",
    operation_id = "postClinicWaitlistCancel",
    tag = "referrals",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Clinic waitlist entry id")),
    request_body = CancelClinicWaitlistEntryRequest,
    responses(
        (status = 200, description = "Clinic waitlist entry cancelled", body = ObjectResponse<ClinicWaitlistEntryListItem>),
        (status = 400, description = "Invalid cancellation request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Clinic waitlist entry not found", body = ApiErrorResponse)
    )
)]
pub async fn cancel_clinic_waitlist_entry(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CancelClinicWaitlistEntryRequest>,
) -> Result<Json<ObjectResponse<ClinicWaitlistEntryListItem>>, ApiError> {
    Ok(Json(
        state
            .referrals_service()
            .cancel_clinic_waitlist_entry(&user, id, payload)
            .await?,
    ))
}
