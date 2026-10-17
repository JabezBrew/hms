mod support;
use support::*;
#[path = "auth_factor_matrix/mod.rs"]
mod matrix;
use matrix::Matrix;
use support::webauthn_signing::{Ceremony, SoftwareAuthenticator};

async fn wait_for_lock(
    pool: &hms_db::PgPool,
    pid: i32,
    pending: &tokio::task::JoinHandle<axum::response::Response>,
) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{
        let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(pool).await.unwrap();
        if blocked{break;}assert!(!pending.is_finished(),"actual command must reach its held source parent");tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }}).await.expect("actual command waits on its source parent");
}
async fn assert_denied(response: axum::response::Response) -> Value {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "safe factor error {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    assert!(matches!(
        body["error"]["code"].as_str(),
        Some(
            "factor_authorization_expired"
                | "passkey_verification_required"
                | "password_confirmation_required"
        )
    ));
    body
}

#[tokio::test]
async fn actual_key_disable_wins_before_discharge_parent_waiting_factor_proof() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (original, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&original);
    let pool = app.db_pool().await;
    let first_key: Uuid =
        sqlx::query_scalar("SELECT credential_id FROM auth_session_assurance WHERE session_id=$1")
            .bind(claims.session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let added = SoftwareAuthenticator::new();
    let options = fixture_json_post(
        app,
        Some(&original),
        "/api/v2/auth/mfa/webauthn/register/options",
        json!({}),
    )
    .await;
    assert_eq!(options.status(), StatusCode::OK);
    let options = json_body(options).await;
    let verified=fixture_json_post(app,Some(&original),"/api/v2/auth/mfa/webauthn/register/verify",json!({"mfa_session":options["data"]["mfa_session"],"credential":added.registration(&Ceremony::from_options(&options["data"],"http://localhost:8080",0))})).await;
    assert_eq!(verified.status(), StatusCode::OK);
    // Epoch changed through real registration; re-prove the original session
    // with its original runtime key rather than fabricating assurance rows.
    step_up_test_session(app, &original, None).await;
    let pending = raw_password_login(app, "owner@hms.local", "ChangeMe123!", None).await;
    assert_eq!(pending.status(), StatusCode::OK);
    let pending = json_body(pending).await;
    let options = fixture_json_post(
        app,
        None,
        "/api/v2/auth/login/passkey/options",
        json!({"login_grant":pending["data"]["login_grant"]}),
    )
    .await;
    assert_eq!(options.status(), StatusCode::OK);
    let options = json_body(options).await;
    let second=fixture_json_post(app,None,"/api/v2/auth/login/passkey/verify",json!({"login_grant":pending["data"]["login_grant"],"challenge_id":options["data"]["challenge_id"],"credential":added.next_assertion(&options["data"],"http://localhost:8080")})).await;
    assert_eq!(second.status(), StatusCode::OK);
    let second = json_body(second).await;
    let second = second["data"]["access_token"].as_str().unwrap().to_owned();
    let before = matrix.evidence().await;
    let mut blocker = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM discharge_cases WHERE id=$1 FOR UPDATE")
        .bind(matrix.discharge)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let operation = matrix
        .operations
        .iter()
        .find(|op| op.name == "discharge blocker override")
        .unwrap()
        .clone();
    let pending_app = app.clone();
    let command = tokio::spawn(async move { operation.send(&pending_app, &original).await });
    wait_for_lock(&pool, pid, &command).await;
    let disabled = fixture_json_post(
        app,
        Some(&second),
        &format!("/api/v2/auth/mfa/passkeys/{first_key}/disable"),
        json!({}),
    )
    .await;
    assert_eq!(
        disabled.status(),
        StatusCode::OK,
        "an actual independently proved retained key may disable the earlier key"
    );
    blocker.commit().await.unwrap();
    assert_denied(command.await.unwrap()).await;
    assert_eq!(matrix.evidence().await, before);
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM auth_webauthn_credentials WHERE disabled_at IS NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(active, 1);
}

#[tokio::test]
async fn actual_controlled_proof_wait_rechecks_inventory_feature_disabled_by_winning_writer() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let before = matrix.evidence().await;
    let mut blocker = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(app.state().facility_id())
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let operation = matrix
        .operations
        .iter()
        .find(|op| op.name == "controlled receipt")
        .unwrap()
        .clone();
    let pending_app = app.clone();
    let command = tokio::spawn(async move { operation.send(&pending_app, &token).await });
    wait_for_lock(&pool, pid, &command).await;
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'inventory',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(app.state().facility_id()).execute(&mut *blocker).await.unwrap();
    blocker.commit().await.unwrap();
    assert_denied(command.await.unwrap()).await;
    let mut after = matrix.evidence().await;
    let mut before = before;
    after.as_object_mut().unwrap().remove("features");
    before.as_object_mut().unwrap().remove("features");
    assert_eq!(after, before);
}

#[tokio::test]
async fn actual_lab_source_wait_cannot_refresh_aged_durable_password_proof() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let before = matrix.evidence().await;
    let mut blocker = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM lab_results WHERE id=$1 FOR UPDATE")
        .bind(matrix.result)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '15 minutes'+interval '4 seconds' WHERE session_id=$1 RETURNING password_verified_at+interval '15 minutes'").bind(claims.session_id).fetch_one(&pool).await.unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    let operation = matrix
        .operations
        .iter()
        .find(|op| op.name == "laboratory verify")
        .unwrap()
        .clone();
    let pending_app = app.clone();
    let command = tokio::spawn(async move { operation.send(&pending_app, &token).await });
    wait_for_lock(&pool, pid, &command).await;
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 40)).await;
    blocker.commit().await.unwrap();
    let denied = assert_denied(command.await.unwrap()).await;
    assert_eq!(denied["error"]["code"], "password_confirmation_required");
    assert_eq!(matrix.evidence().await, before);
}

#[tokio::test]
async fn actual_nhis_proof_wait_rechecks_secondary_billing_feature() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let before = matrix.evidence().await;
    let mut blocker = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(app.state().facility_id())
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let operation = matrix
        .operations
        .iter()
        .find(|op| op.name == "NHIS receivable adjustment")
        .unwrap()
        .clone();
    let pending_app = app.clone();
    let command = tokio::spawn(async move { operation.send(&pending_app, &token).await });
    wait_for_lock(&pool, pid, &command).await;
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'billing',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(app.state().facility_id()).execute(&mut *blocker).await.unwrap();
    blocker.commit().await.unwrap();
    assert_denied(command.await.unwrap()).await;
    let mut after = matrix.evidence().await;
    let mut before = before;
    after.as_object_mut().unwrap().remove("features");
    before.as_object_mut().unwrap().remove("features");
    assert_eq!(after, before);
}

#[tokio::test]
async fn actual_lab_source_wait_cannot_outlive_its_only_managed_verification_permission() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let pool = app.db_pool().await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    // Complete the genuine forced-password workflow before starting the short
    // authority window; the later login still performs an actual signed factor.
    login(app.clone(), "limited@hms.local").await;
    grant_test_feature(app, limited, FeatureKey::Laboratory).await;
    grant_test_permission(app, limited, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(app, limited, PatientDataVisibility::Demographics).await;
    enroll_test_passkey(app, limited).await;
    let direct:i64=sqlx::query_scalar("SELECT count(*) FROM user_permissions WHERE user_id=$1 AND permission_code='laboratory.result.verify'").bind(limited).fetch_one(&pool).await.unwrap();
    assert_eq!(direct, 0);
    let mut blocker = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM lab_results WHERE id=$1 FOR UPDATE")
        .bind(matrix.result)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let end: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT clock_timestamp()+interval '4 seconds'")
            .fetch_one(&pool)
            .await
            .unwrap();
    hms_db::admin::create_permission_assignment(
        &pool,
        hms_db::admin::NewPermissionAssignment {
            facility_id: app.state().facility_id(),
            grantee_user_id: limited,
            permission_code: PermissionCode::LaboratoryResultVerify,
            scope_type: "facility".into(),
            scope_id: None,
            granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
            starts_at: end - Duration::minutes(1),
            ends_at: Some(end),
            reason_code: "synthetic_factor_temporary_verification".into(),
        },
        None,
    )
    .await
    .unwrap();
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let before = matrix.evidence().await;
    let operation = matrix
        .operations
        .iter()
        .find(|op| op.name == "laboratory verify")
        .unwrap()
        .clone();
    let pending_app = app.clone();
    let command = tokio::spawn(async move { operation.send(&pending_app, &token).await });
    wait_for_lock(&pool, pid, &command).await;
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 40)).await;
    blocker.commit().await.unwrap();
    let denied = assert_denied(command.await.unwrap()).await;
    assert_eq!(denied["error"]["code"], "factor_authorization_expired");
    assert_eq!(matrix.evidence().await, before);
}
