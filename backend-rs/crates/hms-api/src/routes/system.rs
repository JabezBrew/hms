use axum::routing::get;
use axum::Router;

use crate::handlers::system;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/deployment-capabilities",
        get(system::deployment_capabilities),
    )
}
