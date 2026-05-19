use axum::routing::{delete, get, post};
use axum::Router;

use crate::handlers::clinical;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/clinical/note-templates",
            get(clinical::list_note_templates).post(clinical::create_note_template),
        )
        .route(
            "/api/v2/clinical/note-templates/:id",
            get(clinical::get_note_template)
                .patch(clinical::update_note_template)
                .delete(clinical::delete_note_template),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/notes",
            get(clinical::list_notes).post(clinical::create_note),
        )
        .route(
            "/api/v2/clinical/notes/:note_id/versions",
            get(clinical::list_note_versions).post(clinical::create_note_version),
        )
        .route("/api/v2/clinical/notes/:note_id", get(clinical::get_note))
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
            "/api/v2/clinical/problem-links",
            get(clinical::list_problem_artifact_links).post(clinical::create_problem_artifact_link),
        )
        .route(
            "/api/v2/clinical/problem-links/:id",
            delete(clinical::delete_problem_artifact_link),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/pharmacy-context",
            get(clinical::get_pharmacy_clinical_context),
        )
        .route(
            "/api/v2/laboratory/orders/:order_id/clinical-context",
            get(clinical::get_laboratory_clinical_context),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/allergies",
            get(clinical::list_allergies).post(clinical::create_allergy),
        )
        .route(
            "/api/v2/clinical/allergies/:id",
            get(clinical::get_allergy)
                .patch(clinical::update_allergy)
                .delete(clinical::delete_allergy),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/prescriptions",
            get(clinical::list_prescriptions).post(clinical::create_prescription),
        )
        .route(
            "/api/v2/clinical/prescriptions/:id",
            get(clinical::get_prescription).patch(clinical::update_prescription),
        )
        .route(
            "/api/v2/patients/:patient_id/clinical/chart-entries",
            get(clinical::list_chart_entries).post(clinical::create_chart_entry),
        )
}
