use axum::routing::get;
use axum::Router;

use crate::handlers::inventory;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/inventory/categories",
            get(inventory::list_categories),
        )
        .route("/api/v2/inventory/items", get(inventory::list_items))
        .route(
            "/api/v2/inventory/storage-locations",
            get(inventory::list_locations),
        )
        .route(
            "/api/v2/inventory/stock-batches",
            get(inventory::list_batches).post(inventory::create_batch),
        )
        .route(
            "/api/v2/inventory/stock-movements",
            get(inventory::list_movements),
        )
        .route(
            "/api/v2/inventory/transfers",
            get(inventory::list_transfers).post(inventory::create_transfer),
        )
        .route(
            "/api/v2/inventory/requisitions",
            get(inventory::list_requisitions).post(inventory::create_requisition),
        )
        .route(
            "/api/v2/inventory/purchase-orders",
            get(inventory::list_purchase_orders).post(inventory::create_purchase_order),
        )
        .route(
            "/api/v2/inventory/goods-received-notes",
            get(inventory::list_grns).post(inventory::create_grn),
        )
        .route(
            "/api/v2/pharmacy/controlled-substances/register",
            get(inventory::list_controlled_register).post(inventory::create_controlled_movement),
        )
        .route(
            "/api/v2/pharmacy/dispenses",
            get(inventory::list_dispenses).post(inventory::create_dispense),
        )
}
