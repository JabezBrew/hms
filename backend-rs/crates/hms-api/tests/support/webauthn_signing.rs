//! Test-only software authenticator. Private keys are generated in memory for
//! each fixture and are never serialized, printed, or stored in the database.
//!
//! This implements the small WebAuthn wire subset these HTTP contracts exercise:
//! ES256/P-256, a non-discoverable credential, and ordinary `none` attestation.
//! `none` makes no manufacturer-attestation claim; subsequent assertions prove
//! possession of the freshly generated private key against the registered key.

use aws_lc_rs::{
    rand::SystemRandom,
    signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_ASN1_SIGNING},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand_core::{OsRng, RngCore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU32, Ordering};

#[derive(Clone)]
pub struct Ceremony {
    pub challenge: String,
    pub origin: String,
    pub rp_id: String,
    pub user_present: bool,
    pub user_verified: bool,
    pub counter: u32,
}

impl Ceremony {
    pub fn from_options(options: &Value, origin: &str, counter: u32) -> Self {
        Self {
            challenge: options["challenge"]
                .as_str()
                .expect("server supplies a WebAuthn challenge")
                .to_owned(),
            origin: origin.to_owned(),
            rp_id: options["rp"]["id"]
                .as_str()
                .or_else(|| options["rpId"].as_str())
                .expect("server supplies the relying-party ID")
                .to_owned(),
            user_present: true,
            user_verified: true,
            counter,
        }
    }

    fn client_data(&self, ceremony_type: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "type": ceremony_type,
            "challenge": self.challenge,
            "origin": self.origin,
            "crossOrigin": false
        }))
        .expect("synthetic client data serializes")
    }

    fn authenticator_data(&self, registration: bool) -> Vec<u8> {
        let mut data = Sha256::digest(self.rp_id.as_bytes()).to_vec();
        let flags = u8::from(self.user_present)
            | (u8::from(self.user_verified) << 2)
            | (u8::from(registration) << 6);
        data.push(flags);
        data.extend_from_slice(&self.counter.to_be_bytes());
        data
    }
}

pub struct SoftwareAuthenticator {
    signing_key: EcdsaKeyPair,
    credential_id: [u8; 32],
    last_counter: AtomicU32,
}

impl SoftwareAuthenticator {
    pub fn new() -> Self {
        let signing_key = EcdsaKeyPair::generate(&ECDSA_P256_SHA256_ASN1_SIGNING)
            .expect("ephemeral P-256 signing key generates");
        let mut credential_id = [0_u8; 32];
        OsRng.fill_bytes(&mut credential_id);
        Self {
            signing_key,
            credential_id,
            last_counter: AtomicU32::new(0),
        }
    }

    pub fn credential_id(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.credential_id)
    }

    pub fn registration(&self, ceremony: &Ceremony) -> Value {
        let client_data = ceremony.client_data("webauthn.create");
        let mut authenticator_data = ceremony.authenticator_data(true);
        authenticator_data.extend_from_slice(&[0_u8; 16]); // AAGUID, no attestation identity.
        authenticator_data.extend_from_slice(&(self.credential_id.len() as u16).to_be_bytes());
        authenticator_data.extend_from_slice(&self.credential_id);
        authenticator_data.extend_from_slice(&self.cose_public_key());

        // The only CBOR types needed are a map, text, bytes and small integers.
        let mut attestation = vec![0xa3]; // map(3)
        text(&mut attestation, "fmt");
        text(&mut attestation, "none");
        text(&mut attestation, "attStmt");
        attestation.push(0xa0); // map(0)
        text(&mut attestation, "authData");
        bytes(&mut attestation, &authenticator_data);

        json!({
            "id": self.credential_id(),
            "rawId": self.credential_id(),
            "type": "public-key",
            "response": {
                "clientDataJSON": URL_SAFE_NO_PAD.encode(client_data),
                "attestationObject": URL_SAFE_NO_PAD.encode(attestation),
                "transports": ["internal"]
            },
            "clientExtensionResults": {}
        })
    }

    pub fn assertion(&self, ceremony: &Ceremony) -> Value {
        self.assertion_using_signer(ceremony, self)
    }

    /// Ordinary shared fixtures use a genuine increasing authenticator counter.
    /// Explicit Ceremony counters remain available for negative replay tests.
    pub fn next_assertion(&self, options: &Value, origin: &str) -> Value {
        let previous = self
            .last_counter
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                value.checked_add(1)
            })
            .expect("synthetic authenticator counter remains in range");
        self.assertion(&Ceremony::from_options(options, origin, previous + 1))
    }

    /// A valid DER signature made with another private key tests signature
    /// verification specifically, rather than just invalid encoding rejection.
    pub fn assertion_using_signer(&self, ceremony: &Ceremony, signer: &Self) -> Value {
        self.last_counter
            .fetch_max(ceremony.counter, Ordering::SeqCst);
        let client_data = ceremony.client_data("webauthn.get");
        let authenticator_data = ceremony.authenticator_data(false);
        let mut signed = authenticator_data.clone();
        signed.extend_from_slice(&Sha256::digest(&client_data));
        let signature = signer
            .signing_key
            .sign(&SystemRandom::new(), &signed)
            .expect("ephemeral authenticator signs the actual assertion bytes");
        json!({
            "id": self.credential_id(),
            "rawId": self.credential_id(),
            "type": "public-key",
            "response": {
                "clientDataJSON": URL_SAFE_NO_PAD.encode(client_data),
                "authenticatorData": URL_SAFE_NO_PAD.encode(authenticator_data),
                "signature": URL_SAFE_NO_PAD.encode(signature.as_ref()),
                "userHandle": null
            },
            "clientExtensionResults": {}
        })
    }

    fn cose_public_key(&self) -> Vec<u8> {
        let public = self.signing_key.public_key();
        let point = public.as_ref();
        assert_eq!(point.len(), 65, "P-256 public point is uncompressed");
        assert_eq!(point[0], 4);
        let mut cose = vec![
            0xa5, // map(5)
            0x01, 0x02, // 1:2, kty EC2
            0x03, 0x26, // 3:-7, alg ES256
            0x20, 0x01, // -1:1, curve P-256
            0x21, // -2:x
        ];
        bytes(&mut cose, &point[1..33]);
        cose.push(0x22); // -3:y
        bytes(&mut cose, &point[33..65]);
        cose
    }
}

fn length(output: &mut Vec<u8>, major: u8, size: usize) {
    if size < 24 {
        output.push((major << 5) | size as u8);
    } else if let Ok(size) = u8::try_from(size) {
        output.extend_from_slice(&[(major << 5) | 24, size]);
    } else {
        let size = u16::try_from(size).expect("test-only CBOR field is bounded to 64 KiB");
        output.push((major << 5) | 25);
        output.extend_from_slice(&size.to_be_bytes());
    }
}

fn text(output: &mut Vec<u8>, value: &str) {
    length(output, 3, value.len());
    output.extend_from_slice(value.as_bytes());
}

fn bytes(output: &mut Vec<u8>, value: &[u8]) {
    length(output, 2, value.len());
    output.extend_from_slice(value);
}
