use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::laboratory::{
    BulkCreateLabResultsRequest, BulkCreateLabResultsResponse, BulkVerifyLabResultsRequest,
    BulkVerifyLabResultsResponse, CancelLabOrderRequest, CreateLabOrderRequest,
    CreateLabResultRequest, CreateSpecimenRequest, LabOrderListItem, LabPanelListItem,
    LabResultListItem, LabTestCatalogItem, LaboratoryCatalogQuery, LaboratoryListQuery,
    LaboratoryOrderListGetQuery, LaboratoryOrderListQuery, LaboratoryResultListGetQuery,
    LaboratoryResultListQuery, SpecimenListItem,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/test-catalog",
    operation_id = "getLaboratoryTestCatalog",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryCatalogQuery),
    responses(
        (status = 200, description = "Laboratory test catalog", body = ListResponse<LabTestCatalogItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_test_catalog(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<LaboratoryCatalogQuery>,
) -> Result<Json<ListResponse<LabTestCatalogItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .catalog()
            .list_test_catalog(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabTestCatalogItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .catalog()
            .get_test_catalog_item(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/panels",
    operation_id = "getLaboratoryPanels",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryCatalogQuery),
    responses(
        (status = 200, description = "Laboratory panels", body = ListResponse<LabPanelListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_panels(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<LaboratoryCatalogQuery>,
) -> Result<Json<ListResponse<LabPanelListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .catalog()
            .list_panels(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabPanelListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .catalog()
            .get_panel(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/orders",
    operation_id = "getLaboratoryOrders",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryOrderListGetQuery),
    responses(
        (status = 200, description = "Laboratory orders", body = ListResponse<LabOrderListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_orders(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<LaboratoryOrderListGetQuery>,
) -> Result<Json<ListResponse<LabOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .orders()
            .list_orders(&user, query.into())
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/orders/search",
    operation_id = "postLaboratoryOrdersSearch",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    request_body = LaboratoryOrderListQuery,
    responses(
        (status = 200, description = "Laboratory orders search", body = ListResponse<LabOrderListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn search_orders(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(query): Json<LaboratoryOrderListQuery>,
) -> Result<Json<ListResponse<LabOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .orders()
            .list_orders(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .orders()
            .get_order(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateLabOrderRequest>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .orders()
            .create_order(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .orders()
            .submit_order(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .orders()
            .collect_order(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .orders()
            .start_order_processing(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CancelLabOrderRequest>,
) -> Result<Json<ObjectResponse<LabOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .orders()
            .cancel_order(&user, id, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Query(query): Query<LaboratoryListQuery>,
) -> Result<Json<ListResponse<SpecimenListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .specimens()
            .list_specimens(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<SpecimenListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .specimens()
            .get_specimen(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateSpecimenRequest>,
) -> Result<Json<ObjectResponse<SpecimenListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .specimens()
            .create_specimen(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<SpecimenListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .specimens()
            .receive_specimen(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/laboratory/results",
    operation_id = "getLaboratoryResults",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    params(LaboratoryResultListGetQuery),
    responses(
        (status = 200, description = "Laboratory results", body = ListResponse<LabResultListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn list_results(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<LaboratoryResultListGetQuery>,
) -> Result<Json<ListResponse<LabResultListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .results()
            .list_results(&user, query.into())
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/results/search",
    operation_id = "postLaboratoryResultsSearch",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    request_body = LaboratoryResultListQuery,
    responses(
        (status = 200, description = "Laboratory results search", body = ListResponse<LabResultListItem>),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Permission denied", body = ApiErrorResponse)
    )
)]
pub async fn search_results(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(query): Json<LaboratoryResultListQuery>,
) -> Result<Json<ListResponse<LabResultListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .results()
            .list_results(&user, query)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabResultListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .results()
            .get_result(&user, id)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateLabResultRequest>,
) -> Result<Json<ObjectResponse<LabResultListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .results()
            .create_result(&user, payload)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/results/bulk",
    operation_id = "postLaboratoryResultBulkCreate",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    request_body = BulkCreateLabResultsRequest,
    responses(
        (status = 200, description = "Laboratory results entered", body = ObjectResponse<BulkCreateLabResultsResponse>),
        (status = 400, description = "Invalid laboratory results", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Specimen not found", body = ApiErrorResponse),
        (status = 409, description = "Laboratory results could not be saved", body = ApiErrorResponse)
    )
)]
pub async fn bulk_create_results(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<BulkCreateLabResultsRequest>,
) -> Result<Json<ObjectResponse<BulkCreateLabResultsResponse>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .results()
            .bulk_create_results(&user, payload)
            .await?,
    ))
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
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<LabResultListItem>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .results()
            .verify_result(&user, id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v2/laboratory/results/bulk-verify",
    operation_id = "postLaboratoryResultBulkVerify",
    tag = "laboratory",
    security(("bearerAuth" = [])),
    request_body = BulkVerifyLabResultsRequest,
    responses(
        (status = 200, description = "Laboratory results verified", body = ObjectResponse<BulkVerifyLabResultsResponse>),
        (status = 400, description = "Invalid verification request", body = ApiErrorResponse),
        (status = 401, description = "Authentication required", body = ApiErrorResponse),
        (status = 403, description = "Patient access denied", body = ApiErrorResponse),
        (status = 404, description = "Order or result not found", body = ApiErrorResponse)
    )
)]
pub async fn bulk_verify_results(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<BulkVerifyLabResultsRequest>,
) -> Result<Json<ObjectResponse<BulkVerifyLabResultsResponse>>, ApiError> {
    Ok(Json(
        state
            .laboratory_services()
            .results()
            .bulk_verify_results(&user, payload)
            .await?,
    ))
}
