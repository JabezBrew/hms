use std::collections::HashMap;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use axum::extract::{FromRequestParts, MatchedPath};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use chrono::{DateTime, Utc};
use hms_access::ReauthState;
use hms_domain::auth::AuthUser;
use hms_domain::deployment::FeatureKey;
use tracing::warn;
use uuid::Uuid;

use crate::auth::AccessClaims;
use crate::config::OpsAuthMode;
use crate::error::ApiError;
use crate::middleware::request_id::{current_request_id, RequestId};
use crate::ops_auth::{CloudflareAccessError, OpsOperator, CF_ACCESS_JWT_HEADER};
use crate::state::AppState;

const SLOW_REQUEST_CONTEXT_THRESHOLD: Duration = Duration::from_millis(75);

pub struct RequestContext(pub hms_access::RequestContext);

#[derive(Clone)]
pub(crate) struct ResolvedRequest {
    pub context: hms_access::RequestContext,
    pub network: crate::network_access::RequestNetworkFacts,
    pub authorization_deadline: DateTime<Utc>,
}
pub struct NetworkContext {
    pub context: hms_access::RequestContext,
    pub(crate) network: crate::network_access::RequestNetworkFacts,
    pub(crate) authorization_deadline: DateTime<Utc>,
}
#[async_trait]
impl FromRequestParts<AppState> for NetworkContext {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let resolved = resolve_request(parts, state).await?;
        Ok(Self {
            context: resolved.context,
            network: resolved.network,
            authorization_deadline: resolved.authorization_deadline,
        })
    }
}

pub struct AuthenticatedUser(pub AuthUser);

pub struct AuthenticatedSession {
    pub context: hms_access::RequestContext,
    pub session_id: Uuid,
}

#[async_trait]
impl FromRequestParts<AppState> for RequestContext {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(Self(resolve_request_context(parts, state).await?))
    }
}

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(Self(resolve_authenticated_user(parts, state).await?))
    }
}

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedSession {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let context = resolve_request_context(parts, state).await?;
        let session_id = context.session_id;

        Ok(Self {
            context,
            session_id,
        })
    }
}

#[async_trait]
impl FromRequestParts<AppState> for OpsOperator {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        match state.ops_auth_mode() {
            OpsAuthMode::HmsPermission => Ok(OpsOperator::Hms(
                resolve_request_context(parts, state).await?,
            )),
            OpsAuthMode::CloudflareAccess => resolve_cloudflare_ops_operator(parts, state).await,
            OpsAuthMode::Hybrid => {
                if parts.headers.contains_key(CF_ACCESS_JWT_HEADER) {
                    resolve_cloudflare_ops_operator(parts, state).await
                } else {
                    Ok(OpsOperator::Hms(
                        resolve_request_context(parts, state).await?,
                    ))
                }
            }
        }
    }
}

async fn resolve_cloudflare_ops_operator(
    parts: &Parts,
    state: &AppState,
) -> Result<OpsOperator, ApiError> {
    let token = parts
        .headers
        .get(CF_ACCESS_JWT_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(ApiError::unauthorized)?;
    let identity = state
        .verify_cloudflare_access_operator(token)
        .await
        .map_err(cloudflare_access_error)?;
    Ok(OpsOperator::CloudflareAccess(identity))
}

fn cloudflare_access_error(error: CloudflareAccessError) -> ApiError {
    match error {
        CloudflareAccessError::EmailNotAllowed => ApiError::forbidden(
            "ops_operator_not_allowed",
            "This operator is not allowed to access the ops dashboard.",
        ),
        CloudflareAccessError::Misconfigured => ApiError::forbidden(
            "ops_access_misconfigured",
            "Ops dashboard access is not configured.",
        ),
        CloudflareAccessError::KeyFetchFailed | CloudflareAccessError::InvalidToken => {
            ApiError::unauthorized()
        }
    }
}

async fn resolve_request_context(
    parts: &Parts,
    state: &AppState,
) -> Result<hms_access::RequestContext, ApiError> {
    Ok(resolve_request(parts, state).await?.context)
}

pub(crate) async fn resolve_request(
    parts: &Parts,
    state: &AppState,
) -> Result<ResolvedRequest, ApiError> {
    if let Some(resolved) = parts.extensions.get::<ResolvedRequest>() {
        return Ok(resolved.clone());
    }
    let total_started_at = Instant::now();
    let request_id = parts
        .extensions
        .get::<RequestId>()
        .map(|request_id| request_id.0.clone())
        .unwrap_or_else(current_request_id);

    let claims_started_at = Instant::now();
    let claims = access_claims(parts, state)?;
    let claims_elapsed = claims_started_at.elapsed();

    let facts_started_at = Instant::now();
    let route_pattern = route_pattern(parts);
    let context_facts = state
        .request_context_facts_for_claims(&claims, &route_pattern)
        .await
        .map_err(|_| ApiError::unauthorized())?
        .ok_or_else(ApiError::unauthorized)?;
    let facts_elapsed = facts_started_at.elapsed();

    let assemble_started_at = Instant::now();
    let authorization_deadline = context_facts.session_expires_at.min(
        DateTime::<Utc>::from_timestamp(claims.exp as i64, 0).ok_or_else(ApiError::unauthorized)?,
    );
    let password_verified_at = context_facts.password_verified_at;
    let user = context_facts.user;

    reject_stale_claims(&user, &claims)?;

    let enabled_features = enabled_features(&context_facts.feature_flags, &user);
    let mut reauth = access_token_reauth(&claims);
    if let Some(at) = reauth.verified_at {
        reauth = ReauthState::from_authentication_time(at.min(password_verified_at));
    }
    if user.password_change_required && !password_change_lifecycle(&parts.method, &route_pattern) {
        return Err(ApiError::forbidden(
            "password_change_required",
            "Change your current password before opening other workflows.",
        ));
    }
    let network = match crate::network_access::facts(parts, state, &reauth).await {
        Ok(value) => value,
        Err(_)
            if route_pattern != "/api/v2/auth/network-access"
                && crate::middleware::network::lifecycle_exception(
                    &parts.method,
                    &route_pattern,
                ) =>
        {
            // Network-policy storage cannot prevent a caller from securing or
            // ending their own authenticated session. It grants no data access.
            let client = crate::network_access::client_from_parts(parts, state);
            let policy = hms_db::network::unconfigured_policy();
            let mut decision =
                crate::network_access::evaluate(client, &policy, &reauth, Utc::now());
            decision.access_allowed = false;
            crate::network_access::RequestNetworkFacts {
                client,
                policy,
                decision,
            }
        }
        Err(error) => return Err(error),
    };
    let offsite = crate::network_access::offsite_state(&network.decision);
    if Utc::now() >= authorization_deadline {
        return Err(ApiError::unauthorized());
    }
    let context = hms_access::RequestContext::new(
        request_id.clone(),
        claims.session_id,
        user,
        enabled_features,
        offsite,
        reauth,
    )
    .with_active_authorities(context_facts.active_authorities)
    .with_authorization_deadline(authorization_deadline)
    .with_resolved_network_policy_version(network.policy.version);
    let assemble_elapsed = assemble_started_at.elapsed();
    let total_elapsed = total_started_at.elapsed();

    if total_elapsed > SLOW_REQUEST_CONTEXT_THRESHOLD {
        warn!(
            request_id = %request_id,
            total_ms = duration_ms(total_elapsed),
            claims_ms = duration_ms(claims_elapsed),
            facts_ms = duration_ms(facts_elapsed),
            assemble_ms = duration_ms(assemble_elapsed),
            "slow request context resolved"
        );
    }

    Ok(ResolvedRequest {
        context,
        network,
        authorization_deadline,
    })
}

async fn resolve_authenticated_user(parts: &Parts, state: &AppState) -> Result<AuthUser, ApiError> {
    if let Some(resolved) = parts.extensions.get::<ResolvedRequest>() {
        return Ok(resolved.context.user.clone());
    }
    let claims = access_claims(parts, state)?;
    let user = state
        .auth_user_for_claims(&claims)
        .await
        .map_err(|_| ApiError::unauthorized())?
        .ok_or_else(ApiError::unauthorized)?;

    reject_stale_claims(&user, &claims)?;
    if user.password_change_required
        && !password_change_lifecycle(&parts.method, &route_pattern(parts))
    {
        return Err(ApiError::forbidden(
            "password_change_required",
            "Change your current password before opening other workflows.",
        ));
    }

    Ok(user)
}

fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

fn access_claims(parts: &Parts, state: &AppState) -> Result<AccessClaims, ApiError> {
    let header = parts
        .headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(ApiError::unauthorized)?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(ApiError::unauthorized)?;

    state
        .verify_access_token(token)
        .map_err(|_| ApiError::unauthorized())
}

fn route_pattern(parts: &Parts) -> String {
    parts
        .extensions
        .get::<MatchedPath>()
        .map(|matched_path| matched_path.as_str().to_owned())
        .unwrap_or_else(|| "_unknown".to_owned())
}

fn reject_stale_claims(user: &AuthUser, claims: &AccessClaims) -> Result<(), ApiError> {
    let active_profile = serde_json::to_value(user.active_profile)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned));

    if user.facility_id != claims.facility_id
        || user.session_version != claims.session_version
        || user.permission_version != claims.permission_version
        || active_profile.as_deref() != Some(claims.active_profile.as_str())
    {
        return Err(ApiError::unauthorized());
    }

    Ok(())
}

fn enabled_features(feature_flags: &HashMap<FeatureKey, bool>, user: &AuthUser) -> Vec<FeatureKey> {
    feature_flags
        .iter()
        .filter_map(|(feature, enabled)| {
            (*enabled && user.features.contains(feature)).then_some(*feature)
        })
        .collect()
}

fn access_token_reauth(claims: &AccessClaims) -> ReauthState {
    claims
        .auth_time
        .and_then(|timestamp| i64::try_from(timestamp).ok())
        .and_then(|timestamp| DateTime::<Utc>::from_timestamp(timestamp, 0))
        .map(ReauthState::from_authentication_time)
        .unwrap_or_else(|| ReauthState::missing(Utc::now()))
}

fn password_change_lifecycle(method: &axum::http::Method, path: &str) -> bool {
    matches!(
        (method.as_str(), path),
        (
            "GET",
            "/api/v2/auth/me"
                | "/api/v2/auth/network-access"
                | "/api/v2/auth/assurance"
                | "/api/v2/auth/mfa/status"
                | "/api/v2/auth/sessions"
        ) | (
            "POST",
            "/api/v2/auth/password"
                | "/api/v2/auth/logout"
                | "/api/v2/auth/refresh"
                | "/api/v2/auth/sessions/revoke-all"
                | "/api/v2/auth/sessions/:session_id/revoke"
        )
    )
}
