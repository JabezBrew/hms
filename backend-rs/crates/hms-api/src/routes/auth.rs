use axum::routing::{get, post};
use axum::Router;

use crate::handlers::auth;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/login", post(auth::login))
        .route("/refresh", post(auth::refresh))
        .route("/logout", post(auth::logout))
        .route("/me", get(auth::me).patch(auth::update_me))
        .route(
            "/password-reset/request",
            post(auth::request_password_reset),
        )
        .route(
            "/password-reset/complete",
            post(auth::complete_password_reset),
        )
}
