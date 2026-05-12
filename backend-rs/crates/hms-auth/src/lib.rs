use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AccessClaims {
    pub sub: Uuid,
    pub session_id: Uuid,
    pub facility_id: Uuid,
    pub active_profile: String,
    pub permission_version: i64,
    pub session_version: i64,
    pub iat: usize,
    pub exp: usize,
}

pub fn issue_access_token(
    secret: &str,
    user_id: Uuid,
    session_id: Uuid,
    facility_id: Uuid,
    active_profile: String,
    permission_version: i64,
    session_version: i64,
    ttl: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = unix_seconds();
    let claims = AccessClaims {
        sub: user_id,
        session_id,
        facility_id,
        active_profile,
        permission_version,
        session_version,
        iat: now,
        exp: now + ttl.as_secs() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_access_token(
    secret: &str,
    token: &str,
) -> Result<AccessClaims, jsonwebtoken::errors::Error> {
    let data = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

fn unix_seconds() -> usize {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize
}
