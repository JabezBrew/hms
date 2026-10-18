mod support;
use support::*;

async fn setup() -> (TestApp, String) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    (app, token)
}
fn create_input(code: &str) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"code":code,"name":"Synthetic organization unit","unit_type":"department","parent_unit_id":null})
}
async fn create(app: &TestApp, token: &str, code: &str) -> Value {
    let (s, b) = request(
        app,
        token,
        Method::POST,
        "/api/v2/admin/org-units",
        Some(create_input(code)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "static code {}", b["error"]["code"]);
    b["data"].clone()
}
fn unit_id(r: &Value) -> Uuid {
    r["unit"]["id"].as_str().unwrap().parse().unwrap()
}
async fn command(
    app: &TestApp,
    token: &str,
    id: Uuid,
    action: &str,
    version: i64,
) -> (StatusCode, Value) {
    request(
        app,
        token,
        Method::POST,
        &format!("/api/v2/admin/org-units/{id}/{action}"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":version})),
    )
    .await
}
async fn effects(app: &TestApp) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM organization_units WHERE facility_id=$1),(SELECT count(*) FROM organization_unit_commands WHERE facility_id=$1),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type LIKE 'admin.organization_unit.%'))").bind(app.state().facility_id()).fetch_one(&app.db_pool().await).await.unwrap()
}

async fn request(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn governed_organization_lifecycle_has_reachable_wire_and_positive_controls() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let key = Uuid::new_v4();
    let create = request(&app, &token, Method::POST, "/api/v2/admin/org-units", Some(json!({
        "client_request_id":key,"code":"ORG20_WIRE","name":"Synthetic governed unit","unit_type":"department","parent_unit_id":null
    }))).await;
    let id: Uuid = sqlx::query_scalar(
        "SELECT id FROM organization_units WHERE facility_id=$1 AND code='ORG20_WIRE'",
    )
    .bind(app.state().facility_id())
    .fetch_one(&app.db_pool().await)
    .await
    .unwrap();
    let detail = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/admin/org-units/{id}"),
        None,
    )
    .await;
    let rename = request(&app,&token,Method::POST,&format!("/api/v2/admin/org-units/{id}/rename"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic renamed unit"}))).await;
    let retire = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/admin/org-units/{id}/retire"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":2})),
    )
    .await;
    let restore = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/admin/org-units/{id}/reactivate"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":3})),
    )
    .await;
    let receipt = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/admin/org-units/commands/{key}"),
        None,
    )
    .await;
    let statuses = [
        create.0.as_u16(),
        detail.0.as_u16(),
        rename.0.as_u16(),
        retire.0.as_u16(),
        restore.0.as_u16(),
        receipt.0.as_u16(),
    ];
    println!("organization20 actual wire status controls: {statuses:?}");
    assert_eq!(statuses, [200; 6]);
    assert_eq!(create.1["data"], receipt.1["data"]);
}

#[tokio::test]
async fn exact_original_receipts_survive_changes_and_same_uuid_cannot_change_intent() {
    let (app, token) = setup().await;
    let payload = create_input("ORG20_REPLAY");
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/admin/org-units",
        Some(payload.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let original = b["data"].clone();
    let id = unit_id(&original);
    let (s,_)=request(&app,&token,Method::POST,&format!("/api/v2/admin/org-units/{id}/rename"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic new name"}))).await;
    assert_eq!(s, StatusCode::OK);
    let before = effects(&app).await;
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/admin/org-units",
        Some(payload.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], original);
    let mut changed = payload;
    changed["name"] = json!("Synthetic conflicting intent");
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/admin/org-units",
        Some(changed),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "organization_unit_request_conflict");
    assert_eq!(effects(&app).await, before);
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        &format!(
            "/api/v2/admin/org-units/commands/{}",
            original["client_request_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], original);
}

#[tokio::test]
async fn versions_exact_noops_and_strict_identity_are_enforced() {
    let (app, token) = setup().await;
    let r = create(&app, &token, "ORG20_CAS").await;
    let id = unit_id(&r);
    let same =
        json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":r["unit"]["name"]});
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/admin/org-units/{id}/rename"),
        Some(same),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["changed"], false);
    assert_eq!(b["data"]["unit"], r["unit"]);
    let (s, b) = command(&app, &token, id, "retire", 1).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["unit"]["version"], 2);
    let before = effects(&app).await;
    let (s, b) = command(&app, &token, id, "reactivate", 1).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "organization_unit_version_conflict");
    let mut bad = create_input("ORG20_NO_UUID");
    bad.as_object_mut().unwrap().remove("client_request_id");
    assert!(request(
        &app,
        &token,
        Method::POST,
        "/api/v2/admin/org-units",
        Some(bad)
    )
    .await
    .0
    .is_client_error());
    let bad = json!({"client_request_id":Uuid::new_v4(),"expected_version":2,"name":"Synthetic","parent_unit_id":Uuid::new_v4()});
    assert!(request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/admin/org-units/{id}/rename"),
        Some(bad)
    )
    .await
    .0
    .is_client_error());
    assert_eq!(effects(&app).await, before);
    let pool = app.db_pool().await;
    for statement in [
        "UPDATE organization_units SET code='ORG20_RETARGET' WHERE id=$1",
        "UPDATE organization_units SET parent_unit_id=NULL,unit_type='ward' WHERE id=$1",
        "DELETE FROM organization_units WHERE id=$1",
    ] {
        assert!(sqlx::query(statement)
            .bind(id)
            .execute(&pool)
            .await
            .is_err());
    }
    assert!(
        sqlx::query("UPDATE organization_unit_commands SET action='create' WHERE unit_id=$1")
            .bind(id)
            .execute(&pool)
            .await
            .is_err()
    );
    assert_eq!(
        command(&app, &token, id, "reactivate", 2).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn retirement_refuses_inactive_children_positions_and_historical_scope_references() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let owner = access_claims(&token).sub;
    for (code, kind) in [
        ("ORG20_CHILD", 0),
        ("ORG20_POSITION", 1),
        ("ORG20_SCOPE", 2),
    ] {
        let r = create(&app, &token, code).await;
        let id = unit_id(&r);
        match kind {
            0 => {
                sqlx::query("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type,is_active) VALUES(gen_random_uuid(),$1,$2,'ORG20_INACTIVE_CHILD','Synthetic child','service',false)").bind(facility).bind(id).execute(&pool).await.unwrap();
            }
            1 => {
                sqlx::query("INSERT INTO positions(id,facility_id,org_unit_id,code,title,status) VALUES(gen_random_uuid(),$1,$2,'ORG20_INACTIVE_POSITION','Synthetic position','inactive')").bind(facility).bind(id).execute(&pool).await.unwrap();
            }
            _ => {
                sqlx::query("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,scope_id,granted_by_user_id,status) VALUES(gen_random_uuid(),$1,$2,'auth.me.view','organization_unit',$3,$2,'revoked')").bind(facility).bind(owner).bind(id).execute(&pool).await.unwrap();
            }
        }
        let before = effects(&app).await;
        let (s, b) = command(&app, &token, id, "retire", 1).await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(
            b["error"]["code"],
            [
                "organization_unit_has_children",
                "organization_unit_has_positions",
                "organization_unit_has_scope_grants"
            ][kind]
        );
        assert_eq!(effects(&app).await, before);
    }
}

#[tokio::test]
async fn parent_scope_is_exact_and_historical_inactive_parent_blocks_reactivation() {
    // A real pre027 historical graph is migrated intact. No guard is disabled.
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610170027)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let baseline = hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    hms_db::provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let facility = baseline.facility_id;
    let parent:Uuid=sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,code,name,unit_type,is_active) VALUES(gen_random_uuid(),$1,'ORG20_PARENT','Synthetic historical parent','department',false) RETURNING id").bind(facility).fetch_one(&pool).await.unwrap();
    let child:Uuid=sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type,is_active) VALUES(gen_random_uuid(),$1,$2,'ORG20_IMPORTED_CHILD','Synthetic historical child','service',false) RETURNING id").bind(facility).bind(parent).fetch_one(&pool).await.unwrap();
    let live_child:Uuid=sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type,is_active) VALUES(gen_random_uuid(),$1,$2,'ORG20_HISTORICAL_ACTIVE_CHILD','Synthetic historical active child','service',true) RETURNING id").bind(facility).bind(parent).fetch_one(&pool).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let app = app_with_config(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (status, stable) = command(&app, &token, live_child, "reactivate", 1).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stable["data"]["changed"], false);
    assert_eq!(stable["data"]["unit"]["version"], 1);
    let before = effects(&app).await;
    let mut bad = create_input("ORG20_BAD_CHILD");
    bad["parent_unit_id"] = json!(parent);
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/admin/org-units",
        Some(bad),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "organization_unit_parent_unavailable");
    assert_eq!(effects(&app).await, before);
    assert_eq!(
        command(&app, &token, child, "reactivate", 1).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        command(&app, &token, parent, "reactivate", 1).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        command(&app, &token, child, "reactivate", 1).await.0,
        StatusCode::CONFLICT
    );
    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'ORG20_FOREIGN','Synthetic foreign facility','hospital')").bind(foreign_facility).execute(&pool).await.unwrap();
    let foreign:Uuid=sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,code,name,unit_type) VALUES(gen_random_uuid(),$1,'ORG20_FOREIGN','Synthetic foreign unit','department') RETURNING id").bind(foreign_facility).fetch_one(&pool).await.unwrap();
    let mut bad = create_input("ORG20_FOREIGN_CHILD");
    bad["parent_unit_id"] = json!(foreign);
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(bad)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        command(&app, &token, foreign, "retire", 1).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn receipts_remain_original_actor_bound_and_permissions_do_not_follow_the_unit() {
    let (app, token) = setup().await;
    let r = create(&app, &token, "ORG20_ACTOR").await;
    let pool = app.db_pool().await;
    let other: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(app.state().facility_id())
    .fetch_one(&pool)
    .await
    .unwrap();
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        request(
            &app,
            &limited,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(create_input("ORG20_DENIED"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    grant_test_permission(&app, other, PermissionCode::AdminAuthorityManage).await;
    grant_test_feature(&app, other, FeatureKey::Admin).await;
    let (other_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let path = format!(
        "/api/v2/admin/org-units/commands/{}",
        r["client_request_id"].as_str().unwrap()
    );
    assert_eq!(
        request(&app, &other_token, Method::GET, &path, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let before = effects(&app).await;
    let mut collision = create_input("ORG20_COLLISION");
    collision["client_request_id"] = r["client_request_id"].clone();
    assert_eq!(
        request(
            &app,
            &other_token,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(collision)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(effects(&app).await, before);
}

async fn wait_for_lock(pool: &hms_db::PgPool, prefix: &str) {
    tokio::time::timeout(std::time::Duration::from_secs(8),async{loop{
        let yes:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1)").bind(format!("{prefix}%")).fetch_one(pool).await.unwrap();if yes {break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }}).await.expect("real request reaches controlled wait");
}

#[tokio::test]
async fn final_audit_wait_cannot_outlive_privileged_factor_and_rolls_back_every_effect() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    sqlx::raw_sql("CREATE FUNCTION wait_org20_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admin.organization_unit.create' THEN PERFORM pg_advisory_xact_lock(17002720); END IF; RETURN NEW; END $$; CREATE TRIGGER wait_org20_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_org20_audit();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002720)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("UPDATE auth_session_assurance SET expires_at=clock_timestamp()+interval '3 seconds' WHERE session_id=$1 RETURNING expires_at").bind(claims.session_id).fetch_one(&pool).await.unwrap();
    let before = effects(&app).await;
    let copied = app.clone();
    let pending = tokio::spawn(async move {
        request(
            &copied,
            &token,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(create_input("ORG20_EXPIRED")),
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
    sqlx::query("SELECT pg_advisory_unlock(17002720)")
        .execute(&mut *gate)
        .await
        .unwrap();
    assert_eq!(pending.await.unwrap().0, StatusCode::FORBIDDEN);
    assert_eq!(effects(&app).await, before);
}

#[tokio::test]
async fn an_actor_lock_wait_rechecks_the_current_session_before_organization_publication() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    let before = effects(&app).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
        .bind(claims.sub)
        .execute(&mut *gate)
        .await
        .unwrap();
    let copied = app.clone();
    let pending = tokio::spawn(async move {
        request(
            &copied,
            &token,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(create_input("ORG20_REVOKED")),
        )
        .await
    });
    wait_for_lock(&pool, "SELECT id FROM users WHERE facility_id=").await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&mut *gate)
        .await
        .unwrap();
    gate.commit().await.unwrap();
    assert_eq!(pending.await.unwrap().0, StatusCode::FORBIDDEN);
    assert_eq!(effects(&app).await, before);
}

#[tokio::test]
async fn repeated_baseline_provision_preserves_governed_unit_name_version_and_receipt() {
    let (app, token) = setup().await;
    let id = Uuid::from_u128(hms_db::provision::DEFAULT_ORG_UNIT_OPD_ID);
    let path = format!("/api/v2/admin/org-units/{id}/rename");
    let(s,b)=request(&app,&token,Method::POST,&path,Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic governed outpatient name"}))).await;
    assert_eq!(s, StatusCode::OK);
    let before = b["data"].clone();
    let pool = app.db_pool().await;
    let provision = hms_db::provision::provision_baseline(
        &pool,
        &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await;
    println!(
        "organization20 repeat baseline preserved success: {}",
        provision.is_ok()
    );
    assert!(
        provision.is_ok(),
        "baseline provisioning must preserve a governed rename"
    );
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/admin/org-units/{id}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], before["unit"]);
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        &format!(
            "/api/v2/admin/org-units/commands/{}",
            before["client_request_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], before);
    let (status, retired) = command(&app, &token, id, "retire", 2).await;
    assert_eq!(status, StatusCode::OK);
    let denied = hms_db::provision::provision_baseline(
        &pool,
        &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await;
    assert!(
        denied.is_err(),
        "retired defaults require explicit review rather than seed reactivation"
    );
    let (status, current) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/admin/org-units/{id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(current["data"], retired["data"]["unit"]);
}

#[tokio::test]
async fn a_new_inactive_child_cannot_publish_against_a_retired_parent() {
    let (app, token) = setup().await;
    let r = create(&app, &token, "ORG20_REFERENCE_PUBLISH").await;
    let id = unit_id(&r);
    assert_eq!(
        command(&app, &token, id, "retire", 1).await.0,
        StatusCode::OK
    );
    let inserted=sqlx::query("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type,is_active) VALUES(gen_random_uuid(),$1,$2,'ORG20_LATE_CHILD','Synthetic late child','service',false)")
        .bind(app.state().facility_id()).bind(id).execute(&app.db_pool().await).await;
    println!(
        "organization20 inactive reference rejected: {}",
        inserted.is_err()
    );
    assert!(
        inserted.is_err(),
        "all new parent references must retain active exact parent eligibility"
    );
}

#[tokio::test]
async fn directory_pages_are_bounded_and_include_exact_versions_with_server_filters() {
    let (app, token) = setup().await;
    sqlx::query("INSERT INTO organization_units(id,facility_id,code,name,unit_type,is_active) SELECT gen_random_uuid(),$1,'ORG20_PAGE_'||g,'Synthetic paged unit','service',false FROM generate_series(1,103) g").bind(app.state().facility_id()).execute(&app.db_pool().await).await.unwrap();
    let (s, first) = request(
        &app,
        &token,
        Method::GET,
        "/api/v2/admin/org-units?limit=100&unit_type=service&is_active=false",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(first["data"].as_array().unwrap().len(), 100);
    assert_eq!(first["page"]["has_next"], true);
    assert!(first["data"]
        .as_array()
        .unwrap()
        .iter()
        .all(|u| u["version"] == 1
            && u["is_active"] == false
            && u["unit_type"] == "service"
            && u["updated_at"].is_string()));
    let cursor = first["page"]["next_cursor"].as_str().unwrap();
    let (s, last) = request(
        &app,
        &token,
        Method::GET,
        &format!(
            "/api/v2/admin/org-units?limit=100&unit_type=service&is_active=false&cursor={cursor}"
        ),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(last["data"].as_array().unwrap().len(), 3);
    assert_eq!(last["page"]["has_next"], false);
    let mut ids = std::collections::HashSet::new();
    for u in first["data"]
        .as_array()
        .unwrap()
        .iter()
        .chain(last["data"].as_array().unwrap())
    {
        assert!(ids.insert(u["id"].as_str().unwrap()));
    }
}

#[tokio::test]
async fn exact_unit_lock_is_busy_and_both_reference_publication_orders_preserve_retirement() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let id = unit_id(&create(&app, &token, "ORG20_REFERENCE_FIRST").await);
    let mut reference = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type,is_active) VALUES(gen_random_uuid(),$1,$2,'ORG20_RETAINED_CHILD','Synthetic retained child','service',false)").bind(facility).bind(id).execute(&mut *reference).await.unwrap();
    let before = effects(&app).await;
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        command(&app, &token, id, "retire", 1),
    )
    .await
    .expect("exact unit NOWAIT is bounded");
    assert_eq!(blocked.0, StatusCode::CONFLICT);
    assert_eq!(blocked.1["error"]["code"], "organization_unit_busy");
    assert_eq!(effects(&app).await, before);
    reference.commit().await.unwrap();
    let (s, b) = command(&app, &token, id, "retire", 1).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "organization_unit_has_children");
    let id = unit_id(&create(&app, &token, "ORG20_RETIREMENT_FIRST").await);
    sqlx::raw_sql("CREATE FUNCTION wait_org20_retire_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admin.organization_unit.retire' THEN PERFORM pg_advisory_xact_lock(17002721); END IF; RETURN NEW; END $$; CREATE TRIGGER wait_org20_retire_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_org20_retire_audit();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002721)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let copied = app.clone();
    let pending = tokio::spawn(async move { command(&copied, &token, id, "retire", 1).await });
    wait_for_lock(&pool, "INSERT INTO audit_events").await;
    let p = pool.clone();
    let insert = tokio::spawn(async move {
        sqlx::query("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type,is_active) VALUES(gen_random_uuid(),$1,$2,'ORG20_REFUSED_LATE','Synthetic late child','service',false)").bind(facility).bind(id).execute(&p).await
    });
    wait_for_lock(&pool, "INSERT INTO organization_units").await;
    sqlx::query("SELECT pg_advisory_unlock(17002721)")
        .execute(&mut *gate)
        .await
        .unwrap();
    assert_eq!(pending.await.unwrap().0, StatusCode::OK);
    assert!(insert.await.unwrap().is_err());
    let counts:(bool,i64)=sqlx::query_as("SELECT is_active,(SELECT count(*) FROM organization_units WHERE parent_unit_id=$1) FROM organization_units WHERE id=$1").bind(id).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (false, 0));
}

#[tokio::test]
async fn audit_fault_is_unconfirmed_with_no_partial_unit_command_or_receipt() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let input = create_input("ORG20_UNKNOWN");
    let key = input["client_request_id"].as_str().unwrap();
    let before = effects(&app).await;
    sqlx::raw_sql("CREATE FUNCTION reject_org20_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admin.organization_unit.create' THEN RAISE EXCEPTION 'synthetic private organization detail'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_org20_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_org20_audit();").execute(&pool).await.unwrap();
    let (s, b) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/admin/org-units",
        Some(input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "organization_unit_write_unconfirmed");
    assert_eq!(b["error"]["details"], json!({}));
    assert!(!b
        .to_string()
        .contains("synthetic private organization detail"));
    assert_eq!(effects(&app).await, before);
    assert_eq!(
        request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/admin/org-units/commands/{key}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("DROP TRIGGER reject_org20_audit ON audit_events")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(input)
        )
        .await
        .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn reactivation_cannot_resurrect_pre027_position_authority_or_historical_scope_references() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610170027)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let baseline = hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    hms_db::provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let facility = baseline.facility_id;
    let target: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let id:Uuid=sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,code,name,unit_type,is_active) VALUES(gen_random_uuid(),$1,'ORG20_LEGACY_AUTHORITY','Synthetic inactive historical authority','department',false) RETURNING id").bind(facility).fetch_one(&pool).await.unwrap();
    let template:Uuid=sqlx::query_scalar("INSERT INTO position_templates(id,facility_id,code,title,description,permission_codes) VALUES(gen_random_uuid(),$1,'ORG20_LEGACY_AUTHORITY','Synthetic authority template','Synthetic',ARRAY['patient.create']) RETURNING id").bind(facility).fetch_one(&pool).await.unwrap();
    let position:Uuid=sqlx::query_scalar("INSERT INTO positions(id,facility_id,org_unit_id,template_id,code,title,status) VALUES(gen_random_uuid(),$1,$2,$3,'ORG20_LEGACY_AUTHORITY','Synthetic authority position','active') RETURNING id").bind(facility).bind(id).bind(template).fetch_one(&pool).await.unwrap();
    let appointment:Uuid=sqlx::query_scalar("INSERT INTO authority_appointments(id,facility_id,position_id,user_id,appointed_by_user_id,appointment_type,status) VALUES(gen_random_uuid(),$1,$2,$3,$4,'acting','active') RETURNING id").bind(facility).bind(position).bind(target).bind(owner).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,scope_id,granted_by_user_id,status) VALUES(gen_random_uuid(),$1,$2,'auth.me.view','organization_unit',$3,$4,'revoked')").bind(facility).bind(target).bind(id).bind(owner).execute(&pool).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let app = app_with_config(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let before = hms_db::admin::active_authorities_for_user(&pool, facility, target)
        .await
        .unwrap()
        .into_iter()
        .filter(|a| a.source_id == appointment)
        .count();
    let version_before: i64 =
        sqlx::query_scalar("SELECT permission_version FROM users WHERE id=$1")
            .bind(target)
            .fetch_one(&pool)
            .await
            .unwrap();
    let (s, b) = command(&app, &token, id, "reactivate", 1).await;
    let after = hms_db::admin::active_authorities_for_user(&pool, facility, target)
        .await
        .unwrap()
        .into_iter()
        .filter(|a| a.source_id == appointment)
        .count();
    let version_after: i64 = sqlx::query_scalar("SELECT permission_version FROM users WHERE id=$1")
        .bind(target)
        .fetch_one(&pool)
        .await
        .unwrap();
    println!("organization20 legacy restore: status={}, actual scoped position authority counts=[{},{}], permission version unchanged={}",s.as_u16(),before,after,version_before==version_after);
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "organization_unit_has_positions");
    assert_eq!((before, after), (0, 0));
    let (status, stable) = command(&app, &token, id, "retire", 1).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stable["data"]["changed"], false);
    assert_eq!(stable["data"]["unit"]["version"], 1);
}

#[tokio::test]
async fn command_receipts_keep_foreign_historical_parent_identity_redacted() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610170027)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let baseline = hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    hms_db::provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let facility = baseline.facility_id;
    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'ORG20_SCOPED_FOREIGN','Synthetic foreign facility','hospital')").bind(foreign_facility).execute(&pool).await.unwrap();
    let parent:Uuid=sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,code,name,unit_type) VALUES(gen_random_uuid(),$1,'ORG20_SCOPED_PARENT','Synthetic foreign parent','department') RETURNING id").bind(foreign_facility).fetch_one(&pool).await.unwrap();
    let child:Uuid=sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type) VALUES(gen_random_uuid(),$1,$2,'ORG20_SCOPED_CHILD','Synthetic legacy child','service') RETURNING id").bind(facility).bind(parent).fetch_one(&pool).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let app = app_with_config(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (s, detail) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/admin/org-units/{child}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(detail["data"]["parent_unit_id"].is_null());
    let input = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic renamed historical child"});
    let (s, receipt) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/admin/org-units/{child}/rename"),
        Some(input),
    )
    .await;
    println!(
        "organization20 scoped receipt: status={}, foreign parent redacted={}",
        s.as_u16(),
        receipt["data"]["unit"]["parent_unit_id"].is_null()
    );
    assert_eq!(s, StatusCode::OK);
    assert!(receipt["data"]["unit"]["parent_unit_id"].is_null());
    let retained: bool =
        sqlx::query_scalar("SELECT parent_unit_id=$2 FROM organization_units WHERE id=$1")
            .bind(child)
            .bind(parent)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(retained);
}

#[tokio::test]
async fn concurrent_uuid_and_code_reservations_are_bounded_and_keep_one_original_result() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let other: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    grant_test_permission(&app, other, PermissionCode::AdminAuthorityManage).await;
    grant_test_feature(&app, other, FeatureKey::Admin).await;
    let (other_token, _, _) = login(app.clone(), "limited@hms.local").await;
    create(&app, &other_token, "ORG20_SECOND_AUTHORIZED").await;
    sqlx::raw_sql("CREATE FUNCTION wait_org20_uuid_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admin.organization_unit.create' THEN PERFORM pg_advisory_xact_lock(17002722); END IF; RETURN NEW; END $$; CREATE TRIGGER wait_org20_uuid_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_org20_uuid_audit();").execute(&pool).await.unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(17002722)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let input = create_input("ORG20_SINGLE_CODE");
    let mut same_key = create_input("ORG20_OTHER_CODE");
    same_key["client_request_id"] = input["client_request_id"].clone();
    let same_code = create_input("ORG20_SINGLE_CODE");
    let before = effects(&app).await;
    let copied = app.clone();
    let first_token = token.clone();
    let first_input = input.clone();
    let pending = tokio::spawn(async move {
        request(
            &copied,
            &first_token,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(first_input),
        )
        .await
    });
    wait_for_lock(&pool, "INSERT INTO audit_events").await;
    let blocked_key = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        request(
            &app,
            &other_token,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(same_key),
        ),
    )
    .await;
    let blocked_code = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        request(
            &app,
            &other_token,
            Method::POST,
            "/api/v2/admin/org-units",
            Some(same_code),
        ),
    )
    .await;
    sqlx::query("SELECT pg_advisory_unlock(17002722)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let original = pending.await.unwrap();
    assert_eq!(original.0, StatusCode::OK);
    for result in [blocked_key, blocked_code] {
        let (s, b) =
            result.expect("canonical UUID and code gates never wait for the first command commit");
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(b["error"]["code"], "organization_unit_busy");
    }
    let after = effects(&app).await;
    for i in 0..3 {
        assert_eq!(after[i].as_i64().unwrap() - before[i].as_i64().unwrap(), 1);
    }
    let (s, replay) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/admin/org-units",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(replay["data"], original.1["data"]);
    assert_eq!(effects(&app).await, after);
}

#[path = "organization_lifecycle_contract/input.rs"]
mod input;
