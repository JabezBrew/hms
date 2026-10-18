use super::*;

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
pub(super) async fn confirmation_state(app: &TestApp, token: &str) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array(password_verified_at,assurance_version,(SELECT count(*) FROM audit_events WHERE event_type='auth.credential.reconfirmed' AND resource_id=$1),(SELECT count(*) FROM auth_session_assurance WHERE session_id=$1)) FROM refresh_sessions WHERE session_id=$1").bind(access_claims(token).session_id).fetch_one(&app.db_pool().await).await.unwrap()
}

#[tokio::test]
async fn strict_credentials_reject_unknown_identity_fields_without_echo_or_effects() {
    let (app, token, _, _) = ordinary().await;
    let before = confirmation_state(&app, &token).await;
    for body in [
        json!({}),
        json!({"current_password":null}),
        json!({"current_password":42}),
        json!({"current_password":PASSWORD,"user_id":"SYNTHETIC-PRIVATE-CREDENTIAL-MARKER"}),
        json!({"current_password":PASSWORD,"verified_at":"SYNTHETIC-PRIVATE-CREDENTIAL-MARKER"}),
    ] {
        let r = fixture_json_post(&app, Some(&token), CONFIRM, body).await;
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        assert!(!r.headers().contains_key(SET_COOKIE));
        let bytes = to_bytes(r.into_body(), usize::MAX).await.unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("SYNTHETIC-PRIVATE-CREDENTIAL-MARKER"));
        let value: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["error"]["code"], "invalid_factor_request");
    }
    let r = fixture_json_post(&app, None, CONFIRM, json!({"current_password":PASSWORD})).await;
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(confirmation_state(&app, &token).await, before);
}

#[tokio::test]
async fn password_login_and_confirmation_share_the_same_durable_failure_budget() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    let app = app_with_config_and_request_context_probe(config.clone(), database.clone()).await;
    let second = app_with_config_and_request_context_probe(config, database).await;
    let (app, token, _, _) = ordinary_in(app).await;
    let before = confirmation_state(&app, &token).await;
    for index in 0..10 {
        let instance = if index % 3 == 0 { &second } else { &app };
        if index % 2 == 0 {
            let r = fixture_json_post(
                instance,
                Some(&token),
                CONFIRM,
                json!({"current_password":"Synthetic22!WrongCredential"}),
            )
            .await;
            assert_eq!(r.status(), StatusCode::FORBIDDEN);
        } else {
            assert_eq!(
                raw_password_login(
                    instance,
                    "limited@hms.local",
                    "Synthetic22!WrongCredential",
                    None
                )
                .await
                .status(),
                StatusCode::UNAUTHORIZED
            );
        }
    }
    let r = fixture_json_post(
        &app,
        Some(&token),
        CONFIRM,
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        raw_password_login(&app, "limited@hms.local", PASSWORD, None)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let budget:(i16,i16)=sqlx::query_as("SELECT failed_attempts,in_flight_attempts FROM auth_login_attempt_budgets WHERE resource_type='auth_user' AND resource_key=$1").bind(access_claims(&token).sub.to_string()).fetch_one(&app.db_pool().await).await.unwrap();
    assert_eq!(budget, (10, 0));
    assert_eq!(confirmation_state(&app, &token).await, before);
}

#[tokio::test]
async fn existing_enrollment_and_privileged_policy_never_use_password_only_confirmation() {
    let (app, token, _, _) = ordinary().await;
    let user = access_claims(&token).sub;
    enroll_test_passkey(&app, user).await;
    let (enrolled, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    let before = confirmation_state(&app, &enrolled).await;
    let r = fixture_json_post(
        &app,
        Some(&enrolled),
        CONFIRM,
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(r).await["error"]["code"],
        "passkey_verification_required"
    );
    assert_eq!(confirmation_state(&app, &enrolled).await, before);
    // Privileged account performs an actual separate passkey sign-in. Its
    // existing factor evidence cannot be renewed through this ordinary route.
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let before = confirmation_state(&app, &owner).await;
    let r = fixture_json_post(
        &app,
        Some(&owner),
        CONFIRM,
        json!({"current_password":"ChangeMe123!"}),
    )
    .await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    assert_eq!(confirmation_state(&app, &owner).await, before);
}

#[tokio::test]
async fn proof_revision_invalidates_the_other_instance_cache_but_old_jwt_stays_stale_and_refresh_preserves_time(
) {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    let first = app_with_config_and_request_context_probe(config.clone(), database.clone()).await;
    let second = app_with_config_and_request_context_probe(config, database).await;
    let (first, token, cookie, csrf) = ordinary_in(first).await;
    let pool = first.db_pool().await;
    let session = access_claims(&token).session_id;
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1").bind(session).execute(&pool).await.unwrap();
    let old = token_with_stale_reauth(&token);
    for app in [&first, &second] {
        assert_eq!(
            json_body(read(app, &old, "/__test/request-context").await).await["reauth_fresh"],
            false
        );
    }
    let response = fixture_json_post(
        &first,
        Some(&old),
        CONFIRM,
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let fresh = body["data"]["access_token"].as_str().unwrap();
    assert_eq!(
        json_body(read(&second, fresh, "/__test/request-context").await).await["reauth_fresh"],
        true
    );
    assert_eq!(
        json_body(read(&second, &old, "/__test/request-context").await).await["reauth_fresh"],
        false
    );
    let password: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT password_verified_at FROM refresh_sessions WHERE session_id=$1")
            .bind(session)
            .fetch_one(&pool)
            .await
            .unwrap();
    let response = second
        .clone()
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
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let rotated = json_body(response).await;
    let claims = access_claims(rotated["data"]["access_token"].as_str().unwrap());
    assert_ne!(claims.session_id, session);
    assert_eq!(claims.auth_time, access_claims(fresh).auth_time);
    let retained: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT password_verified_at FROM refresh_sessions WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(retained, password);
}

#[tokio::test]
async fn own_password_confirmation_does_not_override_readonly_or_denied_network_policy() {
    let (app, token, _, _) = ordinary().await;
    let pool = app.db_pool().await;
    for mode in ["readonly", "deny"] {
        sqlx::query("UPDATE facility_network_policies SET offsite_mode=$2,version=version+1 WHERE facility_id=$1").bind(app.state().facility_id()).bind(mode).execute(&pool).await.unwrap();
        let mut request = Request::builder()
            .method(Method::POST)
            .uri(CONFIRM)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("content-type", "application/json")
            .header("x-hms-offsite", "false")
            .body(Body::from(json!({"current_password":PASSWORD}).to_string()))
            .unwrap();
        request.extensions_mut().insert(axum::extract::ConnectInfo(
            "192.0.2.42:44000".parse::<std::net::SocketAddr>().unwrap(),
        ));
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        let fresh = body["data"]["access_token"].as_str().unwrap();
        let mut request=Request::builder().method(Method::POST).uri("/api/v2/inventory/storage-locations").header(AUTHORIZATION,format!("Bearer {fresh}")).header("content-type","application/json").header("x-hms-offsite","false").body(Body::from(json!({"client_request_id":Uuid::new_v4(),"code":"SYNTH22_NETWORK_DENIED","name":"Synthetic network refusal","location_type":"store","temperature_zone":"ambient"}).to_string())).unwrap();
        request.extensions_mut().insert(axum::extract::ConnectInfo(
            "192.0.2.42:44000".parse::<std::net::SocketAddr>().unwrap(),
        ));
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM storage_locations WHERE code='SYNTH22_NETWORK_DENIED'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 0);
}

#[tokio::test]
async fn confirmation_preserves_exact_whitespace_and_unicode_password_bytes() {
    let (app, token, _, _) = ordinary().await;
    let exact = "  Synthetic22!Éxact Credential  ";
    let changed = fixture_json_post(
        &app,
        Some(&token),
        "/api/v2/auth/password",
        json!({"current_password":PASSWORD,"new_password":exact}),
    )
    .await;
    assert_eq!(changed.status(), StatusCode::OK);
    let (current, _, _) = login_with_password(app.clone(), "limited@hms.local", exact).await;
    let before = confirmation_state(&app, &current).await;
    let trimmed = fixture_json_post(
        &app,
        Some(&current),
        CONFIRM,
        json!({"current_password":exact.trim()}),
    )
    .await;
    assert_eq!(trimmed.status(), StatusCode::FORBIDDEN);
    assert_eq!(confirmation_state(&app, &current).await, before);
    let response = fixture_json_post(
        &app,
        Some(&current),
        CONFIRM,
        json!({"current_password":exact}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!response.headers().contains_key(SET_COOKIE));
    let confirmed = json_body(response).await;
    assert_eq!(
        access_claims(confirmed["data"]["access_token"].as_str().unwrap()).session_id,
        access_claims(&current).session_id
    );
}

#[tokio::test]
async fn malformed_enrollment_and_forced_password_lifecycle_remain_closed() {
    let (app, token, _, _) = ordinary().await;
    let user = access_claims(&token).sub;
    enroll_test_passkey(&app, user).await;
    let (enrolled, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    sqlx::query("UPDATE auth_webauthn_credentials SET passkey='{}'::jsonb WHERE user_id=$1 AND disabled_at IS NULL").bind(user).execute(&app.db_pool().await).await.unwrap();
    let before = confirmation_state(&app, &enrolled).await;
    let response = fixture_json_post(
        &app,
        Some(&enrolled),
        CONFIRM,
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(confirmation_state(&app, &enrolled).await, before);

    let (app, token, _, _) = ordinary().await;
    sqlx::query("UPDATE users SET password_change_required=true WHERE id=$1")
        .bind(access_claims(&token).sub)
        .execute(&app.db_pool().await)
        .await
        .unwrap();
    let before = confirmation_state(&app, &token).await;
    let response = fixture_json_post(
        &app,
        Some(&token),
        CONFIRM,
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "password_change_required"
    );
    assert_eq!(confirmation_state(&app, &token).await, before);
}
