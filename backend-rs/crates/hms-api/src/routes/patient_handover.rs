use crate::{handlers::patient_handover as h, state::AppState};
use axum::{
    routing::{get, post},
    Router,
};
pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/nursing/patient-handovers",
            get(h::list).post(h::create),
        )
        .route(
            "/api/v2/nursing/patient-handovers/recipients",
            get(h::recipients),
        )
        .route(
            "/api/v2/nursing/patient-handovers/requests/:request_id",
            get(h::receipt),
        )
        .route("/api/v2/nursing/patient-handovers/:id", get(h::detail))
        .route(
            "/api/v2/nursing/patient-handovers/:id/history",
            get(h::history),
        )
        .route(
            "/api/v2/nursing/patient-handovers/:id/revisions/:revision_id",
            get(h::revision),
        )
        .route(
            "/api/v2/nursing/patient-handovers/:id/amend",
            post(h::amend),
        )
        .route("/api/v2/nursing/patient-handovers/:id/void", post(h::void))
}
