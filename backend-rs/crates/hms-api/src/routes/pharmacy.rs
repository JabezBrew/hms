use axum::routing::{get, post};
use axum::Router;

use crate::handlers::pharmacy;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/pharmacy/dispensing-queue",
            get(pharmacy::list_queue),
        )
        .route(
            "/api/v2/pharmacy/dispensing-queue/:id",
            get(pharmacy::get_queue_item),
        )
        .route(
            "/api/v2/pharmacy/dispensing-queue/:id/dispense",
            post(pharmacy::dispense_queue_item),
        )
}
