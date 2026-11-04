//! PROPOSAL ONLY: genuine repository calls, honest pre-availability catalog state.
//! No patient bodies, names, MRNs, URLs or request bodies enter assertions/logs.
use hms_db::{
    laboratory::{self, NewLabOrder},
    provision,
    test_support::TestDb,
    PgPool,
};
use hms_domain::{deployment::DeploymentProfile, laboratory::LabPriority};
use serde_json::Value;
use uuid::Uuid;

fn through_accepted32() -> sqlx::migrate::Migrator {
    sqlx::migrate::Migrator {
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
    }
}
struct Fixture {
    database: TestDb,
    patient: Uuid,
    actor: Uuid,
    local_a: Uuid,
    local_b: Uuid,
    local_c: Uuid,
    inactive_test: Uuid,
    foreign_test: Uuid,
    valid_panel: Uuid,
    overlap_panel: Uuid,
    partial_panel: Uuid,
    foreign_panel: Uuid,
    foreign_member_panel: Uuid,
    empty_panel: Uuid,
    inactive_panel: Uuid,
}
impl Fixture {
    fn pool(&self) -> &PgPool {
        self.database.pool()
    }
    fn facility(&self) -> Uuid {
        self.database.facility_id()
    }
    fn order(&self, tests: Vec<Uuid>, panels: Vec<Uuid>) -> NewLabOrder {
        NewLabOrder {
            id: Uuid::new_v4(),
            facility_id: self.facility(),
            patient_id: self.patient,
            encounter_id: None,
            visit_id: None,
            test_ids: tests,
            panel_ids: panels,
            priority: LabPriority::Routine,
            actor_user_id: self.actor,
        }
    }
}
async fn historical_database() -> TestDb {
    TestDb::with_profile_and_migrator(DeploymentProfile::Hospital, &through_accepted32())
        .await
        .expect("isolated accepted032 catalog fixture creates")
}
async fn fixture() -> Fixture {
    let database = historical_database().await;
    let pool = database.pool();
    let facility = database.facility_id();
    let patient: Uuid = sqlx::query_scalar(
        "SELECT id FROM patients WHERE facility_id=$1 ORDER BY created_at,id LIMIT 1",
    )
    .bind(facility)
    .fetch_one(pool)
    .await
    .expect("synthetic local patient identity exists");
    let actor = Uuid::from_u128(provision::OWNER_USER_ID);
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'S27_FOREIGN','Synthetic foreign facility','hospital')").bind(foreign).execute(pool).await.expect("synthetic foreign facility creates");
    let local_a = Uuid::new_v4();
    let local_b = Uuid::new_v4();
    let local_c = Uuid::new_v4();
    let inactive_test = Uuid::new_v4();
    let foreign_test = Uuid::new_v4();
    for (id, owner, code, active) in [
        (local_a, facility, "S27_LOCAL_A", true),
        (local_b, facility, "S27_LOCAL_B", true),
        (local_c, facility, "S27_LOCAL_C", true),
        (inactive_test, facility, "S27_INACTIVE", false),
        (foreign_test, foreign, "S27_FOREIGN_TEST", true),
    ] {
        sqlx::query("INSERT INTO lab_tests(id,facility_id,code,name,specimen_type,result_unit,is_active) VALUES($1,$2,$3,'Synthetic catalog test','blood','synthetic-unit',$4)").bind(id).bind(owner).bind(code).bind(active).execute(pool).await.expect("synthetic accepted032 test creates");
    }
    let valid_panel = Uuid::new_v4();
    let overlap_panel = Uuid::new_v4();
    let partial_panel = Uuid::new_v4();
    let foreign_panel = Uuid::new_v4();
    let foreign_member_panel = Uuid::new_v4();
    let empty_panel = Uuid::new_v4();
    let inactive_panel = Uuid::new_v4();
    for (id, owner, code, active, members) in [
        (
            valid_panel,
            facility,
            "S27_VALID",
            true,
            vec![local_a, local_b],
        ),
        (
            overlap_panel,
            facility,
            "S27_OVERLAP",
            true,
            vec![local_b, local_c],
        ),
        (
            partial_panel,
            facility,
            "S27_PARTIAL",
            true,
            vec![local_a, inactive_test],
        ),
        (
            foreign_panel,
            foreign,
            "S27_FOREIGN_PANEL",
            true,
            vec![foreign_test],
        ),
        (
            foreign_member_panel,
            facility,
            "S27_FOREIGN_MEMBER",
            true,
            vec![local_a, foreign_test],
        ),
        (empty_panel, facility, "S27_EMPTY", true, vec![]),
        (
            inactive_panel,
            facility,
            "S27_INACTIVE_PANEL",
            false,
            vec![local_a],
        ),
    ] {
        sqlx::query("INSERT INTO lab_panels(id,facility_id,code,name,is_active) VALUES($1,$2,$3,'Synthetic catalog panel',$4)").bind(id).bind(owner).bind(code).bind(active).execute(pool).await.expect("synthetic accepted032 panel creates");
        for member in members {
            // Honest032 permitted this foreign membership. Never weaken later guards.
            sqlx::query("INSERT INTO lab_panel_tests(panel_id,test_id) VALUES($1,$2)")
                .bind(id)
                .bind(member)
                .execute(pool)
                .await
                .expect("historical membership records");
        }
    }
    let imported = (
        legacy_catalog_snapshot(pool, facility).await,
        legacy_catalog_snapshot(pool, foreign).await,
    );
    hms_db::migrate::run(pool)
        .await
        .expect("current migration preserves readable historical evidence");
    assert!(
        imported
            == (
                legacy_catalog_snapshot(pool, facility).await,
                legacy_catalog_snapshot(pool, foreign).await
            ),
        "migration preserves imported local/foreign definitions, availability and exact membership"
    );
    Fixture {
        database,
        patient,
        actor,
        local_a,
        local_b,
        local_c,
        inactive_test,
        foreign_test,
        valid_panel,
        overlap_panel,
        partial_panel,
        foreign_panel,
        foreign_member_panel,
        empty_panel,
        inactive_panel,
    }
}
async fn rejected_without_publication(f: &Fixture, tests: Vec<Uuid>, panels: Vec<Uuid>) {
    let order = f.order(tests, panels);
    let id = order.id;
    let result = laboratory::create_order(f.pool(), order).await;
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM lab_orders WHERE id=$1),(SELECT count(*) FROM lab_order_tests WHERE order_id=$1),(SELECT count(*) FROM lab_order_tests ot JOIN lab_orders o ON o.id=ot.order_id JOIN lab_tests t ON t.id=ot.test_id WHERE ot.order_id=$1 AND t.facility_id<>o.facility_id)").bind(id).fetch_one(f.pool()).await.expect("publication counts load without clinical bodies");
    assert!(result.is_err() && counts==(0,0,0),"invalid selection must refuse the whole order; persisted order/link/foreign-link counts only: {counts:?}");
}
#[tokio::test]
async fn laboratory_panel_with_one_unavailable_member_cannot_publish_a_subset() {
    let f = fixture().await;
    rejected_without_publication(&f, vec![], vec![f.partial_panel]).await;
}
#[tokio::test]
async fn laboratory_unknown_panel_cannot_disappear_beside_valid_direct_test() {
    let f = fixture().await;
    rejected_without_publication(&f, vec![f.local_a], vec![Uuid::new_v4()]).await;
}
#[tokio::test]
async fn laboratory_foreign_panel_cannot_disappear_beside_valid_direct_test() {
    let f = fixture().await;
    rejected_without_publication(&f, vec![f.local_a], vec![f.foreign_panel]).await;
}
#[tokio::test]
async fn laboratory_local_panel_cannot_publish_a_foreign_test_member() {
    let f = fixture().await;
    rejected_without_publication(&f, vec![], vec![f.foreign_member_panel]).await;
}
#[tokio::test]
async fn laboratory_empty_panel_cannot_disappear_beside_valid_direct_test() {
    let f = fixture().await;
    rejected_without_publication(&f, vec![f.local_a], vec![f.empty_panel]).await;
}
#[tokio::test]
async fn laboratory_inactive_panel_cannot_disappear_beside_valid_direct_test() {
    let f = fixture().await;
    rejected_without_publication(&f, vec![f.local_a], vec![f.inactive_panel]).await;
}
#[tokio::test]
async fn laboratory_direct_unknown_foreign_and_inactive_sources_remain_fail_closed() {
    let f = fixture().await;
    for source in [Uuid::new_v4(), f.foreign_test, f.inactive_test] {
        rejected_without_publication(&f, vec![f.local_a, source], vec![]).await;
    }
}
#[tokio::test]
async fn laboratory_valid_overlapping_direct_and_panel_selection_publishes_exact_union_once() {
    let f = fixture().await;
    let order = f.order(
        vec![f.local_a, f.local_b],
        vec![f.valid_panel, f.overlap_panel],
    );
    let id = order.id;
    let result = laboratory::create_order(f.pool(), order).await;
    assert!(result.is_ok(), "fully valid production selection creates");
    let actual: Vec<Uuid> = sqlx::query_scalar(
        "SELECT test_id FROM lab_order_tests WHERE order_id=$1 ORDER BY test_id",
    )
    .bind(id)
    .fetch_all(f.pool())
    .await
    .expect("accepted link identities load");
    let mut expected = vec![f.local_a, f.local_b, f.local_c];
    expected.sort_unstable();
    assert!(
        actual == expected,
        "overlapping valid sources preserve exactly their union without duplicate links"
    );
}
async fn catalog_snapshot(pool: &PgPool, facility: Uuid) -> Value {
    // Only hashes leave PostgreSQL; snapshots cannot log test metadata or clinical rows.
    sqlx::query_scalar("SELECT jsonb_build_object('tests',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex') FROM lab_tests t WHERE facility_id=$1),'panels',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'[]'),'UTF8')),'hex') FROM lab_panels p WHERE facility_id=$1),'membership',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.panel_id,m.test_id)::text,'[]'),'UTF8')),'hex') FROM lab_panel_tests m JOIN lab_panels p ON p.id=m.panel_id WHERE p.facility_id=$1))").bind(facility).fetch_one(pool).await.expect("catalog hashes load")
}
async fn legacy_catalog_snapshot(pool: &PgPool, facility: Uuid) -> Value {
    // Explicit032 fields allow truthful new nullable/version columns to be added,
    // while detecting any rewrite of actual imported definitions or membership.
    sqlx::query_scalar("SELECT jsonb_build_object('tests',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(t.id,t.facility_id,t.code,t.name,t.specimen_type,t.result_unit,t.is_active,t.category,t.is_system_default,t.is_facility_modified,t.created_at,t.updated_at) ORDER BY t.id)::text,'[]'),'UTF8')),'hex') FROM lab_tests t WHERE t.facility_id=$1),'panels',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(p.id,p.facility_id,p.code,p.name,p.is_active,p.is_system_default,p.is_facility_modified,p.created_at,p.updated_at) ORDER BY p.id)::text,'[]'),'UTF8')),'hex') FROM lab_panels p WHERE p.facility_id=$1),'membership',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(m.panel_id,m.test_id) ORDER BY m.panel_id,m.test_id)::text,'[]'),'UTF8')),'hex') FROM lab_panel_tests m JOIN lab_panels p ON p.id=m.panel_id WHERE p.facility_id=$1))").bind(facility).fetch_one(pool).await.expect("only imported catalog hashes leave database")
}
async fn baseline_must_preserve(database: &TestDb) {
    let pool = database.pool();
    let imported = legacy_catalog_snapshot(pool, database.facility_id()).await;
    hms_db::migrate::run(pool)
        .await
        .expect("new schema migrates without rewriting imported definitions");
    assert!(imported==legacy_catalog_snapshot(pool,database.facility_id()).await,"migration preserves every preexisting definition/flag/membership observation before baseline runs");
    let before = catalog_snapshot(pool, database.facility_id()).await;
    for _ in 0..2 {
        let result = provision::provision_baseline(
            pool,
            &provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
        )
        .await;
        assert!(result.is_ok(),"repeated missing-only baseline succeeds without adopting or rekeying configured definitions");
        assert!(
            before == catalog_snapshot(pool, database.facility_id()).await,
            "baseline preserves every configured test/panel observation and exact membership hash"
        );
    }
}
#[tokio::test]
async fn laboratory_baseline_preserves_configured_retired_test_definition_and_flags() {
    let database = historical_database().await;
    sqlx::query("UPDATE lab_tests SET name='Synthetic retained definition',specimen_type='plasma',result_unit='retained-unit',category='retained-category',is_active=false,is_system_default=false,is_facility_modified=true,updated_at=TIMESTAMPTZ '2000-01-01' WHERE id=$1").bind(Uuid::from_u128(provision::DEFAULT_LAB_TEST_FBC_ID)).execute(database.pool()).await.expect("honest032 test configuration records");
    baseline_must_preserve(&database).await;
}
#[tokio::test]
async fn laboratory_baseline_preserves_configured_retired_panel_and_custom_membership() {
    let database = historical_database().await;
    let panel = Uuid::from_u128(provision::DEFAULT_LAB_PANEL_BASIC_ID);
    sqlx::query("UPDATE lab_panels SET name='Synthetic retained panel',is_active=false,is_system_default=false,is_facility_modified=true,updated_at=TIMESTAMPTZ '2000-01-01' WHERE id=$1").bind(panel).execute(database.pool()).await.expect("honest032 panel configuration records");
    sqlx::query("DELETE FROM lab_panel_tests WHERE panel_id=$1")
        .bind(panel)
        .execute(database.pool())
        .await
        .expect("historical configured composition records");
    sqlx::query("INSERT INTO lab_panel_tests(panel_id,test_id) VALUES($1,$2)")
        .bind(panel)
        .bind(Uuid::from_u128(provision::DEFAULT_LAB_TEST_FBC_ID))
        .execute(database.pool())
        .await
        .expect("one deliberately retained member records");
    baseline_must_preserve(&database).await;
}
#[tokio::test]
async fn laboratory_baseline_does_not_fill_an_existing_intentionally_empty_panel() {
    let database = historical_database().await;
    let panel = Uuid::from_u128(provision::DEFAULT_LAB_PANEL_BASIC_ID);
    sqlx::query("DELETE FROM lab_panel_tests WHERE panel_id=$1")
        .bind(panel)
        .execute(database.pool())
        .await
        .expect("honest032 empty composition records");
    baseline_must_preserve(&database).await;
}
#[tokio::test]
async fn laboratory_baseline_preserves_permanent_canonical_id_after_legacy_code_changes() {
    let database = historical_database().await;
    sqlx::query("UPDATE lab_tests SET code='S27_RETAINED_FBC' WHERE id=$1")
        .bind(Uuid::from_u128(provision::DEFAULT_LAB_TEST_FBC_ID))
        .execute(database.pool())
        .await
        .expect("honest032 configured test code records");
    sqlx::query("UPDATE lab_panels SET code='S27_RETAINED_BASIC' WHERE id=$1")
        .bind(Uuid::from_u128(provision::DEFAULT_LAB_PANEL_BASIC_ID))
        .execute(database.pool())
        .await
        .expect("honest032 configured panel code records");
    baseline_must_preserve(&database).await;
}
