mod support;
use support::*;

struct Fixture {
    app: TestApp,
    actor: Actor,
    pool: hms_db::PgPool,
    local: Uuid,
    foreign: Uuid,
    inactive: Uuid,
    template: Uuid,
    legacy_positions: Vec<Uuid>,
    legacy_child: Uuid,
}
async fn fixture() -> Fixture {
    // Invalid legacy references are honestly created before the new publication
    // guard exists, then migrated intact and exercised through current HTTP.
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
    let foreign = Uuid::new_v4();
    let inactive = Uuid::new_v4();
    let template = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'REF-FOREIGN','Synthetic reference facility','hospital')").bind(foreign_facility).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO organization_units(id,facility_id,code,name,unit_type) VALUES($1,$2,'REF-FOREIGN','FOREIGN-REFERENCE-NAME','department')").bind(foreign).bind(foreign_facility).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO organization_units(id,facility_id,code,name,unit_type,is_active) VALUES($1,$2,'REF-INACTIVE','Synthetic closed unit','department',false)").bind(inactive).bind(facility).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO position_templates(id,facility_id,code,title,description) VALUES($1,$2,'REF-TEMPLATE','Synthetic foreign role','Synthetic fixture')").bind(template).bind(foreign_facility).execute(&pool).await.unwrap();
    let local = sqlx::query_scalar(
        "SELECT id FROM organization_units WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut legacy_positions = vec![];
    for (index, (org, source_template)) in
        [(foreign, None), (inactive, None), (local, Some(template))]
            .into_iter()
            .enumerate()
    {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO positions(id,facility_id,org_unit_id,template_id,code,title,status) VALUES($1,$2,$3,$4,$5,'Synthetic invalid historical position','active')")
            .bind(id).bind(facility).bind(org).bind(source_template).bind(format!("REF-LEGACY-APPOINTMENT-{index}")).execute(&pool).await.unwrap();
        legacy_positions.push(id);
    }
    let legacy_child = Uuid::new_v4();
    sqlx::query("INSERT INTO organization_units(id,facility_id,parent_unit_id,code,name,unit_type) VALUES($1,$2,$3,'REF-LEGACY-CHILD','Synthetic legacy child','department')").bind(legacy_child).bind(facility).bind(foreign).execute(&pool).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let app = app_with_config(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await;
    let actor = Actor::login(&app, "owner@hms.local").await;
    Fixture {
        app,
        actor,
        pool,
        local,
        foreign,
        inactive,
        template,
        legacy_positions,
        legacy_child,
    }
}
#[tokio::test]
async fn organization_parent_must_be_active_and_local_before_creation() {
    let f = fixture().await;
    let mut statuses = vec![];
    for (index, parent) in [f.foreign, f.inactive].into_iter().enumerate() {
        let r=api_post_json(f.app.clone(),&f.actor,"/api/v2/admin/org-units",json!({"client_request_id":Uuid::new_v4(),"code":format!("REF-BAD-PARENT-{index}"),"name":"Synthetic child","unit_type":"department","parent_unit_id":parent})).await;
        statuses.push(r.status().as_u16());
    }
    let effects: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM organization_units WHERE code LIKE 'REF-BAD-PARENT-%'",
    )
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(statuses, vec![409, 409]);
    assert_eq!(effects, 0);
    assert_eq!(api_post_json(f.app.clone(),&f.actor,"/api/v2/admin/org-units",json!({"client_request_id":Uuid::new_v4(),"code":"REF-VALID-CHILD","name":"Synthetic valid child","unit_type":"department","parent_unit_id":f.local})).await.status(),StatusCode::OK);
}
#[tokio::test]
async fn position_organization_and_optional_template_must_belong_to_actual_facility() {
    let f = fixture().await;
    let mut statuses = vec![];
    for (index, (org, template)) in [
        (f.foreign, None),
        (f.inactive, None),
        (f.local, Some(f.template)),
    ]
    .into_iter()
    .enumerate()
    {
        let r=api_post_json(f.app.clone(),&f.actor,"/api/v2/admin/positions",json!({"code":format!("REF-BAD-POSITION-{index}"),"title":"Synthetic position","org_unit_id":org,"template_id":template})).await;
        statuses.push(r.status().as_u16());
    }
    let effects: i64 =
        sqlx::query_scalar("SELECT count(*) FROM positions WHERE code LIKE 'REF-BAD-POSITION-%'")
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(statuses, vec![409, 409, 409]);
    assert_eq!(effects, 0);
    assert_eq!(api_post_json(f.app.clone(),&f.actor,"/api/v2/admin/positions",json!({"code":"REF-VALID-POSITION","title":"Synthetic valid position","org_unit_id":f.local,"template_id":null})).await.status(),StatusCode::OK);
}
#[tokio::test]
async fn appointment_cannot_reuse_a_legacy_position_with_invalid_references() {
    let f = fixture().await;
    let facility = f.app.state().facility_id();
    let user: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND email='owner@hms.local'")
            .bind(facility)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    let ids = f.legacy_positions.clone();
    for id in &ids {
        let response = api_post_json(f.app.clone(), &f.actor, "/api/v2/admin/authority-appointments",
            json!({"position_id":id,"user_id":user,"appointment_type":"acting","starts_at":null,"ends_at":null})).await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
    let effects: i64 =
        sqlx::query_scalar("SELECT count(*) FROM authority_appointments WHERE position_id=ANY($1)")
            .bind(&ids)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(effects, 0);
}
#[tokio::test]
async fn legacy_invalid_reference_rows_cannot_project_foreign_organization_metadata() {
    let f = fixture().await;
    let child = f.legacy_child;
    let foreign_template_position = f.legacy_positions[2];
    let units = api_get(f.app.clone(), &f.actor, "/api/v2/admin/org-units?limit=100").await;
    assert_eq!(units.status(), StatusCode::OK);
    let units = json_body(units).await;
    let positions = api_get(f.app.clone(), &f.actor, "/api/v2/admin/positions?limit=100").await;
    assert_eq!(positions.status(), StatusCode::OK);
    let positions = json_body(positions).await;
    assert!(!units["data"].to_string().contains("FOREIGN-REFERENCE-NAME"));
    assert!(!positions["data"]
        .to_string()
        .contains("FOREIGN-REFERENCE-NAME"));
    let projected = units["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == child.to_string())
        .unwrap();
    assert!(projected["parent_unit_id"].is_null());
    let projected_position = positions["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == foreign_template_position.to_string())
        .unwrap();
    assert!(projected_position["template_id"].is_null());
    let retained: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM organization_units WHERE id=$1 AND parent_unit_id=$2",
    )
    .bind(child)
    .bind(f.foreign)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(retained, 1);
}
