use chrono::{Duration, Utc};
use hms_db::{
    clinical::NewPrescription,
    pharmacy::DispenseFulfillmentCommand,
    test_support::TestDb,
    ward::{RecordMedicationOutcome, RequestPrnDose},
};
use hms_domain::{
    clinical::{PrescriptionStatus, PrnPolicyRequest, UpdatePrescriptionRequest},
    ward::MedicationAdministrationOutcome as Outcome,
};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    source: Uuid,
    patient: Uuid,
    admission: Uuid,
    item: Uuid,
    location: Uuid,
}
impl Fixture {
    async fn new(mut policy: Option<PrnPolicyRequest>) -> Self {
        let db = TestDb::hospital().await.unwrap();
        let care = db
            .scenario("prn-safe")
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
        let item=sqlx::query_scalar("SELECT id FROM inventory_items WHERE facility_id=$1 AND NOT controlled AND item_type='medication' LIMIT 1").bind(db.facility_id()).fetch_one(db.pool()).await.unwrap();
        let location =
            sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 LIMIT 1")
                .bind(db.facility_id())
                .fetch_one(db.pool())
                .await
                .unwrap();
        sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand) VALUES($1,$2,$3,$4,'SYNTHETIC-PRN',100)").bind(Uuid::new_v4()).bind(db.facility_id()).bind(item).bind(location).execute(db.pool()).await.unwrap();
        let selected_unit: String =
            sqlx::query_scalar("SELECT unit FROM inventory_items WHERE id=$1")
                .bind(item)
                .fetch_one(db.pool())
                .await
                .unwrap();
        if let Some(policy) = policy.as_mut() {
            if policy.expected_stock_unit == "TEST_ONLY_LOOKUP" {
                policy.expected_stock_unit = selected_unit;
            }
        }
        let source = Uuid::new_v4();
        hms_db::clinical::create_prescription_with_prn_policy(
            db.pool(),
            NewPrescription {
                id: source,
                facility_id: db.facility_id(),
                patient_id: care.patient.id,
                encounter_id: None,
                visit_id: None,
                discharge_case_id: None,
                medication_name: "Synthetic as-needed order".into(),
                dose: "2 tablets".into(),
                route: "oral".into(),
                frequency: "prn".into(),
                inventory_item_id: Some(item),
                start_date: Some((Utc::now() - Duration::days(1)).date_naive()),
                duration_days: Some(30),
                first_dose_at: None,
                actor_user_id: db.owner_user_id(),
            },
            policy,
        )
        .await
        .unwrap();
        Self {
            db,
            source,
            patient: care.patient.id,
            admission: care.admission.id,
            item,
            location,
        }
    }
    fn request(&self, key: Uuid) -> RequestPrnDose {
        RequestPrnDose {
            facility_id: self.db.facility_id(),
            prescription_id: self.source,
            admission_case_id: self.admission,
            client_request_id: key,
            indication: "Synthetic indication for this dose".into(),
            actor_user_id: self.db.owner_user_id(),
            request_id: None,
        }
    }
    async fn supply(
        &self,
        fulfillment: Uuid,
        quantity: i64,
    ) -> anyhow::Result<hms_domain::pharmacy::PharmacyFulfillmentDispenseResult> {
        hms_db::pharmacy::dispense_fulfillment(
            self.db.pool(),
            DispenseFulfillmentCommand {
                facility_id: self.db.facility_id(),
                fulfillment_id: fulfillment,
                item_id: self.item,
                location_id: self.location,
                quantity,
                actor_user_id: self.db.owner_user_id(),
            },
        )
        .await
    }
    async fn outcome(
        &self,
        id: Uuid,
        status: Outcome,
    ) -> anyhow::Result<Option<hms_domain::ward::MedicationAdministrationListItem>> {
        hms_db::ward::record_medication_outcome(
            self.db.pool(),
            RecordMedicationOutcome {
                facility_id: self.db.facility_id(),
                medication_id: id,
                actor_user_id: self.db.owner_user_id(),
                status,
                witness_user_id: None,
                reason_not_given: if status == Outcome::Administered {
                    None
                } else {
                    Some("Synthetic reason".into())
                },
                administration_notes: None,
                request_id: None,
            },
        )
        .await
    }
    async fn status(&self, status: PrescriptionStatus) {
        let update: UpdatePrescriptionRequest =
            serde_json::from_value(serde_json::json!({"status":status})).unwrap();
        hms_db::clinical::update_prescription(
            self.db.pool(),
            self.db.facility_id(),
            self.source,
            update,
        )
        .await
        .unwrap();
    }
    async fn stock(&self) -> i64 {
        sqlx::query_scalar("SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE facility_id=$1 AND item_id=$2").bind(self.db.facility_id()).bind(self.item).fetch_one(self.db.pool()).await.unwrap()
    }
}
fn policy() -> PrnPolicyRequest {
    PrnPolicyRequest {
        expected_stock_unit: "TEST_ONLY_LOOKUP".to_owned(),
        minimum_interval_hours: 4,
        maximum_doses_per_24_hours: 2,
        indication: "Synthetic prescribed indication".into(),
        stock_units_per_dose: 2,
    }
}

#[tokio::test]
async fn prn_request_supply_outcome_replay_preserves_real_stock_and_history() {
    let f = Fixture::new(Some(policy())).await;
    let command = f.request(Uuid::new_v4());
    let r = hms_db::ward::request_prn_dose(f.db.pool(), command.clone())
        .await
        .unwrap();
    assert!(r.created);
    let row = hms_db::ward::get_medication_administration(
        f.db.pool(),
        f.db.facility_id(),
        r.medication_administration_id,
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!row.is_dispensed);
    assert_eq!(row.prn_request_id, Some(command.client_request_id));
    assert_eq!(
        row.prn_indication.as_deref(),
        Some(command.indication.as_str())
    );
    assert!(f.outcome(row.id, Outcome::Administered).await.is_err());
    assert_eq!(f.stock().await, 100);
    let supplied = f.supply(r.pharmacy_fulfillment_id, 1).await.unwrap();
    assert_eq!(supplied.dispensed_dose_count, 1);
    assert_eq!(
        supplied
            .fulfillment
            .prn_policy
            .unwrap()
            .stock_units_per_dose,
        2
    );
    assert_eq!(f.stock().await, 98);
    let administered = f
        .outcome(row.id, Outcome::Administered)
        .await
        .unwrap()
        .unwrap();
    assert!(administered.administered_at.is_some());
    f.status(PrescriptionStatus::Stopped).await;
    let replay = hms_db::ward::request_prn_dose(f.db.pool(), command.clone())
        .await
        .unwrap();
    assert!(!replay.created);
    assert_eq!(replay.medication_administration_id, row.id);
    let second = f
        .outcome(row.id, Outcome::Administered)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second.administered_at, administered.administered_at);
    assert_eq!(f.stock().await, 98);
    let mut changed = command;
    changed.indication = "Different synthetic indication".into();
    assert!(hms_db::ward::request_prn_dose(f.db.pool(), changed)
        .await
        .is_err());
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_events WHERE event_type='medication.prn_requested'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(audits, 1);
}

#[tokio::test]
async fn concurrent_prn_requests_reserve_exactly_one_pending_dose() {
    let f = Fixture::new(Some(policy())).await;
    let mut handles = Vec::new();
    for _ in 0..12 {
        let pool = f.db.pool().clone();
        let c = f.request(Uuid::new_v4());
        handles.push(tokio::spawn(async move {
            hms_db::ward::request_prn_dose(&pool, c).await
        }));
    }
    let mut saved = 0;
    for h in handles {
        if h.await.unwrap().is_ok() {
            saved += 1;
        }
    }
    assert_eq!(saved, 1);
    let (doses,requested):(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM medication_administrations WHERE prescription_id=$1),(SELECT sum(requested_dose_count)::bigint FROM pharmacy_fulfillments WHERE prescription_id=$1)").bind(f.source).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!((doses, requested), (1, 1));
}

#[tokio::test]
async fn actual_interval_and_rolling_24_hour_cap_are_enforced_without_defaults() {
    let f = Fixture::new(Some(policy())).await;
    let first = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    f.supply(first.pharmacy_fulfillment_id, 1).await.unwrap();
    f.outcome(first.medication_administration_id, Outcome::Administered)
        .await
        .unwrap();
    let interval = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap_err();
    assert_eq!(
        interval.downcast_ref::<hms_db::ward::PrnError>(),
        Some(&hms_db::ward::PrnError::Interval)
    );
    sqlx::query("UPDATE medication_administrations SET administered_at=clock_timestamp()-interval '5 hours' WHERE id=$1").bind(first.medication_administration_id).execute(f.db.pool()).await.unwrap();
    let second = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    f.supply(second.pharmacy_fulfillment_id, 1).await.unwrap();
    f.outcome(second.medication_administration_id, Outcome::Administered)
        .await
        .unwrap();
    sqlx::query("UPDATE medication_administrations SET administered_at=clock_timestamp()-interval '5 hours' WHERE id=$1").bind(second.medication_administration_id).execute(f.db.pool()).await.unwrap();
    let cap = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap_err();
    assert_eq!(
        cap.downcast_ref::<hms_db::ward::PrnError>(),
        Some(&hms_db::ward::PrnError::DailyLimit)
    );
    sqlx::query("UPDATE medication_administrations SET administered_at=clock_timestamp()-interval '25 hours' WHERE id=$1").bind(first.medication_administration_id).execute(f.db.pool()).await.unwrap();
    let third = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    // Another actual history entry becoming recent must be checked at administration,
    // even though this pending request was eligible when it was created.
    sqlx::query("UPDATE medication_administrations SET administered_at=clock_timestamp()-interval '6 hours' WHERE id=$1").bind(first.medication_administration_id).execute(f.db.pool()).await.unwrap();
    f.supply(third.pharmacy_fulfillment_id, 1).await.unwrap();
    let denied = f
        .outcome(third.medication_administration_id, Outcome::Administered)
        .await
        .unwrap_err();
    assert_eq!(
        denied.downcast_ref::<hms_db::ward::PrnError>(),
        Some(&hms_db::ward::PrnError::DailyLimit)
    );
    assert_eq!(f.stock().await, 94);
}

#[tokio::test]
async fn refused_or_held_prn_dose_preserves_supply_and_allows_next_indicated_request() {
    let f = Fixture::new(Some(policy())).await;
    let a = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    f.outcome(a.medication_administration_id, Outcome::Refused)
        .await
        .unwrap();
    assert_eq!(f.stock().await, 100);
    let b = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    assert_eq!(a.pharmacy_fulfillment_id, b.pharmacy_fulfillment_id);
    f.supply(b.pharmacy_fulfillment_id, 1).await.unwrap();
    f.outcome(b.medication_administration_id, Outcome::Held)
        .await
        .unwrap();
    let before: (i32,Option<chrono::DateTime<Utc>>,Option<Uuid>)=sqlx::query_as("SELECT dispensed_dose_count,dispensed_at,dispensed_by_user_id FROM pharmacy_fulfillments WHERE id=$1").bind(b.pharmacy_fulfillment_id).fetch_one(f.db.pool()).await.unwrap();
    let c = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    let after:(i32,Option<chrono::DateTime<Utc>>,Option<Uuid>)=sqlx::query_as("SELECT dispensed_dose_count,dispensed_at,dispensed_by_user_id FROM pharmacy_fulfillments WHERE id=$1").bind(c.pharmacy_fulfillment_id).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(before, after);
    assert_eq!(f.stock().await, 98);
    assert!(f
        .outcome(b.medication_administration_id, Outcome::Administered)
        .await
        .is_err());
}

#[tokio::test]
async fn legacy_missing_policy_source_changes_and_unit_changes_fail_closed() {
    let f = Fixture::new(None).await;
    let err = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap_err();
    assert_eq!(
        err.downcast_ref::<hms_db::ward::PrnError>(),
        Some(&hms_db::ward::PrnError::Unconfigured)
    );
    let f = Fixture::new(Some(policy())).await;
    f.status(PrescriptionStatus::OnHold).await;
    assert!(
        hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
            .await
            .is_err()
    );
    f.status(PrescriptionStatus::Active).await;
    let dose = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    sqlx::query("UPDATE inventory_items SET unit='different synthetic unit' WHERE id=$1")
        .bind(f.item)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert!(f.supply(dose.pharmacy_fulfillment_id, 1).await.is_err());
    assert_eq!(f.stock().await, 100);
    sqlx::query("UPDATE medication_administrations SET is_dispensed=true WHERE id=$1")
        .bind(dose.medication_administration_id)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert!(f
        .outcome(dose.medication_administration_id, Outcome::Administered)
        .await
        .is_err());
}

#[tokio::test]
async fn prn_request_audit_failure_rolls_back_course_fulfillment_and_dose() {
    let f = Fixture::new(Some(policy())).await;
    sqlx::query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_prn_audit_failure CHECK(event_type<>'medication.prn_requested')").execute(f.db.pool()).await.unwrap();
    assert!(
        hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
            .await
            .is_err()
    );
    for table in [
        "medication_courses",
        "pharmacy_fulfillments",
        "medication_administrations",
    ] {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE prescription_id=$1"
        ))
        .bind(f.source)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
        assert_eq!(count, 0);
    }
}

#[tokio::test]
async fn prn_orders_filter_patient_and_frequency_before_cursor_limit() {
    let f = Fixture::new(Some(policy())).await;
    sqlx::query("INSERT INTO prescriptions(id,facility_id,patient_id,medication_name,dose,route,frequency,status,prescribed_at) SELECT gen_random_uuid(),$1,$2,'Synthetic unrelated scheduled order','1','oral','daily','active',clock_timestamp()+n*interval '1 second' FROM generate_series(1,150) n").bind(f.db.facility_id()).bind(f.patient).execute(f.db.pool()).await.unwrap();
    let rows = hms_db::ward::list_prn_orders(f.db.pool(), f.db.facility_id(), f.patient, None, 1)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].prescription_id, f.source);
    assert!(rows[0].prn_policy.is_some());
    assert_eq!(rows[0].unavailable_reason, None);
    let empty =
        hms_db::ward::list_prn_orders(f.db.pool(), f.db.facility_id(), Uuid::new_v4(), None, 100)
            .await
            .unwrap();
    assert!(empty.is_empty());
    let next = hms_db::ward::list_prn_orders(
        f.db.pool(),
        f.db.facility_id(),
        f.patient,
        Some(hms_db::ward::WardCursor {
            occurred_at: rows[0].prescribed_at,
            id: f.source,
        }),
        1,
    )
    .await
    .unwrap();
    assert!(next.is_empty());
}

#[test]
fn explicit_policy_rejects_missing_typos_overlarge_caps_and_arbitrary_intervals() {
    assert!(serde_json::from_value::<PrnPolicyRequest>(serde_json::json!({"minimum_interval_hours":4,"maximum_doses_per_24_hours":2,"indication":"Synthetic","stock_units_per_dose":1,"typo":true})).is_err());
    for interval in [0, 1, 3, 5, 48] {
        let mut p = policy();
        p.minimum_interval_hours = interval;
        assert!(p.normalized().is_err());
    }
    for cap in [0, 7, 255] {
        let mut p = policy();
        p.maximum_doses_per_24_hours = cap;
        assert!(p.normalized().is_err());
    }
    for units in [0, -1] {
        let mut p = policy();
        p.stock_units_per_dose = units;
        assert!(p.normalized().is_err());
    }
    let mut p = policy();
    p.indication = "  ".into();
    assert!(p.normalized().is_err());
}

#[tokio::test]
async fn configured_prn_generator_retry_and_course_snapshot_are_safe() {
    let f = Fixture::new(Some(policy())).await;
    let generated = hms_db::pharmacy::generate_mar_for_prescription(
        f.db.pool(),
        hms_db::pharmacy::GenerateMarCommand {
            facility_id: f.db.facility_id(),
            prescription_id: f.source,
            admission_case_id: f.admission,
            days: 7,
            first_dose_at: None,
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await
    .unwrap();
    assert_eq!(generated.created_count, 0);
    assert_eq!(generated.skipped_reason.as_deref(), Some("prn"));
    let request = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    let course: Uuid = sqlx::query_scalar(
        "SELECT medication_course_id FROM medication_administrations WHERE id=$1",
    )
    .bind(request.medication_administration_id)
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(course, generated.medication_course_id);
    sqlx::query("UPDATE medication_courses SET prescription_prn_policy=NULL WHERE id=$1")
        .bind(course)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert!(f.supply(request.pharmacy_fulfillment_id, 1).await.is_err());
    sqlx::query("UPDATE medication_administrations SET is_dispensed=true WHERE id=$1")
        .bind(request.medication_administration_id)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert!(f
        .outcome(request.medication_administration_id, Outcome::Administered)
        .await
        .is_err());
    assert_eq!(f.stock().await, 100);
}

#[tokio::test]
async fn prn_same_key_concurrency_replays_one_record_and_overflow_never_changes_stock() {
    let mut p = policy();
    p.stock_units_per_dose = 9_007_199_254_740_991;
    let f = Fixture::new(Some(p)).await;
    let command = f.request(Uuid::new_v4());
    let mut handles = Vec::new();
    for _ in 0..8 {
        let pool = f.db.pool().clone();
        let c = command.clone();
        handles.push(tokio::spawn(async move {
            hms_db::ward::request_prn_dose(&pool, c).await.unwrap()
        }));
    }
    let mut created = 0;
    let mut id = None;
    let mut fulfillment = None;
    for h in handles {
        let r = h.await.unwrap();
        if r.created {
            created += 1;
        }
        if let Some(id) = id {
            assert_eq!(id, r.medication_administration_id);
        }
        id = Some(r.medication_administration_id);
        fulfillment = Some(r.pharmacy_fulfillment_id);
    }
    assert_eq!(created, 1);
    let error = f.supply(fulfillment.unwrap(), i64::MAX).await.unwrap_err();
    assert_eq!(error.to_string(), "prn_stock_quantity_overflow");
    assert_eq!(f.stock().await, 100);
}

#[tokio::test]
async fn prn_anonymous_requests_future_or_elapsed_orders_and_foreign_admissions_cannot_write() {
    let f = Fixture::new(Some(policy())).await;
    let invalid = hms_db::ward::schedule_medication_administration(
        f.db.pool(),
        hms_db::ward::NewMedicationAdministration {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            admission_case_id: f.admission,
            patient_id: f.patient,
            medication_name: "Synthetic anonymous PRN".into(),
            dose: Some("1 tablet".into()),
            route: Some("oral".into()),
            frequency: Some("prn".into()),
            scheduled_at: Utc::now(),
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await;
    assert!(invalid.is_err());
    let mut wrong = f.request(Uuid::new_v4());
    wrong.admission_case_id = Uuid::new_v4();
    assert!(hms_db::ward::request_prn_dose(f.db.pool(), wrong)
        .await
        .is_err());
    sqlx::query(
        "UPDATE prescriptions SET first_dose_at=clock_timestamp()+interval '1 day' WHERE id=$1",
    )
    .bind(f.source)
    .execute(f.db.pool())
    .await
    .unwrap();
    assert!(
        hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
            .await
            .is_err()
    );
    sqlx::query(
        "UPDATE prescriptions SET first_dose_at=clock_timestamp()-interval '31 days' WHERE id=$1",
    )
    .bind(f.source)
    .execute(f.db.pool())
    .await
    .unwrap();
    assert!(
        hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
            .await
            .is_err()
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM medication_courses WHERE prescription_id=$1")
            .bind(f.source)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn prn_supply_skips_expired_batches_and_denies_inactive_locations() {
    let f = Fixture::new(Some(policy())).await;
    sqlx::query("UPDATE stock_batches SET expires_on=(clock_timestamp() AT TIME ZONE 'UTC')::date-1 WHERE facility_id=$1 AND item_id=$2").bind(f.db.facility_id()).bind(f.item).execute(f.db.pool()).await.unwrap();
    let request = hms_db::ward::request_prn_dose(f.db.pool(), f.request(Uuid::new_v4()))
        .await
        .unwrap();
    assert!(f.supply(request.pharmacy_fulfillment_id, 1).await.is_err());
    assert_eq!(f.stock().await, 100);
    sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand,expires_on) VALUES($1,$2,$3,$4,'SYNTHETIC-UNEXPIRED',10,(clock_timestamp() AT TIME ZONE 'UTC')::date)").bind(Uuid::new_v4()).bind(f.db.facility_id()).bind(f.item).bind(f.location).execute(f.db.pool()).await.unwrap();
    sqlx::query("UPDATE storage_locations SET is_active=false WHERE id=$1")
        .bind(f.location)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert!(f.supply(request.pharmacy_fulfillment_id, 1).await.is_err());
    assert_eq!(f.stock().await, 110);
    sqlx::query("UPDATE storage_locations SET is_active=true WHERE id=$1")
        .bind(f.location)
        .execute(f.db.pool())
        .await
        .unwrap();
    f.supply(request.pharmacy_fulfillment_id, 1).await.unwrap();
    assert_eq!(f.stock().await, 108);
    let old:i64=sqlx::query_scalar("SELECT quantity_on_hand FROM stock_batches WHERE item_id=$1 AND batch_number='SYNTHETIC-PRN'").bind(f.item).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(old, 100);
}

#[tokio::test]
async fn waiting_prn_request_observes_admission_closure_and_source_stop() {
    let f = Fixture::new(Some(policy())).await;
    let mut tx = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT id FROM admission_cases WHERE id=$1 FOR UPDATE")
        .bind(f.admission)
        .execute(&mut *tx)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let c = f.request(Uuid::new_v4());
    let mut pending = tokio::spawn(async move { hms_db::ward::request_prn_dose(&pool, c).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut pending)
            .await
            .is_err()
    );
    sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
        .bind(f.admission)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(pending.await.unwrap().is_err());
    sqlx::query("UPDATE admission_cases SET status='admitted' WHERE id=$1")
        .bind(f.admission)
        .execute(f.db.pool())
        .await
        .unwrap();
    let mut tx = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
        .bind(f.source)
        .execute(&mut *tx)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let c = f.request(Uuid::new_v4());
    let mut pending = tokio::spawn(async move { hms_db::ward::request_prn_dose(&pool, c).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut pending)
            .await
            .is_err()
    );
    sqlx::query("UPDATE prescriptions SET status='stopped' WHERE id=$1")
        .bind(f.source)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(pending.await.unwrap().is_err());
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM medication_administrations WHERE prescription_id=$1",
    )
    .bind(f.source)
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn prn_prescribing_denies_a_unit_change_after_catalog_selection_without_saving() {
    let f = Fixture::new(Some(policy())).await;
    let source = hms_db::clinical::get_prescription(f.db.pool(), f.db.facility_id(), f.source)
        .await
        .unwrap()
        .unwrap();
    let saved = source.prn_policy.unwrap();
    sqlx::query("UPDATE inventory_items SET unit='different synthetic unit' WHERE id=$1")
        .bind(f.item)
        .execute(f.db.pool())
        .await
        .unwrap();
    let id = Uuid::new_v4();
    let error = hms_db::clinical::create_prescription_with_prn_policy(
        f.db.pool(),
        NewPrescription {
            id,
            facility_id: f.db.facility_id(),
            patient_id: f.patient,
            encounter_id: None,
            visit_id: None,
            discharge_case_id: None,
            medication_name: "Synthetic new PRN".into(),
            dose: "2 tablets".into(),
            route: "oral".into(),
            frequency: "prn".into(),
            inventory_item_id: Some(f.item),
            start_date: None,
            duration_days: None,
            first_dose_at: None,
            actor_user_id: f.db.owner_user_id(),
        },
        Some(saved.as_request()),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "prn_stock_unit_changed");
    assert!(
        hms_db::clinical::get_prescription(f.db.pool(), f.db.facility_id(), id)
            .await
            .unwrap()
            .is_none()
    );
}
