use axum::routing::get;
use axum::Router;

use crate::handlers::ops;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v2/ops/overview", get(ops::overview))
        .route("/api/v2/ops/route-latency", get(ops::route_latency))
        .route("/api/v2/ops/clinical-budgets", get(ops::clinical_budgets))
        .route("/api/v2/ops/db-pool", get(ops::db_pool))
        .route(
            "/api/v2/ops/request-context-cache",
            get(ops::request_context_cache),
        )
        .route("/api/v2/ops/payload", get(ops::payload))
        .route("/api/v2/ops/rum", get(ops::rum))
        .route(
            "/api/v2/ops/slow-query-fingerprints",
            get(ops::slow_query_fingerprints),
        )
        .route("/api/v2/ops/service-errors", get(ops::service_errors))
        .route("/api/v2/ops/deploys", get(ops::deploys))
        .route("/api/v2/ops/edge-status", get(ops::edge_status))
}
