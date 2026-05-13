use async_trait::async_trait;
use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use hms_domain::auth::AuthUser;
use uuid::Uuid;

use crate::error::ApiError;
use crate::state::AppState;

pub struct AuthenticatedUser(pub AuthUser);

pub struct AuthenticatedSession {
    pub user: AuthUser,
    pub session_id: Uuid,
}

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(ApiError::unauthorized)?;

        let token = header
            .strip_prefix("Bearer ")
            .ok_or_else(ApiError::unauthorized)?;

        let claims = state
            .verify_access_token(token)
            .map_err(|_| ApiError::unauthorized())?;

        let user = state
            .auth_user(claims.sub)
            .await
            .map_err(|_| ApiError::unauthorized())?
            .ok_or_else(ApiError::unauthorized)?;

        if user.facility_id != claims.facility_id
            || user.session_version != claims.session_version
            || user.permission_version != claims.permission_version
        {
            return Err(ApiError::unauthorized());
        }

        Ok(Self(user))
    }
}

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedSession {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(ApiError::unauthorized)?;

        let token = header
            .strip_prefix("Bearer ")
            .ok_or_else(ApiError::unauthorized)?;

        let claims = state
            .verify_access_token(token)
            .map_err(|_| ApiError::unauthorized())?;

        let user = state
            .auth_user(claims.sub)
            .await
            .map_err(|_| ApiError::unauthorized())?
            .ok_or_else(ApiError::unauthorized)?;

        if user.facility_id != claims.facility_id
            || user.session_version != claims.session_version
            || user.permission_version != claims.permission_version
        {
            return Err(ApiError::unauthorized());
        }

        Ok(Self {
            user,
            session_id: claims.session_id,
        })
    }
}
