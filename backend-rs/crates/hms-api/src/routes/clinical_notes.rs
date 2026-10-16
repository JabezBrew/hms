use crate::{handlers::clinical_notes as h, state::AppState};
use axum::{
    routing::{get, post},
    Router,
};
pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/patients/:patient_id/clinical/notes/record",
            post(h::record),
        )
        .route("/api/v2/clinical/notes/:note_id/amendments", post(h::amend))
        .route(
            "/api/v2/patients/:patient_id/clinical/note-requests/:request_id",
            get(h::receipt),
        )
        .route("/api/v2/clinical/notes/:note_id/history", get(h::history))
        .route(
            "/api/v2/clinical/notes/:note_id/versions/:version_id",
            get(h::version),
        )
        .route(
            "/api/v2/clinical/note-templates/record",
            post(h::record_template),
        )
        .route(
            "/api/v2/clinical/note-templates/:id/changes",
            post(h::change_template),
        )
        .route(
            "/api/v2/clinical/note-templates/requests/:request_id",
            get(h::template_receipt),
        )
}
