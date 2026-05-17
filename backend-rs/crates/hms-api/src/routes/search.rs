use axum::routing::post;
use axum::Router;

use crate::handlers::search;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/v2/search/omni", post(search::omni_search))
}
