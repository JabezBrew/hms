use crate::{handlers::appointment_series as h, state::AppState};
use axum::{
    routing::{get, post},
    Router,
};
pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/scheduling/appointment-series",
            get(h::list).post(h::create),
        )
        .route(
            "/api/v2/scheduling/appointment-series/requests/:client_request_id",
            get(h::by_request),
        )
        .route("/api/v2/scheduling/appointment-series/:id", get(h::get))
        .route(
            "/api/v2/scheduling/appointment-series/:id/cancel-future",
            post(h::cancel_future),
        )
}
