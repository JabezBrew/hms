use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::care::CareCursor;
use hms_domain::care::{
    AppointmentListItem, AppointmentListQuery, CareTeamAssignment, CheckInVisitRequest,
    ClinicListItem, CreateAppointmentRequest, CreateCareTeamAssignmentRequest, CreateClinicRequest,
    CreateEncounterRequest, CreateTriageRequest, CursorListQuery, EncounterListItem,
    EncounterListQuery, EncounterStatus, TriageAssessmentRequest, TriageListItem, TriageListQuery,
    TriageStatus, UpdateAppointmentRequest, UpdateClinicRequest, UpdateEncounterRequest,
    VisitListItem, VisitListQuery, VisitStatus,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_TRIAGE_NOTES_LEN: usize = 4_000;

#[utoipa::path(
    get,
    path = "/api/v2/appointments",
    operation_id = "getAppointments",
    tag = "care",
    security(("bearerAuth" = [])),
    params(AppointmentListQuery),
    responses(
        (status = 200, description = "Appointments list", body = ListResponse<AppointmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_appointments(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<AppointmentListQuery>,
) -> Result<Json<ListResponse<AppointmentListItem>>, ApiError> {
    Ok(Json(
        state.care_service().list_appointments(&user, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinics",
    operation_id = "getClinics",
    tag = "care",
    security(("bearerAuth" = [])),
    params(VisitListQuery),
    responses(
        (status = 200, description = "Clinics list", body = ListResponse<ClinicListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_clinics(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<ClinicListItem>>, ApiError> {
    Ok(Json(state.care_service().list_clinics(&user, query).await?))
}

#[utoipa::path(
    get,
    path = "/api/v2/clinics/{id}",
    operation_id = "getClinicById",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Clinic id")),
    responses(
        (status = 200, description = "Clinic detail", body = ObjectResponse<ClinicListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Clinic not found", body = ApiErrorResponse)
    )
)]
pub async fn get_clinic(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ClinicListItem>>, ApiError> {
    Ok(Json(state.care_service().get_clinic(&user, id).await?))
}

#[utoipa::path(
    post,
    path = "/api/v2/clinics",
    operation_id = "postClinics",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = CreateClinicRequest,
    responses(
        (status = 200, description = "Clinic created", body = ObjectResponse<ClinicListItem>),
        (status = 400, description = "Invalid clinic request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 409, description = "Clinic could not be saved", body = ApiErrorResponse)
    )
)]
pub async fn create_clinic(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateClinicRequest>,
) -> Result<Json<ObjectResponse<ClinicListItem>>, ApiError> {
    Ok(Json(
        state.care_service().create_clinic(&user, payload).await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/clinics/{id}",
    operation_id = "patchClinicById",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Clinic id")),
    request_body = UpdateClinicRequest,
    responses(
        (status = 200, description = "Clinic updated", body = ObjectResponse<ClinicListItem>),
        (status = 400, description = "Invalid clinic request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Clinic not found", body = ApiErrorResponse),
        (status = 409, description = "Clinic could not be saved", body = ApiErrorResponse)
    )
)]
pub async fn update_clinic(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateClinicRequest>,
) -> Result<Json<ObjectResponse<ClinicListItem>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .update_clinic(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v2/clinics/{id}",
    operation_id = "deleteClinicById",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Clinic id")),
    responses(
        (status = 200, description = "Clinic deactivated", body = ObjectResponse<ClinicListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Clinic not found", body = ApiErrorResponse),
        (status = 409, description = "Clinic could not be saved", body = ApiErrorResponse)
    )
)]
pub async fn delete_clinic(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ClinicListItem>>, ApiError> {
    Ok(Json(state.care_service().delete_clinic(&user, id).await?))
}

#[utoipa::path(
    post,
    path = "/api/v2/appointments",
    operation_id = "postAppointments",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = CreateAppointmentRequest,
    responses(
        (status = 200, description = "Appointment created", body = ObjectResponse<AppointmentListItem>),
        (status = 400, description = "Invalid appointment request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_appointment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateAppointmentRequest>,
) -> Result<Json<ObjectResponse<AppointmentListItem>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .create_appointment(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/appointments/{id}",
    operation_id = "getAppointmentById",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Appointment id")),
    responses(
        (status = 200, description = "Appointment detail", body = ObjectResponse<AppointmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Appointment not found", body = ApiErrorResponse)
    )
)]
pub async fn get_appointment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AppointmentListItem>>, ApiError> {
    Ok(Json(state.care_service().get_appointment(&user, id).await?))
}

#[utoipa::path(
    patch,
    path = "/api/v2/appointments/{id}",
    operation_id = "patchAppointmentById",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Appointment id")),
    request_body = UpdateAppointmentRequest,
    responses(
        (status = 200, description = "Appointment updated", body = ObjectResponse<AppointmentListItem>),
        (status = 400, description = "Invalid appointment request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Appointment not found", body = ApiErrorResponse)
    )
)]
pub async fn update_appointment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateAppointmentRequest>,
) -> Result<Json<ObjectResponse<AppointmentListItem>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .update_appointment(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/appointments/{id}/cancel",
    operation_id = "postAppointmentCancel",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Appointment id")),
    responses(
        (status = 200, description = "Appointment cancelled", body = ObjectResponse<AppointmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Appointment not found", body = ApiErrorResponse)
    )
)]
pub async fn cancel_appointment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AppointmentListItem>>, ApiError> {
    Ok(Json(
        state.care_service().cancel_appointment(&user, id).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/visits",
    operation_id = "getVisits",
    tag = "care",
    security(("bearerAuth" = [])),
    params(VisitListQuery),
    responses(
        (status = 200, description = "Clinic waiting room visits", body = ListResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_visits(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<VisitListQuery>,
) -> Result<Json<ListResponse<VisitListItem>>, ApiError> {
    require_workflow_list_access(&user, state.facility_id(), PermissionCode::AppointmentView)?;
    let clinic_id = query.clinic_id;
    let (cursor, page_size) = page_request(CursorListQuery {
        cursor: query.cursor,
        limit: query.limit,
    })?;
    let rows = state
        .list_visits(clinic_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("visit_list_failed", "Visits could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.checked_in_at, item.id)
    })))
}

#[utoipa::path(
    get,
    path = "/api/v2/visits/{id}",
    operation_id = "getVisitById",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Visit id")),
    responses(
        (status = 200, description = "Visit detail", body = ObjectResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Visit not found", body = ApiErrorResponse)
    )
)]
pub async fn get_visit(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    require_action_permission(&user, state.facility_id(), PermissionCode::AppointmentView)?;
    let visit = load_visit_for_access(&state, &user, id).await?;
    Ok(Json(object(visit)))
}

#[utoipa::path(
    post,
    path = "/api/v2/visits/check-in",
    operation_id = "postVisitCheckIn",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = CheckInVisitRequest,
    responses(
        (status = 200, description = "Visit checked in", body = ObjectResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn check_in_visit(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CheckInVisitRequest>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    require_action_permission(
        &user,
        state.facility_id(),
        PermissionCode::AppointmentManage,
    )?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let visit = state
        .check_in_visit(
            payload.patient_id,
            payload.appointment_id,
            payload.clinic_id,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("visit_check_in_failed", "Visit could not be checked in.")
        })?;

    Ok(Json(object(visit)))
}

#[utoipa::path(
    post,
    path = "/api/v2/visits/{id}/call",
    operation_id = "postVisitCall",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Visit id")),
    responses(
        (status = 200, description = "Visit called", body = ObjectResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Visit not found", body = ApiErrorResponse)
    )
)]
pub async fn call_visit(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    update_visit_with_access(
        &state,
        &user,
        id,
        VisitStatus::Called,
        PermissionCode::AppointmentManage,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/v2/visits/{id}/start-consultation",
    operation_id = "postVisitStartConsultation",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Visit id")),
    responses(
        (status = 200, description = "Visit moved to consultation", body = ObjectResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Visit not found", body = ApiErrorResponse)
    )
)]
pub async fn start_visit_consultation(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    update_visit_with_access(
        &state,
        &user,
        id,
        VisitStatus::InConsultation,
        PermissionCode::EncounterManage,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/v2/visits/{id}/hold",
    operation_id = "postVisitHold",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Visit id")),
    responses(
        (status = 200, description = "Visit put on hold", body = ObjectResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Visit not found", body = ApiErrorResponse)
    )
)]
pub async fn hold_visit(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    update_visit_with_access(
        &state,
        &user,
        id,
        VisitStatus::OnHold,
        PermissionCode::EncounterManage,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/v2/visits/{id}/ready-checkout",
    operation_id = "postVisitReadyCheckout",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Visit id")),
    responses(
        (status = 200, description = "Visit ready for checkout", body = ObjectResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Visit not found", body = ApiErrorResponse)
    )
)]
pub async fn ready_checkout_visit(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    update_visit_with_access(
        &state,
        &user,
        id,
        VisitStatus::ReadyCheckout,
        PermissionCode::EncounterManage,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/v2/visits/{id}/checkout",
    operation_id = "postVisitCheckout",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Visit id")),
    responses(
        (status = 200, description = "Visit checked out", body = ObjectResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Visit not found", body = ApiErrorResponse)
    )
)]
pub async fn checkout_visit(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    update_visit_with_access(
        &state,
        &user,
        id,
        VisitStatus::CheckedOut,
        PermissionCode::AppointmentManage,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/v2/visits/{id}/no-show",
    operation_id = "postVisitNoShow",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Visit id")),
    responses(
        (status = 200, description = "Visit marked no-show", body = ObjectResponse<VisitListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Visit not found", body = ApiErrorResponse)
    )
)]
pub async fn no_show_visit(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    update_visit_with_access(
        &state,
        &user,
        id,
        VisitStatus::NoShow,
        PermissionCode::AppointmentManage,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/api/v2/triage",
    operation_id = "getTriageQueue",
    tag = "care",
    security(("bearerAuth" = [])),
    params(TriageListQuery),
    responses(
        (status = 200, description = "Triage queue", body = ListResponse<TriageListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_triage(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<TriageListQuery>,
) -> Result<Json<ListResponse<TriageListItem>>, ApiError> {
    require_workflow_list_access(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(CursorListQuery {
        cursor: query.cursor,
        limit: query.limit,
    })?;
    let rows = state
        .list_triage(cursor, page_size as i64 + 1, query.status, query.acuity)
        .await
        .map_err(|_| {
            ApiError::conflict("triage_list_failed", "Triage queue could not be loaded.")
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/triage",
    operation_id = "postTriage",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = CreateTriageRequest,
    responses(
        (status = 200, description = "Triage item created", body = ObjectResponse<TriageListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Visit not found", body = ApiErrorResponse)
    )
)]
pub async fn create_triage(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateTriageRequest>,
) -> Result<Json<ObjectResponse<TriageListItem>>, ApiError> {
    require_action_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let visit = load_visit_for_access(&state, &user, payload.visit_id).await?;
    let triage = state
        .create_triage(payload.visit_id, visit.patient_id, payload.acuity, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict("triage_create_failed", "Triage item could not be created.")
        })?;

    Ok(Json(object(triage)))
}

#[utoipa::path(
    get,
    path = "/api/v2/triage/{id}",
    operation_id = "getTriage",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Triage id")),
    responses(
        (status = 200, description = "Triage item detail", body = ObjectResponse<TriageListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Triage item not found", body = ApiErrorResponse)
    )
)]
pub async fn get_triage(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<TriageListItem>>, ApiError> {
    require_action_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let triage = state
        .get_triage(id)
        .await
        .map_err(|_| ApiError::conflict("triage_load_failed", "Triage item could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;
    let _patient = load_patient_for_access(&state, &user, triage.patient_id).await?;

    Ok(Json(object(triage)))
}

#[utoipa::path(
    post,
    path = "/api/v2/triage/{id}/assessment",
    operation_id = "postTriageAssessment",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Triage id")),
    request_body = TriageAssessmentRequest,
    responses(
        (status = 200, description = "Triage assessment saved", body = ObjectResponse<TriageListItem>),
        (status = 400, description = "Invalid triage assessment", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Triage item not found", body = ApiErrorResponse)
    )
)]
pub async fn assess_triage(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(mut payload): Json<TriageAssessmentRequest>,
) -> Result<Json<ObjectResponse<TriageListItem>>, ApiError> {
    require_action_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let existing = state
        .get_triage(id)
        .await
        .map_err(|_| ApiError::conflict("triage_load_failed", "Triage item could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    if let Some(notes) = payload.notes.take() {
        let notes = notes.trim().to_owned();
        if notes.len() > MAX_TRIAGE_NOTES_LEN {
            return Err(ApiError::bad_request(
                "invalid_triage_notes",
                "Triage notes are too long.",
            ));
        }
        payload.notes = if notes.is_empty() { None } else { Some(notes) };
    }
    let triage = state
        .assess_triage(id, payload)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "triage_assessment_failed",
                "Triage assessment could not be saved.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;

    Ok(Json(object(triage)))
}

#[utoipa::path(
    post,
    path = "/api/v2/triage/{id}/assign",
    operation_id = "postTriageAssign",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Triage id")),
    request_body = hms_domain::care::AssignTriageRequest,
    responses(
        (status = 200, description = "Triage item assigned", body = ObjectResponse<TriageListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Triage item not found", body = ApiErrorResponse)
    )
)]
pub async fn assign_triage(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<hms_domain::care::AssignTriageRequest>,
) -> Result<Json<ObjectResponse<TriageListItem>>, ApiError> {
    require_action_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let existing = state
        .get_triage(id)
        .await
        .map_err(|_| ApiError::conflict("triage_load_failed", "Triage item could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    let triage = state
        .assign_triage(id, payload.assigned_to_user_id)
        .await
        .map_err(|_| {
            ApiError::conflict("triage_assign_failed", "Triage item could not be assigned.")
        })?
        .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;

    Ok(Json(object(triage)))
}

#[utoipa::path(
    post,
    path = "/api/v2/triage/{id}/cancel",
    operation_id = "postTriageCancel",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Triage id")),
    responses(
        (status = 200, description = "Triage item cancelled", body = ObjectResponse<TriageListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Triage item not found", body = ApiErrorResponse),
        (status = 409, description = "Triage item cannot be cancelled", body = ApiErrorResponse)
    )
)]
pub async fn cancel_triage(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<TriageListItem>>, ApiError> {
    require_action_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let existing = state
        .get_triage(id)
        .await
        .map_err(|_| ApiError::conflict("triage_load_failed", "Triage item could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    if existing.status != TriageStatus::Waiting {
        return Err(ApiError::conflict(
            "triage_cancel_invalid_status",
            "Only waiting triage entries can be cancelled.",
        ));
    }

    let triage = state
        .cancel_triage(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "triage_cancel_failed",
                "Triage item could not be cancelled.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("triage_not_found", "Triage item was not found."))?;

    Ok(Json(object(triage)))
}

#[utoipa::path(
    get,
    path = "/api/v2/encounters",
    operation_id = "getEncounters",
    tag = "care",
    security(("bearerAuth" = [])),
    params(EncounterListQuery),
    responses(
        (status = 200, description = "Encounters list", body = ListResponse<EncounterListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_encounters(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<EncounterListQuery>,
) -> Result<Json<ListResponse<EncounterListItem>>, ApiError> {
    require_workflow_list_access(&user, state.facility_id(), PermissionCode::EncounterView)?;
    if let Some(patient_id) = query.patient_id {
        let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    }
    let (cursor, page_size) = page_request(CursorListQuery {
        cursor: query.cursor,
        limit: query.limit,
    })?;
    let rows = state
        .list_encounters(query.patient_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("encounter_list_failed", "Encounters could not be loaded.")
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.started_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/encounters",
    operation_id = "postEncounters",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = CreateEncounterRequest,
    responses(
        (status = 200, description = "Encounter created", body = ObjectResponse<EncounterListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_encounter(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateEncounterRequest>,
) -> Result<Json<ObjectResponse<EncounterListItem>>, ApiError> {
    require_action_permission(&user, state.facility_id(), PermissionCode::EncounterManage)?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    if let Some(visit_id) = payload.visit_id {
        let visit = load_visit_for_access(&state, &user, visit_id).await?;
        if visit.patient_id != payload.patient_id {
            return Err(ApiError::bad_request(
                "invalid_encounter",
                "Visit does not belong to the supplied patient.",
            ));
        }
    }
    let encounter = state
        .create_encounter(
            payload.patient_id,
            payload.visit_id,
            payload.encounter_type,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("encounter_create_failed", "Encounter could not be created.")
        })?;

    Ok(Json(object(encounter)))
}

#[utoipa::path(
    get,
    path = "/api/v2/encounters/{id}",
    operation_id = "getEncounterById",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Encounter id")),
    responses(
        (status = 200, description = "Encounter detail", body = ObjectResponse<EncounterListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Encounter not found", body = ApiErrorResponse)
    )
)]
pub async fn get_encounter(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<EncounterListItem>>, ApiError> {
    let encounter =
        load_encounter_for_access(&state, &user, id, PermissionCode::EncounterView).await?;
    Ok(Json(object(encounter)))
}

#[utoipa::path(
    patch,
    path = "/api/v2/encounters/{id}",
    operation_id = "patchEncounterById",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Encounter id")),
    request_body = UpdateEncounterRequest,
    responses(
        (status = 200, description = "Encounter updated", body = ObjectResponse<EncounterListItem>),
        (status = 400, description = "Invalid encounter update", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Encounter not found", body = ApiErrorResponse),
        (status = 409, description = "Encounter update conflict", body = ApiErrorResponse)
    )
)]
pub async fn update_encounter(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateEncounterRequest>,
) -> Result<Json<ObjectResponse<EncounterListItem>>, ApiError> {
    if payload.visit_id.is_none() && payload.encounter_type.is_none() {
        return Err(ApiError::bad_request(
            "invalid_encounter_update",
            "At least one encounter field must be supplied.",
        ));
    }

    let encounter =
        load_encounter_for_access(&state, &user, id, PermissionCode::EncounterManage).await?;
    if let Some(visit_id) = payload.visit_id {
        let visit = load_visit_for_access(&state, &user, visit_id).await?;
        if visit.patient_id != encounter.patient_id {
            return Err(ApiError::bad_request(
                "invalid_encounter_update",
                "Visit does not belong to the encounter patient.",
            ));
        }
    }

    let updated = state
        .update_encounter(id, payload.visit_id, payload.encounter_type, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict("encounter_update_failed", "Encounter could not be updated.")
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "encounter_update_not_allowed",
                "Encounter could not be updated in its current state.",
            )
        })?;

    Ok(Json(object(updated)))
}

#[utoipa::path(
    post,
    path = "/api/v2/encounters/{id}/complete",
    operation_id = "postEncounterComplete",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Encounter id")),
    responses(
        (status = 200, description = "Encounter completed", body = ObjectResponse<EncounterListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Encounter not found", body = ApiErrorResponse)
    )
)]
pub async fn complete_encounter(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<EncounterListItem>>, ApiError> {
    update_encounter_with_access(&state, &user, id, EncounterStatus::Completed).await
}

#[utoipa::path(
    post,
    path = "/api/v2/encounters/{id}/cancel",
    operation_id = "postEncounterCancel",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Encounter id")),
    responses(
        (status = 200, description = "Encounter cancelled", body = ObjectResponse<EncounterListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Encounter not found", body = ApiErrorResponse)
    )
)]
pub async fn cancel_encounter(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<EncounterListItem>>, ApiError> {
    update_encounter_with_access(&state, &user, id, EncounterStatus::Cancelled).await
}

#[utoipa::path(
    get,
    path = "/api/v2/encounters/{id}/care-team",
    operation_id = "getEncounterCareTeam",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Encounter id")),
    responses(
        (status = 200, description = "Encounter care-team assignments", body = ListResponse<CareTeamAssignment>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Encounter not found", body = ApiErrorResponse)
    )
)]
pub async fn list_care_team(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ListResponse<CareTeamAssignment>>, ApiError> {
    let encounter =
        load_encounter_for_access(&state, &user, id, PermissionCode::EncounterView).await?;
    let assignments = state
        .list_care_team_assignments(encounter.id)
        .await
        .map_err(|_| {
            ApiError::conflict("care_team_list_failed", "Care team could not be loaded.")
        })?;

    Ok(Json(list(
        assignments,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: MAX_LIMIT,
        },
    )))
}

#[utoipa::path(
    post,
    path = "/api/v2/encounters/{id}/care-team",
    operation_id = "postEncounterCareTeam",
    tag = "care",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Encounter id")),
    request_body = CreateCareTeamAssignmentRequest,
    responses(
        (status = 200, description = "Care-team assignment created", body = ObjectResponse<CareTeamAssignment>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Encounter not found", body = ApiErrorResponse)
    )
)]
pub async fn create_care_team_assignment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateCareTeamAssignmentRequest>,
) -> Result<Json<ObjectResponse<CareTeamAssignment>>, ApiError> {
    let encounter =
        load_encounter_for_access(&state, &user, id, PermissionCode::EncounterManage).await?;
    let assignment = state
        .create_care_team_assignment(encounter.id, payload.user_id, payload.role, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "care_team_assign_failed",
                "Care team assignment could not be saved.",
            )
        })?;

    Ok(Json(object(assignment)))
}

async fn update_visit_with_access(
    state: &AppState,
    user: &hms_access::RequestContext,
    visit_id: Uuid,
    status: VisitStatus,
    permission: PermissionCode,
) -> Result<Json<ObjectResponse<VisitListItem>>, ApiError> {
    require_action_permission(user, state.facility_id(), permission)?;
    let _visit = load_visit_for_access(state, user, visit_id).await?;
    let updated = state
        .update_visit_status(visit_id, status)
        .await
        .map_err(|_| ApiError::conflict("visit_update_failed", "Visit could not be updated."))?
        .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;

    Ok(Json(object(updated)))
}

async fn update_encounter_with_access(
    state: &AppState,
    user: &hms_access::RequestContext,
    encounter_id: Uuid,
    status: EncounterStatus,
) -> Result<Json<ObjectResponse<EncounterListItem>>, ApiError> {
    let _encounter =
        load_encounter_for_access(state, user, encounter_id, PermissionCode::EncounterManage)
            .await?;
    let updated = state
        .update_encounter_status(encounter_id, status)
        .await
        .map_err(|_| {
            ApiError::conflict("encounter_update_failed", "Encounter could not be updated.")
        })?
        .ok_or_else(|| ApiError::not_found("encounter_not_found", "Encounter was not found."))?;

    Ok(Json(object(updated)))
}

async fn load_visit_for_access(
    state: &AppState,
    user: &hms_access::RequestContext,
    visit_id: Uuid,
) -> Result<VisitListItem, ApiError> {
    let visit = state
        .get_visit(visit_id)
        .await
        .map_err(|_| ApiError::conflict("visit_load_failed", "Visit could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;
    let _patient = load_patient_for_access(state, user, visit.patient_id).await?;
    Ok(visit)
}

async fn load_encounter_for_access(
    state: &AppState,
    user: &hms_access::RequestContext,
    encounter_id: Uuid,
    permission: PermissionCode,
) -> Result<EncounterListItem, ApiError> {
    require_action_permission(user, state.facility_id(), permission)?;
    let encounter = state
        .get_encounter(encounter_id)
        .await
        .map_err(|_| ApiError::conflict("encounter_load_failed", "Encounter could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("encounter_not_found", "Encounter was not found."))?;
    let _patient = load_patient_for_access(state, user, encounter.patient_id).await?;
    Ok(encounter)
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

fn require_workflow_list_access(
    user: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(user, facility_id, permission).map_err(|error| {
        match error {
            hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to patient workflow lists.",
            ),
            other => ApiError::from(other),
        }
    })
}

fn require_action_permission(
    user: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(user, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })
}

fn page_request(query: CursorListQuery) -> Result<(Option<CareCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| CareCursor { occurred_at, id },
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
