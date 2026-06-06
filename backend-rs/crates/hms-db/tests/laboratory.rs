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
