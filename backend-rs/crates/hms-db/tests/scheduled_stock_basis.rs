use chrono::{Duration, Utc};
use hms_db::{
    clinical::{self, prescription_courses::*, NewPrescription},
    pharmacy::{self, DispenseFulfillmentCommand, GenerateMarCommand},
    test_support::TestDb,
};
use hms_domain::clinical::*;
use hms_domain::ward::MedicationAdministrationOutcome as Outcome;
use uuid::Uuid;
struct Fixture {
    db: TestDb,
    patient: Uuid,
    admission: Uuid,
    source: Uuid,
    item: Uuid,
    location: Uuid,
    unit: String,
}
impl Fixture {
    async fn new(reviewed: bool) -> Self {
        let db = TestDb::hospital().await.unwrap();
        let care = db
            .scenario("scheduled-stock-review")
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
        let (item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled AND item_type='medication' LIMIT 1").bind(db.facility_id()).fetch_one(db.pool()).await.unwrap();
        let location = sqlx::query_scalar(
            "SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active LIMIT 1",
        )
        .bind(db.facility_id())
        .fetch_one(db.pool())
        .await
        .unwrap();
        sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand) VALUES($1,$2,$3,$4,'SYNTHETIC-STOCK',100)").bind(Uuid::new_v4()).bind(db.facility_id()).bind(item).bind(location).execute(db.pool()).await.unwrap();
        let source = Uuid::new_v4();
        let order = NewPrescription {
            id: source,
            facility_id: db.facility_id(),
            patient_id: care.patient.id,
            encounter_id: None,
            visit_id: None,
            discharge_case_id: None,
            medication_name: "Synthetic medication".into(),
            dose: "Clinical text is not arithmetic".into(),
            route: "oral".into(),
            frequency: "q6h".into(),
            inventory_item_id: Some(item),
            start_date: Some((Utc::now() - Duration::days(1)).date_naive()),
            duration_days: Some(3),
            first_dose_at: Some(Utc::now() - Duration::hours(13)),
            actor_user_id: db.owner_user_id(),
        };
        create_with_stock_policy(
            db.pool(),
            order,
            None,
            reviewed.then(|| ScheduledStockPolicyRequest {
                expected_stock_unit: unit.clone(),
                stock_units_per_dose: 2,
            }),
            PrescriptionDocumentation::default(),
            None,
            None,
        )
        .await
        .unwrap();
        Self {
            db,
            patient: care.patient.id,
            admission: care.admission.id,
            source,
            item,
            location,
            unit,
        }
    }
    fn actor(&self) -> PrescriptionActor {
        PrescriptionActor {
            facility_id: self.db.facility_id(),
            user_id: self.db.owner_user_id(),
            request_id: None,
            authorization: None,
        }
    }
    fn generation(&self) -> GenerateMarCommand {
        GenerateMarCommand {
            authorization: None,
            facility_id: self.db.facility_id(),
            prescription_id: self.source,
            admission_case_id: self.admission,
            days: 2,
            first_dose_at: None,
            actor_user_id: self.db.owner_user_id(),
        }
    }
    fn supply(&self, id: Uuid, doses: i64) -> DispenseFulfillmentCommand {
        DispenseFulfillmentCommand {
            authorization: None,
            facility_id: self.db.facility_id(),
            fulfillment_id: id,
            item_id: self.item,
            location_id: self.location,
            quantity: doses,
            actor_user_id: self.db.owner_user_id(),
        }
    }
    fn outcome(&self, dose: Uuid, status: Outcome) -> hms_db::ward::RecordMedicationOutcome {
        hms_db::ward::RecordMedicationOutcome {
            authorization: None,
            facility_id: self.db.facility_id(),
            medication_id: dose,
            actor_user_id: self.db.owner_user_id(),
            status,
            witness_user_id: None,
            reason_not_given: (status != Outcome::Administered)
                .then(|| "Synthetic reviewed retirement".into()),
            administration_notes: None,
            request_id: None,
        }
    }
    async fn doses(&self) -> Vec<Uuid> {
        sqlx::query_scalar("SELECT id FROM medication_administrations WHERE prescription_id=$1 ORDER BY dose_sequence").bind(self.source).fetch_all(self.db.pool()).await.unwrap()
    }
    async fn total(&self) -> i64 {
        sqlx::query_scalar(
            "SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE item_id=$1",
        )
        .bind(self.item)
        .fetch_one(self.db.pool())
        .await
        .unwrap()
    }
    async fn close(&self) {
        sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
            .bind(self.admission)
            .execute(self.db.pool())
            .await
            .unwrap();
    }
}
fn basis<T: std::fmt::Debug>(
    value: anyhow::Result<T>,
    expected: clinical::stock_basis::StockBasisError,
) {
    assert_eq!(
        value
            .unwrap_err()
            .downcast_ref::<clinical::stock_basis::StockBasisError>(),
        Some(&expected)
    );
}
#[tokio::test]
async fn reviewed_scheduled_dose_uses_explicit_physical_quantity_and_saved_unit() {
    let f = Fixture::new(true).await;
    let generated = pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation())
        .await
        .unwrap();
    let before = f.total().await;
    let issued = pharmacy::dispense_fulfillment(
        f.db.pool(),
        f.supply(generated.pharmacy_fulfillment_id.unwrap(), 3),
    )
    .await
    .unwrap();
    assert_eq!(issued.issued_stock_quantity, 6);
    assert_eq!(issued.issued_stock_unit, f.unit);
    assert_eq!(f.total().await, before - 6);
    let rows:Vec<(i64,String)>=sqlx::query_as("SELECT dispensed_stock_quantity,dispensed_stock_unit FROM medication_administrations WHERE prescription_id=$1 AND is_dispensed").bind(f.source).fetch_all(f.db.pool()).await.unwrap();
    assert_eq!(rows, vec![(2, f.unit.clone()); 3]);
    let doses = f.doses().await;
    let given = hms_db::ward::record_medication_outcome(
        f.db.pool(),
        f.outcome(doses[0], Outcome::Administered),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(given.dispensed_stock_quantity, Some(2));
    let history: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(m) FROM medication_administrations m WHERE id=$1")
            .bind(doses[0])
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    f.close().await;
    let replay = hms_db::ward::record_medication_outcome(
        f.db.pool(),
        f.outcome(doses[0], Outcome::Administered),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(replay.administered_at, given.administered_at);
    let after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(m) FROM medication_administrations m WHERE id=$1")
            .bind(doses[0])
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(history, after);
    basis(
        hms_db::ward::record_medication_outcome(
            f.db.pool(),
            f.outcome(doses[1], Outcome::Administered),
        )
        .await,
        clinical::stock_basis::StockBasisError::AdmissionInactive,
    );
    hms_db::ward::record_medication_outcome(f.db.pool(), f.outcome(doses[1], Outcome::Refused))
        .await
        .unwrap();
    assert_eq!(f.total().await, before - 6);
}
#[tokio::test]
async fn legacy_scheduled_source_requires_reviewed_new_course_without_inferred_backfill() {
    let f = Fixture::new(false).await;
    basis(
        pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation()).await,
        clinical::stock_basis::StockBasisError::ReviewRequired,
    );
    let detail = get_detail(f.db.pool(), f.db.facility_id(), f.source)
        .await
        .unwrap()
        .unwrap();
    assert!(detail.scheduled_stock_policy.is_none());
    let successor = create_new_course(
        f.db.pool(),
        f.actor(),
        f.source,
        NewPrescriptionCourseRequest {
            client_request_id: Uuid::new_v4(),
            expected_snapshot_token: detail.snapshot_token,
            relation: PrescriptionCourseRelation::Replacement,
            change_reason: "Synthetic explicit stock review".into(),
            medication_name: "Synthetic reviewed medication".into(),
            dose: "Clinical text retained separately".into(),
            route: "oral".into(),
            frequency: "daily".into(),
            instructions: String::new(),
            reason: String::new(),
            start_date: Utc::now().date_naive(),
            duration_days: Some(2),
            first_dose_at: None,
            encounter_id: None,
            visit_id: None,
            inventory_item_id: Some(f.item),
            expected_stock_unit: Some(f.unit.clone()),
            prn_policy: None,
            scheduled_stock_policy: Some(ScheduledStockPolicyRequest {
                expected_stock_unit: f.unit.clone(),
                stock_units_per_dose: 3,
            }),
        },
    )
    .await
    .unwrap();
    assert_eq!(successor.source_status_after, PrescriptionStatus::Stopped);
    assert_eq!(
        successor
            .prescription
            .scheduled_stock_policy
            .unwrap()
            .stock_units_per_dose,
        3
    );
    let source = get_detail(f.db.pool(), f.db.facility_id(), f.source)
        .await
        .unwrap()
        .unwrap();
    assert!(source.scheduled_stock_policy.is_none());
    assert_eq!(f.total().await, 100);
    let mut command = f.generation();
    command.prescription_id = successor.prescription.prescription.id;
    command.first_dose_at = None;
    assert!(
        pharmacy::generate_mar_for_prescription(f.db.pool(), command)
            .await
            .is_ok()
    );
}
#[tokio::test]
async fn scheduled_supply_and_given_fail_closed_on_inactive_item_or_changed_unit() {
    for changed_unit in [false, true] {
        let f = Fixture::new(true).await;
        let generated = pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation())
            .await
            .unwrap();
        let id = generated.pharmacy_fulfillment_id.unwrap();
        pharmacy::dispense_fulfillment(f.db.pool(), f.supply(id, 1))
            .await
            .unwrap();
        if changed_unit {
            sqlx::query("UPDATE inventory_items SET unit='SYNTHETIC-CHANGED' WHERE id=$1")
                .bind(f.item)
                .execute(f.db.pool())
                .await
                .unwrap();
        } else {
            sqlx::query("UPDATE inventory_items SET is_active=false WHERE id=$1")
                .bind(f.item)
                .execute(f.db.pool())
                .await
                .unwrap();
        }
        let expected = if changed_unit {
            clinical::stock_basis::StockBasisError::UnitChanged
        } else {
            clinical::stock_basis::StockBasisError::ItemNotActionable
        };
        basis(
            pharmacy::dispense_fulfillment(f.db.pool(), f.supply(id, 1)).await,
            expected,
        );
        basis(
            hms_db::ward::record_medication_outcome(
                f.db.pool(),
                f.outcome(f.doses().await[0], Outcome::Administered),
            )
            .await,
            expected,
        );
        assert_eq!(f.total().await, 98);
        hms_db::ward::record_medication_outcome(
            f.db.pool(),
            f.outcome(f.doses().await[0], Outcome::Held),
        )
        .await
        .unwrap();
    }
}
#[tokio::test]
async fn scheduled_generation_and_supply_require_active_admission() {
    let f = Fixture::new(true).await;
    f.close().await;
    basis(
        pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation()).await,
        clinical::stock_basis::StockBasisError::AdmissionInactive,
    );
    let f = Fixture::new(true).await;
    let generated = pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation())
        .await
        .unwrap();
    f.close().await;
    basis(
        pharmacy::dispense_fulfillment(
            f.db.pool(),
            f.supply(generated.pharmacy_fulfillment_id.unwrap(), 1),
        )
        .await,
        clinical::stock_basis::StockBasisError::AdmissionInactive,
    );
    assert_eq!(f.total().await, 100);
}
#[test]
fn physical_quantity_does_not_overflow_or_infer_fractional_inventory_units() {
    assert_eq!(clinical::stock_basis::stock_quantity(3, 2).unwrap(), 6);
    assert!(clinical::stock_basis::stock_quantity(2, 9_007_199_254_740_991).is_err());
    assert!(clinical::stock_basis::stock_quantity(1, 0).is_err());
}

#[tokio::test]
async fn ordinary_create_rechecks_selected_visit_after_checkout_wait() {
    let f = Fixture::new(true).await;
    let visit = Uuid::new_v4();
    sqlx::query("INSERT INTO visits(id,facility_id,patient_id,status,created_by_user_id) VALUES($1,$2,$3,'in_consultation',$4)").bind(visit).bind(f.db.facility_id()).bind(f.patient).bind(f.db.owner_user_id()).execute(f.db.pool()).await.unwrap();
    let mut held = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("UPDATE visits SET status='checked_out' WHERE id=$1")
        .bind(visit)
        .execute(&mut *held)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let input = NewPrescription {
        id: Uuid::new_v4(),
        facility_id: f.db.facility_id(),
        patient_id: f.patient,
        encounter_id: None,
        visit_id: Some(visit),
        discharge_case_id: None,
        medication_name: "Synthetic waiting medication".into(),
        dose: "Explicit clinical text".into(),
        route: "oral".into(),
        frequency: "daily".into(),
        inventory_item_id: None,
        start_date: None,
        duration_days: None,
        first_dose_at: None,
        actor_user_id: f.db.owner_user_id(),
    };
    let pending = tokio::spawn(async move {
        create_with_stock_policy(
            &pool,
            input,
            None,
            None,
            PrescriptionDocumentation::default(),
            None,
            None,
        )
        .await
    });
    wait_blocked(f.db.pool(), pid).await;
    held.commit().await.unwrap();
    assert_eq!(
        pending
            .await
            .unwrap()
            .unwrap_err()
            .downcast_ref::<PrescriptionCourseError>(),
        Some(&PrescriptionCourseError::InvalidContext)
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM prescriptions WHERE patient_id=$1")
        .bind(f.patient)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 1);
}
async fn wait_blocked(pool: &hms_db::PgPool, pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(2),async{loop{let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(pool).await.unwrap();if blocked{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("production command reaches held row");
}
fn correction(db: &TestDb, item: Uuid, unit: &str) -> hms_db::inventory::CatalogEditCommand {
    hms_db::inventory::CatalogEditCommand {
        authorization: None,
        id: Uuid::new_v4(),
        facility_id: db.facility_id(),
        item_id: item,
        effective_from: Utc::now().date_naive(),
        code: "SYNTHETIC-REVIEWED".into(),
        name: "Synthetic reviewed stock".into(),
        unit: unit.into(),
        reason: "Synthetic explicit correction".into(),
        actor_user_id: db.owner_user_id(),
    }
}
async fn blank_stock(db: &TestDb) -> (Uuid, Uuid) {
    let item = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit) SELECT $1,$2,category_id,'SYNTHETIC-NEW','Synthetic new stock','medication','tablet' FROM inventory_items WHERE facility_id=$2 LIMIT 1").bind(item).bind(db.facility_id()).execute(db.pool()).await.unwrap();
    let location = sqlx::query_scalar(
        "SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active LIMIT 1",
    )
    .bind(db.facility_id())
    .fetch_one(db.pool())
    .await
    .unwrap();
    (item, location)
}
fn receipt(db: &TestDb, item: Uuid, location: Uuid) -> hms_db::inventory::NewStockBatch {
    hms_db::inventory::NewStockBatch {
        authorization: None,
        expected_unit: "tablet".into(),
        id: Uuid::new_v4(),
        facility_id: db.facility_id(),
        item_id: item,
        location_id: location,
        batch_number: "SYNTHETIC-RECEIPT".into(),
        expires_on: None,
        quantity_received: 10,
        actor_user_id: db.owner_user_id(),
    }
}
#[tokio::test]
async fn catalog_unit_cannot_reinterpret_any_stock_history_even_when_balance_zero() {
    let db = TestDb::hospital().await.unwrap();
    let (item, location) = blank_stock(&db).await;
    let saved = hms_db::inventory::create_batch(db.pool(), receipt(&db, item, location))
        .await
        .unwrap();
    sqlx::query("UPDATE stock_batches SET quantity_on_hand=0 WHERE id=$1")
        .bind(saved.id)
        .execute(db.pool())
        .await
        .unwrap();
    basis(
        hms_db::inventory::apply_catalog_edit(db.pool(), correction(&db, item, "pack")).await,
        clinical::stock_basis::StockBasisError::InventoryUnitInUse,
    );
    assert!(
        hms_db::inventory::apply_catalog_edit(db.pool(), correction(&db, item, "tablet"))
            .await
            .is_ok()
    );
    let captured: Option<String> =
        sqlx::query_scalar("SELECT received_unit FROM stock_batches WHERE id=$1")
            .bind(saved.id)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(captured.as_deref(), Some("tablet"));
}
#[tokio::test]
async fn receipt_waiting_for_catalog_correction_rejects_previously_reviewed_unit() {
    let db = TestDb::hospital().await.unwrap();
    let (item, location) = blank_stock(&db).await;
    let mut held = db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(810016)")
        .execute(&mut *held)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION hold_catalog_for_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='inventory.catalog.edited' THEN PERFORM pg_advisory_xact_lock(810016); END IF; RETURN NEW; END $$; CREATE TRIGGER hold_catalog_for_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION hold_catalog_for_test()") .execute(db.pool()).await.unwrap();
    let pool = db.pool().clone();
    let edit = correction(&db, item, "pack");
    let edit =
        tokio::spawn(async move { hms_db::inventory::apply_catalog_edit(&pool, edit).await });
    wait_blocked(db.pool(), pid).await;
    let input = receipt(&db, item, location);
    let pool = db.pool().clone();
    let issue = tokio::spawn(async move { hms_db::inventory::create_batch(&pool, input).await });
    held.commit().await.unwrap();
    edit.await.unwrap().unwrap();
    basis(
        issue.await.unwrap(),
        clinical::stock_basis::StockBasisError::ReceiptUnitChanged,
    );
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM stock_batches WHERE item_id=$1")
        .bind(item)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(rows, 0);
}
#[tokio::test]
async fn catalog_waiting_for_actual_receipt_cannot_change_the_receipted_unit() {
    let db = TestDb::hospital().await.unwrap();
    let (item, location) = blank_stock(&db).await;
    let mut held = db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(810017)")
        .execute(&mut *held)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION hold_receipt_for_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='stock_receipt' THEN PERFORM pg_advisory_xact_lock(810017); END IF; RETURN NEW; END $$; CREATE TRIGGER hold_receipt_for_test BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION hold_receipt_for_test()").execute(db.pool()).await.unwrap();
    let pool = db.pool().clone();
    let input = receipt(&db, item, location);
    let issue = tokio::spawn(async move { hms_db::inventory::create_batch(&pool, input).await });
    wait_blocked(db.pool(), pid).await;
    let pool = db.pool().clone();
    let input = correction(&db, item, "pack");
    let edit =
        tokio::spawn(async move { hms_db::inventory::apply_catalog_edit(&pool, input).await });
    held.commit().await.unwrap();
    issue.await.unwrap().unwrap();
    basis(
        edit.await.unwrap(),
        clinical::stock_basis::StockBasisError::InventoryUnitInUse,
    );
}
#[tokio::test]
async fn generation_supply_and_given_waits_recheck_admission_closure_without_new_effects() {
    for action in 0..3 {
        let f = Fixture::new(true).await;
        let fulfillment = if action > 0 {
            Some(
                pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation())
                    .await
                    .unwrap()
                    .pharmacy_fulfillment_id
                    .unwrap(),
            )
        } else {
            None
        };
        if action == 2 {
            pharmacy::dispense_fulfillment(f.db.pool(), f.supply(fulfillment.unwrap(), 1))
                .await
                .unwrap();
        }
        let before = f.total().await;
        let mut held = f.db.pool().begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await
            .unwrap();
        sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
            .bind(f.admission)
            .execute(&mut *held)
            .await
            .unwrap();
        let pool = f.db.pool().clone();
        let generation = f.generation();
        let supply = fulfillment.map(|id| f.supply(id, 1));
        let outcome = if action == 2 {
            Some(f.outcome(f.doses().await[0], Outcome::Administered))
        } else {
            None
        };
        let pending = tokio::spawn(async move {
            match action {
                0 => pharmacy::generate_mar_for_prescription(&pool, generation)
                    .await
                    .map(|_| ()),
                1 => pharmacy::dispense_fulfillment(&pool, supply.unwrap())
                    .await
                    .map(|_| ()),
                _ => hms_db::ward::record_medication_outcome(&pool, outcome.unwrap())
                    .await
                    .map(|_| ()),
            }
        });
        wait_blocked(f.db.pool(), pid).await;
        held.commit().await.unwrap();
        basis(
            pending.await.unwrap(),
            clinical::stock_basis::StockBasisError::AdmissionInactive,
        );
        assert_eq!(f.total().await, before);
        let given:i64=sqlx::query_scalar("SELECT count(*) FROM medication_administrations WHERE prescription_id=$1 AND status='administered'").bind(f.source).fetch_one(f.db.pool()).await.unwrap();
        assert_eq!(given, 0);
    }
}
#[tokio::test]
async fn controlled_units_are_immutable_even_without_history_and_labels_remain_correctable() {
    for only_type in [false, true] {
        let db = TestDb::hospital().await.unwrap();
        let (item, _) = blank_stock(&db).await;
        sqlx::query("UPDATE inventory_items SET controlled=$2,item_type=$3 WHERE id=$1")
            .bind(item)
            .bind(!only_type)
            .bind(if only_type {
                "controlled_substance"
            } else {
                "medication"
            })
            .execute(db.pool())
            .await
            .unwrap();
        let choices = clinical::list_medication_catalog(
            db.pool(),
            db.facility_id(),
            None,
            1,
            Some("SYNTHETIC-NEW"),
        )
        .await
        .unwrap();
        assert_eq!(choices.len(), 1);
        assert_eq!(choices[0].id, item);
        assert!(choices[0].controlled);
        basis(
            hms_db::inventory::apply_catalog_edit(db.pool(), correction(&db, item, "pack")).await,
            clinical::stock_basis::StockBasisError::ControlledUnitImmutable,
        );
        let saved =
            hms_db::inventory::apply_catalog_edit(db.pool(), correction(&db, item, "tablet"))
                .await
                .unwrap();
        assert_eq!(saved.unit, "tablet");
        assert_eq!(saved.name, "Synthetic reviewed stock");
    }
}
#[tokio::test]
async fn legacy_null_discharge_context_is_derived_from_locked_active_admission_and_revalidated() {
    let f = Fixture::new(true).await;
    let encounter = Uuid::new_v4();
    let discharge = Uuid::new_v4();
    sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status,created_by_user_id) VALUES($1,$2,$3,'inpatient','completed',$4)").bind(encounter).bind(f.db.facility_id()).bind(f.patient).bind(f.db.owner_user_id()).execute(f.db.pool()).await.unwrap();
    sqlx::query("UPDATE admission_cases SET encounter_id=$2 WHERE id=$1")
        .bind(f.admission)
        .bind(encounter)
        .execute(f.db.pool())
        .await
        .unwrap();
    sqlx::query("INSERT INTO discharge_cases(id,facility_id,admission_case_id,patient_id,status,created_by_user_id) VALUES($1,$2,$3,$4,'requested',$5)").bind(discharge).bind(f.db.facility_id()).bind(f.admission).bind(f.patient).bind(f.db.owner_user_id()).execute(f.db.pool()).await.unwrap();
    let input = || NewPrescription {
        id: Uuid::new_v4(),
        facility_id: f.db.facility_id(),
        patient_id: f.patient,
        encounter_id: None,
        visit_id: None,
        discharge_case_id: Some(discharge),
        medication_name: "Synthetic discharge review".into(),
        dose: "Explicit dose".into(),
        route: "oral".into(),
        frequency: "daily".into(),
        inventory_item_id: None,
        start_date: None,
        duration_days: None,
        first_dose_at: None,
        actor_user_id: f.db.owner_user_id(),
    };
    assert_eq!(
        create_with_stock_policy(
            f.db.pool(),
            input(),
            None,
            None,
            PrescriptionDocumentation::default(),
            None,
            None
        )
        .await
        .unwrap_err()
        .downcast_ref::<PrescriptionCourseError>(),
        Some(&PrescriptionCourseError::InvalidContext)
    );
    sqlx::query("UPDATE encounters SET status='in_progress' WHERE id=$1")
        .bind(encounter)
        .execute(f.db.pool())
        .await
        .unwrap();
    let saved = create_with_stock_policy(
        f.db.pool(),
        input(),
        None,
        None,
        PrescriptionDocumentation::default(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(saved.prescription.encounter_id, Some(encounter));
    f.close().await;
    basis(
        create_with_stock_policy(
            f.db.pool(),
            input(),
            None,
            None,
            PrescriptionDocumentation::default(),
            None,
            None,
        )
        .await,
        clinical::stock_basis::StockBasisError::AdmissionInactive,
    );
}
#[tokio::test]
async fn manual_dispense_rejects_controlled_type_even_when_legacy_flag_is_false_without_moving_stock(
) {
    let f = Fixture::new(true).await;
    sqlx::query(
        "UPDATE inventory_items SET controlled=false,item_type='controlled_substance' WHERE id=$1",
    )
    .bind(f.item)
    .execute(f.db.pool())
    .await
    .unwrap();
    let error = hms_db::inventory::create_dispense(
        f.db.pool(),
        hms_db::inventory::NewPharmacyDispense {
            authorization: None,
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            patient_id: f.patient,
            item_id: f.item,
            location_id: f.location,
            quantity: 1,
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(
        error.to_string(),
        "controlled items require controlled-substance register workflow"
    );
    assert_eq!(f.total().await, 100);
    let rows:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM pharmacy_dispenses WHERE item_id=$1),(SELECT count(*) FROM stock_movements WHERE item_id=$1)").bind(f.item).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(rows, (0, 0));
}
#[tokio::test]
async fn supplied_stock_evidence_is_a_real_pair_while_legacy_null_pair_is_preserved() {
    let f = Fixture::new(true).await;
    pharmacy::generate_mar_for_prescription(f.db.pool(), f.generation())
        .await
        .unwrap();
    let dose = f.doses().await[0];
    assert!(sqlx::query("UPDATE medication_administrations SET is_dispensed=true,dispensed_stock_quantity=1,dispensed_stock_unit=NULL WHERE id=$1").bind(dose).execute(f.db.pool()).await.is_err());
    assert!(sqlx::query("UPDATE medication_administrations SET is_dispensed=true,dispensed_stock_quantity=NULL,dispensed_stock_unit=$2 WHERE id=$1").bind(dose).bind(&f.unit).execute(f.db.pool()).await.is_err());
    sqlx::query("UPDATE medication_administrations SET is_dispensed=true,dispensed_stock_quantity=NULL,dispensed_stock_unit=NULL WHERE id=$1").bind(dose).execute(f.db.pool()).await.unwrap();
    basis(
        hms_db::ward::record_medication_outcome(
            f.db.pool(),
            f.outcome(dose, Outcome::Administered),
        )
        .await,
        clinical::stock_basis::StockBasisError::ReviewRequired,
    );
    assert_eq!(f.total().await, 100);
}
