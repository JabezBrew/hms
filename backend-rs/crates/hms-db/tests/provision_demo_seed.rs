use hms_db::provision::{
    provision_baseline, provision_demo_seed, BaselineProvisioning, DemoSeedProfile,
};
use hms_domain::deployment::DeploymentProfile;
use sqlx::FromRow;

#[derive(Debug, FromRow, PartialEq)]
struct DemoCounts {
    patients: i64,
    contexts: i64,
    appointments: i64,
    visits: i64,
    encounters: i64,
    encounter_linked_notes: i64,
    admissions: i64,
    discharge_cases: i64,
    nursing_tasks: i64,
    medication_administrations: i64,
    treatment_sheets: i64,
    notes: i64,
    lab_orders: i64,
    lab_results: i64,
    invoices: i64,
    payments: i64,
    ward_rounds: i64,
}

#[tokio::test]
async fn smoke_demo_seed_is_idempotent_and_covers_all_archetypes() {
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

    provision_demo_seed(&pool, &baseline, DemoSeedProfile::Smoke)
        .await
        .expect("demo seed provisions");
    let first_counts = demo_counts(&pool, baseline.facility_id).await;

    provision_demo_seed(&pool, &baseline, DemoSeedProfile::Smoke)
        .await
        .expect("demo seed reruns");
    let second_counts = demo_counts(&pool, baseline.facility_id).await;

    assert_eq!(first_counts, second_counts);
    assert_eq!(second_counts.patients, 9);
    assert_eq!(second_counts.contexts, 9);
    assert!(second_counts.appointments >= 30);
    assert_eq!(second_counts.appointments, second_counts.visits);
    assert!(second_counts.encounters >= second_counts.appointments);
    assert_eq!(second_counts.notes, second_counts.encounter_linked_notes);
    assert!(second_counts.admissions >= 5);
    assert!(second_counts.discharge_cases >= 1);
    assert!(second_counts.nursing_tasks >= 12);
    assert!(second_counts.medication_administrations >= 8);
    assert!(second_counts.treatment_sheets >= 4);
    assert!(second_counts.lab_results >= 50);
    assert!(second_counts.invoices >= second_counts.appointments);
    assert!(second_counts.ward_rounds >= 6);

    let archetype_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(DISTINCT replace(label, 'demo-seed: ', ''))
        FROM patient_contexts
        JOIN patients ON patients.id = patient_contexts.patient_id
        WHERE patients.facility_id = $1
          AND patients.patient_code LIKE 'DEMO-%'
          AND patient_contexts.context_kind = 'assigned'
        "#,
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("archetype coverage query succeeds");
    assert_eq!(archetype_count, 9);

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
    assert!(visible_admitted_patient_count >= 3);

    let rich_patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        r#"
        SELECT patients.id
        FROM patients
        JOIN admission_cases ON admission_cases.patient_id = patients.id
        WHERE patients.facility_id = $1
          AND patients.patient_code LIKE 'DEMO-%'
          AND admission_cases.status IN ('admitted', 'discharge_pending')
        ORDER BY patients.patient_code
        LIMIT 1
        "#,
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
    assert!(startup.encounters.len() > 1);
    let encounter_ids = startup
        .encounters
        .iter()
        .map(|encounter| encounter.id)
        .collect::<std::collections::HashSet<_>>();
    for entry in startup
        .timeline_entries
        .iter()
        .filter(|entry| entry.encounter_id.is_some())
    {
        assert!(encounter_ids.contains(&entry.encounter_id.unwrap()));
    }
    assert!(!startup.notes.is_empty());
    assert!(!startup.prescriptions.is_empty());
    assert!(!startup.chart_entries.is_empty());
    assert!(!startup.lab_results.is_empty());
    assert!(startup
        .timeline_entries
        .iter()
        .any(|entry| entry.entry_type == "ward_round"));
    assert!(startup
        .timeline_entries
        .iter()
        .any(|entry| entry.entry_type == "vitals"));
    assert!(startup
        .timeline_entries
        .iter()
        .any(|entry| entry.entry_type == "prescription"));
    assert!(startup
        .timeline_entries
        .iter()
        .any(|entry| entry.entry_type == "lab_result"));

    let outpatient_patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        r#"
        SELECT patients.id
        FROM patients
        WHERE patients.facility_id = $1
          AND patients.patient_code LIKE 'DEMO-%'
          AND NOT EXISTS (
              SELECT 1
              FROM admission_cases
              WHERE admission_cases.facility_id = patients.facility_id
                AND admission_cases.patient_id = patients.id
                AND admission_cases.status IN ('admitted', 'discharge_pending')
          )
        ORDER BY patients.patient_code
        LIMIT 1
        "#,
    )
    .bind(baseline.facility_id)
    .fetch_one(&pool)
    .await
    .expect("demo outpatient exists");
    let outpatient =
        hms_db::patients::get_patient(&pool, baseline.facility_id, outpatient_patient_id)
            .await
            .expect("outpatient lookup succeeds")
            .expect("outpatient exists");
    let outpatient_startup = hms_db::clinical::patient_chronicle_startup_for_patient(
        &pool,
        &outpatient,
        10,
        25,
        None,
        hms_db::clinical::ChronicleTimelineFilters::default(),
    )
    .await
    .expect("outpatient chronicle startup loads");
    assert!(outpatient_startup.active_admission.is_none());
    assert!(!outpatient_startup.notes.is_empty());
    assert!(!outpatient_startup.chart_entries.is_empty());
    assert!(!outpatient_startup.prescriptions.is_empty());
    assert!(!outpatient_startup.lab_results.is_empty());

    let linked_billing_path_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM invoices
            JOIN invoice_lines ON invoice_lines.invoice_id = invoices.id
            LEFT JOIN payments ON payments.invoice_id = invoices.id
            WHERE invoices.facility_id = $1
              AND invoices.patient_id = $2
              AND invoices.invoice_number LIKE 'DEMO-%'
              AND invoice_lines.description LIKE 'Synthetic %'
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

#[tokio::test]
async fn staging_demo_seed_is_idempotent_and_bounded() {
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

    provision_demo_seed(&pool, &baseline, DemoSeedProfile::Staging)
        .await
        .expect("staging demo seed provisions");
    let first_counts = demo_counts(&pool, baseline.facility_id).await;
    provision_demo_seed(&pool, &baseline, DemoSeedProfile::Staging)
        .await
        .expect("staging demo seed reruns");
    let second_counts = demo_counts(&pool, baseline.facility_id).await;

    assert_eq!(first_counts, second_counts);
    assert_eq!(second_counts.patients, 90);
    assert!(second_counts.appointments > 400);
    assert!(second_counts.encounters >= second_counts.appointments);
    assert_eq!(second_counts.notes, second_counts.encounter_linked_notes);
    assert!(second_counts.ward_rounds >= 20);
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
          (SELECT count(*) FROM appointments WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS appointments,
          (SELECT count(*) FROM visits WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS visits,
          (SELECT count(*) FROM encounters WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS encounters,
          (SELECT count(*) FROM clinical_notes WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients) AND encounter_id IS NOT NULL) AS encounter_linked_notes,
          (SELECT count(*) FROM admission_cases WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS admissions,
          (SELECT count(*) FROM discharge_cases WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS discharge_cases,
          (SELECT count(*) FROM nursing_tasks WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS nursing_tasks,
          (SELECT count(*) FROM medication_administrations WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS medication_administrations,
          (SELECT count(*) FROM treatment_sheets WHERE facility_id = $1 AND patient_id IN (SELECT id FROM demo_patients)) AS treatment_sheets,
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
