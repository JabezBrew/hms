use axum::routing::{get, post};
use axum::Router;

use crate::handlers::{auth, auth_factor};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/setup/start", post(auth_factor::setup_start))
        .route("/login/passkey/options", post(auth_factor::login_options))
        .route("/login/passkey/verify", post(auth_factor::login_verify))
        .route("/login/setup/options", post(auth_factor::setup_options))
        .route("/login/setup/verify", post(auth_factor::setup_verify))
        .route("/login/recovery", post(auth_factor::recovery))
        .route("/reauthenticate", post(auth_factor::confirm_password))
        .route("/assurance", get(auth_factor::status))
        .route("/assurance/options", post(auth_factor::step_up_options))
        .route("/assurance/verify", post(auth_factor::step_up_verify))
        .route("/mfa/passkeys", get(auth_factor::keys))
        .route(
            "/mfa/passkeys/:id",
            axum::routing::patch(auth_factor::rename),
        )
        .route("/mfa/passkeys/:id/disable", post(auth_factor::disable))
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
