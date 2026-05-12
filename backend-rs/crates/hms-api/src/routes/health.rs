use axum::routing::get;
use axum::Router;

use crate::handlers::health;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/alive", get(health::alive))
        .route("/ready", get(health::ready))
}
