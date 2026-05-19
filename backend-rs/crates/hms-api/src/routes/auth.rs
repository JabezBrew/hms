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
        .route("/password", post(auth::change_password))
        .route("/sessions", get(auth::list_sessions))
        .route("/sessions/revoke-all", post(auth::revoke_all_sessions))
        .route("/sessions/:session_id/revoke", post(auth::revoke_session))
        .route("/mfa/status", get(auth::mfa_status))
        .route(
            "/mfa/webauthn/register/options",
            post(auth::webauthn_registration_options),
        )
        .route(
            "/mfa/webauthn/register/verify",
            post(auth::webauthn_registration_verify),
        )
        .route(
            "/mfa/webauthn/authenticate/options",
            post(auth::webauthn_authentication_options),
        )
        .route(
            "/mfa/webauthn/authenticate/verify",
            post(auth::webauthn_authentication_verify),
        )
        .route("/mfa/recovery-codes", post(auth::generate_recovery_codes))
        .route(
            "/password-reset/request",
            post(auth::request_password_reset),
        )
        .route(
            "/password-reset/complete",
            post(auth::complete_password_reset),
        )
}
