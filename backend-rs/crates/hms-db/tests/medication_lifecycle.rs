use chrono::{DateTime, Duration, Utc};
use hms_db::clinical::NewPrescription;
use hms_db::pharmacy::{DispenseFulfillmentCommand, GenerateMarCommand};
use hms_db::test_support::TestDb;
use hms_domain::clinical::{
    GenerateMedicationAdministrationResponse, PrescriptionStatus, UpdatePrescriptionRequest,
};
use hms_domain::ward::MedicationAdministrationStatus;
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    patient_id: Uuid,
    admission_id: Uuid,
    prescription_id: Uuid,
    item_id: Uuid,
    location_id: Uuid,
    first_dose_at: DateTime<Utc>,
}

impl Fixture {
    async fn new() -> Self {
        Self::with_start(Utc::now() - Duration::hours(13)).await
    }

    async fn with_start(first_dose_at: DateTime<Utc>) -> Self {
        let db = TestDb::hospital().await.expect("test database provisions");
        let care = db
            .scenario("medication-lifecycle")
            .admission_case_with_available_bed()
            .await
            .expect("care scenario creates");
        hms_db::ward::activate_admission_case(
            db.pool(),
            db.facility_id(),
            care.admission.id,
            db.owner_user_id(),
        )
        .await
        .expect("admission activates")
        .expect("admission exists");
        let item_id = sqlx::query_scalar("SELECT id FROM inventory_items WHERE facility_id = $1 AND NOT controlled ORDER BY id LIMIT 1")
            .bind(db.facility_id()).fetch_one(db.pool()).await.expect("inventory item exists");
        let location_id = sqlx::query_scalar(
            "SELECT id FROM storage_locations WHERE facility_id = $1 ORDER BY id LIMIT 1",
        )
        .bind(db.facility_id())
        .fetch_one(db.pool())
        .await
        .expect("location exists");
        sqlx::query("INSERT INTO stock_batches (id, facility_id, item_id, location_id, batch_number, quantity_on_hand) VALUES ($1, $2, $3, $4, 'SYNTHETIC-LIFECYCLE', 100)")
            .bind(Uuid::new_v4()).bind(db.facility_id()).bind(item_id).bind(location_id).execute(db.pool()).await.expect("synthetic stock creates");
        let prescription_id = Uuid::new_v4();
        hms_db::clinical::create_prescription(
            db.pool(),
            NewPrescription {
                id: prescription_id,
                facility_id: db.facility_id(),
                patient_id: care.patient.id,
                encounter_id: None,
                visit_id: None,
                discharge_case_id: None,
                medication_name: "Synthetic medication".to_owned(),
                dose: "1 tablet".to_owned(),
                route: "oral".to_owned(),
                frequency: "q6h".to_owned(),
                inventory_item_id: Some(item_id),
                start_date: Some(first_dose_at.date_naive()),
                duration_days: Some(2),
                first_dose_at: Some(first_dose_at),
                actor_user_id: db.owner_user_id(),
            },
        )
        .await
        .expect("prescription creates");
        Self {
            db,
            patient_id: care.patient.id,
            admission_id: care.admission.id,
            prescription_id,
            item_id,
            location_id,
            first_dose_at,
        }
    }

    fn generation(&self) -> GenerateMarCommand {
        GenerateMarCommand {
            facility_id: self.db.facility_id(),
            prescription_id: self.prescription_id,
            admission_case_id: self.admission_id,
            days: 2,
            first_dose_at: Some(self.first_dose_at),
            actor_user_id: self.db.owner_user_id(),
        }
    }

    async fn generate(&self) -> GenerateMedicationAdministrationResponse {
        hms_db::pharmacy::generate_mar_for_prescription(self.db.pool(), self.generation())
            .await
            .expect("MAR generates")
    }

    fn dispense(&self, fulfillment_id: Uuid, quantity: i64) -> DispenseFulfillmentCommand {
        DispenseFulfillmentCommand {
            facility_id: self.db.facility_id(),
            fulfillment_id,
            item_id: self.item_id,
            location_id: self.location_id,
            quantity,
            actor_user_id: self.db.owner_user_id(),
        }
    }

    async fn status(&self, status: PrescriptionStatus) {
        hms_db::clinical::update_prescription(
            self.db.pool(),
            self.db.facility_id(),
            self.prescription_id,
            patch(Some(status)),
        )
        .await
        .expect("source status updates")
        .expect("source exists");
    }

    async fn dose_ids(&self) -> Vec<Uuid> {
        sqlx::query_scalar("SELECT id FROM medication_administrations WHERE facility_id = $1 AND prescription_id = $2 ORDER BY dose_sequence")
            .bind(self.db.facility_id()).bind(self.prescription_id).fetch_all(self.db.pool()).await.expect("dose ids load")
    }
}

fn patch(status: Option<PrescriptionStatus>) -> UpdatePrescriptionRequest {
    UpdatePrescriptionRequest {
        medication_name: None,
        dose: None,
        route: None,
        frequency: None,
        inventory_item_id: None,
        start_date: None,
        duration_days: None,
        first_dose_at: None,
        status,
    }
}

#[tokio::test]
async fn medication_hold_resume_preserves_history_and_independent_holds_and_retry_counts() {
    let f = Fixture::new().await;
    let generated = f.generate().await;
    let ids = f.dose_ids().await;
    assert_eq!(ids.len(), 8);
    hms_db::pharmacy::dispense_fulfillment(
        f.db.pool(),
        f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 1),
    )
    .await
    .expect("history dose is supplied before administration");
    hms_db::ward::administer_medication(
        f.db.pool(),
        f.db.facility_id(),
        ids[0],
        f.db.owner_user_id(),
        None,
    )
    .await
    .expect("first dose administers");
    let administered: (Option<DateTime<Utc>>, Option<Uuid>) = sqlx::query_as("SELECT administered_at, administered_by_user_id FROM medication_administrations WHERE id = $1")
        .bind(ids[0]).fetch_one(f.db.pool()).await.expect("history reads");
    sqlx::query("UPDATE medication_administrations SET status = 'held' WHERE id = $1")
        .bind(ids[1])
        .execute(f.db.pool())
        .await
        .expect("independent hold fixture");
    f.status(PrescriptionStatus::OnHold).await;
    assert!(hms_db::ward::administer_medication(
        f.db.pool(),
        f.db.facility_id(),
        ids[3],
        f.db.owner_user_id(),
        None
    )
    .await
    .is_err());
    assert!(hms_db::pharmacy::dispense_fulfillment(
        f.db.pool(),
        f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 1)
    )
    .await
    .is_err());
    assert!(
        hms_db::pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation())
            .await
            .is_err()
    );
    assert!(hms_db::pharmacy::list_fulfillment_queue(
        f.db.pool(),
        f.db.facility_id(),
        None,
        10,
        Some(f.patient_id),
        None
    )
    .await
    .expect("queue reads")
    .is_empty());
    // Repeated hold must not claim independently held doses as resumable.
    f.status(PrescriptionStatus::OnHold).await;
    f.status(PrescriptionStatus::Active).await;
    let rows: Vec<(Uuid, String, bool)> = sqlx::query_as("SELECT id, status, prescription_held FROM medication_administrations WHERE prescription_id = $1 ORDER BY dose_sequence")
        .bind(f.prescription_id).fetch_all(f.db.pool()).await.expect("states load");
    assert_eq!(rows[0].1, "administered");
    assert_eq!(rows[1].1, "held");
    assert_eq!(rows[2].1, "held");
    assert!(rows[3..].iter().all(|row| row.1 == "scheduled"));
    assert!(rows.iter().all(|row| !row.2));
    let history: (Option<DateTime<Utc>>, Option<Uuid>) = sqlx::query_as("SELECT administered_at, administered_by_user_id FROM medication_administrations WHERE id = $1")
        .bind(ids[0]).fetch_one(f.db.pool()).await.expect("history rereads");
    assert_eq!(history, administered);
    let retried = f.generate().await;
    assert_eq!(retried.created_count, 0);
    assert_eq!(retried.requested_dose_count, 6);
    let dispensed = hms_db::pharmacy::dispense_fulfillment(
        f.db.pool(),
        f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 5),
    )
    .await
    .expect("only future eligible doses dispense");
    assert_eq!(dispensed.remaining_dose_count, 0);
    assert_eq!(dispensed.fulfillment.requested_dose_count, 6);
    // Neither duplicate administration nor a different witness may rewrite history.
    assert!(hms_db::ward::administer_medication(
        f.db.pool(),
        f.db.facility_id(),
        ids[0],
        f.db.owner_user_id(),
        Some(f.db.owner_user_id())
    )
    .await
    .is_err());
    f.status(PrescriptionStatus::OnHold).await;
    f.status(PrescriptionStatus::Active).await;
    assert_eq!(f.generate().await.requested_dose_count, 6);
}

#[tokio::test]
async fn medication_terminal_status_cancels_pending_work_and_cannot_resurrect() {
    for status in [PrescriptionStatus::Stopped, PrescriptionStatus::Completed] {
        let f = Fixture::new().await;
        let generated = f.generate().await;
        let ids = f.dose_ids().await;
        hms_db::pharmacy::dispense_fulfillment(
            f.db.pool(),
            f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 1),
        )
        .await
        .expect("history dose is supplied");
        hms_db::ward::administer_medication(
            f.db.pool(),
            f.db.facility_id(),
            ids[0],
            f.db.owner_user_id(),
            None,
        )
        .await
        .expect("history administers");
        f.status(PrescriptionStatus::OnHold).await;
        f.status(status).await;
        let fulfillment = hms_db::pharmacy::get_fulfillment(
            f.db.pool(),
            f.db.facility_id(),
            generated.pharmacy_fulfillment_id.unwrap(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            fulfillment.status,
            hms_domain::pharmacy::PharmacyFulfillmentStatus::Cancelled
        );
        assert!(hms_db::clinical::update_prescription(
            f.db.pool(),
            f.db.facility_id(),
            f.prescription_id,
            patch(Some(PrescriptionStatus::Active))
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("prescription_course_closed"));
        assert!(hms_db::ward::administer_medication(
            f.db.pool(),
            f.db.facility_id(),
            ids[1],
            f.db.owner_user_id(),
            None
        )
        .await
        .is_err());
        assert!(
            hms_db::pharmacy::dispense_fulfillment(f.db.pool(), f.dispense(fulfillment.id, 1))
                .await
                .is_err()
        );
        let dose =
            hms_db::ward::get_medication_administration(f.db.pool(), f.db.facility_id(), ids[0])
                .await
                .unwrap()
                .unwrap();
        assert!(matches!(
            dose.status,
            MedicationAdministrationStatus::Administered
        ));
        let resumable: i64 = sqlx::query_scalar("SELECT count(*) FROM medication_administrations WHERE prescription_id = $1 AND prescription_held").bind(f.prescription_id).fetch_one(f.db.pool()).await.unwrap();
        assert_eq!(resumable, 0);
    }
}

#[tokio::test]
async fn medication_regimen_is_immutable_after_generation_and_legacy_stale_copies_fail_closed() {
    let f = Fixture::new().await;
    let generated = f.generate().await;
    let mut no_op = patch(None);
    no_op.dose = Some("1 tablet".to_owned());
    no_op.frequency = Some("q6h".to_owned());
    hms_db::clinical::update_prescription(
        f.db.pool(),
        f.db.facility_id(),
        f.prescription_id,
        no_op,
    )
    .await
    .expect("same values allowed");
    for field in [
        "medication",
        "dose",
        "route",
        "frequency",
        "item",
        "start",
        "duration",
        "first",
    ] {
        let mut change = patch(None);
        match field {
            "medication" => {
                change.medication_name = Some("Different synthetic medication".to_owned())
            }
            "dose" => change.dose = Some("2 tablets".to_owned()),
            "route" => change.route = Some("IV".to_owned()),
            "frequency" => change.frequency = Some("daily".to_owned()),
            "item" => change.inventory_item_id = Some(Uuid::new_v4()),
            "start" => change.start_date = Some((Utc::now() + Duration::days(1)).date_naive()),
            "duration" => change.duration_days = Some(3),
            _ => change.first_dose_at = Some(f.first_dose_at + Duration::hours(1)),
        }
        assert_eq!(
            hms_db::clinical::update_prescription(
                f.db.pool(),
                f.db.facility_id(),
                f.prescription_id,
                change
            )
            .await
            .unwrap_err()
            .to_string(),
            "prescription_regimen_locked"
        );
    }
    // Simulate an unsafe older release changing only the source regimen.
    sqlx::query("UPDATE prescriptions SET dose = '2 tablets' WHERE id = $1")
        .bind(f.prescription_id)
        .execute(f.db.pool())
        .await
        .unwrap();
    let ids = f.dose_ids().await;
    assert!(hms_db::ward::administer_medication(
        f.db.pool(),
        f.db.facility_id(),
        ids[0],
        f.db.owner_user_id(),
        None
    )
    .await
    .is_err());
    assert!(hms_db::pharmacy::dispense_fulfillment(
        f.db.pool(),
        f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 1)
    )
    .await
    .is_err());
    assert!(hms_db::ward::list_medication_administrations(
        f.db.pool(),
        f.db.facility_id(),
        None,
        100
    )
    .await
    .unwrap()
    .iter()
    .filter(|row| row.prescription_id == Some(f.prescription_id))
    .all(|row| matches!(row.status, MedicationAdministrationStatus::Held)));
    assert!(hms_db::pharmacy::list_fulfillment_queue(
        f.db.pool(),
        f.db.facility_id(),
        None,
        100,
        Some(f.patient_id),
        None
    )
    .await
    .unwrap()
    .is_empty());
    assert!(hms_db::clinical::update_prescription(
        f.db.pool(),
        Uuid::new_v4(),
        f.prescription_id,
        patch(Some(PrescriptionStatus::Stopped))
    )
    .await
    .unwrap()
    .is_none());
}

#[tokio::test]
async fn medication_source_lock_serializes_generation_administration_and_dispensing() {
    let f = Fixture::new().await;
    let generated = f.generate().await;
    let ids = f.dose_ids().await;
    let mut transaction = f.db.pool().begin().await.unwrap();
    sqlx::query("UPDATE prescriptions SET status = 'stopped' WHERE id = $1")
        .bind(f.prescription_id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let facility = f.db.facility_id();
    let owner = f.db.owner_user_id();
    let id = ids[0];
    let admin = tokio::spawn(async move {
        hms_db::ward::administer_medication(&pool, facility, id, owner, None).await
    });
    let pool = f.db.pool().clone();
    let command = f.generation();
    let generation = tokio::spawn(async move {
        hms_db::pharmacy::generate_mar_for_prescription(&pool, command).await
    });
    let pool = f.db.pool().clone();
    let command = f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 1);
    let dispense =
        tokio::spawn(async move { hms_db::pharmacy::dispense_fulfillment(&pool, command).await });
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    assert!(
        !admin.is_finished() && !generation.is_finished() && !dispense.is_finished(),
        "all mutation paths must wait for the source lock"
    );
    transaction.commit().await.unwrap();
    assert!(admin.await.unwrap().is_err());
    assert!(generation.await.unwrap().is_err());
    assert!(dispense.await.unwrap().is_err());
    let administered: i64 = sqlx::query_scalar("SELECT count(*) FROM medication_administrations WHERE prescription_id = $1 AND status = 'administered'").bind(f.prescription_id).fetch_one(f.db.pool()).await.unwrap();
    let stock_writes: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM stock_movements WHERE reason = 'pharmacy_fulfillment'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(administered, 0);
    assert_eq!(stock_writes, 0);
}

#[tokio::test]
async fn medication_timing_uses_future_start_and_stable_retry_and_rejects_overflow() {
    let f = Fixture::new().await;
    let future = (Utc::now() + Duration::days(2)).date_naive();
    // The date-only UI must not schedule future prescriptions immediately.
    sqlx::query("UPDATE prescriptions SET start_date = $2, first_dose_at = NULL, duration_days = 1 WHERE id = $1")
        .bind(f.prescription_id).bind(future).execute(f.db.pool()).await.unwrap();
    let mut command = f.generation();
    command.first_dose_at = Some(Utc::now());
    assert_eq!(
        hms_db::pharmacy::generate_mar_for_prescription(f.db.pool(), command)
            .await
            .unwrap_err()
            .to_string(),
        "first_dose_before_prescription_start"
    );
    let mut command = f.generation();
    command.first_dose_at = None;
    let generated = hms_db::pharmacy::generate_mar_for_prescription(f.db.pool(), command.clone())
        .await
        .unwrap();
    assert_eq!(generated.window_start.date_naive(), future);
    assert_eq!(generated.created_count, 4);
    assert_eq!(
        generated.window_end - generated.window_start,
        Duration::days(1)
    );
    let retried = hms_db::pharmacy::generate_mar_for_prescription(f.db.pool(), command)
        .await
        .unwrap();
    assert_eq!(retried.medication_course_id, generated.medication_course_id);
    assert_eq!(retried.created_count, 0);
    assert_eq!(retried.window_start, generated.window_start);
    // Legacy timing drift fails closed just like a stale copied dose.
    sqlx::query("UPDATE prescriptions SET duration_days = 2 WHERE id = $1")
        .bind(f.prescription_id)
        .execute(f.db.pool())
        .await
        .unwrap();
    let ids = f.dose_ids().await;
    assert!(hms_db::ward::administer_medication(
        f.db.pool(),
        f.db.facility_id(),
        ids[0],
        f.db.owner_user_id(),
        None
    )
    .await
    .is_err());
    assert!(hms_db::pharmacy::dispense_fulfillment(
        f.db.pool(),
        f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 1)
    )
    .await
    .is_err());

    let f = Fixture::new().await;
    let mut change = patch(None);
    change.duration_days = Some(i32::MAX);
    hms_db::clinical::update_prescription(
        f.db.pool(),
        f.db.facility_id(),
        f.prescription_id,
        change,
    )
    .await
    .unwrap();
    assert_eq!(
        hms_db::pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation())
            .await
            .unwrap_err()
            .to_string(),
        "prescription_schedule_invalid"
    );
    let mut command = f.generation();
    command.first_dose_at = Some(DateTime::<Utc>::MAX_UTC);
    assert_eq!(
        hms_db::pharmacy::generate_mar_for_prescription(f.db.pool(), command)
            .await
            .unwrap_err()
            .to_string(),
        "prescription_schedule_invalid"
    );
}

#[tokio::test]
async fn medication_ward_round_writes_share_lifecycle_and_regimen_guards() {
    use hms_db::ward_rounds::{NewWardRound, NewWardRoundAction};
    use hms_domain::ward_rounds::{WardRoundActionType, WardRoundNoteSections};
    let f = Fixture::new().await;
    f.generate().await;
    for (payload, succeeds) in [
        (
            serde_json::json!({"prescription_id": f.prescription_id, "medication_name": "Synthetic medication", "dose": "1 tablet", "frequency": "q6h", "status": "on_hold"}),
            true,
        ),
        (
            serde_json::json!({"prescription_id": f.prescription_id, "dose": "3 tablets"}),
            false,
        ),
    ] {
        let round = hms_db::ward_rounds::create_ward_round(
            f.db.pool(),
            NewWardRound {
                id: Uuid::new_v4(),
                facility_id: f.db.facility_id(),
                patient_id: f.patient_id,
                admission_case_id: Some(f.admission_id),
                note_sections: WardRoundNoteSections::default(),
                rendered_note: None,
                actor_user_id: f.db.owner_user_id(),
            },
        )
        .await
        .unwrap()
        .unwrap();
        hms_db::ward_rounds::create_ward_round_action(
            f.db.pool(),
            NewWardRoundAction {
                id: Uuid::new_v4(),
                facility_id: f.db.facility_id(),
                patient_id: f.patient_id,
                ward_round_id: round.id,
                action_type: WardRoundActionType::Prescription,
                title: None,
                instruction: None,
                payload,
                actor_user_id: f.db.owner_user_id(),
            },
        )
        .await
        .unwrap()
        .unwrap();
        let latest = hms_db::ward_rounds::get_ward_round(
            f.db.pool(),
            f.db.facility_id(),
            f.patient_id,
            round.id,
        )
        .await
        .unwrap()
        .unwrap();
        let committed = hms_db::ward_rounds::commit_ward_round(
            f.db.pool(),
            f.db.facility_id(),
            f.patient_id,
            round.id,
            latest.version,
            f.db.owner_user_id(),
        )
        .await;
        if succeeds {
            committed
                .expect("hold action commits")
                .expect("round exists");
            let scheduled: i64 = sqlx::query_scalar("SELECT count(*) FROM medication_administrations WHERE prescription_id = $1 AND status = 'scheduled'").bind(f.prescription_id).fetch_one(f.db.pool()).await.unwrap();
            assert_eq!(scheduled, 0);
        } else {
            assert_eq!(
                committed.unwrap_err().root_cause().to_string(),
                "prescription_regimen_locked"
            );
            let unchanged = hms_db::ward_rounds::get_ward_round(
                f.db.pool(),
                f.db.facility_id(),
                f.patient_id,
                round.id,
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(
                unchanged.status,
                hms_domain::ward_rounds::WardRoundStatus::Draft
            );
            assert!(unchanged.artifacts.is_empty());
        }
    }
}

#[tokio::test]
async fn medication_migration_retires_legacy_unsafe_work_without_rewriting_history() {
    for legacy in [
        "on_hold",
        "stopped",
        "completed",
        "stale_dose",
        "shortened_duration",
    ] {
        let f = Fixture::new().await;
        let generated = f.generate().await;
        let ids = f.dose_ids().await;
        hms_db::pharmacy::dispense_fulfillment(
            f.db.pool(),
            f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 1),
        )
        .await
        .expect("legacy history dose is supplied");
        hms_db::ward::administer_medication(
            f.db.pool(),
            f.db.facility_id(),
            ids[0],
            f.db.owner_user_id(),
            None,
        )
        .await
        .unwrap();
        match legacy {
            "stale_dose" => {
                sqlx::query("UPDATE prescriptions SET dose = '2 tablets' WHERE id = $1")
                    .bind(f.prescription_id)
                    .execute(f.db.pool())
                    .await
                    .unwrap();
            }
            "shortened_duration" => {
                sqlx::query("UPDATE prescriptions SET duration_days = 1 WHERE id = $1")
                    .bind(f.prescription_id)
                    .execute(f.db.pool())
                    .await
                    .unwrap();
            }
            status => {
                sqlx::query("UPDATE prescriptions SET status = $2 WHERE id = $1")
                    .bind(f.prescription_id)
                    .bind(status)
                    .execute(f.db.pool())
                    .await
                    .unwrap();
            }
        }
        // Reconstruct the immediate pre-migration schema with populated legacy
        // records, then execute the exact production migration SQL.
        sqlx::raw_sql("DROP INDEX medication_administrations_prescription_pending_idx; ALTER TABLE medication_administrations DROP COLUMN prescription_held; ALTER TABLE medication_courses DROP COLUMN prescription_start_date, DROP COLUMN prescription_duration_days, DROP COLUMN prescription_first_dose_at;")
            .execute(f.db.pool()).await.unwrap();
        sqlx::raw_sql(include_str!(
            "../../../migrations/202610150002_prescription_medication_lifecycle.sql"
        ))
        .execute(f.db.pool())
        .await
        .expect("populated legacy migration applies");
        let states: Vec<(String, bool)> = sqlx::query_as("SELECT status, prescription_held FROM medication_administrations WHERE prescription_id = $1 ORDER BY dose_sequence").bind(f.prescription_id).fetch_all(f.db.pool()).await.unwrap();
        assert_eq!(states[0], ("administered".to_owned(), false));
        assert!(states[1..].iter().all(|row| row.0 == "held"));
        assert!(states[1..].iter().all(|row| row.1 == (legacy == "on_hold")));
        if legacy == "on_hold" {
            f.status(PrescriptionStatus::Active).await;
            let scheduled: i64 = sqlx::query_scalar("SELECT count(*) FROM medication_administrations WHERE prescription_id = $1 AND status = 'scheduled'").bind(f.prescription_id).fetch_one(f.db.pool()).await.unwrap();
            assert_eq!(scheduled, 5);
        } else {
            let fulfillment = hms_db::pharmacy::get_fulfillment(
                f.db.pool(),
                f.db.facility_id(),
                generated.pharmacy_fulfillment_id.unwrap(),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(
                fulfillment.status,
                hms_domain::pharmacy::PharmacyFulfillmentStatus::Cancelled
            );
            assert!(hms_db::ward::administer_medication(
                f.db.pool(),
                f.db.facility_id(),
                ids[3],
                f.db.owner_user_id(),
                None
            )
            .await
            .is_err());
        }
    }
}

#[tokio::test]
async fn medication_resume_with_no_eligible_doses_retires_empty_fulfillment() {
    for supplied in [0, 1] {
        let f = Fixture::with_start(Utc::now() - Duration::days(3)).await;
        let generated = f.generate().await;
        let fulfillment_id = generated.pharmacy_fulfillment_id.unwrap();
        if supplied > 0 {
            hms_db::pharmacy::dispense_fulfillment(
                f.db.pool(),
                f.dispense(fulfillment_id, supplied),
            )
            .await
            .unwrap();
        }
        f.status(PrescriptionStatus::OnHold).await;
        f.status(PrescriptionStatus::Active).await;
        let fulfillment =
            hms_db::pharmacy::get_fulfillment(f.db.pool(), f.db.facility_id(), fulfillment_id)
                .await
                .unwrap()
                .unwrap();
        assert_eq!(fulfillment.requested_dose_count, supplied);
        assert_eq!(fulfillment.dispensed_dose_count, supplied);
        assert_eq!(
            fulfillment.status,
            if supplied == 0 {
                hms_domain::pharmacy::PharmacyFulfillmentStatus::Cancelled
            } else {
                hms_domain::pharmacy::PharmacyFulfillmentStatus::Dispensed
            }
        );
        assert!(hms_db::pharmacy::list_fulfillment_queue(
            f.db.pool(),
            f.db.facility_id(),
            None,
            10,
            Some(f.patient_id),
            None
        )
        .await
        .unwrap()
        .is_empty());
        assert_eq!(f.generate().await.requested_dose_count, supplied);
        assert!(hms_db::pharmacy::list_fulfillment_queue(
            f.db.pool(),
            f.db.facility_id(),
            None,
            10,
            Some(f.patient_id),
            None
        )
        .await
        .unwrap()
        .is_empty());
    }
    let f = Fixture::new().await;
    let generated = f.generate().await;
    sqlx::query("UPDATE medication_administrations SET status = 'held' WHERE prescription_id = $1")
        .bind(f.prescription_id)
        .execute(f.db.pool())
        .await
        .unwrap();
    f.status(PrescriptionStatus::OnHold).await;
    f.status(PrescriptionStatus::Active).await;
    let fulfillment = hms_db::pharmacy::get_fulfillment(
        f.db.pool(),
        f.db.facility_id(),
        generated.pharmacy_fulfillment_id.unwrap(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        fulfillment.status,
        hms_domain::pharmacy::PharmacyFulfillmentStatus::Cancelled
    );
    assert_eq!(f.generate().await.requested_dose_count, 0);
}

#[tokio::test]
async fn medication_stock_binding_rejects_foreign_facility_items_on_create_and_update() {
    let f = Fixture::new().await;
    let foreign_facility = Uuid::new_v4();
    let category = Uuid::new_v4();
    let item = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities (id, code, name, deployment_profile) VALUES ($1, 'MED-FOREIGN', 'Synthetic other facility', 'hospital')").bind(foreign_facility).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO inventory_categories (id, facility_id, code, name) VALUES ($1, $2, 'SYNTHETIC', 'Synthetic category')").bind(category).bind(foreign_facility).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO inventory_items (id, facility_id, category_id, code, name, item_type, unit) VALUES ($1, $2, $3, 'SYNTHETIC', 'Synthetic foreign item', 'medication', 'tablet')").bind(item).bind(foreign_facility).bind(category).execute(f.db.pool()).await.unwrap();
    let mut change = patch(None);
    change.inventory_item_id = Some(item);
    assert_eq!(
        hms_db::clinical::update_prescription(
            f.db.pool(),
            f.db.facility_id(),
            f.prescription_id,
            change
        )
        .await
        .unwrap_err()
        .to_string(),
        "prescription_inventory_item_invalid"
    );
    let created = hms_db::clinical::create_prescription(
        f.db.pool(),
        NewPrescription {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            patient_id: f.patient_id,
            encounter_id: None,
            visit_id: None,
            discharge_case_id: None,
            medication_name: "Synthetic medication".to_owned(),
            dose: "1 tablet".to_owned(),
            route: "oral".to_owned(),
            frequency: "q6h".to_owned(),
            inventory_item_id: Some(item),
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await;
    assert_eq!(
        created.unwrap_err().to_string(),
        "prescription_inventory_item_invalid"
    );
    let source =
        hms_db::clinical::get_prescription(f.db.pool(), f.db.facility_id(), f.prescription_id)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(source.inventory_item_id, Some(f.item_id));
    sqlx::query("UPDATE prescriptions SET inventory_item_id = $2 WHERE id = $1")
        .bind(f.prescription_id)
        .bind(item)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert_eq!(
        hms_db::pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation())
            .await
            .unwrap_err()
            .to_string(),
        "prescription_inventory_item_invalid"
    );
}

#[tokio::test]
async fn reviewed_replacement_preserves_given_and_supplied_evidence_and_does_not_move_stock() {
    use hms_db::clinical::prescription_courses::*;
    use hms_domain::clinical::{
        NewPrescriptionCourseRequest, PrescriptionCourseRelation,
        UpdatePrescriptionDocumentationRequest,
    };
    let f = Fixture::new().await;
    let generated = f.generate().await;
    let ids = f.dose_ids().await;
    hms_db::pharmacy::dispense_fulfillment(
        f.db.pool(),
        f.dispense(generated.pharmacy_fulfillment_id.unwrap(), 2),
    )
    .await
    .unwrap();
    hms_db::ward::administer_medication(
        f.db.pool(),
        f.db.facility_id(),
        ids[0],
        f.db.owner_user_id(),
        None,
    )
    .await
    .unwrap();
    let given: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(m) FROM medication_administrations m WHERE id=$1")
            .bind(ids[0])
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    let supplied:(bool,Option<DateTime<Utc>>,Option<Uuid>)=sqlx::query_as("SELECT is_dispensed,dispensed_at,dispensed_by_user_id FROM medication_administrations WHERE id=$1").bind(ids[1]).fetch_one(f.db.pool()).await.unwrap();
    let stock:i64=sqlx::query_scalar("SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE facility_id=$1 AND item_id=$2").bind(f.db.facility_id()).bind(f.item_id).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(stock, 98);
    let source = get_detail(f.db.pool(), f.db.facility_id(), f.prescription_id)
        .await
        .unwrap()
        .unwrap();
    let actor = PrescriptionActor {
        facility_id: f.db.facility_id(),
        user_id: f.db.owner_user_id(),
        request_id: None,
        authorization: None,
    };
    assert!(source.has_generated_course);
    assert_eq!(
        update_documentation(
            f.db.pool(),
            actor.clone(),
            f.prescription_id,
            UpdatePrescriptionDocumentationRequest {
                client_request_id: Uuid::new_v4(),
                expected_snapshot_token: source.snapshot_token.clone(),
                instructions: "Synthetic late instructions".into(),
                reason: "Synthetic late indication".into()
            }
        )
        .await
        .unwrap_err()
        .downcast_ref(),
        Some(&PrescriptionCourseError::DocumentationLocked)
    );
    let receipt = create_new_course(
        f.db.pool(),
        actor,
        f.prescription_id,
        NewPrescriptionCourseRequest {
            client_request_id: Uuid::new_v4(),
            expected_snapshot_token: source.snapshot_token,
            relation: PrescriptionCourseRelation::Replacement,
            change_reason: "Synthetic reviewed replacement".into(),
            medication_name: "Synthetic replacement medication".into(),
            dose: "2 tablets".into(),
            route: "oral".into(),
            frequency: "daily".into(),
            instructions: "Synthetic reviewed instructions".into(),
            reason: "Synthetic reviewed indication".into(),
            start_date: Utc::now().date_naive(),
            duration_days: Some(4),
            first_dose_at: None,
            encounter_id: None,
            visit_id: None,
            inventory_item_id: Some(f.item_id),
            expected_stock_unit: source.stock_unit,
            prn_policy: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(receipt.source_status_after, PrescriptionStatus::Stopped);
    let after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(m) FROM medication_administrations m WHERE id=$1")
            .bind(ids[0])
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(after, given);
    let (status,is_dispensed,dispensed_at,dispensed_by):(String,bool,Option<DateTime<Utc>>,Option<Uuid>)=sqlx::query_as("SELECT status,is_dispensed,dispensed_at,dispensed_by_user_id FROM medication_administrations WHERE id=$1").bind(ids[1]).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(status, "held");
    assert_eq!((is_dispensed, dispensed_at, dispensed_by), supplied);
    let current_stock:i64=sqlx::query_scalar("SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE facility_id=$1 AND item_id=$2").bind(f.db.facility_id()).bind(f.item_id).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(current_stock, stock);
    let child = receipt.prescription.prescription.id;
    let new_work:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM medication_administrations WHERE prescription_id=$1),(SELECT count(*) FROM medication_courses WHERE prescription_id=$1),(SELECT count(*) FROM pharmacy_fulfillments WHERE prescription_id=$1)").bind(child).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(new_work, (0, 0, 0));
    assert_eq!(
        receipt.prescription.prescription.status,
        PrescriptionStatus::Active
    );
}
