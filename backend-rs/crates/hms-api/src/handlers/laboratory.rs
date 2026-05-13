use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::{require_patient_demographics_access, require_permission};
use hms_db::laboratory::{
    LabCursor, LabOrderListFilters, LabResultListFilters, OrderContext, ResultContext,
    SpecimenContext,
};
use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::deployment::PermissionCode;
use hms_domain::laboratory::{
    CancelLabOrderRequest, CreateLabOrderRequest, CreateLabResultRequest, CreateSpecimenRequest,
    LabOrderListItem, LabPanelListItem, LabResultListItem, LabTestCatalogItem, LaboratoryListQuery,
    LaboratoryOrderListQuery, LaboratoryResultListQuery, SpecimenListItem,
};
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_SHORT_TEXT_LEN: usize = 120;

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/test-catalog",
    operation_id = "getLaboratoryTestCatalog",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Laboratory test catalog", body = ListResponse<LabTestCatalogItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_test_catalog(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<LabTestCatalogItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let tests = state.list_lab_test_catalog().await.map_err(|_| {
        ApiError::conflict(
            "lab_catalog_list_failed",
            "Laboratory test catalog could not be loaded.",
        )
    })?;

    Ok(Json(static_list(tests)))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/test-catalog/{id}",
    operation_id = "getLaboratoryTestCatalogById",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory test catalog item id")),
    responses(
        (status = 200, description = "Laboratory test catalog item", body = ObjectResponse<LabTestCatalogItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Laboratory test not found", body = ApiErrorResponse)
    )
)]
pub async fn get_test_catalog_item(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabTestCatalogItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let test = state
        .get_lab_test_catalog_item(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_catalog_item_load_failed",
                "Laboratory test could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "lab_catalog_item_not_found",
                "Laboratory test was not found.",
            )
        })?;

    Ok(Json(object(test)))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/panels",
    operation_id = "getLaboratoryPanels",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Laboratory panels", body = ListResponse<LabPanelListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_panels(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<LabPanelListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let panels = state.list_lab_panels().await.map_err(|_| {
        ApiError::conflict(
            "lab_panel_list_failed",
            "Laboratory panels could not be loaded.",
        )
    })?;

    Ok(Json(static_list(panels)))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/panels/{id}",
    operation_id = "getLaboratoryPanelById",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory panel id")),
    responses(
        (status = 200, description = "Laboratory panel", body = ObjectResponse<LabPanelListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse),
        (status = 404, description = "Laboratory panel not found", body = ApiErrorResponse)
    )
)]
pub async fn get_panel(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabPanelListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let panel = state
        .get_lab_panel(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_panel_load_failed",
                "Laboratory panel could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("lab_panel_not_found", "Laboratory panel was not found.")
        })?;

    Ok(Json(object(panel)))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/orders",
    operation_id = "getLaboratoryOrders",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryOrderListQuery),
    responses(
        (status = 200, description = "Laboratory orders", body = ListResponse<LabOrderListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_orders(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<LaboratoryOrderListQuery>,
) -> Result<Json<ListResponse<LabOrderListItem>>, ApiError> {
    require_laboratory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query.cursor, query.limit)?;
    let rows = state
        .list_lab_orders(
            cursor,
            page_size as i64 + 1,
            LabOrderListFilters {
                status: query.status,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_order_list_failed",
                "Laboratory orders could not be loaded.",
            )
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.ordered_at, item.id)
    })))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/orders/{id}",
    operation_id = "getLaboratoryOrderById",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory order id")),
    responses(
        (status = 200, description = "Laboratory order", body = ObjectResponse<LabOrderListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Laboratory order not found", body = ApiErrorResponse)
    )
)]
pub async fn get_order(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    require_laboratory_list_access(&user, state.facility_id())?;
    let _context = load_order_for_access(&state, &user, id).await?;
    let order = state
        .get_lab_order(id)
        .await
        .map_err(|_| ApiError::conflict("lab_order_load_failed", "Lab order could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("lab_order_not_found", "Lab order was not found."))?;

    Ok(Json(object(order)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/orders",
    operation_id = "postLaboratoryOrders",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    request_body = CreateLabOrderRequest,
    responses(
        (status = 200, description = "Laboratory order created", body = ObjectResponse<LabOrderListItem>),
        (status = 400, description = "Invalid laboratory order", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Patient not found", body = ApiErrorResponse)
    )
)]
pub async fn create_order(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateLabOrderRequest>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    if payload.test_ids.is_empty() && payload.panel_ids.is_empty() {
        return Err(validation_error(
            "tests",
            "At least one test or panel is required.",
        ));
    }
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let order = state
        .create_lab_order(
            payload.patient_id,
            payload.test_ids,
            payload.panel_ids,
            payload.priority,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_order_create_failed",
                "Laboratory order could not be created.",
            )
        })?;

    Ok(Json(object(order)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/orders/{id}/submit",
    operation_id = "postLaboratoryOrderSubmit",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory order id")),
    responses(
        (status = 200, description = "Laboratory order submitted", body = ObjectResponse<LabOrderListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Laboratory order not found", body = ApiErrorResponse),
        (status = 409, description = "Invalid order transition", body = ApiErrorResponse)
    )
)]
pub async fn submit_order(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let _context = load_order_for_access(&state, &user, id).await?;
    let order = state
        .submit_lab_order(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_order_submit_failed",
                "Lab order could not be submitted.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("lab_order_not_found", "Lab order was not found."))?;

    Ok(Json(object(order)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/orders/{id}/collect",
    operation_id = "postLaboratoryOrderCollect",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory order id")),
    responses(
        (status = 200, description = "Laboratory order marked as specimen collected", body = ObjectResponse<LabOrderListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Laboratory order not found", body = ApiErrorResponse),
        (status = 409, description = "Invalid order transition", body = ApiErrorResponse)
    )
)]
pub async fn collect_order(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let _context = load_order_for_access(&state, &user, id).await?;
    let order = state
        .collect_lab_order(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_order_collect_failed",
                "Lab order could not be marked as collected.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("lab_order_not_found", "Lab order was not found."))?;

    Ok(Json(object(order)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/orders/{id}/start-processing",
    operation_id = "postLaboratoryOrderStartProcessing",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory order id")),
    responses(
        (status = 200, description = "Laboratory order moved to result-entry worklist", body = ObjectResponse<LabOrderListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Laboratory order not found", body = ApiErrorResponse),
        (status = 409, description = "Invalid order transition", body = ApiErrorResponse)
    )
)]
pub async fn start_order_processing(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let _context = load_order_for_access(&state, &user, id).await?;
    let order = state
        .start_lab_order_processing(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_order_processing_start_failed",
                "Lab order processing could not be started.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("lab_order_not_found", "Lab order was not found."))?;

    Ok(Json(object(order)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/orders/{id}/cancel",
    operation_id = "postLaboratoryOrderCancel",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory order id")),
    request_body = CancelLabOrderRequest,
    responses(
        (status = 200, description = "Laboratory order cancelled", body = ObjectResponse<LabOrderListItem>),
        (status = 400, description = "Invalid cancellation request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Laboratory order not found", body = ApiErrorResponse),
        (status = 409, description = "Invalid order transition", body = ApiErrorResponse)
    )
)]
pub async fn cancel_order(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<CancelLabOrderRequest>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let _context = load_order_for_access(&state, &user, id).await?;
    let cancellation_reason =
        normalize_optional_text(payload.cancellation_reason, "cancellation_reason")?;
    let order = state
        .cancel_lab_order(id, user.id, cancellation_reason)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_order_cancel_failed",
                "Lab order could not be cancelled.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("lab_order_not_found", "Lab order was not found."))?;

    Ok(Json(object(order)))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/specimens",
    operation_id = "getLaboratorySpecimens",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryListQuery),
    responses(
        (status = 200, description = "Laboratory specimens", body = ListResponse<SpecimenListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_specimens(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<LaboratoryListQuery>,
) -> Result<Json<ListResponse<SpecimenListItem>>, ApiError> {
    require_laboratory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query.cursor, query.limit)?;
    let rows = state
        .list_lab_specimens(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict("specimen_list_failed", "Specimens could not be loaded.")
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.collected_at, item.id)
    })))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/specimens/{id}",
    operation_id = "getLaboratorySpecimenById",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory specimen id")),
    responses(
        (status = 200, description = "Laboratory specimen", body = ObjectResponse<SpecimenListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Specimen not found", body = ApiErrorResponse)
    )
)]
pub async fn get_specimen(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<SpecimenListItem>>, ApiError> {
    require_laboratory_list_access(&user, state.facility_id())?;
    let _context = load_specimen_for_access(&state, &user, id).await?;
    let specimen = state
        .get_lab_specimen(id)
        .await
        .map_err(|_| ApiError::conflict("specimen_load_failed", "Specimen could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("specimen_not_found", "Specimen was not found."))?;

    Ok(Json(object(specimen)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/specimens",
    operation_id = "postLaboratorySpecimens",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    request_body = CreateSpecimenRequest,
    responses(
        (status = 200, description = "Specimen collected", body = ObjectResponse<SpecimenListItem>),
        (status = 400, description = "Invalid specimen", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Order not found", body = ApiErrorResponse)
    )
)]
pub async fn create_specimen(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateSpecimenRequest>,
) -> Result<Json<ObjectResponse<SpecimenListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let specimen_type = normalize_text(payload.specimen_type, "specimen_type")?;
    let order = load_order_for_access(&state, &user, payload.order_id).await?;
    let specimen = state
        .create_lab_specimen(&order, specimen_type, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict("specimen_create_failed", "Specimen could not be saved.")
        })?;

    Ok(Json(object(specimen)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/specimens/{id}/receive",
    operation_id = "postLaboratorySpecimenReceive",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory specimen id")),
    responses(
        (status = 200, description = "Laboratory specimen received", body = ObjectResponse<SpecimenListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Specimen not found", body = ApiErrorResponse),
        (status = 409, description = "Invalid specimen transition", body = ApiErrorResponse)
    )
)]
pub async fn receive_specimen(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<SpecimenListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let _context = load_specimen_for_access(&state, &user, id).await?;
    let specimen = state
        .receive_lab_specimen(id)
        .await
        .map_err(|_| {
            ApiError::conflict("specimen_receive_failed", "Specimen could not be received.")
        })?
        .ok_or_else(|| ApiError::not_found("specimen_not_found", "Specimen was not found."))?;

    Ok(Json(object(specimen)))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/results",
    operation_id = "getLaboratoryResults",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryResultListQuery),
    responses(
        (status = 200, description = "Laboratory results", body = ListResponse<LabResultListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_results(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<LaboratoryResultListQuery>,
) -> Result<Json<ListResponse<LabResultListItem>>, ApiError> {
    require_laboratory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query.cursor, query.limit)?;
    let rows = state
        .list_lab_results(
            cursor,
            page_size as i64 + 1,
            LabResultListFilters {
                status: query.status,
                is_verified: query.is_verified,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("lab_result_list_failed", "Lab results could not be loaded.")
        })?;

    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.entered_at, item.id)
    })))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/results/{id}",
    operation_id = "getLaboratoryResultById",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory result id")),
    responses(
        (status = 200, description = "Laboratory result", body = ObjectResponse<LabResultListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Result not found", body = ApiErrorResponse)
    )
)]
pub async fn get_result(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabResultListItem>>, ApiError> {
    require_laboratory_list_access(&user, state.facility_id())?;
    let _context = load_result_for_access(&state, &user, id).await?;
    let result = state
        .get_lab_result(id)
        .await
        .map_err(|_| {
            ApiError::conflict("lab_result_load_failed", "Lab result could not be loaded.")
        })?
        .ok_or_else(|| ApiError::not_found("lab_result_not_found", "Lab result was not found."))?;

    Ok(Json(object(result)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/results",
    operation_id = "postLaboratoryResults",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    request_body = CreateLabResultRequest,
    responses(
        (status = 200, description = "Laboratory result entered", body = ObjectResponse<LabResultListItem>),
        (status = 400, description = "Invalid laboratory result", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Specimen not found", body = ApiErrorResponse)
    )
)]
pub async fn create_result(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateLabResultRequest>,
) -> Result<Json<ObjectResponse<LabResultListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryOrderManage,
    )?;
    let specimen = load_specimen_for_access(&state, &user, payload.specimen_id).await?;
    let value = normalize_text(payload.value, "value")?;
    let unit = normalize_optional_text(payload.unit, "unit")?;
    let result = state
        .create_lab_result(&specimen, payload.test_id, value, unit, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict("lab_result_create_failed", "Lab result could not be saved.")
        })?;

    Ok(Json(object(result)))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/results/{id}/verify",
    operation_id = "postLaboratoryResultVerify",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(("id" = Uuid, Path, description = "Laboratory result id")),
    responses(
        (status = 200, description = "Laboratory result verified", body = ObjectResponse<LabResultListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Result not found", body = ApiErrorResponse)
    )
)]
pub async fn verify_result(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabResultListItem>>, ApiError> {
    require_laboratory_access(
        &user,
        state.facility_id(),
        PermissionCode::LaboratoryResultVerify,
    )?;
    let _result_context = load_result_for_access(&state, &user, id).await?;
    let result = state
        .verify_lab_result(id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_result_verify_failed",
                "Lab result could not be verified.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("lab_result_not_found", "Lab result was not found."))?;

    Ok(Json(object(result)))
}

async fn load_order_for_access(
    state: &AppState,
    user: &AuthUser,
    order_id: Uuid,
) -> Result<OrderContext, ApiError> {
    let order = state
        .get_lab_order_context(order_id)
        .await
        .map_err(|_| ApiError::conflict("lab_order_load_failed", "Lab order could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("lab_order_not_found", "Lab order was not found."))?;
    let _patient = load_patient_for_access(state, user, order.patient_id).await?;
    Ok(order)
}

async fn load_specimen_for_access(
    state: &AppState,
    user: &AuthUser,
    specimen_id: Uuid,
) -> Result<SpecimenContext, ApiError> {
    let specimen = state
        .get_lab_specimen_context(specimen_id)
        .await
        .map_err(|_| ApiError::conflict("specimen_load_failed", "Specimen could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("specimen_not_found", "Specimen was not found."))?;
    let _patient = load_patient_for_access(state, user, specimen.patient_id).await?;
    Ok(specimen)
}

async fn load_result_for_access(
    state: &AppState,
    user: &AuthUser,
    result_id: Uuid,
) -> Result<ResultContext, ApiError> {
    let result = state
        .get_lab_result_context(result_id)
        .await
        .map_err(|_| {
            ApiError::conflict("lab_result_load_failed", "Lab result could not be loaded.")
        })?
        .ok_or_else(|| ApiError::not_found("lab_result_not_found", "Lab result was not found."))?;
    let _patient = load_patient_for_access(state, user, result.patient_id).await?;
    Ok(result)
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

fn require_laboratory_list_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    if !has_permission(user, PermissionCode::LaboratoryOrderManage)
        && !has_permission(user, PermissionCode::LaboratoryResultVerify)
    {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view laboratory workflows.",
        ));
    }
    if user.facility_id != facility_id {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view laboratory workflows.",
        ));
    }
    if user
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics)
    {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient laboratory workflows.",
        ))
    }
}

fn require_laboratory_access(
    user: &AuthUser,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    require_permission(user, permission)
        .and_then(|_| require_permission(user, PermissionCode::PatientDemographicsView))
        .map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission to perform this laboratory action.",
            )
        })?;
    if user.facility_id == facility_id {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this laboratory action.",
        ))
    }
}

fn has_permission(user: &AuthUser, permission: PermissionCode) -> bool {
    user.permissions.contains(&permission)
}

fn page_request(
    cursor: Option<String>,
    limit: Option<u8>,
) -> Result<(Option<LabCursor>, u8), ApiError> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(decode_cursor)
        .transpose()?;
    Ok((cursor, limit))
}

fn static_list<T>(items: Vec<T>) -> ListResponse<T> {
    list(
        items,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: MAX_LIMIT,
        },
    )
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

fn decode_cursor(value: &str) -> Result<LabCursor, ApiError> {
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

    Ok(LabCursor { occurred_at, id })
}

fn normalize_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation_error(field, "This field is required."));
    }
    if value.chars().count() > MAX_SHORT_TEXT_LEN {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(value.to_owned())
}

fn normalize_optional_text(
    value: Option<String>,
    field: &'static str,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > MAX_SHORT_TEXT_LEN {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(Some(value.to_owned()))
}

fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error = ApiError::bad_request(
        "invalid_laboratory_request",
        "Laboratory request is invalid.",
    );
    error.details = json!({ field: [message] });
    error
}
