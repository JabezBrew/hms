//! Cryptographic HTTP contracts for the existing enrollment/assertion-test API.
//! These isolate enrollment/assertion-test crypto from the separate real login/step-up API.
//! A genuine fixture passkey establishes the initial session; adding a key still
//! requires its explicit same-session existing-factor management proof.

mod support;
#[path = "support/webauthn_signing.rs"]
mod webauthn_signing;

use support::*;
use webauthn_signing::{Ceremony, SoftwareAuthenticator};

const ORIGIN: &str = "http://localhost:8080";
const REGISTER_OPTIONS: &str = "/api/v2/auth/mfa/webauthn/register/options";
const REGISTER_VERIFY: &str = "/api/v2/auth/mfa/webauthn/register/verify";
const AUTH_OPTIONS: &str = "/api/v2/auth/mfa/webauthn/authenticate/options";
const AUTH_VERIFY: &str = "/api/v2/auth/mfa/webauthn/authenticate/verify";

async fn post(app: &TestApp, token: &str, path: &str, body: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .expect("synthetic WebAuthn request builds"),
        )
        .await
        .expect("WebAuthn HTTP request completes")
}

async fn options(app: &TestApp, token: &str, path: &str) -> Value {
    if path == REGISTER_OPTIONS {
        step_up_test_session(app, token, None).await;
    }
    let response = post(app, token, path, json!({})).await;
    assert_eq!(response.status(), StatusCode::OK);
    let result = json_body(response).await;
    assert!(result["data"]["challenge"].is_string());
    assert!(result["data"]["mfa_session"].is_string());
    result["data"].clone()
}

fn verify_body(options: &Value, credential: Value) -> Value {
    json!({"mfa_session": options["mfa_session"], "credential": credential})
}

async fn assert_verified(response: axum::response::Response) {
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!response.headers().contains_key(SET_COOKIE));
    let body = json_body(response).await;
    assert!(
        body["data"] == json!({"verified": true}),
        "assertion-test response contains only the verified flag"
    );
}

async fn assert_rejected(response: axum::response::Response, code: &str) {
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(!response.headers().contains_key(SET_COOKIE));
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], code);
    assert!(body["data"].is_null());
}

async fn register(app: &TestApp, token: &str, authenticator: &SoftwareAuthenticator) -> Value {
    let challenge = options(app, token, REGISTER_OPTIONS).await;
    let ceremony = Ceremony::from_options(&challenge, ORIGIN, 0);
    assert_eq!(ceremony.rp_id, "localhost");
    assert_eq!(
        challenge["authenticatorSelection"]["userVerification"],
        "required"
    );
    assert_verified(
        post(
            app,
            token,
            REGISTER_VERIFY,
            verify_body(&challenge, authenticator.registration(&ceremony)),
        )
        .await,
    )
    .await;
    challenge
}

async fn stored_credential(app: &TestApp, token: &str) -> hms_db::auth::WebAuthnCredentialRow {
    let claims = access_claims(token);
    let pool = app.db_pool().await;
    let mut credentials =
        hms_db::auth::list_webauthn_credentials(&pool, claims.facility_id, claims.sub)
            .await
            .expect("synthetic credential evidence reads");
    assert!(
        credentials.len() >= 1,
        "the genuine initial fixture key remains preserved"
    );
    credentials.remove(0)
}

#[tokio::test]
async fn real_registration_assertion_and_counter_persist_without_issuing_new_session() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    let registration = register(&app, &token, &authenticator).await;
    let before = stored_credential(&app, &token).await;
    assert!(
        before.credential_id == authenticator.credential_id(),
        "registered credential identity matches the authenticator"
    );
    assert_eq!(before.passkey["cred"]["counter"], 0);
    assert!(before.last_used_at.is_none());

    let challenge = options(&app, &token, AUTH_OPTIONS).await;
    assert_eq!(challenge["userVerification"], "required");
    assert!(
        challenge["allowCredentials"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value["id"] == authenticator.credential_id()),
        "server allows the registered authenticator"
    );
    let ceremony = Ceremony::from_options(&challenge, ORIGIN, 1);
    let body = verify_body(&challenge, authenticator.assertion(&ceremony));
    assert_verified(post(&app, &token, AUTH_VERIFY, body.clone()).await).await;
    let after = stored_credential(&app, &token).await;
    assert_eq!(after.id, before.id);
    assert_eq!(after.passkey["cred"]["counter"], 1);
    assert!(after.last_used_at.is_some());
    assert_rejected(
        post(&app, &token, AUTH_VERIFY, body).await,
        "webauthn_challenge_invalid",
    )
    .await;
    assert_rejected(
        post(
            &app,
            &token,
            REGISTER_VERIFY,
            verify_body(
                &registration,
                authenticator.registration(&Ceremony::from_options(&registration, ORIGIN, 0)),
            ),
        )
        .await,
        "webauthn_challenge_invalid",
    )
    .await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    let sessions: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM refresh_sessions WHERE facility_id=$1 AND user_id=$2",
    )
    .bind(claims.facility_id)
    .bind(claims.sub)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        sessions, 1,
        "the assertion-test API does not issue MFA sessions"
    );
}

#[tokio::test]
async fn registration_rejects_wrong_origin_rp_challenge_presence_and_verification() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    for invalid in ["origin", "rp", "challenge", "presence", "verification"] {
        let authenticator = SoftwareAuthenticator::new();
        let challenge = options(&app, &token, REGISTER_OPTIONS).await;
        let mut ceremony = Ceremony::from_options(&challenge, ORIGIN, 0);
        invalidate(&mut ceremony, invalid);
        assert_rejected(
            post(
                &app,
                &token,
                REGISTER_VERIFY,
                verify_body(&challenge, authenticator.registration(&ceremony)),
            )
            .await,
            "webauthn_verify_failed",
        )
        .await;
        // Failed verification consumes the ceremony, so it cannot be repurposed.
        assert_rejected(
            post(
                &app,
                &token,
                REGISTER_VERIFY,
                verify_body(
                    &challenge,
                    authenticator.registration(&Ceremony::from_options(&challenge, ORIGIN, 0)),
                ),
            )
            .await,
            "webauthn_challenge_invalid",
        )
        .await;
    }
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    assert!(
        hms_db::auth::list_webauthn_credentials(&pool, claims.facility_id, claims.sub)
            .await
            .unwrap()
            .len()
            == 1
    );
}

fn invalidate(ceremony: &mut Ceremony, invalid: &str) {
    match invalid {
        "origin" => ceremony.origin = "https://different-origin.invalid".to_owned(),
        "rp" => ceremony.rp_id = "different-rp.invalid".to_owned(),
        "challenge" => ceremony.challenge = "aW5jb3JyZWN0LWNoYWxsZW5nZQ".to_owned(),
        "presence" => ceremony.user_present = false,
        "verification" => ceremony.user_verified = false,
        _ => panic!("unknown synthetic negative case"),
    }
}

#[tokio::test]
async fn assertion_rejects_wrong_origin_rp_challenge_signature_presence_and_verification() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    let attacker = SoftwareAuthenticator::new();
    register(&app, &token, &authenticator).await;
    let before = stored_credential(&app, &token).await;
    for invalid in [
        "origin",
        "rp",
        "challenge",
        "signature",
        "credential",
        "presence",
        "verification",
    ] {
        let challenge = options(&app, &token, AUTH_OPTIONS).await;
        let mut ceremony = Ceremony::from_options(&challenge, ORIGIN, 1);
        let credential = if invalid == "signature" {
            authenticator.assertion_using_signer(&ceremony, &attacker)
        } else if invalid == "credential" {
            attacker.assertion(&ceremony)
        } else {
            invalidate(&mut ceremony, invalid);
            authenticator.assertion(&ceremony)
        };
        assert_rejected(
            post(
                &app,
                &token,
                AUTH_VERIFY,
                verify_body(&challenge, credential),
            )
            .await,
            "webauthn_verify_failed",
        )
        .await;
        assert_rejected(
            post(
                &app,
                &token,
                AUTH_VERIFY,
                verify_body(
                    &challenge,
                    authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1)),
                ),
            )
            .await,
            "webauthn_challenge_invalid",
        )
        .await;
        let after = stored_credential(&app, &token).await;
        assert!(
            after.passkey == before.passkey,
            "stored credential material remains unchanged"
        );
        assert_eq!(after.last_used_at, before.last_used_at);
    }
}

#[tokio::test]
async fn challenges_are_bound_to_the_actor_and_ceremony_purpose() {
    let app = app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let (other, _, _) = login(app.clone(), "limited@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    let registration = options(&app, &owner, REGISTER_OPTIONS).await;
    let credential = authenticator.registration(&Ceremony::from_options(&registration, ORIGIN, 0));
    assert_rejected(
        post(
            &app,
            &other,
            REGISTER_VERIFY,
            verify_body(&registration, credential.clone()),
        )
        .await,
        "webauthn_challenge_invalid",
    )
    .await;
    assert_rejected(
        post(
            &app,
            &owner,
            AUTH_VERIFY,
            verify_body(&registration, credential.clone()),
        )
        .await,
        "webauthn_challenge_invalid",
    )
    .await;
    // Neither a foreign actor nor the wrong endpoint consumes the real grant.
    assert_verified(
        post(
            &app,
            &owner,
            REGISTER_VERIFY,
            verify_body(&registration, credential),
        )
        .await,
    )
    .await;

    let challenge = options(&app, &owner, AUTH_OPTIONS).await;
    let credential = authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1));
    assert_rejected(
        post(
            &app,
            &other,
            AUTH_VERIFY,
            verify_body(&challenge, credential.clone()),
        )
        .await,
        "webauthn_challenge_invalid",
    )
    .await;
    assert_rejected(
        post(
            &app,
            &owner,
            REGISTER_VERIFY,
            verify_body(&challenge, credential.clone()),
        )
        .await,
        "webauthn_challenge_invalid",
    )
    .await;
    assert_verified(
        post(
            &app,
            &owner,
            AUTH_VERIFY,
            verify_body(&challenge, credential),
        )
        .await,
    )
    .await;
}

#[tokio::test]
async fn simultaneous_assertion_replay_has_exactly_one_winner() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    register(&app, &token, &authenticator).await;
    let challenge = options(&app, &token, AUTH_OPTIONS).await;
    let body = verify_body(
        &challenge,
        authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1)),
    );
    let (first, second) = tokio::join!(
        post(&app, &token, AUTH_VERIFY, body.clone()),
        post(&app, &token, AUTH_VERIFY, body),
    );
    let (accepted, rejected) = if first.status() == StatusCode::OK {
        (first, second)
    } else {
        (second, first)
    };
    assert_verified(accepted).await;
    assert_rejected(rejected, "webauthn_challenge_invalid").await;
    assert_eq!(
        stored_credential(&app, &token).await.passkey["cred"]["counter"],
        1
    );
    let pool = app.db_pool().await;
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='auth.webauthn.authentication.verified'",
    )
    .bind(Uuid::parse_str(challenge["mfa_session"].as_str().unwrap()).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        audits, 1,
        "concurrent replay produces one atomic success audit"
    );
}

#[tokio::test]
async fn fresh_assertions_require_increasing_supported_signature_counters() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    register(&app, &token, &authenticator).await;
    for (counter, accepted) in [(4, true), (4, false), (3, false), (5, true)] {
        // Obtain new options each time, so this specifically exercises the
        // saved authenticator counter rather than one-time challenge rejection.
        let challenge = options(&app, &token, AUTH_OPTIONS).await;
        let response = post(
            &app,
            &token,
            AUTH_VERIFY,
            verify_body(
                &challenge,
                authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, counter)),
            ),
        )
        .await;
        if accepted {
            assert_verified(response).await;
        } else {
            assert_rejected(response, "webauthn_verify_failed").await;
        }
        assert_eq!(
            stored_credential(&app, &token).await.passkey["cred"]["counter"],
            if counter == 5 { 5 } else { 4 }
        );
    }
}

#[tokio::test]
async fn expired_registration_and_assertion_challenges_cannot_change_credentials() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    let pool = app.db_pool().await;
    let registration = options(&app, &token, REGISTER_OPTIONS).await;
    expire_challenge(&pool, &registration).await;
    assert_rejected(
        post(
            &app,
            &token,
            REGISTER_VERIFY,
            verify_body(
                &registration,
                authenticator.registration(&Ceremony::from_options(&registration, ORIGIN, 0)),
            ),
        )
        .await,
        "webauthn_challenge_invalid",
    )
    .await;
    let claims = access_claims(&token);
    assert!(
        hms_db::auth::list_webauthn_credentials(&pool, claims.facility_id, claims.sub)
            .await
            .unwrap()
            .len()
            == 1
    );

    register(&app, &token, &authenticator).await;
    let before = stored_credential(&app, &token).await;
    let challenge = options(&app, &token, AUTH_OPTIONS).await;
    expire_challenge(&pool, &challenge).await;
    assert_rejected(
        post(
            &app,
            &token,
            AUTH_VERIFY,
            verify_body(
                &challenge,
                authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1)),
            ),
        )
        .await,
        "webauthn_challenge_invalid",
    )
    .await;
    let after = stored_credential(&app, &token).await;
    assert!(
        after.passkey == before.passkey,
        "stored credential material remains unchanged"
    );
    assert_eq!(after.last_used_at, before.last_used_at);
}

async fn expire_challenge(pool: &hms_db::PgPool, options: &Value) {
    let id = Uuid::parse_str(options["mfa_session"].as_str().unwrap()).unwrap();
    let changed = sqlx::query(
        "UPDATE auth_webauthn_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    assert_eq!(changed.rows_affected(), 1);
}

#[tokio::test]
async fn revoked_or_missing_bearer_cannot_finish_a_genuine_signed_assertion() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    register(&app, &token, &authenticator).await;
    let challenge = options(&app, &token, AUTH_OPTIONS).await;
    let body = verify_body(
        &challenge,
        authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1)),
    );
    let missing = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(AUTH_VERIFY)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
    let claims = access_claims(&token);
    let revoked = post(
        &app,
        &token,
        &format!("/api/v2/auth/sessions/{}/revoke", claims.session_id),
        json!({}),
    )
    .await;
    assert_eq!(revoked.status(), StatusCode::OK);
    let denied = post(&app, &token, AUTH_VERIFY, body).await;
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    assert!(!denied.headers().contains_key(SET_COOKIE));
    let after = stored_credential(&app, &token).await;
    assert_eq!(after.passkey["cred"]["counter"], 0);
    assert!(after.last_used_at.is_none());
    let pool = app.db_pool().await;
    let consumed: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT consumed_at FROM auth_webauthn_challenges WHERE id=$1")
            .bind(Uuid::parse_str(challenge["mfa_session"].as_str().unwrap()).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        consumed.is_none(),
        "invalid sessions cannot consume a ceremony"
    );
}

#[tokio::test]
async fn assertion_challenge_is_bound_to_the_initiating_session() {
    let app = app().await;
    let (initiator, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    register(&app, &initiator, &authenticator).await;
    let challenge = options(&app, &initiator, AUTH_OPTIONS).await;
    let (other_session, _, _) = login(app.clone(), "owner@hms.local").await;
    assert_ne!(
        access_claims(&initiator).session_id,
        access_claims(&other_session).session_id,
    );
    let body = verify_body(
        &challenge,
        authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1)),
    );
    let response = post(&app, &other_session, AUTH_VERIFY, body.clone()).await;
    assert_eq!(
        response.status(),
        StatusCode::BAD_REQUEST,
        "session-bound ceremonies must reject a challenge begun by another session",
    );
    assert_eq!(
        json_body(response).await["error"]["code"],
        "webauthn_challenge_invalid"
    );
    assert_verified(post(&app, &initiator, AUTH_VERIFY, body).await).await;

    let second_key = SoftwareAuthenticator::new();
    let registration = options(&app, &initiator, REGISTER_OPTIONS).await;
    let body = verify_body(
        &registration,
        second_key.registration(&Ceremony::from_options(&registration, ORIGIN, 0)),
    );
    assert_rejected(
        post(&app, &other_session, REGISTER_VERIFY, body.clone()).await,
        "webauthn_challenge_invalid",
    )
    .await;
    assert_verified(post(&app, &initiator, REGISTER_VERIFY, body).await).await;
}

#[tokio::test]
async fn assertion_challenge_expiry_is_rechecked_after_lock_wait() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    register(&app, &token, &authenticator).await;
    let challenge = options(&app, &token, AUTH_OPTIONS).await;
    let challenge_id = Uuid::parse_str(challenge["mfa_session"].as_str().unwrap()).unwrap();
    let pool = app.db_pool().await;
    sqlx::query("UPDATE auth_webauthn_challenges SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1")
        .bind(challenge_id)
        .execute(&pool)
        .await
        .unwrap();
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM auth_webauthn_challenges WHERE id=$1 FOR UPDATE")
        .bind(challenge_id)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let body = verify_body(
        &challenge,
        authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1)),
    );
    let pending_app = app.clone();
    let pending = tokio::spawn(async move { post(&pending_app, &token, AUTH_VERIFY, body).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM auth_webauthn_challenges%' AND query LIKE '%FOR UPDATE%')",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            if waiting {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("real assertion request reaches the held challenge lock");
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let expired: bool = sqlx::query_scalar(
                "SELECT expires_at<=clock_timestamp() FROM auth_webauthn_challenges WHERE id=$1",
            )
            .bind(challenge_id)
            .fetch_one(&pool)
            .await
            .unwrap();
            if expired {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("challenge naturally expires while the request waits");
    blocker.commit().await.unwrap();
    let response = pending.await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::BAD_REQUEST,
        "session-bound ceremonies must not accept a challenge that expired during a lock wait",
    );
    assert_eq!(
        json_body(response).await["error"]["code"],
        "webauthn_challenge_invalid"
    );
    let consumed: bool = sqlx::query_scalar(
        "SELECT consumed_at IS NOT NULL FROM auth_webauthn_challenges WHERE id=$1",
    )
    .bind(challenge_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!consumed);
}

#[tokio::test]
async fn session_revocation_during_actor_wait_denies_all_four_ceremony_operations() {
    for path in [REGISTER_OPTIONS, AUTH_OPTIONS, REGISTER_VERIFY, AUTH_VERIFY] {
        let app = app().await;
        let (token, _, _) = login(app.clone(), "owner@hms.local").await;
        let authenticator = SoftwareAuthenticator::new();
        register(&app, &token, &authenticator).await;
        let body = match path {
            REGISTER_VERIFY => {
                let challenge = options(&app, &token, REGISTER_OPTIONS).await;
                let new_key = SoftwareAuthenticator::new();
                verify_body(
                    &challenge,
                    new_key.registration(&Ceremony::from_options(&challenge, ORIGIN, 0)),
                )
            }
            AUTH_VERIFY => {
                let challenge = options(&app, &token, AUTH_OPTIONS).await;
                verify_body(
                    &challenge,
                    authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1)),
                )
            }
            _ => json!({}),
        };
        let pool = app.db_pool().await;
        let claims = access_claims(&token);
        let (other, _, _) = login(app.clone(), "owner@hms.local").await;
        let before: (i64, i64, i64) = auth_evidence_counts(&pool).await;
        let mut blocker = pool.begin().await.unwrap();
        // The public revoker now correctly takes its facility first too. Hold
        // only actor NKU: ceremonies wait on it, while the public revoker's
        // audit/FK KEY SHARE remains compatible and can actually win.
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
            .bind(claims.sub)
            .fetch_one(&mut *blocker)
            .await
            .unwrap();
        let pending_app = app.clone();
        let pending_token = token.clone();
        let pending =
            tokio::spawn(async move { post(&pending_app, &pending_token, path, body).await });
        wait_for_lock(&pool, "%FROM users%", "Lock").await;
        // Revoke through the actual public endpoint while the ceremony is
        // waiting on the actor, after its compatible facility read lock.
        let revoke = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            post(
                &app,
                &other,
                &format!("/api/v2/auth/sessions/{}/revoke", claims.session_id),
                json!({}),
            ),
        )
        .await
        .expect("public revoke completes without waiting on compatible actor lock");
        assert_eq!(revoke.status(), StatusCode::OK);
        blocker.commit().await.unwrap();
        let denied = pending.await.unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(denied).await["error"]["code"],
            if path == REGISTER_OPTIONS {
                "factor_authorization_expired"
            } else {
                "webauthn_authority_expired"
            }
        );
        assert_eq!(auth_evidence_counts(&pool).await, before);
    }
}

async fn wait_for_lock(pool: &hms_db::PgPool, query_pattern: &str, event: &str) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type=$1 AND query LIKE $2)",
            ).bind(event).bind(query_pattern).fetch_one(pool).await.unwrap();
            if waiting { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("HTTP ceremony reaches the real database lock");
}

async fn auth_evidence_counts(pool: &hms_db::PgPool) -> (i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT count(*) FROM auth_webauthn_challenges), (SELECT count(*) FROM auth_webauthn_credentials), (SELECT count(*) FROM audit_events WHERE event_type LIKE 'auth.webauthn.%')")
        .fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn audit_failure_rolls_back_registration_and_matching_invalid_crypto_consumption() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    let challenge = options(&app, &token, REGISTER_OPTIONS).await;
    let body = verify_body(
        &challenge,
        authenticator.registration(&Ceremony::from_options(&challenge, ORIGIN, 0)),
    );
    let pool = app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION reject_test_webauthn_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type LIKE 'auth.webauthn.%' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_test_webauthn_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_test_webauthn_audit();")
        .execute(&pool).await.unwrap();
    assert_rejected(
        post(&app, &token, REGISTER_VERIFY, body.clone()).await,
        "webauthn_verify_failed",
    )
    .await;
    assert_eq!(auth_evidence_counts(&pool).await, (1, 1, 0));
    assert_challenge_unconsumed(&pool, &challenge).await;

    // The same atomicity guarantee applies to a matching failed assertion:
    // audit failure must not leave an unaudited consumed challenge.
    let mut bad = Ceremony::from_options(&challenge, ORIGIN, 0);
    bad.origin = "https://different-origin.invalid".to_owned();
    assert_rejected(
        post(
            &app,
            &token,
            REGISTER_VERIFY,
            verify_body(&challenge, authenticator.registration(&bad)),
        )
        .await,
        "webauthn_verify_failed",
    )
    .await;
    assert_challenge_unconsumed(&pool, &challenge).await;
    sqlx::raw_sql("DROP TRIGGER reject_test_webauthn_audit ON audit_events; DROP FUNCTION reject_test_webauthn_audit();").execute(&pool).await.unwrap();
    assert_verified(post(&app, &token, REGISTER_VERIFY, body).await).await;
    assert_eq!(auth_evidence_counts(&pool).await, (1, 2, 1));
    let audit: (Uuid,String,Value) = sqlx::query_as("SELECT actor_user_id,event_type,metadata FROM audit_events WHERE event_type LIKE 'auth.webauthn.%'")
        .fetch_one(&pool).await.unwrap();
    assert!(
        audit
            == (
                access_claims(&token).sub,
                "auth.webauthn.registration.verified".to_owned(),
                json!({})
            ),
        "audit has the expected actor and event with empty metadata"
    );
}

async fn assert_challenge_unconsumed(pool: &hms_db::PgPool, challenge: &Value) {
    let consumed: bool = sqlx::query_scalar(
        "SELECT consumed_at IS NOT NULL FROM auth_webauthn_challenges WHERE id=$1",
    )
    .bind(Uuid::parse_str(challenge["mfa_session"].as_str().unwrap()).unwrap())
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(!consumed);
}

#[tokio::test]
async fn natural_session_expiry_during_final_audit_rolls_back_all_assertion_evidence() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let authenticator = SoftwareAuthenticator::new();
    register(&app, &token, &authenticator).await;
    let challenge = options(&app, &token, AUTH_OPTIONS).await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    let before = stored_credential(&app, &token).await;
    let before_counts = auth_evidence_counts(&pool).await;
    sqlx::raw_sql("CREATE FUNCTION hold_test_webauthn_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='auth.webauthn.authentication.verified' THEN PERFORM pg_advisory_xact_lock(61420261016); END IF; RETURN NEW; END; $$; CREATE TRIGGER hold_test_webauthn_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION hold_test_webauthn_audit();")
        .execute(&pool).await.unwrap();
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(61420261016)")
        .execute(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("UPDATE refresh_sessions SET idle_expires_at=clock_timestamp()+interval '2 seconds' WHERE session_id=$1")
        .bind(claims.session_id).execute(&pool).await.unwrap();
    let body = verify_body(
        &challenge,
        authenticator.assertion(&Ceremony::from_options(&challenge, ORIGIN, 1)),
    );
    let pending_app = app.clone();
    let pending_token = token.clone();
    let pending =
        tokio::spawn(async move { post(&pending_app, &pending_token, AUTH_VERIFY, body).await });
    wait_for_lock(&pool, "%INSERT INTO audit_events%", "Lock").await;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let expired: bool = sqlx::query_scalar("SELECT idle_expires_at<=clock_timestamp() FROM refresh_sessions WHERE session_id=$1")
                .bind(claims.session_id).fetch_one(&pool).await.unwrap();
            if expired { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("session expires while final audit waits");
    blocker.commit().await.unwrap();
    let denied = pending.await.unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "webauthn_authority_expired"
    );
    assert_eq!(auth_evidence_counts(&pool).await, before_counts);
    assert_challenge_unconsumed(&pool, &challenge).await;
    let after = stored_credential(&app, &token).await;
    assert!(
        after.passkey == before.passkey,
        "stored credential material remains unchanged"
    );
    assert_eq!(after.last_used_at, before.last_used_at);
}

#[tokio::test]
async fn session_binding_migration_retires_only_unbound_legacy_challenges() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    let mut tx = pool.begin().await.unwrap();
    let before: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM public.users),(SELECT count(*) FROM public.refresh_sessions)",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    // Shadow the current relation with its exact old shape, then execute the
    // real migration SQL rather than a rewritten approximation of its update.
    sqlx::raw_sql("CREATE TEMP TABLE refresh_sessions (session_id uuid PRIMARY KEY); INSERT INTO pg_temp.refresh_sessions SELECT session_id FROM public.refresh_sessions; CREATE TEMP TABLE auth_webauthn_challenges (LIKE public.auth_webauthn_challenges INCLUDING DEFAULTS); ALTER TABLE pg_temp.auth_webauthn_challenges DROP COLUMN initiating_session_id, DROP COLUMN session_version, DROP COLUMN permission_version, DROP COLUMN active_profile;")
        .execute(&mut *tx).await.unwrap();
    let ids = [Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
    for (index, id) in ids.iter().enumerate() {
        sqlx::query("INSERT INTO pg_temp.auth_webauthn_challenges(id,user_id,facility_id,ceremony_type,state,expires_at,consumed_at) VALUES($1,$2,$3,'registration','{\"synthetic_legacy_state\":true}',clock_timestamp()+interval '5 minutes',CASE WHEN $4 THEN '2026-01-01T00:00:00Z'::timestamptz END)")
            .bind(id).bind(claims.sub).bind(claims.facility_id).bind(index==2).execute(&mut *tx).await.unwrap();
    }
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610160021_webauthn_session_binding.sql"
    ))
    .execute(&mut *tx)
    .await
    .unwrap();
    let retired: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM pg_temp.auth_webauthn_challenges WHERE consumed_at IS NOT NULL AND initiating_session_id IS NULL AND session_version IS NULL AND permission_version IS NULL AND active_profile IS NULL AND state='{"synthetic_legacy_state":true}'::jsonb"#)
        .fetch_one(&mut *tx).await.unwrap();
    assert_eq!(retired, 3);
    let preserved: bool = sqlx::query_scalar("SELECT consumed_at='2026-01-01T00:00:00Z'::timestamptz FROM pg_temp.auth_webauthn_challenges WHERE id=$1")
        .bind(ids[2]).fetch_one(&mut *tx).await.unwrap();
    assert!(preserved);
    let after: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM public.users),(SELECT count(*) FROM public.refresh_sessions)",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(after, before);
    tx.rollback().await.unwrap();
}
