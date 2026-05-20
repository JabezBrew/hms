use axum::routing::{get, post};
use axum::Router;

use crate::handlers::consent;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/consents",
            get(consent::list_consent_grants).post(consent::create_consent_grant),
        )
        .route(
            "/api/v2/consents/:id/revoke",
            post(consent::revoke_consent_grant),
        )
}
