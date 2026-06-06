use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::care::CursorListQuery;
use hms_domain::ward::{
    AdministerMedicationRequest, AdmissionCaseListItem, AdmitPatientRequest, BedListItem,
    CancelDischargeRequest, CreateAdmissionCaseRequest, CreateBedRequest, CreateDischargeRequest,
    CreateFluidBalanceEntryRequest, CreateHandoffRequest, CreateMonitoringEventRequest,
    CreateNursingAlertRequest, CreateNursingTaskRequest, CreatePatientVitalsRequest,
    CreateTreatmentSheetRequest, CreateWardRequest, CreateWardSectionRequest,
    CreateWardStaffAssignmentRequest, CreateWardStockRequestRequest, DischargeBlockerActionRequest,
    DischargeCaseListItem, FluidBalanceListItem, HandoffListItem, MedicationAdministrationListItem,
    MonitoringEventListItem, MyWardBoardContextResponse, NursingAlertListItem, NursingTaskListItem,
    NursingTaskListQuery, PatientVitalsListItem, PatientVitalsListQuery,
    RecordNursingReleaseRequest, ReserveAdmissionBedRequest,
    ScheduleMedicationAdministrationRequest, TreatmentSheetListItem, UpdateBedRequest,
    UpdateWardRequest, UpdateWardSectionRequest, UpdateWardStaffAssignmentRequest,
    WardAnalyticsQuery, WardAnalyticsResponse, WardBedMapResponse, WardBoardGetQuery,
    WardBoardItem, WardBoardQuery, WardListItem, WardListQuery, WardSectionListItem,
    WardStaffAssignmentByPractitionerQuery, WardStaffAssignmentListItem,
    WardStaffAssignmentListQuery, WardStaffListItem, WardStaffListQuery, WardStaffRoleItem,
    WardStaffRoleListQuery, WardStockRequestListItem,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/wards",
    operation_id = "getWards",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(WardListQuery),
    responses(
        (status = 200, description = "Wards list", body = ListResponse<WardListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_wards(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<WardListQuery>,
) -> Result<Json<ListResponse<WardListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admin()
            .list_wards(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/analytics",
    operation_id = "getWardAnalytics",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(WardAnalyticsQuery),
    responses(
        (status = 200, description = "Ward occupancy analytics", body = ObjectResponse<WardAnalyticsResponse>),
        (status = 400, description = "Invalid analytics query", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse)
    )
)]
pub async fn ward_analytics(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<WardAnalyticsQuery>,
) -> Result<Json<ObjectResponse<WardAnalyticsResponse>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .analytics()
            .analytics(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/my-board-context",
    operation_id = "getMyWardBoardContext",
    tag = "wards",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Current user's ward-board context", body = ObjectResponse<MyWardBoardContextResponse>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn my_ward_board_context(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ObjectResponse<MyWardBoardContextResponse>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .my_board_context(&user)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/staff-roles",
    operation_id = "getWardStaffRoles",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(WardStaffRoleListQuery),
    responses(
        (status = 200, description = "Ward staff roles", body = ListResponse<WardStaffRoleItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_staff_roles(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<WardStaffRoleListQuery>,
) -> Result<Json<ListResponse<WardStaffRoleItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .list_staff_roles(&user, query)?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/{id}/staff",
    operation_id = "getWardStaff",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(WardStaffListQuery, ("id" = Uuid, Path, description = "Ward id")),
    responses(
        (status = 200, description = "Ward staff", body = ListResponse<WardStaffListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse)
    )
)]
pub async fn list_ward_staff(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Query(query): Query<WardStaffListQuery>,
) -> Result<Json<ListResponse<WardStaffListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .list_ward_staff(&user, id, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/staff-assignments",
    operation_id = "getWardStaffAssignments",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(WardStaffAssignmentListQuery),
    responses(
        (status = 200, description = "Ward staff assignments", body = ListResponse<WardStaffAssignmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_staff_assignments(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<WardStaffAssignmentListQuery>,
) -> Result<Json<ListResponse<WardStaffAssignmentListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .list_assignments(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/staff-assignments/by_practitioner",
    operation_id = "getWardStaffAssignmentsByPractitioner",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(WardStaffAssignmentByPractitionerQuery),
    responses(
        (status = 200, description = "Ward staff assignments for a practitioner", body = ListResponse<WardStaffAssignmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_staff_assignments_by_practitioner(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<WardStaffAssignmentByPractitionerQuery>,
) -> Result<Json<ListResponse<WardStaffAssignmentListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .list_assignments_by_practitioner(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/staff-assignments/{id}",
    operation_id = "getWardStaffAssignmentById",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward staff assignment id")),
    responses(
        (status = 200, description = "Ward staff assignment", body = ObjectResponse<WardStaffAssignmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Assignment not found", body = ApiErrorResponse)
    )
)]
pub async fn get_staff_assignment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardStaffAssignmentListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .get_assignment(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/wards/staff-assignments",
    operation_id = "postWardStaffAssignment",
    tag = "wards",
    security(("bearerAuth" = [])),
    request_body = CreateWardStaffAssignmentRequest,
    responses(
        (status = 200, description = "Ward staff assignment created", body = ObjectResponse<WardStaffAssignmentListItem>),
        (status = 400, description = "Invalid assignment", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward or practitioner not found", body = ApiErrorResponse),
        (status = 409, description = "Assignment could not be created", body = ApiErrorResponse)
    )
)]
pub async fn create_staff_assignment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateWardStaffAssignmentRequest>,
) -> Result<Json<ObjectResponse<WardStaffAssignmentListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .create_assignment(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/wards/staff-assignments/{id}",
    operation_id = "patchWardStaffAssignment",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward staff assignment id")),
    request_body = UpdateWardStaffAssignmentRequest,
    responses(
        (status = 200, description = "Ward staff assignment updated", body = ObjectResponse<WardStaffAssignmentListItem>),
        (status = 400, description = "Invalid assignment", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Assignment not found", body = ApiErrorResponse),
        (status = 409, description = "Assignment could not be updated", body = ApiErrorResponse)
    )
)]
pub async fn update_staff_assignment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateWardStaffAssignmentRequest>,
) -> Result<Json<ObjectResponse<WardStaffAssignmentListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .update_assignment(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v2/wards/staff-assignments/{id}",
    operation_id = "deleteWardStaffAssignment",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward staff assignment id")),
    responses(
        (status = 200, description = "Ward staff assignment deactivated", body = ObjectResponse<WardStaffAssignmentListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Assignment not found", body = ApiErrorResponse),
        (status = 409, description = "Assignment could not be removed", body = ApiErrorResponse)
    )
)]
pub async fn delete_staff_assignment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardStaffAssignmentListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .staff_assignments()
            .delete_assignment(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/wards",
    operation_id = "postWard",
    tag = "wards",
    security(("bearerAuth" = [])),
    request_body = CreateWardRequest,
    responses(
        (status = 200, description = "Ward created", body = ObjectResponse<WardListItem>),
        (status = 400, description = "Invalid ward", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 409, description = "Ward could not be created", body = ApiErrorResponse)
    )
)]
pub async fn create_ward(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateWardRequest>,
) -> Result<Json<ObjectResponse<WardListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admin()
            .create_ward(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardListItem>>, ApiError> {
    Ok(Json(
        state.ward_services().admin().get_ward(&user, id).await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/wards/{id}",
    operation_id = "patchWard",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward id")),
    request_body = UpdateWardRequest,
    responses(
        (status = 200, description = "Ward updated", body = ObjectResponse<WardListItem>),
        (status = 400, description = "Invalid ward update", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse),
        (status = 409, description = "Ward could not be updated", body = ApiErrorResponse)
    )
)]
pub async fn update_ward(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateWardRequest>,
) -> Result<Json<ObjectResponse<WardListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admin()
            .update_ward(&user, id, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<WardSectionListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admin()
            .list_ward_sections(&user, id, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/sections/{id}",
    operation_id = "getWardSectionById",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward section id")),
    responses(
        (status = 200, description = "Ward section detail", body = ObjectResponse<WardSectionListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward section not found", body = ApiErrorResponse)
    )
)]
pub async fn get_ward_section(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardSectionListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admin()
            .get_ward_section(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/wards/sections/{id}",
    operation_id = "patchWardSection",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward section id")),
    request_body = UpdateWardSectionRequest,
    responses(
        (status = 200, description = "Ward section updated", body = ObjectResponse<WardSectionListItem>),
        (status = 400, description = "Invalid section update", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward section not found", body = ApiErrorResponse),
        (status = 409, description = "Ward section could not be updated", body = ApiErrorResponse)
    )
)]
pub async fn update_ward_section(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateWardSectionRequest>,
) -> Result<Json<ObjectResponse<WardSectionListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admin()
            .update_ward_section(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/sections/{id}/beds",
    operation_id = "getWardSectionBeds",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(CursorListQuery, ("id" = Uuid, Path, description = "Ward section id")),
    responses(
        (status = 200, description = "Ward section beds", body = ListResponse<BedListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward section not found", body = ApiErrorResponse)
    )
)]
pub async fn list_section_beds(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<BedListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .bed_management()
            .list_section_beds(&user, id, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateWardSectionRequest>,
) -> Result<Json<ObjectResponse<WardSectionListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admin()
            .create_ward_section(&user, id, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<BedListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .bed_management()
            .list_ward_beds(&user, id, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/{id}/bed-map",
    operation_id = "getWardBedMap",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward id")),
    responses(
        (status = 200, description = "Ward operational bed map", body = ObjectResponse<WardBedMapResponse>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward not found", body = ApiErrorResponse),
        (status = 409, description = "Ward bed map could not be loaded", body = ApiErrorResponse)
    )
)]
pub async fn get_ward_bed_map(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardBedMapResponse>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .bed_management()
            .get_ward_bed_map(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/beds/{id}",
    operation_id = "getWardBedById",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward bed id")),
    responses(
        (status = 200, description = "Ward bed detail", body = ObjectResponse<BedListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward bed not found", body = ApiErrorResponse)
    )
)]
pub async fn get_bed(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<BedListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .bed_management()
            .get_bed(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/api/v2/wards/beds/{id}",
    operation_id = "patchWardBed",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Ward bed id")),
    request_body = UpdateBedRequest,
    responses(
        (status = 200, description = "Ward bed updated", body = ObjectResponse<BedListItem>),
        (status = 400, description = "Invalid bed update", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Ward bed not found", body = ApiErrorResponse),
        (status = 409, description = "Ward bed could not be updated", body = ApiErrorResponse)
    )
)]
pub async fn update_bed(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateBedRequest>,
) -> Result<Json<ObjectResponse<BedListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .bed_management()
            .update_bed(&user, id, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateBedRequest>,
) -> Result<Json<ObjectResponse<BedListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .bed_management()
            .create_bed(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/wards/board",
    operation_id = "getWardBoard",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(WardBoardGetQuery),
    responses(
        (status = 200, description = "Ward board", body = ListResponse<WardBoardItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn ward_board(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<WardBoardGetQuery>,
) -> Result<Json<ListResponse<WardBoardItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .ward_board(&user, query.into())
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/wards/board/search",
    operation_id = "postWardBoardSearch",
    tag = "wards",
    security(("bearerAuth" = [])),
    request_body = WardBoardQuery,
    responses(
        (status = 200, description = "Ward board search", body = ListResponse<WardBoardItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn search_ward_board(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(query): Json<WardBoardQuery>,
) -> Result<Json<ListResponse<WardBoardItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .ward_board(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/admissions/{id}",
    operation_id = "getAdmissionById",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Admission id")),
    responses(
        (status = 200, description = "Active admission", body = ObjectResponse<WardBoardItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission not found", body = ApiErrorResponse)
    )
)]
pub async fn get_admission(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardBoardItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .get_admission(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<AdmissionCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .list_admission_cases(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/admissions/cases/{id}",
    operation_id = "getAdmissionCaseById",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Admission case id")),
    responses(
        (status = 200, description = "Admission case", body = ObjectResponse<AdmissionCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Admission case not found", body = ApiErrorResponse)
    )
)]
pub async fn get_admission_case(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .get_admission_case(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateAdmissionCaseRequest>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .create_admission_case(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<ReserveAdmissionBedRequest>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .reserve_admission_bed(&user, id, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .activate_admission_case(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AdmissionCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .cancel_admission_case(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<AdmitPatientRequest>,
) -> Result<Json<ObjectResponse<WardBoardItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .admission_cases()
            .admit_patient(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<DischargeCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .discharge_cases()
            .list_discharges(&user, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/discharges/{id}",
    operation_id = "getDischargeById",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Discharge case id")),
    responses(
        (status = 200, description = "Discharge case", body = ObjectResponse<DischargeCaseListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Discharge not found", body = ApiErrorResponse)
    )
)]
pub async fn get_discharge(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .discharge_cases()
            .get_discharge(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateDischargeRequest>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .discharge_cases()
            .request_discharge(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/discharges/{id}/cancel",
    operation_id = "postDischargeCancel",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Discharge case id")),
    request_body = CancelDischargeRequest,
    responses(
        (status = 200, description = "Discharge cancelled", body = ObjectResponse<DischargeCaseListItem>),
        (status = 400, description = "Invalid cancellation", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Discharge not found", body = ApiErrorResponse),
        (status = 409, description = "Discharge cannot be cancelled", body = ApiErrorResponse)
    )
)]
pub async fn cancel_discharge(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CancelDischargeRequest>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .discharge_cases()
            .cancel_discharge(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/discharges/{id}/nursing-release",
    operation_id = "postDischargeNursingRelease",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Discharge case id")),
    request_body = RecordNursingReleaseRequest,
    responses(
        (status = 200, description = "Nursing release recorded", body = ObjectResponse<DischargeCaseListItem>),
        (status = 400, description = "Invalid nursing release", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Discharge not found", body = ApiErrorResponse),
        (status = 409, description = "Nursing release cannot be recorded", body = ApiErrorResponse)
    )
)]
pub async fn record_nursing_release(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<RecordNursingReleaseRequest>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .discharge_cases()
            .record_nursing_release(&user, id, payload.education, payload.instructions)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/discharges/{id}/blockers/hold",
    operation_id = "postDischargeBlockerHold",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Discharge case id")),
    request_body = DischargeBlockerActionRequest,
    responses(
        (status = 200, description = "Discharge blocker held", body = ObjectResponse<DischargeCaseListItem>),
        (status = 400, description = "Invalid blocker hold", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Discharge not found", body = ApiErrorResponse),
        (status = 409, description = "Blocker cannot be held", body = ApiErrorResponse)
    )
)]
pub async fn hold_discharge_blocker(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<DischargeBlockerActionRequest>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .discharge_cases()
            .hold_blocker(&user, id, payload.blocker_type, payload.reason)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/discharges/{id}/blockers/override",
    operation_id = "postDischargeBlockerOverride",
    tag = "wards",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Discharge case id")),
    request_body = DischargeBlockerActionRequest,
    responses(
        (status = 200, description = "Discharge blocker overridden", body = ObjectResponse<DischargeCaseListItem>),
        (status = 400, description = "Invalid blocker override", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Discharge not found", body = ApiErrorResponse),
        (status = 409, description = "Blocker cannot be overridden", body = ApiErrorResponse)
    )
)]
pub async fn override_discharge_blocker(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<DischargeBlockerActionRequest>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .discharge_cases()
            .override_blocker(&user, id, payload.blocker_type, payload.reason)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<DischargeCaseListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .discharge_cases()
            .complete_discharge(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/tasks",
    operation_id = "getNursingTasks",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(NursingTaskListQuery),
    responses(
        (status = 200, description = "Nursing tasks", body = ListResponse<NursingTaskListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_nursing_tasks(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<NursingTaskListQuery>,
) -> Result<Json<ListResponse<NursingTaskListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .nursing_task_board()
            .list_nursing_tasks(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateNursingTaskRequest>,
) -> Result<Json<ObjectResponse<NursingTaskListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .nursing_task_board()
            .create_nursing_task(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NursingTaskListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .nursing_task_board()
            .complete_nursing_task(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/nursing/tasks/{id}/cancel",
    operation_id = "postNursingTaskCancel",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Nursing task id")),
    responses(
        (status = 200, description = "Nursing task cancelled", body = ObjectResponse<NursingTaskListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Nursing task not found", body = ApiErrorResponse),
        (status = 409, description = "Nursing task cannot be cancelled", body = ApiErrorResponse)
    )
)]
pub async fn cancel_nursing_task(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NursingTaskListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .nursing_task_board()
            .cancel_nursing_task(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<MedicationAdministrationListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .mar()
            .list_medication_administrations(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<ScheduleMedicationAdministrationRequest>,
) -> Result<Json<ObjectResponse<MedicationAdministrationListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .mar()
            .schedule_medication_administration(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<AdministerMedicationRequest>,
) -> Result<Json<ObjectResponse<MedicationAdministrationListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .mar()
            .administer_medication(&user, id, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<HandoffListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .handoff()
            .list_handoffs(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateHandoffRequest>,
) -> Result<Json<ObjectResponse<HandoffListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .handoff()
            .create_handoff(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<HandoffListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .handoff()
            .complete_handoff(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<TreatmentSheetListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .mar()
            .list_treatment_sheets(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateTreatmentSheetRequest>,
) -> Result<Json<ObjectResponse<TreatmentSheetListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .mar()
            .create_treatment_sheet(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/nursing/vitals",
    operation_id = "getPatientVitals",
    tag = "nursing",
    security(("bearerAuth" = [])),
    params(PatientVitalsListQuery),
    responses(
        (status = 200, description = "Patient vitals", body = ListResponse<PatientVitalsListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_patient_vitals(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<PatientVitalsListQuery>,
) -> Result<Json<ListResponse<PatientVitalsListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .list_patient_vitals(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreatePatientVitalsRequest>,
) -> Result<Json<ObjectResponse<PatientVitalsListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .create_patient_vitals(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<NursingAlertListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .list_nursing_alerts(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateNursingAlertRequest>,
) -> Result<Json<ObjectResponse<NursingAlertListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .create_nursing_alert(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NursingAlertListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .acknowledge_nursing_alert(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<MonitoringEventListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .list_monitoring_events(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateMonitoringEventRequest>,
) -> Result<Json<ObjectResponse<MonitoringEventListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .create_monitoring_event(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<FluidBalanceListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .list_fluid_balance_entries(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateFluidBalanceEntryRequest>,
) -> Result<Json<ObjectResponse<FluidBalanceListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .observations_monitoring()
            .create_fluid_balance_entry(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<CursorListQuery>,
) -> Result<Json<ListResponse<WardStockRequestListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .ward_stock()
            .list_ward_stock_requests(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateWardStockRequestRequest>,
) -> Result<Json<ObjectResponse<WardStockRequestListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .ward_stock()
            .create_ward_stock_request(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardStockRequestListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .ward_stock()
            .approve_ward_stock_request(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<WardStockRequestListItem>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .ward_stock()
            .fulfill_ward_stock_request(&user, id)
            .await?,
    ))
}
