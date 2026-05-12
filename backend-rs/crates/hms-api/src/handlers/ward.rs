use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::{require_patient_demographics_access, require_permission};
use hms_db::ward::{AdmissionContext, WardCursor};
use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use hms_domain::ward::{
    AdministerMedicationRequest, AdmissionCaseListItem, AdmitPatientRequest, BedListItem,
    CreateAdmissionCaseRequest, CreateBedRequest, CreateDischargeRequest,
    CreateFluidBalanceEntryRequest, CreateHandoffRequest, CreateMonitoringEventRequest,
    CreateNursingAlertRequest, CreateNursingTaskRequest, CreatePatientVitalsRequest,
    CreateTreatmentSheetRequest, CreateWardSectionRequest, CreateWardStockRequestRequest,
    DischargeCaseListItem, FluidBalanceListItem, HandoffListItem, MedicationAdministrationListItem,
    MonitoringEventListItem, NursingAlertListItem, NursingTaskListItem, PatientVitalsListItem,
    ReserveAdmissionBedRequest, ScheduleMedicationAdministrationRequest, TreatmentSheetListItem,
    WardBoardItem, WardBoardQuery, WardListItem, WardSectionListItem, WardStockRequestListItem,
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
    path = "/api/v2/wards",
    operation_id = "getWards",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Wards list", body = ListResponse<WardListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_wards(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<WardListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::WardView)?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_wards(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("ward_list_failed", "Wards could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/{id}",
    operation_id = "getWardById",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward id")),
    responses(
        (status = 200, description = "Ward detail", body = ObjectResponse<WardListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse)
    )
)]
pub async fn get_ward(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::WardView)?;
    let ward = load_ward(&state, id).await?;
    Ok(Json(object(ward)))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/{id}/sections",
    operation_id = "getWardSections",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(CursorListQuery, ("id" = Uuid, Path, description = "Ward id")),
    responses(
        (status = 200, description = "Ward sections", body = ListResponse<WardSectionListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse)
    )
)]
pub async fn list_ward_sections(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<WardSectionListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::WardView)?;
    let _ward = load_ward(&state, id).await?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_ward_sections(id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("ward_sections_failed", "Ward sections could not be loaded.")
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/wards/{id}/sections",
    operation_id = "postWardSection",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward id")),
    request_body = CreateWardSectionRequest,
    responses(
        (status = 200, description = "Ward section created", body = ObjectResponse<WardSectionListItem>),
        (status = 400, description = "Invalid section", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse)
    )
)]
pub async fn create_ward_section(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateWardSectionRequest>,
) -> Result<Json<ObjectResponse<WardSectionListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::WardManageBeds)?;
    let _ward = load_ward(&state, id).await?;
    let code = payload.code.trim();
    let name = payload.name.trim();
    if code.is_empty() || name.is_empty() {
        return Err(ApiError::bad_request(
            "invalid_ward_section",
            "Section code and name are required.",
        ));
    }

    let section = state
        .create_ward_section(id, code.to_owned(), name.to_owned(), user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_section_create_failed",
                "Ward section could not be created.",
            )
        })?;

    Ok(Json(object(section)))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/{id}/beds",
    operation_id = "getWardBeds",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(CursorListQuery, ("id" = Uuid, Path, description = "Ward id")),
    responses(
        (status = 200, description = "Ward beds", body = ListResponse<BedListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse)
    )
)]
pub async fn list_ward_beds(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<BedListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::WardView)?;
    let _ward = load_ward(&state, id).await?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_ward_beds(id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("ward_beds_failed", "Ward beds could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/wards/{id}/beds",
    operation_id = "postWardBed",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward id")),
    request_body = CreateBedRequest,
    responses(
        (status = 200, description = "Ward bed created", body = ObjectResponse<BedListItem>),
        (status = 400, description = "Invalid bed", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse)
    )
)]
pub async fn create_bed(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateBedRequest>,
) -> Result<Json<ObjectResponse<BedListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::WardManageBeds)?;
    let _ward = load_ward(&state, id).await?;
    let bed_code = payload.bed_code.trim();
    if bed_code.is_empty() {
        return Err(ApiError::bad_request(
            "invalid_bed",
            "Bed code is required.",
        ));
    }

    let bed = state
        .create_bed(id, payload.section_id, bed_code.to_owned(), user.id)
        .await
        .map_err(|_| ApiError::conflict("bed_create_failed", "Bed could not be created."))?;

    Ok(Json(object(bed)))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/board",
    operation_id = "getWardBoard",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(WardBoardQuery),
    responses(
        (status = 200, description = "Ward board", body = ListResponse<WardBoardItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn ward_board(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<WardBoardQuery>,
) -> Result<Json<ListResponse<WardBoardItem>>, ApiError> {
    require_patient_workflow_access(&user, state.facility_id(), PermissionCode::WardView)?;
    let (cursor, page_size) = page_request(CursorListQuery {
        cursor: query.cursor,
        limit: query.limit,
    })?;
    let rows = state
        .list_ward_board(query.ward_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("ward_board_failed", "Ward board could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.admitted_at, item.admission_id)
    })))
}

#[utoipa::path(
    get,
    path = "/api/v2/admissions/cases",
    operation_id = "getAdmissionCases",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Admission cases", body = ListResponse<AdmissionCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_admission_cases(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<AdmissionCaseListItem>>, ApiError> {
    require_patient_workflow_access(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_admission_cases(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_list_failed",
                "Admission cases could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/admissions/cases",
    operation_id = "postAdmissionCase",
    tag = "wards",
    security(("bearerAuth" = [])),
    request_body = CreateAdmissionCaseRequest,
    responses(
        (status = 200, description = "Admission case created", body = ObjectResponse<AdmissionCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Patient or ward not found", body = ApiErrorResponse)
    )
)]
pub async fn create_admission_case(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateAdmissionCaseRequest>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let _ward = load_ward(&state, payload.ward_id).await?;
    let admission_case = state
        .create_admission_case(payload.patient_id, payload.ward_id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_create_failed",
                "Admission case could not be created.",
            )
        })?;

    Ok(Json(object(admission_case)))
}

#[utoipa::path(
    post,
    path = "/api/v2/admissions/cases/{id}/reserve-bed",
    operation_id = "postAdmissionCaseReserveBed",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Admission case id")),
    request_body = ReserveAdmissionBedRequest,
    responses(
        (status = 200, description = "Admission bed reserved", body = ObjectResponse<AdmissionCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission case not found", body = ApiErrorResponse),
        (status = 409, description = "Reservation failed", body = ApiErrorResponse)
    )
)]
pub async fn reserve_admission_bed(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<ReserveAdmissionBedRequest>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let _existing = load_admission_case_for_access(&state, &user, id).await?;
    let admission_case = state
        .reserve_admission_bed(id, payload.bed_id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_reserve_failed",
                "Admission bed could not be reserved.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "admission_case_reserve_failed",
                "Admission bed could not be reserved.",
            )
        })?;

    Ok(Json(object(admission_case)))
}

#[utoipa::path(
    post,
    path = "/api/v2/admissions/cases/{id}/activate",
    operation_id = "postAdmissionCaseActivate",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Admission case id")),
    responses(
        (status = 200, description = "Admission case activated", body = ObjectResponse<AdmissionCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission case not found", body = ApiErrorResponse),
        (status = 409, description = "Activation failed", body = ApiErrorResponse)
    )
)]
pub async fn activate_admission_case(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let _existing = load_admission_case_for_access(&state, &user, id).await?;
    let admission_case = state
        .activate_admission_case(id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_activate_failed",
                "Admission case could not be activated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "admission_case_activate_failed",
                "Admission case could not be activated.",
            )
        })?;

    Ok(Json(object(admission_case)))
}

#[utoipa::path(
    post,
    path = "/api/v2/admissions/cases/{id}/cancel",
    operation_id = "postAdmissionCaseCancel",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Admission case id")),
    responses(
        (status = 200, description = "Admission case cancelled", body = ObjectResponse<AdmissionCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission case not found", body = ApiErrorResponse),
        (status = 409, description = "Cancellation failed", body = ApiErrorResponse)
    )
)]
pub async fn cancel_admission_case(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let _existing = load_admission_case_for_access(&state, &user, id).await?;
    let admission_case = state
        .cancel_admission_case(id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_cancel_failed",
                "Admission case could not be cancelled.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "admission_case_cancel_failed",
                "Admission case could not be cancelled.",
            )
        })?;

    Ok(Json(object(admission_case)))
}

#[utoipa::path(
    post,
    path = "/api/v2/admissions",
    operation_id = "postAdmissions",
    tag = "wards",
    security(("bearerAuth" = [])),
    request_body = AdmitPatientRequest,
    responses(
        (status = 200, description = "Admission created", body = ObjectResponse<WardBoardItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn admit_patient(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<AdmitPatientRequest>,
) -> Result<Json<ObjectResponse<WardBoardItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let admission = state
        .admit_patient(payload.patient_id, payload.ward_id, payload.bed_id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict("admission_create_failed", "Admission could not be created.")
        })?;

    Ok(Json(object(admission)))
}

#[utoipa::path(
    get,
    path = "/api/v2/discharges",
    operation_id = "getDischarges",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Discharge cases", body = ListResponse<DischargeCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_discharges(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<DischargeCaseListItem>>, ApiError> {
    require_patient_workflow_access(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_discharge_cases(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("discharge_list_failed", "Discharges could not be loaded.")
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.requested_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/discharges",
    operation_id = "postDischarges",
    tag = "wards",
    security(("bearerAuth" = [])),
    request_body = CreateDischargeRequest,
    responses(
        (status = 200, description = "Discharge requested", body = ObjectResponse<DischargeCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn request_discharge(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateDischargeRequest>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let admission = load_admission_for_access(&state, &user, payload.admission_case_id).await?;
    let discharge = state
        .request_discharge(&admission, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "discharge_create_failed",
                "Discharge could not be requested.",
            )
        })?;

    Ok(Json(object(discharge)))
}

#[utoipa::path(
    post,
    path = "/api/v2/discharges/{id}/complete",
    operation_id = "postDischargeComplete",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Discharge case id")),
    responses(
        (status = 200, description = "Discharge completed", body = ObjectResponse<DischargeCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Discharge not found", body = ApiErrorResponse)
    )
)]
pub async fn complete_discharge(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    require_facility_permission(&user, state.facility_id(), PermissionCode::AdmissionManage)?;
    let existing = state
        .get_discharge_case(id)
        .await
        .map_err(|_| ApiError::conflict("discharge_load_failed", "Discharge could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("discharge_not_found", "Discharge was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    let discharge = state
        .complete_discharge(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "discharge_complete_failed",
                "Discharge could not be completed.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("discharge_not_found", "Discharge was not found."))?;

    Ok(Json(object(discharge)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/tasks",
    operation_id = "getNursingTasks",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Nursing tasks", body = ListResponse<NursingTaskListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_nursing_tasks(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<NursingTaskListItem>>, ApiError> {
    require_patient_workflow_access(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_nursing_tasks(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nursing_task_list_failed",
                "Nursing tasks could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.due_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/tasks",
    operation_id = "postNursingTasks",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = CreateNursingTaskRequest,
    responses(
        (status = 200, description = "Nursing task created", body = ObjectResponse<NursingTaskListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn create_nursing_task(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateNursingTaskRequest>,
) -> Result<Json<ObjectResponse<NursingTaskListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let admission = load_admission_for_access(&state, &user, payload.admission_case_id).await?;
    let task = state
        .create_nursing_task(
            &admission,
            payload.task_type,
            payload.due_at,
            payload.assigned_to_user_id,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nursing_task_create_failed",
                "Nursing task could not be created.",
            )
        })?;

    Ok(Json(object(task)))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/tasks/{id}/complete",
    operation_id = "postNursingTaskComplete",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Nursing task id")),
    responses(
        (status = 200, description = "Nursing task completed", body = ObjectResponse<NursingTaskListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Nursing task not found", body = ApiErrorResponse)
    )
)]
pub async fn complete_nursing_task(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NursingTaskListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let existing = state
        .get_nursing_task(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nursing_task_load_failed",
                "Nursing task could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("nursing_task_not_found", "Nursing task was not found.")
        })?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    let task = state
        .complete_nursing_task(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nursing_task_complete_failed",
                "Nursing task could not be completed.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("nursing_task_not_found", "Nursing task was not found.")
        })?;

    Ok(Json(object(task)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/medication-administrations",
    operation_id = "getMedicationAdministrations",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Medication administration list", body = ListResponse<MedicationAdministrationListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_medication_administrations(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<MedicationAdministrationListItem>>, ApiError> {
    require_patient_workflow_access(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_medication_administrations(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "med_admin_list_failed",
                "Medication administrations could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.scheduled_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/medication-administrations",
    operation_id = "postMedicationAdministrations",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = ScheduleMedicationAdministrationRequest,
    responses(
        (status = 200, description = "Medication administration scheduled", body = ObjectResponse<MedicationAdministrationListItem>),
        (status = 400, description = "Invalid medication administration request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn schedule_medication_administration(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<ScheduleMedicationAdministrationRequest>,
) -> Result<Json<ObjectResponse<MedicationAdministrationListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let admission = load_admission_for_access(&state, &user, payload.admission_case_id).await?;
    let medication_name = required_text(payload.medication_name, "medication_name")?;
    let medication = state
        .schedule_medication_administration(
            &admission,
            medication_name,
            payload.scheduled_at,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "med_admin_create_failed",
                "Medication administration could not be scheduled.",
            )
        })?;

    Ok(Json(object(medication)))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/medication-administrations/{id}/administer",
    operation_id = "postMedicationAdministrationAdminister",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Medication administration id")),
    request_body = AdministerMedicationRequest,
    responses(
        (status = 200, description = "Medication administered", body = ObjectResponse<MedicationAdministrationListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Medication administration not found", body = ApiErrorResponse)
    )
)]
pub async fn administer_medication(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<AdministerMedicationRequest>,
) -> Result<Json<ObjectResponse<MedicationAdministrationListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let existing = state
        .get_medication_administration(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "med_admin_load_failed",
                "Medication administration could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "med_admin_not_found",
                "Medication administration was not found.",
            )
        })?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    let medication = state
        .administer_medication(id, user.id, payload.witness_user_id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "med_admin_update_failed",
                "Medication administration could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "med_admin_not_found",
                "Medication administration was not found.",
            )
        })?;

    Ok(Json(object(medication)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/handoffs",
    operation_id = "getHandoffs",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Handoffs", body = ListResponse<HandoffListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_handoffs(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<HandoffListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_handoffs(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("handoff_list_failed", "Handoffs could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/handoffs",
    operation_id = "postHandoffs",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = CreateHandoffRequest,
    responses(
        (status = 200, description = "Handoff created", body = ObjectResponse<HandoffListItem>),
        (status = 400, description = "Invalid handoff request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn create_handoff(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateHandoffRequest>,
) -> Result<Json<ObjectResponse<HandoffListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let shift_label = required_text(payload.shift_label, "shift_label")?;
    let handoff = state
        .create_handoff(payload.ward_id, payload.to_user_id, shift_label, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict("handoff_create_failed", "Handoff could not be created.")
        })?;

    Ok(Json(object(handoff)))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/handoffs/{id}/complete",
    operation_id = "postHandoffComplete",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Handoff id")),
    responses(
        (status = 200, description = "Handoff completed", body = ObjectResponse<HandoffListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Handoff not found", body = ApiErrorResponse)
    )
)]
pub async fn complete_handoff(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<HandoffListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    state
        .get_handoff(id)
        .await
        .map_err(|_| ApiError::conflict("handoff_load_failed", "Handoff could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("handoff_not_found", "Handoff was not found."))?;
    let handoff = state
        .complete_handoff(id)
        .await
        .map_err(|_| {
            ApiError::conflict("handoff_complete_failed", "Handoff could not be completed.")
        })?
        .ok_or_else(|| ApiError::not_found("handoff_not_found", "Handoff was not found."))?;

    Ok(Json(object(handoff)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/treatment-sheets",
    operation_id = "getTreatmentSheets",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Treatment sheets", body = ListResponse<TreatmentSheetListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_treatment_sheets(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<TreatmentSheetListItem>>, ApiError> {
    require_patient_workflow_access(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_treatment_sheets(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "treatment_sheet_list_failed",
                "Treatment sheets could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.updated_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/treatment-sheets",
    operation_id = "postTreatmentSheets",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = CreateTreatmentSheetRequest,
    responses(
        (status = 200, description = "Treatment sheet created", body = ObjectResponse<TreatmentSheetListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn create_treatment_sheet(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateTreatmentSheetRequest>,
) -> Result<Json<ObjectResponse<TreatmentSheetListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let admission = load_admission_for_access(&state, &user, payload.admission_case_id).await?;
    let sheet = state
        .create_treatment_sheet(&admission, payload.sheet_date, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "treatment_sheet_create_failed",
                "Treatment sheet could not be created.",
            )
        })?;

    Ok(Json(object(sheet)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/vitals",
    operation_id = "getPatientVitals",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Patient vitals", body = ListResponse<PatientVitalsListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_patient_vitals(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<PatientVitalsListItem>>, ApiError> {
    require_patient_workflow_access(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_patient_vitals(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("vitals_list_failed", "Vitals could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.recorded_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/vitals",
    operation_id = "postPatientVitals",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = CreatePatientVitalsRequest,
    responses(
        (status = 200, description = "Patient vitals recorded", body = ObjectResponse<PatientVitalsListItem>),
        (status = 400, description = "Invalid vitals request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn create_patient_vitals(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreatePatientVitalsRequest>,
) -> Result<Json<ObjectResponse<PatientVitalsListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    validate_vitals_payload(&payload)?;
    let admission = load_admission_for_access(&state, &user, payload.admission_case_id).await?;
    let vitals = state
        .create_patient_vitals(
            &admission,
            payload.recorded_at,
            payload.temperature_c,
            payload.systolic_bp,
            payload.diastolic_bp,
            payload.pulse,
            payload.respiratory_rate,
            payload.oxygen_saturation,
            user.id,
        )
        .await
        .map_err(|_| ApiError::conflict("vitals_create_failed", "Vitals could not be recorded."))?;

    Ok(Json(object(vitals)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/alerts",
    operation_id = "getNursingAlerts",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Nursing alerts", body = ListResponse<NursingAlertListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_nursing_alerts(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<NursingAlertListItem>>, ApiError> {
    require_patient_workflow_access(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_nursing_alerts(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("alert_list_failed", "Alerts could not be loaded."))?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/alerts",
    operation_id = "postNursingAlerts",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = CreateNursingAlertRequest,
    responses(
        (status = 200, description = "Nursing alert created", body = ObjectResponse<NursingAlertListItem>),
        (status = 400, description = "Invalid alert request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn create_nursing_alert(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateNursingAlertRequest>,
) -> Result<Json<ObjectResponse<NursingAlertListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let admission = load_admission_for_access(&state, &user, payload.admission_case_id).await?;
    let title = required_text(payload.title, "title")?;
    let alert = state
        .create_nursing_alert(&admission, payload.severity, title, user.id)
        .await
        .map_err(|_| ApiError::conflict("alert_create_failed", "Alert could not be created."))?;

    Ok(Json(object(alert)))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/alerts/{id}/acknowledge",
    operation_id = "postNursingAlertAcknowledge",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Nursing alert id")),
    responses(
        (status = 200, description = "Nursing alert acknowledged", body = ObjectResponse<NursingAlertListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Alert not found", body = ApiErrorResponse)
    )
)]
pub async fn acknowledge_nursing_alert(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NursingAlertListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let existing = state
        .get_nursing_alert(id)
        .await
        .map_err(|_| ApiError::conflict("alert_load_failed", "Alert could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("alert_not_found", "Alert was not found."))?;
    let _patient = load_patient_for_access(&state, &user, existing.patient_id).await?;
    let alert = state
        .acknowledge_nursing_alert(id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "alert_acknowledge_failed",
                "Alert could not be acknowledged.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("alert_not_found", "Alert was not found."))?;

    Ok(Json(object(alert)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/monitoring-events",
    operation_id = "getMonitoringEvents",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Monitoring events", body = ListResponse<MonitoringEventListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_monitoring_events(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<MonitoringEventListItem>>, ApiError> {
    require_patient_workflow_access(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_monitoring_events(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "monitoring_event_list_failed",
                "Monitoring events could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.recorded_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/monitoring-events",
    operation_id = "postMonitoringEvents",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = CreateMonitoringEventRequest,
    responses(
        (status = 200, description = "Monitoring event created", body = ObjectResponse<MonitoringEventListItem>),
        (status = 400, description = "Invalid monitoring event", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn create_monitoring_event(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateMonitoringEventRequest>,
) -> Result<Json<ObjectResponse<MonitoringEventListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let admission = load_admission_for_access(&state, &user, payload.admission_case_id).await?;
    let summary = required_text(payload.summary, "summary")?;
    let event = state
        .create_monitoring_event(
            &admission,
            payload.event_kind,
            summary,
            payload.recorded_at,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "monitoring_event_create_failed",
                "Monitoring event could not be created.",
            )
        })?;

    Ok(Json(object(event)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/fluid-balance",
    operation_id = "getFluidBalanceEntries",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Fluid balance entries", body = ListResponse<FluidBalanceListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_fluid_balance_entries(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<FluidBalanceListItem>>, ApiError> {
    require_patient_workflow_access(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_fluid_balance_entries(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "fluid_balance_list_failed",
                "Fluid balance entries could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.recorded_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/fluid-balance",
    operation_id = "postFluidBalanceEntries",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = CreateFluidBalanceEntryRequest,
    responses(
        (status = 200, description = "Fluid balance entry created", body = ObjectResponse<FluidBalanceListItem>),
        (status = 400, description = "Invalid fluid balance entry", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn create_fluid_balance_entry(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateFluidBalanceEntryRequest>,
) -> Result<Json<ObjectResponse<FluidBalanceListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    if payload.intake_ml < 0 || payload.output_ml < 0 {
        return Err(ApiError::bad_request(
            "invalid_fluid_balance",
            "Fluid intake and output must be non-negative.",
        ));
    }
    let admission = load_admission_for_access(&state, &user, payload.admission_case_id).await?;
    let entry = state
        .create_fluid_balance_entry(
            &admission,
            payload.recorded_at,
            payload.intake_ml,
            payload.output_ml,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "fluid_balance_create_failed",
                "Fluid balance entry could not be created.",
            )
        })?;

    Ok(Json(object(entry)))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/ward-stock-requests",
    operation_id = "getWardStockRequests",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(CursorListQuery),
    responses(
        (status = 200, description = "Ward stock requests", body = ListResponse<WardStockRequestListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_ward_stock_requests(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<WardStockRequestListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_ward_stock_requests(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_stock_request_list_failed",
                "Ward stock requests could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.requested_at, item.id)
    })))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/ward-stock-requests",
    operation_id = "postWardStockRequests",
    tag = "nursing",
    security(("bearerAuth" = [])),
    request_body = CreateWardStockRequestRequest,
    responses(
        (status = 200, description = "Ward stock request created", body = ObjectResponse<WardStockRequestListItem>),
        (status = 400, description = "Invalid ward stock request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse)
    )
)]
pub async fn create_ward_stock_request(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateWardStockRequestRequest>,
) -> Result<Json<ObjectResponse<WardStockRequestListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let _ward = load_ward(&state, payload.ward_id).await?;
    let requested_item = required_text(payload.requested_item, "requested_item")?;
    if payload.quantity_requested <= 0 {
        return Err(ApiError::bad_request(
            "invalid_ward_stock_request",
            "Quantity requested must be greater than zero.",
        ));
    }
    let request = state
        .create_ward_stock_request(
            payload.ward_id,
            requested_item,
            payload.quantity_requested,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_stock_request_create_failed",
                "Ward stock request could not be created.",
            )
        })?;

    Ok(Json(object(request)))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/ward-stock-requests/{id}/approve",
    operation_id = "postWardStockRequestApprove",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward stock request id")),
    responses(
        (status = 200, description = "Ward stock request approved", body = ObjectResponse<WardStockRequestListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward stock request not found", body = ApiErrorResponse),
        (status = 409, description = "Invalid stock-request state", body = ApiErrorResponse)
    )
)]
pub async fn approve_ward_stock_request(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardStockRequestListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let request = state
        .approve_ward_stock_request(id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_stock_request_approve_failed",
                "Ward stock request could not be approved.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_stock_request_not_found",
                "Ward stock request was not found.",
            )
        })?;

    Ok(Json(object(request)))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/ward-stock-requests/{id}/fulfill",
    operation_id = "postWardStockRequestFulfill",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward stock request id")),
    responses(
        (status = 200, description = "Ward stock request fulfilled", body = ObjectResponse<WardStockRequestListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward stock request not found", body = ApiErrorResponse),
        (status = 409, description = "Invalid stock-request state", body = ApiErrorResponse)
    )
)]
pub async fn fulfill_ward_stock_request(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardStockRequestListItem>>, ApiError> {
    require_facility_permission(
        &user,
        state.facility_id(),
        PermissionCode::NursingTaskManage,
    )?;
    let request = state
        .fulfill_ward_stock_request(id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_stock_request_fulfill_failed",
                "Ward stock request could not be fulfilled.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_stock_request_not_found",
                "Ward stock request was not found.",
            )
        })?;

    Ok(Json(object(request)))
}

async fn load_admission_for_access(
    state: &AppState,
    user: &AuthUser,
    admission_case_id: Uuid,
) -> Result<AdmissionContext, ApiError> {
    let admission = state
        .get_admission_context(admission_case_id)
        .await
        .map_err(|_| ApiError::conflict("admission_load_failed", "Admission could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("admission_not_found", "Admission was not found."))?;
    let _patient = load_patient_for_access(state, user, admission.patient_id).await?;
    Ok(admission)
}

async fn load_admission_case_for_access(
    state: &AppState,
    user: &AuthUser,
    admission_case_id: Uuid,
) -> Result<AdmissionCaseListItem, ApiError> {
    let admission_case = state
        .get_admission_case(admission_case_id)
        .await
        .map_err(|_| ApiError::conflict("admission_load_failed", "Admission could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("admission_not_found", "Admission was not found."))?;
    let _patient = load_patient_for_access(state, user, admission_case.patient_id).await?;
    Ok(admission_case)
}

async fn load_ward(state: &AppState, ward_id: Uuid) -> Result<WardListItem, ApiError> {
    state
        .get_ward(ward_id)
        .await
        .map_err(|_| ApiError::conflict("ward_load_failed", "Ward could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("ward_not_found", "Ward was not found."))
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

fn require_patient_workflow_access(
    user: &AuthUser,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    require_facility_permission(user, facility_id, permission)?;
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

fn require_facility_permission(
    user: &AuthUser,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    require_permission(user, permission).map_err(|_| {
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

fn page_request(query: CursorListQuery) -> Result<(Option<WardCursor>, u8), ApiError> {
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

fn decode_cursor(value: &str) -> Result<WardCursor, ApiError> {
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
    Ok(WardCursor { occurred_at, id })
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

fn validate_vitals_payload(payload: &CreatePatientVitalsRequest) -> Result<(), ApiError> {
    if let Some(temperature_c) = payload.temperature_c {
        if !(25.0..=45.0).contains(&temperature_c) {
            return Err(ApiError::bad_request(
                "invalid_vitals",
                "Temperature must be between 25.0 and 45.0 Celsius.",
            ));
        }
    }
    validate_optional_range(payload.systolic_bp, 40, 260)?;
    validate_optional_range(payload.diastolic_bp, 20, 160)?;
    validate_optional_range(payload.pulse, 20, 250)?;
    validate_optional_range(payload.respiratory_rate, 4, 80)?;
    validate_optional_range(payload.oxygen_saturation, 0, 100)?;
    Ok(())
}

fn validate_optional_range(value: Option<i32>, min: i32, max: i32) -> Result<(), ApiError> {
    if let Some(value) = value {
        if !(min..=max).contains(&value) {
            return Err(ApiError::bad_request(
                "invalid_vitals",
                "One or more vitals values are outside the accepted range.",
            ));
        }
    }
    Ok(())
}
