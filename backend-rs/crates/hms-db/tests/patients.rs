use chrono::{Datelike, NaiveDate, Utc};
use hms_db::clinical::{NewAllergy, NewChartEntry, NewClinicalNote, NewPrescription, NewProblem};
use hms_db::patients::{PatientContextCursor, PatientUpdate};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::clinical::{AllergySeverity, ChartEntryType};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::patients::{PatientAdministrativeStatus, Sex};

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
    )
    .await
    .expect("context patients list succeeds");

    assert!(!context.is_empty());
    assert_eq!(context[0].id, patient_id);
    assert_eq!(context[0].display_name, "Akua Mensah");
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

    hms_db::clinical::create_note(
        &pool,
        NewClinicalNote {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            note_type: "general".to_owned(),
            title: "Summary note".to_owned(),
            body: "Clinical summary body.".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("note is created");
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
            frequency: "daily".to_owned(),
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
            entry_type: ChartEntryType::BloodPressure,
            measured_at: Utc::now(),
            value: "130/82".to_owned(),
            unit: Some("mmHg".to_owned()),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("chart entry is created");

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
