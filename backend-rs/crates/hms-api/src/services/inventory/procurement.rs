use hms_db::inventory::{
    GoodsReceivedNoteFilters, NewGoodsReceivedNote, NewPurchaseOrder, PurchaseOrderFilters,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::inventory::{
    CreateGoodsReceivedNoteRequest, CreatePurchaseOrderRequest, GoodsReceivedNoteListItem,
    GoodsReceivedNoteListQuery, PurchaseOrderListItem, PurchaseOrderListQuery,
};
use uuid::Uuid;

use super::common::{
    decode_page, encode_cursor, normalize_text, page_response, require_inventory_access,
    require_inventory_list_access,
};
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct ProcurementService {
    state: AppState,
}

impl ProcurementService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_purchase_orders(
        &self,
        ctx: &hms_access::RequestContext,
        query: PurchaseOrderListQuery,
    ) -> Result<ListResponse<PurchaseOrderListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::inventory::list_purchase_orders(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            PurchaseOrderFilters {
                search: query.search,
                status: query.status,
                supplier: query.supplier,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "purchase_order_list_failed",
                "Purchase orders could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_purchase_order(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<PurchaseOrderListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        Ok(object(
            load_purchase_order(self.pool(), self.facility_id(), id).await?,
        ))
    }

    pub async fn create_purchase_order(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreatePurchaseOrderRequest,
    ) -> Result<ObjectResponse<PurchaseOrderListItem>, ApiError> {
        require_procurement_write_access(ctx, self.facility_id())?;
        let supplier_name = normalize_text(payload.supplier_name, "supplier_name")?;
        let order = hms_db::inventory::create_purchase_order(
            self.pool(),
            NewPurchaseOrder {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                supplier_name,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "purchase_order_create_failed",
                "Purchase order could not be saved.",
            )
        })?;
        Ok(object(order))
    }

    pub async fn approve_purchase_order(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<PurchaseOrderListItem>, ApiError> {
        require_procurement_write_access(ctx, self.facility_id())?;
        let order = hms_db::inventory::approve_purchase_order(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "purchase_order_approve_failed",
                    "Purchase order could not be approved.",
                )
            })?
            .ok_or_else(purchase_order_not_found)?;
        Ok(object(order))
    }

    pub async fn send_purchase_order(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<PurchaseOrderListItem>, ApiError> {
        require_procurement_write_access(ctx, self.facility_id())?;
        let order = hms_db::inventory::send_purchase_order(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "purchase_order_send_failed",
                    "Purchase order could not be sent.",
                )
            })?
            .ok_or_else(purchase_order_not_found)?;
        Ok(object(order))
    }

    pub async fn list_grns(
        &self,
        ctx: &hms_access::RequestContext,
        query: GoodsReceivedNoteListQuery,
    ) -> Result<ListResponse<GoodsReceivedNoteListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::inventory::list_grns(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
            GoodsReceivedNoteFilters {
                search: query.search,
                status: query.status,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "grn_list_failed",
                "Goods received notes could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.received_at, item.id)
        }))
    }

    pub async fn get_grn(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<GoodsReceivedNoteListItem>, ApiError> {
        require_inventory_list_access(ctx, self.facility_id())?;
        Ok(object(load_grn(self.pool(), self.facility_id(), id).await?))
    }

    pub async fn create_grn(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateGoodsReceivedNoteRequest,
    ) -> Result<ObjectResponse<GoodsReceivedNoteListItem>, ApiError> {
        require_procurement_write_access(ctx, self.facility_id())?;
        let grn = hms_db::inventory::create_grn(
            self.pool(),
            NewGoodsReceivedNote {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                purchase_order_id: payload.purchase_order_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "grn_create_failed",
                "Goods received note could not be saved.",
            )
        })?;
        Ok(object(grn))
    }

    pub async fn inspect_grn(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<GoodsReceivedNoteListItem>, ApiError> {
        require_procurement_write_access(ctx, self.facility_id())?;
        let grn = hms_db::inventory::inspect_grn(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "grn_inspect_failed",
                    "Goods received note could not be inspected.",
                )
            })?
            .ok_or_else(grn_not_found)?;
        Ok(object(grn))
    }

    pub async fn accept_grn(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<GoodsReceivedNoteListItem>, ApiError> {
        require_procurement_write_access(ctx, self.facility_id())?;
        let grn = hms_db::inventory::accept_grn(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "grn_accept_failed",
                    "Goods received note could not be accepted.",
                )
            })?
            .ok_or_else(grn_not_found)?;
        Ok(object(grn))
    }
}

fn require_procurement_write_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    require_inventory_access(ctx, facility_id, PermissionCode::InventoryManage)
}

async fn load_purchase_order(
    pool: &hms_db::PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> Result<PurchaseOrderListItem, ApiError> {
    hms_db::inventory::get_purchase_order(pool, facility_id, id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "purchase_order_load_failed",
                "Purchase order could not be loaded.",
            )
        })?
        .ok_or_else(purchase_order_not_found)
}

fn purchase_order_not_found() -> ApiError {
    ApiError::not_found(
        "purchase_order_not_found",
        "Purchase order could not be found.",
    )
}

async fn load_grn(
    pool: &hms_db::PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> Result<GoodsReceivedNoteListItem, ApiError> {
    hms_db::inventory::get_grn(pool, facility_id, id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "goods_received_note_load_failed",
                "Goods received note could not be loaded.",
            )
        })?
        .ok_or_else(grn_not_found)
}

fn grn_not_found() -> ApiError {
    ApiError::not_found(
        "goods_received_note_not_found",
        "Goods received note could not be found.",
    )
}
