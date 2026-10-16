use crate::{handlers::network, state::AppState};
use axum::{
    routing::{get, post},
    Router,
};
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v2/auth/network-access", get(network::current))
        .route(
            "/api/v2/admin/network-policy",
            get(network::settings).put(network::update),
        )
        .route(
            "/api/v2/admin/network-policy/preview",
            post(network::preview),
        )
}
