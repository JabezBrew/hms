//! Exact method/route policy: no caller-provided onsite assertions.
use crate::{extractors, network_access, state::AppState};
use axum::{
    extract::{MatchedPath, Request, State},
    http::{header::AUTHORIZATION, Method},
    middleware::Next,
    response::{IntoResponse, Response},
};

/// These operations only authenticate or manage the caller's own credentials
/// and sessions. They never expose patient data or mutate clinical workflows.
pub(crate) fn lifecycle_exception(method: &Method, path: &str) -> bool {
    matches!(
        (method.as_str(), path),
        ("PATCH", "/api/v2/auth/mfa/passkeys/:id")
    ) || matches!(
        (method.as_str(), path),
        (
            "GET" | "HEAD",
            "/api/v2/health/alive" | "/api/v2/health/ready"
        ) | (
            "GET",
            "/api/v2/auth/me"
                | "/api/v2/auth/network-access"
                | "/api/v2/auth/sessions"
                | "/api/v2/auth/mfa/status"
                | "/api/v2/auth/assurance"
                | "/api/v2/auth/mfa/passkeys"
        ) | (
            "POST",
            "/api/v2/auth/login"
                | "/api/v2/auth/setup/start"
                | "/api/v2/auth/login/passkey/options"
                | "/api/v2/auth/login/passkey/verify"
                | "/api/v2/auth/login/setup/options"
                | "/api/v2/auth/login/setup/verify"
                | "/api/v2/auth/login/recovery"
                | "/api/v2/auth/assurance/options"
                | "/api/v2/auth/assurance/verify"
                | "/api/v2/auth/mfa/passkeys/:id/disable"
                | "/api/v2/auth/refresh"
                | "/api/v2/auth/logout"
                | "/api/v2/auth/password"
                | "/api/v2/auth/password-reset/request"
                | "/api/v2/auth/password-reset/complete"
                | "/api/v2/auth/sessions/revoke-all"
                | "/api/v2/auth/sessions/:session_id/revoke"
                | "/api/v2/auth/mfa/webauthn/register/options"
                | "/api/v2/auth/mfa/webauthn/register/verify"
                | "/api/v2/auth/mfa/webauthn/authenticate/options"
                | "/api/v2/auth/mfa/webauthn/authenticate/verify"
                | "/api/v2/auth/mfa/recovery-codes"
        )
    )
}
/// Existing PHI-safe POST list contracts delegate to the same read services as
/// GET. Identity lookup persists a review session and intentionally is absent.
pub(crate) fn read_post(method: &Method, path: &str) -> bool {
    method == Method::POST
        && matches!(
            path,
            "/api/v2/patients/search"
                | "/api/v2/patients/context/search"
                | "/api/v2/wards/board/search"
                | "/api/v2/search/omni"
                | "/api/v2/appointments/search"
                | "/api/v2/encounters/search"
                | "/api/v2/patients/:patient_id/clinical/note-template-previews"
                | "/api/v2/admin/audit-events/search"
                | "/api/v2/laboratory/orders/search"
                | "/api/v2/laboratory/results/search"
                | "/api/v2/billing/patient-insurances/search"
                | "/api/v2/billing/invoices/search"
                | "/api/v2/billing/payment-intents/search"
                | "/api/v2/billing/settlements/search"
                | "/api/v2/billing/settlements/:id/lines/search"
                | "/api/v2/billing/payments/search"
                | "/api/v2/nhis/claims/search"
                | "/api/v2/nhis/remittance-imports/:id/lines/search"
        )
}

fn ops_read(method: &Method, path: &str) -> bool {
    matches!(*method, Method::GET | Method::HEAD)
        && matches!(
            path,
            "/api/v2/ops/overview"
                | "/api/v2/ops/performance"
                | "/api/v2/ops/database"
                | "/api/v2/ops/frontend"
                | "/api/v2/ops/route-latency"
                | "/api/v2/ops/clinical-budgets"
                | "/api/v2/ops/db-pool"
                | "/api/v2/ops/request-context-cache"
                | "/api/v2/ops/payload"
                | "/api/v2/ops/rum"
                | "/api/v2/ops/slow-query-fingerprints"
                | "/api/v2/ops/service-errors"
                | "/api/v2/ops/deploys"
                | "/api/v2/ops/edge-status"
        )
}

pub async fn layer(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request
        .extensions()
        .get::<MatchedPath>()
        .map(|value| value.as_str())
        .unwrap_or("")
        .to_owned();
    if lifecycle_exception(request.method(), &path) {
        return next.run(request).await;
    }
    let (mut parts, body) = request.into_parts();
    // Non-HMS auth providers retain their own guards. Public schema/metrics remain
    // network-governed reads; ordinary unauthenticated workflows still return401
    // from their existing extractor without an unnecessary auth/version lookup.
    // Match OpsOperator's provider selection. A stale unrelated Bearer must not
    // override a selected Cloudflare provider, nor may invalid CF fall back to HMS.
    let selected_cloudflare = ops_read(&parts.method, &path)
        && match state.ops_auth_mode() {
            crate::config::OpsAuthMode::CloudflareAccess => true,
            crate::config::OpsAuthMode::Hybrid => parts
                .headers
                .contains_key(crate::ops_auth::CF_ACCESS_JWT_HEADER),
            crate::config::OpsAuthMode::HmsPermission => false,
        };
    if !parts.headers.contains_key(AUTHORIZATION) || selected_cloudflare {
        let independent_read = ops_read(&parts.method, &path)
            || (matches!(parts.method, Method::GET | Method::HEAD)
                && matches!(path.as_str(), "/api/v2/metrics" | "/api/v2/openapi.json"));
        if independent_read {
            match network_access::facts(
                &parts,
                &state,
                &hms_access::ReauthState::missing(chrono::Utc::now()),
            )
            .await
            .and_then(|facts| network_access::enforce(&facts.decision, &parts.method))
            {
                Ok(()) => {}
                Err(error) => return error.into_response(),
            }
        }
        return next.run(Request::from_parts(parts, body)).await;
    }
    let resolved = match extractors::resolve_request(&parts, &state).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let effective_method = if read_post(&parts.method, &path) {
        &Method::GET
    } else {
        &parts.method
    };
    if let Err(error) = network_access::enforce(&resolved.network.decision, effective_method) {
        return error.into_response();
    }
    parts.extensions.insert(resolved);
    next.run(Request::from_parts(parts, body)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exceptions_are_exact_methods_and_routes() {
        assert!(lifecycle_exception(&Method::GET, "/api/v2/auth/me"));
        assert!(!lifecycle_exception(&Method::PATCH, "/api/v2/auth/me"));
        assert!(!lifecycle_exception(
            &Method::POST,
            "/api/v2/auth/admin-write"
        ));
        assert!(read_post(&Method::POST, "/api/v2/patients/search"));
        assert!(read_post(
            &Method::POST,
            "/api/v2/patients/:patient_id/clinical/note-template-previews"
        ));
        for method in [Method::GET, Method::PATCH, Method::DELETE] {
            assert!(!read_post(
                &method,
                "/api/v2/patients/:patient_id/clinical/note-template-previews"
            ));
        }
        assert!(!read_post(
            &Method::POST,
            "/api/v2/patients/:patient_id/clinical/notes/record"
        ));
        assert!(!read_post(
            &Method::POST,
            "/api/v2/patients/:patient_id/clinical/note-template-previews/save"
        ));
        assert!(!read_post(
            &Method::POST,
            "/api/v2/patients/identity/lookup"
        ));
        assert!(!read_post(
            &Method::POST,
            "/api/v2/clinical/prescriptions/search"
        ));
    }
}
