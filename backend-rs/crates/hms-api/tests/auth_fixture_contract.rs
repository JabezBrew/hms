mod support;
use support::*;

#[tokio::test]
async fn raw_forced_password_session_stays_restricted_until_real_password_change() {
    let app = app().await;
    let raw = raw_password_login(&app, "limited@hms.local", "ChangeMe123!", None).await;
    assert_eq!(raw.status(), StatusCode::OK);
    let raw = json_body(raw).await;
    assert_eq!(raw["data"]["user"]["password_change_required"], true);
    let token = raw["data"]["access_token"]
        .as_str()
        .expect("nonprivileged forced-change login has a restricted session");
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v2/patients")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "password_change_required"
    );
    let changed = fixture_json_post(
        &app,
        Some(token),
        "/api/v2/auth/password",
        json!({"current_password":"ChangeMe123!","new_password":"ReviewedFixture2!"}),
    )
    .await;
    assert_eq!(changed.status(), StatusCode::OK);
    assert_eq!(json_body(changed).await["data"]["changed"], true);
    let stale = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::UNAUTHORIZED);
    let (fresh, _, _) =
        login_with_password(app.clone(), "limited@hms.local", "ReviewedFixture2!").await;
    let me = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {fresh}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me.status(), StatusCode::OK);
    assert_eq!(
        json_body(me).await["data"]["password_change_required"],
        false
    );
}

#[tokio::test]
async fn ordinary_fixture_completes_required_change_and_reuses_actual_password_in_memory() {
    let app = app().await;
    let (first, _, _) = login(app.clone(), "limited@hms.local").await;
    let (second, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_ne!(
        access_claims(&first).session_id,
        access_claims(&second).session_id
    );
    let old = raw_password_login(&app, "limited@hms.local", "ChangeMe123!", None).await;
    assert_eq!(
        old.status(),
        StatusCode::UNAUTHORIZED,
        "the original password was changed through the real endpoint"
    );
}

#[tokio::test]
async fn independent_api_states_share_only_the_real_isolated_database_authenticator() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    let first = app_with_config(config.clone(), Arc::clone(&database)).await;
    let second = app_with_config(config, database).await;
    let (a, _, _) = login(first.clone(), "owner@hms.local").await;
    let (b, _, _) = login(second.clone(), "owner@hms.local").await;
    assert_ne!(access_claims(&a).session_id, access_claims(&b).session_id);
    let pool = second.db_pool().await;
    let (keys,proofs):(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM auth_webauthn_credentials WHERE disabled_at IS NULL),(SELECT count(*) FROM auth_session_assurance WHERE method='passkey')").fetch_one(&pool).await.unwrap();
    assert_eq!((keys, proofs), (1, 2));
}
