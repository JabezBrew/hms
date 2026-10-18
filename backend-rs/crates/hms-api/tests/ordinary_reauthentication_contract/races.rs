use super::attacks::confirmation_state;
use super::*;

async fn waiting(pool: &hms_db::PgPool, fragment: &str) {
    tokio::time::timeout(std::time::Duration::from_secs(10),async{loop{
  let yes:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1)").bind(format!("%{fragment}%")).fetch_one(pool).await.unwrap();
  if yes {break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;
 }}).await.expect("real credential command reaches retained production lock");
}

#[tokio::test]
async fn user_lock_wait_rejects_revocation_hash_or_identity_changes_without_proof_effects() {
    for change in [
        "revoke",
        "hash",
        "session_version",
        "permission_version",
        "factor_version",
        "forced",
        "inactive",
    ] {
        let (app, token, _, _) = ordinary().await;
        let pool = app.db_pool().await;
        let claims = access_claims(&token);
        let before = confirmation_state(&app, &token).await;
        let mut gate = pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
            .bind(claims.sub)
            .execute(&mut *gate)
            .await
            .unwrap();
        let a = app.clone();
        let t = token.clone();
        let pending = tokio::spawn(async move {
            fixture_json_post(&a, Some(&t), CONFIRM, json!({"current_password":PASSWORD})).await
        });
        waiting(
            &pool,
            "SELECT session_version,permission_version,auth_factor_version,password_hash",
        )
        .await;
        match change {
            "revoke" => {
                sqlx::query(
                    "UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1",
                )
                .bind(claims.session_id)
                .execute(&mut *gate)
                .await
                .unwrap();
            }
            "hash" => {
                sqlx::query("UPDATE users SET password_hash=password_hash||'synthetic_changed_hash' WHERE id=$1").bind(claims.sub).execute(&mut *gate).await.unwrap();
            }
            "session_version" => {
                sqlx::query("UPDATE users SET session_version=session_version+1 WHERE id=$1")
                    .bind(claims.sub)
                    .execute(&mut *gate)
                    .await
                    .unwrap();
            }
            "permission_version" => {
                sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
                    .bind(claims.sub)
                    .execute(&mut *gate)
                    .await
                    .unwrap();
            }
            "factor_version" => {
                sqlx::query(
                    "UPDATE users SET auth_factor_version=auth_factor_version+1 WHERE id=$1",
                )
                .bind(claims.sub)
                .execute(&mut *gate)
                .await
                .unwrap();
            }
            "forced" => {
                sqlx::query("UPDATE users SET password_change_required=true WHERE id=$1")
                    .bind(claims.sub)
                    .execute(&mut *gate)
                    .await
                    .unwrap();
            }
            "inactive" => {
                sqlx::query("UPDATE users SET is_active=false WHERE id=$1")
                    .bind(claims.sub)
                    .execute(&mut *gate)
                    .await
                    .unwrap();
            }
            _ => unreachable!(),
        }
        gate.commit().await.unwrap();
        let r = pending.await.unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN, "static race {change}");
        assert!(!r.headers().contains_key(SET_COOKIE));
        assert_eq!(confirmation_state(&app, &token).await, before);
    }
}

#[tokio::test]
async fn facility_profile_wait_revalidates_current_profile_before_password_publication() {
    let (app, token, _, _) = ordinary().await;
    let pool = app.db_pool().await;
    let before = confirmation_state(&app, &token).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(app.state().facility_id())
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let t = token.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(&a, Some(&t), CONFIRM, json!({"current_password":PASSWORD})).await
    });
    waiting(&pool, "SELECT deployment_profile FROM facilities").await;
    sqlx::query("UPDATE facilities SET deployment_profile='clinic' WHERE id=$1")
        .bind(app.state().facility_id())
        .execute(&mut *gate)
        .await
        .unwrap();
    gate.commit().await.unwrap();
    let r = pending.await.unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    assert_eq!(confirmation_state(&app, &token).await, before);
}

#[tokio::test]
async fn actual_credential_timestamp_precedes_lock_release_instead_of_being_reminted_after_wait() {
    let (app, token, _, _) = ordinary().await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
        .bind(claims.sub)
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let t = token.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(&a, Some(&t), CONFIRM, json!({"current_password":PASSWORD})).await
    });
    waiting(
        &pool,
        "SELECT session_version,permission_version,auth_factor_version,password_hash",
    )
    .await;
    let release: chrono::DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *gate)
        .await
        .unwrap();
    gate.commit().await.unwrap();
    let r = pending.await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let body = json_body(r).await;
    let new = access_claims(body["data"]["access_token"].as_str().unwrap());
    let stored: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT password_verified_at FROM refresh_sessions WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(stored < release);
    assert_eq!(new.auth_time, Some(stored.timestamp() as usize));
}

#[tokio::test]
async fn final_same_transaction_clock_rejects_expired_session_and_rolls_back_timestamp_revision_and_audit(
) {
    let (app, token, _, _) = ordinary().await;
    let pool = app.db_pool().await;
    let session = access_claims(&token).session_id;
    sqlx::raw_sql("CREATE FUNCTION wait_ordinary22_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='auth.credential.reconfirmed' THEN PERFORM pg_advisory_xact_lock(17002201);END IF;RETURN NEW;END$$;CREATE TRIGGER wait_ordinary22_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_ordinary22_audit();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002201)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE refresh_sessions SET expires_at=clock_timestamp()+interval '3 seconds' WHERE session_id=$1 RETURNING expires_at").bind(session).fetch_one(&pool).await.unwrap();
    let before = confirmation_state(&app, &token).await;
    let a = app.clone();
    let t = token.clone();
    let pending = tokio::spawn(async move {
        fixture_json_post(&a, Some(&t), CONFIRM, json!({"current_password":PASSWORD})).await
    });
    waiting(&pool, "INSERT INTO audit_events").await;
    sqlx::query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM($1::timestamptz-clock_timestamp())))+0.03)",
    )
    .bind(end)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("SELECT pg_advisory_unlock(17002201)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let r = pending.await.unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(r).await["error"]["code"],
        "factor_authorization_expired"
    );
    assert_eq!(confirmation_state(&app, &token).await, before);
}

#[tokio::test]
async fn audit_failure_cannot_publish_password_timestamp_or_proof_revision_and_never_echoes_sql() {
    let (app, token, _, _) = ordinary().await;
    let pool = app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION reject_ordinary22_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='auth.credential.reconfirmed' THEN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_AUTH_SQL_DETAIL';END IF;RETURN NEW;END$$;CREATE TRIGGER reject_ordinary22_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_ordinary22_audit();").execute(&pool).await.unwrap();
    let before = confirmation_state(&app, &token).await;
    let r = fixture_json_post(
        &app,
        Some(&token),
        CONFIRM,
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(r.status(), StatusCode::CONFLICT);
    let body = json_body(r).await;
    assert!(!body
        .to_string()
        .contains("SYNTHETIC_PRIVATE_AUTH_SQL_DETAIL"));
    assert_eq!(confirmation_state(&app, &token).await, before);
}
