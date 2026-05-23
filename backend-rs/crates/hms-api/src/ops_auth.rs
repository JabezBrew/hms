use std::collections::HashSet;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use anyhow::Context;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use thiserror::Error;

use crate::config::CloudflareAccessConfig;

pub const CF_ACCESS_JWT_HEADER: &str = "cf-access-jwt-assertion";

const JWKS_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const JWKS_FETCH_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub enum OpsOperator {
    Hms(hms_access::RequestContext),
    CloudflareAccess(CloudflareAccessIdentity),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloudflareAccessIdentity {
    pub subject: String,
    pub email: String,
}

#[derive(Debug, Error)]
pub enum CloudflareAccessError {
    #[error("Cloudflare Access is not configured")]
    Misconfigured,
    #[error("Cloudflare Access signing keys could not be fetched")]
    KeyFetchFailed,
    #[error("Cloudflare Access token is invalid")]
    InvalidToken,
    #[error("Cloudflare Access operator is not allowlisted")]
    EmailNotAllowed,
}

pub struct CloudflareAccessVerifier {
    config: CloudflareAccessConfig,
    allowed_emails: HashSet<String>,
    client: reqwest::Client,
    cached_jwks: RwLock<Option<CachedJwks>>,
}

#[derive(Clone)]
struct CachedJwks {
    jwks: JwkSet,
    expires_at: Instant,
}

#[derive(Clone, Debug, Deserialize)]
struct CloudflareAccessClaims {
    sub: String,
    email: Option<String>,
}

impl CloudflareAccessVerifier {
    pub fn new(config: CloudflareAccessConfig) -> anyhow::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(JWKS_FETCH_TIMEOUT)
            .build()
            .context("failed to initialize Cloudflare Access JWKS client")?;
        let allowed_emails = config
            .allowed_emails
            .iter()
            .map(|email| normalize_email(email))
            .filter(|email| !email.is_empty())
            .collect::<HashSet<_>>();

        Ok(Self {
            config,
            allowed_emails,
            client,
            cached_jwks: RwLock::new(None),
        })
    }

    pub async fn verify(
        &self,
        token: &str,
    ) -> Result<CloudflareAccessIdentity, CloudflareAccessError> {
        let claims = if let Some(secret) = self.config.test_secret.as_deref() {
            self.verify_test_token(token, secret)?
        } else {
            self.verify_remote_token(token).await?
        };

        let email = claims
            .email
            .as_deref()
            .map(normalize_email)
            .filter(|email| !email.is_empty())
            .ok_or(CloudflareAccessError::InvalidToken)?;
        if !self.allowed_emails.contains(&email) {
            return Err(CloudflareAccessError::EmailNotAllowed);
        }

        Ok(CloudflareAccessIdentity {
            subject: claims.sub,
            email,
        })
    }

    async fn verify_remote_token(
        &self,
        token: &str,
    ) -> Result<CloudflareAccessClaims, CloudflareAccessError> {
        let header = decode_header(token).map_err(|_| CloudflareAccessError::InvalidToken)?;
        if header.alg != Algorithm::RS256 {
            return Err(CloudflareAccessError::InvalidToken);
        }
        let kid = header.kid.ok_or(CloudflareAccessError::InvalidToken)?;
        let jwks = self.jwks().await?;
        let jwk = jwks.find(&kid).ok_or(CloudflareAccessError::InvalidToken)?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| CloudflareAccessError::InvalidToken)?;
        let claims =
            decode::<CloudflareAccessClaims>(token, &key, &self.validation(Algorithm::RS256)?)
                .map_err(|_| CloudflareAccessError::InvalidToken)?
                .claims;

        Ok(claims)
    }

    fn verify_test_token(
        &self,
        token: &str,
        secret: &str,
    ) -> Result<CloudflareAccessClaims, CloudflareAccessError> {
        let claims = decode::<CloudflareAccessClaims>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &self.validation(Algorithm::HS256)?,
        )
        .map_err(|_| CloudflareAccessError::InvalidToken)?
        .claims;

        Ok(claims)
    }

    fn validation(&self, algorithm: Algorithm) -> Result<Validation, CloudflareAccessError> {
        let audience = self
            .config
            .audience
            .as_deref()
            .ok_or(CloudflareAccessError::Misconfigured)?;
        let issuer = self
            .config
            .team_domain
            .as_deref()
            .ok_or(CloudflareAccessError::Misconfigured)?;
        let mut validation = Validation::new(algorithm);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.set_audience(&[audience]);
        validation.set_issuer(&[issuer]);
        Ok(validation)
    }

    async fn jwks(&self) -> Result<JwkSet, CloudflareAccessError> {
        let now = Instant::now();
        if let Some(cached) = self
            .cached_jwks
            .read()
            .ok()
            .and_then(|cache| cache.as_ref().cloned())
            .filter(|cached| cached.expires_at > now)
        {
            return Ok(cached.jwks);
        }

        let certs_url = self
            .config
            .certs_url()
            .ok_or(CloudflareAccessError::Misconfigured)?;
        let jwks = self
            .client
            .get(certs_url)
            .send()
            .await
            .map_err(|_| CloudflareAccessError::KeyFetchFailed)?
            .error_for_status()
            .map_err(|_| CloudflareAccessError::KeyFetchFailed)?
            .json::<JwkSet>()
            .await
            .map_err(|_| CloudflareAccessError::KeyFetchFailed)?;
        if jwks.keys.is_empty() {
            return Err(CloudflareAccessError::KeyFetchFailed);
        }

        if let Ok(mut cache) = self.cached_jwks.write() {
            *cache = Some(CachedJwks {
                jwks: jwks.clone(),
                expires_at: now + JWKS_CACHE_TTL,
            });
        }

        Ok(jwks)
    }
}

fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}
