use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::{
    can_create_patient, can_update_patient, require_patient_demographics_access, require_permission,
};
use hms_db::patients::{PatientContextCursor, PatientCursor};
use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::clinical::PatientChronicleSummary;
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::{
    CreatePatientRequest, PatientContextListItem, PatientDetail, PatientListItem, PatientListQuery,
    PatientRecord, UpdatePatientRequest,
};
use serde_json::json;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
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
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<PatientListQuery>,
) -> Result<Json<ListResponse<PatientListItem>>, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let search = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let cursor_value = query
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let cursor = cursor_value.map(decode_cursor).transpose()?;

    require_permission(&user, PermissionCode::PatientDemographicsView).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to the patient registry.",
        )
    })?;

    let page_size = limit as usize;
    let patients = state
        .list_patients(cursor, page_size as i64 + 1, search)
        .await
        .map_err(|_| ApiError::conflict("patient_list_failed", "Patients could not be loaded."))?;

    let mut visible = Vec::with_capacity(patients.len());
    for patient in patients {
        if require_patient_demographics_access(&user, &patient).is_err() {
            continue;
        }
        visible.push(patient);
    }

    let mut page = visible;
    let has_next = page.len() > page_size;
    if has_next {
        page.truncate(page_size);
    }
    let next_cursor = if has_next {
        page.last().map(encode_cursor)
    } else {
        None
    };

    Ok(Json(list(
        page.iter().map(PatientListItem::from).collect(),
        PageInfo {
            next_cursor,
            has_next,
            limit,
        },
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
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<PatientListQuery>,
) -> Result<Json<ListResponse<PatientContextListItem>>, ApiError> {
    let limit = query.limit.unwrap_or(10).clamp(1, MAX_LIMIT);
    require_permission(&user, PermissionCode::PatientDemographicsView).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient context lists.",
        )
    })?;
    if !user
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics)
    {
        return Err(ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient context lists.",
        ));
    }

    let cursor_value = query
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let cursor = cursor_value.map(decode_context_cursor).transpose()?;
    let page_size = limit as usize;
    let patients = state
        .list_context_patients(user.id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "patient_context_list_failed",
                "Context patients could not be loaded.",
            )
        })?;

    let mut page = patients;
    let has_next = page.len() > page_size;
    if has_next {
        page.truncate(page_size);
    }
    let next_cursor = if has_next {
        page.last().map(encode_context_cursor)
    } else {
        None
    };

    Ok(Json(list(
        page,
        PageInfo {
            next_cursor,
            has_next,
            limit,
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    user: AuthUser,
    id: Uuid,
) -> Result<Json<ObjectResponse<PatientChronicleSummary>>, ApiError> {
    require_chronicle_read_access(&user).map_err(|_| {
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

fn require_chronicle_read_access(user: &AuthUser) -> Result<(), hms_access::AccessError> {
    require_permission(user, PermissionCode::PatientDemographicsView)?;
    require_permission(user, PermissionCode::ClinicalDocumentationView)?;
    if user
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics)
    {
        Ok(())
    } else {
        Err(hms_access::AccessError::PatientAccessDenied)
    }
}

fn encode_cursor(patient: &PatientRecord) -> String {
    format!("{}:{}", patient.created_at.timestamp_micros(), patient.id)
}

fn encode_context_cursor(patient: &PatientContextListItem) -> String {
    format!("{}:{}", patient.updated_at.timestamp_micros(), patient.id)
}

fn decode_cursor(value: &str) -> Result<PatientCursor, ApiError> {
    let (micros, id) = value
        .split_once(':')
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let created_at = DateTime::<Utc>::from_timestamp_micros(micros)
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let id = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;

    Ok(PatientCursor { created_at, id })
}

fn decode_context_cursor(value: &str) -> Result<PatientContextCursor, ApiError> {
    let (micros, patient_id) = value
        .split_once(':')
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let updated_at = DateTime::<Utc>::from_timestamp_micros(micros)
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let patient_id = patient_id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;

    Ok(PatientContextCursor {
        updated_at,
        patient_id,
    })
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
