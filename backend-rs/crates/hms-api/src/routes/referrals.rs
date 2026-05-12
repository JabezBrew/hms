use axum::routing::{get, post};
use axum::Router;

use crate::handlers::referrals;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
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
}
