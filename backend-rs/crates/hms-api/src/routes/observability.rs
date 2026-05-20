use axum::routing::post;
use axum::Router;

use crate::handlers::observability;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/api/v2/observability/rum",
        post(observability::ingest_browser_rum),
    )
}
