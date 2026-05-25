use std::collections::HashMap;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use axum::extract::{FromRequestParts, MatchedPath};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use chrono::{DateTime, Utc};
use hms_access::{OffsiteState, ReauthState};
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
    let user = context_facts.user;

    reject_stale_claims(&user, &claims)?;

    let enabled_features = enabled_features(&context_facts.feature_flags, &user);
    let offsite = OffsiteState::from_header(
        parts
            .headers
            .get("x-hms-offsite")
            .and_then(|value| value.to_str().ok()),
    );
    let reauth = ReauthState::from_authentication_time(access_token_issued_at(&claims)?);
    let context = hms_access::RequestContext::new(
        request_id.clone(),
        claims.session_id,
        user,
        enabled_features,
        offsite,
        reauth,
    )
    .with_active_authorities(context_facts.active_authorities);
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

    Ok(context)
}

async fn resolve_authenticated_user(parts: &Parts, state: &AppState) -> Result<AuthUser, ApiError> {
    let claims = access_claims(parts, state)?;
    let user = state
        .auth_user_for_claims(&claims)
        .await
        .map_err(|_| ApiError::unauthorized())?
        .ok_or_else(ApiError::unauthorized)?;

    reject_stale_claims(&user, &claims)?;

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

fn access_token_issued_at(claims: &AccessClaims) -> Result<DateTime<Utc>, ApiError> {
    DateTime::<Utc>::from_timestamp(claims.iat as i64, 0).ok_or_else(ApiError::unauthorized)
}
