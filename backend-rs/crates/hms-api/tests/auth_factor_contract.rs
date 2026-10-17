mod support;

use support::*;

#[tokio::test]
async fn ordinary_privileged_fixture_completes_real_setup_and_assertion() {
    let app = app().await;
    grant_test_permission(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PermissionCode::SystemOpsView,
    )
    .await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let (method, key_count): (String, i64) = sqlx::query_as(
        "SELECT a.method,(SELECT count(*) FROM auth_webauthn_credentials k WHERE k.facility_id=a.facility_id AND k.user_id=a.user_id AND k.disabled_at IS NULL) FROM auth_session_assurance a WHERE a.session_id=$1",
    ).bind(claims.session_id)
        .fetch_one(&pool).await.expect("actual login assurance is persisted");
    assert_eq!(method, "passkey");
    assert_eq!(key_count, 1);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v2/ops/overview")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Ops error code: {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
}

#[tokio::test]
async fn explicit_fixture_enrollment_still_requires_actual_factor_at_login() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let response = raw_password_login(&app, "owner@hms.local", "ChangeMe123!", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!response.headers().contains_key(SET_COOKIE));
    let pending = json_body(response).await;
    assert_eq!(pending["data"]["status"], "factor_required");
    assert!(pending["data"]["access_token"].is_null());
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    step_up_test_session(&app, &token, None).await;
    let pool = app.db_pool().await;
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM auth_webauthn_credentials WHERE facility_id=$1 AND user_id=$2 AND disabled_at IS NULL")
        .bind(app.state().facility_id()).bind(access_claims(&token).sub)
        .fetch_one(&pool).await.unwrap();
    assert_eq!(
        count, 1,
        "repeat genuine assertions do not create duplicate keys"
    );
}

mod auth_factor_matrix;
use auth_factor_matrix::Matrix;

#[tokio::test]
async fn admission_only_actor_can_choose_real_first_factor_without_restricting_ordinary_closure() {
    use support::webauthn_signing::{Ceremony, SoftwareAuthenticator};
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let pool = app.db_pool().await;
    let user: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='factor-target@hms.local'",
    )
    .bind(app.state().facility_id())
    .fetch_one(&pool)
    .await
    .unwrap();
    for permission in [
        PermissionCode::AdmissionManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(app, user, permission).await;
    }
    for feature in [FeatureKey::Patients, FeatureKey::Admissions] {
        grant_test_feature(app, user, feature).await;
    }
    grant_test_patient_visibility(app, user, PatientDataVisibility::Demographics).await;
    let account = hms_db::auth::user_by_id(&pool, user)
        .await
        .unwrap()
        .unwrap();
    assert!(
        account
            .permissions
            .iter()
            .all(|permission| !hms_domain::auth::is_privileged_permission(permission)),
        "fixture has none of the ten privileged login permissions"
    );
    assert!(!account.auth_security.passkey_required);
    let raw = raw_password_login(app, "factor-target@hms.local", "ChangeMe123!", None).await;
    assert_eq!(raw.status(), StatusCode::OK);
    assert!(raw.headers().contains_key(SET_COOKIE));
    let raw = json_body(raw).await;
    assert_eq!(raw["data"]["status"], "authenticated");
    let ordinary = raw["data"]["access_token"].as_str().unwrap();
    let ward:Uuid=sqlx::query_scalar("SELECT a.ward_id FROM admission_cases a JOIN discharge_cases d ON d.admission_case_id=a.id WHERE d.id=$1").bind(matrix.discharge).fetch_one(&pool).await.unwrap();
    let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients p WHERE p.facility_id=$1 AND p.record_status='registered' AND NOT EXISTS(SELECT 1 FROM admission_cases a WHERE a.facility_id=p.facility_id AND a.patient_id=p.id AND a.status IN ('ready_for_activation','admitted','discharge_pending')) ORDER BY id LIMIT 1").bind(app.state().facility_id()).fetch_one(&pool).await.unwrap();
    let admission:Uuid=sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'ready_for_activation') RETURNING id").bind(app.state().facility_id()).bind(patient).bind(ward).fetch_one(&pool).await.unwrap();
    let cancelled = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/admissions/cases/{admission}/cancel"))
                .header(AUTHORIZATION, format!("Bearer {ordinary}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cancelled.status(),StatusCode::OK,"ordinary operational cancellation does not require a privileged factor or Full clinical grant");
    let status: String = sqlx::query_scalar("SELECT status FROM admission_cases WHERE id=$1")
        .bind(admission)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "cancelled");
    let override_command = matrix
        .operations
        .iter()
        .find(|operation| operation.name == "discharge blocker override")
        .unwrap();
    let denied = override_command.send(app, ordinary).await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM refresh_sessions WHERE user_id=$1")
        .bind(user)
        .fetch_one(&pool)
        .await
        .unwrap();
    let setup = fixture_json_post(
        app,
        None,
        "/api/v2/auth/setup/start",
        json!({"email":"factor-target@hms.local","password":"ChangeMe123!","facility_code":"HMS"}),
    )
    .await;
    assert_eq!(setup.status(), StatusCode::OK);
    assert!(!setup.headers().contains_key(SET_COOKIE));
    let setup = json_body(setup).await;
    assert_eq!(setup["data"]["status"], "setup_required");
    assert!(setup["data"]["access_token"].is_null());
    let grant = setup["data"]["login_grant"].as_str().unwrap();
    let bootstrap = hms_db::provision::generate_secret_token();
    hms_db::auth::assurance::issue_bootstrap_grant(
        &pool,
        app.state().facility_id(),
        user,
        &hms_db::provision::hash_refresh_token(&bootstrap),
    )
    .await
    .unwrap();
    let options = fixture_json_post(
        app,
        None,
        "/api/v2/auth/login/setup/options",
        json!({"login_grant":grant,"bootstrap_token":bootstrap}),
    )
    .await;
    assert_eq!(options.status(), StatusCode::OK);
    let options = json_body(options).await;
    let authenticator = SoftwareAuthenticator::new();
    let registered=fixture_json_post(app,None,"/api/v2/auth/login/setup/verify",json!({"login_grant":grant,"challenge_id":options["data"]["challenge_id"],"credential":authenticator.registration(&Ceremony::from_options(&options["data"],"http://localhost:8080",0))})).await;
    assert_eq!(registered.status(), StatusCode::OK);
    assert!(!registered.headers().contains_key(SET_COOKIE));
    let registered = json_body(registered).await;
    assert_eq!(registered["data"]["status"], "factor_required");
    assert!(registered["data"]["access_token"].is_null());
    let during: i64 = sqlx::query_scalar("SELECT count(*) FROM refresh_sessions WHERE user_id=$1")
        .bind(user)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        during, before,
        "first-key registration creates no ordinary session"
    );
    let options = fixture_json_post(
        app,
        None,
        "/api/v2/auth/login/passkey/options",
        json!({"login_grant":grant}),
    )
    .await;
    assert_eq!(options.status(), StatusCode::OK);
    let options = json_body(options).await;
    let authenticated=fixture_json_post(app,None,"/api/v2/auth/login/passkey/verify",json!({"login_grant":grant,"challenge_id":options["data"]["challenge_id"],"credential":authenticator.next_assertion(&options["data"],"http://localhost:8080")})).await;
    assert_eq!(authenticated.status(), StatusCode::OK);
    assert!(authenticated.headers().contains_key(SET_COOKIE));
    let authenticated = json_body(authenticated).await;
    let token = authenticated["data"]["access_token"].as_str().unwrap();
    let overridden = override_command.send(app, token).await;
    let status = overridden.status();
    let body = json_body(overridden).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "safe override error {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    let full:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$1 AND visibility='full_clinical')").bind(user).fetch_one(&pool).await.unwrap();
    assert!(
        !full,
        "optional enrollment does not broaden clinical visibility"
    );
}

#[tokio::test]
async fn privileged_route_matrix_requires_actual_fresh_passkey_not_enrollment_password_or_recovery()
{
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    // A real registered key is present, but this session has no signed proof.
    sqlx::query("DELETE FROM auth_session_assurance WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&pool)
        .await
        .unwrap();
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    matrix
        .deny_all(&token, "enrolled without session proof")
        .await;

    // Only age genuine assertion evidence; never fabricate fresh factor state.
    step_up_test_session(app, &token, None).await;
    sqlx::query("WITH captured AS (SELECT clock_timestamp() AS at) UPDATE auth_session_assurance SET verified_at=captured.at-interval '16 minutes',expires_at=captured.at-interval '1 minute' FROM captured WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap_or_else(|_|panic!("synthetic assurance fixture update succeeds"));
    app.state().invalidate_auth_cache_for_session(
        claims.facility_id,
        claims.sub,
        claims.session_id,
    );
    matrix.deny_all(&token, "expired passkey proof").await;

    step_up_test_session(app, &token, None).await;
    let codes = fixture_json_post(
        app,
        Some(&token),
        "/api/v2/auth/mfa/recovery-codes",
        json!({"current_password":"ChangeMe123!"}),
    )
    .await;
    assert_eq!(codes.status(), StatusCode::OK);
    let codes = json_body(codes).await;
    let code = codes["data"]["codes"][0]
        .as_str()
        .expect("actual recovery replacement returns its one-time codes");
    let pending = raw_password_login(app, "owner@hms.local", "ChangeMe123!", None).await;
    assert_eq!(pending.status(), StatusCode::OK);
    assert!(!pending.headers().contains_key(SET_COOKIE));
    let pending = json_body(pending).await;
    let recovered = fixture_json_post(
        app,
        None,
        "/api/v2/auth/login/recovery",
        json!({"login_grant":pending["data"]["login_grant"],"code":code}),
    )
    .await;
    assert_eq!(recovered.status(), StatusCode::OK);
    let recovered = json_body(recovered).await;
    let recovery_token = recovered["data"]["access_token"]
        .as_str()
        .expect("actual recovery login establishes a limited ordinary session");
    matrix
        .deny_all(recovery_token, "recovery-only session")
        .await;

    let (fresh, _, _) = login(app.clone(), "owner@hms.local").await;
    for operation in &matrix.operations {
        let request_started = Utc::now();
        let response = operation.send(app, &fresh).await;
        let status = response.status();
        let body = json_body(response).await;
        let diagnostics = if status == StatusCode::OK {
            Value::Null
        } else {
            safe_factor_failure_facts(app, &fresh, request_started).await
        };
        assert_eq!(
            status,
            StatusCode::OK,
            "fresh real assertion permits {}; error code {}; aggregate proof facts {}",
            operation.name,
            body["error"]["code"].as_str().unwrap_or("none"),
            diagnostics
        );
    }
}

// Failure-only aggregate diagnostics. Never include identifiers, actual proof
// timestamps, credentials, token claims, clinical input or response bodies.
async fn safe_factor_failure_facts(
    app: &TestApp,
    token: &str,
    request_started: chrono::DateTime<Utc>,
) -> Value {
    let claims = access_claims(token);
    let pool = app.db_pool().await;
    let row: Option<(chrono::DateTime<Utc>, Option<chrono::DateTime<Utc>>, Option<chrono::DateTime<Utc>>, Value)> = sqlx::query_as(
        "SELECT clock_timestamp(),a.verified_at,a.expires_at,jsonb_build_object('assurance_present',a.session_id IS NOT NULL,'method_is_passkey',a.method='passkey','key_active',k.id IS NOT NULL AND k.disabled_at IS NULL,'factor_epoch_matches',a.factor_version=u.auth_factor_version,'session_version_matches',a.session_version=u.session_version AND a.session_version=r.session_version,'permission_version_matches',a.permission_version=u.permission_version AND a.permission_version=r.permission_version_at_issue,'profile_matches',a.active_profile=f.deployment_profile,'enrolled',EXISTS(SELECT 1 FROM auth_webauthn_credentials e WHERE e.facility_id=u.facility_id AND e.user_id=u.id AND e.disabled_at IS NULL)) FROM refresh_sessions r JOIN users u ON u.id=r.user_id AND u.facility_id=r.facility_id JOIN facilities f ON f.id=u.facility_id LEFT JOIN auth_session_assurance a ON a.session_id=r.session_id LEFT JOIN auth_webauthn_credentials k ON k.id=a.credential_id AND k.facility_id=a.facility_id AND k.user_id=a.user_id WHERE r.facility_id=$1 AND r.user_id=$2 AND r.session_id=$3")
        .bind(claims.facility_id).bind(claims.sub).bind(claims.session_id).fetch_optional(&pool).await.ok().flatten();
    let host_after = Utc::now();
    let Some((database_now, verified_at, expires_at, mut facts)) = row else {
        return json!({"diagnostic_row_available":false});
    };
    facts["database_clock_minus_host_after_us"] =
        json!((database_now - host_after).num_microseconds());
    facts["verified_not_after_database"] = json!(verified_at.is_some_and(|at| at <= database_now));
    facts["verified_not_after_request_start"] =
        json!(verified_at.is_some_and(|at| at <= request_started));
    facts["verified_not_after_host_after"] = json!(verified_at.is_some_and(|at| at <= host_after));
    facts["proof_age_at_request_start_us"] =
        json!(verified_at.and_then(|at| (request_started - at).num_microseconds()));
    facts["proof_window_us"] = json!(verified_at
        .zip(expires_at)
        .and_then(|(at, end)| (end - at).num_microseconds()));
    if let Ok(Some(hydrated)) = app
        .state()
        .request_context_facts_for_claims(&claims, "test.factor_diagnostics")
        .await
    {
        let assurance = hydrated.user.auth_security.session_assurance;
        facts["hydrated_method_is_passkey"] =
            json!(assurance.method == Some(hms_domain::auth_assurance::FactorMethod::Passkey));
        facts["hydrated_fresh_at_request_start"] =
            json!(assurance.is_fresh_passkey_at(request_started));
        facts["hydrated_enrolled"] = json!(hydrated.user.auth_security.passkey_enrolled);
        facts["hydrated_privileged_actions_allowed"] =
            json!(hydrated.user.auth_security.privileged_actions_allowed);
    }
    facts
}

async fn await_real_row_wait(
    pool: &hms_db::PgPool,
    pid: i32,
    pending: &tokio::task::JoinHandle<axum::response::Response>,
) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async{
        loop{
            let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(pool).await.unwrap();
            if waiting {break;}
            assert!(!pending.is_finished(),"the production request must reach its actual row lock");
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("production request waits on the held row");
}

#[tokio::test]
async fn actual_lab_source_wait_past_factor_deadline_rolls_back_verification_and_audit() {
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
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE auth_session_assurance SET expires_at=clock_timestamp()+interval '4 seconds' WHERE session_id=$1 RETURNING expires_at").bind(claims.session_id).fetch_one(&pool).await.unwrap();
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
    let pending = tokio::spawn(async move { operation.send(&pending_app, &token).await });
    await_real_row_wait(&pool, pid, &pending).await;
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 40)).await;
    blocker.commit().await.unwrap();
    let response = pending.await.unwrap();
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "post-wait factor error {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    assert_eq!(matrix.evidence().await, before);
    let audit:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE event_type='laboratory.result.verified' AND resource_id=$1").bind(matrix.result).fetch_one(&pool).await.unwrap();
    assert_eq!(audit, 0);
}

#[tokio::test]
async fn actual_controlled_writer_rechecks_session_revoked_while_facility_proof_waits() {
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
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(claims.facility_id)
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
    let pending = tokio::spawn(async move { operation.send(&pending_app, &token).await });
    await_real_row_wait(&pool, pid, &pending).await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&pool)
        .await
        .unwrap();
    blocker.commit().await.unwrap();
    let response = pending.await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(matrix.evidence().await, before);
}

#[tokio::test]
async fn privileged_write_audit_failure_rolls_back_every_family_business_change() {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    sqlx::query("CREATE FUNCTION reject_factor_matrix_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit rollback'; END $$").execute(&pool).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_factor_matrix_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_factor_matrix_audit()").execute(&pool).await.unwrap();
    let before = matrix.evidence().await;
    for operation in matrix
        .operations
        .iter()
        .filter(|op| op.method != Method::GET)
    {
        let response = operation.send(app, &token).await;
        let status = response.status();
        let body = json_body(response).await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "{} audit failure; error {}",
            operation.name,
            body["error"]["code"].as_str().unwrap_or("none")
        );
        assert_eq!(
            matrix.evidence().await,
            before,
            "{} must roll back business writes with audit",
            operation.name
        );
    }
}
