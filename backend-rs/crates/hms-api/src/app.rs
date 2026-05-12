use axum::middleware;
use axum::routing::get;
use axum::{Json, Router};

use crate::middleware::request_id;
use crate::openapi::openapi_value;
use crate::routes;
use crate::state::AppState;

pub fn build_app(state: AppState) -> Router {
    Router::new()
        .nest("/api/v2/health", routes::health::routes())
        .nest("/api/v2/auth", routes::auth::routes())
        .nest("/api/v2/system", routes::system::routes())
        .merge(routes::patients::routes())
        .merge(routes::care::routes())
        .merge(routes::ward::routes())
        .merge(routes::clinical::routes())
        .merge(routes::consent::routes())
        .merge(routes::laboratory::routes())
        .merge(routes::inventory::routes())
        .merge(routes::billing::routes())
        .merge(routes::referrals::routes())
        .merge(routes::admin::routes())
        .merge(routes::dashboard::routes())
        .route("/api/v2/metrics", get(crate::handlers::health::metrics))
        .route("/api/v2/openapi.json", get(openapi_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            request_id::layer,
        ))
        .with_state(state)
}

async fn openapi_handler() -> Json<serde_json::Value> {
    Json(openapi_value())
}
