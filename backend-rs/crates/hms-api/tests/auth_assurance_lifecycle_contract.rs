//! Real signatures, exact sessions and persisted factor-lifecycle contracts.
//! All accounts, keys and database mutations are isolated synthetic fixtures.
mod support;
#[path = "support/webauthn_signing.rs"]
mod webauthn_signing;

use support::*;
use webauthn_signing::{Ceremony, SoftwareAuthenticator};

const ORIGIN: &str = "http://localhost:8080";
const OPTIONS: &str = "/api/v2/auth/assurance/options";
const VERIFY: &str = "/api/v2/auth/assurance/verify";

async fn ok(response: axum::response::Response) -> Value {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "safe error code {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    body["data"].clone()
}

async fn denied(response: axum::response::Response, status: StatusCode, code: &str) {
    assert_eq!(response.status(), status);
    assert!(!response.headers().contains_key(SET_COOKIE));
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], code);
    assert!(body["data"].is_null());
}

async fn read(app: &TestApp, token: &str, path: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn fresh_options(app: &TestApp, token: &str, password: Option<&str>) -> Value {
    ok(fixture_json_post(
        app,
        Some(token),
        OPTIONS,
        json!({"current_password":password}),
    )
    .await)
    .await
}

fn signed(app: &TestApp, user: Uuid, options: &Value) -> Value {
    json!({"challenge_id":options["challenge_id"],"credential":fixture_assertion(app,user,options)})
}

async fn grant(app: &TestApp) -> String {
    let response = raw_password_login(app, "owner@hms.local", "ChangeMe123!", None).await;
    assert!(!response.headers().contains_key(SET_COOKIE));
    let body = ok(response).await;
    assert!(body["access_token"].is_null() && body["user"].is_null());
    body["login_grant"].as_str().unwrap().to_owned()
}

async fn refresh(app: &TestApp, cookie: &str, csrf: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn password_time(pool: &hms_db::PgPool, session: Uuid) -> chrono::DateTime<Utc> {
    sqlx::query_scalar("SELECT password_verified_at FROM refresh_sessions WHERE session_id=$1")
        .bind(session)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn setup_registration_requires_real_assertion_before_any_session_or_cookie() {
    let app = app().await;
    let pool = app.db_pool().await;
    let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let grant = grant(&app).await;
    let sessions: i64 = sqlx::query_scalar("SELECT count(*) FROM refresh_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sessions, 0);
    let bootstrap = hms_db::provision::generate_secret_token();
    hms_db::auth::assurance::issue_bootstrap_grant(
        &pool,
        app.state().facility_id(),
        user,
        &hms_db::provision::hash_refresh_token(&bootstrap),
    )
    .await
    .unwrap();
    let options = ok(fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/setup/options",
        json!({"login_grant":grant,"bootstrap_token":bootstrap}),
    )
    .await)
    .await;
    let signer = SoftwareAuthenticator::new();
    let credential = signer.registration(&Ceremony::from_options(&options, ORIGIN, 0));
    let response = fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/setup/verify",
        json!({"login_grant":grant,"challenge_id":options["challenge_id"],"credential":credential}),
    )
    .await;
    assert!(!response.headers().contains_key(SET_COOKIE));
    let result = ok(response).await;
    assert_eq!(result["status"], "factor_required");
    assert!(result["access_token"].is_null() && result["user"].is_null());
    let count:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM refresh_sessions),(SELECT count(*) FROM auth_session_assurance)").fetch_one(&pool).await.unwrap();
    assert_eq!(count, (0, 0));
    let options = ok(fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/passkey/options",
        json!({"login_grant":grant}),
    )
    .await)
    .await;
    let credential = signer.next_assertion(&options, ORIGIN);
    let response = fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/passkey/verify",
        json!({"login_grant":grant,"challenge_id":options["challenge_id"],"credential":credential}),
    )
    .await;
    assert!(response.headers().contains_key(SET_COOKIE));
    let result = ok(response).await;
    assert_eq!(result["status"], "authenticated");
    let token = result["access_token"].as_str().unwrap();
    let claims = access_claims(token);
    let proof: (String, chrono::DateTime<Utc>) =
        sqlx::query_as("SELECT method,verified_at FROM auth_session_assurance WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(proof.0, "passkey");
    assert_eq!(
        result["user"]["auth_security"]["session_assurance"]["method"],
        "passkey"
    );
}

#[tokio::test]
async fn optional_first_factor_uses_explicit_password_setup_without_changing_login_policy() {
    let app = app().await;
    let pool = app.db_pool().await;
    let response = raw_password_login(&app, "limited@hms.local", "ChangeMe123!", None).await;
    assert!(response.headers().contains_key(SET_COOKIE));
    let ordinary = ok(response).await;
    assert_eq!(ordinary["status"], "authenticated");
    assert_eq!(ordinary["user"]["auth_security"]["passkey_required"], false);
    let user = access_claims(ordinary["access_token"].as_str().unwrap()).sub;
    let sessions: i64 = sqlx::query_scalar("SELECT count(*) FROM refresh_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    let setup_body =
        json!({"email":"limited@hms.local","password":"ChangeMe123!","facility_code":"HMS"});
    let response =
        fixture_json_post(&app, None, "/api/v2/auth/setup/start", setup_body.clone()).await;
    assert!(!response.headers().contains_key(SET_COOKIE));
    let pending = ok(response).await;
    assert_eq!(pending["status"], "setup_required");
    assert!(pending["access_token"].is_null() && pending["user"].is_null());
    let bootstrap = hms_db::provision::generate_secret_token();
    hms_db::auth::assurance::issue_bootstrap_grant(
        &pool,
        app.state().facility_id(),
        user,
        &hms_db::provision::hash_refresh_token(&bootstrap),
    )
    .await
    .unwrap();
    let options = ok(fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/setup/options",
        json!({"login_grant":pending["login_grant"],"bootstrap_token":bootstrap}),
    )
    .await)
    .await;
    let signer = SoftwareAuthenticator::new();
    let response = fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/setup/verify",
        json!({"login_grant":pending["login_grant"],"challenge_id":options["challenge_id"],"credential":signer.registration(&Ceremony::from_options(&options, ORIGIN, 0))}),
    )
    .await;
    assert!(!response.headers().contains_key(SET_COOKIE));
    assert_eq!(ok(response).await["status"], "factor_required");
    let after_registration: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM refresh_sessions),(SELECT count(*) FROM auth_session_assurance)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after_registration, (sessions, 0));
    denied(
        fixture_json_post(&app, None, "/api/v2/auth/setup/start", setup_body).await,
        StatusCode::CONFLICT,
        "existing_factor_required",
    )
    .await;
    let options = ok(fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/passkey/options",
        json!({"login_grant":pending["login_grant"]}),
    )
    .await)
    .await;
    let response = fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/passkey/verify",
        json!({"login_grant":pending["login_grant"],"challenge_id":options["challenge_id"],"credential":signer.next_assertion(&options, ORIGIN)}),
    )
    .await;
    assert!(response.headers().contains_key(SET_COOKIE));
    let verified = ok(response).await;
    assert_eq!(verified["status"], "authenticated");
    assert_eq!(
        verified["user"]["auth_security"]["session_assurance"]["method"],
        "passkey"
    );
    let later = raw_password_login(&app, "limited@hms.local", "ChangeMe123!", None).await;
    assert!(!later.headers().contains_key(SET_COOKIE));
    let later = ok(later).await;
    assert_eq!(later["status"], "factor_required");
    assert!(later["access_token"].is_null() && later["user"].is_null());
}

#[tokio::test]
async fn setup_bootstrap_expiry_during_final_audit_rolls_back_every_change() {
    let app = app().await;
    let pool = app.db_pool().await;
    let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let grant = grant(&app).await;
    let bootstrap = hms_db::provision::generate_secret_token();
    hms_db::auth::assurance::issue_bootstrap_grant(
        &pool,
        app.state().facility_id(),
        user,
        &hms_db::provision::hash_refresh_token(&bootstrap),
    )
    .await
    .unwrap();
    let options = ok(fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/setup/options",
        json!({"login_grant":grant,"bootstrap_token":bootstrap}),
    )
    .await)
    .await;
    let signer = SoftwareAuthenticator::new();
    let body = json!({"login_grant":grant,"challenge_id":options["challenge_id"],"credential":signer.registration(&Ceremony::from_options(&options,ORIGIN,0))});
    let before:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT auth_factor_version FROM users WHERE id=$1),(SELECT count(*) FROM auth_webauthn_credentials),(SELECT count(*) FROM audit_events)").bind(user).fetch_one(&pool).await.unwrap();
    sqlx::raw_sql("CREATE FUNCTION hold_bootstrap_final_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='auth.factor.bootstrap.enrolled' THEN PERFORM pg_advisory_xact_lock(61220261017); END IF; RETURN NEW; END; $$; CREATE TRIGGER hold_bootstrap_final_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION hold_bootstrap_final_audit();").execute(&pool).await.unwrap();
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(61220261017)")
        .execute(&mut *blocker)
        .await
        .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE auth_factor_bootstrap_grants SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1 RETURNING expires_at").bind(hms_db::provision::hash_refresh_token(&bootstrap)).fetch_one(&pool).await.unwrap();
    let other = app.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(&other, None, "/api/v2/auth/login/setup/verify", body).await
    });
    tokio::time::timeout(std::time::Duration::from_secs(4),async{loop{let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO audit_events%')").fetch_one(&pool).await.unwrap();if waiting{break}assert!(!pending.is_finished(),"setup reaches final audit wait");tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 30)).await;
    blocker.commit().await.unwrap();
    denied(
        pending.await.unwrap(),
        StatusCode::FORBIDDEN,
        "factor_authorization_expired",
    )
    .await;
    let after:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT auth_factor_version FROM users WHERE id=$1),(SELECT count(*) FROM auth_webauthn_credentials),(SELECT count(*) FROM audit_events)").bind(user).fetch_one(&pool).await.unwrap();
    assert_eq!(after, before);
    let unchanged:(bool,bool,bool,String)=sqlx::query_as("SELECT c.consumed_at IS NULL,g.consumed_at IS NULL,b.consumed_at IS NULL,g.state FROM auth_factor_challenges c JOIN auth_login_grants g ON g.id=c.login_grant_id JOIN auth_factor_bootstrap_grants b ON b.id=c.bootstrap_id WHERE c.id=$1").bind(Uuid::parse_str(options["challenge_id"].as_str().unwrap()).unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(unchanged, (true, true, true, "setup".to_owned()));
}

#[tokio::test]
async fn exact_session_step_up_preserves_password_time_unless_explicitly_confirmed_after_signature()
{
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let before = password_time(&pool, claims.session_id).await;
    let absolute: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT absolute_expires_at FROM refresh_sessions WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let options = fresh_options(&app, &token, None).await;
    let response = fixture_json_post(
        &app,
        Some(&token),
        VERIFY,
        signed(&app, claims.sub, &options),
    )
    .await;
    assert!(!response.headers().contains_key(SET_COOKIE));
    let result = ok(response).await;
    assert_eq!(
        access_claims(result["access_token"].as_str().unwrap()).session_id,
        claims.session_id
    );
    assert_eq!(password_time(&pool, claims.session_id).await, before);
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    denied(
        fixture_json_post(&app, Some(&token), OPTIONS, json!({})).await,
        StatusCode::FORBIDDEN,
        "password_confirmation_required",
    )
    .await;
    let aged = password_time(&pool, claims.session_id).await;
    let options = fresh_options(&app, &token, Some("ChangeMe123!")).await;
    assert_eq!(
        password_time(&pool, claims.session_id).await,
        aged,
        "options only stage a password proof"
    );
    let result = ok(fixture_json_post(
        &app,
        Some(&token),
        VERIFY,
        signed(&app, claims.sub, &options),
    )
    .await)
    .await;
    let next = access_claims(result["access_token"].as_str().unwrap());
    assert_eq!(next.session_id, claims.session_id);
    assert!(password_time(&pool, claims.session_id).await > aged);
    assert_eq!(result["session_absolute_expires_at"], json!(absolute));
    denied(
        fixture_json_post(
            &app,
            Some(&token),
            VERIFY,
            signed(&app, claims.sub, &options),
        )
        .await,
        StatusCode::BAD_REQUEST,
        "factor_verification_failed",
    )
    .await;
}

#[tokio::test]
async fn step_up_challenges_cannot_cross_sessions_or_login_purposes_and_consume_once() {
    let app = app().await;
    let (a, _, _) = login(app.clone(), "owner@hms.local").await;
    let (b, _, _) = login(app.clone(), "owner@hms.local").await;
    let user = access_claims(&a).sub;
    let options = fresh_options(&app, &a, None).await;
    let body = signed(&app, user, &options);
    denied(
        fixture_json_post(&app, Some(&b), VERIFY, body.clone()).await,
        StatusCode::BAD_REQUEST,
        "factor_verification_failed",
    )
    .await;
    let login_grant = grant(&app).await;
    denied(fixture_json_post(&app,None,"/api/v2/auth/login/passkey/verify",json!({"login_grant":login_grant,"challenge_id":options["challenge_id"],"credential":body["credential"]})).await,StatusCode::BAD_REQUEST,"factor_verification_failed").await;
    let (left, right) = tokio::join!(
        fixture_json_post(&app, Some(&a), VERIFY, body.clone()),
        fixture_json_post(&app, Some(&a), VERIFY, body)
    );
    assert!(
        [left.status(), right.status()]
            .iter()
            .filter(|&&s| s == StatusCode::OK)
            .count()
            == 1
    );
    assert!([left.status(), right.status()].contains(&StatusCode::BAD_REQUEST));
    let pool = app.db_pool().await;
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE event_type='auth.factor.passkey.verified' AND resource_id=$1").bind(Uuid::parse_str(options["challenge_id"].as_str().unwrap()).unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn refresh_preserves_original_factor_password_and_absolute_deadlines_without_renewal() {
    let app = app().await;
    let (token, cookie, csrf) = login(app.clone(), "owner@hms.local").await;
    let old = access_claims(&token);
    let pool = app.db_pool().await;
    let original:(chrono::DateTime<Utc>,chrono::DateTime<Utc>,chrono::DateTime<Utc>,chrono::DateTime<Utc>)=sqlx::query_as("SELECT s.password_verified_at,s.absolute_expires_at,a.verified_at,a.expires_at FROM refresh_sessions s JOIN auth_session_assurance a USING(session_id) WHERE s.session_id=$1").bind(old.session_id).fetch_one(&pool).await.unwrap();
    let response = refresh(&app, &cookie, &csrf).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "real refresh succeeds before any receipt extraction"
    );
    let (next_cookie, next_csrf) = auth_cookies(response.headers());
    let body = ok(response).await;
    let next = access_claims(body["access_token"].as_str().unwrap());
    assert_ne!(old.session_id, next.session_id);
    let current:(chrono::DateTime<Utc>,chrono::DateTime<Utc>,chrono::DateTime<Utc>,chrono::DateTime<Utc>)=sqlx::query_as("SELECT s.password_verified_at,s.absolute_expires_at,a.verified_at,a.expires_at FROM refresh_sessions s JOIN auth_session_assurance a USING(session_id) WHERE s.session_id=$1").bind(next.session_id).fetch_one(&pool).await.unwrap();
    assert_eq!(current, original);
    assert_eq!(
        read(&app, &token, "/api/v2/auth/me").await.status(),
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("WITH captured AS(SELECT clock_timestamp() at) UPDATE auth_session_assurance a SET verified_at=c.at-interval '16 minutes',expires_at=c.at-interval '1 minute' FROM captured c WHERE session_id=$1").bind(next.session_id).execute(&pool).await.unwrap();
    let body = ok(refresh(&app, &next_cookie, &next_csrf).await).await;
    let last = access_claims(body["access_token"].as_str().unwrap());
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM auth_session_assurance WHERE session_id=$1")
            .bind(last.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "expired factor is not refreshed into a new proof");
    assert_eq!(password_time(&pool, last.session_id).await, original.0);
}

#[tokio::test]
async fn malformed_active_sibling_blocks_key_disable_and_rename_without_losing_the_verified_key() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let key: Uuid =
        sqlx::query_scalar("SELECT credential_id FROM auth_session_assurance WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    denied(
        fixture_json_post(
            &app,
            Some(&token),
            &format!("/api/v2/auth/mfa/passkeys/{key}/disable"),
            json!({}),
        )
        .await,
        StatusCode::CONFLICT,
        "last_passkey_required",
    )
    .await;
    sqlx::query("INSERT INTO auth_webauthn_credentials(id,facility_id,user_id,credential_id,passkey) VALUES(gen_random_uuid(),$1,$2,'invalid-synthetic-key','{}'::jsonb)").bind(claims.facility_id).bind(claims.sub).execute(&pool).await.unwrap();
    // Adding any key advances the epoch. Rebind only this already-proven fixture
    // session to reproduce a historical malformed sibling present at enrollment.
    // No positive authentication or privilege claim relies on that bad record.
    sqlx::query("UPDATE auth_session_assurance SET factor_version=(SELECT auth_factor_version FROM users WHERE id=$1) WHERE session_id=$2").bind(claims.sub).bind(claims.session_id).execute(&pool).await.unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    let before:(i64,i64)=sqlx::query_as("SELECT (SELECT auth_factor_version FROM users WHERE id=$1),(SELECT count(*) FROM audit_events WHERE event_type IN('auth.passkey.disabled','auth.passkey.renamed'))").bind(claims.sub).fetch_one(&pool).await.unwrap();
    denied(
        fixture_json_post(
            &app,
            Some(&token),
            &format!("/api/v2/auth/mfa/passkeys/{key}/disable"),
            json!({}),
        )
        .await,
        StatusCode::CONFLICT,
        "factor_management_required",
    )
    .await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/auth/mfa/passkeys/{key}"))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"label":"Reviewed fixture label"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    denied(response, StatusCode::CONFLICT, "factor_management_required").await;
    let after:(i64,i64)=sqlx::query_as("SELECT (SELECT auth_factor_version FROM users WHERE id=$1),(SELECT count(*) FROM audit_events WHERE event_type IN('auth.passkey.disabled','auth.passkey.renamed'))").bind(claims.sub).fetch_one(&pool).await.unwrap();
    assert_eq!(after, before);
    let active: bool =
        sqlx::query_scalar("SELECT disabled_at IS NULL FROM auth_webauthn_credentials WHERE id=$1")
            .bind(key)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(active);
    denied(
        raw_password_login(&app, "owner@hms.local", "ChangeMe123!", None).await,
        StatusCode::CONFLICT,
        "factor_management_required",
    )
    .await;
}

#[tokio::test]
async fn disabling_a_key_invalidates_warmed_other_instance_proof_and_audit_failure_is_atomic() {
    let database = std::sync::Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let mut config =
        hms_api::config::Config::for_tests_with_database_url(database.database_url().to_owned());
    let app = app_with_config(config.clone(), database.clone()).await;
    config.provision_baseline = false;
    let other = app_with_config(config, database).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let original: Uuid =
        sqlx::query_scalar("SELECT credential_id FROM auth_session_assurance WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let options = ok(fixture_json_post(
        &app,
        Some(&token),
        "/api/v2/auth/mfa/webauthn/register/options",
        json!({}),
    )
    .await)
    .await;
    let signer = SoftwareAuthenticator::new();
    ok(fixture_json_post(&app,Some(&token),"/api/v2/auth/mfa/webauthn/register/verify",json!({"mfa_session":options["mfa_session"],"credential":signer.registration(&Ceremony::from_options(&options,ORIGIN,0))})).await).await;
    step_up_test_session(&app, &token, None).await;
    let warm = ok(read(&other, &token, "/api/v2/auth/me").await).await;
    assert_eq!(
        warm["auth_security"]["session_assurance"]["method"],
        "passkey"
    );
    let before:(i64,i64)=sqlx::query_as("SELECT (SELECT auth_factor_version FROM users WHERE id=$1),(SELECT count(*) FROM audit_events WHERE event_type='auth.passkey.disabled')").bind(claims.sub).fetch_one(&pool).await.unwrap();
    sqlx::raw_sql("CREATE FUNCTION reject_factor_disable_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='auth.passkey.disabled' THEN RAISE EXCEPTION 'synthetic audit rejection'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_factor_disable_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_factor_disable_audit();").execute(&pool).await.unwrap();
    let path = format!("/api/v2/auth/mfa/passkeys/{original}/disable");
    denied(
        fixture_json_post(&app, Some(&token), &path, json!({})).await,
        StatusCode::CONFLICT,
        "factor_write_unconfirmed",
    )
    .await;
    let after:(i64,i64)=sqlx::query_as("SELECT (SELECT auth_factor_version FROM users WHERE id=$1),(SELECT count(*) FROM audit_events WHERE event_type='auth.passkey.disabled')").bind(claims.sub).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
    let active: bool =
        sqlx::query_scalar("SELECT disabled_at IS NULL FROM auth_webauthn_credentials WHERE id=$1")
            .bind(original)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(active);
    sqlx::raw_sql("DROP TRIGGER reject_factor_disable_audit ON audit_events; DROP FUNCTION reject_factor_disable_audit();").execute(&pool).await.unwrap();
    let receipt = ok(fixture_json_post(&app, Some(&token), &path, json!({})).await).await;
    assert_eq!(receipt["id"], json!(original));
    assert!(receipt["disabled_at"].is_string());
    let cold = ok(read(&other, &token, "/api/v2/auth/me").await).await;
    assert!(cold["auth_security"]["session_assurance"]["method"].is_null());
    denied(
        fixture_json_post(
            &other,
            Some(&token),
            "/api/v2/auth/mfa/recovery-codes",
            json!({"current_password":"ChangeMe123!"}),
        )
        .await,
        StatusCode::FORBIDDEN,
        "passkey_verification_required",
    )
    .await;
    let options = fresh_options(&app, &token, None).await;
    let result=ok(fixture_json_post(&app,Some(&token),VERIFY,json!({"challenge_id":options["challenge_id"],"credential":signer.next_assertion(&options,ORIGIN)})).await).await;
    let next = result["access_token"].as_str().unwrap();
    let id: Uuid =
        sqlx::query_scalar("SELECT id FROM auth_webauthn_credentials WHERE credential_id=$1")
            .bind(signer.credential_id())
            .fetch_one(&pool)
            .await
            .unwrap();
    denied(
        fixture_json_post(
            &app,
            Some(next),
            &format!("/api/v2/auth/mfa/passkeys/{id}/disable"),
            json!({}),
        )
        .await,
        StatusCode::CONFLICT,
        "last_passkey_required",
    )
    .await;
}

#[tokio::test]
async fn recovery_is_once_only_across_two_login_grants_and_never_authorizes_factor_management() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let codes = ok(fixture_json_post(
        &app,
        Some(&token),
        "/api/v2/auth/mfa/recovery-codes",
        json!({"current_password":"ChangeMe123!"}),
    )
    .await)
    .await;
    let code = codes["codes"][0].as_str().unwrap();
    let a = grant(&app).await;
    let b = grant(&app).await;
    let (left, right) = tokio::join!(
        fixture_json_post(
            &app,
            None,
            "/api/v2/auth/login/recovery",
            json!({"login_grant":a,"code":code})
        ),
        fixture_json_post(
            &app,
            None,
            "/api/v2/auth/login/recovery",
            json!({"login_grant":b,"code":code})
        )
    );
    let winner = if left.status() == StatusCode::OK {
        denied(right, StatusCode::BAD_REQUEST, "factor_verification_failed").await;
        left
    } else {
        denied(left, StatusCode::BAD_REQUEST, "factor_verification_failed").await;
        right
    };
    let (cookie, csrf) = auth_cookies(winner.headers());
    let body = ok(winner).await;
    let recovered = body["access_token"].as_str().unwrap();
    assert_eq!(
        body["user"]["auth_security"]["session_assurance"]["method"],
        "recovery"
    );
    denied(
        fixture_json_post(
            &app,
            Some(recovered),
            "/api/v2/auth/mfa/webauthn/register/options",
            json!({}),
        )
        .await,
        StatusCode::FORBIDDEN,
        "passkey_verification_required",
    )
    .await;
    denied(
        fixture_json_post(
            &app,
            Some(recovered),
            "/api/v2/auth/mfa/recovery-codes",
            json!({"current_password":"ChangeMe123!"}),
        )
        .await,
        StatusCode::FORBIDDEN,
        "passkey_verification_required",
    )
    .await;
    let refreshed = ok(refresh(&app, &cookie, &csrf).await).await;
    assert_eq!(
        refreshed["user"]["auth_security"]["session_assurance"]["method"],
        "recovery"
    );
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM auth_recovery_codes WHERE used_at IS NOT NULL),(SELECT count(*) FROM audit_events WHERE event_type='auth.factor.recovery.verified')").fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 1));
}

#[tokio::test]
async fn management_stale_password_is_repairable_and_pending_challenges_are_bounded() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    denied(
        fixture_json_post(
            &app,
            Some(&token),
            "/api/v2/auth/mfa/recovery-codes",
            json!({"current_password":"ChangeMe123!"}),
        )
        .await,
        StatusCode::FORBIDDEN,
        "password_confirmation_required",
    )
    .await;
    let options = fresh_options(&app, &token, Some("ChangeMe123!")).await;
    let body = ok(fixture_json_post(
        &app,
        Some(&token),
        VERIFY,
        signed(&app, claims.sub, &options),
    )
    .await)
    .await;
    let next = body["access_token"].as_str().unwrap();
    // Retained expired history must not deny a new challenge or turn the live
    // pending cap into a scan of the account's whole ceremony history.
    sqlx::query("INSERT INTO auth_factor_challenges(id,facility_id,user_id,purpose,session_id,session_version,permission_version,factor_version,active_profile,state,created_at,expires_at) SELECT gen_random_uuid(),u.facility_id,u.id,'step_up',$1,u.session_version,u.permission_version,u.auth_factor_version,'hospital','{}'::jsonb,clock_timestamp()-interval '3 days',clock_timestamp()-interval '2 days' FROM users u CROSS JOIN generate_series(1,5000) n WHERE u.id=$2")
        .bind(claims.session_id).bind(claims.sub).execute(&pool).await.unwrap();
    sqlx::query("ANALYZE auth_factor_challenges")
        .execute(&pool)
        .await
        .unwrap();
    let mut plan_tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL plan_cache_mode=force_generic_plan")
        .execute(&mut *plan_tx)
        .await
        .unwrap();
    let plan: Value = sqlx::query_scalar("EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM (SELECT 1 FROM auth_factor_challenges WHERE facility_id=$1 AND user_id=$2 AND purpose=$3 AND consumed_at IS NULL AND expires_at>statement_timestamp() LIMIT 3) pending")
        .bind(claims.facility_id).bind(claims.sub).bind("step_up")
        .fetch_one(&mut *plan_tx).await.unwrap();
    let plan_text = plan.to_string();
    assert!(plan_text.contains("auth_factor_challenges_active_idx"));
    assert!(!plan_text.contains("Seq Scan"));
    assert!(plan_text.contains("expires_at > statement_timestamp()"));
    plan_tx.rollback().await.unwrap();
    let mut pending = Vec::new();
    for _ in 0..3 {
        pending.push(fresh_options(&app, next, None).await);
    }
    denied(
        fixture_json_post(&app, Some(next), OPTIONS, json!({})).await,
        StatusCode::TOO_MANY_REQUESTS,
        "factor_attempt_limit",
    )
    .await;
    ok(fixture_json_post(
        &app,
        Some(next),
        VERIFY,
        signed(&app, claims.sub, &pending[0]),
    )
    .await)
    .await;
    fresh_options(&app, next, None).await;
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM auth_factor_challenges WHERE session_id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()").bind(claims.session_id).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 3);
}

#[tokio::test]
async fn own_key_metadata_pages_seek_retired_history_without_exposing_key_material() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    sqlx::query("INSERT INTO auth_webauthn_credentials(id,facility_id,user_id,credential_id,passkey,label,created_at,disabled_at) SELECT gen_random_uuid(),$1,$2,gen_random_uuid()::text,'{\"private-material\":\"not-a-response-field\"}'::jsonb,'Synthetic retired key',clock_timestamp()-n*interval '1 second',clock_timestamp() FROM generate_series(1,5000) n")
        .bind(claims.facility_id).bind(claims.sub).execute(&pool).await.unwrap();
    sqlx::query("ANALYZE auth_webauthn_credentials")
        .execute(&pool)
        .await
        .unwrap();
    let first = read(&app, &token, "/api/v2/auth/mfa/passkeys?limit=2").await;
    assert_eq!(first.status(), StatusCode::OK);
    let first = json_body(first).await;
    assert_eq!(first["data"].as_array().unwrap().len(), 2);
    assert_eq!(first["page"]["has_next"], true);
    let cursor = first["page"]["next_cursor"].as_str().unwrap();
    let second = read(
        &app,
        &token,
        &format!("/api/v2/auth/mfa/passkeys?limit=2&cursor={cursor}"),
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    let second = json_body(second).await;
    assert_eq!(second["data"].as_array().unwrap().len(), 2);
    assert_eq!(second["page"]["has_next"], true);
    for key in second["data"].as_array().unwrap() {
        assert!(key["disabled_at"].is_string());
        assert!(first["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|previous| previous["id"] != key["id"]));
    }
    for page in [&first, &second] {
        for key in page["data"].as_array().unwrap() {
            let keys = key.as_object().unwrap();
            assert!(!keys.contains_key("credential_id") && !keys.contains_key("passkey"));
            assert!(!key.to_string().contains("not-a-response-field"));
        }
    }
    let (at, id): (chrono::DateTime<Utc>, Uuid) = sqlx::query_as("SELECT created_at,id FROM auth_webauthn_credentials WHERE facility_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC OFFSET 2500 LIMIT 1")
        .bind(claims.facility_id).bind(claims.sub).fetch_one(&pool).await.unwrap();
    let mut plan_tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL plan_cache_mode=force_generic_plan")
        .execute(&mut *plan_tx)
        .await
        .unwrap();
    let plan:Value=sqlx::query_scalar("EXPLAIN (ANALYZE, FORMAT JSON) SELECT id,label,created_at,last_used_at,disabled_at FROM auth_webauthn_credentials WHERE facility_id=$1 AND user_id=$2 AND (created_at,id)<($3,$4) ORDER BY created_at DESC,id DESC LIMIT $5")
        .bind(claims.facility_id).bind(claims.sub).bind(at).bind(id).bind(3_i64)
        .fetch_one(&mut *plan_tx).await.unwrap();
    let plan_text = plan.to_string();
    assert!(plan_text.contains("auth_webauthn_credentials_history_idx"));
    assert!(!plan_text.contains("Seq Scan") && !plan_text.contains("Sort"));
    plan_tx.rollback().await.unwrap();
}

#[tokio::test]
async fn ten_real_keys_reach_registration_cap_and_overcap_import_requires_operator_review() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    // Populate real legacy credentials through the production pure verifier;
    // no fake JSON, omitted keys, or fabricated successful assertions.
    for _ in 0..9 {
        let signer = SoftwareAuthenticator::new();
        let config = hms_auth::WebAuthnConfig::localhost_for_tests();
        let start = hms_auth::start_passkey_registration(
            &config,
            claims.sub,
            "owner@hms.local",
            "Synthetic Owner",
            &[],
        )
        .unwrap();
        let credential = signer.registration(&Ceremony::from_options(&start.public_key, ORIGIN, 0));
        let verified =
            hms_auth::finish_passkey_registration(&config, credential, start.state).unwrap();
        hms_db::auth::insert_webauthn_credential(
            &pool,
            &hms_db::auth::NewWebAuthnCredential {
                id: Uuid::new_v4(),
                user_id: claims.sub,
                facility_id: claims.facility_id,
                credential_id: verified.credential_id,
                passkey: verified.passkey,
                label: None,
            },
        )
        .await
        .unwrap();
    }
    step_up_test_session(&app, &token, None).await;
    denied(
        fixture_json_post(
            &app,
            Some(&token),
            "/api/v2/auth/mfa/webauthn/register/options",
            json!({}),
        )
        .await,
        StatusCode::CONFLICT,
        "passkey_limit_reached",
    )
    .await;
    let pending = grant(&app).await;
    let options = ok(fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/passkey/options",
        json!({"login_grant":pending}),
    )
    .await)
    .await;
    assert_eq!(
        options["allowCredentials"].as_array().unwrap().len(),
        10,
        "every allowed key remains selectable at the cap"
    );
    sqlx::query("INSERT INTO auth_webauthn_credentials(id,facility_id,user_id,credential_id,passkey) VALUES(gen_random_uuid(),$1,$2,'eleventh-imported-key','{}'::jsonb)").bind(claims.facility_id).bind(claims.sub).execute(&pool).await.unwrap();
    denied(
        raw_password_login(&app, "owner@hms.local", "ChangeMe123!", None).await,
        StatusCode::CONFLICT,
        "factor_management_required",
    )
    .await;
    let counts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM auth_webauthn_credentials WHERE user_id=$1 AND disabled_at IS NULL",
    )
    .bind(claims.sub)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        counts, 11,
        "malformed or over-cap imports are retained for deliberate operator review"
    );
}

#[tokio::test]
async fn assertion_issuance_budget_is_shared_across_completed_challenges() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    for _ in 0..10 {
        let options = fresh_options(&app, &token, None).await;
        ok(fixture_json_post(
            &app,
            Some(&token),
            VERIFY,
            signed(&app, claims.sub, &options),
        )
        .await)
        .await;
    }
    denied(
        fixture_json_post(&app, Some(&token), OPTIONS, json!({})).await,
        StatusCode::TOO_MANY_REQUESTS,
        "factor_attempt_limit",
    )
    .await;
    let count: i64 = sqlx::query_scalar(
        "SELECT issued FROM auth_factor_issue_budgets WHERE user_id=$1 AND purpose='step_up'",
    )
    .bind(claims.sub)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 10);
}
