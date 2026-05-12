use axum::routing::{get, post};
use axum::Router;

use crate::handlers::laboratory;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/laboratory/test-catalog",
            get(laboratory::list_test_catalog),
        )
        .route("/api/v2/laboratory/panels", get(laboratory::list_panels))
        .route(
            "/api/v2/laboratory/orders",
            get(laboratory::list_orders).post(laboratory::create_order),
        )
        .route(
            "/api/v2/laboratory/specimens",
            get(laboratory::list_specimens).post(laboratory::create_specimen),
        )
        .route(
            "/api/v2/laboratory/results",
            get(laboratory::list_results).post(laboratory::create_result),
        )
        .route(
            "/api/v2/laboratory/results/:id/verify",
            post(laboratory::verify_result),
        )
}
