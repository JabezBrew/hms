use axum::routing::{get, patch, post};
use axum::Router;

use crate::handlers::patients;
use crate::handlers::ward_rounds;
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
            "/api/v2/patients/:patient_id/chronicle/ward-rounds/current",
            get(ward_rounds::current),
        )
        .route(
            "/api/v2/patients/:patient_id/chronicle/ward-rounds",
            post(ward_rounds::create),
        )
        .route(
            "/api/v2/patients/:patient_id/chronicle/ward-rounds/:round_id",
            get(ward_rounds::get).patch(ward_rounds::update),
        )
        .route(
            "/api/v2/patients/:patient_id/chronicle/ward-rounds/:round_id/actions",
            post(ward_rounds::create_action),
        )
        .route(
            "/api/v2/patients/:patient_id/chronicle/ward-rounds/:round_id/actions/:action_id",
            patch(ward_rounds::update_action).delete(ward_rounds::delete_action),
        )
        .route(
            "/api/v2/patients/:patient_id/chronicle/ward-rounds/:round_id/commit",
            post(ward_rounds::commit),
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
