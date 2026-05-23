use axum::routing::get;
use axum::Router;

use crate::handlers::ops;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v2/ops/overview", get(ops::overview))
        .route("/api/v2/ops/performance", get(ops::performance))
        .route("/api/v2/ops/database", get(ops::database))
        .route("/api/v2/ops/frontend", get(ops::frontend))
}
