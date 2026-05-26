use hms_db::provision::{
    provision_baseline, provision_demo_seed, BaselineProvisioning, DemoSeedProfile,
};
use hms_domain::deployment::DeploymentProfile;
use sqlx::FromRow;

#[derive(Debug, FromRow, PartialEq)]
struct DemoCounts {
    patients: i64,
    contexts: i64,
    admissions: i64,
    nursing_tasks: i64,
    notes: i64,
    lab_orders: i64,
    lab_results: i64,
    invoices: i64,
    payments: i64,
    ward_rounds: i64,
}

#[tokio::test]
async fn demo_seed_is_idempotent_and_creates_chronicle_ward_lab_billing_paths() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");
    hms_db::migrate::run(&pool).await.expect("migrations apply");

    let baseline = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision_baseline(&pool, &baseline)
        .await
        .expect("baseline provisions");

    provision_demo_seed(&pool, &baseline, DemoSeedProfile::Small)
        .await
        .expect("demo seed provisions");
    let first_counts = demo_counts(&pool, baseline.facility_id).await;

    provision_demo_seed(&pool, &baseline, DemoSeedProfile::Small)
        .await
        .expect("demo seed reruns");
    let second_counts = demo_counts(&pool, baseline.facility_id).await;

    assert_eq!(first_counts, second_counts);
    assert_eq!(second_counts.patients, 4);
    assert_eq!(second_counts.contexts, 4);
    assert_eq!(second_counts.admissions, 2);
    assert!(second_counts.nursing_tasks >= 4);
    assert!(second_counts.notes >= 4);
    assert!(second_counts.lab_results >= 4);
    assert_eq!(second_counts.invoices, 4);
    assert_eq!(second_counts.ward_rounds, 4);

    let visible_admitted_patient_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM patients
        JOIN patient_contexts
          ON patient_contexts.patient_id = patients.id
         AND patient_contexts.facility_id = patients.facility_id
        JOIN admission_cases
          ON admission_cases.patient_id = patients.id
         AND admission_cases.facility_id = patients.facility_id
        WHERE patients.facility_id = $1
          AND patients.patient_code LIKE 'DEMO-%'
          AND patient_contexts.user_id = $2
          AND patient_contexts.context_kind = 'assigned'
          AND admission_cases.status IN ('admitted', 'discharge_pending')
        "#,
    )
    .bind(baseline.facility_id)
    .bind(uuid::Uuid::from_u128(hms_db::provision::OWNER_USER_ID))
    .fetch_one(&pool)
    .await
    .expect("visible admitted patient query succeeds");
    assert!(visible_admitted_patient_count >= 1);

    let rich_patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 AND patient_code = 'DEMO-0001'",
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("demo inpatient exists");
    let rich_patient = hms_db::patients::get_patient(&pool, baseline.facility_id, rich_patient_id)
        .await
        .expect("patient lookup succeeds")
        .expect("patient exists");
    let startup = hms_db::clinical::patient_chronicle_startup_for_patient(
        &pool,
        &rich_patient,
        10,
        25,
        None,
        hms_db::clinical::ChronicleTimelineFilters::default(),
    )
    .await
    .expect("chronicle startup loads");

    assert!(startup.active_admission.is_some());
    assert!(!startup.notes.is_empty());
    assert!(!startup.lab_results.is_empty());
    assert!(startup
        .timeline_entries
        .iter()
        .any(|entry| entry.entry_type == "ward_round"));

    let linked_billing_path_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM invoices
            JOIN invoice_lines ON invoice_lines.invoice_id = invoices.id
            LEFT JOIN payments ON payments.invoice_id = invoices.id
            WHERE invoices.facility_id = $1
              AND invoices.patient_id = $2
              AND invoices.invoice_number = 'DEMO-000001'
              AND invoice_lines.description LIKE 'Demo %'
              AND payments.id IS NOT NULL
        )
        "#,
    )
    .bind(baseline.facility_id)
    .bind(rich_patient_id)
    .fetch_one(&pool)
    .await
    .expect("billing path query succeeds");
    assert!(linked_billing_path_exists);
}

async fn demo_counts(pool: &hms_db::PgPool, facility_id: uuid::Uuid) -> DemoCounts {
    sqlx::query_as::<_, DemoCounts>(
        r#"
        WITH demo_patients AS (
            SELECT id
            FROM patients
            WHERE facility_id = $1
              AND patient_code LIKE 'DEMO-%'
        ),
        demo_invoices AS (
            SELECT id
            FROM invoices
            WHERE facility_id = $1
              AND invoice_number LIKE 'DEMO-%'
        )
        SELECT
          (SELECT count(*) FROM demo_patients) AS patients,
          (SELECT count(*) FROM patient_contexts WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS contexts,
          (SELECT count(*) FROM admission_cases WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS admissions,
          (SELECT count(*) FROM nursing_tasks WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS nursing_tasks,
          (SELECT count(*) FROM clinical_notes WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS notes,
          (SELECT count(*) FROM lab_orders WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS lab_orders,
          (SELECT count(*) FROM lab_results WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS lab_results,
          (SELECT count(*) FROM demo_invoices) AS invoices,
          (SELECT count(*) FROM payments WHERE facility_id = $1 AND invoice_id IN (SELECT id FROM demo_invoices)) AS payments,
          (SELECT count(*) FROM ward_rounds WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS ward_rounds
        "#,
    )
    .bind(facility_id)
    .fetch_one(pool)
    .await
    .expect("demo counts query succeeds")
}
