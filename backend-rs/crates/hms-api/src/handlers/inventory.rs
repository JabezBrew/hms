use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::inventory::{
    ControlledSubstanceBalanceValidation, ControlledSubstanceRegisterEntryItem,
    ControlledSubstanceRegisterItem, CreateControlledSubstanceCountRequest,
    CreateControlledSubstanceMovementRequest, CreateGoodsReceivedNoteRequest,
    CreatePharmacyDispenseRequest, CreatePurchaseOrderRequest, CreateStockBatchRequest,
    CreateStockRequisitionRequest, CreateStockTransferRequest, GoodsReceivedNoteListItem,
    InventoryCategoryListItem, InventoryDashboardSummary, InventoryDashboardSummaryQuery,
    InventoryItemListItem, InventoryItemStockLocationItem, InventoryItemsQuery, InventoryListQuery,
    PharmacyDispenseListItem, PurchaseOrderListItem, RejectStockRequisitionRequest,
    StockBatchListItem, StockBatchListQuery, StockMovementListItem, StockRequisitionListItem,
    StockTransferListItem, StorageLocationListItem, StorageLocationStockItem, SupplierListItem,
    SupplierListQuery,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(get, path = "/api/v2/inventory/categories", operation_id = "getInventoryCategories", tag = "inventory", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<InventoryCategoryListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_categories(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ListResponse<InventoryCategoryListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .catalog()
            .list_categories(&user)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/items", operation_id = "getInventoryItems", tag = "inventory", security(("bearerAuth" = [])), params(InventoryItemsQuery), responses((status = 200, body = ListResponse<InventoryItemListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_items(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryItemsQuery>,
) -> Result<Json<ListResponse<InventoryItemListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .catalog()
            .list_items(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/dashboard-summary", operation_id = "getInventoryDashboardSummary", tag = "inventory", security(("bearerAuth" = [])), params(InventoryDashboardSummaryQuery), responses((status = 200, body = ObjectResponse<InventoryDashboardSummary>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn dashboard_summary(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryDashboardSummaryQuery>,
) -> Result<Json<ObjectResponse<InventoryDashboardSummary>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .catalog()
            .dashboard_summary(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/items/{id}", operation_id = "getInventoryItemById", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Inventory item ID")), responses((status = 200, body = ObjectResponse<InventoryItemListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_item(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<InventoryItemListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .catalog()
            .get_item(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/items/{id}/stock-batches", operation_id = "getInventoryItemStockBatches", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Inventory item ID"), InventoryListQuery), responses((status = 200, body = ListResponse<StockBatchListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn list_item_batches(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockBatchListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .list_item_batches(&user, id, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/items/{id}/stock-movements", operation_id = "getInventoryItemStockMovements", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Inventory item ID"), InventoryListQuery), responses((status = 200, body = ListResponse<StockMovementListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn list_item_movements(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockMovementListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .list_item_movements(&user, id, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/items/{id}/stock-by-location", operation_id = "getInventoryItemStockByLocation", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Inventory item ID")), responses((status = 200, body = ListResponse<InventoryItemStockLocationItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn list_item_stock_by_location(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ListResponse<InventoryItemStockLocationItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .list_item_stock_by_location(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/storage-locations", operation_id = "getStorageLocations", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<StorageLocationListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_locations(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StorageLocationListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .catalog()
            .list_locations(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/suppliers", operation_id = "getInventorySuppliers", tag = "inventory", security(("bearerAuth" = [])), params(SupplierListQuery), responses((status = 200, body = ListResponse<SupplierListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_suppliers(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<SupplierListQuery>,
) -> Result<Json<ListResponse<SupplierListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .catalog()
            .list_suppliers(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/storage-locations/{id}", operation_id = "getStorageLocationById", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Storage location ID")), responses((status = 200, body = ObjectResponse<StorageLocationListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_location(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StorageLocationListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .catalog()
            .get_location(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/storage-locations/{id}/stock", operation_id = "getStorageLocationStock", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Storage location ID"), InventoryListQuery), responses((status = 200, body = ListResponse<StorageLocationStockItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn list_location_stock(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StorageLocationStockItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .list_location_stock(&user, id, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/stock-batches", operation_id = "getStockBatches", tag = "inventory", security(("bearerAuth" = [])), params(StockBatchListQuery), responses((status = 200, body = ListResponse<StockBatchListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_batches(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<StockBatchListQuery>,
) -> Result<Json<ListResponse<StockBatchListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .list_batches(&user, query)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/stock-batches", operation_id = "postStockBatches", tag = "inventory", security(("bearerAuth" = [])), request_body = CreateStockBatchRequest, responses((status = 200, body = ObjectResponse<StockBatchListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_batch(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateStockBatchRequest>,
) -> Result<Json<ObjectResponse<StockBatchListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .create_batch(&user, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/stock-movements", operation_id = "getStockMovements", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<StockMovementListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_movements(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockMovementListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .list_movements(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/transfers", operation_id = "getStockTransfers", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<StockTransferListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_transfers(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockTransferListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .list_transfers(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/transfers/{id}", operation_id = "getStockTransferById", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Stock transfer ID")), responses((status = 200, body = ObjectResponse<StockTransferListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_transfer(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StockTransferListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .get_transfer(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/transfers", operation_id = "postStockTransfers", tag = "inventory", security(("bearerAuth" = [])), request_body = CreateStockTransferRequest, responses((status = 200, body = ObjectResponse<StockTransferListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_transfer(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateStockTransferRequest>,
) -> Result<Json<ObjectResponse<StockTransferListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .create_transfer(&user, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/requisitions", operation_id = "getStockRequisitions", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_requisitions(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockRequisitionListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .list_requisitions(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/requisitions/{id}", operation_id = "getStockRequisitionById", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Stock requisition ID")), responses((status = 200, body = ObjectResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_requisition(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StockRequisitionListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .get_requisition(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/requisitions", operation_id = "postStockRequisitions", tag = "inventory", security(("bearerAuth" = [])), request_body = CreateStockRequisitionRequest, responses((status = 200, body = ObjectResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_requisition(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateStockRequisitionRequest>,
) -> Result<Json<ObjectResponse<StockRequisitionListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .create_requisition(&user, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/requisitions/{id}/submit", operation_id = "postStockRequisitionSubmit", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Stock requisition ID")), responses((status = 200, body = ObjectResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn submit_requisition(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StockRequisitionListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .submit_requisition(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/requisitions/{id}/approve", operation_id = "postStockRequisitionApprove", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Stock requisition ID")), responses((status = 200, body = ObjectResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn approve_requisition(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StockRequisitionListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .approve_requisition(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/requisitions/{id}/fulfill", operation_id = "postStockRequisitionFulfill", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Stock requisition ID")), responses((status = 200, body = ObjectResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn fulfill_requisition(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StockRequisitionListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .fulfill_requisition(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/requisitions/{id}/reject", operation_id = "postStockRequisitionReject", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Stock requisition ID")), request_body = RejectStockRequisitionRequest, responses((status = 200, body = ObjectResponse<StockRequisitionListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn reject_requisition(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<RejectStockRequisitionRequest>,
) -> Result<Json<ObjectResponse<StockRequisitionListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .reject_requisition(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/requisitions/{id}/cancel", operation_id = "postStockRequisitionCancel", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Stock requisition ID")), responses((status = 200, body = ObjectResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn cancel_requisition(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<StockRequisitionListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .stock_control()
            .cancel_requisition(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/purchase-orders", operation_id = "getPurchaseOrders", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<PurchaseOrderListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_purchase_orders(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<PurchaseOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .list_purchase_orders(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/purchase-orders/{id}", operation_id = "getPurchaseOrderById", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Purchase order ID")), responses((status = 200, body = ObjectResponse<PurchaseOrderListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_purchase_order(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PurchaseOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .get_purchase_order(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/purchase-orders", operation_id = "postPurchaseOrders", tag = "inventory", security(("bearerAuth" = [])), request_body = CreatePurchaseOrderRequest, responses((status = 200, body = ObjectResponse<PurchaseOrderListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_purchase_order(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreatePurchaseOrderRequest>,
) -> Result<Json<ObjectResponse<PurchaseOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .create_purchase_order(&user, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/purchase-orders/{id}/approve", operation_id = "postPurchaseOrderApprove", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Purchase order ID")), responses((status = 200, body = ObjectResponse<PurchaseOrderListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn approve_purchase_order(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PurchaseOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .approve_purchase_order(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/purchase-orders/{id}/send", operation_id = "postPurchaseOrderSend", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Purchase order ID")), responses((status = 200, body = ObjectResponse<PurchaseOrderListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn send_purchase_order(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<PurchaseOrderListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .send_purchase_order(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/goods-received-notes", operation_id = "getGoodsReceivedNotes", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<GoodsReceivedNoteListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_grns(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<GoodsReceivedNoteListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .list_grns(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/inventory/goods-received-notes/{id}", operation_id = "getGoodsReceivedNoteById", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Goods received note ID")), responses((status = 200, body = ObjectResponse<GoodsReceivedNoteListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_grn(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<GoodsReceivedNoteListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .get_grn(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/goods-received-notes", operation_id = "postGoodsReceivedNotes", tag = "inventory", security(("bearerAuth" = [])), request_body = CreateGoodsReceivedNoteRequest, responses((status = 200, body = ObjectResponse<GoodsReceivedNoteListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_grn(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateGoodsReceivedNoteRequest>,
) -> Result<Json<ObjectResponse<GoodsReceivedNoteListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .create_grn(&user, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/goods-received-notes/{id}/inspect", operation_id = "postGoodsReceivedNoteInspect", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Goods received note ID")), responses((status = 200, body = ObjectResponse<GoodsReceivedNoteListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn inspect_grn(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<GoodsReceivedNoteListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .inspect_grn(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/inventory/goods-received-notes/{id}/accept", operation_id = "postGoodsReceivedNoteAccept", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Goods received note ID")), responses((status = 200, body = ObjectResponse<GoodsReceivedNoteListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn accept_grn(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<GoodsReceivedNoteListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .procurement()
            .accept_grn(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/pharmacy/controlled-substances/register", operation_id = "getControlledSubstanceRegister", tag = "pharmacy", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<ControlledSubstanceRegisterItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_controlled_register(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<ControlledSubstanceRegisterItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .controlled_substances()
            .list_register(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/pharmacy/controlled-substances/register/{id}", operation_id = "getControlledSubstanceRegisterById", tag = "pharmacy", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Controlled substance register entry ID")), responses((status = 200, body = ObjectResponse<ControlledSubstanceRegisterItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_controlled_register_entry(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ControlledSubstanceRegisterItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .controlled_substances()
            .get_register_entry(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/pharmacy/controlled-substances/register/{id}/entries", operation_id = "getControlledSubstanceRegisterEntries", tag = "pharmacy", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Controlled substance register entry ID"), InventoryListQuery), responses((status = 200, body = ListResponse<ControlledSubstanceRegisterEntryItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn list_controlled_register_entries(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<ControlledSubstanceRegisterEntryItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .controlled_substances()
            .list_register_entries(&user, id, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/pharmacy/controlled-substances/register/{id}/balance-validation", operation_id = "getControlledSubstanceRegisterBalanceValidation", tag = "pharmacy", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Controlled substance register entry ID")), responses((status = 200, body = ObjectResponse<ControlledSubstanceBalanceValidation>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn validate_controlled_register_balance(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ControlledSubstanceBalanceValidation>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .controlled_substances()
            .validate_register_balance(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/pharmacy/controlled-substances/register/{id}/counts", operation_id = "postControlledSubstanceRegisterCounts", tag = "pharmacy", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Controlled substance register entry ID")), request_body = CreateControlledSubstanceCountRequest, responses((status = 200, body = ObjectResponse<ControlledSubstanceRegisterItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_controlled_count(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateControlledSubstanceCountRequest>,
) -> Result<Json<ObjectResponse<ControlledSubstanceRegisterItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .controlled_substances()
            .create_count(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/pharmacy/controlled-substances/register", operation_id = "postControlledSubstanceRegister", tag = "pharmacy", security(("bearerAuth" = [])), request_body = CreateControlledSubstanceMovementRequest, responses((status = 200, body = ObjectResponse<ControlledSubstanceRegisterItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_controlled_movement(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateControlledSubstanceMovementRequest>,
) -> Result<Json<ObjectResponse<ControlledSubstanceRegisterItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .controlled_substances()
            .create_movement(&user, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/pharmacy/dispenses", operation_id = "getPharmacyDispenses", tag = "pharmacy", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<PharmacyDispenseListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_dispenses(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<PharmacyDispenseListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .pharmacy()
            .list_dispenses(&user, query)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/pharmacy/dispenses", operation_id = "postPharmacyDispenses", tag = "pharmacy", security(("bearerAuth" = [])), request_body = CreatePharmacyDispenseRequest, responses((status = 200, body = ObjectResponse<PharmacyDispenseListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_dispense(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreatePharmacyDispenseRequest>,
) -> Result<Json<ObjectResponse<PharmacyDispenseListItem>>, ApiError> {
    Ok(Json(
        state
            .inventory_services()
            .pharmacy()
            .create_dispense(&user, payload)
            .await?,
    ))
}
