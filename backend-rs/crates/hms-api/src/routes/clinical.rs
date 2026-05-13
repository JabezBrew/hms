use axum::routing::{get, post};
use axum::Router;

use crate::handlers::clinical;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/clinical/note-templates",
            get(clinical::list_note_templates),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/notes",
            get(clinical::list_notes).post(clinical::create_note),
        )
        .route(
            "/api/v2/clinical/notes/:note_id/versions",
            get(clinical::list_note_versions).post(clinical::create_note_version),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/problems",
            get(clinical::list_problems).post(clinical::create_problem),
        )
        .route(
            "/api/v2/clinical/problems/:id",
            get(clinical::get_problem).patch(clinical::update_problem),
        )
        .route(
            "/api/v2/clinical/problems/:id/status",
            post(clinical::change_problem_status),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/allergies",
            get(clinical::list_allergies).post(clinical::create_allergy),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/prescriptions",
            get(clinical::list_prescriptions).post(clinical::create_prescription),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/chart-entries",
            get(clinical::list_chart_entries).post(clinical::create_chart_entry),
        )
}
