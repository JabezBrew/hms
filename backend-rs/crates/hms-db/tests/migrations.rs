use hms_db::provision::{
    provision_baseline, provision_performance_seed, BaselineProvisioning, PerformanceSeedConfig,
};
use hms_domain::deployment::DeploymentProfile;

#[tokio::test]
async fn migrations_apply_to_fresh_database_and_seed_baseline() {
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

    let patient_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM patients")
        .fetch_one(&pool)
        .await
        .expect("patient count query succeeds");
    let profile_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM deployment_profiles")
        .fetch_one(&pool)
        .await
        .expect("profile count query succeeds");
    let chronicle_count =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM patient_chronicle_read_models")
            .fetch_one(&pool)
            .await
            .expect("chronicle count query succeeds");

    assert!(profile_count >= 8);
    assert_eq!(patient_count, 2);
    assert_eq!(chronicle_count, 2);
}

#[tokio::test]
async fn performance_seed_is_synthetic_scoped_and_idempotent() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");
    let baseline = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    let seed = PerformanceSeedConfig {
        patient_count: 12,
        chronicled_patient_count: 4,
        notes_per_chronicle_patient: 3,
        lab_order_count: 6,
        inventory_item_count: 5,
        admission_count: 3,
        invoice_count: 6,
    };

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(&pool, &baseline)
        .await
        .expect("baseline provisions");
    provision_performance_seed(&pool, &baseline, seed)
        .await
        .expect("performance seed provisions");
    provision_performance_seed(&pool, &baseline, seed)
        .await
        .expect("performance seed is idempotent");

    let perf_patient_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM patients WHERE facility_id = $1 AND patient_code ~ '^PERF-[0-9]{6}$'",
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("perf patient count query succeeds");
    let perf_context_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM patient_contexts
        WHERE facility_id = $1
          AND label = 'performance-seed'
        "#,
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("perf context count query succeeds");
    let perf_note_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM clinical_notes
        WHERE facility_id = $1
          AND title LIKE 'Performance note %'
          AND body = 'Synthetic clinical performance seed note. No patient-identifying content.'
        "#,
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("perf note count query succeeds");
    let lab_order_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM lab_orders
        WHERE facility_id = $1
          AND id::text LIKE '71000000-%'
        "#,
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("lab order count query succeeds");
    let inventory_item_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM inventory_items WHERE facility_id = $1 AND code ~ '^PERF-MED-[0-9]{6}$'",
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("inventory item count query succeeds");
    let admission_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM admission_cases
        WHERE facility_id = $1
          AND id::text LIKE '52000000-%'
        "#,
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("admission count query succeeds");
    let invoice_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM invoices WHERE facility_id = $1 AND invoice_number ~ '^PERF-[0-9]{8}$'",
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("invoice count query succeeds");

    assert_eq!(perf_patient_count, i64::from(seed.patient_count));
    assert_eq!(perf_context_count, i64::from(seed.patient_count));
    assert_eq!(
        perf_note_count,
        i64::from(seed.chronicled_patient_count * seed.notes_per_chronicle_patient)
    );
    assert_eq!(lab_order_count, i64::from(seed.lab_order_count));
    assert_eq!(inventory_item_count, i64::from(seed.inventory_item_count));
    assert_eq!(admission_count, i64::from(seed.admission_count));
    assert_eq!(invoice_count, i64::from(seed.invoice_count));
}
