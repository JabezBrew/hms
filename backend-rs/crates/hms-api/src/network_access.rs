use crate::{
    error::ApiError,
    network_provenance::{self, ClientProvenance, ResolvedClient},
    state::AppState,
};
use axum::extract::ConnectInfo;
use axum::http::request::Parts;
use chrono::{DateTime, Utc};
use hms_access::{OffsiteState, ReauthState};
use hms_domain::network::*;
use std::net::SocketAddr;

#[derive(Clone)]
pub(crate) struct RequestNetworkFacts {
    pub client: ResolvedClient,
    pub policy: NetworkPolicy,
    pub decision: NetworkAccessDecision,
}

pub(crate) fn client_from_parts(parts: &Parts, state: &AppState) -> ResolvedClient {
    let peer = parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|value| value.0);
    // Preserve duplicate or invalid-encoding fields as invalid input, never drop them.
    let fields: Vec<&str> = parts
        .headers
        .get_all("x-forwarded-for")
        .iter()
        .map(|value| value.to_str().unwrap_or(""))
        .collect();
    network_provenance::resolve_client(peer, &fields, |address| {
        state.trusted_proxy_cidrs().contains(address)
    })
}
pub(crate) async fn facts(
    parts: &Parts,
    state: &AppState,
    reauth: &ReauthState,
) -> Result<RequestNetworkFacts, ApiError> {
    facts_with_clock(parts, state, reauth, None).await
}
pub(crate) async fn facts_with_clock(
    parts: &Parts,
    state: &AppState,
    reauth: &ReauthState,
    clock: Option<hms_domain::authorization_clock::AuthorizationClock>,
) -> Result<RequestNetworkFacts, ApiError> {
    let client = client_from_parts(parts, state);
    let policy = hms_db::network::get_policy(state.db_pool(), state.facility_id())
        .await
        .map_err(|_| {
            ApiError::forbidden(
                "network_policy_unavailable",
                "Network access could not be verified. Try again after the policy is available.",
            )
        })?;
    let decision = match clock {
        Some(clock) => evaluate_with_clock(client, &policy, reauth, clock)?,
        None => evaluate(client, &policy, reauth, Utc::now()),
    };
    Ok(RequestNetworkFacts {
        client,
        policy,
        decision,
    })
}
pub(crate) fn evaluate_with_clock(
    client: ResolvedClient,
    policy: &NetworkPolicy,
    reauth: &ReauthState,
    clock: hms_domain::authorization_clock::AuthorizationClock,
) -> Result<NetworkAccessDecision, ApiError> {
    let now = clock.now().ok_or_else(ApiError::unauthorized)?;
    let proof = if reauth
        .verified_at
        .is_some_and(|at| clock.admits_verified_at(at))
    {
        reauth.clone()
    } else {
        ReauthState::missing(now)
    };
    Ok(evaluate(client, policy, &proof, now))
}
pub(crate) fn evaluate(
    client: ResolvedClient,
    policy: &NetworkPolicy,
    reauth: &ReauthState,
    now: DateTime<Utc>,
) -> NetworkAccessDecision {
    let provenance = match client.provenance {
        ClientProvenance::Direct => NetworkProvenance::Direct,
        ClientProvenance::TrustedProxy => NetworkProvenance::TrustedProxy,
        ClientProvenance::Unknown => NetworkProvenance::Unknown,
    };
    let mut decision = NetworkAccessDecision {
        auth_clock: None,
        classification: NetworkClassification::Unknown,
        provenance,
        policy_version: None,
        mode: None,
        access_allowed: true,
        read_only: true,
        reauth_required: false,
        reauth_expires_at: None,
        evaluated_at: now,
        reason: NetworkDecisionReason::PolicyUnconfigured,
    };
    let ranges = NetworkRanges::parse(&policy.onsite_cidrs, false);
    if !policy.configured || policy.version < 1 || ranges.is_err() {
        return decision;
    }
    let ranges = ranges.unwrap();
    decision.policy_version = Some(policy.version);
    decision.mode = Some(policy.offsite_mode);
    // Invalid provenance must never downgrade a configured deny policy to reads.
    decision.access_allowed = policy.offsite_mode != NetworkOffsiteMode::Deny;
    let Some(address) = client.address() else {
        decision.reason = NetworkDecisionReason::ClientUnknown;
        return decision;
    };
    if ranges.contains(address) {
        decision.classification = NetworkClassification::Onsite;
        decision.access_allowed = true;
        decision.read_only = false;
        decision.reason = NetworkDecisionReason::Onsite;
        return decision;
    }
    decision.classification = NetworkClassification::Offsite;
    match policy.offsite_mode {
        NetworkOffsiteMode::Readonly => decision.reason = NetworkDecisionReason::OffsiteReadonly,
        NetworkOffsiteMode::Deny => {
            decision.access_allowed = false;
            decision.reason = NetworkDecisionReason::OffsiteDenied;
        }
        NetworkOffsiteMode::FreshReauth => {
            decision.reauth_expires_at = reauth.verified_at.map(|_| reauth.required_after);
            if reauth.is_fresh_at(now) {
                decision.read_only = false;
                decision.reason = NetworkDecisionReason::OffsiteFreshReauth;
            } else {
                decision.reauth_required = true;
                decision.reason = NetworkDecisionReason::ReauthRequired;
            }
        }
    }
    decision
}
pub(crate) fn offsite_state(decision: &NetworkAccessDecision) -> OffsiteState {
    if decision.read_only {
        OffsiteState::OffsiteReadOnly
    } else if decision.classification == NetworkClassification::Onsite {
        OffsiteState::Onsite
    } else {
        OffsiteState::OffsiteFreshReauth
    }
}
pub(crate) fn enforce(
    decision: &NetworkAccessDecision,
    method: &axum::http::Method,
) -> Result<(), ApiError> {
    if !decision.access_allowed {
        return Err(ApiError::forbidden(
            "network_access_denied",
            "This connection is not allowed by the facility network policy.",
        ));
    }
    if decision.read_only
        && !matches!(
            *method,
            axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
        )
    {
        return Err(if decision.reauth_required {
            ApiError::forbidden(
                "network_reauth_required",
                "Confirm your sign-in before making changes from this connection.",
            )
        } else {
            ApiError::forbidden("network_read_only","This connection has read-only access. Connect from an approved network before making changes.")
        });
    }
    Ok(())
}

#[cfg(test)]
mod clock_tests {
    use super::*;
    use hms_domain::authorization_clock::AuthorizationClock;
    use std::time::{Duration, Instant};
    fn preview(reauth: &ReauthState, clock: AuthorizationClock) -> NetworkAccessDecision {
        let client = network_provenance::resolve_client(
            Some("203.0.113.7:44000".parse().unwrap()),
            &[],
            |_| false,
        );
        let policy = NetworkPolicy {
            configured: true,
            version: 1,
            onsite_cidrs: vec!["127.0.0.0/8".into()],
            offsite_mode: NetworkOffsiteMode::FreshReauth,
            updated_at: None,
            updated_by_user_id: None,
        };
        // Use the exact shared production preview/facts evaluator.
        evaluate_with_clock(client, &policy, reauth, clock).unwrap()
    }
    #[test]
    fn preview_rejects_future_at_observation_even_after_monotonic_aging() {
        let database_at = Utc::now();
        let clock = AuthorizationClock::new(database_at, Instant::now() - Duration::from_secs(10));
        let future =
            ReauthState::from_authentication_time(database_at + chrono::Duration::seconds(1));
        let decision = preview(&future, clock);
        assert!(
            decision.read_only && decision.reauth_required,
            "advisory preview must not mature rejected future evidence"
        );
    }
    #[test]
    fn preview_admits_current_proof_under_both_host_skew_directions() {
        for offset in [-3600, 3600] {
            let database_at = Utc::now() + chrono::Duration::seconds(offset);
            let clock = AuthorizationClock::new(database_at, Instant::now());
            let current = ReauthState::from_authentication_time(database_at);
            let decision = preview(&current, clock);
            assert!(!decision.read_only && !decision.reauth_required);
        }
    }
}
