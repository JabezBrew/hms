//! Exercise actual raw seed publishers with guards enabled.
use hms_db::{
    provision::{self, BaselineProvisioning, PerformanceSeedConfig},
    test_support::TestDatabase,
    PgPool,
};
use hms_domain::deployment::DeploymentProfile;
use uuid::Uuid;
async fn setup() -> (TestDatabase, PgPool, BaselineProvisioning) {
    let d = TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    let b = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision::provision_baseline(&p, &b).await.unwrap();
    (d, p, b)
}
async fn disable(p: &PgPool, id: Uuid) {
    let observed: i64 = sqlx::query_scalar("SELECT version FROM lab_tests WHERE id=$1")
        .bind(id)
        .fetch_one(p)
        .await
        .unwrap();
    let changed=sqlx::query("WITH point AS MATERIALIZED(SELECT clock_timestamp() at) UPDATE lab_tests SET is_active=false,version=version+1,updated_at=point.at,catalog_changed_at=point.at,catalog_changed_by_user_id=NULL FROM point WHERE id=$1 AND version=$2 AND is_active").bind(id).bind(observed).execute(p).await.unwrap();
    assert_eq!(changed.rows_affected(), 1);
}
fn config() -> PerformanceSeedConfig {
    PerformanceSeedConfig {
        patient_count: 2,
        chronicled_patient_count: 0,
        notes_per_chronicle_patient: 0,
        lab_order_count: 3,
        inventory_item_count: 0,
        admission_count: 0,
        invoice_count: 0,
    }
}
async fn performance_digest(p: &PgPool) -> String {
    // Bodies remain in PostgreSQL; only the aggregate synthetic digest leaves it.
    sqlx::query_scalar("SELECT encode(sha256(convert_to(jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM lab_orders o WHERE id::text LIKE '71000000-%'),'links',(SELECT jsonb_agg(to_jsonb(l) ORDER BY order_id,test_id) FROM lab_order_tests l WHERE order_id::text LIKE '71000000-%'),'specimens',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM lab_specimens s WHERE id::text LIKE '72000000-%'),'results',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM lab_results r WHERE id::text LIKE '73000000-%'),'seed_audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE resource_type IN('performance_seed','laboratory_seed')))::text,'UTF8')),'hex')").fetch_one(p).await.unwrap()
}
#[tokio::test]
async fn lab33_performance_completed_original_precedes_later_source_eligibility() {
    let (_d, p, b) = setup().await;
    provision::provision_performance_seed(&p, &b, config())
        .await
        .unwrap();
    let original:serde_json::Value=sqlx::query_scalar("SELECT metadata FROM audit_events WHERE resource_type='performance_seed' AND resource_id=$1 AND event_type='performance.seed.provisioned'").bind(b.facility_id).fetch_one(&p).await.unwrap();
    assert_eq!(original.as_object().unwrap().len(), 8);
    assert_eq!(original["lab_order_count"], 3);
    disable(&p, Uuid::from_u128(provision::DEFAULT_LAB_TEST_FBC_ID)).await;
    let before = performance_digest(&p).await;
    provision::provision_performance_seed(&p, &b, config())
        .await
        .unwrap();
    assert_eq!(before, performance_digest(&p).await);
    let after:serde_json::Value=sqlx::query_scalar("SELECT metadata FROM audit_events WHERE resource_type='performance_seed' AND resource_id=$1 AND event_type='performance.seed.provisioned'").bind(b.facility_id).fetch_one(&p).await.unwrap();
    assert!(
        original == after,
        "same original receipt/request shape, no eligibility fields added"
    );
}
#[tokio::test]
async fn lab33_performance_unavailable_default_skips_whole_new_lab_graph_and_records_count() {
    let (_d, p, b) = setup().await;
    disable(&p, Uuid::from_u128(provision::DEFAULT_LAB_TEST_FBC_ID)).await;
    provision::provision_performance_seed(&p, &b, config())
        .await
        .unwrap();
    let counts:(i64,i64,i64,i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM lab_orders WHERE id::text LIKE '71000000-%'),(SELECT count(*) FROM lab_order_tests WHERE order_id::text LIKE '71000000-%'),(SELECT count(*) FROM lab_specimens WHERE id::text LIKE '72000000-%'),(SELECT count(*) FROM lab_results WHERE id::text LIKE '73000000-%'),(SELECT sum((metadata->>'skipped_journey_count')::bigint)::bigint FROM audit_events WHERE event_type='laboratory.seed.skipped')").fetch_one(&p).await.unwrap();
    assert_eq!(counts, (0, 0, 0, 0, 3));
    let before = performance_digest(&p).await;
    provision::provision_performance_seed(&p, &b, config())
        .await
        .unwrap();
    assert_eq!(
        before,
        performance_digest(&p).await,
        "completed skipped seed is immutable, no duplicate skip counter"
    );
}
#[tokio::test]
async fn lab33_demo_all_unavailable_sources_skip_optional_labs_without_partial_graphs() {
    let (_d, p, b) = setup().await;
    sqlx::query("WITH point AS MATERIALIZED(SELECT clock_timestamp() at) UPDATE lab_tests SET is_active=false,version=version+1,updated_at=point.at,catalog_changed_at=point.at,catalog_changed_by_user_id=NULL FROM point WHERE facility_id=$1 AND is_active").bind(b.facility_id).execute(&p).await.unwrap();
    provision::provision_demo_seed(&p, &b, provision::DemoSeedProfile::Smoke)
        .await
        .unwrap();
    let counts:(i64,i64,i64,i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM lab_orders),(SELECT count(*) FROM lab_order_tests),(SELECT count(*) FROM lab_specimens),(SELECT count(*) FROM lab_results),(SELECT count(*) FROM audit_events WHERE event_type='laboratory.seed.skipped' AND (metadata->>'skipped_journey_count')::int=1)").fetch_one(&p).await.unwrap();
    assert_eq!((counts.0, counts.1, counts.2, counts.3), (0, 0, 0, 0));
    assert!(counts.4 > 0, "optional whole-journey skip is explicit");
}

#[tokio::test]
async fn lab33_demo_reseed_refuses_retained_lab_evidence_before_graph_deletion() {
    let (_d, p, b) = setup().await;
    let patient = Uuid::new_v4();
    sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) VALUES($1,$2,'DEMO-999999','Synthetic','Seed witness',DATE '2000-01-01','unknown','active')").bind(patient).bind(b.facility_id).execute(&p).await.unwrap();
    let test = Uuid::from_u128(provision::DEFAULT_LAB_TEST_FBC_ID);
    let order = hms_db::laboratory::create_order(
        &p,
        hms_db::laboratory::NewLabOrder {
            id: Uuid::new_v4(),
            facility_id: b.facility_id,
            patient_id: patient,
            encounter_id: None,
            visit_id: None,
            test_ids: vec![test],
            panel_ids: vec![],
            priority: hms_domain::laboratory::LabPriority::Routine,
            actor_user_id: Uuid::from_u128(provision::OWNER_USER_ID),
        },
    )
    .await
    .unwrap();
    let before:String=sqlx::query_scalar("SELECT encode(sha256(convert_to(jsonb_build_object('patient',(SELECT to_jsonb(p) FROM patients p WHERE id=$1),'order',(SELECT to_jsonb(o) FROM lab_orders o WHERE id=$2),'links',(SELECT jsonb_agg(to_jsonb(l) ORDER BY test_id) FROM lab_order_tests l WHERE order_id=$2))::text,'UTF8')),'hex')").bind(patient).bind(order.id).fetch_one(&p).await.unwrap();
    let refused = provision::provision_demo_seed(&p, &b, provision::DemoSeedProfile::Smoke)
        .await
        .unwrap_err();
    assert_eq!(refused.to_string(), "demo_seed_existing_clinical_evidence");
    let after:String=sqlx::query_scalar("SELECT encode(sha256(convert_to(jsonb_build_object('patient',(SELECT to_jsonb(p) FROM patients p WHERE id=$1),'order',(SELECT to_jsonb(o) FROM lab_orders o WHERE id=$2),'links',(SELECT jsonb_agg(to_jsonb(l) ORDER BY test_id) FROM lab_order_tests l WHERE order_id=$2))::text,'UTF8')),'hex')").bind(patient).bind(order.id).fetch_one(&p).await.unwrap();
    assert_eq!(
        before, after,
        "accepted synthetic lab evidence survives refused reseeding"
    );
}
