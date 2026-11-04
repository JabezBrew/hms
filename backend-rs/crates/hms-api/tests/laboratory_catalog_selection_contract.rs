//! PROPOSAL ONLY. Real authenticated router calls; never log patient or request bodies.
mod support;
use support::*;
struct Fixture {
    app: TestApp,
    token: String,
    patient: Uuid,
    test: Uuid,
    partial: Uuid,
    foreign_panel: Uuid,
    foreign_member: Uuid,
    valid: Uuid,
}
async fn fixture() -> Fixture {
    let database = Arc::new(
        hms_db::test_support::TestDatabase::create().expect("isolated Docker database creates"),
    );
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("test database connects");
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| {
                    m.version <= hms_db::schema_compatibility::INVENTORY_SUPPLIERS_BREAKING_EPOCH
                })
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical
        .run(&pool)
        .await
        .expect("accepted032 schema initializes");
    let baseline = hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    hms_db::provision::provision_baseline(&pool, &baseline)
        .await
        .expect("accepted032 synthetic baseline initializes");
    let patient: Uuid = sqlx::query_scalar(
        "SELECT id FROM patients WHERE facility_id=$1 ORDER BY created_at,id LIMIT 1",
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("synthetic patient identity exists");
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'S27_HTTP_FOREIGN','Synthetic foreign facility','hospital')").bind(foreign).execute(&pool).await.expect("foreign fixture facility creates");
    let test = Uuid::new_v4();
    let inactive = Uuid::new_v4();
    let foreign_test = Uuid::new_v4();
    for (id, facility, code, active) in [
        (test, baseline.facility_id, "S27_HTTP_VALID", true),
        (inactive, baseline.facility_id, "S27_HTTP_OFF", false),
        (foreign_test, foreign, "S27_HTTP_FOREIGN_TEST", true),
    ] {
        sqlx::query("INSERT INTO lab_tests(id,facility_id,code,name,specimen_type,is_active)VALUES($1,$2,$3,'Synthetic HTTP catalog test','blood',$4)").bind(id).bind(facility).bind(code).bind(active).execute(&pool).await.expect("honest032 test records");
    }
    let partial = Uuid::new_v4();
    let foreign_panel = Uuid::new_v4();
    let foreign_member = Uuid::new_v4();
    let valid = Uuid::new_v4();
    for (id, facility, code, members) in [
        (
            partial,
            baseline.facility_id,
            "S27_HTTP_PARTIAL",
            vec![test, inactive],
        ),
        (
            foreign_panel,
            foreign,
            "S27_HTTP_FOREIGN_PANEL",
            vec![foreign_test],
        ),
        (
            foreign_member,
            baseline.facility_id,
            "S27_HTTP_FOREIGN_MEMBER",
            vec![test, foreign_test],
        ),
        (
            valid,
            baseline.facility_id,
            "S27_HTTP_VALID_PANEL",
            vec![test],
        ),
    ] {
        sqlx::query("INSERT INTO lab_panels(id,facility_id,code,name)VALUES($1,$2,$3,'Synthetic HTTP catalog panel')").bind(id).bind(facility).bind(code).execute(&pool).await.expect("honest032 panel records");
        for member in members {
            sqlx::query("INSERT INTO lab_panel_tests(panel_id,test_id)VALUES($1,$2)")
                .bind(id)
                .bind(member)
                .execute(&pool)
                .await
                .expect("historical membership records without later guard bypass");
        }
    }
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.auto_migrate = true;
    config.provision_baseline = false;
    // AppState migrates the honest imported032 fixture. Baseline is deliberately
    // separate so its existing rewrite bug cannot reactivate the negative control.
    let app = app_with_config(config, database).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    Fixture {
        app,
        token,
        patient,
        test,
        partial,
        foreign_panel,
        foreign_member,
        valid,
    }
}
async fn post(f: &Fixture, tests: Vec<Uuid>, panels: Vec<Uuid>) -> StatusCode {
    let response=f.app.clone().oneshot(Request::builder().method(Method::POST).uri("/api/v2/laboratory/orders").extension(axum::extract::ConnectInfo(std::net::SocketAddr::from(([127,0,0,1],46127)))).header(AUTHORIZATION,format!("Bearer {}",f.token)).header("content-type","application/json").body(Body::from(json!({"patient_id":f.patient,"test_ids":tests,"panel_ids":panels,"priority":"routine"}).to_string())).expect("public request builds")).await.expect("public router responds");
    let status = response.status();
    drop(response);
    status
}
async fn counts(f: &Fixture) -> (i64, i64) {
    sqlx::query_as("SELECT(SELECT count(*) FROM lab_orders WHERE facility_id=$1),(SELECT count(*) FROM lab_order_tests t JOIN lab_orders o ON o.id=t.order_id WHERE o.facility_id=$1)").bind(f.app.state().facility_id()).fetch_one(&f.app.db_pool().await).await.expect("only publication counts leave database")
}
async fn reject_without_subset(f: &Fixture, tests: Vec<Uuid>, panels: Vec<Uuid>) {
    assert_eq!(
        post(f, vec![f.test], vec![]).await,
        StatusCode::OK,
        "same real actor/patient/scope has ordinary ordering capability"
    );
    let before = counts(f).await;
    let status = post(f, tests, panels).await;
    let after = counts(f).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "existing unavailable-source order contract refuses the complete request"
    );
    assert_eq!(before, after, "no partial order or links publish");
}
#[tokio::test]
async fn public_order_refuses_partly_unavailable_panel_without_a_partial_order() {
    let f = fixture().await;
    reject_without_subset(&f, vec![], vec![f.partial]).await;
}
#[tokio::test]
async fn public_order_refuses_unknown_panel_beside_a_valid_direct_test() {
    let f = fixture().await;
    reject_without_subset(&f, vec![f.test], vec![Uuid::new_v4()]).await;
}
#[tokio::test]
async fn public_order_refuses_foreign_panel_beside_a_valid_direct_test() {
    let f = fixture().await;
    reject_without_subset(&f, vec![f.test], vec![f.foreign_panel]).await;
}
#[tokio::test]
async fn public_order_refuses_foreign_test_member_in_a_local_panel() {
    let f = fixture().await;
    reject_without_subset(&f, vec![], vec![f.foreign_member]).await;
}
#[tokio::test]
async fn public_order_preserves_valid_overlapping_direct_and_panel_union_once() {
    let f = fixture().await;
    let before = counts(&f).await;
    assert_eq!(post(&f, vec![f.test], vec![f.valid]).await, StatusCode::OK);
    let after = counts(&f).await;
    assert_eq!(after, (before.0 + 1, before.1 + 1));
}
