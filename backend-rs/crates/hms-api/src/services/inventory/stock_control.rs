use hms_db::inventory::{
    NewStandingOrder, NewStockBatch, NewStockRequisition, NewStockTransfer, StandingOrderFilters,
    StockRequisitionFilters, StockTransferFilters, SupplyDispenseLine,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::inventory::{
    CreateStandingOrderRequest, CreateStockBatchRequest, CreateStockCheckRequest,
    CreateStockRequisitionRequest, CreateStockTransferRequest, DispenseSupplyRequest,
    InventoryItemStockLocationItem, InventoryListQuery, RejectStockRequisitionRequest,
    StandingOrderListItem, StandingOrderListQuery, StockBatchListItem, StockBatchListQuery,
    StockCheckQueueItem, StockMovementListItem, StockRequisitionListItem,
    StockRequisitionListQuery, StockTransferListItem, StockTransferListQuery,
    StorageLocationStockItem, SupplyRequestDispenseResult, UpdateStockCheckStatusRequest,
};
use uuid::Uuid;

use super::common::{
    decode_page, encode_cursor, ensure_item_exists, ensure_location_exists, normalize_text,
    page_request, page_response, require_inventory_access, require_inventory_list_access,
    require_positive, static_list, stock_batch_page_request,
};
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct StockControlService {
    state: AppState,
}

impl StockControlService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_item_batches(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: InventoryListQuery,
    ) -> Result<ListResponse<StockBatchListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        ensure_item_exists(&self.state, id).await?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::inventory::list_item_batches(
            self.pool(),
            self.facility_id(),
            id,
            cursor,
            i64::from(page_size) + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "inventory_item_batch_list_failed",
                "Item stock batches could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.received_at, item.id)
        }))
    }

    pub async fn list_item_movements(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: InventoryListQuery,
    ) -> Result<ListResponse<StockMovementListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        ensure_item_exists(&self.state, id).await?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::inventory::list_item_movements(
            self.pool(),
            self.facility_id(),
            id,
            cursor,
            i64::from(page_size) + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "inventory_item_movement_list_failed",
                "Item stock movements could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_item_stock_by_location(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ListResponse<InventoryItemStockLocationItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        ensure_item_exists(&self.state, id).await?;
        let rows =
            hms_db::inventory::list_item_stock_by_location(self.pool(), self.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "inventory_item_location_stock_failed",
                        "Item stock by location could not be loaded.",
                    )
                })?;
        Ok(static_list(rows))
    }

    pub async fn list_location_stock(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: InventoryListQuery,
    ) -> Result<ListResponse<StorageLocationStockItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        ensure_location_exists(&self.state, id).await?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::inventory::list_storage_location_stock(
            self.pool(),
            self.facility_id(),
            id,
            cursor,
            i64::from(page_size) + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "storage_location_stock_failed",
                "Location stock could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.last_received_at, item.item_id)
        }))
    }

    pub async fn list_batches(
        &self,
        ctx: &hms_access::RequestContext,
        query: StockBatchListQuery,
    ) -> Result<ListResponse<StockBatchListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size, filters) = stock_batch_page_request(query)?;
        let rows = hms_db::inventory::list_batches(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            filters,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_batch_list_failed",
                "Stock batches could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.received_at, item.id)
        }))
    }

    pub async fn create_batch(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateStockBatchRequest,
    ) -> Result<ObjectResponse<StockBatchListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        require_positive(payload.quantity_received, "quantity_received")?;
        let batch_number = normalize_text(payload.batch_number, "batch_number")?;
        let batch = hms_db::inventory::create_batch(
            self.pool(),
            NewStockBatch {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                item_id: payload.item_id,
                location_id: payload.location_id,
                batch_number,
                expires_on: payload.expires_on,
                quantity_received: payload.quantity_received,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_batch_create_failed",
                "Stock batch could not be saved.",
            )
        })?;
        Ok(object(batch))
    }

    pub async fn list_movements(
        &self,
        ctx: &hms_access::RequestContext,
        query: InventoryListQuery,
    ) -> Result<ListResponse<StockMovementListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::inventory::list_movements(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_movement_list_failed",
                "Stock movements could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_transfers(
        &self,
        ctx: &hms_access::RequestContext,
        query: StockTransferListQuery,
    ) -> Result<ListResponse<StockTransferListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::inventory::list_transfers(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            StockTransferFilters {
                search: query.search,
                status: query.status,
                from_location_id: query.from_location,
                to_location_id: query.to_location,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_transfer_list_failed",
                "Transfers could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_transfer(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StockTransferListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        let transfer = hms_db::inventory::get_transfer(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "stock_transfer_load_failed",
                    "Transfer could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("stock_transfer_not_found", "Transfer could not be found.")
            })?;
        Ok(object(transfer))
    }

    pub async fn create_transfer(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateStockTransferRequest,
    ) -> Result<ObjectResponse<StockTransferListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        require_positive(payload.quantity, "quantity")?;
        let transfer = hms_db::inventory::create_transfer(
            self.pool(),
            NewStockTransfer {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                item_id: payload.item_id,
                from_location_id: payload.from_location_id,
                to_location_id: payload.to_location_id,
                quantity: payload.quantity,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_transfer_create_failed",
                "Transfer could not be saved.",
            )
        })?;
        Ok(object(transfer))
    }

    pub async fn list_requisitions(
        &self,
        ctx: &hms_access::RequestContext,
        query: StockRequisitionListQuery,
    ) -> Result<ListResponse<StockRequisitionListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::inventory::list_requisitions(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            StockRequisitionFilters {
                search: query.search,
                status: query.status,
                priority: query.priority,
                requesting_location_id: query.requesting_location,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_requisition_list_failed",
                "Requisitions could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_requisition(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StockRequisitionListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        Ok(object(
            load_requisition(self.pool(), self.facility_id(), id).await?,
        ))
    }

    pub async fn create_requisition(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateStockRequisitionRequest,
    ) -> Result<ObjectResponse<StockRequisitionListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let requisition = hms_db::inventory::create_requisition(
            self.pool(),
            NewStockRequisition {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                requesting_location_id: payload.requesting_location_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_requisition_create_failed",
                "Requisition could not be saved.",
            )
        })?;
        Ok(object(requisition))
    }

    pub async fn submit_requisition(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StockRequisitionListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let requisition =
            hms_db::inventory::submit_requisition(self.pool(), self.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "stock_requisition_submit_failed",
                        "Requisition could not be submitted.",
                    )
                })?
                .ok_or_else(requisition_not_found)?;
        Ok(object(requisition))
    }

    pub async fn approve_requisition(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StockRequisitionListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let requisition =
            hms_db::inventory::approve_requisition(self.pool(), self.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "stock_requisition_approve_failed",
                        "Requisition could not be approved.",
                    )
                })?
                .ok_or_else(requisition_not_found)?;
        Ok(object(requisition))
    }

    pub async fn fulfill_requisition(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StockRequisitionListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let requisition =
            hms_db::inventory::fulfill_requisition(self.pool(), self.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "stock_requisition_fulfill_failed",
                        "Requisition could not be fulfilled.",
                    )
                })?
                .ok_or_else(requisition_not_found)?;
        Ok(object(requisition))
    }

    pub async fn reject_requisition(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: RejectStockRequisitionRequest,
    ) -> Result<ObjectResponse<StockRequisitionListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let reason = normalize_text(payload.reason, "reason")?;
        let requisition =
            hms_db::inventory::reject_requisition(self.pool(), self.facility_id(), id, reason)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "stock_requisition_reject_failed",
                        "Requisition could not be rejected.",
                    )
                })?
                .ok_or_else(requisition_not_found)?;
        Ok(object(requisition))
    }

    pub async fn cancel_requisition(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StockRequisitionListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let requisition =
            hms_db::inventory::cancel_requisition(self.pool(), self.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "stock_requisition_cancel_failed",
                        "Requisition could not be cancelled.",
                    )
                })?
                .ok_or_else(requisition_not_found)?;
        Ok(object(requisition))
    }

    pub async fn create_standing_order(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateStandingOrderRequest,
    ) -> Result<ObjectResponse<StandingOrderListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        ensure_location_exists(&self.state, payload.requesting_location_id).await?;
        let order = hms_db::inventory::create_standing_order(
            self.pool(),
            NewStandingOrder {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                requesting_location_id: payload.requesting_location_id,
                frequency: payload.frequency,
                next_run_on: payload.next_run_on,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "standing_order_create_failed",
                "Standing order could not be saved.",
            )
        })?;
        Ok(object(order))
    }

    pub async fn list_standing_orders(
        &self,
        ctx: &hms_access::RequestContext,
        query: StandingOrderListQuery,
    ) -> Result<ListResponse<StandingOrderListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::inventory::list_standing_orders(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            StandingOrderFilters {
                search: query.search,
                status: query.status,
                is_active: query.is_active,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "standing_order_list_failed",
                "Standing orders could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn generate_standing_order_requisition(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StockRequisitionListItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let requisition = hms_db::inventory::generate_draft_requisition_from_standing_order(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "standing_order_generate_failed",
                "Standing order requisition could not be generated.",
            )
        })?;
        Ok(object(requisition))
    }

    pub async fn dispense_supply_request(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: DispenseSupplyRequest,
    ) -> Result<ObjectResponse<SupplyRequestDispenseResult>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let lines = payload
            .lines
            .into_iter()
            .map(|line| {
                require_positive(line.quantity, "quantity")?;
                Ok(SupplyDispenseLine {
                    item_id: line.item_id,
                    location_id: line.location_id,
                    quantity: line.quantity,
                })
            })
            .collect::<Result<Vec<_>, ApiError>>()?;
        let result = hms_db::inventory::dispense_supply_request(
            self.pool(),
            self.facility_id(),
            id,
            lines,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "supply_request_dispense_failed",
                "Supply request could not be dispensed.",
            )
        })?;
        Ok(object(result))
    }

    pub async fn enqueue_stock_check(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateStockCheckRequest,
    ) -> Result<ObjectResponse<StockCheckQueueItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        ensure_location_exists(&self.state, payload.location_id).await?;
        let check = hms_db::inventory::enqueue_stock_check(
            self.pool(),
            self.facility_id(),
            payload.location_id,
            normalize_text(payload.reason, "reason")?,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_check_queue_failed",
                "Stock check could not be queued.",
            )
        })?;
        Ok(object(check))
    }

    pub async fn transition_stock_check(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdateStockCheckStatusRequest,
    ) -> Result<ObjectResponse<StockCheckQueueItem>, ApiError> {
        require_stock_write_access(ctx, self.facility_id())?;
        let check = hms_db::inventory::transition_stock_check(
            self.pool(),
            self.facility_id(),
            id,
            payload.status,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_check_transition_failed",
                "Stock check could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("stock_check_not_found", "Stock check was not found.")
        })?;
        Ok(object(check))
    }
}

fn require_stock_write_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    require_inventory_access(ctx, facility_id, PermissionCode::InventoryManage)
}

async fn load_requisition(
    pool: &hms_db::PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> Result<StockRequisitionListItem, ApiError> {
    hms_db::inventory::get_requisition(pool, facility_id, id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "stock_requisition_load_failed",
                "Requisition could not be loaded.",
            )
        })?
        .ok_or_else(requisition_not_found)
}

fn requisition_not_found() -> ApiError {
    ApiError::not_found(
        "stock_requisition_not_found",
        "Requisition could not be found.",
    )
}
