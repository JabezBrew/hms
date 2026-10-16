use crate::{handlers::inventory_standing as h, state::AppState};
use axum::{
    routing::{get, post},
    Router,
};
pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/inventory/requisitions/:id/review/cancel",
            post(h::cancel_request),
        )
        .route(
            "/api/v2/inventory/requisitions/:id/review/approve",
            post(h::approve_request),
        )
        .route(
            "/api/v2/inventory/requisitions/:id/issue",
            post(h::issue_request),
        )
        .route(
            "/api/v2/inventory/standing-order-templates",
            get(h::list).post(h::create),
        )
        .route(
            "/api/v2/inventory/standing-order-templates/:id",
            get(h::detail).patch(h::update),
        )
        .route(
            "/api/v2/inventory/standing-order-templates/:id/status",
            post(h::status),
        )
        .route(
            "/api/v2/inventory/standing-order-templates/:id/runs",
            post(h::generate),
        )
        .route("/api/v2/inventory/requisitions/:id/review", get(h::review))
}
