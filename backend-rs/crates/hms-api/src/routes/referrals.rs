use axum::routing::{get, post};
use axum::Router;

use crate::handlers::referrals;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/patients/:patient_id/referrals/:referral_id/consultation",
            get(crate::handlers::referral_consultations::context),
        )
        .route(
            "/api/v2/patients/:patient_id/referrals/:referral_id/consultation/start",
            post(crate::handlers::referral_consultations::start),
        )
        .route(
            "/api/v2/patients/:patient_id/referrals/:referral_id/consultation/requests/:request_id",
            get(crate::handlers::referral_consultations::receipt),
        )
        .route(
            "/api/v2/patients/:patient_id/referrals/:referral_id/response",
            get(referrals::response_context),
        )
        .route(
            "/api/v2/patients/:patient_id/referrals/:referral_id/response/commands",
            post(referrals::response_command),
        )
        .route(
            "/api/v2/patients/:patient_id/referrals/:referral_id/response/history",
            get(referrals::response_history),
        )
        .route(
            "/api/v2/patients/:patient_id/referrals/:referral_id/response/versions/:version_id",
            get(referrals::response_version),
        )
        .route(
            "/api/v2/patients/:patient_id/referrals/:referral_id/response/requests/:request_id",
            get(referrals::response_receipt),
        )
        .route(
            "/api/v2/referrals",
            get(referrals::list_referrals).post(referrals::create_referral),
        )
        .route(
            "/api/v2/referrals/sla-dashboard",
            get(referrals::get_referral_sla_dashboard),
        )
        .route("/api/v2/referrals/:id", get(referrals::get_referral))
        .route(
            "/api/v2/referrals/:id/accept",
            post(referrals::accept_referral),
        )
        .route(
            "/api/v2/referrals/:id/decline",
            post(referrals::decline_referral),
        )
        .route(
            "/api/v2/referrals/:id/complete",
            post(referrals::complete_referral),
        )
        .route(
            "/api/v2/referrals/:id/schedule",
            post(referrals::schedule_referral_appointment),
        )
        .route(
            "/api/v2/referrals/:id/sla-state",
            get(referrals::get_referral_sla_state),
        )
        .route(
            "/api/v2/referrals/clinic-waitlist",
            get(referrals::list_clinic_waitlist_entries)
                .post(referrals::create_clinic_waitlist_entry),
        )
        .route(
            "/api/v2/referrals/clinic-waitlist/offer-next",
            post(referrals::offer_next_clinic_waitlist_entry),
        )
        .route(
            "/api/v2/referrals/clinic-waitlist/:id/promote",
            post(referrals::promote_clinic_waitlist_entry),
        )
        .route(
            "/api/v2/referrals/clinic-waitlist/:id/cancel",
            post(referrals::cancel_clinic_waitlist_entry),
        )
}
