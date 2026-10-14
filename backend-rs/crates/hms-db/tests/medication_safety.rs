use chrono::{Duration, Utc};
use hms_db::clinical::NewPrescription;
use hms_db::inventory::NewStockBatch;
use hms_db::pharmacy::{DispenseFulfillmentCommand, GenerateMarCommand};
use hms_db::test_support::TestDb;
use hms_db::ward::NewMedicationAdministration;
use hms_domain::ward::MedicationAdministrationStatus;
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
async fn generated_medication_requires_dispensing_and_active_unchanged_clinical_sources() {
    let fixture = MedicationFixture::new("medication-safety").await;
    let first = fixture.medication_ids[0];
    let second = fixture.medication_ids[1];
    let before_dispense = fixture
        .administer(first, fixture.owner_id(), None)
        .await
        .unwrap_err();
    assert!(before_dispense
        .to_string()
        .contains("medication_not_dispensed"));

    fixture
        .update_prescription(json!({ "status": "on_hold" }))
        .await;
    let on_hold = fixture.dispense(1).await.unwrap_err();
    assert!(on_hold.to_string().contains("prescription_not_active"));
    fixture.assert_stock(10).await;
    fixture
        .update_prescription(json!({ "status": "active" }))
        .await;
    fixture
        .dispense(1)
        .await
        .expect("active course dispenses its first dose");
    fixture.assert_stock(9).await;

    fixture
        .update_prescription(json!({ "dose": "10 mg" }))
        .await;
    let changed = fixture
        .administer(first, fixture.owner_id(), None)
        .await
        .unwrap_err();
    assert!(changed
        .to_string()
        .contains("medication_course_prescription_changed"));
    assert!(fixture
        .dispense(1)
        .await
        .unwrap_err()
        .to_string()
        .contains("medication_course_prescription_changed"));
    fixture.assert_stock(9).await;
    fixture.update_prescription(json!({ "dose": "5 mg" })).await;

    let other_actor = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND id <> $2 AND is_active = TRUE ORDER BY id LIMIT 1",
    )
    .bind(fixture.facility_id())
    .bind(fixture.owner_id())
    .fetch_one(fixture.pool())
    .await
    .expect("second actor exists");
    let administered = fixture
        .administer(first, fixture.owner_id(), Some(other_actor))
        .await
        .expect("dispensed dose can be administered")
        .expect("dose exists");
    assert!(matches!(
        administered.status,
        MedicationAdministrationStatus::Administered
    ));
    fixture
        .update_prescription(json!({ "status": "stopped" }))
        .await;
    let repeated = fixture
        .administer(first, other_actor, Some(fixture.owner_id()))
        .await
        .expect("historical retry remains readable after prescription stops")
        .expect("dose exists");
    assert_eq!(administered.administered_at, repeated.administered_at);
    let actors = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT administered_by_user_id, witness_user_id FROM medication_administrations WHERE id = $1",
    ).bind(first).fetch_one(fixture.pool()).await.expect("administration evidence loads");
    assert_eq!(actors, (fixture.owner_id(), other_actor));
    assert!(fixture
        .administer(second, fixture.owner_id(), None)
        .await
        .unwrap_err()
        .to_string()
        .contains("prescription_not_active"));
    assert!(fixture
        .dispense(1)
        .await
        .unwrap_err()
        .to_string()
        .contains("prescription_not_active"));
    fixture.assert_stock(9).await;

    fixture
        .update_prescription(json!({ "status": "active" }))
        .await;
    fixture
        .dispense(1)
        .await
        .expect("second dose dispenses after the active source is restored");
    sqlx::query(
        "UPDATE admission_cases SET status = 'discharged' WHERE facility_id = $1 AND id = $2",
    )
    .bind(fixture.facility_id())
    .bind(fixture.admission_case_id)
    .execute(fixture.pool())
    .await
    .expect("synthetic completed admission is prepared");
    assert!(fixture
        .administer(second, fixture.owner_id(), None)
        .await
        .unwrap_err()
        .to_string()
        .contains("admission_not_active"));
    assert!(fixture
        .dispense(1)
        .await
        .unwrap_err()
        .to_string()
        .contains("admission_not_active"));
    let repeat = fixture
        .administer(first, other_actor, None)
        .await
        .expect("completed admission still allows an evidence-preserving retry")
        .expect("dose exists");
    assert_eq!(repeat.administered_at, administered.administered_at);
    fixture.assert_stock(8).await;
}

#[tokio::test]
async fn manual_medication_keeps_its_existing_workflow_and_held_doses_fail_closed() {
    let fixture = MedicationFixture::new("manual-medication").await;
    let manual = hms_db::ward::schedule_medication_administration(
        fixture.pool(),
        NewMedicationAdministration {
            id: Uuid::new_v4(),
            facility_id: fixture.facility_id(),
            admission_case_id: fixture.admission_case_id,
            patient_id: fixture.patient_id,
            medication_name: "Synthetic ward medication".to_owned(),
            dose: Some("5 mg".to_owned()),
            route: Some("oral".to_owned()),
            frequency: None,
            scheduled_at: Utc::now(),
            actor_user_id: fixture.owner_id(),
        },
    )
    .await
    .expect("manual MAR schedules");
    assert!(!manual.is_dispensed);
    let administered = fixture
        .administer(manual.id, fixture.owner_id(), None)
        .await
        .expect("manual dose does not require a generated fulfillment")
        .expect("dose exists");
    assert!(matches!(
        administered.status,
        MedicationAdministrationStatus::Administered
    ));
    sqlx::query(
        "UPDATE medication_administrations SET status = 'held', is_dispensed = TRUE WHERE id = $1",
    )
    .bind(fixture.medication_ids[0])
    .execute(fixture.pool())
    .await
    .expect("synthetic held dose is prepared");
    assert!(fixture
        .administer(fixture.medication_ids[0], fixture.owner_id(), None)
        .await
        .unwrap_err()
        .to_string()
        .contains("medication_not_scheduled"));
    assert!(hms_db::ward::administer_medication(
        fixture.pool(),
        Uuid::new_v4(),
        manual.id,
        fixture.owner_id(),
        None,
    )
    .await
    .expect("other facility lookup remains absent")
    .is_none());
}

#[tokio::test]
async fn pharmacy_fulfillment_excludes_expired_batches_without_mutating_its_ledger() {
    let fixture = MedicationFixture::new("expired-medication").await;
    sqlx::query("UPDATE stock_batches SET expires_on = CURRENT_DATE - 1 WHERE id = $1")
        .bind(fixture.batch_id)
        .execute(fixture.pool())
        .await
        .expect("expired synthetic batch is prepared");
    let expired = fixture.dispense(1).await.unwrap_err();
    assert!(expired.to_string().contains("insufficient_stock"));
    let manual_dispense = hms_db::inventory::create_dispense(
        fixture.pool(),
        hms_db::inventory::NewPharmacyDispense {
            id: Uuid::new_v4(),
            facility_id: fixture.facility_id(),
            patient_id: fixture.patient_id,
            item_id: fixture.item_id,
            location_id: fixture.location_id,
            quantity: 1,
            actor_user_id: fixture.owner_id(),
        },
    )
    .await
    .expect_err("manual dispensing also excludes expired batches");
    assert!(manual_dispense.to_string().contains("insufficient stock"));
    fixture.assert_stock(10).await;
    let dispense_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM pharmacy_dispenses WHERE facility_id = $1 AND patient_id = $2",
    )
    .bind(fixture.facility_id())
    .bind(fixture.patient_id)
    .fetch_one(fixture.pool())
    .await
    .expect("dispense ledger count loads");
    assert_eq!(dispense_count, 0);
    sqlx::query("UPDATE stock_batches SET expires_on = CURRENT_DATE WHERE id = $1")
        .bind(fixture.batch_id)
        .execute(fixture.pool())
        .await
        .expect("expiry-day stock is prepared");
    fixture
        .dispense(1)
        .await
        .expect("expiry date remains valid through that day");
    fixture.assert_stock(9).await;
}

#[tokio::test]
async fn concurrent_initial_mar_generation_returns_one_course_and_one_set_of_doses() {
    let fixture = MedicationFixture::new("concurrent-mar").await;
    let prescription = fixture.new_prescription().await;
    let command = GenerateMarCommand {
        facility_id: fixture.facility_id(),
        prescription_id: prescription,
        admission_case_id: fixture.admission_case_id,
        days: 3,
        first_dose_at: "2026-06-04T10:00:00.123456789Z"
            .parse()
            .expect("fractional synthetic anchor is valid"),
        actor_user_id: fixture.owner_id(),
    };
    let (first, second) = tokio::join!(
        hms_db::pharmacy::generate_mar_for_prescription(fixture.pool(), command.clone()),
        hms_db::pharmacy::generate_mar_for_prescription(fixture.pool(), command),
    );
    let first = first.expect("first concurrent generation succeeds");
    let second = second.expect("second concurrent generation succeeds");
    assert_eq!(first.window_start.timestamp_subsec_nanos(), 123456000);
    assert_eq!(first.window_start, second.window_start);
    assert_eq!(first.medication_course_id, second.medication_course_id);
    assert_eq!(
        first.pharmacy_fulfillment_id,
        second.pharmacy_fulfillment_id
    );
    assert_eq!(first.created_count + second.created_count, 3);
    assert_eq!(first.existing_count + second.existing_count, 3);
}

struct MedicationFixture {
    db: TestDb,
    patient_id: Uuid,
    admission_case_id: Uuid,
    prescription_id: Uuid,
    fulfillment_id: Uuid,
    medication_ids: Vec<Uuid>,
    item_id: Uuid,
    location_id: Uuid,
    batch_id: Uuid,
}

impl MedicationFixture {
    async fn new(slug: &str) -> Self {
        let db = TestDb::hospital()
            .await
            .expect("isolated test database provisions");
        let scenario = db
            .scenario(slug)
            .admission_case_with_available_bed()
            .await
            .expect("synthetic admission prepares");
        hms_db::ward::activate_admission_case(
            db.pool(),
            db.facility_id(),
            scenario.admission.id,
            db.owner_user_id(),
        )
        .await
        .expect("admission activates")
        .expect("active admission exists");
        let item_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM inventory_items WHERE facility_id = $1 AND controlled = FALSE AND is_active = TRUE ORDER BY id LIMIT 1",
        ).bind(db.facility_id()).fetch_one(db.pool()).await.expect("ordinary stock item exists");
        let location_id = Uuid::new_v4();
        sqlx::query("INSERT INTO storage_locations (id, facility_id, code, name) VALUES ($1, $2, $3, 'Synthetic pharmacy location')")
            .bind(location_id).bind(db.facility_id()).bind(location_id.to_string()).execute(db.pool())
            .await.expect("isolated synthetic stock location creates");
        let batch_id = Uuid::new_v4();
        hms_db::inventory::create_batch(
            db.pool(),
            NewStockBatch {
                id: batch_id,
                facility_id: db.facility_id(),
                item_id,
                location_id,
                batch_number: "SYNTHETIC-MEDICATION".to_owned(),
                expires_on: Some((Utc::now() + Duration::days(30)).date_naive()),
                quantity_received: 10,
                actor_user_id: db.owner_user_id(),
            },
        )
        .await
        .expect("synthetic stock receives");
        let mut fixture = Self {
            db,
            patient_id: scenario.patient.id,
            admission_case_id: scenario.admission.id,
            prescription_id: Uuid::nil(),
            fulfillment_id: Uuid::nil(),
            medication_ids: vec![],
            item_id,
            location_id,
            batch_id,
        };
        fixture.prescription_id = fixture.new_prescription().await;
        let generated = hms_db::pharmacy::generate_mar_for_prescription(
            fixture.pool(),
            GenerateMarCommand {
                facility_id: fixture.facility_id(),
                prescription_id: fixture.prescription_id,
                admission_case_id: fixture.admission_case_id,
                days: 3,
                first_dose_at: Utc::now(),
                actor_user_id: fixture.owner_id(),
            },
        )
        .await
        .expect("synthetic course generates");
        fixture.fulfillment_id = generated
            .pharmacy_fulfillment_id
            .expect("fulfillment exists");
        fixture.medication_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM medication_administrations WHERE facility_id = $1 AND prescription_id = $2 ORDER BY scheduled_at, id",
        ).bind(fixture.facility_id()).bind(fixture.prescription_id).fetch_all(fixture.pool()).await.expect("generated doses load");
        assert_eq!(fixture.medication_ids.len(), 3);
        fixture
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.db.pool()
    }
    fn facility_id(&self) -> Uuid {
        self.db.facility_id()
    }
    fn owner_id(&self) -> Uuid {
        self.db.owner_user_id()
    }
    async fn new_prescription(&self) -> Uuid {
        hms_db::clinical::create_prescription(
            self.pool(),
            NewPrescription {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: self.patient_id,
                encounter_id: None,
                visit_id: None,
                discharge_case_id: None,
                medication_name: "Synthetic medication".to_owned(),
                dose: "5 mg".to_owned(),
                route: "oral".to_owned(),
                frequency: "daily".to_owned(),
                inventory_item_id: Some(self.item_id),
                start_date: None,
                duration_days: Some(3),
                first_dose_at: None,
                actor_user_id: self.owner_id(),
            },
        )
        .await
        .expect("synthetic prescription creates")
        .id
    }
    async fn update_prescription(&self, payload: serde_json::Value) {
        hms_db::clinical::update_prescription(
            self.pool(),
            self.facility_id(),
            self.prescription_id,
            serde_json::from_value(payload).expect("prescription patch deserializes"),
        )
        .await
        .expect("prescription source updates")
        .expect("prescription exists");
    }
    async fn dispense(
        &self,
        quantity: i64,
    ) -> anyhow::Result<hms_domain::pharmacy::PharmacyFulfillmentDispenseResult> {
        hms_db::pharmacy::dispense_fulfillment(
            self.pool(),
            DispenseFulfillmentCommand {
                facility_id: self.facility_id(),
                fulfillment_id: self.fulfillment_id,
                item_id: self.item_id,
                location_id: self.location_id,
                quantity,
                actor_user_id: self.owner_id(),
            },
        )
        .await
    }
    async fn administer(
        &self,
        id: Uuid,
        actor: Uuid,
        witness: Option<Uuid>,
    ) -> anyhow::Result<Option<hms_domain::ward::MedicationAdministrationListItem>> {
        hms_db::ward::administer_medication(self.pool(), self.facility_id(), id, actor, witness)
            .await
    }
    async fn assert_stock(&self, expected: i64) {
        let quantity = sqlx::query_scalar::<_, i64>(
            "SELECT quantity_on_hand FROM stock_batches WHERE id = $1",
        )
        .bind(self.batch_id)
        .fetch_one(self.pool())
        .await
        .expect("synthetic batch quantity loads");
        assert_eq!(quantity, expected);
    }
}

#[tokio::test]
async fn mar_generation_batches_maximum_schedule_with_constant_queries_and_preserves_history() {
    let fixture = MedicationFixture::new("batched-mar").await;
    let small_prescription = fixture.new_prescription().await;
    let large_prescription = fixture.new_prescription().await;
    hms_db::clinical::update_prescription(
        fixture.pool(),
        fixture.facility_id(),
        large_prescription,
        serde_json::from_value(json!({ "frequency": "q4h", "duration_days": 31 }))
            .expect("maximum schedule patch deserializes"),
    )
    .await
    .expect("maximum schedule source updates")
    .expect("prescription exists");
    let anchor = "2026-06-04T10:00:00.123456789Z"
        .parse()
        .expect("synthetic anchor is valid");
    let small_command = GenerateMarCommand {
        facility_id: fixture.facility_id(),
        prescription_id: small_prescription,
        admission_case_id: fixture.admission_case_id,
        days: 1,
        first_dose_at: anchor,
        actor_user_id: fixture.owner_id(),
    };
    let large_command = GenerateMarCommand {
        prescription_id: large_prescription,
        days: 31,
        ..small_command.clone()
    };
    let (small, small_queries) = hms_observability::with_request_query_counter(
        hms_db::pharmacy::generate_mar_for_prescription(fixture.pool(), small_command),
    )
    .await;
    let small = small.expect("one-dose course generates");
    assert_eq!(small.created_count, 1);
    let (large, large_queries) = hms_observability::with_request_query_counter(
        hms_db::pharmacy::generate_mar_for_prescription(fixture.pool(), large_command.clone()),
    )
    .await;
    let large = large.expect("186-dose course generates");
    assert_eq!(large.created_count, 186);
    assert_eq!(large.requested_dose_count, 186);
    assert_eq!(large.existing_count, 0);
    assert_eq!(small_queries, large_queries);
    assert_eq!(
        large_queries, 7,
        "generation observes every repository query and remains bounded"
    );
    let fulfillment_id = large
        .pharmacy_fulfillment_id
        .expect("large fulfillment exists");
    let dose_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM medication_administrations WHERE facility_id = $1 AND medication_course_id = $2 ORDER BY dose_sequence",
    ).bind(fixture.facility_id()).bind(large.medication_course_id).fetch_all(fixture.pool())
        .await.expect("large course doses load");
    assert_eq!(dose_ids.len(), 186);
    hms_db::pharmacy::dispense_fulfillment(
        fixture.pool(),
        DispenseFulfillmentCommand {
            facility_id: fixture.facility_id(),
            fulfillment_id,
            item_id: fixture.item_id,
            location_id: fixture.location_id,
            quantity: 1,
            actor_user_id: fixture.owner_id(),
        },
    )
    .await
    .expect("first large-course dose dispenses");
    let original = fixture
        .administer(dose_ids[0], fixture.owner_id(), None)
        .await
        .expect("first large-course dose administers")
        .expect("dose exists");
    sqlx::query("UPDATE medication_administrations SET status = 'held' WHERE id = $1")
        .bind(dose_ids[1])
        .execute(fixture.pool())
        .await
        .expect("synthetic held dose prepares");

    let (repeat, repeated_queries) = hms_observability::with_request_query_counter(
        hms_db::pharmacy::generate_mar_for_prescription(fixture.pool(), large_command),
    )
    .await;
    let repeat = repeat.expect("maximum generation retries without rewriting existing doses");
    assert_eq!(repeat.created_count, 0);
    assert_eq!(repeat.existing_count, 186);
    assert_eq!(repeat.medication_course_id, large.medication_course_id);
    assert_eq!(repeat.pharmacy_fulfillment_id, Some(fulfillment_id));
    assert_eq!(repeated_queries, 6);
    let unchanged = hms_db::ward::get_medication_administration(
        fixture.pool(),
        fixture.facility_id(),
        dose_ids[0],
    )
    .await
    .expect("administered dose loads")
    .expect("dose exists");
    assert!(matches!(
        unchanged.status,
        MedicationAdministrationStatus::Administered
    ));
    assert_eq!(unchanged.administered_at, original.administered_at);
    assert!(unchanged.is_dispensed);
    let held = hms_db::ward::get_medication_administration(
        fixture.pool(),
        fixture.facility_id(),
        dose_ids[1],
    )
    .await
    .expect("held dose loads")
    .expect("dose exists");
    assert!(matches!(held.status, MedicationAdministrationStatus::Held));
    assert!(!held.is_dispensed);
    let link_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM pharmacy_fulfillment_mar_entries WHERE fulfillment_id = $1",
    )
    .bind(fulfillment_id)
    .fetch_one(fixture.pool())
    .await
    .expect("fulfillment links count loads");
    assert_eq!(link_count, 186);
    fixture.assert_stock(9).await;
}

#[tokio::test]
async fn medication_witness_is_active_and_facility_scoped_without_rewriting_completed_history() {
    let fixture = MedicationFixture::new("medication-witness").await;
    let foreign_facility_id = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities (id, code, name, deployment_profile) VALUES ($1, 'SYNTHETIC-WITNESS', 'Synthetic witness facility', 'hospital')")
        .bind(foreign_facility_id).execute(fixture.pool()).await.expect("synthetic second facility creates");
    let inactive_id = Uuid::new_v4();
    let foreign_id = Uuid::new_v4();
    for (id, facility_id, active) in [
        (inactive_id, fixture.facility_id(), false),
        (foreign_id, foreign_facility_id, true),
    ] {
        sqlx::query("INSERT INTO users (id, facility_id, email, display_name, password_hash, is_active) VALUES ($1, $2, $3, 'Synthetic witness', 'test-only-unused-hash', $4)")
            .bind(id).bind(facility_id).bind(format!("{id}@synthetic.invalid")).bind(active)
            .execute(fixture.pool()).await.expect("synthetic witness creates");
    }
    let dose = hms_db::ward::schedule_medication_administration(
        fixture.pool(),
        NewMedicationAdministration {
            id: Uuid::new_v4(),
            facility_id: fixture.facility_id(),
            admission_case_id: fixture.admission_case_id,
            patient_id: fixture.patient_id,
            medication_name: "Synthetic witnessed medication".to_owned(),
            dose: Some("5 mg".to_owned()),
            route: Some("oral".to_owned()),
            frequency: None,
            scheduled_at: Utc::now(),
            actor_user_id: fixture.owner_id(),
        },
    )
    .await
    .expect("manual witnessed dose schedules");
    for invalid_witness in [inactive_id, foreign_id, Uuid::new_v4()] {
        let denied = fixture
            .administer(dose.id, fixture.owner_id(), Some(invalid_witness))
            .await
            .expect_err("unavailable witness is rejected");
        assert!(denied
            .to_string()
            .contains("medication_witness_unavailable"));
        let pending = hms_db::ward::get_medication_administration(
            fixture.pool(),
            fixture.facility_id(),
            dose.id,
        )
        .await
        .expect("pending dose loads")
        .expect("dose exists");
        assert!(matches!(
            pending.status,
            MedicationAdministrationStatus::Scheduled
        ));
        assert!(pending.administered_at.is_none());
    }
    // Existing policy allows an active same-facility witness; no extra witness-role policy is introduced.
    let completed = fixture
        .administer(dose.id, fixture.owner_id(), Some(fixture.owner_id()))
        .await
        .expect("active facility witness is accepted")
        .expect("dose exists");
    let repeated = fixture
        .administer(dose.id, fixture.owner_id(), Some(foreign_id))
        .await
        .expect("completed retry ignores replacement witness input")
        .expect("dose exists");
    assert_eq!(completed.administered_at, repeated.administered_at);
    let original_witness = sqlx::query_scalar::<_, Uuid>(
        "SELECT witness_user_id FROM medication_administrations WHERE id = $1",
    )
    .bind(dose.id)
    .fetch_one(fixture.pool())
    .await
    .expect("original witness evidence loads");
    assert_eq!(original_witness, fixture.owner_id());
}
