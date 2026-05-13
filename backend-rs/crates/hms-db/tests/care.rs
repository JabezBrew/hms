use chrono::{NaiveDate, TimeZone, Utc};
use hms_db::care::{
    AppointmentUpdate, EncounterUpdate, NewAppointment, NewEncounter, NewTriage, NewVisit,
};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::care::{
    AppointmentStatus, EncounterStatus, EncounterType, TriageAcuity, TriageAssessmentRequest,
    TriageStatus, VisitStatus,
};
use hms_domain::deployment::DeploymentProfile;

#[tokio::test]
async fn appointment_detail_update_and_cancel_repository_stays_facility_scoped() {
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
    let appointment = hms_db::care::create_appointment(
        &pool,
        NewAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            starts_at: Utc
                .with_ymd_and_hms(2026, 5, 11, 9, 0, 0)
                .single()
                .expect("static timestamp is valid"),
            ends_at: Utc
                .with_ymd_and_hms(2026, 5, 11, 9, 30, 0)
                .single()
                .expect("static timestamp is valid"),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("appointment is created");

    let loaded = hms_db::care::get_appointment(&pool, facility_id, appointment.id)
        .await
        .expect("appointment lookup succeeds")
        .expect("appointment exists");
    assert_eq!(loaded.patient_id, patient_id);
    assert_eq!(loaded.status, AppointmentStatus::Scheduled);

    let updated = hms_db::care::update_appointment(
        &pool,
        AppointmentUpdate {
            id: appointment.id,
            facility_id,
            starts_at: Some(
                Utc.with_ymd_and_hms(2026, 5, 11, 10, 0, 0)
                    .single()
                    .expect("static timestamp is valid"),
            ),
            ends_at: Some(
                Utc.with_ymd_and_hms(2026, 5, 11, 10, 45, 0)
                    .single()
                    .expect("static timestamp is valid"),
            ),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("appointment update succeeds")
    .expect("appointment remains in facility");
    assert_eq!(
        updated.starts_at,
        Utc.with_ymd_and_hms(2026, 5, 11, 10, 0, 0)
            .single()
            .expect("static timestamp is valid")
    );

    let cancelled = hms_db::care::cancel_appointment(&pool, facility_id, appointment.id, owner_id)
        .await
        .expect("appointment cancel succeeds")
        .expect("appointment remains in facility");
    assert_eq!(cancelled.status, AppointmentStatus::Cancelled);

    assert!(
        hms_db::care::get_appointment(&pool, uuid::Uuid::new_v4(), appointment.id)
            .await
            .expect("cross-facility lookup succeeds")
            .is_none()
    );
}

#[tokio::test]
async fn appointment_list_can_filter_by_schedule_date() {
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

    let target = hms_db::care::create_appointment(
        &pool,
        NewAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            starts_at: Utc
                .with_ymd_and_hms(2030, 5, 12, 9, 0, 0)
                .single()
                .expect("static timestamp is valid"),
            ends_at: Utc
                .with_ymd_and_hms(2030, 5, 12, 9, 30, 0)
                .single()
                .expect("static timestamp is valid"),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("target appointment is created");
    let other_day = hms_db::care::create_appointment(
        &pool,
        NewAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            starts_at: Utc
                .with_ymd_and_hms(2030, 5, 13, 9, 0, 0)
                .single()
                .expect("static timestamp is valid"),
            ends_at: Utc
                .with_ymd_and_hms(2030, 5, 13, 9, 30, 0)
                .single()
                .expect("static timestamp is valid"),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("other appointment is created");

    let filtered = hms_db::care::list_appointments(
        &pool,
        facility_id,
        None,
        Some(NaiveDate::from_ymd_opt(2030, 5, 12).expect("static date is valid")),
        25,
    )
    .await
    .expect("appointment list filters by date");

    assert!(filtered
        .iter()
        .any(|appointment| appointment.id == target.id));
    assert!(!filtered
        .iter()
        .any(|appointment| appointment.id == other_day.id));
    assert!(filtered
        .iter()
        .all(|appointment| appointment.starts_at.date_naive()
            == NaiveDate::from_ymd_opt(2030, 5, 12).expect("static date is valid")));
}

#[tokio::test]
async fn encounter_detail_update_repository_stays_patient_and_facility_scoped() {
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
    let other_patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 AND id <> $2 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .expect("second patient exists");

    let encounter = hms_db::care::create_encounter(
        &pool,
        NewEncounter {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            visit_id: None,
            encounter_type: EncounterType::Outpatient,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("encounter is created");

    let loaded = hms_db::care::get_encounter(&pool, facility_id, encounter.id)
        .await
        .expect("encounter lookup succeeds")
        .expect("encounter exists");
    assert_eq!(loaded.patient_id, patient_id);
    assert_eq!(loaded.status, EncounterStatus::InProgress);

    let other_encounter = hms_db::care::create_encounter(
        &pool,
        NewEncounter {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: other_patient_id,
            visit_id: None,
            encounter_type: EncounterType::Outpatient,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("other encounter is created");

    let patient_encounters =
        hms_db::care::list_encounters(&pool, facility_id, Some(patient_id), None, 25)
            .await
            .expect("patient encounter list succeeds");
    assert_eq!(patient_encounters.len(), 1);
    assert_eq!(patient_encounters[0].id, encounter.id);
    assert_ne!(patient_encounters[0].id, other_encounter.id);

    let updated = hms_db::care::update_encounter(
        &pool,
        EncounterUpdate {
            id: encounter.id,
            facility_id,
            visit_id: None,
            encounter_type: Some(EncounterType::Emergency),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("encounter update succeeds")
    .expect("encounter remains in facility");
    assert_eq!(updated.encounter_type, EncounterType::Emergency);

    let completed = hms_db::care::update_encounter_status(
        &pool,
        facility_id,
        encounter.id,
        EncounterStatus::Completed,
    )
    .await
    .expect("encounter completion succeeds")
    .expect("encounter remains in facility");
    assert_eq!(completed.status, EncounterStatus::Completed);

    assert!(hms_db::care::update_encounter(
        &pool,
        EncounterUpdate {
            id: encounter.id,
            facility_id,
            visit_id: None,
            encounter_type: Some(EncounterType::Triage),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("completed encounter update query succeeds")
    .is_none());

    assert!(
        hms_db::care::get_encounter(&pool, uuid::Uuid::new_v4(), encounter.id)
            .await
            .expect("cross-facility lookup succeeds")
            .is_none()
    );
}

#[tokio::test]
async fn visit_repository_filters_waiting_room_by_clinic() {
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
    let patient_ids = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 2",
    )
    .bind(facility_id)
    .fetch_all(&pool)
    .await
    .expect("patients exist");
    assert_eq!(patient_ids.len(), 2);

    let general_clinic_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM clinics WHERE facility_id = $1 AND code = 'general'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("general clinic exists");
    let general_clinic = hms_db::care::get_clinic(&pool, facility_id, general_clinic_id)
        .await
        .expect("clinic detail lookup succeeds")
        .expect("clinic exists");
    assert_eq!(general_clinic.code, "general");
    assert_eq!(general_clinic.name, "General Clinic");
    assert!(
        hms_db::care::get_clinic(&pool, uuid::Uuid::new_v4(), general_clinic_id)
            .await
            .expect("cross-facility clinic detail lookup succeeds")
            .is_none()
    );
    let overflow_clinic_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO clinics (id, facility_id, code, name) VALUES ($1, $2, 'overflow', 'Overflow Clinic')",
    )
    .bind(overflow_clinic_id)
    .bind(facility_id)
    .execute(&pool)
    .await
    .expect("overflow clinic is created");
    let assessment_clinic_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO clinics (id, facility_id, code, name) VALUES ($1, $2, 'assessment', 'Assessment Clinic')",
    )
    .bind(assessment_clinic_id)
    .bind(facility_id)
    .execute(&pool)
    .await
    .expect("assessment clinic is created");

    let general_visit = hms_db::care::check_in_visit(
        &pool,
        NewVisit {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: patient_ids[0],
            appointment_id: None,
            clinic_id: Some(general_clinic_id),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("general visit is checked in");
    let triage = hms_db::care::create_triage(
        &pool,
        NewTriage {
            id: uuid::Uuid::new_v4(),
            facility_id,
            visit_id: general_visit.id,
            patient_id: general_visit.patient_id,
            acuity: TriageAcuity::Urgent,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("triage item is created");
    assert_eq!(triage.status, TriageStatus::Waiting);
    let cancelled_triage = hms_db::care::cancel_triage(&pool, facility_id, triage.id)
        .await
        .expect("triage cancel query succeeds")
        .expect("triage item exists");
    assert_eq!(cancelled_triage.status, TriageStatus::Cancelled);
    let cancelled_visit = hms_db::care::get_visit(&pool, facility_id, general_visit.id)
        .await
        .expect("visit lookup succeeds")
        .expect("visit exists");
    assert_eq!(cancelled_visit.status, VisitStatus::Cancelled);
    assert!(
        hms_db::care::cancel_triage(&pool, uuid::Uuid::new_v4(), triage.id)
            .await
            .expect("cross-facility triage cancel query succeeds")
            .is_none()
    );

    let assessed_visit = hms_db::care::check_in_visit(
        &pool,
        NewVisit {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: patient_ids[1],
            appointment_id: None,
            clinic_id: Some(assessment_clinic_id),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("assessed visit is checked in");
    let assessed_triage = hms_db::care::create_triage(
        &pool,
        NewTriage {
            id: uuid::Uuid::new_v4(),
            facility_id,
            visit_id: assessed_visit.id,
            patient_id: assessed_visit.patient_id,
            acuity: TriageAcuity::Routine,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("assessed triage item is created");
    let assessed = hms_db::care::assess_triage(
        &pool,
        facility_id,
        assessed_triage.id,
        TriageAssessmentRequest {
            acuity: Some(TriageAcuity::Emergency),
            notes: Some("Chest pain and diaphoresis.".to_owned()),
        },
    )
    .await
    .expect("triage assessment query succeeds")
    .expect("triage item exists");
    assert_eq!(assessed.status, TriageStatus::Completed);
    assert_eq!(assessed.acuity, TriageAcuity::Emergency);
    assert_eq!(
        assessed.triage_notes.as_deref(),
        Some("Chest pain and diaphoresis.")
    );
    assert!(hms_db::care::assess_triage(
        &pool,
        uuid::Uuid::new_v4(),
        assessed_triage.id,
        TriageAssessmentRequest {
            acuity: Some(TriageAcuity::Urgent),
            notes: Some("Cross facility".to_owned()),
        },
    )
    .await
    .expect("cross-facility triage assessment query succeeds")
    .is_none());

    let overflow_visit = hms_db::care::check_in_visit(
        &pool,
        NewVisit {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: patient_ids[1],
            appointment_id: None,
            clinic_id: Some(overflow_clinic_id),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("overflow visit is checked in");

    let general_visits =
        hms_db::care::list_visits(&pool, facility_id, Some(general_clinic_id), None, 10)
            .await
            .expect("general clinic visits load");
    assert_eq!(general_visits.len(), 1);
    assert_eq!(general_visits[0].id, general_visit.id);
    assert_eq!(general_visits[0].clinic_id, Some(general_clinic_id));

    let overflow_visits =
        hms_db::care::list_visits(&pool, facility_id, Some(overflow_clinic_id), None, 10)
            .await
            .expect("overflow clinic visits load");
    assert_eq!(overflow_visits.len(), 1);
    assert_eq!(overflow_visits[0].id, overflow_visit.id);
    assert_eq!(overflow_visits[0].clinic_id, Some(overflow_clinic_id));
}
