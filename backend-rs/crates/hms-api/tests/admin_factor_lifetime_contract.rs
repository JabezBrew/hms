mod support;
use support::*;

async fn post(app: &TestApp, token: &str, uri: &str, payload: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(uri)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
fn template(code: &str) -> Value {
    json!({"code":code,"title":"Synthetic authority template","description":"Proof lifetime regression","permission_codes":["auth.me.view"]})
}
async fn template_count(pool: &hms_db::PgPool, code: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM position_templates WHERE code=$1")
        .bind(code)
        .fetch_one(pool)
        .await
        .unwrap()
}
async fn wait_for_lock(pool: &hms_db::PgPool, query_prefix: &str) {
    tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1)")
                .bind(format!("{query_prefix}%")).fetch_one(pool).await.unwrap();
            if waiting { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("the real protected request reaches its expected database wait");
}
async fn assert_factor_denial(response: axum::response::Response) {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "safe error code: {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    assert!(matches!(
        body["error"]["code"].as_str(),
        Some("factor_authorization_expired" | "passkey_verification_required")
    ));
}

#[tokio::test]
async fn admin_actor_wait_rechecks_actual_session_before_persisting() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
        .bind(claims.sub)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let request_app = app.clone();
    let pending = tokio::spawn(async move {
        post(
            &request_app,
            &token,
            "/api/v2/admin/position-templates",
            template("AUTH-WAIT-REVOKED"),
        )
        .await
    });
    wait_for_lock(&pool, "SELECT id FROM users WHERE facility_id=").await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&mut *blocker)
        .await
        .unwrap();
    blocker.commit().await.unwrap();
    assert_factor_denial(pending.await.unwrap()).await;
    assert_eq!(template_count(&pool, "AUTH-WAIT-REVOKED").await, 0);
}

#[tokio::test]
async fn admin_facility_wait_rechecks_feature_publication_before_persisting() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(facility)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let request_app = app.clone();
    let pending = tokio::spawn(async move {
        post(
            &request_app,
            &token,
            "/api/v2/admin/position-templates",
            template("AUTH-WAIT-FEATURE"),
        )
        .await
    });
    wait_for_lock(&pool, "SELECT id FROM facilities WHERE id=").await;
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'admin',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false")
        .bind(facility).execute(&mut *blocker).await.unwrap();
    blocker.commit().await.unwrap();
    assert_factor_denial(pending.await.unwrap()).await;
    assert_eq!(template_count(&pool, "AUTH-WAIT-FEATURE").await, 0);
}

#[tokio::test]
async fn admin_audit_wait_cannot_outlive_factor_deadline_and_rolls_back_every_effect() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION wait_admin_factor_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admin.position_template.created' THEN PERFORM pg_advisory_xact_lock(16102212); END IF; RETURN NEW; END $$; CREATE TRIGGER wait_admin_factor_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_admin_factor_audit();")
        .execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(16102212)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE auth_session_assurance SET expires_at=clock_timestamp()+interval '3 seconds' WHERE session_id=$1 RETURNING expires_at")
        .bind(claims.session_id).fetch_one(&pool).await.unwrap();
    let before: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_events WHERE event_type='admin.position_template.created'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let request_app = app.clone();
    let pending = tokio::spawn(async move {
        post(
            &request_app,
            &token,
            "/api/v2/admin/position-templates",
            template("AUTH-AUDIT-EXPIRED"),
        )
        .await
    });
    wait_for_lock(&pool, "INSERT INTO audit_events").await;
    sqlx::query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.03)",
    )
    .bind(end)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("SELECT pg_advisory_unlock(16102212)")
        .execute(&mut *gate)
        .await
        .unwrap();
    assert_factor_denial(pending.await.unwrap()).await;
    assert_eq!(template_count(&pool, "AUTH-AUDIT-EXPIRED").await, 0);
    let after: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_events WHERE event_type='admin.position_template.created'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after, before);
}

#[tokio::test]
async fn reciprocal_admin_grants_use_one_deterministic_user_lock_order() {
    let app = app().await;
    let pool = app.db_pool().await;
    let second: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(app.state().facility_id())
    .fetch_one(&pool)
    .await
    .unwrap();
    grant_test_permission(&app, second, PermissionCode::AdminAuthorityManage).await;
    grant_test_feature(&app, second, FeatureKey::Admin).await;
    let (first_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let first = access_claims(&first_token).sub;
    let (second_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let payload = |target| json!({"grantee_user_id":target,"permission_code":"auth.me.view","scope_type":"facility","reason_code":"synthetic_reciprocal_cover"});
    let (a, b) = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        tokio::join!(
            post(
                &app,
                &first_token,
                "/api/v2/admin/permission-assignments",
                payload(second)
            ),
            post(
                &app,
                &second_token,
                "/api/v2/admin/permission-assignments",
                payload(first)
            )
        )
    })
    .await
    .expect("reciprocal administrative commands cannot deadlock");
    let statuses = [a.status(), b.status()];
    assert!(statuses.contains(&StatusCode::OK));
    for status in statuses {
        assert!(matches!(
            status,
            StatusCode::OK | StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED
        ));
    }
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM permission_assignments WHERE reason_code='synthetic_reciprocal_cover'").fetch_one(&pool).await.unwrap();
    assert_eq!(
        count,
        statuses
            .into_iter()
            .filter(|s| *s == StatusCode::OK)
            .count() as i64
    );
}

async fn policy_evidence(pool: &hms_db::PgPool, facility: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('version',p.version,'updated_at',p.updated_at,'commands',(SELECT count(*) FROM facility_network_policy_commands WHERE facility_id=$1),'versions',(SELECT count(*) FROM facility_network_policy_versions WHERE facility_id=$1),'audits',(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type='network.policy.updated')) FROM facility_network_policies p WHERE p.facility_id=$1")
        .bind(facility).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn network_publication_audit_wait_cannot_outlive_its_exact_factor_proof() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let current = hms_db::network::get_policy(&pool, facility).await.unwrap();
    let before = policy_evidence(&pool, facility).await;
    sqlx::raw_sql("CREATE FUNCTION wait_network_factor_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='network.policy.updated' THEN PERFORM pg_advisory_xact_lock(16102213); END IF; RETURN NEW; END $$; CREATE TRIGGER wait_network_factor_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_network_factor_audit();")
        .execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(16102213)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let end: chrono::DateTime<Utc> = sqlx::query_scalar("UPDATE auth_session_assurance SET expires_at=clock_timestamp()+interval '3 seconds' WHERE session_id=$1 RETURNING expires_at")
        .bind(claims.session_id).fetch_one(&pool).await.unwrap();
    let request_app = app.clone();
    let pending = tokio::spawn(async move {
        let mut request = Request::builder().method(Method::PUT)
            .uri("/api/v2/admin/network-policy")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(json!({"client_request_id":Uuid::new_v4(),"expected_version":current.version,"onsite_cidrs":["127.0.0.1/32","::1/128"],"offsite_mode":"deny","reason":"Synthetic protected network publication"}).to_string())).unwrap();
        request.extensions_mut().insert(axum::extract::ConnectInfo(
            "127.0.0.1:40901".parse::<std::net::SocketAddr>().unwrap(),
        ));
        request_app.oneshot(request).await.unwrap()
    });
    wait_for_lock(&pool, "INSERT INTO audit_events").await;
    sqlx::query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.03)",
    )
    .bind(end)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("SELECT pg_advisory_unlock(16102213)")
        .execute(&mut *gate)
        .await
        .unwrap();
    assert_factor_denial(pending.await.unwrap()).await;
    assert_eq!(policy_evidence(&pool, facility).await, before);
}
