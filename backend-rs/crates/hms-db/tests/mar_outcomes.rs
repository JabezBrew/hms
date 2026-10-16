use chrono::{DateTime, Duration, Utc};
use hms_db::{
    clinical::NewPrescription,
    pharmacy::{DispenseFulfillmentCommand, GenerateMarCommand},
    test_support::TestDb,
    ward::{MedicationOutcomeError, RecordMedicationOutcome},
};
use hms_domain::{
    clinical::{PrescriptionStatus, UpdatePrescriptionRequest},
    ward::MedicationAdministrationOutcome as Outcome,
};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    prescription: Uuid,
    fulfillment: Uuid,
    doses: Vec<Uuid>,
    item: Uuid,
    location: Uuid,
}
impl Fixture {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let care = db
            .scenario("mar-outcomes")
            .admission_case_with_available_bed()
            .await
            .unwrap();
        hms_db::ward::activate_admission_case(
            db.pool(),
            db.facility_id(),
            care.admission.id,
            db.owner_user_id(),
        )
        .await
        .unwrap();
        let item = sqlx::query_scalar(
            "SELECT id FROM inventory_items WHERE facility_id = $1 AND NOT controlled LIMIT 1",
        )
        .bind(db.facility_id())
        .fetch_one(db.pool())
        .await
        .unwrap();
        let location =
            sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id = $1 LIMIT 1")
                .bind(db.facility_id())
                .fetch_one(db.pool())
                .await
                .unwrap();
        sqlx::query("INSERT INTO stock_batches (id,facility_id,item_id,location_id,batch_number,quantity_on_hand) VALUES ($1,$2,$3,$4,'SYNTHETIC-OUTCOMES',100)").bind(Uuid::new_v4()).bind(db.facility_id()).bind(item).bind(location).execute(db.pool()).await.unwrap();
        let prescription = Uuid::new_v4();
        let first = Utc::now() - Duration::hours(13);
        create_reviewed_scheduled_fixture(
            db.pool(),
            NewPrescription {
                id: prescription,
                facility_id: db.facility_id(),
                patient_id: care.patient.id,
                encounter_id: None,
                visit_id: None,
                discharge_case_id: None,
                medication_name: "Synthetic medication".to_owned(),
                dose: "1 tablet".to_owned(),
                route: "oral".to_owned(),
                frequency: "q6h".to_owned(),
                inventory_item_id: Some(item),
                start_date: Some(first.date_naive()),
                duration_days: Some(2),
                first_dose_at: Some(first),
                actor_user_id: db.owner_user_id(),
            },
        )
        .await
        .unwrap();
        let generated = hms_db::pharmacy::generate_mar_for_prescription(
            db.pool(),
            GenerateMarCommand {
                authorization: None,
                facility_id: db.facility_id(),
                prescription_id: prescription,
                admission_case_id: care.admission.id,
                days: 2,
                first_dose_at: Some(first),
                actor_user_id: db.owner_user_id(),
            },
        )
        .await
        .unwrap();
        let doses = sqlx::query_scalar("SELECT id FROM medication_administrations WHERE prescription_id=$1 ORDER BY dose_sequence").bind(prescription).fetch_all(db.pool()).await.unwrap();
        Self {
            db,
            prescription,
            fulfillment: generated.pharmacy_fulfillment_id.unwrap(),
            doses,
            item,
            location,
        }
    }
    fn command(&self, index: usize, status: Outcome) -> RecordMedicationOutcome {
        RecordMedicationOutcome {
            authorization: None,
            facility_id: self.db.facility_id(),
            medication_id: self.doses[index],
            actor_user_id: self.db.owner_user_id(),
            status,
            witness_user_id: None,
            reason_not_given: (status != Outcome::Administered)
                .then(|| "Synthetic reason".to_owned()),
            administration_notes: Some("Synthetic observation".to_owned()),
            request_id: Some("mar-outcome-contract".to_owned()),
        }
    }
    async fn record(
        &self,
        index: usize,
        status: Outcome,
    ) -> hms_domain::ward::MedicationAdministrationListItem {
        hms_db::ward::record_medication_outcome(self.db.pool(), self.command(index, status))
            .await
            .unwrap()
            .unwrap()
    }
    async fn dispense(&self, quantity: i64) {
        hms_db::pharmacy::dispense_fulfillment(
            self.db.pool(),
            DispenseFulfillmentCommand {
                authorization: None,
                facility_id: self.db.facility_id(),
                fulfillment_id: self.fulfillment,
                item_id: self.item,
                location_id: self.location,
                quantity,
                actor_user_id: self.db.owner_user_id(),
            },
        )
        .await
        .unwrap();
    }
    async fn source_status(&self, status: PrescriptionStatus) {
        hms_db::clinical::update_prescription(
            self.db.pool(),
            self.db.facility_id(),
            self.prescription,
            UpdatePrescriptionRequest {
                medication_name: None,
                dose: None,
                route: None,
                frequency: None,
                inventory_item_id: None,
                start_date: None,
                duration_days: None,
                first_dose_at: None,
                status: Some(status),
            },
        )
        .await
        .unwrap();
    }
}
fn failure<T: std::fmt::Debug>(result: anyhow::Result<T>, expected: MedicationOutcomeError) {
    assert_eq!(
        result.unwrap_err().downcast_ref::<MedicationOutcomeError>(),
        Some(&expected)
    );
}

#[tokio::test]
async fn nonadministration_preserves_real_outcomes_and_exact_replay_without_false_administration() {
    let f = Fixture::new().await;
    for (index, outcome, expected) in [
        (0, Outcome::Missed, "missed"),
        (1, Outcome::Refused, "refused"),
        (3, Outcome::Held, "held"),
    ] {
        let saved = f.record(index, outcome).await;
        assert_eq!(serde_json::to_value(saved.status).unwrap(), expected);
        assert_eq!(saved.administered_at, None);
        assert_eq!(
            saved.outcome_recorded_by_user_id,
            Some(f.db.owner_user_id())
        );
        assert!(saved.outcome_recorded_at.is_some());
        assert!(!saved.prescription_held);
        assert_eq!(saved.reason_not_given.as_deref(), Some("Synthetic reason"));
        assert_eq!(
            saved.administration_notes.as_deref(),
            Some("Synthetic observation")
        );
        let replay =
            hms_db::ward::record_medication_outcome(f.db.pool(), f.command(index, outcome))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(saved.outcome_recorded_at, replay.outcome_recorded_at);
        failure(
            hms_db::ward::record_medication_outcome(
                f.db.pool(),
                f.command(index, Outcome::Administered),
            )
            .await,
            MedicationOutcomeError::NotActionable,
        );
    }
    let audits: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT metadata FROM audit_events WHERE event_type='nursing.medication_outcome.recorded'",
    )
    .fetch_all(f.db.pool())
    .await
    .unwrap();
    assert_eq!(audits.len(), 3);
    assert!(audits
        .iter()
        .all(|value| value.as_object().unwrap().len() == 1 && value.get("outcome").is_some()));
    f.source_status(PrescriptionStatus::OnHold).await;
    f.source_status(PrescriptionStatus::Active).await;
    let held =
        hms_db::ward::get_medication_administration(f.db.pool(), f.db.facility_id(), f.doses[3])
            .await
            .unwrap()
            .unwrap();
    assert!(matches!(
        held.status,
        hms_domain::ward::MedicationAdministrationStatus::Held
    ));
    assert!(!held.prescription_held);
    assert_eq!(held.reason_not_given.as_deref(), Some("Synthetic reason"));
}

#[tokio::test]
async fn actual_administration_requires_supply_and_terminal_decisions_preserve_supply_history() {
    let f = Fixture::new().await;
    failure(
        hms_db::ward::record_medication_outcome(f.db.pool(), f.command(0, Outcome::Administered))
            .await,
        MedicationOutcomeError::NotDispensed,
    );
    f.dispense(1).await;
    let supply: (i32, Option<DateTime<Utc>>, Option<Uuid>) = sqlx::query_as("SELECT dispensed_dose_count,dispensed_at,dispensed_by_user_id FROM pharmacy_fulfillments WHERE id=$1").bind(f.fulfillment).fetch_one(f.db.pool()).await.unwrap();
    let given = f.record(0, Outcome::Administered).await;
    assert!(given.administered_at.is_some());
    assert!(given.is_dispensed);
    assert!(given.reason_not_given.is_none());
    f.record(1, Outcome::Refused).await;
    let after: (i32, Option<DateTime<Utc>>, Option<Uuid>, i32, String) = sqlx::query_as("SELECT dispensed_dose_count,dispensed_at,dispensed_by_user_id,requested_dose_count,status FROM pharmacy_fulfillments WHERE id=$1").bind(f.fulfillment).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!((after.0, after.1, after.2), supply);
    assert_eq!((after.3, after.4.as_str()), (7, "partially_dispensed"));
    let movements: i64 = sqlx::query_scalar("SELECT count(*) FROM stock_movements WHERE movement_type='dispense' AND reason='pharmacy_fulfillment'").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(movements, 1);
}

#[tokio::test]
async fn concurrent_administered_and_refused_decisions_have_one_immutable_audited_winner() {
    let f = Fixture::new().await;
    f.dispense(1).await;
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let mut tasks = Vec::new();
    for status in [Outcome::Administered, Outcome::Refused] {
        let pool = f.db.pool().clone();
        let command = f.command(0, status);
        let barrier = barrier.clone();
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            hms_db::ward::record_medication_outcome(&pool, command).await
        }));
    }
    let first = tasks.remove(0).await.unwrap();
    let second = tasks.remove(0).await.unwrap();
    assert_ne!(first.is_ok(), second.is_ok());
    let saved = first.ok().or_else(|| second.ok()).unwrap().unwrap();
    assert_eq!(
        saved.administered_at.is_some(),
        matches!(
            saved.status,
            hms_domain::ward::MedicationAdministrationStatus::Administered
        )
    );
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE event_type='nursing.medication_outcome.recorded' AND resource_id=$1").bind(f.doses[0]).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn invalid_reasons_notes_future_missed_and_foreign_witness_cannot_write() {
    let f = Fixture::new().await;
    let mut command = f.command(0, Outcome::Refused);
    command.reason_not_given = Some("   ".to_owned());
    failure(
        hms_db::ward::record_medication_outcome(f.db.pool(), command).await,
        MedicationOutcomeError::InvalidReason,
    );
    let mut command = f.command(0, Outcome::Refused);
    command.reason_not_given = Some("é".repeat(501));
    failure(
        hms_db::ward::record_medication_outcome(f.db.pool(), command).await,
        MedicationOutcomeError::InvalidReason,
    );
    let mut command = f.command(0, Outcome::Refused);
    command.administration_notes = Some("n".repeat(2001));
    failure(
        hms_db::ward::record_medication_outcome(f.db.pool(), command).await,
        MedicationOutcomeError::NotesTooLong,
    );
    failure(
        hms_db::ward::record_medication_outcome(f.db.pool(), f.command(3, Outcome::Missed)).await,
        MedicationOutcomeError::FutureMissed,
    );
    let foreign_facility = Uuid::new_v4();
    let foreign_user = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'FOREIGN-OUTCOME','Synthetic facility','hospital')").bind(foreign_facility).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,$2,'foreign-outcome@synthetic.invalid','Synthetic witness',password_hash FROM users WHERE id=$3").bind(foreign_user).bind(foreign_facility).bind(f.db.owner_user_id()).execute(f.db.pool()).await.unwrap();
    f.dispense(1).await;
    let mut command = f.command(0, Outcome::Administered);
    command.witness_user_id = Some(foreign_user);
    failure(
        hms_db::ward::record_medication_outcome(f.db.pool(), command).await,
        MedicationOutcomeError::InvalidWitness,
    );
    let mut command = f.command(0, Outcome::Refused);
    command.facility_id = foreign_facility;
    assert!(
        hms_db::ward::record_medication_outcome(f.db.pool(), command)
            .await
            .unwrap()
            .is_none()
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_events WHERE event_type='nursing.medication_outcome.recorded'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn waiting_outcome_observes_source_stop_and_cannot_record_a_stale_dose() {
    let f = Fixture::new().await;
    let mut blocker = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
        .bind(f.prescription)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let command = f.command(0, Outcome::Refused);
    let task =
        tokio::spawn(async move { hms_db::ward::record_medication_outcome(&pool, command).await });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(!task.is_finished());
    sqlx::query("UPDATE prescriptions SET status='stopped' WHERE id=$1")
        .bind(f.prescription)
        .execute(&mut *blocker)
        .await
        .unwrap();
    blocker.commit().await.unwrap();
    failure(task.await.unwrap(), MedicationOutcomeError::NotActionable);
}

#[tokio::test]
async fn outcome_audit_failure_rolls_back_decision_and_requested_supply() {
    let f = Fixture::new().await;
    sqlx::query("CREATE FUNCTION reject_outcome_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='nursing.medication_outcome.recorded' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$").execute(f.db.pool()).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_outcome_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_outcome_audit()").execute(f.db.pool()).await.unwrap();
    assert!(
        hms_db::ward::record_medication_outcome(f.db.pool(), f.command(0, Outcome::Refused))
            .await
            .is_err()
    );
    let row: (String, Option<DateTime<Utc>>) = sqlx::query_as(
        "SELECT status,outcome_recorded_at FROM medication_administrations WHERE id=$1",
    )
    .bind(f.doses[0])
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(row, ("scheduled".to_owned(), None));
    let requested: i32 =
        sqlx::query_scalar("SELECT requested_dose_count FROM pharmacy_fulfillments WHERE id=$1")
            .bind(f.fulfillment)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(requested, 8);
}

#[tokio::test]
async fn retiring_all_unsupplied_doses_closes_only_the_request_without_creating_supply() {
    let f = Fixture::new().await;
    for index in 0..f.doses.len() {
        f.record(index, Outcome::Held).await;
    }
    let row:(i32,i32,String,Option<DateTime<Utc>>)=sqlx::query_as("SELECT requested_dose_count,dispensed_dose_count,status,dispensed_at FROM pharmacy_fulfillments WHERE id=$1").bind(f.fulfillment).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(row, (0, 0, "cancelled".to_owned(), None));
    let supplies:i64=sqlx::query_scalar("SELECT count(*) FROM pharmacy_dispenses WHERE patient_id IN(SELECT patient_id FROM medication_administrations WHERE id=$1)").bind(f.doses[0]).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(supplies, 0);
}

#[tokio::test]
async fn outcome_migration_only_backfills_real_historical_administration_evidence() {
    let f = Fixture::new().await;
    sqlx::query("UPDATE medication_administrations SET status='administered',administered_at=now(),administered_by_user_id=$2 WHERE id=$1").bind(f.doses[0]).bind(f.db.owner_user_id()).execute(f.db.pool()).await.unwrap();
    sqlx::query("UPDATE medication_administrations SET status='held' WHERE id=$1")
        .bind(f.doses[1])
        .execute(f.db.pool())
        .await
        .unwrap();
    sqlx::raw_sql("ALTER TABLE medication_administrations DROP COLUMN reason_not_given CASCADE, DROP COLUMN administration_notes CASCADE, DROP COLUMN outcome_recorded_at CASCADE, DROP COLUMN outcome_recorded_by_user_id CASCADE").execute(f.db.pool()).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/202610150006_mar_outcomes.sql"
    ))
    .execute(f.db.pool())
    .await
    .unwrap();
    let administered:(Option<DateTime<Utc>>,Option<DateTime<Utc>>,Option<Uuid>)=sqlx::query_as("SELECT administered_at,outcome_recorded_at,outcome_recorded_by_user_id FROM medication_administrations WHERE id=$1").bind(f.doses[0]).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(administered.0, administered.1);
    assert_eq!(administered.2, Some(f.db.owner_user_id()));
    let held:(Option<DateTime<Utc>>,Option<Uuid>,Option<String>)=sqlx::query_as("SELECT outcome_recorded_at,outcome_recorded_by_user_id,reason_not_given FROM medication_administrations WHERE id=$1").bind(f.doses[1]).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(held, (None, None, None));
}

// Synthetic scenario deliberately reviews one inventory unit per dose. This is
// fixture input, never a default for existing or newly submitted prescriptions.
async fn create_reviewed_scheduled_fixture(
    pool: &hms_db::PgPool,
    prescription: hms_db::clinical::NewPrescription,
) -> anyhow::Result<hms_domain::clinical::PrescriptionDetail> {
    let expected_stock_unit =
        sqlx::query_scalar("SELECT unit FROM inventory_items WHERE facility_id=$1 AND id=$2")
            .bind(prescription.facility_id)
            .bind(prescription.inventory_item_id.unwrap())
            .fetch_one(pool)
            .await?;
    hms_db::clinical::prescription_courses::create_with_stock_policy(
        pool,
        prescription,
        None,
        Some(hms_domain::clinical::ScheduledStockPolicyRequest {
            expected_stock_unit,
            stock_units_per_dose: 1,
        }),
        hms_db::clinical::prescription_courses::PrescriptionDocumentation::default(),
        None,
        None,
    )
    .await
}
