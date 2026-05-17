use axum::extract::{Path, Query, State};
use axum::Json;
use hms_access::{
    can_create_patient, can_update_patient, require_patient_demographics_access, require_permission,
};
use hms_db::patients::{PatientContextCursor, PatientCursor};
use hms_domain::clinical::PatientChronicleSummary;
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::{
    CreatePatientRequest, PatientContextListItem, PatientDetail, PatientListItem, PatientListQuery,
    PatientRegistrationValidationRule, UpdatePatientRequest,
};
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::middleware::request_id::current_request_id;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const CHRONICLE_SUMMARY_LIMIT: i64 = 25;

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
    let search = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let page_request = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |created_at, id| PatientCursor { created_at, id },
    )?;

    require_permission(&user, PermissionCode::PatientDemographicsView).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to the patient registry.",
        )
    })?;

    let patients = state
        .list_patients(
            page_request.cursor,
            i64::from(page_request.limit) + 1,
            search,
            query.status,
        )
        .await
        .map_err(|_| ApiError::conflict("patient_list_failed", "Patients could not be loaded."))?;

    let mut visible = Vec::with_capacity(patients.len());
    for patient in patients {
        if require_patient_demographics_access(&user, &patient).is_err() {
            continue;
        }
        visible.push(patient);
    }

    let page = cursor_list::page_response(visible, page_request.limit, |patient| {
        cursor_list::encode_cursor(patient.created_at, patient.id)
    });

    Ok(Json(list(
        page.data.iter().map(PatientListItem::from).collect(),
        page.page,
    )))
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
    hms_access::require_patient_workflow_access(
        &user,
        state.facility_id(),
        PermissionCode::PatientDemographicsView,
    )
    .map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient context lists.",
        )
    })?;

    let page_request = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        10,
        MAX_LIMIT,
        |updated_at, patient_id| PatientContextCursor {
            updated_at,
            patient_id,
        },
    )?;
    let patients = state
        .list_context_patients(
            user.id,
            page_request.cursor,
            i64::from(page_request.limit) + 1,
            hms_db::patients::PatientContextFilters {
                patient_id: query.patient_id,
                search: query.search.clone(),
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_context_list_failed",
                "Context patients could not be loaded.",
            )
        })?;

    Ok(Json(cursor_list::page_response(
        patients,
        page_request.limit,
        |patient| cursor_list::encode_cursor(patient.updated_at, patient.id),
    )))
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
    hms_access::require_any_facility_permission(
        &user,
        state.facility_id(),
        &[PermissionCode::PatientCreate, PermissionCode::PatientUpdate],
    )
    .map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to use patient registration rules.",
        )
    })?;

    let rules = state
        .list_patient_registration_validation_rules()
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_validation_rules_failed",
                "Patient validation rules could not be loaded.",
            )
        })?;

    Ok(Json(list(
        rules,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: 50,
        },
    )))
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
    can_create_patient(&user, state.facility_id()).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to register patients.",
        )
    })?;

    let first_name = normalize_name(payload.first_name, "first_name")?;
    let last_name = normalize_name(payload.last_name, "last_name")?;
    let patient = state
        .create_patient(first_name, last_name, payload.date_of_birth, payload.sex)
        .await
        .map_err(|_| {
            ApiError::conflict("patient_create_failed", "Patient could not be created.")
        })?;

    Ok(Json(object(PatientDetail::from(&patient))))
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
    let patient = state
        .get_patient(id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    require_patient_demographics_access(&user, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;

    Ok(Json(object(PatientDetail::from(&patient))))
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
    patient_chronicle_response(state, user, id).await
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
    patient_chronicle_response(state, user, id).await
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
    let existing = state
        .get_patient(id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    can_update_patient(&user, &existing).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have permission to update this patient.",
        )
    })?;

    if payload.first_name.is_none()
        && payload.last_name.is_none()
        && payload.date_of_birth.is_none()
        && payload.sex.is_none()
        && payload.status.is_none()
    {
        return Err(ApiError::bad_request(
            "invalid_patient_update",
            "At least one patient field must be supplied.",
        ));
    }

    let first_name = payload
        .first_name
        .map(|value| normalize_name(value, "first_name"))
        .transpose()?;
    let last_name = payload
        .last_name
        .map(|value| normalize_name(value, "last_name"))
        .transpose()?;

    let patient = state
        .update_patient(
            id,
            first_name,
            last_name,
            payload.date_of_birth,
            payload.sex,
            payload.status,
            user.id,
            Some(current_request_id()),
        )
        .await
        .map_err(|_| ApiError::conflict("patient_update_failed", "Patient could not be updated."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    require_patient_demographics_access(&user, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;

    Ok(Json(object(PatientDetail::from(&patient))))
}

async fn patient_chronicle_response(
    state: AppState,
    user: hms_access::RequestContext,
    id: Uuid,
) -> Result<Json<ObjectResponse<PatientChronicleSummary>>, ApiError> {
    hms_access::require_chronicle_read_access(&user).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient Chronicle.",
        )
    })?;

    let patient = state
        .get_patient(id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;
    require_patient_demographics_access(&user, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient Chronicle.",
        )
    })?;

    let summary = state
        .patient_chronicle_summary(id, CHRONICLE_SUMMARY_LIMIT)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_chronicle_load_failed",
                "Patient Chronicle could not be loaded.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;

    Ok(Json(object(summary)))
}

fn normalize_name(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        let mut error = ApiError::bad_request("invalid_patient", "Patient request is invalid.");
        error.details = json!({ field: ["This field is required."] });
        return Err(error);
    }
    Ok(value.to_owned())
}
