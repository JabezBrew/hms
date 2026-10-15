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

#[cfg(test)]
mod tests {
    use super::*;
    use aws_lc_rs::rand::SystemRandom;
    use aws_lc_rs::rsa::{KeyPair, KeySize, PublicKeyComponents};
    use aws_lc_rs::signature::{self, KeyPair as _};
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine as _;

    #[tokio::test]
    async fn cloudflare_access_verifies_rs256_jwk_and_rejects_invalid_signed_claims() {
        // Keys exist only in memory for this test. Seed the same cache used by
        // production JWKS retrieval to exercise verification without network I/O.
        let key = KeyPair::generate(KeySize::Rsa2048).expect("ephemeral key generates");
        let public = PublicKeyComponents::<Vec<u8>>::from(key.public_key());
        let issuer = "https://access.example.test";
        let audience = "synthetic-ops-audience";
        let verifier = CloudflareAccessVerifier::new(CloudflareAccessConfig {
            team_domain: Some(issuer.to_owned()),
            audience: Some(audience.to_owned()),
            allowed_emails: vec!["operator@example.test".to_owned()],
            test_secret: None,
        })
        .expect("verifier config is valid");
        *verifier
            .cached_jwks
            .write()
            .expect("cache lock is available") = Some(CachedJwks {
            jwks: serde_json::from_value(serde_json::json!({ "keys": [{
                "kty": "RSA", "kid": "synthetic-key", "alg": "RS256", "use": "sig",
                "n": URL_SAFE_NO_PAD.encode(public.n),
                "e": URL_SAFE_NO_PAD.encode(public.e),
            }] }))
            .expect("public JWK parses"),
            expires_at: Instant::now() + JWKS_CACHE_TTL,
        });
        let now = chrono::Utc::now().timestamp();
        let claims = serde_json::json!({
            "sub": "synthetic-operator", "email": "operator@example.test",
            "iss": issuer, "aud": audience, "iat": now, "exp": now + 300,
        });
        let sign = |claims: &serde_json::Value| {
            let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","kid":"synthetic-key"}"#);
            let payload =
                URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).expect("claims encode"));
            let message = format!("{header}.{payload}");
            let mut signature_bytes = vec![0; key.public_modulus_len()];
            key.sign(
                &signature::RSA_PKCS1_SHA256,
                &SystemRandom::new(),
                message.as_bytes(),
                &mut signature_bytes,
            )
            .expect("ephemeral signature generates");
            format!("{message}.{}", URL_SAFE_NO_PAD.encode(signature_bytes))
        };
        let token = sign(&claims);
        assert_eq!(
            verifier.verify(&token).await.expect("RS256 JWK verifies"),
            CloudflareAccessIdentity {
                subject: "synthetic-operator".to_owned(),
                email: "operator@example.test".to_owned(),
            }
        );
        for (field, value) in [
            ("aud", serde_json::json!("different-audience")),
            ("iss", serde_json::json!("https://different.example.test")),
            ("exp", serde_json::json!(now - 3600)),
            ("exp", serde_json::json!("invalid-numeric-claim")),
        ] {
            let mut invalid = claims.clone();
            invalid[field] = value;
            assert!(matches!(
                verifier.verify(&sign(&invalid)).await,
                Err(CloudflareAccessError::InvalidToken)
            ));
        }
        let mut tampered = token.into_bytes();
        let signature_start = tampered.iter().rposition(|byte| *byte == b'.').unwrap() + 1;
        tampered[signature_start] = if tampered[signature_start] == b'A' {
            b'B'
        } else {
            b'A'
        };
        assert!(matches!(
            verifier
                .verify(std::str::from_utf8(&tampered).unwrap())
                .await,
            Err(CloudflareAccessError::InvalidToken)
        ));
    }
}
