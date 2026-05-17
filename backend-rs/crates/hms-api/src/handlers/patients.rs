use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::clinical::PatientChronicleSummary;
use hms_domain::patients::{
    CreatePatientRequest, PatientContextListItem, PatientDetail, PatientListItem, PatientListQuery,
    PatientRegistrationValidationRule, UpdatePatientRequest,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/patients",
    operation_id = "getPatients",
    tag = "patients",
    security(("bearerAuth" = [])),
    params(PatientListQuery),
    responses(
        (status = 200, description = "Patient registry list", body = ListResponse<PatientListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse)
    )
)]
pub async fn list_patients(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<PatientListQuery>,
) -> Result<Json<ListResponse<PatientListItem>>, ApiError> {
    Ok(Json(
        state.patients_service().list_patients(&user, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/context",
    operation_id = "getPatientContextList",
    tag = "patients",
    security(("bearerAuth" = [])),
    params(PatientListQuery),
    responses(
        (status = 200, description = "Current user's context patients", body = ListResponse<PatientContextListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse)
    )
)]
pub async fn list_context_patients(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<PatientListQuery>,
) -> Result<Json<ListResponse<PatientContextListItem>>, ApiError> {
    Ok(Json(
        state
            .patients_service()
            .list_context_patients(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/validation-rules",
    operation_id = "getPatientValidationRules",
    tag = "patients",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Patient registration validation rules", body = ListResponse<PatientRegistrationValidationRule>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_patient_validation_rules(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ListResponse<PatientRegistrationValidationRule>>, ApiError> {
    Ok(Json(
        state
            .patients_service()
            .list_patient_validation_rules(&user)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/patients",
    operation_id = "postPatients",
    tag = "patients",
    security(("bearerAuth" = [])),
    request_body = CreatePatientRequest,
    responses(
        (status = 200, description = "Patient created", body = ObjectResponse<PatientDetail>),
        (status = 400, description = "Invalid patient request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_patient(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreatePatientRequest>,
) -> Result<Json<ObjectResponse<PatientDetail>>, ApiError> {
    Ok(Json(
        state
            .patients_service()
            .create_patient(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{id}",
    operation_id = "getPatientById",
    tag = "patients",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Patient id")),
    responses(
        (status = 200, description = "Patient detail", body = ObjectResponse<PatientDetail>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn get_patient(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PatientDetail>>, ApiError> {
    Ok(Json(state.patients_service().get_patient(&user, id).await?))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{id}/chronicle",
    operation_id = "getPatientChronicle",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Patient id")),
    responses(
        (status = 200, description = "Patient Chronicle summary", body = ObjectResponse<PatientChronicleSummary>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn get_patient_chronicle(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PatientChronicleSummary>>, ApiError> {
    Ok(Json(
        state
            .patients_service()
            .get_patient_chronicle(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/patients/{id}/chronicle/print",
    operation_id = "getPatientChroniclePrint",
    tag = "clinical",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Patient id")),
    responses(
        (status = 200, description = "Printable Patient Chronicle summary", body = ObjectResponse<PatientChronicleSummary>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn get_patient_chronicle_print(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PatientChronicleSummary>>, ApiError> {
    Ok(Json(
        state
            .patients_service()
            .get_patient_chronicle(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/patients/{id}",
    operation_id = "patchPatientById",
    tag = "patients",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Patient id")),
    request_body = UpdatePatientRequest,
    responses(
        (status = 200, description = "Patient updated", body = ObjectResponse<PatientDetail>),
        (status = 400, description = "Invalid patient request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn update_patient(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdatePatientRequest>,
) -> Result<Json<ObjectResponse<PatientDetail>>, ApiError> {
    Ok(Json(
        state
            .patients_service()
            .update_patient(&user, id, payload)
            .await?,
    ))
}
