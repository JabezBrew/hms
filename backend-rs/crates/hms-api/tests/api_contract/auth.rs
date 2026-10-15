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
    assert_eq!(observed_queries, 0);
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
    assert_eq!(cached_observed_queries, 0);

    let metrics = hms_observability::prometheus_metrics();
    assert!(metrics.contains("hms_request_context_cache_hits_total"));
    assert!(metrics.contains("hms_request_context_cache_misses_total"));
    assert!(metrics.contains("hms_request_context_hydration_db_seconds"));
    assert!(metrics.contains("route_pattern=\"/__test/request-context\""));
    assert!(metrics.contains("facility_safe=\"HMS\""));
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
    assert_eq!(observed_queries, 0);
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
    assert_eq!(observed_queries, 1);
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
    assert_eq!(observed_queries, 1);
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
async fn refresh_rotation_does_not_renew_high_risk_reauthentication() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (owner_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&owner_token);
    let pool = app.db_pool().await;
    sqlx::query("UPDATE refresh_sessions SET session_started_at = $1 WHERE session_id = $2")
        .bind(Utc::now() - Duration::minutes(16))
        .bind(claims.session_id)
        .execute(&pool)
        .await
        .expect("synthetic authentication time ages");

    let refresh = app
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
    assert_eq!(refresh.status(), StatusCode::OK);
    let refreshed = json_body(refresh).await;
    let token = refreshed["data"]["access_token"]
        .as_str()
        .expect("fresh access token returns");

    let denied = app
        .clone()
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
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "refresh_must_not_reauthenticate"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("high-risk request returns");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(json_body(denied).await["error"]["code"], "reauth_required");

    // Ordinary session access remains usable after the credential-check window.
    let me = app
        .oneshot(
            Request::builder()
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ordinary session request returns");
    assert_eq!(me.status(), StatusCode::OK);
}

#[tokio::test]
async fn recovery_codes_require_credentials_and_regenerate_single_use_hashes() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let request = |password: &str| {
        Request::builder()
            .method(Method::POST)
            .uri("/api/v2/auth/mfa/recovery-codes")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(
                json!({"current_password": password}).to_string(),
            ))
            .expect("request builds")
    };
    let denied = app
        .clone()
        .oneshot(request("wrong-password"))
        .await
        .expect("wrong password request returns");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        hms_db::auth::recovery_codes_remaining(&pool, claims.facility_id, claims.sub)
            .await
            .expect("remaining count returns"),
        0
    );

    let generated = app
        .clone()
        .oneshot(request("ChangeMe123!"))
        .await
        .expect("generation returns");
    assert_eq!(generated.status(), StatusCode::OK);
    let generated = json_body(generated).await;
    let codes = generated["data"]["codes"].as_array().expect("codes return");
    assert_eq!(codes.len(), 10);
    let code = codes[0].as_str().expect("code is text");
    assert_eq!(code.len(), 17);
    let original_hash = hms_auth::hash_recovery_code(code);
    let consumed =
        hms_db::auth::consume_recovery_code(&pool, claims.facility_id, claims.sub, &original_hash)
            .await
            .expect("code consumes");
    assert!(consumed);
    assert!(!hms_db::auth::consume_recovery_code(
        &pool,
        claims.facility_id,
        claims.sub,
        &original_hash,
    )
    .await
    .expect("reuse is rejected"));

    let unused_hash = hms_auth::hash_recovery_code(codes[1].as_str().expect("code is text"));
    let regenerated = app
        .clone()
        .oneshot(request("ChangeMe123!"))
        .await
        .expect("regeneration returns");
    assert_eq!(regenerated.status(), StatusCode::OK);
    assert!(!hms_db::auth::consume_recovery_code(
        &pool,
        claims.facility_id,
        claims.sub,
        &unused_hash,
    )
    .await
    .expect("superseded code is rejected"));
    assert_eq!(
        hms_db::auth::recovery_codes_remaining(&pool, claims.facility_id, claims.sub)
            .await
            .expect("remaining count returns"),
        10
    );
}

#[tokio::test]
async fn login_attempts_are_bounded_without_disclosing_account_existence() {
    let app = app().await;
    for _ in 0..10 {
        let denied = app.clone().oneshot(Request::builder().method(Method::POST)
            .uri("/api/v2/auth/login").header("content-type", "application/json")
            .body(Body::from(json!({"email": "owner@hms.local", "password": "wrong-password", "facility_code": "HMS"}).to_string()))
            .expect("request builds")).await.expect("failed login returns");
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            json_body(denied).await["error"]["code"],
            "authentication_required"
        );
    }
    // Case/spacing do not reset the exhausted identity budget, even if the next
    // request guesses the correct password.
    let throttled = app.clone().oneshot(Request::builder().method(Method::POST)
        .uri("/api/v2/auth/login").header("content-type", "application/json")
        .body(Body::from(json!({"email": " OWNER@HMS.LOCAL ", "password": "ChangeMe123!", "facility_code": " hms "}).to_string()))
        .expect("request builds")).await.expect("throttled login returns");
    assert_eq!(throttled.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_body(throttled).await["error"]["code"],
        "authentication_required"
    );
    let unknown = app.clone().oneshot(Request::builder().method(Method::POST)
        .uri("/api/v2/auth/login").header("content-type", "application/json")
        .body(Body::from(json!({"email": "unknown@synthetic.invalid", "password": "wrong-password", "facility_code": "HMS"}).to_string()))
        .expect("request builds")).await.expect("unknown login returns");
    assert_eq!(unknown.status(), StatusCode::UNAUTHORIZED);
    let unknown = json_body(unknown).await;
    assert_eq!(unknown["error"]["code"], "authentication_required");
    assert!(!unknown.to_string().contains("unknown@synthetic.invalid"));
    let (_, _, _) = login(app, "limited@hms.local").await;
}

#[tokio::test]
async fn self_service_reset_delivers_out_of_band_and_throttles_generically() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    // Exercise the public response while keeping delivery in the synthetic sink.
    config.environment = "development".to_owned();
    let app = app_with_config(config, database).await;
    let reset_request = |email: &str| {
        Request::builder()
            .method(Method::POST)
            .uri("/api/v2/auth/password-reset/request")
            .header("content-type", "application/json")
            .body(Body::from(
                json!({"email": email, "facility_code": "HMS"}).to_string(),
            ))
            .expect("request builds")
    };
    // More unknown requests than the overall delivery cap cannot exhaust
    // recovery for a genuine account. Both still get the generic response.
    for (email, attempts) in [("unknown@synthetic.invalid", 65), ("owner@hms.local", 4)] {
        for _ in 0..attempts {
            let accepted = app
                .clone()
                .oneshot(reset_request(email))
                .await
                .expect("request returns");
            assert_eq!(accepted.status(), StatusCode::OK);
            assert_eq!(
                json_body(accepted).await["data"],
                json!({"accepted": true, "debug_token": null})
            );
        }
    }
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let delivery = app
        .state()
        .latest_test_account_setup_delivery(owner_id, AccountSetupDeliveryPurpose::PasswordReset)
        .expect("trusted reset sink receives token");
    assert!(delivery.staff_id.is_none());
    assert!(delivery
        .setup_url
        .contains("/reset-password/confirm?token="));
    let pool = app.db_pool().await;
    let token_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM password_reset_tokens WHERE user_id = $1",
    )
    .bind(owner_id)
    .fetch_one(&pool)
    .await
    .expect("token count returns");
    assert_eq!(token_count, 3);
    let event_payloads = sqlx::query_scalar::<_, Value>(
        "SELECT payload FROM domain_events WHERE event_type = 'auth.password_reset_requested'",
    )
    .fetch_all(&pool)
    .await
    .expect("safe event payloads return");
    assert_eq!(event_payloads.len(), 3);
    for payload in event_payloads {
        assert!(!payload.to_string().contains(&delivery.token));
    }
    let completed = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"token": delivery.token, "new_password": "Replacement123!"}).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("delivered reset link completes");
    assert_eq!(completed.status(), StatusCode::OK);
}

#[tokio::test]
async fn disabled_reset_delivery_acknowledges_without_minting_unusable_tokens() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.account_setup_delivery.mode = hms_api::config::AccountSetupDeliveryMode::Disabled;
    let app = app_with_config(config, database).await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/request")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email": "owner@hms.local", "facility_code": "HMS"}).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("request returns");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["data"],
        json!({"accepted": true, "debug_token": null})
    );
    let pool = app.db_pool().await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM password_reset_tokens")
            .fetch_one(&pool)
            .await
            .expect("token count returns"),
        0
    );
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
