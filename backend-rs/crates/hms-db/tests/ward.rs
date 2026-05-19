use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_db::ward::{
    AdmissionContext, BedUpdate, NewAdmissionCase, NewBed, NewFluidBalanceEntry,
    NewMonitoringEvent, NewNursingAlert, NewNursingTask, NewPatientVitals, NewWard, NewWardSection,
    NewWardStockRequest, WardSectionUpdate, WardUpdate,
};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::ward::{
    AdmissionStatus, BedStatus, DischargeBlockerKind, DischargeBlockerStatus, DischargeStatus,
    MonitoringEventKind, NursingAlertSeverity, NursingAlertStatus, NursingTaskStatus,
    NursingTaskType, WardStatus, WardStockRequestStatus,
};

#[tokio::test]
async fn ward_detail_sections_and_beds_are_bounded_and_facility_scoped() {
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
    let created_ward = hms_db::ward::create_ward(
        &pool,
        NewWard {
            id: uuid::Uuid::new_v4(),
            facility_id,
            code: "TEST-WARD".to_owned(),
            name: "Test Ward".to_owned(),
        },
    )
    .await
    .expect("ward create succeeds");
    assert_eq!(created_ward.code, "TEST-WARD");
    assert_eq!(created_ward.name, "Test Ward");
    assert_eq!(created_ward.status, WardStatus::Active);
    assert_eq!(created_ward.active_bed_count, 0);
    assert_eq!(created_ward.occupied_bed_count, 0);
    assert!(
        hms_db::ward::get_ward(&pool, uuid::Uuid::new_v4(), created_ward.id)
            .await
            .expect("cross-facility created ward lookup succeeds")
            .is_none()
    );
    let updated_ward = hms_db::ward::update_ward(
        &pool,
        facility_id,
        created_ward.id,
        WardUpdate {
            code: Some("TEST-WARD-RENAMED".to_owned()),
            name: Some("Renamed Test Ward".to_owned()),
            status: Some(WardStatus::Inactive),
        },
    )
    .await
    .expect("ward update succeeds")
    .expect("ward update returns row");
    assert_eq!(updated_ward.code, "TEST-WARD-RENAMED");
    assert_eq!(updated_ward.name, "Renamed Test Ward");
    assert_eq!(updated_ward.status, WardStatus::Inactive);
    assert!(hms_db::ward::update_ward(
        &pool,
        uuid::Uuid::new_v4(),
        created_ward.id,
        WardUpdate {
            code: Some("CROSS-FACILITY".to_owned()),
            name: Some("Cross Facility".to_owned()),
            status: Some(WardStatus::Active),
        },
    )
    .await
    .expect("cross-facility ward update succeeds")
    .is_none());

    let ward_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM wards WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("ward exists");

    let ward = hms_db::ward::get_ward(&pool, facility_id, ward_id)
        .await
        .expect("ward lookup succeeds")
        .expect("ward exists");
    assert_eq!(ward.id, ward_id);
    assert_eq!(ward.status, WardStatus::Active);

    let section = hms_db::ward::create_ward_section(
        &pool,
        NewWardSection {
            id: uuid::Uuid::new_v4(),
            facility_id,
            ward_id,
            code: "EAST".to_owned(),
            name: "East Section".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("section create succeeds");
    let bed = hms_db::ward::create_bed(
        &pool,
        NewBed {
            id: uuid::Uuid::new_v4(),
            facility_id,
            ward_id,
            section_id: Some(section.id),
            bed_code: "E-99".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("bed create succeeds");
    assert_eq!(bed.status, BedStatus::Available);
    let updated_bed = hms_db::ward::update_bed(
        &pool,
        facility_id,
        bed.id,
        BedUpdate {
            section_id: Some(section.id),
            bed_code: Some("E-100".to_owned()),
            status: Some(BedStatus::Cleaning),
        },
    )
    .await
    .expect("bed update succeeds")
    .expect("bed update returns row");
    assert_eq!(updated_bed.bed_code, "E-100");
    assert_eq!(updated_bed.status, BedStatus::Cleaning);
    assert_eq!(updated_bed.section_id, Some(section.id));
    assert!(hms_db::ward::update_bed(
        &pool,
        uuid::Uuid::new_v4(),
        bed.id,
        BedUpdate {
            section_id: Some(section.id),
            bed_code: Some("CROSS-FACILITY".to_owned()),
            status: Some(BedStatus::Available),
        },
    )
    .await
    .expect("cross-facility bed update succeeds")
    .is_none());
    let updated_section = hms_db::ward::update_ward_section(
        &pool,
        facility_id,
        section.id,
        WardSectionUpdate {
            code: Some("EAST-RENAMED".to_owned()),
            name: Some("Renamed East Section".to_owned()),
            status: Some(WardStatus::Inactive),
        },
    )
    .await
    .expect("section update succeeds")
    .expect("section update returns row");
    assert_eq!(updated_section.code, "EAST-RENAMED");
    assert_eq!(updated_section.name, "Renamed East Section");
    assert_eq!(updated_section.status, WardStatus::Inactive);
    assert!(hms_db::ward::update_ward_section(
        &pool,
        uuid::Uuid::new_v4(),
        section.id,
        WardSectionUpdate {
            code: Some("CROSS-FACILITY".to_owned()),
            name: Some("Cross Facility".to_owned()),
            status: Some(WardStatus::Active),
        },
    )
    .await
    .expect("cross-facility section update succeeds")
    .is_none());

    let beds = hms_db::ward::list_ward_beds(&pool, facility_id, ward_id, None, 25)
        .await
        .expect("bounded bed lookup succeeds");
    assert!(beds.iter().all(|bed| bed.ward_id == ward_id));
    assert!(beds.iter().any(|candidate| candidate.id == bed.id));

    let sections = hms_db::ward::list_ward_sections(&pool, facility_id, ward_id, None, 25)
        .await
        .expect("section lookup succeeds");
    let created_section = sections
        .iter()
        .find(|candidate| candidate.id == section.id)
        .expect("created section is listed");
    assert_eq!(created_section.active_bed_count, 1);

    assert!(hms_db::ward::get_ward(&pool, uuid::Uuid::new_v4(), ward_id)
        .await
        .expect("cross-facility ward lookup succeeds")
        .is_none());
    assert!(
        hms_db::ward::list_ward_beds(&pool, uuid::Uuid::new_v4(), ward_id, None, 25)
            .await
            .expect("cross-facility bed lookup succeeds")
            .is_empty()
    );
}

fn blocker(
    discharge: &hms_domain::ward::DischargeCaseListItem,
    kind: DischargeBlockerKind,
) -> &hms_domain::ward::DischargeBlocker {
    discharge
        .blockers
        .iter()
        .find(|blocker| blocker.blocker_type == kind)
        .expect("expected blocker exists")
}

#[tokio::test]
async fn ward_list_search_filters_server_side_and_stays_facility_scoped() {
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

    let cardiology = hms_db::ward::create_ward(
        &pool,
        NewWard {
            id: uuid::Uuid::new_v4(),
            facility_id,
            code: "CARDIO".to_owned(),
            name: "Cardiology North".to_owned(),
        },
    )
    .await
    .expect("cardiology ward create succeeds");
    hms_db::ward::create_ward(
        &pool,
        NewWard {
            id: uuid::Uuid::new_v4(),
            facility_id,
            code: "SURG".to_owned(),
            name: "Surgical Overflow".to_owned(),
        },
    )
    .await
    .expect("surgical ward create succeeds");
    let rows = hms_db::ward::list_wards(&pool, facility_id, None, 25, Some("cardio"))
        .await
        .expect("ward search succeeds");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, cardiology.id);
    assert_eq!(rows[0].code, "CARDIO");

    let cross_facility_rows =
        hms_db::ward::list_wards(&pool, uuid::Uuid::new_v4(), None, 25, Some("cardio"))
            .await
            .expect("cross-facility ward search succeeds");
    assert!(cross_facility_rows.is_empty());

    let wildcard_rows = hms_db::ward::list_wards(&pool, facility_id, None, 25, Some("%"))
        .await
        .expect("wildcard ward search succeeds");
    assert!(wildcard_rows.is_empty());
}

#[tokio::test]
async fn admission_case_reserve_activate_cancel_transitions_are_facility_scoped() {
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
    let ward_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM wards WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("ward exists");
    let patient_ids = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 2",
    )
    .bind(facility_id)
    .fetch_all(&pool)
    .await
    .expect("patients exist");

    let admission_case = hms_db::ward::create_admission_case(
        &pool,
        NewAdmissionCase {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: patient_ids[0],
            ward_id,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("admission case is created");
    assert_eq!(admission_case.status, AdmissionStatus::ReadyForActivation);
    assert!(admission_case.bed_id.is_none());

    let reserved =
        hms_db::ward::reserve_admission_bed(&pool, facility_id, admission_case.id, None, owner_id)
            .await
            .expect("bed reservation query succeeds")
            .expect("bed is reserved");
    assert_eq!(reserved.status, AdmissionStatus::ReadyForActivation);
    assert!(reserved.bed_id.is_some());

    let activated =
        hms_db::ward::activate_admission_case(&pool, facility_id, admission_case.id, owner_id)
            .await
            .expect("activation query succeeds")
            .expect("case is activated");
    assert_eq!(activated.status, AdmissionStatus::Admitted);
    let occupied_status = sqlx::query_scalar::<_, String>("SELECT status FROM beds WHERE id = $1")
        .bind(activated.bed_id.expect("activated case has bed"))
        .fetch_one(&pool)
        .await
        .expect("bed status loads");
    assert_eq!(occupied_status, "occupied");

    let discharge = hms_db::ward::request_discharge(
        &pool,
        uuid::Uuid::new_v4(),
        facility_id,
        &AdmissionContext {
            id: activated.id,
            patient_id: activated.patient_id,
            ward_id: activated.ward_id,
            bed_id: activated.bed_id,
        },
        owner_id,
    )
    .await
    .expect("discharge request succeeds");
    assert_eq!(discharge.status, DischargeStatus::Requested);

    let cancelled_discharge = hms_db::ward::cancel_discharge(&pool, facility_id, discharge.id)
        .await
        .expect("discharge cancel query succeeds")
        .expect("discharge is cancelled");
    assert_eq!(cancelled_discharge.status, DischargeStatus::Cancelled);
    let admission_status_after_cancel =
        sqlx::query_scalar::<_, String>("SELECT status FROM admission_cases WHERE id = $1")
            .bind(activated.id)
            .fetch_one(&pool)
            .await
            .expect("admission status loads");
    assert_eq!(admission_status_after_cancel, "admitted");
    let bed_status_after_cancel =
        sqlx::query_scalar::<_, String>("SELECT status FROM beds WHERE id = $1")
            .bind(activated.bed_id.expect("activated case has bed"))
            .fetch_one(&pool)
            .await
            .expect("bed status after discharge cancel loads");
    assert_eq!(bed_status_after_cancel, "occupied");

    let cancellable = hms_db::ward::create_admission_case(
        &pool,
        NewAdmissionCase {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id: patient_ids[1],
            ward_id,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("cancellable admission case is created");
    let cancelled =
        hms_db::ward::cancel_admission_case(&pool, facility_id, cancellable.id, owner_id)
            .await
            .expect("cancel query succeeds")
            .expect("case is cancelled");
    assert_eq!(cancelled.status, AdmissionStatus::Cancelled);

    assert!(
        hms_db::ward::list_admission_cases(&pool, uuid::Uuid::new_v4(), None, 25)
            .await
            .expect("cross-facility admission list succeeds")
            .is_empty()
    );
}

#[tokio::test]
async fn discharge_blockers_are_source_driven_and_holdable_per_blocker() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test database is available");
    let scenario = db
        .scenario("discharge-blockers")
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

    let discharge = hms_db::ward::request_discharge(
        db.pool(),
        uuid::Uuid::new_v4(),
        db.facility_id(),
        &AdmissionContext {
            id: admission.id,
            patient_id: admission.patient_id,
            ward_id: admission.ward_id,
            bed_id: admission.bed_id,
        },
        db.owner_user_id(),
    )
    .await
    .expect("discharge request succeeds");

    let summary = blocker(&discharge, DischargeBlockerKind::DischargeSummary);
    let nursing = blocker(&discharge, DischargeBlockerKind::NursingRelease);
    let billing = blocker(&discharge, DischargeBlockerKind::BillingClearance);
    assert_eq!(summary.status, DischargeBlockerStatus::Pending);
    assert_eq!(nursing.status, DischargeBlockerStatus::Pending);
    assert_eq!(billing.status, DischargeBlockerStatus::Completed);
    assert!(
        hms_db::ward::complete_discharge(db.pool(), db.facility_id(), discharge.id)
            .await
            .expect_err("open source blockers prevent final discharge")
            .to_string()
            .contains("discharge blockers")
    );

    sqlx::query("UPDATE discharge_cases SET pharmacy_required = true WHERE id = $1")
        .bind(discharge.id)
        .execute(db.pool())
        .await
        .expect("pharmacy requirement updates");
    let pharmacy_required =
        hms_db::ward::get_discharge_case(db.pool(), db.facility_id(), discharge.id)
            .await
            .expect("pharmacy-required discharge reload succeeds")
            .expect("pharmacy-required discharge exists");
    assert_eq!(
        blocker(&pharmacy_required, DischargeBlockerKind::PharmacyClearance).status,
        DischargeBlockerStatus::Pending
    );
    hms_db::ward::hold_discharge_blocker(
        db.pool(),
        db.facility_id(),
        discharge.id,
        DischargeBlockerKind::PharmacyClearance,
        "Take-home medicines are being packed".to_owned(),
        db.owner_user_id(),
    )
    .await
    .expect("pharmacy blocker hold succeeds");
    let held_pharmacy = hms_db::ward::get_discharge_case(db.pool(), db.facility_id(), discharge.id)
        .await
        .expect("held pharmacy discharge reload succeeds")
        .expect("held pharmacy discharge exists");
    let held_pharmacy = blocker(&held_pharmacy, DischargeBlockerKind::PharmacyClearance);
    assert_eq!(held_pharmacy.status, DischargeBlockerStatus::Held);
    assert_eq!(
        held_pharmacy.hold_reason.as_deref(),
        Some("Take-home medicines are being packed")
    );

    sqlx::query(
        r#"
        INSERT INTO clinical_notes (
            id, facility_id, patient_id, note_type, title, body, status, created_by_user_id
        )
        VALUES ($1, $2, $3, 'discharge_summary', 'Discharge summary', 'Stable for discharge.', 'signed', $4)
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(db.facility_id())
    .bind(admission.patient_id)
    .bind(db.owner_user_id())
    .execute(db.pool())
    .await
    .expect("signed discharge summary inserts");

    let invoice_id = uuid::Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO invoices (
            id, facility_id, patient_id, invoice_number, status, gross_amount_minor,
            paid_amount_minor, issued_by_user_id
        )
        VALUES ($1, $2, $3, 'INV-DISCHARGE-BLOCKER', 'issued', 12500, 0, $4)
        "#,
    )
    .bind(invoice_id)
    .bind(db.facility_id())
    .bind(admission.patient_id)
    .bind(db.owner_user_id())
    .execute(db.pool())
    .await
    .expect("unpaid invoice inserts");

    let after_sources = hms_db::ward::get_discharge_case(db.pool(), db.facility_id(), discharge.id)
        .await
        .expect("discharge reload succeeds")
        .expect("discharge exists");
    assert_eq!(
        blocker(&after_sources, DischargeBlockerKind::DischargeSummary).status,
        DischargeBlockerStatus::Completed
    );
    assert_eq!(
        blocker(&after_sources, DischargeBlockerKind::BillingClearance).status,
        DischargeBlockerStatus::Pending
    );

    hms_db::ward::hold_discharge_blocker(
        db.pool(),
        db.facility_id(),
        discharge.id,
        DischargeBlockerKind::BillingClearance,
        "Awaiting NHIS cashier closeout".to_owned(),
        db.owner_user_id(),
    )
    .await
    .expect("billing blocker hold succeeds");
    let held = hms_db::ward::get_discharge_case(db.pool(), db.facility_id(), discharge.id)
        .await
        .expect("held discharge reload succeeds")
        .expect("held discharge exists");
    let held_billing = blocker(&held, DischargeBlockerKind::BillingClearance);
    assert_eq!(held_billing.status, DischargeBlockerStatus::Held);
    assert_eq!(
        held_billing.hold_reason.as_deref(),
        Some("Awaiting NHIS cashier closeout")
    );

    hms_db::ward::override_discharge_blocker(
        db.pool(),
        db.facility_id(),
        discharge.id,
        DischargeBlockerKind::BillingClearance,
        "Approved by matron after cashier outage".to_owned(),
        db.owner_user_id(),
        chrono::Utc::now(),
    )
    .await
    .expect("billing blocker override succeeds");
    let overridden = hms_db::ward::get_discharge_case(db.pool(), db.facility_id(), discharge.id)
        .await
        .expect("overridden discharge reload succeeds")
        .expect("overridden discharge exists");
    let overridden_billing = blocker(&overridden, DischargeBlockerKind::BillingClearance);
    assert_eq!(
        overridden_billing.status,
        DischargeBlockerStatus::Overridden
    );
    assert_eq!(
        overridden_billing.override_reason.as_deref(),
        Some("Approved by matron after cashier outage")
    );

    sqlx::query(
        "UPDATE invoices SET status = 'paid', paid_amount_minor = gross_amount_minor WHERE id = $1",
    )
    .bind(invoice_id)
    .execute(db.pool())
    .await
    .expect("invoice is paid");
    let after_billing_source =
        hms_db::ward::get_discharge_case(db.pool(), db.facility_id(), discharge.id)
            .await
            .expect("paid-billing discharge reload succeeds")
            .expect("paid-billing discharge exists");
    assert_eq!(
        blocker(
            &after_billing_source,
            DischargeBlockerKind::BillingClearance
        )
        .status,
        DischargeBlockerStatus::Completed
    );
}

#[tokio::test]
async fn discharge_completion_moves_bed_to_cleaning_then_releases_after_policy_interval() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test database is available");
    let scenario = db
        .scenario("discharge-cleaning")
        .admission_case_with_available_bed()
        .await
        .expect("admission scenario builds");
    sqlx::query("UPDATE wards SET bed_cleaning_minutes_override = 5 WHERE id = $1")
        .bind(scenario.ward.id)
        .execute(db.pool())
        .await
        .expect("ward cleaning override updates");
    let admission = hms_db::ward::activate_admission_case(
        db.pool(),
        db.facility_id(),
        scenario.admission.id,
        db.owner_user_id(),
    )
    .await
    .expect("activation query succeeds")
    .expect("admission activates");

    let discharge = hms_db::ward::request_discharge(
        db.pool(),
        uuid::Uuid::new_v4(),
        db.facility_id(),
        &AdmissionContext {
            id: admission.id,
            patient_id: admission.patient_id,
            ward_id: admission.ward_id,
            bed_id: admission.bed_id,
        },
        db.owner_user_id(),
    )
    .await
    .expect("discharge request succeeds");
    sqlx::query(
        r#"
        INSERT INTO clinical_notes (
            id, facility_id, patient_id, note_type, title, body, status, created_by_user_id
        )
        VALUES ($1, $2, $3, 'discharge_summary', 'Discharge summary', 'Stable.', 'signed', $4)
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(db.facility_id())
    .bind(admission.patient_id)
    .bind(db.owner_user_id())
    .execute(db.pool())
    .await
    .expect("signed discharge summary inserts");
    hms_db::ward::record_nursing_release(
        db.pool(),
        db.facility_id(),
        discharge.id,
        "Medication safety and red flags reviewed.".to_owned(),
        "Return immediately if fever or bleeding develops.".to_owned(),
        db.owner_user_id(),
    )
    .await
    .expect("nursing release records");

    let completed = hms_db::ward::complete_discharge(db.pool(), db.facility_id(), discharge.id)
        .await
        .expect("discharge complete query succeeds")
        .expect("discharge completes");
    assert_eq!(completed.status, DischargeStatus::Completed);
    let cleaning_bed = hms_db::ward::get_bed_by_id(
        db.pool(),
        db.facility_id(),
        admission.bed_id.expect("admission has bed"),
    )
    .await
    .expect("bed reload succeeds")
    .expect("bed exists");
    assert_eq!(cleaning_bed.status, BedStatus::Cleaning);

    let early_release = hms_db::ward::release_cleaned_beds(
        db.pool(),
        db.facility_id(),
        chrono::Utc::now() + chrono::Duration::minutes(4),
        25,
    )
    .await
    .expect("early cleaning release succeeds");
    assert_eq!(early_release, 0);

    let released = hms_db::ward::release_cleaned_beds(
        db.pool(),
        db.facility_id(),
        chrono::Utc::now() + chrono::Duration::minutes(6),
        25,
    )
    .await
    .expect("due cleaning release succeeds");
    assert_eq!(released, 1);
    let available_bed = hms_db::ward::get_bed_by_id(
        db.pool(),
        db.facility_id(),
        admission.bed_id.expect("admission has bed"),
    )
    .await
    .expect("bed reload succeeds")
    .expect("bed exists");
    assert_eq!(available_bed.status, BedStatus::Available);
}

#[tokio::test]
async fn ward_board_can_be_filtered_by_ward_and_patient() {
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
    let first_ward_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM wards WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("ward exists");
    let second_ward_id = uuid::Uuid::new_v4();
    let second_bed_id = uuid::Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO wards (id, facility_id, code, name, status)
        VALUES ($1, $2, 'isolation', 'Isolation Ward', $3)
        "#,
    )
    .bind(second_ward_id)
    .bind(facility_id)
    .bind(hms_db::codec::encode(WardStatus::Active).expect("ward status encodes"))
    .execute(&pool)
    .await
    .expect("second ward inserts");
    sqlx::query(
        r#"
        INSERT INTO beds (id, facility_id, ward_id, bed_code, status)
        VALUES ($1, $2, $3, 'I-01', $4)
        "#,
    )
    .bind(second_bed_id)
    .bind(facility_id)
    .bind(second_ward_id)
    .bind(hms_db::codec::encode(BedStatus::Available).expect("bed status encodes"))
    .execute(&pool)
    .await
    .expect("second ward bed inserts");
    let ward_ids = [first_ward_id, second_ward_id];
    let patient_ids = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 2",
    )
    .bind(facility_id)
    .fetch_all(&pool)
    .await
    .expect("patients exist");
    assert!(patient_ids.len() >= 2);

    for (patient_id, ward_id) in patient_ids.iter().zip(ward_ids.iter()) {
        let admission_case = hms_db::ward::create_admission_case(
            &pool,
            NewAdmissionCase {
                id: uuid::Uuid::new_v4(),
                facility_id,
                patient_id: *patient_id,
                ward_id: *ward_id,
                actor_user_id: owner_id,
            },
        )
        .await
        .expect("admission case is created");
        hms_db::ward::activate_admission_case(&pool, facility_id, admission_case.id, owner_id)
            .await
            .expect("activation query succeeds")
            .expect("case is activated");
    }

    let all_board = hms_db::ward::list_ward_board(&pool, facility_id, None, None, None, 25)
        .await
        .expect("ward board list succeeds");
    assert!(all_board.iter().any(|item| item.ward_id == ward_ids[0]));
    assert!(all_board.iter().any(|item| item.ward_id == ward_ids[1]));

    let scoped_board =
        hms_db::ward::list_ward_board(&pool, facility_id, Some(ward_ids[0]), None, None, 25)
            .await
            .expect("ward-scoped board list succeeds");
    assert!(!scoped_board.is_empty());
    assert!(scoped_board.iter().all(|item| item.ward_id == ward_ids[0]));
    assert!(!scoped_board.iter().any(|item| item.ward_id == ward_ids[1]));

    let patient_scoped_board =
        hms_db::ward::list_ward_board(&pool, facility_id, None, Some(patient_ids[0]), None, 25)
            .await
            .expect("patient-scoped board list succeeds");
    assert!(!patient_scoped_board.is_empty());
    assert!(patient_scoped_board
        .iter()
        .all(|item| item.patient_id == patient_ids[0]));
    assert!(!patient_scoped_board
        .iter()
        .any(|item| item.patient_id == patient_ids[1]));
}

#[tokio::test]
async fn admission_case_invalid_transitions_fail_without_partial_writes() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test database is available");
    let scenario = db
        .scenario("admission-invalid")
        .admission_case_with_available_bed()
        .await
        .expect("admission scenario builds");

    let reserved = hms_db::ward::reserve_admission_bed(
        db.pool(),
        db.facility_id(),
        scenario.admission.id,
        Some(scenario.bed.id),
        db.owner_user_id(),
    )
    .await
    .expect("bed reserve query succeeds")
    .expect("bed reserve returns admission");
    assert_eq!(reserved.status, AdmissionStatus::ReadyForActivation);
    assert_eq!(reserved.bed_id, Some(scenario.bed.id));

    let second_patient = db
        .scenario("admission-second")
        .registered_patient()
        .await
        .expect("second patient creates");
    let second_case = hms_db::ward::create_admission_case(
        db.pool(),
        NewAdmissionCase {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: second_patient.id,
            ward_id: scenario.ward.id,
            actor_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("second admission case creates");
    assert!(
        hms_db::ward::reserve_admission_bed(
            db.pool(),
            db.facility_id(),
            second_case.id,
            Some(scenario.bed.id),
            db.owner_user_id(),
        )
        .await
        .expect("second reserve query succeeds")
        .is_none(),
        "reserved bed must not be assigned to a second admission case"
    );
    let second_after_failed_reserve =
        hms_db::ward::get_admission_case(db.pool(), db.facility_id(), second_case.id)
            .await
            .expect("second admission reload succeeds")
            .expect("second admission exists");
    assert_eq!(
        second_after_failed_reserve.status,
        AdmissionStatus::ReadyForActivation
    );
    assert_eq!(second_after_failed_reserve.bed_id, None);

    let cancelled = hms_db::ward::cancel_admission_case(
        db.pool(),
        db.facility_id(),
        scenario.admission.id,
        db.owner_user_id(),
    )
    .await
    .expect("cancel query succeeds")
    .expect("cancel returns admission");
    assert_eq!(cancelled.status, AdmissionStatus::Cancelled);
    let released_bed = hms_db::ward::get_bed_by_id(db.pool(), db.facility_id(), scenario.bed.id)
        .await
        .expect("bed reload succeeds")
        .expect("bed exists");
    assert_eq!(released_bed.status, BedStatus::Available);

    assert!(
        hms_db::ward::activate_admission_case(
            db.pool(),
            db.facility_id(),
            scenario.admission.id,
            db.owner_user_id(),
        )
        .await
        .expect("cancelled activation query succeeds")
        .is_none(),
        "cancelled admission must not be activated"
    );
    assert!(
        hms_db::ward::cancel_admission_case(
            db.pool(),
            db.facility_id(),
            scenario.admission.id,
            db.owner_user_id(),
        )
        .await
        .expect("double cancel query succeeds")
        .is_none(),
        "cancelled admission must not be cancelled twice"
    );

    let cancelled_after_failed_transitions =
        hms_db::ward::get_admission_case(db.pool(), db.facility_id(), scenario.admission.id)
            .await
            .expect("cancelled admission reload succeeds")
            .expect("cancelled admission exists");
    assert_eq!(
        cancelled_after_failed_transitions.status,
        AdmissionStatus::Cancelled
    );
    let bed_after_failed_transitions =
        hms_db::ward::get_bed_by_id(db.pool(), db.facility_id(), scenario.bed.id)
            .await
            .expect("bed reload succeeds")
            .expect("bed exists");
    assert_eq!(bed_after_failed_transitions.status, BedStatus::Available);
}

#[tokio::test]
async fn concurrent_bed_reservations_allow_only_one_admission_case() {
    let db = hms_db::test_support::TestDb::hospital()
        .await
        .expect("test database is available");
    let first = db
        .scenario("reserve-first")
        .admission_case_with_available_bed()
        .await
        .expect("first admission scenario builds");
    let second_patient = db
        .scenario("reserve-second")
        .registered_patient()
        .await
        .expect("second patient creates");
    let second_case = hms_db::ward::create_admission_case(
        db.pool(),
        NewAdmissionCase {
            id: uuid::Uuid::new_v4(),
            facility_id: db.facility_id(),
            patient_id: second_patient.id,
            ward_id: first.ward.id,
            actor_user_id: db.owner_user_id(),
        },
    )
    .await
    .expect("second admission case creates");

    let reserve_first = hms_db::ward::reserve_admission_bed(
        db.pool(),
        db.facility_id(),
        first.admission.id,
        Some(first.bed.id),
        db.owner_user_id(),
    );
    let reserve_second = hms_db::ward::reserve_admission_bed(
        db.pool(),
        db.facility_id(),
        second_case.id,
        Some(first.bed.id),
        db.owner_user_id(),
    );
    let (first_result, second_result) = tokio::join!(reserve_first, reserve_second);
    let first_result = first_result.expect("first reserve query succeeds");
    let second_result = second_result.expect("second reserve query succeeds");

    assert_eq!(
        (first_result.is_some() as usize) + (second_result.is_some() as usize),
        1,
        "only one concurrent reservation may claim the bed"
    );

    let first_after =
        hms_db::ward::get_admission_case(db.pool(), db.facility_id(), first.admission.id)
            .await
            .expect("first admission reload succeeds")
            .expect("first admission exists");
    let second_after =
        hms_db::ward::get_admission_case(db.pool(), db.facility_id(), second_case.id)
            .await
            .expect("second admission reload succeeds")
            .expect("second admission exists");
    assert_eq!(
        (first_after.bed_id == Some(first.bed.id)) as usize
            + (second_after.bed_id == Some(first.bed.id)) as usize,
        1,
        "only one admission case may retain the requested bed"
    );
    let bed_after = hms_db::ward::get_bed_by_id(db.pool(), db.facility_id(), first.bed.id)
        .await
        .expect("bed reload succeeds")
        .expect("bed exists");
    assert_eq!(bed_after.status, BedStatus::Reserved);
}

#[tokio::test]
async fn nursing_observations_alerts_fluids_and_stock_requests_are_facility_scoped() {
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
    let ward_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM wards WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("ward exists");
    let patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("patient exists");

    let admission_case = hms_db::ward::create_admission_case(
        &pool,
        NewAdmissionCase {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            ward_id,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("admission case is created");
    let admission =
        hms_db::ward::activate_admission_case(&pool, facility_id, admission_case.id, owner_id)
            .await
            .expect("activation query succeeds")
            .expect("admission is active");

    let recent_recorded_at = chrono::DateTime::parse_from_rfc3339("2026-05-10T09:00:00Z")
        .expect("recent timestamp parses")
        .with_timezone(&chrono::Utc);
    let stale_recorded_at = chrono::DateTime::parse_from_rfc3339("2026-05-07T09:00:00Z")
        .expect("stale timestamp parses")
        .with_timezone(&chrono::Utc);
    let vitals = hms_db::ward::create_patient_vitals(
        &pool,
        NewPatientVitals {
            id: uuid::Uuid::new_v4(),
            facility_id,
            admission_case_id: admission.id,
            patient_id,
            recorded_at: recent_recorded_at,
            temperature_c: Some(37.5),
            systolic_bp: Some(120),
            diastolic_bp: Some(80),
            pulse: Some(88),
            respiratory_rate: Some(18),
            oxygen_saturation: Some(98),
            recorded_by_user_id: owner_id,
        },
    )
    .await
    .expect("vitals create succeeds");
    assert_eq!(vitals.patient_id, patient_id);

    hms_db::ward::create_patient_vitals(
        &pool,
        NewPatientVitals {
            id: uuid::Uuid::new_v4(),
            facility_id,
            admission_case_id: admission.id,
            patient_id,
            recorded_at: stale_recorded_at,
            temperature_c: Some(36.8),
            systolic_bp: Some(118),
            diastolic_bp: Some(76),
            pulse: Some(72),
            respiratory_rate: Some(16),
            oxygen_saturation: Some(99),
            recorded_by_user_id: owner_id,
        },
    )
    .await
    .expect("stale vitals create succeeds");

    let recent_patient_vitals = hms_db::ward::list_patient_vitals(
        &pool,
        facility_id,
        Some(patient_id),
        Some(admission.id),
        Some(recent_recorded_at - chrono::Duration::hours(48)),
        None,
        25,
    )
    .await
    .expect("patient-filtered vitals list succeeds");
    assert_eq!(recent_patient_vitals.len(), 1);
    assert_eq!(recent_patient_vitals[0].id, vitals.id);
    assert_eq!(recent_patient_vitals[0].patient_id, patient_id);

    let alert = hms_db::ward::create_nursing_alert(
        &pool,
        NewNursingAlert {
            id: uuid::Uuid::new_v4(),
            facility_id,
            admission_case_id: admission.id,
            patient_id,
            severity: NursingAlertSeverity::High,
            title: "High fever watch".to_owned(),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("alert create succeeds");
    assert_eq!(alert.status, NursingAlertStatus::Open);
    let acknowledged =
        hms_db::ward::acknowledge_nursing_alert(&pool, facility_id, alert.id, owner_id)
            .await
            .expect("acknowledge query succeeds")
            .expect("alert exists");
    assert_eq!(acknowledged.status, NursingAlertStatus::Acknowledged);

    let other_facility = uuid::Uuid::new_v4();
    let task = hms_db::ward::create_nursing_task(
        &pool,
        NewNursingTask {
            id: uuid::Uuid::new_v4(),
            facility_id,
            admission_case_id: admission.id,
            patient_id,
            ward_id,
            task_type: NursingTaskType::Observation,
            due_at: chrono::Utc::now(),
            assigned_to_user_id: Some(owner_id),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("nursing task create succeeds");
    assert_eq!(task.status, NursingTaskStatus::Open);
    let cancelled_task = hms_db::ward::cancel_nursing_task(&pool, facility_id, task.id)
        .await
        .expect("nursing task cancel query succeeds")
        .expect("nursing task exists");
    assert_eq!(cancelled_task.status, NursingTaskStatus::Cancelled);
    assert!(
        hms_db::ward::cancel_nursing_task(&pool, other_facility, task.id)
            .await
            .expect("cross-facility nursing task cancel query succeeds")
            .is_none()
    );

    let event = hms_db::ward::create_monitoring_event(
        &pool,
        NewMonitoringEvent {
            id: uuid::Uuid::new_v4(),
            facility_id,
            admission_case_id: admission.id,
            patient_id,
            event_kind: MonitoringEventKind::Observation,
            summary: "Hourly observation completed".to_owned(),
            recorded_at: chrono::Utc::now(),
            recorded_by_user_id: owner_id,
        },
    )
    .await
    .expect("monitoring event create succeeds");
    assert_eq!(event.event_kind, MonitoringEventKind::Observation);

    let fluid = hms_db::ward::create_fluid_balance_entry(
        &pool,
        NewFluidBalanceEntry {
            id: uuid::Uuid::new_v4(),
            facility_id,
            admission_case_id: admission.id,
            patient_id,
            recorded_at: chrono::Utc::now(),
            intake_ml: 500,
            output_ml: 150,
            recorded_by_user_id: owner_id,
        },
    )
    .await
    .expect("fluid balance create succeeds");
    assert_eq!(fluid.net_ml, 350);

    let stock = hms_db::ward::create_ward_stock_request(
        &pool,
        NewWardStockRequest {
            id: uuid::Uuid::new_v4(),
            facility_id,
            ward_id,
            requested_item: "IV cannula".to_owned(),
            quantity_requested: 10,
            requested_by_user_id: owner_id,
        },
    )
    .await
    .expect("stock request create succeeds");
    assert_eq!(stock.status, WardStockRequestStatus::Requested);
    let approved = hms_db::ward::approve_ward_stock_request(&pool, facility_id, stock.id, owner_id)
        .await
        .expect("approve stock query succeeds")
        .expect("stock request exists");
    assert_eq!(approved.status, WardStockRequestStatus::Approved);
    let fulfilled =
        hms_db::ward::fulfill_ward_stock_request(&pool, facility_id, stock.id, owner_id)
            .await
            .expect("fulfill stock query succeeds")
            .expect("stock request exists");
    assert_eq!(fulfilled.status, WardStockRequestStatus::Fulfilled);

    assert!(
        hms_db::ward::list_patient_vitals(&pool, other_facility, None, None, None, None, 25)
            .await
            .expect("cross-facility vitals list succeeds")
            .is_empty()
    );
    assert!(
        hms_db::ward::list_ward_stock_requests(&pool, other_facility, None, 25)
            .await
            .expect("cross-facility stock list succeeds")
            .is_empty()
    );
}
