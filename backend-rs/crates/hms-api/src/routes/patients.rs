use axum::routing::get;
use axum::Router;

use crate::handlers::patients;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/patients",
            get(patients::list_patients).post(patients::create_patient),
        )
        .route(
            "/api/v2/patients/context",
            get(patients::list_context_patients),
        )
        .route(
            "/api/v2/patients/validation-rules",
            get(patients::list_patient_validation_rules),
        )
        .route(
            "/api/v2/patients/:id/chronicle",
            get(patients::get_patient_chronicle),
        )
        .route(
            "/api/v2/patients/:id/chronicle/timeline",
            get(patients::list_patient_chronicle_timeline),
        )
        .route(
            "/api/v2/patients/:id/chronicle/print",
            get(patients::get_patient_chronicle_print),
        )
        .route(
            "/api/v2/patients/:id/break-glass",
            axum::routing::post(patients::start_break_glass_grant),
        )
        .route(
            "/api/v2/patients/:id/break-glass/end",
            axum::routing::post(patients::end_break_glass_grants),
        )
        .route(
            "/api/v2/patients/:id",
            get(patients::get_patient).patch(patients::update_patient),
        )
}
