use axum::routing::{get, post};
use axum::Router;

use crate::handlers::scheduling;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(super::appointment_series::routes())
        .route(
            "/api/v2/scheduling/services",
            get(scheduling::list_services).post(crate::handlers::appointment_types::create),
        )
        .route(
            "/api/v2/scheduling/services/administration",
            get(crate::handlers::appointment_types::list),
        )
        .route(
            "/api/v2/scheduling/services/commands/:client_request_id",
            get(crate::handlers::appointment_types::receipt),
        )
        .route(
            "/api/v2/scheduling/services/:id/administration",
            get(crate::handlers::appointment_types::detail),
        )
        .route(
            "/api/v2/scheduling/services/:id/metadata",
            post(crate::handlers::appointment_types::metadata),
        )
        .route(
            "/api/v2/scheduling/services/:id/retire",
            post(crate::handlers::appointment_types::retire),
        )
        .route(
            "/api/v2/scheduling/services/:id/reactivate",
            post(crate::handlers::appointment_types::reactivate),
        )
        .route(
            "/api/v2/scheduling/sessions",
            get(scheduling::list_sessions).post(scheduling::create_session),
        )
        .route(
            "/api/v2/scheduling/sessions/:id/cancel",
            post(scheduling::cancel_session),
        )
        .route(
            "/api/v2/scheduling/templates",
            get(scheduling::list_templates).post(scheduling::create_template),
        )
        .route(
            "/api/v2/scheduling/templates/generate",
            post(scheduling::generate_sessions),
        )
        .route(
            "/api/v2/scheduling/availability",
            get(scheduling::availability),
        )
        .route(
            "/api/v2/scheduling/appointments/book",
            post(scheduling::book_appointment),
        )
        .route(
            "/api/v2/scheduling/exceptions",
            get(scheduling::list_exceptions).post(scheduling::create_exception),
        )
        .route(
            "/api/v2/scheduling/appointments/:id/arrive",
            post(scheduling::arrive_appointment),
        )
}
