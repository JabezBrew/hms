use crate::{handlers::admission_advisories as h, state::AppState};
use axum::{
    routing::{get, post},
    Router,
};
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v2/patients/:patient_id/chronicle/admission-advisory-cases",get(h::cases))
        .route("/api/v2/patients/:patient_id/chronicle/admissions/:case_id/advisories",get(h::context).post(h::create))
        .route("/api/v2/patients/:patient_id/chronicle/admissions/:case_id/advisories/requests/:request_id",get(h::receipt))
        .route("/api/v2/patients/:patient_id/chronicle/admissions/:case_id/advisories/:advisory_id",get(h::detail))
        .route("/api/v2/patients/:patient_id/chronicle/admissions/:case_id/advisories/:advisory_id/decision",post(h::decide))
}
