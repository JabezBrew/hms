use hms_db::laboratory::{
    LabCatalogFilters, LabOrderListFilters, LabResultListFilters, NewLabOrder, NewLabResult,
    NewSpecimen,
};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::laboratory::{LabOrderStatus, LabPriority};

#[tokio::test]
async fn laboratory_repository_filters_orders_and_results_for_worklists() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");
    let patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("patient exists");
    let test_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM lab_tests WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("lab test exists");

    let chemistry_catalog = hms_db::laboratory::list_test_catalog_page(
        &pool,
        facility_id,
        None,
        25,
        LabCatalogFilters {
            category: Some("chemistry".to_owned()),
            is_active: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("catalog category filter loads");
    assert!(!chemistry_catalog.is_empty());
    assert!(chemistry_catalog
        .iter()
        .all(|test| test.category.as_deref() == Some("chemistry") && test.is_active));

    let searched_catalog = hms_db::laboratory::list_test_catalog_page(
        &pool,
        facility_id,
        None,
        25,
        LabCatalogFilters {
            search: Some("glucose".to_owned()),
            is_system_default: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("catalog search filter loads");
    assert!(searched_catalog
        .iter()
        .any(|test| test.name.to_lowercase().contains("glucose")));

    let pending_order = create_order(&pool, facility_id, patient_id, test_id, owner_id)
        .await
        .expect("pending order is created");
    let entered_order = create_order(&pool, facility_id, patient_id, test_id, owner_id)
        .await
        .expect("entered order is created");
    let verified_order = create_order(&pool, facility_id, patient_id, test_id, owner_id)
        .await
        .expect("verified order is created");

    let entered_result = create_result_for_order(
        &pool,
        facility_id,
        patient_id,
        test_id,
        entered_order.id,
        owner_id,
        "entered",
    )
    .await
    .expect("entered result is created");
    let verified_result = create_result_for_order(
        &pool,
        facility_id,
        patient_id,
        test_id,
        verified_order.id,
        owner_id,
        "verified",
    )
    .await
    .expect("verified result is created");
    hms_db::laboratory::verify_result(&pool, facility_id, verified_result.id, owner_id)
        .await
        .expect("result verification succeeds")
        .expect("verified result exists");

    let ordered = hms_db::laboratory::list_orders(
        &pool,
        facility_id,
        None,
        25,
        LabOrderListFilters {
            status: Some(LabOrderStatus::Ordered),
            ..Default::default()
        },
    )
    .await
    .expect("ordered worklist loads");
    assert!(ordered.iter().any(|order| order.id == pending_order.id));
    assert!(ordered
        .iter()
        .all(|order| matches!(order.status, LabOrderStatus::Ordered)));
    assert!(!ordered.iter().any(|order| order.id == entered_order.id));
    assert!(!ordered.iter().any(|order| order.id == verified_order.id));

    let result_entered = hms_db::laboratory::list_orders(
        &pool,
        facility_id,
        None,
        25,
        LabOrderListFilters {
            status: Some(LabOrderStatus::ResultEntered),
            ..Default::default()
        },
    )
    .await
    .expect("result-entered worklist loads");
    assert!(result_entered
        .iter()
        .any(|order| order.id == entered_order.id));
    let entered_worklist_order = result_entered
        .iter()
        .find(|order| order.id == entered_order.id)
        .expect("entered order is present");
    assert_eq!(entered_worklist_order.specimens.len(), 1);
    assert_eq!(
        entered_worklist_order.specimens[0].id,
        entered_result.specimen_id
    );
    assert_eq!(
        entered_worklist_order.specimens[0].order_id,
        entered_order.id
    );
    assert!(!result_entered
        .iter()
        .any(|order| order.id == pending_order.id));
    assert!(!result_entered
        .iter()
        .any(|order| order.id == verified_order.id));

    let provider_orders = hms_db::laboratory::list_orders(
        &pool,
        facility_id,
        None,
        25,
        LabOrderListFilters {
            priority: Some(LabPriority::Routine),
            ordering_provider: Some(owner_id),
            search: Some(pending_order.id.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("provider/search filtered worklist loads");
    assert!(provider_orders
        .iter()
        .any(|order| order.id == pending_order.id));

    sqlx::query("UPDATE lab_results SET is_critical = TRUE WHERE id = $1")
        .bind(entered_result.id)
        .execute(&pool)
        .await
        .expect("critical result flag updates");

    let unverified_results = hms_db::laboratory::list_results(
        &pool,
        facility_id,
        None,
        25,
        LabResultListFilters {
            is_verified: Some(false),
            ..Default::default()
        },
    )
    .await
    .expect("unverified result worklist loads");
    assert!(unverified_results
        .iter()
        .any(|result| result.id == entered_result.id));
    assert!(!unverified_results
        .iter()
        .any(|result| result.id == verified_result.id));

    let verified_results = hms_db::laboratory::list_results(
        &pool,
        facility_id,
        None,
        25,
        LabResultListFilters {
            is_verified: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("verified result worklist loads");
    assert!(verified_results
        .iter()
        .any(|result| result.id == verified_result.id));
    assert!(!verified_results
        .iter()
        .any(|result| result.id == entered_result.id));

    let critical_results = hms_db::laboratory::list_results(
        &pool,
        facility_id,
        None,
        25,
        LabResultListFilters {
            critical_only: true,
            search: Some(entered_result.order_id.to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("critical result worklist loads");
    assert!(critical_results
        .iter()
        .any(|result| result.id == entered_result.id && result.is_critical));
}

async fn create_order(
    pool: &hms_db::PgPool,
    facility_id: uuid::Uuid,
    patient_id: uuid::Uuid,
    test_id: uuid::Uuid,
    owner_id: uuid::Uuid,
) -> anyhow::Result<hms_domain::laboratory::LabOrderListItem> {
    hms_db::laboratory::create_order(
        pool,
        NewLabOrder {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            encounter_id: None,
            visit_id: None,
            test_ids: vec![test_id],
            panel_ids: Vec::new(),
            priority: LabPriority::Routine,
            actor_user_id: owner_id,
        },
    )
    .await
}

async fn create_result_for_order(
    pool: &hms_db::PgPool,
    facility_id: uuid::Uuid,
    patient_id: uuid::Uuid,
    test_id: uuid::Uuid,
    order_id: uuid::Uuid,
    owner_id: uuid::Uuid,
    value: &str,
) -> anyhow::Result<hms_domain::laboratory::LabResultListItem> {
    let specimen = hms_db::laboratory::create_specimen(
        pool,
        NewSpecimen {
            id: uuid::Uuid::new_v4(),
            facility_id,
            order_id,
            patient_id,
            specimen_type: "blood".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await?;

    hms_db::laboratory::create_result(
        pool,
        NewLabResult {
            id: uuid::Uuid::new_v4(),
            facility_id,
            specimen_id: specimen.id,
            order_id,
            patient_id,
            test_id,
            value: value.to_owned(),
            unit: None,
            actor_user_id: owner_id,
        },
    )
    .await
}

#[tokio::test]
async fn laboratory_verification_requires_all_tests_and_preserves_first_verifier() {
    let fixture = LaboratoryFixture::new("lab-verification").await;
    let order = fixture.order(&fixture.test_ids).await;
    let specimen = fixture.specimen(order.id).await;
    let first = hms_db::laboratory::create_result(
        fixture.pool(),
        fixture.result(order.id, specimen.id, fixture.test_ids[0]),
    )
    .await
    .expect("first result is entered");

    let verified = hms_db::laboratory::verify_result(
        fixture.pool(),
        fixture.facility_id(),
        first.id,
        fixture.owner_id(),
    )
    .await
    .expect("first verification succeeds")
    .expect("result exists");
    fixture
        .assert_status(order.id, LabOrderStatus::ResultEntered)
        .await;

    let other_actor = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND id <> $2 ORDER BY id LIMIT 1",
    )
    .bind(fixture.facility_id())
    .bind(fixture.owner_id())
    .fetch_one(fixture.pool())
    .await
    .expect("second test actor exists");
    let retried = hms_db::laboratory::verify_result(
        fixture.pool(),
        fixture.facility_id(),
        first.id,
        other_actor,
    )
    .await
    .expect("repeat verification succeeds")
    .expect("result exists");
    assert_eq!(retried.verified_at, verified.verified_at);
    let verifier = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT verified_by_user_id FROM lab_results WHERE id = $1",
    )
    .bind(first.id)
    .fetch_one(fixture.pool())
    .await
    .expect("original verifier loads");
    assert_eq!(verifier, fixture.owner_id());
    assert_eq!(
        hms_db::laboratory::verify_results(
            fixture.pool(),
            fixture.facility_id(),
            Some(order.id),
            &[],
            fixture.owner_id(),
        )
        .await
        .expect("bulk verification with a missing test succeeds"),
        0,
    );
    fixture
        .assert_status(order.id, LabOrderStatus::ResultEntered)
        .await;

    // Further specimen collection cannot downgrade an order with entered results.
    let second_specimen = fixture.specimen(order.id).await;
    fixture
        .assert_status(order.id, LabOrderStatus::ResultEntered)
        .await;
    let pending = hms_db::laboratory::create_results(
        fixture.pool(),
        fixture.facility_id(),
        order.id,
        vec![
            fixture.result(order.id, specimen.id, fixture.test_ids[1]),
            fixture.result(order.id, second_specimen.id, fixture.test_ids[0]),
        ],
    )
    .await
    .expect("remaining results are entered atomically");
    assert_eq!(pending[0].test_id, fixture.test_ids[1]);
    assert_eq!(pending[1].test_id, fixture.test_ids[0]);

    let verified_count = hms_db::laboratory::verify_results(
        fixture.pool(),
        fixture.facility_id(),
        None,
        &[pending[0].id],
        fixture.owner_id(),
    )
    .await
    .expect("subset verification succeeds");
    assert_eq!(verified_count, 1);
    // Every test has a verified result, but the second specimen still needs review.
    fixture
        .assert_status(order.id, LabOrderStatus::ResultEntered)
        .await;

    let verified_count = hms_db::laboratory::verify_results(
        fixture.pool(),
        fixture.facility_id(),
        Some(order.id),
        &[],
        fixture.owner_id(),
    )
    .await
    .expect("order verification succeeds");
    assert_eq!(verified_count, 1);
    fixture
        .assert_status(order.id, LabOrderStatus::Verified)
        .await;
    let repeat_count = hms_db::laboratory::verify_results(
        fixture.pool(),
        fixture.facility_id(),
        Some(order.id),
        &[],
        other_actor,
    )
    .await
    .expect("completed-order verification is idempotent");
    assert_eq!(repeat_count, 0);
    let retry = hms_db::laboratory::verify_result(
        fixture.pool(),
        fixture.facility_id(),
        first.id,
        other_actor,
    )
    .await
    .expect("completed single-result retry succeeds")
    .expect("result exists");
    assert_eq!(retry.verified_at, verified.verified_at);

    assert!(hms_db::laboratory::create_result(
        fixture.pool(),
        fixture.result(order.id, second_specimen.id, fixture.test_ids[1]),
    )
    .await
    .is_err());
    assert!(
        hms_db::laboratory::create_specimen(fixture.pool(), fixture.new_specimen(order.id),)
            .await
            .is_err()
    );
    fixture
        .assert_status(order.id, LabOrderStatus::Verified)
        .await;
}

#[tokio::test]
async fn laboratory_cancelled_orders_reject_clinical_writes_and_verification() {
    let fixture = LaboratoryFixture::new("lab-cancelled").await;
    let order = fixture.order(&fixture.test_ids).await;
    let specimen = fixture.specimen(order.id).await;
    let result = hms_db::laboratory::create_result(
        fixture.pool(),
        fixture.result(order.id, specimen.id, fixture.test_ids[0]),
    )
    .await
    .expect("result is entered");
    hms_db::laboratory::cancel_order(
        fixture.pool(),
        fixture.facility_id(),
        order.id,
        fixture.owner_id(),
        Some("Synthetic duplicate order".to_owned()),
    )
    .await
    .expect("pending order cancels")
    .expect("order exists");
    let original_cancellation = sqlx::query_as::<_, (String, chrono::DateTime<chrono::Utc>)>(
        "SELECT cancellation_reason, cancelled_at FROM lab_orders WHERE id = $1",
    )
    .bind(order.id)
    .fetch_one(fixture.pool())
    .await
    .expect("cancellation metadata loads");
    hms_db::laboratory::cancel_order(
        fixture.pool(),
        fixture.facility_id(),
        order.id,
        fixture.owner_id(),
        Some("Synthetic retry reason".to_owned()),
    )
    .await
    .expect("cancellation retry succeeds");
    let retried_cancellation = sqlx::query_as::<_, (String, chrono::DateTime<chrono::Utc>)>(
        "SELECT cancellation_reason, cancelled_at FROM lab_orders WHERE id = $1",
    )
    .bind(order.id)
    .fetch_one(fixture.pool())
    .await
    .expect("retry cancellation metadata loads");
    assert_eq!(original_cancellation, retried_cancellation);

    assert!(
        hms_db::laboratory::create_specimen(fixture.pool(), fixture.new_specimen(order.id),)
            .await
            .is_err()
    );
    assert!(hms_db::laboratory::receive_specimen(
        fixture.pool(),
        fixture.facility_id(),
        specimen.id,
    )
    .await
    .is_err());
    assert!(hms_db::laboratory::create_result(
        fixture.pool(),
        fixture.result(order.id, specimen.id, fixture.test_ids[1]),
    )
    .await
    .is_err());
    assert!(hms_db::laboratory::verify_result(
        fixture.pool(),
        fixture.facility_id(),
        result.id,
        fixture.owner_id(),
    )
    .await
    .is_err());
    for (order_id, result_ids) in [(Some(order.id), vec![]), (None, vec![result.id])] {
        assert!(hms_db::laboratory::verify_results(
            fixture.pool(),
            fixture.facility_id(),
            order_id,
            &result_ids,
            fixture.owner_id(),
        )
        .await
        .is_err());
    }
    assert!(
        hms_db::laboratory::collect_order(fixture.pool(), fixture.facility_id(), order.id)
            .await
            .is_err()
    );
    assert!(hms_db::laboratory::start_order_processing(
        fixture.pool(),
        fixture.facility_id(),
        order.id,
    )
    .await
    .is_err());
    let active_order = fixture.order(&fixture.test_ids).await;
    let active_specimen = fixture.specimen(active_order.id).await;
    let active_result = hms_db::laboratory::create_result(
        fixture.pool(),
        fixture.result(active_order.id, active_specimen.id, fixture.test_ids[0]),
    )
    .await
    .expect("another active result is entered");
    assert!(hms_db::laboratory::verify_results(
        fixture.pool(),
        fixture.facility_id(),
        None,
        &[active_result.id, result.id],
        fixture.owner_id(),
    )
    .await
    .is_err());
    let still_pending = hms_db::laboratory::get_result_by_id(
        fixture.pool(),
        fixture.facility_id(),
        active_result.id,
    )
    .await
    .expect("active result loads")
    .expect("active result exists");
    assert!(still_pending.verified_at.is_none());

    let untouched =
        hms_db::laboratory::get_result_by_id(fixture.pool(), fixture.facility_id(), result.id)
            .await
            .expect("result loads")
            .expect("result exists");
    assert!(untouched.verified_at.is_none());
    fixture
        .assert_status(order.id, LabOrderStatus::Cancelled)
        .await;
}

#[tokio::test]
async fn laboratory_result_batches_enforce_order_specimen_scope_and_rollback() {
    let fixture = LaboratoryFixture::new("lab-atomic-scope").await;
    let order = fixture.order(&fixture.test_ids).await;
    let specimen = fixture.specimen(order.id).await;
    let unrelated = fixture.order(&fixture.test_ids).await;
    let unrelated_specimen = fixture.specimen(unrelated.id).await;
    let valid = fixture.result(order.id, specimen.id, fixture.test_ids[0]);
    let valid_id = valid.id;
    let invalid = fixture.result(order.id, unrelated_specimen.id, fixture.test_ids[1]);
    assert!(hms_db::laboratory::create_results(
        fixture.pool(),
        fixture.facility_id(),
        order.id,
        vec![valid, invalid],
    )
    .await
    .is_err());
    assert!(
        hms_db::laboratory::get_result_by_id(fixture.pool(), fixture.facility_id(), valid_id)
            .await
            .expect("result query succeeds")
            .is_none()
    );
    fixture
        .assert_status(order.id, LabOrderStatus::SpecimenCollected)
        .await;

    let mut mismatched = fixture.result(order.id, specimen.id, fixture.test_ids[0]);
    mismatched.order_id = unrelated.id;
    assert!(hms_db::laboratory::create_results(
        fixture.pool(),
        fixture.facility_id(),
        order.id,
        vec![mismatched],
    )
    .await
    .is_err());
    let mut mismatched = fixture.new_specimen(order.id);
    mismatched.patient_id = uuid::Uuid::new_v4();
    assert!(
        hms_db::laboratory::create_specimen(fixture.pool(), mismatched)
            .await
            .is_err()
    );

    sqlx::query("UPDATE lab_specimens SET status = 'rejected' WHERE id = $1")
        .bind(specimen.id)
        .execute(fixture.pool())
        .await
        .expect("synthetic rejected specimen is prepared");
    assert!(hms_db::laboratory::create_result(
        fixture.pool(),
        fixture.result(order.id, specimen.id, fixture.test_ids[0]),
    )
    .await
    .is_err());
    fixture
        .assert_status(order.id, LabOrderStatus::SpecimenCollected)
        .await;
}

#[tokio::test]
async fn laboratory_concurrent_verification_completes_the_order_without_lost_updates() {
    let fixture = LaboratoryFixture::new("lab-concurrent").await;
    let order = fixture.order(&fixture.test_ids).await;
    let specimen = fixture.specimen(order.id).await;
    let results = hms_db::laboratory::create_results(
        fixture.pool(),
        fixture.facility_id(),
        order.id,
        fixture
            .test_ids
            .iter()
            .map(|test_id| fixture.result(order.id, specimen.id, *test_id))
            .collect(),
    )
    .await
    .expect("results are entered");
    let first_result_ids = [results[0].id];
    let second_result_ids = [results[1].id];
    let (first, second) = tokio::join!(
        hms_db::laboratory::verify_results(
            fixture.pool(),
            fixture.facility_id(),
            None,
            &first_result_ids,
            fixture.owner_id(),
        ),
        hms_db::laboratory::verify_results(
            fixture.pool(),
            fixture.facility_id(),
            None,
            &second_result_ids,
            fixture.owner_id(),
        ),
    );
    assert_eq!(first.expect("first concurrent verification succeeds"), 1);
    assert_eq!(second.expect("second concurrent verification succeeds"), 1);
    fixture
        .assert_status(order.id, LabOrderStatus::Verified)
        .await;
}

struct LaboratoryFixture {
    db: hms_db::test_support::TestDb,
    patient_id: uuid::Uuid,
    test_ids: Vec<uuid::Uuid>,
}

impl LaboratoryFixture {
    async fn new(slug: &str) -> Self {
        let db = hms_db::test_support::TestDb::hospital()
            .await
            .expect("test database provisions");
        let patient = db
            .scenario(slug)
            .registered_patient()
            .await
            .expect("synthetic patient exists");
        let test_ids = sqlx::query_scalar::<_, uuid::Uuid>(
            "SELECT id FROM lab_tests WHERE facility_id = $1 AND is_active = TRUE ORDER BY id LIMIT 2",
        )
        .bind(db.facility_id())
        .fetch_all(db.pool())
        .await
        .expect("lab test catalog loads");
        assert_eq!(test_ids.len(), 2);
        Self {
            db,
            patient_id: patient.id,
            test_ids,
        }
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.db.pool()
    }
    fn facility_id(&self) -> uuid::Uuid {
        self.db.facility_id()
    }
    fn owner_id(&self) -> uuid::Uuid {
        self.db.owner_user_id()
    }

    async fn order(&self, test_ids: &[uuid::Uuid]) -> hms_domain::laboratory::LabOrderListItem {
        hms_db::laboratory::create_order(
            self.pool(),
            NewLabOrder {
                id: uuid::Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: self.patient_id,
                encounter_id: None,
                visit_id: None,
                test_ids: test_ids.to_vec(),
                panel_ids: vec![],
                priority: LabPriority::Routine,
                actor_user_id: self.owner_id(),
            },
        )
        .await
        .expect("synthetic order creates")
    }

    fn new_specimen(&self, order_id: uuid::Uuid) -> NewSpecimen {
        NewSpecimen {
            id: uuid::Uuid::new_v4(),
            facility_id: self.facility_id(),
            order_id,
            patient_id: self.patient_id,
            specimen_type: "blood".to_owned(),
            actor_user_id: self.owner_id(),
        }
    }

    async fn specimen(&self, order_id: uuid::Uuid) -> hms_domain::laboratory::SpecimenListItem {
        hms_db::laboratory::create_specimen(self.pool(), self.new_specimen(order_id))
            .await
            .expect("synthetic specimen creates")
    }

    fn result(
        &self,
        order_id: uuid::Uuid,
        specimen_id: uuid::Uuid,
        test_id: uuid::Uuid,
    ) -> NewLabResult {
        NewLabResult {
            id: uuid::Uuid::new_v4(),
            facility_id: self.facility_id(),
            specimen_id,
            order_id,
            patient_id: self.patient_id,
            test_id,
            value: "synthetic result".to_owned(),
            unit: None,
            actor_user_id: self.owner_id(),
        }
    }

    async fn assert_status(&self, order_id: uuid::Uuid, expected: LabOrderStatus) {
        let order = hms_db::laboratory::get_order_by_id(self.pool(), self.facility_id(), order_id)
            .await
            .expect("order loads")
            .expect("order exists");
        assert_eq!(order.status, expected);
    }
}

#[tokio::test]
async fn laboratory_cancellation_and_final_verification_cannot_both_commit() {
    let fixture = LaboratoryFixture::new("lab-cancel-race").await;
    let order = fixture.order(&fixture.test_ids[..1]).await;
    let specimen = fixture.specimen(order.id).await;
    let result = hms_db::laboratory::create_result(
        fixture.pool(),
        fixture.result(order.id, specimen.id, fixture.test_ids[0]),
    )
    .await
    .expect("final pending result enters");
    let mut parent_lock = fixture
        .pool()
        .begin()
        .await
        .expect("parent-lock transaction begins");
    sqlx::query("SELECT id FROM lab_orders WHERE facility_id = $1 AND id = $2 FOR UPDATE")
        .bind(fixture.facility_id())
        .bind(order.id)
        .execute(&mut *parent_lock)
        .await
        .expect("parent order is held");
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(3));
    let facility_id = fixture.facility_id();
    let actor_id = fixture.owner_id();
    let cancel_pool = fixture.pool().clone();
    let verify_pool = fixture.pool().clone();
    let cancel_barrier = barrier.clone();
    let verify_barrier = barrier.clone();
    let cancellation = tokio::spawn(async move {
        cancel_barrier.wait().await;
        hms_db::laboratory::cancel_order(
            &cancel_pool,
            facility_id,
            order.id,
            actor_id,
            Some("Synthetic cancellation race".to_owned()),
        )
        .await
    });
    let verification = tokio::spawn(async move {
        verify_barrier.wait().await;
        hms_db::laboratory::verify_result(&verify_pool, facility_id, result.id, actor_id).await
    });
    barrier.wait().await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting_writes = sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
            )
            .fetch_one(fixture.pool())
            .await
            .expect("synthetic lock-wait count loads");
            if waiting_writes >= 2 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("both clinical transitions queue behind the held order lock");
    parent_lock
        .commit()
        .await
        .expect("waiting writes are released");
    let (cancellation, verification) = tokio::join!(cancellation, verification);
    let cancellation = cancellation.expect("cancellation task finishes");
    let verification = verification.expect("verification task finishes");
    assert_ne!(
        cancellation.is_ok(),
        verification.is_ok(),
        "exactly one terminal transition commits"
    );
    let final_result = hms_db::laboratory::get_result_by_id(fixture.pool(), facility_id, result.id)
        .await
        .expect("final result loads")
        .expect("result exists");
    if cancellation.is_ok() {
        fixture
            .assert_status(order.id, LabOrderStatus::Cancelled)
            .await;
        assert!(final_result.verified_at.is_none());
    } else {
        fixture
            .assert_status(order.id, LabOrderStatus::Verified)
            .await;
        assert!(final_result.verified_at.is_some());
    }
}
