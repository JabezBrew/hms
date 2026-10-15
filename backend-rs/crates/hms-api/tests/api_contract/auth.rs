use super::*;

#[tokio::test]
async fn auth_login_refresh_logout_and_me_follow_session_contract() {
    let app = app().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "limited@hms.local").await;

    let me_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("me request succeeds");
    assert_eq!(me_response.status(), StatusCode::OK);
    let me_body = json_body(me_response).await;
    assert_eq!(me_body["data"]["password_change_required"], true);

    let profile_update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "display_name": "Limited Updated"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("profile update request succeeds");
    assert_eq!(profile_update_response.status(), StatusCode::OK);
    let profile_update_body = json_body(profile_update_response).await;
    assert_eq!(
        profile_update_body["data"]["display_name"],
        "Limited Updated"
    );

    let refresh_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie.clone())
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("refresh request succeeds");
    assert_eq!(refresh_response.status(), StatusCode::OK);
    let (rotated_cookie, rotated_csrf_token) = auth_cookies(refresh_response.headers());

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/logout")
                .header(COOKIE, rotated_cookie)
                .header("x-hms-csrf", rotated_csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("logout request succeeds");
    assert_eq!(logout_response.status(), StatusCode::OK);
    assert!(logout_response.headers().contains_key(SET_COOKIE));

    let (_, cookie, _) = login(app.clone(), "limited@hms.local").await;
    let rejected_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("csrf rejection succeeds");
    assert_eq!(rejected_refresh.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn auth_login_writes_admin_visible_audit_event() {
    let app = app().await;
    let failed_login_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/login")
                .header("content-type", "application/json")
                .header("x-request-id", "auth-login-failed-audit-test")
                .body(Body::from(
                    json!({
                        "email": "owner@hms.local",
                        "password": "not-the-password",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("failed login request succeeds");
    assert_eq!(failed_login_response.status(), StatusCode::UNAUTHORIZED);

    for attempt in 2..=5 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/auth/login")
                    .header("content-type", "application/json")
                    .header("x-request-id", "auth-login-burst-audit-test")
                    .body(Body::from(
                        json!({
                            "email": "owner@hms.local",
                            "password": format!("not-the-password-{attempt}"),
                            "facility_code": "HMS"
                        })
                        .to_string(),
                    ))
                    .expect("request builds"),
            )
            .await
            .expect("burst login failure request succeeds");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    for attempt in 1..=5 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/auth/login")
                    .header("content-type", "application/json")
                    .header("x-request-id", "auth-login-unresolved-burst-audit-test")
                    .body(Body::from(
                        json!({
                            "email": format!("unknown-user-{attempt}@hms.local"),
                            "password": "not-the-password",
                            "facility_code": "HMS"
                        })
                        .to_string(),
                    ))
                    .expect("request builds"),
            )
            .await
            .expect("unresolved login failure request succeeds");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    for attempt in 1..=5 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/auth/login")
                    .header("content-type", "application/json")
                    .header(
                        "x-request-id",
                        "auth-login-invalid-facility-burst-audit-test",
                    )
                    .body(Body::from(
                        json!({
                            "email": format!("facility-probe-{attempt}@hms.local"),
                            "password": "not-the-password",
                            "facility_code": "INVALID"
                        })
                        .to_string(),
                    ))
                    .expect("request builds"),
            )
            .await
            .expect("invalid facility login failure request succeeds");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    let login_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/login")
                .header("content-type", "application/json")
                .header("x-request-id", "auth-login-audit-test")
                .body(Body::from(
                    json!({
                        "email": "owner@hms.local",
                        "password": "ChangeMe123!",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("login request succeeds");
    assert_eq!(login_response.status(), StatusCode::OK);
    let login_body = json_body(login_response).await;
    let owner_token = login_body["data"]["access_token"]
        .as_str()
        .expect("access token exists");

    let audit_response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/audit-events?limit=30")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("audit list succeeds");
    assert_eq!(audit_response.status(), StatusCode::OK);
    let audit_body = json_body(audit_response).await;
    let events = audit_body["data"].as_array().expect("events are array");
    let event = events
        .iter()
        .find(|event| {
            event["event_type"] == "auth.login.created"
                && event["request_id"] == "auth-login-audit-test"
        })
        .expect("login audit event is returned");
    assert_eq!(event["request_id"], "auth-login-audit-test");
    assert_eq!(event["resource_type"], "auth_session");
    assert_eq!(
        event["actor_user_id"],
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID).to_string()
    );
    assert!(event["resource_id"].as_str().is_some());

    let failed_event = events
        .iter()
        .find(|event| {
            event["event_type"] == "auth.login.failed"
                && event["request_id"] == "auth-login-failed-audit-test"
        })
        .expect("failed-login audit event is returned");
    assert_eq!(failed_event["request_id"], "auth-login-failed-audit-test");
    assert_eq!(failed_event["resource_type"], "auth_user");
    assert!(failed_event["actor_user_id"].is_null());
    assert_eq!(
        failed_event["resource_id"],
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID).to_string()
    );

    let burst_event = events
        .iter()
        .find(|event| {
            event["event_type"] == "auth.login_failure_burst.detected"
                && event["request_id"] == "auth-login-burst-audit-test"
        })
        .expect("login failure burst audit event is returned");
    assert_eq!(burst_event["request_id"], "auth-login-burst-audit-test");
    assert!(burst_event["actor_user_id"].is_null());
    assert_eq!(burst_event["resource_type"], "auth_user");

    let unresolved_burst_event = events
        .iter()
        .find(|event| {
            event["event_type"] == "auth.login_failure_burst.detected"
                && event["request_id"] == "auth-login-unresolved-burst-audit-test"
        })
        .expect("unresolved login failure burst audit event is returned");
    assert!(unresolved_burst_event["actor_user_id"].is_null());
    assert_eq!(unresolved_burst_event["resource_type"], "auth_login");
    assert!(unresolved_burst_event["resource_id"].is_null());

    let invalid_facility_burst_event = events
        .iter()
        .find(|event| {
            event["event_type"] == "auth.login_failure_burst.detected"
                && event["request_id"] == "auth-login-invalid-facility-burst-audit-test"
        })
        .expect("invalid facility login failure burst audit event is returned");
    assert!(invalid_facility_burst_event["actor_user_id"].is_null());
    assert_eq!(
        invalid_facility_burst_event["resource_type"],
        "auth_facility"
    );
    assert_eq!(
        invalid_facility_burst_event["resource_id"],
        Uuid::from_u128(hms_db::provision::FACILITY_ID).to_string()
    );
}

#[tokio::test]
async fn server_idle_timeout_rejects_refresh_and_cached_access_sessions() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.session_idle_timeout = std::time::Duration::from_secs(1);
    config.session_absolute_timeout = std::time::Duration::from_secs(5);
    let app = app_with_config(config, database).await;

    let (access_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    tokio::time::sleep(std::time::Duration::from_millis(1300)).await;

    let stale_access = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale access request succeeds");
    assert_eq!(stale_access.status(), StatusCode::UNAUTHORIZED);

    let stale_refresh = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale refresh request succeeds");
    assert_eq!(stale_refresh.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn cached_request_context_cannot_extend_access_session_deadline() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.auth_cache_max_entries = 1;
    let app = app_with_config_and_request_context_probe(config, Arc::clone(&database)).await;

    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let owner_claims = access_claims(&owner_token);
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;

    let pool = hms_db::connect(database.database_url())
        .await
        .expect("test database connects");
    let session_deadline = Utc::now() + Duration::seconds(2);
    sqlx::query(
        r#"
        UPDATE refresh_sessions
        SET expires_at = $1,
            idle_expires_at = $1
        WHERE session_id = $2
        "#,
    )
    .bind(session_deadline)
    .bind(owner_claims.session_id)
    .execute(&pool)
    .await
    .expect("session deadline updates");

    let owner_auth = format!("Bearer {owner_token}");
    let limited_auth = format!("Bearer {limited_token}");

    let owner_context = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/__test/request-context")
                .header(AUTHORIZATION, owner_auth.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("owner request-context probe succeeds");
    assert_eq!(owner_context.status(), StatusCode::OK);

    let limited_me = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, limited_auth)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("limited me request succeeds");
    assert_eq!(limited_me.status(), StatusCode::OK);

    let owner_near_deadline = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, owner_auth.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("owner near-deadline me request succeeds");
    assert_eq!(owner_near_deadline.status(), StatusCode::OK);

    tokio::time::sleep(std::time::Duration::from_millis(2300)).await;

    let owner_after_deadline = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, owner_auth)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("owner expired me request succeeds");
    assert_eq!(owner_after_deadline.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn refresh_rotation_preserves_absolute_session_deadline() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.session_idle_timeout = std::time::Duration::from_secs(2);
    config.session_absolute_timeout = std::time::Duration::from_secs(3);
    let app = app_with_config(config, database).await;

    let (_, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    let refresh_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("refresh request succeeds");
    assert_eq!(refresh_response.status(), StatusCode::OK);
    let (rotated_cookie, rotated_csrf) = auth_cookies(refresh_response.headers());

    tokio::time::sleep(std::time::Duration::from_millis(2300)).await;
    let after_absolute_deadline = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, rotated_cookie)
                .header("x-hms-csrf", rotated_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("absolute timeout refresh request succeeds");
    assert_eq!(after_absolute_deadline.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn request_context_extractor_resolves_policy_state_before_handler() {
    let app = app_with_request_context_probe().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let (response, observed_queries) = hms_observability::with_request_query_counter(async {
        app.clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/__test/request-context")
                    .header(AUTHORIZATION, auth_header.clone())
                    .header("x-request-id", "request-context-test")
                    .header("x-hms-offsite", "true")
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
    })
    .await;
    let response = response.expect("request context probe succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    // One indexed durable version read; the policy projection stays warm.
    assert_eq!(observed_queries, 1);
    let body = json_body(response).await;
    assert_eq!(body["request_id"], "request-context-test");
    assert_eq!(body["facility_code"], "HMS");
    assert_eq!(body["active_profile"], "hospital");
    assert_eq!(body["offsite"], "OffsiteReadOnly");
    assert_eq!(body["reauth_fresh"], true);
    assert!(body["session_id"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
    assert!(body["enabled_features"]
        .as_array()
        .expect("features are listed")
        .contains(&json!("patients")));
    assert!(body["permissions"]
        .as_array()
        .expect("permissions are listed")
        .contains(&json!("patient.demographics.view")));
    assert!(body["patient_visibility"]
        .as_array()
        .expect("visibility is listed")
        .contains(&json!("demographics")));
    assert!(body["active_authorities"]
        .as_array()
        .expect("active authorities are listed")
        .iter()
        .any(|authority| authority["source"] == "position_appointment"
            && authority["permission_code"] == "admin.authority.manage"));

    let (cached_response, cached_observed_queries) =
        hms_observability::with_request_query_counter(async {
            app.oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/__test/request-context")
                    .header(AUTHORIZATION, auth_header)
                    .header("x-request-id", "request-context-cache-test")
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
        })
        .await;
    let cached_response = cached_response.expect("cached request context probe succeeds");
    assert_eq!(cached_response.status(), StatusCode::OK);
    // A warm policy cache still requires exactly one durable version read.
    assert_eq!(cached_observed_queries, 1);

    let metrics = hms_observability::prometheus_metrics();
    assert!(metrics.contains("hms_request_context_cache_hits_total"));
    assert!(metrics.contains("hms_request_context_cache_misses_total"));
    assert!(metrics.contains("hms_request_context_hydration_db_seconds"));
    assert!(metrics.contains("route_pattern=\"/__test/request-context\""));
    assert!(metrics.contains("facility_safe=\"HMS\""));
}

#[tokio::test]
async fn refresh_does_not_restore_high_risk_authentication_freshness() {
    let app = app_with_request_context_probe().await;
    enroll_owner_test_passkey(&app).await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&access_token);
    let authenticated_at = Utc::now() - Duration::minutes(16);
    let pool = app.db_pool().await;
    sqlx::query("UPDATE refresh_sessions SET session_started_at = $1 WHERE session_id = $2")
        .bind(authenticated_at)
        .bind(claims.session_id)
        .execute(&pool)
        .await
        .expect("test authentication age updates");

    let refreshed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("refresh succeeds");
    assert_eq!(refreshed.status(), StatusCode::OK);
    let body = json_body(refreshed).await;
    let token = body["data"]["access_token"]
        .as_str()
        .expect("access token exists");
    let refreshed_claims = access_claims(token);
    assert_eq!(
        refreshed_claims.auth_time,
        Some(authenticated_at.timestamp() as usize)
    );
    assert!(
        refreshed_claims.iat
            > refreshed_claims
                .auth_time
                .expect("authentication time exists")
    );

    let probe = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/__test/request-context")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("request context resolves");
    assert_eq!(probe.status(), StatusCode::OK);
    assert_eq!(json_body(probe).await["reauth_fresh"], false);

    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": Uuid::from_u128(hms_db::provision::LIMITED_USER_ID),
                        "permission_code": "patient.create",
                        "scope_type": "facility",
                        "reason_code": "refresh_does_not_reauthenticate"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("high risk request completes");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(json_body(denied).await["error"]["code"], "reauth_required");
}

#[tokio::test]
async fn access_tokens_without_authentication_evidence_do_not_grant_fresh_reauth() {
    let app = app_with_request_context_probe().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let mut claims = access_claims(&token);
    claims.auth_time = None;
    let legacy_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(b"test-only-hms-v2-jwt-secret"),
    )
    .expect("legacy test token encodes");
    let response = app
        .oneshot(
            Request::builder()
                .uri("/__test/request-context")
                .header(AUTHORIZATION, format!("Bearer {legacy_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("legacy access request completes");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["reauth_fresh"], false);
}

#[tokio::test]
async fn recovery_code_generation_requires_password_and_returns_usable_one_time_codes() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    for (password, status) in [
        ("incorrect-password", StatusCode::FORBIDDEN),
        ("ChangeMe123!", StatusCode::OK),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/auth/mfa/recovery-codes")
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"current_password": password}).to_string(),
                    ))
                    .expect("request builds"),
            )
            .await
            .expect("recovery code request completes");
        assert_eq!(response.status(), status);
        if status != StatusCode::OK {
            continue;
        }
        let body = json_body(response).await;
        let codes = body["data"]["codes"].as_array().expect("codes exist");
        assert_eq!(codes.len(), 10);
        let pool = app.db_pool().await;
        let facility_id = access_claims(&token).facility_id;
        let user_id = access_claims(&token).sub;
        assert_eq!(
            hms_db::auth::recovery_codes_remaining(&pool, facility_id, user_id)
                .await
                .expect("remaining count loads"),
            10
        );
        let code = codes[0].as_str().expect("code is a string");
        let hash = hms_auth::hash_recovery_code(code);
        assert!(
            hms_db::auth::consume_recovery_code(&pool, facility_id, user_id, &hash)
                .await
                .expect("code consumes")
        );
        assert!(
            !hms_db::auth::consume_recovery_code(&pool, facility_id, user_id, &hash)
                .await
                .expect("used code rejects")
        );
    }
}

#[tokio::test]
async fn login_failure_throttle_survives_app_restart_and_expires_without_cross_account_lockout() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    let app = app_with_config(config.clone(), Arc::clone(&database)).await;
    for _ in 0..10 {
        let response = app.clone().oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(json!({"email": "owner@hms.local", "password": "incorrect-password", "facility_code": "HMS"}).to_string()))
                .expect("request builds")
        ).await.expect("failed login completes");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    let restarted = app_with_config(config, Arc::clone(&database)).await;
    let blocked = restarted
        .state()
        .login("owner@hms.local", "ChangeMe123!", "HMS", None, None)
        .await
        .expect("throttled login completes");
    assert!(
        blocked.is_none(),
        "a fresh API process must enforce the persisted failure budget"
    );
    let (_, _, _) = login(restarted.clone(), "limited@hms.local").await;

    let pool = restarted.db_pool().await;
    sqlx::query("UPDATE auth_login_attempt_budgets SET window_started_at = now() - interval '16 minutes' WHERE resource_type = 'auth_user'")
        .execute(&pool).await.expect("test failure window ages");
    let (_, _, _) = login(restarted, "owner@hms.local").await;
}

#[tokio::test]
async fn concurrent_login_attempts_share_atomic_admission_across_api_instances() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    assert!(config.password_work_max_concurrency > 1);
    let app = app_with_config(config.clone(), Arc::clone(&database)).await;
    let other = app_with_config(config, database).await;
    // Successful attempts release their reservation instead of consuming the
    // failure budget, even when an independent API instance issues the session.
    let (_, _, _) = login(app.clone(), "owner@hms.local").await;
    let (_, _, _) = login(other.clone(), "owner@hms.local").await;
    for _ in 0..9 {
        assert!(app
            .state()
            .login("owner@hms.local", "incorrect-password", "HMS", None, None)
            .await
            .expect("prior failure completes")
            .is_none());
    }
    let mut requests = tokio::task::JoinSet::new();
    let barrier = Arc::new(tokio::sync::Barrier::new(21));
    for index in 0..20 {
        let app = if index % 2 == 0 {
            app.clone()
        } else {
            other.clone()
        };
        let barrier = Arc::clone(&barrier);
        requests.spawn(async move {
            barrier.wait().await;
            app.oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "email": "owner@hms.local",
                            "password": "incorrect-password",
                            "facility_code": "HMS"
                        })
                        .to_string(),
                    ))
                    .expect("request builds"),
            )
            .await
            .expect("queued login completes")
            .status()
        });
    }
    barrier.wait().await;
    while let Some(response) = requests.join_next().await {
        assert_eq!(
            response.expect("login task completes"),
            StatusCode::UNAUTHORIZED
        );
    }
    let pool = app.db_pool().await;
    let attempts = sqlx::query_scalar::<_, i64>(
        "SELECT failure_count FROM auth_login_failure_counters WHERE resource_type = 'auth_user' AND resource_key = $1"
    ).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID).to_string())
        .fetch_one(&pool).await.expect("failure count loads");
    assert_eq!(
        attempts, 10,
        "exactly one further failure may pass admission across both API instances"
    );
    let budget = sqlx::query_as::<_, (i16, i16)>(
        "SELECT failed_attempts, in_flight_attempts FROM auth_login_attempt_budgets WHERE resource_type = 'auth_user' AND resource_key = $1"
    ).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID).to_string())
        .fetch_one(&pool).await.expect("admission budget loads");
    assert_eq!(budget, (10, 0));
    assert!(other
        .state()
        .login("owner@hms.local", "ChangeMe123!", "HMS", None, None)
        .await
        .expect("post-budget correct attempt completes")
        .is_none());

    for (facility_code, resource_type) in [("HMS", "auth_login"), ("INVALID", "auth_facility")] {
        let mut requests = tokio::task::JoinSet::new();
        for index in 0..20 {
            let state = if index % 2 == 0 {
                app.state()
            } else {
                other.state()
            };
            requests.spawn(async move {
                state
                    .login(
                        "unresolved@hms.local",
                        "incorrect-password",
                        facility_code,
                        None,
                        None,
                    )
                    .await
                    .expect("unresolved login completes")
                    .is_none()
            });
        }
        while let Some(result) = requests.join_next().await {
            assert!(result.expect("unresolved login task completes"));
        }
        let budget = sqlx::query_as::<_, (i16, i16)>(
            "SELECT failed_attempts, in_flight_attempts FROM auth_login_attempt_budgets WHERE resource_type = $1"
        ).bind(resource_type).fetch_one(&pool).await.expect("unresolved budget loads");
        assert_eq!(budget, (10, 0));
        let audited = sqlx::query_scalar::<_, i64>(
            "SELECT failure_count FROM auth_login_failure_counters WHERE resource_type = $1",
        )
        .bind(resource_type)
        .fetch_one(&pool)
        .await
        .expect("unresolved failure count loads");
        assert_eq!(audited, 10);
    }
}

#[tokio::test]
async fn session_issue_warms_request_context_for_parallel_requests() {
    let app = app_with_request_context_probe().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");
    let request_context = || {
        let app = app.clone();
        let auth_header = auth_header.clone();
        async move {
            app.oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/__test/request-context")
                    .header(AUTHORIZATION, auth_header)
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
        }
    };

    let (responses, observed_queries) = hms_observability::with_request_query_counter(async {
        let (a, b, c, d, e, f, g, h) = tokio::join!(
            request_context(),
            request_context(),
            request_context(),
            request_context(),
            request_context(),
            request_context(),
            request_context(),
            request_context()
        );
        [a, b, c, d, e, f, g, h]
    })
    .await;

    for response in responses {
        assert_eq!(
            response.expect("request context probe succeeds").status(),
            StatusCode::OK
        );
    }
    // Eight requests each check durable versions; none rehydrates policy.
    assert_eq!(observed_queries, 8);
}

#[tokio::test]
async fn logout_invalidates_warmed_request_context_cache_for_session() {
    let app = app_with_request_context_probe().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let warmed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/__test/request-context")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("warm request context succeeds");
    assert_eq!(warmed.status(), StatusCode::OK);

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/logout")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("logout request succeeds");
    assert_eq!(logout_response.status(), StatusCode::OK);

    let (rejected, observed_queries) = hms_observability::with_request_query_counter(async {
        app.oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/__test/request-context")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
    })
    .await;
    let rejected = rejected.expect("revoked-session request completes");
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    // One durable version read plus one rejected session hydration.
    assert_eq!(observed_queries, 2);
}

#[tokio::test]
async fn auth_me_user_cache_outlives_request_context_cache_without_db_hydration() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let warmed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("warm auth/me request succeeds");
    assert_eq!(warmed.status(), StatusCode::OK);

    tokio::time::sleep(std::time::Duration::from_secs(6)).await;

    let (cached, observed_queries) = hms_observability::with_request_query_counter(async {
        app.oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
    })
    .await;
    let cached = cached.expect("cached auth/me request succeeds");
    assert_eq!(cached.status(), StatusCode::OK);
    assert_eq!(observed_queries, 0);
}

#[tokio::test]
async fn auth_me_single_flights_cold_session_cache_hydration() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&access_token);
    let state = app.state();
    state.invalidate_auth_cache_for_user(claims.facility_id, claims.sub);
    let auth_user = || {
        let state = state.clone();
        let claims = claims.clone();
        async move {
            state
                .auth_user_for_claims(&claims)
                .await
                .expect("auth user resolves")
        }
    };

    let (users, observed_queries) = hms_observability::with_request_query_counter(async {
        let (a, b, c, d, e, f, g, h) = tokio::join!(
            auth_user(),
            auth_user(),
            auth_user(),
            auth_user(),
            auth_user(),
            auth_user(),
            auth_user(),
            auth_user()
        );
        [a, b, c, d, e, f, g, h]
    })
    .await;

    for user in users {
        assert!(user.is_some());
    }
    // Eight durable version reads plus exactly one single-flight hydration.
    assert_eq!(observed_queries, 9);
}

#[tokio::test]
async fn bounded_auth_cache_eviction_preserves_recent_warm_sessions() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.auth_cache_max_entries = 2;
    let app = app_with_config(config, database).await;

    let (first_owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let limited_auth_header = format!("Bearer {limited_token}");

    let warmed_limited = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, limited_auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("limited cache touch succeeds");
    assert_eq!(warmed_limited.status(), StatusCode::OK);

    let (_second_owner_token, _, _) = login(app.clone(), "owner@hms.local").await;

    let (cached_limited, observed_queries) = hms_observability::with_request_query_counter(async {
        app.clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/v2/auth/me")
                    .header(AUTHORIZATION, limited_auth_header)
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
    })
    .await;
    assert_eq!(
        cached_limited
            .expect("limited auth/me remains cached")
            .status(),
        StatusCode::OK
    );
    assert_eq!(observed_queries, 0);

    let evicted_owner = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {first_owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("evicted owner session still validates through DB");
    assert_eq!(evicted_owner.status(), StatusCode::OK);
}

#[tokio::test]
async fn logout_invalidates_warmed_auth_me_user_cache_for_session() {
    let app = app().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let warmed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("warm auth/me request succeeds");
    assert_eq!(warmed.status(), StatusCode::OK);

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/logout")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("logout request succeeds");
    assert_eq!(logout_response.status(), StatusCode::OK);

    let rejected = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("revoked auth/me request completes");
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn request_context_rejects_stale_permission_versions() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);

    let warmed_limited_user = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("limited cache warm request succeeds");
    assert_eq!(warmed_limited_user.status(), StatusCode::OK);

    let assignment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "dashboard.view",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "request_context_stale_permission_test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("permission assignment request succeeds");
    assert_eq!(assignment.status(), StatusCode::OK);

    let stale_access = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale permission request succeeds");
    assert_eq!(stale_access.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn active_permission_assignments_are_resolved_into_request_context_policy() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/validation-rules")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("initial validation-rules denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let assignment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "patient.create",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "request_context_active_authority_test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("permission assignment request succeeds");
    assert_eq!(assignment.status(), StatusCode::OK);

    let stale_limited_context = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/validation-rules")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale validation-rules request succeeds");
    assert_eq!(stale_limited_context.status(), StatusCode::UNAUTHORIZED);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let allowed = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/validation-rules")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("authority-backed validation-rules request succeeds");
    assert_eq!(allowed.status(), StatusCode::OK);
}

#[tokio::test]
async fn high_risk_admin_actions_reject_stale_reauth_context() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let stale_reauth_token = token_with_stale_reauth(&owner_token);
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {stale_reauth_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "patient.create",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "stale_reauth_rejected"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stale reauth request succeeds");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "reauth_required");
}

#[tokio::test]
async fn privileged_admin_actions_require_passkey_enrollment() {
    let app = app().await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "patient.create",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "passkey_required_contract"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("passkey-required request succeeds");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "passkey_required");
}

#[tokio::test]
async fn auth_sessions_can_be_listed_and_revoked_by_owner() {
    let app = app().await;
    let (current_access_token, current_cookie, current_csrf) = login_with_password_and_device(
        app.clone(),
        "owner@hms.local",
        "ChangeMe123!",
        Some("Safari on macOS"),
    )
    .await;
    let (other_access_token, other_cookie, other_csrf) = login_with_password_and_device(
        app.clone(),
        "owner@hms.local",
        "ChangeMe123!",
        Some("Chrome on Windows"),
    )
    .await;
    let (_, third_cookie, third_csrf) = login_with_password_and_device(
        app.clone(),
        "owner@hms.local",
        "ChangeMe123!",
        Some("Safari on iOS"),
    )
    .await;
    let auth_header = format!("Bearer {current_access_token}");

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/sessions")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("session list request succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    let sessions = list_body["data"]["results"]
        .as_array()
        .expect("sessions are returned");
    assert_eq!(sessions.len(), 3);
    assert_eq!(
        sessions
            .iter()
            .filter(|session| session["is_current"] == true)
            .count(),
        1
    );
    let other_session_id = sessions
        .iter()
        .find(|session| session["device_label"] == "Chrome on Windows")
        .and_then(|session| session["id"].as_str())
        .expect("other session is present")
        .to_owned();

    let revoke_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/auth/sessions/{other_session_id}/revoke"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("session revoke request succeeds");
    assert_eq!(revoke_response.status(), StatusCode::OK);
    let revoke_body = json_body(revoke_response).await;
    assert_eq!(revoke_body["data"]["revoked"], true);

    let rejected_other_access = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {other_access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("revoked access-token request succeeds");
    assert_eq!(rejected_other_access.status(), StatusCode::UNAUTHORIZED);

    let rejected_other_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, other_cookie)
                .header("x-hms-csrf", other_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("revoked refresh request succeeds");
    assert_eq!(rejected_other_refresh.status(), StatusCode::UNAUTHORIZED);

    let revoke_others_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/sessions/revoke-all")
                .header(AUTHORIZATION, auth_header)
                .header("content-type", "application/json")
                .body(Body::from(json!({ "exclude_current": true }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("session revoke-all request succeeds");
    assert_eq!(revoke_others_response.status(), StatusCode::OK);
    let revoke_others_body = json_body(revoke_others_response).await;
    assert_eq!(revoke_others_body["data"]["revoked_count"], 1);

    let rejected_third_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, third_cookie)
                .header("x-hms-csrf", third_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("revoked refresh request succeeds");
    assert_eq!(rejected_third_refresh.status(), StatusCode::UNAUTHORIZED);

    let current_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, current_cookie)
                .header("x-hms-csrf", current_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("current refresh request succeeds");
    assert_eq!(current_refresh.status(), StatusCode::OK);
}

#[tokio::test]
async fn signed_in_password_change_rotates_sessions_and_enforces_policy() {
    let app = app().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let weak_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "current_password": "ChangeMe123!",
                        "new_password": "short"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("weak password request succeeds");
    assert_eq!(weak_password.status(), StatusCode::BAD_REQUEST);

    let wrong_current_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "current_password": "WrongPassword123!",
                        "new_password": "Replacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("wrong password request succeeds");
    assert_eq!(wrong_current_password.status(), StatusCode::BAD_REQUEST);

    let changed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "current_password": "ChangeMe123!",
                        "new_password": "Replacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password change request succeeds");
    assert_eq!(changed.status(), StatusCode::OK);
    let changed_body = json_body(changed).await;
    assert_eq!(changed_body["data"]["changed"], true);

    let stale_access = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale access request succeeds");
    assert_eq!(stale_access.status(), StatusCode::UNAUTHORIZED);

    let stale_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale refresh request succeeds");
    assert_eq!(stale_refresh.status(), StatusCode::UNAUTHORIZED);

    let old_password_login = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "owner@hms.local",
                        "password": "ChangeMe123!",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("old password login request succeeds");
    assert_eq!(old_password_login.status(), StatusCode::UNAUTHORIZED);

    let (new_access_token, _, _) =
        login_with_password(app.clone(), "owner@hms.local", "Replacement123!").await;
    assert!(!new_access_token.is_empty());
}

#[tokio::test]
async fn refresh_token_reuse_revokes_the_rotated_session_family() {
    let app = app().await;
    let (_, original_cookie, original_csrf) = login(app.clone(), "owner@hms.local").await;

    let refresh_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, original_cookie.clone())
                .header("x-hms-csrf", original_csrf.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("refresh request succeeds");
    assert_eq!(refresh_response.status(), StatusCode::OK);
    let (rotated_cookie, rotated_csrf) = auth_cookies(refresh_response.headers());

    let reused_old_token = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, original_cookie.clone())
                .header("x-hms-csrf", original_csrf.clone())
                .header("x-request-id", "refresh-token-reuse-audit-test")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("reuse request succeeds");
    assert_eq!(reused_old_token.status(), StatusCode::UNAUTHORIZED);

    let repeated_reuse = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, original_cookie)
                .header("x-hms-csrf", original_csrf)
                .header("x-request-id", "refresh-token-reuse-repeat-audit-test")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("repeated reuse request succeeds");
    assert_eq!(repeated_reuse.status(), StatusCode::UNAUTHORIZED);

    let family_revoked = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, rotated_cookie)
                .header("x-hms-csrf", rotated_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("family revoked request succeeds");
    assert_eq!(family_revoked.status(), StatusCode::UNAUTHORIZED);

    let (audit_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let audit_response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/audit-events?limit=10")
                .header(AUTHORIZATION, format!("Bearer {audit_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("audit list succeeds");
    assert_eq!(audit_response.status(), StatusCode::OK);
    let audit_body = json_body(audit_response).await;
    let events = audit_body["data"].as_array().expect("events are array");
    let event = events
        .iter()
        .find(|event| {
            event["event_type"] == "auth.refresh_token_reuse.detected"
                && event["request_id"] == "refresh-token-reuse-audit-test"
        })
        .expect("refresh-token reuse audit event is returned");
    assert_eq!(event["request_id"], "refresh-token-reuse-audit-test");
    assert_eq!(event["resource_type"], "auth_session_family");
    assert!(event["actor_user_id"].is_null());
    assert!(event["resource_id"].as_str().is_some());
    let repeated_event = events
        .iter()
        .find(|event| {
            event["event_type"] == "auth.refresh_token_reuse.detected"
                && event["request_id"] == "refresh-token-reuse-repeat-audit-test"
        })
        .expect("repeated refresh-token reuse audit event is returned");
    assert!(repeated_event["actor_user_id"].is_null());
    assert_eq!(repeated_event["resource_type"], "auth_session_family");
}

#[tokio::test]
async fn password_reset_is_single_use_and_revokes_existing_sessions() {
    let app = app().await;
    let (old_access_token, old_cookie, old_csrf) = login(app.clone(), "limited@hms.local").await;

    let request_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/request")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "limited@hms.local",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset request succeeds");
    assert_eq!(request_response.status(), StatusCode::OK);
    let request_body = json_body(request_response).await;
    let reset_token = request_body["data"]["debug_token"]
        .as_str()
        .expect("debug token is returned in tests")
        .to_owned();

    let weak_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "short"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("weak password request succeeds");
    assert_eq!(weak_password.status(), StatusCode::BAD_REQUEST);

    let request_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/request")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "limited@hms.local",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset request succeeds");
    let request_body = json_body(request_response).await;
    let reset_token = request_body["data"]["debug_token"]
        .as_str()
        .expect("debug token is returned in tests")
        .to_owned();

    let complete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "Replacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset complete succeeds");
    assert_eq!(complete_response.status(), StatusCode::OK);

    let stale_access = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {old_access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale access request succeeds");
    assert_eq!(stale_access.status(), StatusCode::UNAUTHORIZED);

    let stale_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, old_cookie)
                .header("x-hms-csrf", old_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale refresh request succeeds");
    assert_eq!(stale_refresh.status(), StatusCode::UNAUTHORIZED);

    let reused_token = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "AnotherReplacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("token reuse request succeeds");
    assert_eq!(reused_token.status(), StatusCode::BAD_REQUEST);
}
