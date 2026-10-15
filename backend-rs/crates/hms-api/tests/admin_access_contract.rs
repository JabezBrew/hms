mod support;
use hms_db::admin::{create_permission_assignment, NewPermissionAssignment};
use support::*;

async fn get(app: &TestApp, token: &str, path: &str) -> axum::response::Response {
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
async fn post(app: &TestApp, token: &str, path: &str, payload: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn pair() -> (TestApp, TestApp) {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    let first =
        app_with_config_and_request_context_probe(config.clone(), Arc::clone(&database)).await;
    let second = app_with_config_and_request_context_probe(config, database).await;
    (first, second)
}
async fn grant(app: &TestApp, code: PermissionCode, end: Option<chrono::DateTime<Utc>>) -> Uuid {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let user: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO user_features(user_id,feature_key) VALUES($1,'admin') ON CONFLICT DO NOTHING",
    )
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();
    create_permission_assignment(
        &pool,
        NewPermissionAssignment {
            facility_id: facility,
            grantee_user_id: user,
            permission_code: code,
            scope_type: "facility".into(),
            scope_id: None,
            granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
            starts_at: Utc::now() - Duration::minutes(1),
            ends_at: end,
            reason_code: "temporary_cover".into(),
        },
        None,
    )
    .await
    .unwrap()
    .id
}

#[tokio::test]
async fn managed_revocation_denies_warm_sessions_across_independent_api_instances() {
    let (a, b) = pair().await;
    enroll_owner_test_passkey(&a).await;
    let id = grant(&a, PermissionCode::AdminAuthorityManage, None).await;
    let (limited, _, _) = login(a.clone(), "limited@hms.local").await;
    assert_eq!(
        get(&a, &limited, "/api/v2/admin/access-grants?limit=1")
            .await
            .status(),
        StatusCode::OK
    );
    let page = get(&b, &limited, "/api/v2/admin/access-grants?limit=1").await;
    assert_eq!(page.status(), StatusCode::OK);
    let body = json_body(page).await;
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert!(body["page"]["has_next"].is_boolean());
    let (owner, _, _) = login(a.clone(), "owner@hms.local").await;
    let path = format!("/api/v2/admin/access-grants/permission_assignment/{id}/revoke");
    let stale = token_with_stale_reauth(&owner);
    let denied = post(&a, &stale, &path, json!({})).await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(json_body(denied).await["error"]["code"], "reauth_required");
    let response = post(&a, &owner, &path, json!({})).await;
    assert_eq!(response.status(), StatusCode::OK);
    let saved = json_body(response).await;
    assert_eq!(saved["data"]["status"], "revoked");
    assert_eq!(saved["data"]["effective_permission_remaining"], false);
    assert_eq!(
        get(&b, &limited, "/api/v2/admin/access-grants")
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&b, &limited, "/api/v2/auth/me").await.status(),
        StatusCode::UNAUTHORIZED
    );
    let (fresh, _, _) = login(b.clone(), "limited@hms.local").await;
    assert_eq!(
        get(&b, &fresh, "/api/v2/admin/access-grants")
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let repeated = post(&a, &owner, &path, json!({})).await;
    assert_eq!(repeated.status(), StatusCode::OK);
    assert_eq!(
        json_body(repeated).await["data"]["revoked_at"],
        saved["data"]["revoked_at"]
    );
    let denied = post(&b, &fresh, &path, json!({})).await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let absent = post(
        &a,
        &owner,
        &format!(
            "/api/v2/admin/access-grants/delegation/{}/revoke",
            Uuid::new_v4()
        ),
        json!({}),
    )
    .await;
    assert_eq!(absent.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        post(&a, &owner, &path, json!({"force":true}))
            .await
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn cached_current_permissions_expire_at_authority_deadline_without_session_reissue() {
    let (a, b) = pair().await;
    grant(
        &a,
        PermissionCode::AdminAuthorityManage,
        Some(Utc::now() + Duration::seconds(3)),
    )
    .await;
    let (token, _, _) = login(a.clone(), "limited@hms.local").await;
    for app in [&a, &b] {
        assert_eq!(
            get(app, &token, "/api/v2/admin/access-grants")
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            get(app, &token, "/api/v2/auth/me").await.status(),
            StatusCode::OK
        );
    }
    tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
    for app in [&a, &b] {
        assert_eq!(
            get(app, &token, "/api/v2/admin/access-grants")
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        let me = get(app, &token, "/api/v2/auth/me").await;
        assert_eq!(me.status(), StatusCode::OK);
        let body = json_body(me).await;
        assert!(!body["data"]["permissions"]
            .as_array()
            .unwrap()
            .contains(&json!("admin.authority.manage")));
    }
}

#[tokio::test]
async fn historical_permission_reconciliation_is_explicit_and_authorization_read_cost_is_bounded() {
    let app = app_with_request_context_probe().await;
    enroll_owner_test_passkey(&app).await;
    let id = grant(&app, PermissionCode::AdminAuthorityManage, None).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let user: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code,origin) VALUES($1,'admin.authority.manage','legacy_unresolved')").bind(user).execute(&pool).await.unwrap();
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let path = format!("/api/v2/admin/access-grants/permission_assignment/{id}/revoke");
    let denied = post(&app, &owner, &path, json!({})).await;
    assert_eq!(denied.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "access_grant_reconciliation_required"
    );
    let saved = post(
        &app,
        &owner,
        &path,
        json!({"reconciliation":"retain_independent"}),
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
    assert_eq!(
        json_body(saved).await["data"]["independent_access_retained"],
        true
    );
    // Exercise the real RequestContext extractor on warm caches with the new
    // per-request cross-instance version check. Print aggregate timings only.
    let mut elapsed = Vec::with_capacity(50);
    for _ in 0..50 {
        let started = std::time::Instant::now();
        let response = get(&app, &owner, "/__test/request-context").await;
        assert_eq!(response.status(), StatusCode::OK);
        let _ = json_body(response).await;
        elapsed.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    elapsed.sort_by(f64::total_cmp);
    eprintln!("Warm RequestContext including durable version read: n=50 median_ms={:.3} p95_ms={:.3} max_ms={:.3}",elapsed[25],elapsed[47],elapsed[49]);
}

#[tokio::test]
async fn warm_authorization_caches_refresh_when_a_scheduled_grant_begins() {
    let (a, b) = pair().await;
    let id = grant(&a, PermissionCode::AdminAuthorityManage, None).await;
    let pool = a.db_pool().await;
    sqlx::query(
        "UPDATE permission_assignments SET starts_at=now()+interval '3 seconds' WHERE id=$1",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    let (token, _, _) = login(a.clone(), "limited@hms.local").await;
    for app in [&a, &b] {
        assert_eq!(
            get(app, &token, "/api/v2/admin/access-grants")
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            get(app, &token, "/api/v2/auth/me").await.status(),
            StatusCode::OK
        );
    }
    tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
    for app in [&a, &b] {
        assert_eq!(
            get(app, &token, "/api/v2/admin/access-grants")
                .await
                .status(),
            StatusCode::OK
        );
        let me = get(app, &token, "/api/v2/auth/me").await;
        assert_eq!(me.status(), StatusCode::OK);
        assert!(json_body(me).await["data"]["permissions"]
            .as_array()
            .unwrap()
            .contains(&json!("admin.authority.manage")));
    }
}
