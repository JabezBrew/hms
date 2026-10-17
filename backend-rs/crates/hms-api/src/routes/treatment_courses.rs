use crate::{handlers::treatment_courses as h, state::AppState};
use axum::{
    routing::{get, post},
    Router,
};
pub fn routes() -> Router<AppState> {
    Router::new()
.route("/api/v2/patients/:patient_id/chronicle/admissions/:admission_case_id/medication-courses/context",get(h::context))
.route("/api/v2/patients/:patient_id/chronicle/admissions/:admission_case_id/medication-courses",get(h::list))
.route("/api/v2/patients/:patient_id/chronicle/admissions/:admission_case_id/medication-courses/:course_id",get(h::detail))
.route("/api/v2/patients/:patient_id/chronicle/admissions/:admission_case_id/medication-courses/:course_id/doses",get(h::doses))
.route("/api/v2/patients/:patient_id/chronicle/admissions/:admission_case_id/medication-courses/:course_id/supply",get(h::supply))
.route("/api/v2/patients/:patient_id/chronicle/admissions/:admission_case_id/medication-courses/:course_id/stop",post(h::stop))
.route("/api/v2/patients/:patient_id/chronicle/admissions/:admission_case_id/medication-courses/:course_id/supply-windows",post(h::window))
.route("/api/v2/patients/:patient_id/chronicle/admissions/:admission_case_id/medication-courses/:course_id/requests/:client_request_id",get(h::receipt))
}
