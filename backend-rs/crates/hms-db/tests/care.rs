use chrono::{NaiveDate, TimeZone, Utc};
use hms_db::care::{
    AppointmentUpdate, BlockedTimeScope, ClinicSessionMode, ClinicSessionOwnerType, ClinicUpdate,
    EncounterUpdate, NewAppointmentSeries, NewAppointmentType, NewBlockedTime,
    NewBookedAppointment, NewClinic, NewClinicSession, NewEncounter, NewTriage, NewVisit,
    TriageFilters,
};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::care::{
    AppointmentStatus, EncounterStatus, EncounterType, TriageAcuity, TriageAssessmentRequest,
    TriageStatus, VisitStatus,
};
use hms_domain::deployment::DeploymentProfile;

#[tokio::test]
async fn clinic_repository_manages_clinics_with_facility_scope() {
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

    let clinic = hms_db::care::create_clinic(
        &pool,
        NewClinic {
            id: uuid::Uuid::new_v4(),
            facility_id,
            code: "dermatology".to_owned(),
            name: "Dermatology".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("clinic creates");
    assert_eq!(clinic.code, "dermatology");
    assert_eq!(clinic.name, "Dermatology");
    assert!(clinic.is_active);

    let updated = hms_db::care::update_clinic(
        &pool,
        ClinicUpdate {
            facility_id,
            id: clinic.id,
            code: Some("skin".to_owned()),
            name: Some("Skin Clinic".to_owned()),
            is_active: Some(false),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("clinic updates")
    .expect("clinic exists");
    assert_eq!(updated.code, "skin");
    assert_eq!(updated.name, "Skin Clinic");
    assert!(!updated.is_active);

    let deactivated = hms_db::care::deactivate_clinic(&pool, facility_id, clinic.id, owner_id)
        .await
        .expect("clinic deactivates")
        .expect("clinic exists");
    assert!(!deactivated.is_active);

    assert!(hms_db::care::update_clinic(
        &pool,
        ClinicUpdate {
            facility_id: uuid::Uuid::new_v4(),
            id: clinic.id,
            code: None,
            name: Some("Wrong facility".to_owned()),
            is_active: None,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("cross-facility update succeeds")
    .is_none());
    assert!(
        hms_db::care::deactivate_clinic(&pool, uuid::Uuid::new_v4(), clinic.id, owner_id)
            .await
            .expect("cross-facility deactivate succeeds")
            .is_none()
    );
}

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
    let appointment = hms_db::care::create_booked_appointment(
        &pool,
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            clinic_id: None,
            clinic_session_id: None,
            appointment_type_id: None,
            practitioner_user_id: None,
            starts_at: Utc
                .with_ymd_and_hms(2026, 5, 11, 9, 0, 0)
                .single()
                .expect("static timestamp is valid"),
            ends_at: Utc
                .with_ymd_and_hms(2026, 5, 11, 9, 30, 0)
                .single()
                .expect("static timestamp is valid"),
            overbook_reason: None,
            series_id: None,
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

    let cancelled = hms_db::care::cancel_appointment(
        &pool,
        facility_id,
        appointment.id,
        owner_id,
        "Patient unavailable".to_owned(),
    )
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
async fn clinic_session_capacity_block_cancellation_and_reschedule_history_are_enforced() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test db is available");
    let patient_one = db
        .scenario("session-capacity-one")
        .registered_patient()
        .await
        .expect("patient one exists");
    let patient_two = db
        .scenario("session-capacity-two")
        .registered_patient()
        .await
        .expect("patient two exists");
    let clinic = hms_db::care::create_clinic(
        db.pool(),
        NewClinic {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            code: "CARDIO-CAP".to_owned(),
            name: "Cardiology Capacity".to_owned(),
            actor_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("clinic creates");
    let session = hms_db::care::create_clinic_session(
        db.pool(),
        NewClinicSession {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            clinic_id: Some(clinic.id),
            service_code: Some("cardiology".to_owned()),
            practitioner_user_id: None,
            owner_type: ClinicSessionOwnerType::Clinic,
            owner_id: Some(clinic.id),
            name: "Morning cardiology book".to_owned(),
            mode: ClinicSessionMode::CapacityBlock,
            starts_at: Utc.with_ymd_and_hms(2030, 6, 3, 8, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 6, 3, 12, 0, 0).unwrap(),
            slot_minutes: None,
            capacity: 1,
            allow_overbooking: false,
            overbook_limit: 0,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("session creates");

    let appointment = hms_db::care::create_booked_appointment(
        db.pool(),
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: patient_one.id,
            clinic_id: Some(clinic.id),
            clinic_session_id: Some(session.id),
            appointment_type_id: None,
            practitioner_user_id: None,
            starts_at: Utc.with_ymd_and_hms(2030, 6, 3, 9, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 6, 3, 9, 30, 0).unwrap(),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("first appointment fits capacity");

    let full_result = hms_db::care::create_booked_appointment(
        db.pool(),
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: patient_two.id,
            clinic_id: Some(clinic.id),
            clinic_session_id: Some(session.id),
            appointment_type_id: None,
            practitioner_user_id: None,
            starts_at: Utc.with_ymd_and_hms(2030, 6, 3, 9, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 6, 3, 9, 30, 0).unwrap(),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await;
    assert!(
        full_result.is_err(),
        "full capacity should reject a second booking"
    );

    let rescheduled = hms_db::care::update_appointment(
        db.pool(),
        AppointmentUpdate {
            id: appointment.id,
            facility_id: db.facility_id(),
            starts_at: Some(Utc.with_ymd_and_hms(2030, 6, 3, 10, 0, 0).unwrap()),
            ends_at: Some(Utc.with_ymd_and_hms(2030, 6, 3, 10, 30, 0).unwrap()),
            actor_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("reschedule succeeds")
    .expect("appointment exists");
    assert_eq!(rescheduled.id, appointment.id);
    let history = hms_db::care::appointment_history(db.pool(), db.facility_id(), appointment.id)
        .await
        .expect("history loads");
    assert!(history
        .iter()
        .any(|event| event.event_type == "rescheduled"));

    let cancelled = hms_db::care::cancel_appointment(
        db.pool(),
        db.facility_id(),
        appointment.id,
        db.owner_user_id(),
        "Patient requested a different week".to_owned(),
    )
    .await
    .expect("appointment cancel succeeds")
    .expect("appointment remains in facility");
    assert_eq!(cancelled.status, AppointmentStatus::Cancelled);
    assert_eq!(
        cancelled.cancellation_reason.as_deref(),
        Some("Patient requested a different week")
    );

    hms_db::care::create_booked_appointment(
        db.pool(),
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: patient_two.id,
            clinic_id: Some(clinic.id),
            clinic_session_id: Some(session.id),
            appointment_type_id: None,
            practitioner_user_id: None,
            starts_at: Utc.with_ymd_and_hms(2030, 6, 3, 10, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 6, 3, 10, 30, 0).unwrap(),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("cancelled appointment frees capacity");
}

#[tokio::test]
async fn clinic_session_overbooking_blocked_time_types_and_series_are_policy_bound() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test db is available");
    let patient = db
        .scenario("session-policy")
        .registered_patient()
        .await
        .expect("patient exists");
    let clinic = hms_db::care::create_clinic(
        db.pool(),
        NewClinic {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            code: "ORTHO-BOOK".to_owned(),
            name: "Orthopaedic Book".to_owned(),
            actor_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("clinic creates");
    let appointment_type = hms_db::care::create_appointment_type(
        db.pool(),
        NewAppointmentType {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            code: "review".to_owned(),
            name: "Review".to_owned(),
            default_duration_minutes: 20,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("appointment type creates");
    let session = hms_db::care::create_clinic_session(
        db.pool(),
        NewClinicSession {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            clinic_id: Some(clinic.id),
            service_code: Some("orthopaedics".to_owned()),
            practitioner_user_id: Some(db.owner_user_id()),
            owner_type: ClinicSessionOwnerType::Practitioner,
            owner_id: Some(db.owner_user_id()),
            name: "Orthopaedic reviews".to_owned(),
            mode: ClinicSessionMode::FixedSlot,
            starts_at: Utc.with_ymd_and_hms(2030, 7, 4, 8, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 7, 4, 12, 0, 0).unwrap(),
            slot_minutes: Some(20),
            capacity: 1,
            allow_overbooking: true,
            overbook_limit: 1,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("session creates");
    hms_db::care::constrain_appointment_type_to_session(
        db.pool(),
        db.facility_id(),
        session.id,
        appointment_type.id,
    )
    .await
    .expect("session type constraint saves");
    hms_db::care::create_blocked_time(
        db.pool(),
        NewBlockedTime {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            scope: BlockedTimeScope::Session,
            clinic_session_id: Some(session.id),
            practitioner_user_id: None,
            starts_at: Utc.with_ymd_and_hms(2030, 7, 4, 11, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 7, 4, 11, 20, 0).unwrap(),
            reason: "Team meeting".to_owned(),
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("blocked time saves");

    let first = hms_db::care::create_booked_appointment(
        db.pool(),
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: patient.id,
            clinic_id: Some(clinic.id),
            clinic_session_id: Some(session.id),
            appointment_type_id: Some(appointment_type.id),
            practitioner_user_id: Some(db.owner_user_id()),
            starts_at: Utc.with_ymd_and_hms(2030, 7, 4, 9, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 7, 4, 9, 20, 0).unwrap(),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("first fixed slot booking succeeds");
    assert_eq!(first.clinic_session_id, Some(session.id));
    assert_eq!(first.appointment_type_id, Some(appointment_type.id));

    let missing_reason = hms_db::care::create_booked_appointment(
        db.pool(),
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: patient.id,
            clinic_id: Some(clinic.id),
            clinic_session_id: Some(session.id),
            appointment_type_id: Some(appointment_type.id),
            practitioner_user_id: Some(db.owner_user_id()),
            starts_at: Utc.with_ymd_and_hms(2030, 7, 4, 9, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 7, 4, 9, 20, 0).unwrap(),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await;
    assert!(missing_reason.is_err(), "overbooking must include a reason");

    let overbooked = hms_db::care::create_booked_appointment(
        db.pool(),
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: patient.id,
            clinic_id: Some(clinic.id),
            clinic_session_id: Some(session.id),
            appointment_type_id: Some(appointment_type.id),
            practitioner_user_id: Some(db.owner_user_id()),
            starts_at: Utc.with_ymd_and_hms(2030, 7, 4, 9, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 7, 4, 9, 20, 0).unwrap(),
            overbook_reason: Some("Consultant approved urgent review".to_owned()),
            series_id: None,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("policy-backed overbooking succeeds");
    assert_eq!(
        overbooked.overbook_reason.as_deref(),
        Some("Consultant approved urgent review")
    );
    let history = hms_db::care::appointment_history(db.pool(), db.facility_id(), overbooked.id)
        .await
        .expect("history loads");
    assert!(history.iter().any(|event| event.event_type == "overbooked"));

    let blocked = hms_db::care::create_booked_appointment(
        db.pool(),
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: patient.id,
            clinic_id: Some(clinic.id),
            clinic_session_id: Some(session.id),
            appointment_type_id: Some(appointment_type.id),
            practitioner_user_id: Some(db.owner_user_id()),
            starts_at: Utc.with_ymd_and_hms(2030, 7, 4, 11, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2030, 7, 4, 11, 20, 0).unwrap(),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await;
    assert!(
        blocked.is_err(),
        "blocked session time must reject bookings"
    );

    let series = hms_db::care::create_appointment_series(
        db.pool(),
        NewAppointmentSeries {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: patient.id,
            clinic_id: Some(clinic.id),
            clinic_session_id: None,
            appointment_type_id: Some(appointment_type.id),
            practitioner_user_id: Some(db.owner_user_id()),
            starts_at: vec![
                Utc.with_ymd_and_hms(2030, 7, 8, 9, 0, 0).unwrap(),
                Utc.with_ymd_and_hms(2030, 7, 15, 9, 0, 0).unwrap(),
            ],
            duration_minutes: 20,
            repeat_rule: Some("weekly".to_owned()),
            created_by_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("selected-date series creates");
    assert_eq!(series.appointments.len(), 2);
    assert!(series
        .appointments
        .iter()
        .all(|appointment| appointment.series_id == Some(series.series_id)));
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
    let default_clinic_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM clinics WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("default clinic exists");
    let other_clinic_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO clinics (id, facility_id, code, name)
         VALUES ($1, $2, 'OTHER-APPT', 'Other Appointment Clinic')",
    )
    .bind(other_clinic_id)
    .bind(facility_id)
    .execute(&pool)
    .await
    .expect("other clinic inserts");

    let target = hms_db::care::create_booked_appointment(
        &pool,
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            clinic_id: None,
            clinic_session_id: None,
            appointment_type_id: None,
            practitioner_user_id: None,
            starts_at: Utc
                .with_ymd_and_hms(2030, 5, 12, 9, 0, 0)
                .single()
                .expect("static timestamp is valid"),
            ends_at: Utc
                .with_ymd_and_hms(2030, 5, 12, 9, 30, 0)
                .single()
                .expect("static timestamp is valid"),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("target appointment is created");
    let other_day = hms_db::care::create_booked_appointment(
        &pool,
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            clinic_id: None,
            clinic_session_id: None,
            appointment_type_id: None,
            practitioner_user_id: None,
            starts_at: Utc
                .with_ymd_and_hms(2030, 5, 13, 9, 0, 0)
                .single()
                .expect("static timestamp is valid"),
            ends_at: Utc
                .with_ymd_and_hms(2030, 5, 13, 9, 30, 0)
                .single()
                .expect("static timestamp is valid"),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("other appointment is created");
    let other_clinic_same_day = hms_db::care::create_booked_appointment(
        &pool,
        NewBookedAppointment {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            clinic_id: None,
            clinic_session_id: None,
            appointment_type_id: None,
            practitioner_user_id: None,
            starts_at: Utc
                .with_ymd_and_hms(2030, 5, 12, 10, 0, 0)
                .single()
                .expect("static timestamp is valid"),
            ends_at: Utc
                .with_ymd_and_hms(2030, 5, 12, 10, 30, 0)
                .single()
                .expect("static timestamp is valid"),
            overbook_reason: None,
            series_id: None,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("other clinic same-day appointment is created");
    sqlx::query("UPDATE appointments SET clinic_id = $1 WHERE id = $2")
        .bind(other_clinic_id)
        .bind(other_clinic_same_day.id)
        .execute(&pool)
        .await
        .expect("same-day appointment moves to other clinic");

    let filtered = hms_db::care::list_appointments(
        &pool,
        facility_id,
        None,
        Some(NaiveDate::from_ymd_opt(2030, 5, 12).expect("static date is valid")),
        Some(default_clinic_id),
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
    assert!(!filtered
        .iter()
        .any(|appointment| appointment.id == other_clinic_same_day.id));
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

    let urgent_completed_triage = hms_db::care::list_triage(
        &pool,
        facility_id,
        None,
        10,
        TriageFilters {
            acuity: Some(TriageAcuity::Emergency),
            status: Some(TriageStatus::Completed),
        },
    )
    .await
    .expect("filtered triage queue loads");
    assert_eq!(urgent_completed_triage.len(), 1);
    assert_eq!(urgent_completed_triage[0].id, assessed.id);
    assert_eq!(urgent_completed_triage[0].acuity, TriageAcuity::Emergency);
    assert_eq!(urgent_completed_triage[0].status, TriageStatus::Completed);

    let cross_facility_filtered_triage = hms_db::care::list_triage(
        &pool,
        uuid::Uuid::new_v4(),
        None,
        10,
        TriageFilters {
            acuity: Some(TriageAcuity::Emergency),
            status: Some(TriageStatus::Completed),
        },
    )
    .await
    .expect("cross-facility filtered triage queue loads");
    assert!(cross_facility_filtered_triage.is_empty());

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
