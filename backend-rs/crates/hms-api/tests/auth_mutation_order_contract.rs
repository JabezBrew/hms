//! Actual public auth writers must wait at the facility before mutable rows.
mod support;
use support::*;

async fn waiting(
    pool: &hms_db::PgPool,
    pid: i32,
    pending: &tokio::task::JoinHandle<axum::response::Response>,
) {
    tokio::time::timeout(std::time::Duration::from_secs(5),async{loop{let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(pool).await.unwrap();if blocked{break}assert!(!pending.is_finished(),"auth writer reaches the held parent");tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
}

async fn session_refresh(app: &TestApp, cookie: &str, csrf: &str) -> axum::response::Response {
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

#[tokio::test]
async fn public_password_change_takes_facility_before_account_and_session_rows() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let mut publisher = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(claims.facility_id)
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    let other = app.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(
            &other,
            Some(&token),
            "/api/v2/auth/password",
            json!({"current_password":"ChangeMe123!","new_password":"SyntheticReplacement987!"}),
        )
        .await
    });
    waiting(&pool, pid, &pending).await;
    sqlx::query("SET LOCAL lock_timeout='500ms'")
        .execute(&mut *publisher)
        .await
        .unwrap();
    assert!(
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
            .bind(claims.sub)
            .fetch_one(&mut *publisher)
            .await
            .is_ok(),
        "waiting auth operation cannot pin publisher's actor"
    );
    assert!(
        sqlx::query("SELECT session_id FROM refresh_sessions WHERE session_id=$1 FOR UPDATE")
            .bind(claims.session_id)
            .fetch_one(&mut *publisher)
            .await
            .is_ok(),
        "waiting auth operation cannot pin publisher's exact session"
    );
    publisher.commit().await.unwrap();
    assert_eq!(pending.await.unwrap().status(), StatusCode::OK);
    let revoked: bool = sqlx::query_scalar(
        "SELECT revoked_at IS NOT NULL FROM refresh_sessions WHERE session_id=$1",
    )
    .bind(claims.session_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(revoked);
}

#[tokio::test]
async fn actual_refresh_reuse_family_audit_cannot_invert_feature_publisher_session_lock() {
    let app = app().await;
    let (token, cookie, csrf) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let rotated = session_refresh(&app, &cookie, &csrf).await;
    assert_eq!(rotated.status(), StatusCode::OK);
    let rotated = json_body(rotated).await;
    let current = access_claims(rotated["data"]["access_token"].as_str().unwrap());
    let mut publisher = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(claims.facility_id)
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    let other = app.clone();
    let pending = tokio::spawn(async move { session_refresh(&other, &cookie, &csrf).await });
    waiting(&pool, pid, &pending).await;
    sqlx::query("SET LOCAL lock_timeout='500ms'")
        .execute(&mut *publisher)
        .await
        .unwrap();
    assert!(
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
            .bind(claims.sub)
            .fetch_one(&mut *publisher)
            .await
            .is_ok(),
        "publisher retains canonical user order"
    );
    assert!(
        sqlx::query("SELECT session_id FROM refresh_sessions WHERE session_id=$1 FOR UPDATE")
            .bind(current.session_id)
            .fetch_one(&mut *publisher)
            .await
            .is_ok(),
        "family audit cannot hold session while waiting for its facility FK"
    );
    publisher.commit().await.unwrap();
    assert_eq!(pending.await.unwrap().status(), StatusCode::UNAUTHORIZED);
    let evidence:(bool,i64)=sqlx::query_as("SELECT (SELECT revoked_at IS NOT NULL FROM refresh_sessions WHERE session_id=$1),(SELECT count(*) FROM audit_events WHERE event_type='auth.refresh_token_reuse.detected')").bind(current.session_id).fetch_one(&pool).await.unwrap();
    assert_eq!(evidence, (true, 1));
}

#[tokio::test]
async fn own_password_change_cannot_use_a_session_revoked_during_parent_wait() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let before:(i64,i64)=sqlx::query_as("SELECT (SELECT session_version FROM users WHERE id=$1),(SELECT count(*) FROM password_history WHERE user_id=$1)").bind(claims.sub).fetch_one(&pool).await.unwrap();
    let mut publisher = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(claims.facility_id)
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    let other = app.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(
            &other,
            Some(&token),
            "/api/v2/auth/password",
            json!({"current_password":"ChangeMe123!","new_password":"SyntheticReplacement987!"}),
        )
        .await
    });
    waiting(&pool, pid, &pending).await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp(),revoked_reason='synthetic_authoritative_revocation' WHERE session_id=$1").bind(claims.session_id).execute(&mut *publisher).await.unwrap();
    publisher.commit().await.unwrap();
    let response = pending.await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "factor_authorization_expired"
    );
    let after:(i64,i64)=sqlx::query_as("SELECT (SELECT session_version FROM users WHERE id=$1),(SELECT count(*) FROM password_history WHERE user_id=$1)").bind(claims.sub).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
}

#[tokio::test]
async fn password_reset_token_expiring_during_parent_wait_preserves_password_and_evidence() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let raw = hms_db::provision::generate_secret_token();
    let hash = hms_db::provision::hash_refresh_token(&raw);
    let end: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT clock_timestamp()+interval '4 seconds'")
            .fetch_one(&pool)
            .await
            .unwrap();
    hms_db::auth::insert_password_reset_token(
        &pool,
        &hms_db::auth::NewPasswordResetToken {
            token_hash: hash.clone(),
            user_id: claims.sub,
            facility_id: claims.facility_id,
            expires_at: end,
        },
    )
    .await
    .unwrap();
    let before:(i64,i64)=sqlx::query_as("SELECT (SELECT session_version FROM users WHERE id=$1),(SELECT count(*) FROM password_history WHERE user_id=$1)").bind(claims.sub).fetch_one(&pool).await.unwrap();
    let mut publisher = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(claims.facility_id)
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    let other = app.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(
            &other,
            None,
            "/api/v2/auth/password-reset/complete",
            json!({"token":raw,"new_password":"SyntheticReplacement987!"}),
        )
        .await
    });
    waiting(&pool, pid, &pending).await;
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 30)).await;
    publisher.commit().await.unwrap();
    let response = pending.await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "password_reset_invalid"
    );
    let after:(i64,i64)=sqlx::query_as("SELECT (SELECT session_version FROM users WHERE id=$1),(SELECT count(*) FROM password_history WHERE user_id=$1)").bind(claims.sub).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
    let used: bool = sqlx::query_scalar(
        "SELECT used_at IS NOT NULL FROM password_reset_tokens WHERE token_hash=$1",
    )
    .bind(hash)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!used);
}

#[tokio::test]
async fn own_password_final_session_expiry_rolls_back_user_history_and_retirements() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let before:(i64,i64)=sqlx::query_as("SELECT (SELECT session_version FROM users WHERE id=$1),(SELECT count(*) FROM password_history WHERE user_id=$1)").bind(claims.sub).fetch_one(&pool).await.unwrap();
    sqlx::raw_sql("CREATE FUNCTION hold_password_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(6120320261017); RETURN NEW; END; $$; CREATE TRIGGER hold_password_history BEFORE INSERT ON password_history FOR EACH ROW EXECUTE FUNCTION hold_password_history();").execute(&pool).await.unwrap();
    let mut publisher = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(6120320261017)")
        .execute(&mut *publisher)
        .await
        .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE refresh_sessions SET idle_expires_at=clock_timestamp()+interval '4 seconds' WHERE session_id=$1 RETURNING idle_expires_at").bind(claims.session_id).fetch_one(&pool).await.unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    let other = app.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(
            &other,
            Some(&token),
            "/api/v2/auth/password",
            json!({"current_password":"ChangeMe123!","new_password":"SyntheticReplacement987!"}),
        )
        .await
    });
    waiting(&pool, pid, &pending).await;
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 30)).await;
    publisher.commit().await.unwrap();
    let response = pending.await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "factor_authorization_expired"
    );
    let after:(i64,i64)=sqlx::query_as("SELECT (SELECT session_version FROM users WHERE id=$1),(SELECT count(*) FROM password_history WHERE user_id=$1)").bind(claims.sub).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
    let unchanged: bool =
        sqlx::query_scalar("SELECT revoked_at IS NULL FROM refresh_sessions WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(unchanged);
}

#[tokio::test]
async fn password_reset_final_token_expiry_rolls_back_password_token_history_and_sessions() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let raw = hms_db::provision::generate_secret_token();
    let hash = hms_db::provision::hash_refresh_token(&raw);
    let end: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT clock_timestamp()+interval '4 seconds'")
            .fetch_one(&pool)
            .await
            .unwrap();
    hms_db::auth::insert_password_reset_token(
        &pool,
        &hms_db::auth::NewPasswordResetToken {
            token_hash: hash.clone(),
            user_id: claims.sub,
            facility_id: claims.facility_id,
            expires_at: end,
        },
    )
    .await
    .unwrap();
    let before:(i64,i64)=sqlx::query_as("SELECT (SELECT session_version FROM users WHERE id=$1),(SELECT count(*) FROM password_history WHERE user_id=$1)").bind(claims.sub).fetch_one(&pool).await.unwrap();
    sqlx::raw_sql("CREATE FUNCTION hold_reset_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(6120420261017); RETURN NEW; END; $$; CREATE TRIGGER hold_reset_history BEFORE INSERT ON password_history FOR EACH ROW EXECUTE FUNCTION hold_reset_history();").execute(&pool).await.unwrap();
    let mut publisher = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *publisher)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(6120420261017)")
        .execute(&mut *publisher)
        .await
        .unwrap();
    let other = app.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(
            &other,
            None,
            "/api/v2/auth/password-reset/complete",
            json!({"token":raw,"new_password":"SyntheticReplacement987!"}),
        )
        .await
    });
    waiting(&pool, pid, &pending).await;
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 30)).await;
    publisher.commit().await.unwrap();
    let response = pending.await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "password_reset_invalid"
    );
    let after:(i64,i64)=sqlx::query_as("SELECT (SELECT session_version FROM users WHERE id=$1),(SELECT count(*) FROM password_history WHERE user_id=$1)").bind(claims.sub).fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
    let clean:(bool,bool)=sqlx::query_as("SELECT (SELECT used_at IS NULL FROM password_reset_tokens WHERE token_hash=$1),(SELECT revoked_at IS NULL FROM refresh_sessions WHERE session_id=$2)").bind(hash).bind(claims.session_id).fetch_one(&pool).await.unwrap();
    assert_eq!(clean, (true, true));
}
