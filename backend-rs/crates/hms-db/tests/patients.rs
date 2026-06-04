use chrono::{Datelike, Days, NaiveDate, Utc};
use hms_db::clinical::{
    NewAllergy, NewChartEntry, NewClinicalNote, NewClinicalNoteTemplate, NewPrescription,
    NewProblem, UpdateClinicalNoteTemplate,
};
use hms_db::laboratory::{NewLabOrder, NewLabResult, NewSpecimen};
use hms_db::patients::{
    PatientContextCursor, PatientContextFilters, PatientListOrdering, PatientRegistryFilters,
    PatientUpdate,
};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_db::ward::NewAdmissionCase;
use hms_domain::clinical::{
    AllergySeverity, AllergyStatus, ChartEntryType, ClinicalNoteType, PrescriptionStatus,
    ProblemStatus, UpdateAllergyRequest, UpdatePrescriptionRequest, UpdateProblemRequest,
};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::laboratory::LabPriority;
use hms_domain::patients::{PatientAdministrativeStatus, Sex};
use hms_domain::ward::AdmissionStatus;

#[tokio::test]
async fn patient_update_and_context_repository_keep_facility_scope() {
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
    let deceased_patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 AND id <> $2 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .expect("second patient exists");

    let full_name_matches = hms_db::patients::list_patients(
        &pool,
        facility_id,
        None,
        10,
        Some("Ama Mensah"),
        Some(PatientAdministrativeStatus::Active),
    )
    .await
    .expect("full-name patient search succeeds");

    assert_eq!(full_name_matches.len(), 1);
    assert_eq!(full_name_matches[0].id, patient_id);

    let updated = hms_db::patients::update_patient(
        &pool,
        PatientUpdate {
            id: patient_id,
            facility_id,
            first_name: Some("Akua".to_owned()),
            last_name: None,
            date_of_birth: Some(NaiveDate::from_ymd_opt(1991, 5, 7).expect("static date is valid")),
            sex: Some(Sex::Female),
            status: Some(PatientAdministrativeStatus::Active),
            actor_user_id: owner_id,
            request_id: Some("repo-patient-update".to_owned()),
        },
    )
    .await
    .expect("patient update succeeds")
    .expect("patient is found in facility");

    assert_eq!(updated.first_name, "Akua");
    assert_eq!(updated.date_of_birth.year(), 1991);

    let context = hms_db::patients::list_context_patients(
        &pool,
        facility_id,
        owner_id,
        None::<PatientContextCursor>,
        5,
        PatientContextFilters::default(),
    )
    .await
    .expect("context patients list succeeds");

    assert!(!context.is_empty());
    assert_eq!(context[0].id, patient_id);
    assert_eq!(context[0].display_name, "Akua Mensah");

    let full_name_context = hms_db::patients::list_context_patients(
        &pool,
        facility_id,
        owner_id,
        None::<PatientContextCursor>,
        5,
        PatientContextFilters {
            patient_id: None,
            search: Some("Akua Mensah".to_owned()),
        },
    )
    .await
    .expect("full-name context patient search succeeds");

    assert!(!full_name_context.is_empty());
    assert!(full_name_context
        .iter()
        .all(|patient| patient.id == patient_id && patient.display_name == "Akua Mensah"));

    let filtered_context = hms_db::patients::list_context_patients(
        &pool,
        facility_id,
        owner_id,
        None::<PatientContextCursor>,
        5,
        PatientContextFilters {
            patient_id: Some(patient_id),
            search: None,
        },
    )
    .await
    .expect("context patient id filter succeeds");

    assert!(!filtered_context.is_empty());
    assert!(filtered_context
        .iter()
        .all(|patient| patient.id == patient_id));

    let missing_context = hms_db::patients::list_context_patients(
        &pool,
        facility_id,
        owner_id,
        None::<PatientContextCursor>,
        5,
        PatientContextFilters {
            patient_id: Some(uuid::Uuid::new_v4()),
            search: None,
        },
    )
    .await
    .expect("missing context patient id filter succeeds");

    assert!(missing_context.is_empty());

    hms_db::patients::update_patient(
        &pool,
        PatientUpdate {
            id: deceased_patient_id,
            facility_id,
            first_name: None,
            last_name: None,
            date_of_birth: None,
            sex: None,
            status: Some(PatientAdministrativeStatus::Deceased),
            actor_user_id: owner_id,
            request_id: Some("repo-patient-status-filter".to_owned()),
        },
    )
    .await
    .expect("patient status update succeeds")
    .expect("patient exists");

    let deceased_patients = hms_db::patients::list_patients(
        &pool,
        facility_id,
        None,
        10,
        None,
        Some(PatientAdministrativeStatus::Deceased),
    )
    .await
    .expect("patient status filter succeeds");

    assert_eq!(deceased_patients.len(), 1);
    assert_eq!(deceased_patients[0].id, deceased_patient_id);
}

#[tokio::test]
async fn patient_registry_projection_includes_current_location_and_opt_in_count() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test database is available");
    let scenario = db
        .scenario("registry-location")
        .admission_case_with_available_bed()
        .await
        .expect("admission scenario builds");
    let admission = hms_db::ward::activate_admission_case(
        db.pool(),
        db.facility_id(),
        scenario.admission.id,
        db.owner_user_id(),
    )
    .await
    .expect("activation query succeeds")
    .expect("admission activates");
    let bed_code = admission.bed_code.as_deref().expect("admission has a bed");
    let expected_location = format!("{} - Bed {}", admission.ward_name, bed_code);

    let (rows_result, observed_queries) = hms_observability::with_request_query_counter(async {
        hms_db::patients::list_patient_registry(
            db.pool(),
            db.facility_id(),
            None,
            10,
            PatientRegistryFilters {
                search: Some(scenario.patient.patient_code.clone()),
                status: Some(PatientAdministrativeStatus::Active),
                ..Default::default()
            },
            PatientListOrdering::default(),
        )
        .await
    })
    .await;
    let rows = rows_result.expect("patient registry projection succeeds");

    assert_eq!(
        observed_queries, 1,
        "patient registry location must be loaded by the list projection, not per row"
    );
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].patient.id, scenario.patient.id);
    assert_eq!(
        rows[0].patient_location.as_deref(),
        Some(expected_location.as_str())
    );

    let count = hms_db::patients::count_patients(
        db.pool(),
        db.facility_id(),
        PatientRegistryFilters {
            search: Some(scenario.patient.patient_code.clone()),
            status: Some(PatientAdministrativeStatus::Active),
            ..Default::default()
        },
    )
    .await
    .expect("patient count succeeds");
    assert_eq!(count, 1);

    let cross_facility_rows = hms_db::patients::list_patient_registry(
        db.pool(),
        uuid::Uuid::new_v4(),
        None,
        10,
        PatientRegistryFilters {
            search: Some(scenario.patient.patient_code.clone()),
            status: Some(PatientAdministrativeStatus::Active),
            ..Default::default()
        },
        PatientListOrdering::default(),
    )
    .await
    .expect("cross-facility registry projection succeeds");
    assert!(cross_facility_rows.is_empty());
}

#[tokio::test]
async fn patient_registry_filters_by_admission_and_age_without_duplication() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test database is available");
    let scenario = db
        .scenario("registry-filters")
        .admission_case_with_available_bed()
        .await
        .expect("admission scenario builds");
    hms_db::ward::activate_admission_case(
        db.pool(),
        db.facility_id(),
        scenario.admission.id,
        db.owner_user_id(),
    )
    .await
    .expect("activation query succeeds")
    .expect("admission activates");

    let today = Utc::now().date_naive();
    let admission_start_at = today
        .and_hms_opt(0, 0, 0)
        .expect("midnight is valid")
        .and_utc();
    let admission_end_before = today
        .checked_add_days(Days::new(1))
        .expect("tomorrow is valid")
        .and_hms_opt(0, 0, 0)
        .expect("midnight is valid")
        .and_utc();
    let matching_filters = PatientRegistryFilters {
        search: Some(scenario.patient.patient_code.clone()),
        patient_id: Some(scenario.patient.id),
        status: Some(PatientAdministrativeStatus::Active),
        admission_start_at: Some(admission_start_at),
        admission_end_before: Some(admission_end_before),
        ward_id: Some(scenario.ward.id),
        admission_status: Some(AdmissionStatus::Admitted),
        attending_id: Some(db.owner_user_id()),
        date_of_birth_on_or_after: Some(
            NaiveDate::from_ymd_opt(1980, 1, 1).expect("static date is valid"),
        ),
        date_of_birth_on_or_before: Some(
            NaiveDate::from_ymd_opt(1995, 1, 1).expect("static date is valid"),
        ),
    };

    let filtered_rows = hms_db::patients::list_patient_registry(
        db.pool(),
        db.facility_id(),
        None,
        10,
        matching_filters.clone(),
        PatientListOrdering::default(),
    )
    .await
    .expect("filtered patient registry query succeeds");

    assert_eq!(filtered_rows.len(), 1);
    assert_eq!(filtered_rows[0].patient.id, scenario.patient.id);

    let filtered_count =
        hms_db::patients::count_patients(db.pool(), db.facility_id(), matching_filters)
            .await
            .expect("filtered patient registry count succeeds");
    assert_eq!(filtered_count, 1);

    let wrong_ward_rows = hms_db::patients::list_patient_registry(
        db.pool(),
        db.facility_id(),
        None,
        10,
        PatientRegistryFilters {
            ward_id: Some(uuid::Uuid::new_v4()),
            ..Default::default()
        },
        PatientListOrdering::default(),
    )
    .await
    .expect("wrong ward registry query succeeds");
    assert!(wrong_ward_rows.is_empty());
}

#[tokio::test]
async fn patient_registry_ward_filter_defaults_to_current_admissions() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test database is available");
    let current = db
        .scenario("registry-current-ward")
        .admission_case_with_available_bed()
        .await
        .expect("current admission scenario builds");
    hms_db::ward::activate_admission_case(
        db.pool(),
        db.facility_id(),
        current.admission.id,
        db.owner_user_id(),
    )
    .await
    .expect("activation query succeeds")
    .expect("current admission activates");

    let historical_patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        r#"
        SELECT id
        FROM patients
        WHERE facility_id = $1
          AND id <> $2
        ORDER BY created_at, id
        LIMIT 1
        "#,
    )
    .bind(db.facility_id())
    .bind(current.patient.id)
    .fetch_one(db.pool())
    .await
    .expect("historical-filter patient exists");
    let historical_admission = hms_db::ward::create_admission_case(
        db.pool(),
        NewAdmissionCase {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: historical_patient_id,
            ward_id: current.ward.id,
            actor_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("historical admission case creates");
    hms_db::ward::cancel_admission_case(
        db.pool(),
        db.facility_id(),
        historical_admission.id,
        db.owner_user_id(),
    )
    .await
    .expect("historical admission cancellation query succeeds")
    .expect("historical admission cancels");

    let ward_only_rows = hms_db::patients::list_patient_registry(
        db.pool(),
        db.facility_id(),
        None,
        10,
        PatientRegistryFilters {
            ward_id: Some(current.ward.id),
            status: Some(PatientAdministrativeStatus::Active),
            ..Default::default()
        },
        PatientListOrdering::default(),
    )
    .await
    .expect("ward-only registry query succeeds");

    assert!(
        ward_only_rows
            .iter()
            .any(|row| row.patient.id == current.patient.id),
        "current admission in the ward should match ward-only registry filters"
    );
    assert!(
        ward_only_rows
            .iter()
            .all(|row| row.patient.id != historical_patient_id),
        "ward-only registry filters should not match cancelled historical admissions"
    );
    assert!(
        ward_only_rows
            .iter()
            .all(|row| row.patient_location.is_some()),
        "ward-only registry results should have a current ward location"
    );

    let explicit_cancelled_rows = hms_db::patients::list_patient_registry(
        db.pool(),
        db.facility_id(),
        None,
        10,
        PatientRegistryFilters {
            ward_id: Some(current.ward.id),
            status: Some(PatientAdministrativeStatus::Active),
            admission_status: Some(AdmissionStatus::Cancelled),
            ..Default::default()
        },
        PatientListOrdering::default(),
    )
    .await
    .expect("explicit cancelled registry query succeeds");

    assert!(
        explicit_cancelled_rows
            .iter()
            .any(|row| row.patient.id == historical_patient_id),
        "explicit admission_status filters should still allow historical ward lookups"
    );
}

#[tokio::test]
async fn patient_validation_rules_repository_is_facility_scoped_and_active_only() {
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
    let other_facility_id = uuid::Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO facilities (id, code, name, deployment_profile)
        VALUES ($1, 'OTHER', 'Other Facility', 'hospital')
        "#,
    )
    .bind(other_facility_id)
    .execute(&pool)
    .await
    .expect("other facility inserts");

    sqlx::query(
        r#"
        INSERT INTO patient_registration_validation_rules (
            id,
            facility_id,
            field_name,
            validation_regex,
            validation_message,
            is_required,
            is_active
        )
        VALUES
            ($1, $2, 'phone_number', '^[0-9]{10}$', 'Phone number must be 10 digits', true, true),
            ($3, $2, 'legacy_number', null, 'Legacy number is disabled', false, false),
            ($4, $5, 'email', '^.+@.+$', 'Email belongs to another facility', false, true)
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(facility_id)
    .bind(uuid::Uuid::new_v4())
    .bind(uuid::Uuid::new_v4())
    .bind(other_facility_id)
    .execute(&pool)
    .await
    .expect("validation rules insert");

    let rules =
        hms_db::patients::list_patient_registration_validation_rules(&pool, facility_id, 50)
            .await
            .expect("validation rules list succeeds");

    assert!(rules.iter().any(|rule| {
        rule.field_name == "phone_number"
            && rule.validation_regex.as_deref() == Some("^[0-9]{10}$")
            && rule.validation_message == "Phone number must be 10 digits"
            && rule.is_required
            && rule.is_active
    }));
    assert!(rules.iter().any(|rule| rule.field_name == "first_name"));
    assert!(!rules.iter().any(|rule| rule.field_name == "legacy_number"));
    assert!(!rules.iter().any(|rule| rule.field_name == "email"));
}

#[tokio::test]
async fn patient_chronicle_summary_repository_is_bounded_and_facility_scoped() {
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

    let note = hms_db::clinical::create_note(
        &pool,
        NewClinicalNote {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            encounter_id: None,
            note_type: ClinicalNoteType::DoctorNote,
            title: "Summary note".to_owned(),
            body: "Clinical summary body.".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("note is created");

    let detail = hms_db::clinical::get_note_detail(&pool, facility_id, note.id)
        .await
        .expect("note detail query succeeds")
        .expect("note exists in facility");
    assert_eq!(detail.body, "Clinical summary body.");
    assert!(
        hms_db::clinical::get_note_detail(&pool, uuid::Uuid::new_v4(), note.id)
            .await
            .expect("cross-facility detail query succeeds")
            .is_none()
    );

    hms_db::clinical::create_problem(
        &pool,
        NewProblem {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            label: "Hypertension".to_owned(),
            onset_date: Some(NaiveDate::from_ymd_opt(2025, 1, 10).expect("date is valid")),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("problem is created");
    hms_db::clinical::create_allergy(
        &pool,
        NewAllergy {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            substance: "Penicillin".to_owned(),
            reaction: Some("Rash".to_owned()),
            severity: AllergySeverity::Moderate,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("allergy is created");
    hms_db::clinical::create_prescription(
        &pool,
        NewPrescription {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            medication_name: "Amlodipine".to_owned(),
            dose: "5 mg".to_owned(),
            route: "oral".to_owned(),
            frequency: "daily".to_owned(),
            inventory_item_id: None,
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("prescription is created");
    hms_db::clinical::create_chart_entry(
        &pool,
        NewChartEntry {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            encounter_id: None,
            visit_id: None,
            entry_type: ChartEntryType::BloodPressure,
            measured_at: Utc::now(),
            value: "130/82".to_owned(),
            unit: Some("mmHg".to_owned()),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("chart entry is created");
    let test_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM lab_tests WHERE facility_id = $1 ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("baseline lab test exists");
    let lab_order = hms_db::laboratory::create_order(
        &pool,
        NewLabOrder {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            test_ids: vec![test_id],
            panel_ids: vec![],
            priority: LabPriority::Routine,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("lab order is created");
    let specimen = hms_db::laboratory::create_specimen(
        &pool,
        NewSpecimen {
            id: uuid::Uuid::new_v4(),
            facility_id,
            order_id: lab_order.id,
            patient_id,
            specimen_type: "blood".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("lab specimen is created");
    hms_db::laboratory::create_result(
        &pool,
        NewLabResult {
            id: uuid::Uuid::new_v4(),
            facility_id,
            specimen_id: specimen.id,
            order_id: lab_order.id,
            patient_id,
            test_id,
            value: "11.4".to_owned(),
            unit: Some("g/dL".to_owned()),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("lab result is created");

    let summary = hms_db::clinical::patient_chronicle_summary(&pool, facility_id, patient_id, 1)
        .await
        .expect("summary query succeeds")
        .expect("patient exists in facility");

    assert_eq!(summary.patient.id, patient_id);
    assert_eq!(summary.notes.len(), 1);
    assert_eq!(summary.problems[0].label, "Hypertension");
    assert_eq!(summary.allergies[0].substance, "Penicillin");
    assert_eq!(summary.prescriptions[0].medication_name, "Amlodipine");
    assert_eq!(summary.chart_entries[0].value, "130/82");

    let patient = hms_db::patients::get_patient(&pool, facility_id, patient_id)
        .await
        .expect("patient lookup succeeds")
        .expect("patient exists");
    let (loaded_summary, observed_queries) = hms_observability::with_request_query_counter(async {
        hms_db::clinical::patient_chronicle_summary_for_patient(&pool, patient.clone(), 1).await
    })
    .await;
    let loaded_summary = loaded_summary.expect("summary from loaded patient succeeds");
    assert_eq!(loaded_summary.patient.id, patient_id);
    assert_eq!(loaded_summary.notes.len(), 1);
    assert_eq!(observed_queries, 1);

    let (startup, startup_observed_queries) =
        hms_observability::with_request_query_counter(async {
            hms_db::clinical::patient_chronicle_startup_for_patient(
                &pool,
                &patient,
                5,
                21,
                None,
                hms_db::clinical::ChronicleTimelineFilters::default(),
            )
            .await
        })
        .await;
    let startup = startup.expect("startup read succeeds");
    assert_eq!(startup_observed_queries, 1);
    assert_eq!(startup.notes.len(), 1);
    assert_eq!(startup.problems[0].label, "Hypertension");
    assert_eq!(startup.allergies[0].substance, "Penicillin");
    assert_eq!(startup.prescriptions[0].medication_name, "Amlodipine");
    assert_eq!(startup.chart_entries[0].value, "130/82");
    assert_eq!(startup.lab_results[0].test_id, test_id);
    assert!(startup.timeline_entries.len() <= 21);
    assert!(startup
        .timeline_entries
        .iter()
        .any(|entry| entry.entry_type == "lab_result"));
    assert!(startup
        .timeline_entries
        .iter()
        .all(|entry| { !entry.data.to_string().contains("Clinical summary body.") }));

    assert!(hms_db::clinical::patient_chronicle_summary(
        &pool,
        uuid::Uuid::new_v4(),
        patient_id,
        1
    )
    .await
    .expect("cross-facility query succeeds")
    .is_none());
}

#[tokio::test]
async fn problem_status_updates_are_facility_scoped() {
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

    let problem = hms_db::clinical::create_problem(
        &pool,
        NewProblem {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            label: "Hypertension".to_owned(),
            onset_date: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("problem is created");

    let updated = hms_db::clinical::update_problem_status(
        &pool,
        facility_id,
        problem.id,
        ProblemStatus::Resolved,
    )
    .await
    .expect("problem status update succeeds")
    .expect("problem exists");
    assert_eq!(updated.status, ProblemStatus::Resolved);

    assert!(hms_db::clinical::update_problem_status(
        &pool,
        uuid::Uuid::new_v4(),
        problem.id,
        ProblemStatus::Active,
    )
    .await
    .expect("cross-facility problem status update succeeds")
    .is_none());
}

#[tokio::test]
async fn clinical_note_template_mutations_are_facility_scoped_and_soft_deleted() {
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

    let template = hms_db::clinical::create_note_template(
        &pool,
        NewClinicalNoteTemplate {
            id: uuid::Uuid::new_v4(),
            facility_id,
            title: "Ward Round Note".to_owned(),
            note_type: ClinicalNoteType::DoctorNote,
            body_template: "Subjective\nObjective\nAssessment\nPlan".to_owned(),
        },
    )
    .await
    .expect("template create succeeds");
    assert!(template.is_active);

    let detail = hms_db::clinical::get_note_template(&pool, facility_id, template.id)
        .await
        .expect("template detail succeeds")
        .expect("template exists");
    assert_eq!(detail.title, "Ward Round Note");

    let updated = hms_db::clinical::update_note_template(
        &pool,
        facility_id,
        template.id,
        UpdateClinicalNoteTemplate {
            title: Some("Updated Ward Round Note".to_owned()),
            note_type: None,
            body_template: Some("Updated SOAP structure".to_owned()),
            is_active: None,
        },
    )
    .await
    .expect("template update succeeds")
    .expect("template exists");
    assert_eq!(updated.title, "Updated Ward Round Note");
    assert_eq!(updated.body_template, "Updated SOAP structure");
    assert!(updated.is_active);

    let updated_detail = hms_db::clinical::get_note_template(&pool, facility_id, template.id)
        .await
        .expect("updated template detail succeeds")
        .expect("template exists");
    assert_eq!(updated_detail.title, "Updated Ward Round Note");

    assert!(hms_db::clinical::update_note_template(
        &pool,
        uuid::Uuid::new_v4(),
        template.id,
        UpdateClinicalNoteTemplate {
            title: Some("Cross facility".to_owned()),
            note_type: None,
            body_template: None,
            is_active: None,
        },
    )
    .await
    .expect("cross-facility template update succeeds")
    .is_none());

    let deactivated = hms_db::clinical::deactivate_note_template(&pool, facility_id, template.id)
        .await
        .expect("template deactivation succeeds")
        .expect("template exists");
    assert!(!deactivated.is_active);

    let active_templates = hms_db::clinical::list_note_templates(&pool, facility_id, 1)
        .await
        .expect("template list succeeds");
    assert_eq!(active_templates.len(), 1);
    assert!(!active_templates
        .iter()
        .any(|active_template| active_template.id == template.id));

    assert!(
        hms_db::clinical::get_note_template(&pool, uuid::Uuid::new_v4(), template.id)
            .await
            .expect("cross-facility template detail succeeds")
            .is_none()
    );
}

#[tokio::test]
async fn allergy_detail_updates_are_facility_scoped_and_soft_deleted() {
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

    let allergy = hms_db::clinical::create_allergy(
        &pool,
        NewAllergy {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            substance: "Penicillin".to_owned(),
            reaction: Some("Rash".to_owned()),
            severity: AllergySeverity::Moderate,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("allergy is created");

    let detail = hms_db::clinical::get_allergy(&pool, facility_id, allergy.id)
        .await
        .expect("allergy detail query succeeds")
        .expect("allergy exists");
    assert_eq!(detail.substance, "Penicillin");

    let updated = hms_db::clinical::update_allergy(
        &pool,
        facility_id,
        allergy.id,
        UpdateAllergyRequest {
            substance: Some("Latex".to_owned()),
            reaction: Some("Wheezing".to_owned()),
            severity: Some(AllergySeverity::Severe),
            status: None,
        },
    )
    .await
    .expect("allergy update succeeds")
    .expect("allergy exists");
    assert_eq!(updated.substance, "Latex");
    assert_eq!(updated.reaction, Some("Wheezing".to_owned()));
    assert!(matches!(updated.severity, AllergySeverity::Severe));

    assert!(hms_db::clinical::update_allergy(
        &pool,
        uuid::Uuid::new_v4(),
        allergy.id,
        UpdateAllergyRequest {
            substance: Some("Cross facility".to_owned()),
            reaction: None,
            severity: None,
            status: None,
        },
    )
    .await
    .expect("cross-facility allergy update succeeds")
    .is_none());

    let deactivated = hms_db::clinical::deactivate_allergy(&pool, facility_id, allergy.id)
        .await
        .expect("allergy deactivation succeeds")
        .expect("allergy exists");
    assert!(matches!(deactivated.status, AllergyStatus::Inactive));

    assert!(
        hms_db::clinical::get_allergy(&pool, uuid::Uuid::new_v4(), allergy.id)
            .await
            .expect("cross-facility allergy detail query succeeds")
            .is_none()
    );
}

#[tokio::test]
async fn prescription_detail_updates_are_facility_scoped() {
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

    let prescription = hms_db::clinical::create_prescription(
        &pool,
        NewPrescription {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            medication_name: "Amlodipine".to_owned(),
            dose: "5 mg".to_owned(),
            route: "oral".to_owned(),
            frequency: "daily".to_owned(),
            inventory_item_id: None,
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("prescription is created");

    let detail = hms_db::clinical::get_prescription(&pool, facility_id, prescription.id)
        .await
        .expect("prescription detail query succeeds")
        .expect("prescription exists");
    assert_eq!(detail.medication_name, "Amlodipine");

    let updated = hms_db::clinical::update_prescription(
        &pool,
        facility_id,
        prescription.id,
        UpdatePrescriptionRequest {
            medication_name: None,
            dose: Some("10 mg".to_owned()),
            route: None,
            frequency: Some("twice daily".to_owned()),
            inventory_item_id: None,
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            status: Some(PrescriptionStatus::Stopped),
        },
    )
    .await
    .expect("prescription update succeeds")
    .expect("prescription exists");
    assert_eq!(updated.dose, "10 mg");
    assert_eq!(updated.frequency, "twice daily");
    assert!(matches!(updated.status, PrescriptionStatus::Stopped));

    let held = hms_db::clinical::update_prescription(
        &pool,
        facility_id,
        prescription.id,
        UpdatePrescriptionRequest {
            medication_name: None,
            dose: None,
            route: None,
            frequency: None,
            inventory_item_id: None,
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            status: Some(PrescriptionStatus::OnHold),
        },
    )
    .await
    .expect("prescription hold succeeds")
    .expect("prescription exists");
    assert!(matches!(held.status, PrescriptionStatus::OnHold));

    assert!(hms_db::clinical::update_prescription(
        &pool,
        uuid::Uuid::new_v4(),
        prescription.id,
        UpdatePrescriptionRequest {
            medication_name: Some("Cross facility".to_owned()),
            dose: None,
            route: None,
            frequency: None,
            inventory_item_id: None,
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            status: None,
        },
    )
    .await
    .expect("cross-facility prescription update succeeds")
    .is_none());

    assert!(
        hms_db::clinical::get_prescription(&pool, uuid::Uuid::new_v4(), prescription.id)
            .await
            .expect("cross-facility prescription detail query succeeds")
            .is_none()
    );
}

#[tokio::test]
async fn problem_updates_are_facility_scoped() {
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

    let problem = hms_db::clinical::create_problem(
        &pool,
        NewProblem {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            label: "Hypertension".to_owned(),
            onset_date: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("problem is created");

    let updated = hms_db::clinical::update_problem(
        &pool,
        facility_id,
        problem.id,
        UpdateProblemRequest {
            label: Some("Essential hypertension".to_owned()),
            onset_date: Some(NaiveDate::from_ymd_opt(2026, 1, 5).expect("date is valid")),
            status: Some(ProblemStatus::Resolved),
        },
    )
    .await
    .expect("problem update succeeds")
    .expect("problem exists");
    assert_eq!(updated.label, "Essential hypertension");
    assert_eq!(
        updated.onset_date,
        Some(NaiveDate::from_ymd_opt(2026, 1, 5).unwrap())
    );
    assert_eq!(updated.status, ProblemStatus::Resolved);

    assert!(hms_db::clinical::update_problem(
        &pool,
        uuid::Uuid::new_v4(),
        problem.id,
        UpdateProblemRequest {
            label: Some("Cross Facility".to_owned()),
            onset_date: None,
            status: None,
        },
    )
    .await
    .expect("cross-facility problem update succeeds")
    .is_none());
}
