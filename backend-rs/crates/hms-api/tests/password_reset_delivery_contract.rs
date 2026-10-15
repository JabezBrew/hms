mod support;
use hms_api::config::AccountSetupDeliveryMode;
use support::*;

async fn request_reset(app: &TestApp, email: &str, facility: &str) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/request")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "email": email, "facility_code": facility }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await
}

#[tokio::test]
async fn reset_links_reach_the_trusted_sink_without_token_persistence_and_have_a_separate_budget() {
    let app = app().await;
    let user_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let missing = request_reset(&app, "missing@hms.local", "HMS").await;
    assert_eq!(missing["data"]["accepted"], true);
    assert!(missing["data"]["debug_token"].is_null());
    for _ in 0..10 {
        let response = request_reset(&app, "limited@hms.local", "HMS").await;
        let delivered = app
            .state()
            .latest_test_password_reset_delivery(user_id)
            .unwrap();
        assert_eq!(response["data"]["debug_token"], delivered.token);
        let url = reqwest::Url::parse(&delivered.setup_url).unwrap();
        assert_eq!(url.path(), "/reset-password/confirm");
        assert_eq!(
            url.query_pairs().find(|(key, _)| key == "token").unwrap().1,
            delivered.token
        );
        assert!(delivered.expires_at > Utc::now());
        let pool = app.db_pool().await;
        let persisted: i64 =
            sqlx::query_scalar("SELECT count(*) FROM password_reset_tokens WHERE token_hash = $1")
                .bind(&delivered.token)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(persisted, 0, "only the hash may be persisted");
        let events: i64 = sqlx::query_scalar("SELECT count(*) FROM domain_events WHERE event_type = 'auth.password_reset_requested' AND payload <> '{}'::jsonb")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(events, 0);
    }
    let before = app
        .state()
        .latest_test_password_reset_delivery(user_id)
        .unwrap();
    let limited = request_reset(&app, "limited@hms.local", "HMS").await;
    assert_eq!(limited, missing);
    assert_eq!(
        app.state()
            .latest_test_password_reset_delivery(user_id)
            .unwrap()
            .token,
        before.token
    );
    // A delivery budget never consumes the user's password sign-in budget.
    let _actor = Actor::login(&app, "limited@hms.local").await;
}

#[tokio::test]
async fn reset_webhook_is_off_request_path_does_not_redirect_and_hides_the_token() {
    use axum::{routing::post, Json, Router};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (send_payload, receive_payload) = tokio::sync::oneshot::channel();
    let sender = Arc::new(std::sync::Mutex::new(Some(send_payload)));
    let release = Arc::new(tokio::sync::Notify::new());
    let redirected = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let received_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let server = tokio::spawn({
        let release = release.clone();
        let redirected = redirected.clone();
        let received_count = received_count.clone();
        async move {
            let router = Router::new()
                .route(
                    "/deliver",
                    post(move |Json(payload): Json<Value>| {
                        let sender = sender.clone();
                        let release = release.clone();
                        let received_count = received_count.clone();
                        async move {
                            received_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            if let Some(sender) = sender.lock().unwrap().take() {
                                let _ = sender.send(payload);
                            }
                            release.notified().await;
                            (
                                StatusCode::TEMPORARY_REDIRECT,
                                [("location", "/must-not-receive")],
                            )
                        }
                    }),
                )
                .route(
                    "/must-not-receive",
                    post(move || {
                        let redirected = redirected.clone();
                        async move {
                            redirected.store(true, std::sync::atomic::Ordering::SeqCst);
                            StatusCode::OK
                        }
                    }),
                );
            axum::serve(listener, router).await.unwrap();
        }
    });
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.environment = "staging".to_owned();
    config.account_setup_delivery.mode = AccountSetupDeliveryMode::Webhook;
    config.account_setup_delivery.webhook_url = Some(format!("http://{address}/deliver"));
    config.account_setup_delivery.public_app_url = Some("https://synthetic.hms.invalid".to_owned());
    config.account_setup_delivery.timeout = std::time::Duration::from_secs(2);
    let app = app_with_config(config, database).await;
    // A held webhook response cannot hold the HTTP request open.
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        request_reset(&app, "limited@hms.local", "HMS"),
    )
    .await
    .unwrap();
    assert_eq!(response["data"]["accepted"], true);
    assert!(response["data"]["debug_token"].is_null());
    let payload = tokio::time::timeout(std::time::Duration::from_secs(2), receive_payload)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(payload["purpose"], "password_reset");
    assert!(payload.get("token").is_none());
    let url = reqwest::Url::parse(payload["setup_url"].as_str().unwrap()).unwrap();
    assert_eq!(url.host_str(), Some("synthetic.hms.invalid"));
    let token = url
        .query_pairs()
        .find(|(key, _)| key == "token")
        .unwrap()
        .1
        .into_owned();
    assert!(!token.is_empty());
    // Four held deliveries occupy the dedicated network budget. Saturation
    // accepts generically without issuing another unreachable token or taking
    // a password-hashing permit.
    for _ in 0..3 {
        assert_eq!(
            request_reset(&app, "limited@hms.local", "HMS").await,
            response
        );
    }
    assert_eq!(
        request_reset(&app, "limited@hms.local", "HMS").await,
        response
    );
    let tokens: i64 = sqlx::query_scalar("SELECT count(*) FROM password_reset_tokens")
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap();
    assert_eq!(tokens, 4);
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while received_count.load(std::sync::atomic::Ordering::SeqCst) < 4 {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    release.notify_waiters();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(!redirected.load(std::sync::atomic::Ordering::SeqCst));
    assert!(app
        .state()
        .latest_test_password_reset_delivery(Uuid::from_u128(hms_db::provision::LIMITED_USER_ID))
        .is_none());
    server.abort();
}

#[tokio::test]
async fn disabled_delivery_accepts_without_issuing_unreachable_reset_tokens() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.environment = "staging".to_owned();
    config.account_setup_delivery.mode = AccountSetupDeliveryMode::Disabled;
    let app = app_with_config(config, database).await;
    let response = request_reset(&app, "limited@hms.local", "HMS").await;
    assert_eq!(response["data"]["accepted"], true);
    assert!(response["data"]["debug_token"].is_null());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM password_reset_tokens")
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

async fn finish_reset(app: &TestApp, token: &str, password: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "token": token, "new_password": password }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn completing_one_reset_invalidates_every_previously_delivered_link() {
    let app = app().await;
    let first = request_reset(&app, "limited@hms.local", "HMS").await;
    let second = request_reset(&app, "limited@hms.local", "HMS").await;
    let first = first["data"]["debug_token"].as_str().unwrap();
    let second = second["data"]["debug_token"].as_str().unwrap();
    assert_eq!(
        finish_reset(&app, first, "SyntheticNewPassword123!").await,
        StatusCode::OK
    );
    assert_eq!(
        finish_reset(&app, second, "DifferentSyntheticPassword456!").await,
        StatusCode::BAD_REQUEST
    );
    let remaining: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM password_reset_tokens WHERE used_at IS NULL AND user_id = $1",
    )
    .bind(Uuid::from_u128(hms_db::provision::LIMITED_USER_ID))
    .fetch_one(&app.db_pool().await)
    .await
    .unwrap();
    assert_eq!(remaining, 0);
    let third = request_reset(&app, "limited@hms.local", "HMS").await;
    assert_eq!(
        finish_reset(
            &app,
            third["data"]["debug_token"].as_str().unwrap(),
            "ChangeMe123!"
        )
        .await,
        StatusCode::BAD_REQUEST,
        "reset completion must preserve the prior password in reuse history"
    );
}

#[tokio::test]
async fn distinct_delivered_links_race_as_one_atomic_password_change() {
    let app = app().await;
    let user_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let pool = app.db_pool().await;
    let before: i64 = sqlx::query_scalar("SELECT session_version FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let first = request_reset(&app, "limited@hms.local", "HMS").await;
    let second = request_reset(&app, "limited@hms.local", "HMS").await;
    let first = first["data"]["debug_token"].as_str().unwrap();
    let second = second["data"]["debug_token"].as_str().unwrap();
    let statuses = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        tokio::join!(
            finish_reset(&app, first, "SyntheticConcurrent123!"),
            finish_reset(&app, second, "SyntheticConcurrent456!")
        )
    })
    .await
    .unwrap();
    assert!(matches!(
        statuses,
        (StatusCode::OK, StatusCode::BAD_REQUEST) | (StatusCode::BAD_REQUEST, StatusCode::OK)
    ));
    let after: i64 = sqlx::query_scalar("SELECT session_version FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, before + 1);
    let remaining: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM password_reset_tokens WHERE used_at IS NULL AND user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn signed_in_password_change_revokes_previously_delivered_reset_links() {
    let app = app().await;
    let actor = Actor::login(&app, "limited@hms.local").await;
    let old_link = request_reset(&app, "limited@hms.local", "HMS").await;
    let response = app.clone().oneshot(Request::builder().method(Method::POST)
        .uri("/api/v2/auth/password").header(AUTHORIZATION, actor.bearer())
        .header("content-type", "application/json")
        .body(Body::from(json!({ "current_password": "ChangeMe123!", "new_password": "SyntheticSignedIn123!" }).to_string())).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        finish_reset(
            &app,
            old_link["data"]["debug_token"].as_str().unwrap(),
            "UnwantedReplacement456!"
        )
        .await,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn concurrent_signed_in_changes_cannot_reuse_a_stale_password_verification() {
    let app = app().await;
    let actor = Actor::login(&app, "limited@hms.local").await;
    let pool = app.db_pool().await;
    let user_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(user_id)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let change = |password: &'static str| {
        let app = app.clone();
        let bearer = actor.bearer();
        async move {
            app.oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/auth/password")
                    .header(AUTHORIZATION, bearer)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"current_password":"ChangeMe123!","new_password":password})
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
        }
    };
    let writes = async {
        tokio::join!(
            change("SyntheticFirstChange123!"),
            change("SyntheticSecondChange456!")
        )
    };
    let release = async {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        blocker.commit().await.unwrap();
    };
    let ((first, second), ()) = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        tokio::join!(writes, release)
    })
    .await
    .unwrap();
    assert_eq!(
        [first, second]
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    let version: i64 = sqlx::query_scalar("SELECT session_version FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(version, 2);
}
