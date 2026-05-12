use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::{require_patient_demographics_access, require_permission};
use hms_db::inventory::InventoryCursor;
use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::deployment::PermissionCode;
use hms_domain::inventory::{
    ControlledSubstanceRegisterItem, CreateControlledSubstanceMovementRequest,
    CreateGoodsReceivedNoteRequest, CreatePharmacyDispenseRequest, CreatePurchaseOrderRequest,
    CreateStockBatchRequest, CreateStockRequisitionRequest, CreateStockTransferRequest,
    GoodsReceivedNoteListItem, InventoryCategoryListItem, InventoryItemListItem,
    InventoryListQuery, PharmacyDispenseListItem, PurchaseOrderListItem, StockBatchListItem,
    StockMovementListItem, StockRequisitionListItem, StockTransferListItem,
    StorageLocationListItem,
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
const MAX_TEXT_LEN: usize = 120;

#[utoipa::path(get, path = "/api/v2/inventory/categories", operation_id = "getInventoryCategories", tag = "inventory", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<InventoryCategoryListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_categories(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<InventoryCategoryListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryView)?;
    Ok(Json(static_list(
        state.list_inventory_categories().await.map_err(|_| {
            ApiError::conflict(
                "inventory_category_list_failed",
                "Categories could not be loaded.",
            )
        })?,
    )))
}

#[utoipa::path(get, path = "/api/v2/inventory/items", operation_id = "getInventoryItems", tag = "inventory", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<InventoryItemListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_items(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<InventoryItemListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryView)?;
    Ok(Json(static_list(
        state.list_inventory_items().await.map_err(|_| {
            ApiError::conflict("inventory_item_list_failed", "Items could not be loaded.")
        })?,
    )))
}

#[utoipa::path(get, path = "/api/v2/inventory/items/{id}", operation_id = "getInventoryItemById", tag = "inventory", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Inventory item ID")), responses((status = 200, body = ObjectResponse<InventoryItemListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_item(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<InventoryItemListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryView)?;
    let item = state
        .get_inventory_item(id)
        .await
        .map_err(|_| ApiError::conflict("inventory_item_load_failed", "Item could not be loaded."))?
        .ok_or_else(|| {
            ApiError::not_found("inventory_item_not_found", "Item could not be found.")
        })?;
    Ok(Json(object(item)))
}

#[utoipa::path(get, path = "/api/v2/inventory/storage-locations", operation_id = "getStorageLocations", tag = "inventory", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<StorageLocationListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_locations(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<StorageLocationListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryView)?;
    Ok(Json(static_list(
        state.list_storage_locations().await.map_err(|_| {
            ApiError::conflict(
                "storage_location_list_failed",
                "Locations could not be loaded.",
            )
        })?,
    )))
}

#[utoipa::path(get, path = "/api/v2/inventory/stock-batches", operation_id = "getStockBatches", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<StockBatchListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_batches(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockBatchListItem>>, ApiError> {
    require_inventory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_stock_batches(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_batch_list_failed",
                "Stock batches could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.received_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/inventory/stock-batches", operation_id = "postStockBatches", tag = "inventory", security(("bearerAuth" = [])), request_body = CreateStockBatchRequest, responses((status = 200, body = ObjectResponse<StockBatchListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_batch(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateStockBatchRequest>,
) -> Result<Json<ObjectResponse<StockBatchListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryManage)?;
    require_positive(payload.quantity_received, "quantity_received")?;
    let batch_number = normalize_text(payload.batch_number, "batch_number")?;
    let batch = state
        .create_stock_batch(
            payload.item_id,
            payload.location_id,
            batch_number,
            payload.expires_on,
            payload.quantity_received,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_batch_create_failed",
                "Stock batch could not be saved.",
            )
        })?;
    Ok(Json(object(batch)))
}

#[utoipa::path(get, path = "/api/v2/inventory/stock-movements", operation_id = "getStockMovements", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<StockMovementListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_movements(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockMovementListItem>>, ApiError> {
    require_inventory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_stock_movements(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_movement_list_failed",
                "Stock movements could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/inventory/transfers", operation_id = "getStockTransfers", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<StockTransferListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_transfers(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockTransferListItem>>, ApiError> {
    require_inventory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_stock_transfers(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_transfer_list_failed",
                "Transfers could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/inventory/transfers", operation_id = "postStockTransfers", tag = "inventory", security(("bearerAuth" = [])), request_body = CreateStockTransferRequest, responses((status = 200, body = ObjectResponse<StockTransferListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_transfer(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateStockTransferRequest>,
) -> Result<Json<ObjectResponse<StockTransferListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryManage)?;
    require_positive(payload.quantity, "quantity")?;
    let transfer = state
        .create_stock_transfer(
            payload.item_id,
            payload.from_location_id,
            payload.to_location_id,
            payload.quantity,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_transfer_create_failed",
                "Transfer could not be saved.",
            )
        })?;
    Ok(Json(object(transfer)))
}

#[utoipa::path(get, path = "/api/v2/inventory/requisitions", operation_id = "getStockRequisitions", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_requisitions(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<StockRequisitionListItem>>, ApiError> {
    require_inventory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_stock_requisitions(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_requisition_list_failed",
                "Requisitions could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/inventory/requisitions", operation_id = "postStockRequisitions", tag = "inventory", security(("bearerAuth" = [])), request_body = CreateStockRequisitionRequest, responses((status = 200, body = ObjectResponse<StockRequisitionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_requisition(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateStockRequisitionRequest>,
) -> Result<Json<ObjectResponse<StockRequisitionListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryManage)?;
    let requisition = state
        .create_stock_requisition(payload.requesting_location_id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_requisition_create_failed",
                "Requisition could not be saved.",
            )
        })?;
    Ok(Json(object(requisition)))
}

#[utoipa::path(get, path = "/api/v2/inventory/purchase-orders", operation_id = "getPurchaseOrders", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<PurchaseOrderListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_purchase_orders(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<PurchaseOrderListItem>>, ApiError> {
    require_inventory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_purchase_orders(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "purchase_order_list_failed",
                "Purchase orders could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/inventory/purchase-orders", operation_id = "postPurchaseOrders", tag = "inventory", security(("bearerAuth" = [])), request_body = CreatePurchaseOrderRequest, responses((status = 200, body = ObjectResponse<PurchaseOrderListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_purchase_order(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreatePurchaseOrderRequest>,
) -> Result<Json<ObjectResponse<PurchaseOrderListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryManage)?;
    let supplier_name = normalize_text(payload.supplier_name, "supplier_name")?;
    let order = state
        .create_purchase_order(supplier_name, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "purchase_order_create_failed",
                "Purchase order could not be saved.",
            )
        })?;
    Ok(Json(object(order)))
}

#[utoipa::path(get, path = "/api/v2/inventory/goods-received-notes", operation_id = "getGoodsReceivedNotes", tag = "inventory", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<GoodsReceivedNoteListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_grns(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<GoodsReceivedNoteListItem>>, ApiError> {
    require_inventory_list_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_goods_received_notes(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "grn_list_failed",
                "Goods received notes could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.received_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/inventory/goods-received-notes", operation_id = "postGoodsReceivedNotes", tag = "inventory", security(("bearerAuth" = [])), request_body = CreateGoodsReceivedNoteRequest, responses((status = 200, body = ObjectResponse<GoodsReceivedNoteListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_grn(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateGoodsReceivedNoteRequest>,
) -> Result<Json<ObjectResponse<GoodsReceivedNoteListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::InventoryManage)?;
    let grn = state
        .create_goods_received_note(payload.purchase_order_id, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "grn_create_failed",
                "Goods received note could not be saved.",
            )
        })?;
    Ok(Json(object(grn)))
}

#[utoipa::path(get, path = "/api/v2/pharmacy/controlled-substances/register", operation_id = "getControlledSubstanceRegister", tag = "pharmacy", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<ControlledSubstanceRegisterItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_controlled_register(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<ControlledSubstanceRegisterItem>>, ApiError> {
    require_inventory_access(
        &user,
        state.facility_id(),
        PermissionCode::ControlledSubstanceManage,
    )?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_controlled_substance_register(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "controlled_register_list_failed",
                "Controlled register could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/pharmacy/controlled-substances/register", operation_id = "postControlledSubstanceRegister", tag = "pharmacy", security(("bearerAuth" = [])), request_body = CreateControlledSubstanceMovementRequest, responses((status = 200, body = ObjectResponse<ControlledSubstanceRegisterItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn create_controlled_movement(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateControlledSubstanceMovementRequest>,
) -> Result<Json<ObjectResponse<ControlledSubstanceRegisterItem>>, ApiError> {
    require_inventory_access(
        &user,
        state.facility_id(),
        PermissionCode::ControlledSubstanceManage,
    )?;
    if payload.quantity_delta == 0 {
        return Err(validation_error(
            "quantity_delta",
            "This value cannot be zero.",
        ));
    }
    if payload.quantity_delta < 0 && payload.witness_user_id.is_none() {
        return Err(validation_error("witness_user_id", "Witness is required."));
    }
    let entry = state
        .create_controlled_substance_movement(
            payload.item_id,
            payload.location_id,
            payload.movement_type,
            payload.quantity_delta,
            payload.witness_user_id,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "controlled_register_create_failed",
                "Controlled register entry could not be saved.",
            )
        })?;
    Ok(Json(object(entry)))
}

#[utoipa::path(get, path = "/api/v2/pharmacy/dispenses", operation_id = "getPharmacyDispenses", tag = "pharmacy", security(("bearerAuth" = [])), params(InventoryListQuery), responses((status = 200, body = ListResponse<PharmacyDispenseListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_dispenses(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<InventoryListQuery>,
) -> Result<Json<ListResponse<PharmacyDispenseListItem>>, ApiError> {
    require_inventory_list_access(&user, state.facility_id())?;
    require_permission(&user, PermissionCode::PharmacyDispense).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view pharmacy dispenses.",
        )
    })?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_pharmacy_dispenses(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "pharmacy_dispense_list_failed",
                "Dispenses could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.dispensed_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/pharmacy/dispenses", operation_id = "postPharmacyDispenses", tag = "pharmacy", security(("bearerAuth" = [])), request_body = CreatePharmacyDispenseRequest, responses((status = 200, body = ObjectResponse<PharmacyDispenseListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_dispense(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreatePharmacyDispenseRequest>,
) -> Result<Json<ObjectResponse<PharmacyDispenseListItem>>, ApiError> {
    require_inventory_access(&user, state.facility_id(), PermissionCode::PharmacyDispense)?;
    require_positive(payload.quantity, "quantity")?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let dispense = state
        .create_pharmacy_dispense(
            payload.patient_id,
            payload.item_id,
            payload.location_id,
            payload.quantity,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "pharmacy_dispense_create_failed",
                "Dispense could not be saved.",
            )
        })?;
    Ok(Json(object(dispense)))
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

fn require_inventory_list_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    if !has_permission(user, PermissionCode::InventoryView)
        && !has_permission(user, PermissionCode::InventoryManage)
        && !has_permission(user, PermissionCode::PharmacyDispense)
        && !has_permission(user, PermissionCode::ControlledSubstanceManage)
    {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have inventory access.",
        ));
    }
    if user.facility_id != facility_id {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have inventory access.",
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
            "You do not have patient workflow access.",
        ))
    }
}

fn require_inventory_access(
    user: &AuthUser,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    require_permission(user, permission)
        .and_then(|_| require_permission(user, PermissionCode::PatientDemographicsView))
        .map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission for this action.",
            )
        })?;
    if user.facility_id == facility_id {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "permission_denied",
            "You do not have permission for this action.",
        ))
    }
}

fn has_permission(user: &AuthUser, permission: PermissionCode) -> bool {
    user.permissions.contains(&permission)
}

fn page_request(query: InventoryListQuery) -> Result<(Option<InventoryCursor>, u8), ApiError> {
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

fn decode_cursor(value: &str) -> Result<InventoryCursor, ApiError> {
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
    Ok(InventoryCursor { occurred_at, id })
}

fn normalize_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation_error(field, "This field is required."));
    }
    if value.chars().count() > MAX_TEXT_LEN {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(value.to_owned())
}

fn require_positive(value: i64, field: &'static str) -> Result<(), ApiError> {
    if value <= 0 {
        return Err(validation_error(
            field,
            "This value must be greater than zero.",
        ));
    }
    Ok(())
}

fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error =
        ApiError::bad_request("invalid_inventory_request", "Inventory request is invalid.");
    error.details = json!({ field: [message] });
    error
}
