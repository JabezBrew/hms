use axum::routing::{get, post};
use axum::Router;

use crate::handlers::care;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/appointments",
            get(care::list_appointments).post(care::create_appointment),
        )
        .route(
            "/api/v2/appointments/:id",
            get(care::get_appointment).patch(care::update_appointment),
        )
        .route(
            "/api/v2/appointments/:id/cancel",
            post(care::cancel_appointment),
        )
        .route("/api/v2/visits", get(care::list_visits))
        .route("/api/v2/visits/check-in", post(care::check_in_visit))
        .route("/api/v2/visits/:id/call", post(care::call_visit))
        .route(
            "/api/v2/visits/:id/start-consultation",
            post(care::start_visit_consultation),
        )
        .route("/api/v2/visits/:id/checkout", post(care::checkout_visit))
        .route(
            "/api/v2/triage",
            get(care::list_triage).post(care::create_triage),
        )
        .route("/api/v2/triage/:id/assign", post(care::assign_triage))
        .route(
            "/api/v2/encounters",
            get(care::list_encounters).post(care::create_encounter),
        )
        .route(
            "/api/v2/encounters/:id",
            get(care::get_encounter).patch(care::update_encounter),
        )
        .route(
            "/api/v2/encounters/:id/complete",
            post(care::complete_encounter),
        )
        .route(
            "/api/v2/encounters/:id/cancel",
            post(care::cancel_encounter),
        )
        .route(
            "/api/v2/encounters/:id/care-team",
            get(care::list_care_team).post(care::create_care_team_assignment),
        )
}
