use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::care::{
    AppointmentListGetQuery, AppointmentListItem, AppointmentListQuery, AppointmentTypeListItem,
    CancelAppointmentRequest, CareAreaMyWorkResponse, CareTeamAssignment, CheckInVisitRequest,
    ClinicListItem, CreateAppointmentRequest, CreateCareTeamAssignmentRequest, CreateClinicRequest,
    CreateEncounterRequest, CreateTriageRequest, CursorListQuery, EmergencyIntakeRequest,
    EmergencyIntakeResponse, EncounterListGetQuery, EncounterListItem, EncounterListQuery,
    InpatientIntakeRequest, InpatientIntakeResponse, OutpatientIntakeRequest,
    OutpatientIntakeResponse, TriageAssessmentRequest, TriageListItem, TriageListQuery,
    UpdateAppointmentRequest, UpdateClinicRequest, UpdateEncounterRequest, VisitListItem,
    VisitListQuery,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/care-areas/my-work",
    operation_id = "getCareAreaMyWork",
    tag = "care",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Scoped care-area work summary", body = ObjectResponse<CareAreaMyWorkResponse>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn my_work(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ObjectResponse<CareAreaMyWorkResponse>>, ApiError> {
    Ok(Json(state.care_service().my_work(&user).await?))
}

#[utoipa::path(
    post,
    path = "/api/v2/care-areas/outpatient/intake",
    operation_id = "postOutpatientIntake",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = OutpatientIntakeRequest,
    responses(
        (status = 200, description = "Outpatient intake context", body = ObjectResponse<OutpatientIntakeResponse>),
        (status = 400, description = "Invalid intake request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 409, description = "Patient cannot be used for intake", body = ApiErrorResponse)
    )
)]
pub async fn outpatient_intake(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<OutpatientIntakeRequest>,
) -> Result<Json<ObjectResponse<OutpatientIntakeResponse>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .outpatient_intake(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/care-areas/inpatient/intake",
    operation_id = "postInpatientIntake",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = InpatientIntakeRequest,
    responses(
        (status = 200, description = "Inpatient intake context", body = ObjectResponse<InpatientIntakeResponse>),
        (status = 400, description = "Invalid intake request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 409, description = "Patient cannot be used for intake", body = ApiErrorResponse)
    )
)]
pub async fn inpatient_intake(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<InpatientIntakeRequest>,
) -> Result<Json<ObjectResponse<InpatientIntakeResponse>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .inpatient_intake(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/care-areas/emergency/intake",
    operation_id = "postEmergencyIntake",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = EmergencyIntakeRequest,
    responses(
        (status = 200, description = "Emergency intake context", body = ObjectResponse<EmergencyIntakeResponse>),
        (status = 400, description = "Invalid intake request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 409, description = "Patient cannot be used for intake", body = ApiErrorResponse)
    )
)]
pub async fn emergency_intake(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<EmergencyIntakeRequest>,
) -> Result<Json<ObjectResponse<EmergencyIntakeResponse>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .emergency_intake(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/appointments",
    operation_id = "getAppointments",
    tag = "care",
    security(("bearerAuth" = [])),
    params(AppointmentListGetQuery),
    responses(
        (status = 200, description = "Appointments list", body = ListResponse<AppointmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_appointments(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<AppointmentListGetQuery>,
) -> Result<Json<ListResponse<AppointmentListItem>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .list_appointments(&user, query.into())
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/appointments/search",
    operation_id = "postAppointmentsSearch",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = AppointmentListQuery,
    responses(
        (status = 200, description = "Appointments search", body = ListResponse<AppointmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn search_appointments(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(query): Json<AppointmentListQuery>,
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
    path = "/api/v2/appointment-types",
    operation_id = "getAppointmentTypes",
    tag = "care",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Appointment types list", body = ListResponse<AppointmentTypeListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_appointment_types(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<AppointmentTypeListItem>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .list_appointment_types(&user, query)
            .await?,
    ))
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
    request_body = CancelAppointmentRequest,
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
    Json(payload): Json<CancelAppointmentRequest>,
) -> Result<Json<ObjectResponse<AppointmentListItem>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .cancel_appointment(&user, id, payload)
            .await?,
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
    Ok(Json(state.care_service().list_visits(&user, query).await?))
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
    Ok(Json(state.care_service().get_visit(&user, id).await?))
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
    Ok(Json(
        state.care_service().check_in_visit(&user, payload).await?,
    ))
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
    Ok(Json(state.care_service().call_visit(&user, id).await?))
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
    Ok(Json(
        state
            .care_service()
            .start_visit_consultation(&user, id)
            .await?,
    ))
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
    Ok(Json(state.care_service().hold_visit(&user, id).await?))
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
    Ok(Json(
        state.care_service().ready_checkout_visit(&user, id).await?,
    ))
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
    Ok(Json(state.care_service().checkout_visit(&user, id).await?))
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
    Ok(Json(state.care_service().no_show_visit(&user, id).await?))
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
    Ok(Json(state.care_service().list_triage(&user, query).await?))
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
    Ok(Json(
        state.care_service().create_triage(&user, payload).await?,
    ))
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
    Ok(Json(state.care_service().get_triage(&user, id).await?))
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
    Json(payload): Json<TriageAssessmentRequest>,
) -> Result<Json<ObjectResponse<TriageListItem>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .assess_triage(&user, id, payload)
            .await?,
    ))
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
    Ok(Json(
        state
            .care_service()
            .assign_triage(&user, id, payload)
            .await?,
    ))
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
    Ok(Json(state.care_service().cancel_triage(&user, id).await?))
}

#[utoipa::path(
    get,
    path = "/api/v2/encounters",
    operation_id = "getEncounters",
    tag = "care",
    security(("bearerAuth" = [])),
    params(EncounterListGetQuery),
    responses(
        (status = 200, description = "Encounters list", body = ListResponse<EncounterListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_encounters(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<EncounterListGetQuery>,
) -> Result<Json<ListResponse<EncounterListItem>>, ApiError> {
    Ok(Json(
        state
            .care_service()
            .list_encounters(&user, query.into())
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/encounters/search",
    operation_id = "postEncountersSearch",
    tag = "care",
    security(("bearerAuth" = [])),
    request_body = EncounterListQuery,
    responses(
        (status = 200, description = "Encounters search", body = ListResponse<EncounterListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn search_encounters(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(query): Json<EncounterListQuery>,
) -> Result<Json<ListResponse<EncounterListItem>>, ApiError> {
    Ok(Json(
        state.care_service().list_encounters(&user, query).await?,
    ))
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
    Ok(Json(
        state
            .care_service()
            .create_encounter(&user, payload)
            .await?,
    ))
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
    Ok(Json(state.care_service().get_encounter(&user, id).await?))
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
    Ok(Json(
        state
            .care_service()
            .update_encounter(&user, id, payload)
            .await?,
    ))
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
    Ok(Json(
        state.care_service().complete_encounter(&user, id).await?,
    ))
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
    Ok(Json(
        state.care_service().cancel_encounter(&user, id).await?,
    ))
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
    Ok(Json(state.care_service().list_care_team(&user, id).await?))
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
    Ok(Json(
        state
            .care_service()
            .create_care_team_assignment(&user, id, payload)
            .await?,
    ))
}
