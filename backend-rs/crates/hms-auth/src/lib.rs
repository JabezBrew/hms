use std::time::{Duration, SystemTime, UNIX_EPOCH};

use argon2::{Argon2, PasswordHash, PasswordVerifier};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;
use webauthn_rs::prelude::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AccessClaims {
    pub sub: Uuid,
    pub session_id: Uuid,
    pub facility_id: Uuid,
    pub active_profile: String,
    pub permission_version: i64,
    pub session_version: i64,
    /// Time of the credential verification that started the session family.
    /// Refreshing an access token must never advance this timestamp.
    #[serde(default)]
    pub auth_time: Option<usize>,
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
    authenticated_at: DateTime<Utc>,
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
        // The durable proof uses the database clock. A database clock slightly
        // ahead of the signer must not create an invalid future JWT claim.
        // Clamping is conservative and cannot renew the actual proof.
        auth_time: usize::try_from(authenticated_at.timestamp())
            .ok()
            .map(|at| at.min(now)),
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
    let mut validation = Validation::default();
    validation.leeway = 0;
    let data = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    if data.claims.iat > unix_seconds()
        || data.claims.iat >= data.claims.exp
        || data
            .claims
            .auth_time
            .is_some_and(|auth_time| auth_time > data.claims.iat)
    {
        return Err(jsonwebtoken::errors::ErrorKind::InvalidToken.into());
    }
    Ok(data.claims)
}

fn unix_seconds() -> usize {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize
}

#[derive(Clone, Debug)]
pub struct WebAuthnConfig {
    pub rp_id: String,
    pub rp_origin: String,
    pub rp_name: String,
    pub challenge_ttl: chrono::Duration,
}

impl WebAuthnConfig {
    pub fn localhost_for_tests() -> Self {
        Self {
            rp_id: "localhost".to_owned(),
            rp_origin: "http://localhost:8080".to_owned(),
            rp_name: "HMS".to_owned(),
            challenge_ttl: chrono::Duration::minutes(5),
        }
    }
}

#[derive(Clone, Debug, Error)]
pub enum WebAuthnFlowError {
    #[error("invalid WebAuthn relying-party configuration")]
    InvalidConfig,
    #[error("invalid WebAuthn credential payload")]
    InvalidCredential,
    #[error("invalid WebAuthn ceremony state")]
    InvalidState,
    #[error("WebAuthn ceremony failed")]
    CeremonyFailed,
    #[error("WebAuthn credential was not found")]
    CredentialNotFound,
}

#[derive(Clone, Debug)]
pub struct StoredPasskey {
    pub credential_id: String,
    pub passkey: serde_json::Value,
}

#[derive(Clone, Debug)]
pub struct PasskeyRegistrationStart {
    pub challenge_id: Uuid,
    pub public_key: serde_json::Value,
    pub state: serde_json::Value,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct RegisteredPasskey {
    pub credential_id: String,
    pub passkey: serde_json::Value,
}

#[derive(Clone, Debug)]
pub struct PasskeyAuthenticationStart {
    pub challenge_id: Uuid,
    pub public_key: serde_json::Value,
    pub state: serde_json::Value,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedPasskey {
    pub credential_id: String,
    pub passkey: serde_json::Value,
}

pub fn start_passkey_registration(
    config: &WebAuthnConfig,
    user_id: Uuid,
    user_name: &str,
    user_display_name: &str,
    existing_credential_ids: &[String],
) -> Result<PasskeyRegistrationStart, WebAuthnFlowError> {
    let webauthn = webauthn(config)?;
    let exclude_credentials = credential_ids(existing_credential_ids)?;
    let (public_key, state) = webauthn
        .start_passkey_registration(
            user_id,
            user_name,
            user_display_name,
            (!exclude_credentials.is_empty()).then_some(exclude_credentials),
        )
        .map_err(|_| WebAuthnFlowError::CeremonyFailed)?;

    Ok(PasskeyRegistrationStart {
        challenge_id: Uuid::new_v4(),
        public_key: public_key_options(public_key)?,
        state: serde_json::to_value(state).map_err(|_| WebAuthnFlowError::InvalidState)?,
        expires_at: Utc::now() + config.challenge_ttl,
    })
}

pub fn finish_passkey_registration(
    config: &WebAuthnConfig,
    credential: serde_json::Value,
    state: serde_json::Value,
) -> Result<RegisteredPasskey, WebAuthnFlowError> {
    let webauthn = webauthn(config)?;
    let credential = serde_json::from_value::<RegisterPublicKeyCredential>(credential)
        .map_err(|_| WebAuthnFlowError::InvalidCredential)?;
    let state = serde_json::from_value::<PasskeyRegistration>(state)
        .map_err(|_| WebAuthnFlowError::InvalidState)?;
    let passkey = webauthn
        .finish_passkey_registration(&credential, &state)
        .map_err(|_| WebAuthnFlowError::CeremonyFailed)?;
    let credential_id = credential_id_from_credential(passkey.cred_id())?;
    let passkey = serde_json::to_value(passkey).map_err(|_| WebAuthnFlowError::InvalidState)?;

    Ok(RegisteredPasskey {
        credential_id,
        passkey,
    })
}

pub fn start_passkey_authentication(
    config: &WebAuthnConfig,
    passkeys: &[StoredPasskey],
) -> Result<PasskeyAuthenticationStart, WebAuthnFlowError> {
    let webauthn = webauthn(config)?;
    let passkeys = decode_passkeys(passkeys)?;
    if passkeys.is_empty() {
        return Err(WebAuthnFlowError::CredentialNotFound);
    }
    let public_passkeys = passkeys
        .into_iter()
        .map(|(_, passkey)| passkey)
        .collect::<Vec<_>>();
    let (public_key, state) = webauthn
        .start_passkey_authentication(&public_passkeys)
        .map_err(|_| WebAuthnFlowError::CeremonyFailed)?;

    Ok(PasskeyAuthenticationStart {
        challenge_id: Uuid::new_v4(),
        public_key: public_key_options(public_key)?,
        state: serde_json::to_value(state).map_err(|_| WebAuthnFlowError::InvalidState)?,
        expires_at: Utc::now() + config.challenge_ttl,
    })
}

pub fn finish_passkey_authentication(
    config: &WebAuthnConfig,
    credential: serde_json::Value,
    state: serde_json::Value,
    passkeys: &[StoredPasskey],
) -> Result<AuthenticatedPasskey, WebAuthnFlowError> {
    let webauthn = webauthn(config)?;
    let credential = serde_json::from_value::<PublicKeyCredential>(credential)
        .map_err(|_| WebAuthnFlowError::InvalidCredential)?;
    let state = serde_json::from_value::<PasskeyAuthentication>(state)
        .map_err(|_| WebAuthnFlowError::InvalidState)?;
    let mut passkeys = decode_passkeys(passkeys)?;
    let result = webauthn
        .finish_passkey_authentication(&credential, &state)
        .map_err(|_| WebAuthnFlowError::CeremonyFailed)?;
    if !result.user_verified() {
        return Err(WebAuthnFlowError::CeremonyFailed);
    }
    let credential_id = credential_id_from_credential(result.cred_id())?;
    let (_, passkey) = passkeys
        .iter_mut()
        .find(|(stored_id, _)| stored_id == &credential_id)
        .ok_or(WebAuthnFlowError::CredentialNotFound)?;
    let _ = passkey.update_credential(&result);
    let passkey = serde_json::to_value(passkey).map_err(|_| WebAuthnFlowError::InvalidState)?;

    Ok(AuthenticatedPasskey {
        credential_id,
        passkey,
    })
}

pub fn generate_recovery_codes(count: usize) -> Vec<String> {
    (0..count.clamp(1, 20))
        .map(|_| {
            // Twelve bytes encode to sixteen ASCII characters, leaving enough
            // characters for all three five-character groups below.
            let mut bytes = [0_u8; 12];
            OsRng.fill_bytes(&mut bytes);
            let encoded = URL_SAFE_NO_PAD.encode(bytes);
            format!(
                "{}-{}-{}",
                &encoded[0..5],
                &encoded[5..10],
                &encoded[10..15]
            )
        })
        .collect()
}

pub fn hash_recovery_code(code: &str) -> String {
    let normalized = code
        .chars()
        .filter(|value| !value.is_whitespace() && *value != '-')
        .flat_map(char::to_uppercase)
        .collect::<String>();
    let digest = Sha256::digest(normalized.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn verify_password_hash(hash: &str, password: &str) -> bool {
    let Ok(hash) = PasswordHash::new(hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &hash)
        .is_ok()
}

fn webauthn(config: &WebAuthnConfig) -> Result<Webauthn, WebAuthnFlowError> {
    let origin = Url::parse(&config.rp_origin).map_err(|_| WebAuthnFlowError::InvalidConfig)?;
    WebauthnBuilder::new(&config.rp_id, &origin)
        .map_err(|_| WebAuthnFlowError::InvalidConfig)?
        .rp_name(&config.rp_name)
        .build()
        .map_err(|_| WebAuthnFlowError::InvalidConfig)
}

fn public_key_options<T: Serialize>(value: T) -> Result<serde_json::Value, WebAuthnFlowError> {
    let value = serde_json::to_value(value).map_err(|_| WebAuthnFlowError::InvalidState)?;
    Ok(value
        .get("publicKey")
        .or_else(|| value.get("public_key"))
        .cloned()
        .unwrap_or(value))
}

fn credential_ids(ids: &[String]) -> Result<Vec<CredentialID>, WebAuthnFlowError> {
    ids.iter()
        .map(|id| {
            URL_SAFE_NO_PAD
                .decode(id)
                .map(CredentialID::from)
                .map_err(|_| WebAuthnFlowError::InvalidCredential)
        })
        .collect()
}

fn decode_passkeys(
    passkeys: &[StoredPasskey],
) -> Result<Vec<(String, Passkey)>, WebAuthnFlowError> {
    passkeys
        .iter()
        .map(|stored| {
            let passkey = serde_json::from_value::<Passkey>(stored.passkey.clone())
                .map_err(|_| WebAuthnFlowError::InvalidState)?;
            if credential_id_from_credential(passkey.cred_id())? != stored.credential_id {
                return Err(WebAuthnFlowError::InvalidState);
            }
            Ok((stored.credential_id.clone(), passkey))
        })
        .collect()
}

/// Structural validity is NOT usability or identity proof; only a real UV
/// assertion can establish exact-session factor assurance.
pub fn passkey_record_is_structurally_valid(
    credential_id: &str,
    passkey: &serde_json::Value,
) -> bool {
    decode_passkeys(&[StoredPasskey {
        credential_id: credential_id.to_owned(),
        passkey: passkey.clone(),
    }])
    .is_ok()
}
pub fn webauthn_config_is_valid(config: &WebAuthnConfig) -> bool {
    webauthn(config).is_ok()
}

fn credential_id_from_credential(
    credential_id: &CredentialID,
) -> Result<String, WebAuthnFlowError> {
    serde_json::to_value(credential_id)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .ok_or(WebAuthnFlowError::InvalidCredential)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token_for_claims(claims: &AccessClaims) -> String {
        encode(
            &Header::default(),
            claims,
            &EncodingKey::from_secret(b"test-only-auth-secret"),
        )
        .expect("test claims encode")
    }

    fn valid_claims() -> AccessClaims {
        let token = issue_access_token(
            "test-only-auth-secret",
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            "hospital".to_owned(),
            1,
            1,
            Utc::now() - chrono::Duration::minutes(20),
            Duration::from_secs(300),
        )
        .expect("test access token issues");
        verify_access_token("test-only-auth-secret", &token).expect("test access token verifies")
    }

    #[test]
    fn access_token_keeps_authentication_time_separate_from_issue_time() {
        let claims = valid_claims();
        assert!(claims
            .auth_time
            .is_some_and(|auth_time| auth_time + 1100 < claims.iat));
    }

    #[test]
    fn database_clock_ahead_cannot_produce_a_future_authentication_claim() {
        let token = issue_access_token(
            "test-only-auth-secret",
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            "hospital".to_owned(),
            1,
            1,
            Utc::now() + chrono::Duration::seconds(2),
            Duration::from_secs(300),
        )
        .unwrap();
        let claims = verify_access_token("test-only-auth-secret", &token).unwrap();
        assert_eq!(claims.auth_time, Some(claims.iat));
    }

    #[test]
    fn access_tokens_reject_expiry_and_impossible_authentication_times() {
        let mut claims = valid_claims();
        claims.exp = unix_seconds() - 1;
        assert!(verify_access_token("test-only-auth-secret", &token_for_claims(&claims)).is_err());

        claims = valid_claims();
        claims.iat = unix_seconds() + 120;
        assert!(verify_access_token("test-only-auth-secret", &token_for_claims(&claims)).is_err());

        claims = valid_claims();
        claims.auth_time = Some(claims.iat + 1);
        assert!(verify_access_token("test-only-auth-secret", &token_for_claims(&claims)).is_err());
    }

    #[test]
    fn recovery_codes_are_bounded_unique_and_have_three_complete_groups() {
        for (requested, expected) in [(0, 1), (10, 10), (usize::MAX, 20)] {
            let codes = generate_recovery_codes(requested);
            assert_eq!(codes.len(), expected);
            let unique = codes.iter().collect::<std::collections::HashSet<_>>();
            assert_eq!(unique.len(), expected);
            for code in codes {
                assert_eq!(code.len(), 17);
                assert_eq!(code.as_bytes()[5], b'-');
                assert_eq!(code.as_bytes()[11], b'-');
                assert!(code
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')));
            }
        }
    }

    #[test]
    fn recovery_code_hash_normalizes_case_spacing_and_dashes() {
        assert_eq!(
            hash_recovery_code("ab12c-def34-ghijk"),
            hash_recovery_code(" AB12C DEF34 GHIJK ")
        );
    }

    #[test]
    fn passkey_registration_start_returns_public_options_and_server_state() {
        let result = start_passkey_registration(
            &WebAuthnConfig::localhost_for_tests(),
            Uuid::new_v4(),
            "owner@hms.local",
            "HMS Owner",
            &[],
        )
        .expect("registration options are created");

        assert!(result.public_key.get("challenge").is_some());
        assert!(result.state.is_object());
        assert!(result.expires_at > Utc::now());
    }
}
