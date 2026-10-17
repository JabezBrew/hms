use chrono::{DateTime, Duration, Utc};
use hms_db::{
    clinical::{
        medication_access::MedicationActor,
        prescription_courses::{
            self, PrescriptionActor, PrescriptionAuthorization, PrescriptionDocumentation,
        },
        NewPrescription,
    },
    pharmacy::{DispenseFulfillmentCommand, GenerateMarCommand},
    test_support::TestDb,
    ward::treatment_courses as repo,
};
use hms_domain::{
    clinical::ScheduledStockPolicyRequest, deployment::DeploymentProfile, treatment_courses::*,
};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    patient: Uuid,
    admission: Uuid,
    source: Uuid,
    course: Uuid,
    initial: Uuid,
    item: Uuid,
    location: Uuid,
    first: DateTime<Utc>,
    actor: MedicationActor,
}
impl Fixture {
    async fn new() -> Self {
        Self::with_schedule("q6h", Some(10)).await
    }
    async fn with_schedule(frequency: &str, duration_days: Option<i32>) -> Self {
        let db = TestDb::hospital().await.unwrap();
        hms_db::network::update_policy(
            db.pool(),
            hms_db::network::NetworkPolicyActor {
                facility_id: db.facility_id(),
                user_id: None,
                request_id: None,
                reauth_deadline: None,
                auth_versions: None,
                session_id: None,
                active_profile: None,
                resolved_policy_version: None,
            },
            hms_domain::network::UpdateNetworkPolicyRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 0,
                onsite_cidrs: vec!["127.0.0.1/32".into(), "::1/128".into()],
                offsite_mode: hms_domain::network::NetworkOffsiteMode::Readonly,
                reason: "Explicit synthetic treatment transport fixture".into(),
            },
            None,
        )
        .await
        .unwrap();
        let care = db
            .scenario("synthetic-treatment-course")
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
        .unwrap()
        .unwrap();
        for permission in [
            "clinical_documentation.view",
            "clinical_documentation.manage",
            "ward_board.view_all",
        ] {
            sqlx::query("INSERT INTO user_permissions(user_id,permission_code) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(db.owner_user_id()).bind(permission).execute(db.pool()).await.unwrap();
        }
        sqlx::query("INSERT INTO user_patient_visibility(user_id,visibility) VALUES($1,'full_clinical') ON CONFLICT DO NOTHING").bind(db.owner_user_id()).execute(db.pool()).await.unwrap();
        for feature in ["patients", "encounters", "nursing"] {
            sqlx::query("INSERT INTO user_features(user_id,feature_key) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(db.owner_user_id()).bind(feature).execute(db.pool()).await.unwrap();
        }
        sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(db.facility_id()).bind(db.owner_user_id()).bind(care.patient.id).execute(db.pool()).await.unwrap();
        let (item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled AND item_type='medication' ORDER BY id LIMIT 1").bind(db.facility_id()).fetch_one(db.pool()).await.unwrap();
        let location:Uuid=sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1").bind(db.facility_id()).fetch_one(db.pool()).await.unwrap();
        let source = Uuid::new_v4();
        let first = DateTime::from_timestamp_micros(Utc::now().timestamp_micros()).unwrap()
            - Duration::hours(1);
        prescription_courses::create_with_stock_policy(
            db.pool(),
            NewPrescription {
                id: source,
                facility_id: db.facility_id(),
                patient_id: care.patient.id,
                encounter_id: None,
                visit_id: None,
                discharge_case_id: None,
                medication_name: "Synthetic reviewed treatment".into(),
                dose: "Explicit clinical dosage".into(),
                route: "oral".into(),
                frequency: frequency.into(),
                inventory_item_id: Some(item),
                start_date: Some(first.date_naive()),
                duration_days,
                first_dose_at: Some(first),
                actor_user_id: db.owner_user_id(),
            },
            None,
            Some(ScheduledStockPolicyRequest {
                expected_stock_unit: unit.clone(),
                stock_units_per_dose: 2,
            }),
            PrescriptionDocumentation {
                instructions: "Synthetic explicit instructions".into(),
                reason: "Synthetic explicit indication".into(),
            },
            None,
            None,
        )
        .await
        .unwrap();
        let actor = actor(&db).await;
        let generated = hms_db::pharmacy::generate_mar_for_prescription_authorized(
            db.pool(),
            GenerateMarCommand {
                authorization: actor.identity.authorization.clone(),
                facility_id: db.facility_id(),
                prescription_id: source,
                admission_case_id: care.admission.id,
                days: 1,
                first_dose_at: Some(first),
                actor_user_id: db.owner_user_id(),
            },
            actor.clone(),
        )
        .await
        .unwrap();
        hms_db::inventory::create_batch(
            db.pool(),
            hms_db::inventory::NewStockBatch {
                authorization: None,
                expected_unit: unit,
                id: Uuid::new_v4(),
                facility_id: db.facility_id(),
                item_id: item,
                location_id: location,
                batch_number: "SYN_TREATMENT".into(),
                expires_on: None,
                quantity_received: 100,
                actor_user_id: db.owner_user_id(),
            },
        )
        .await
        .unwrap();
        Self {
            db,
            patient: care.patient.id,
            admission: care.admission.id,
            source,
            course: generated.medication_course_id,
            initial: generated.pharmacy_fulfillment_id.unwrap(),
            item,
            location,
            first,
            actor,
        }
    }
    async fn detail(&self) -> TreatmentCourseDetail {
        repo::get_treatment_course(
            self.db.pool(),
            self.actor.clone(),
            self.patient,
            self.admission,
            self.course,
        )
        .await
        .unwrap()
    }
    async fn evidence(&self) -> serde_json::Value {
        sqlx::query_scalar("SELECT jsonb_build_object('stock',(SELECT sum(quantity_on_hand) FROM stock_batches),'movements',(SELECT count(*) FROM stock_movements),'dose_count',(SELECT count(*) FROM medication_administrations),'fulfillments',(SELECT count(*) FROM pharmacy_fulfillments),'requests',(SELECT count(*) FROM treatment_course_requests),'stops',(SELECT count(*) FROM medication_course_stops),'audit',(SELECT count(*) FROM audit_events))").fetch_one(self.db.pool()).await.unwrap()
    }
    fn window(&self, detail: &TreatmentCourseDetail) -> CreateTreatmentSupplyWindowRequest {
        CreateTreatmentSupplyWindowRequest {
            client_request_id: Uuid::new_v4(),
            expected_source_token: detail.source_token.clone(),
            expected_course_token: detail.course_token.clone(),
            expected_context_token: detail.context_token.clone(),
            expected_scheduled_through: detail.summary.scheduled_through.unwrap(),
            scheduled_before: detail.summary.scheduled_through.unwrap() + Duration::days(1),
            note: Some("  Synthetic explicitly reviewed window  ".into()),
        }
    }
    fn stop(&self, detail: &TreatmentCourseDetail) -> StopTreatmentCourseRequest {
        StopTreatmentCourseRequest {
            client_request_id: Uuid::new_v4(),
            expected_source_token: detail.source_token.clone(),
            expected_course_token: detail.course_token.clone(),
            expected_context_token: detail.context_token.clone(),
            reason: "  Synthetic admission-local decision  ".into(),
        }
    }
    async fn extend(
        &self,
        input: CreateTreatmentSupplyWindowRequest,
    ) -> anyhow::Result<TreatmentCourseReceipt> {
        repo::create_treatment_supply_window(
            self.db.pool(),
            self.actor.clone(),
            self.patient,
            self.admission,
            self.course,
            input,
        )
        .await
    }
    async fn stop_course(
        &self,
        input: StopTreatmentCourseRequest,
    ) -> anyhow::Result<TreatmentCourseReceipt> {
        repo::stop_treatment_course(
            self.db.pool(),
            self.actor.clone(),
            self.patient,
            self.admission,
            self.course,
            input,
        )
        .await
    }
    async fn doses(&self) -> Vec<TreatmentCourseDose> {
        repo::list_treatment_course_doses(
            self.db.pool(),
            self.actor.clone(),
            self.patient,
            self.admission,
            self.course,
            TreatmentCourseDoseQuery::default(),
            None,
            101,
        )
        .await
        .unwrap()
    }
    async fn supply(
        &self,
        quantity: i64,
    ) -> anyhow::Result<hms_domain::pharmacy::PharmacyFulfillmentDispenseResult> {
        hms_db::pharmacy::dispense_fulfillment_authorized(
            self.db.pool(),
            DispenseFulfillmentCommand {
                authorization: self.actor.identity.authorization.clone(),
                facility_id: self.db.facility_id(),
                fulfillment_id: self.initial,
                item_id: self.item,
                location_id: self.location,
                quantity,
                actor_user_id: self.db.owner_user_id(),
            },
            self.actor.clone(),
        )
        .await
    }
    async fn outcome(&self, dose: Uuid, status: hms_domain::ward::MedicationAdministrationOutcome) {
        self.outcome_result(dose, status).await.unwrap().unwrap();
    }
    async fn outcome_result(
        &self,
        dose: Uuid,
        status: hms_domain::ward::MedicationAdministrationOutcome,
    ) -> anyhow::Result<Option<hms_domain::ward::MedicationAdministrationListItem>> {
        hms_db::ward::record_medication_outcome_authorized(
            self.db.pool(),
            hms_db::ward::RecordMedicationOutcome {
                authorization: self.actor.identity.authorization.clone(),
                facility_id: self.db.facility_id(),
                medication_id: dose,
                actor_user_id: self.db.owner_user_id(),
                status,
                witness_user_id: None,
                reason_not_given: (status
                    != hms_domain::ward::MedicationAdministrationOutcome::Administered)
                    .then(|| "Synthetic explicit decision".into()),
                administration_notes: None,
                request_id: None,
            },
            self.actor.clone(),
        )
        .await
    }
}
async fn actor(db: &TestDb) -> MedicationActor {
    let (sv, pv): (i64, i64) =
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(db.owner_user_id())
            .fetch_one(db.pool())
            .await
            .unwrap();
    let id = Uuid::new_v4();
    let now = Utc::now();
    hms_db::auth::insert_refresh_session(
        db.pool(),
        &hms_db::auth::NewRefreshSession {
            token_hash: format!("synthetic-treatment-{}", id.simple()),
            session_id: id,
            session_family_id: id,
            rotated_from_session_id: None,
            user_id: db.owner_user_id(),
            facility_id: db.facility_id(),
            session_version: sv,
            permission_version_at_issue: pv,
            csrf_token_hash: "synthetic-treatment-csrf".into(),
            expires_at: now + Duration::hours(1),
            session_started_at: now,
            idle_expires_at: now + Duration::hours(1),
            absolute_expires_at: now + Duration::hours(1),
            device_label: None,
        },
    )
    .await
    .unwrap();
    MedicationActor {
        identity: PrescriptionActor {
            facility_id: db.facility_id(),
            user_id: db.owner_user_id(),
            request_id: None,
            authorization: Some(PrescriptionAuthorization {
                resolved_network_policy_version: Some(
                    hms_db::network::get_policy(db.pool(), db.facility_id())
                        .await
                        .unwrap()
                        .version,
                ),
                session_id: id,
                session_version: sv,
                permission_version: pv,
                active_profile: DeploymentProfile::Hospital,
                valid_until: now + Duration::minutes(30),
            }),
        },
        can_view_all_wards: true,
        resolved_network_policy_version: Some(
            hms_db::network::get_policy(db.pool(), db.facility_id())
                .await
                .unwrap()
                .version,
        ),
    }
}
fn typed(error: &anyhow::Error, wanted: repo::TreatmentCourseError) {
    assert_eq!(
        error.downcast_ref::<repo::TreatmentCourseError>(),
        Some(&wanted)
    );
}

#[tokio::test]
async fn additional_window_has_exact_membership_and_original_generation_replay_identity() {
    let f = Fixture::new().await;
    let first = f.detail().await;
    assert_eq!(first.counts.generated_scheduled_doses, 4);
    assert_eq!(first.counts.issued_stock_quantity, Some(0));
    let input = f.window(&first);
    let before = f.evidence().await;
    let result = f.extend(input.clone()).await.unwrap();
    let TreatmentCourseReceipt::SupplyWindowCreated {
        metadata,
        result: window,
        ..
    } = &result
    else {
        panic!("window receipt has its actual operation")
    };
    assert_eq!(window.created_dose_count, 4);
    assert_eq!(window.created_doses.len(), 4);
    assert_eq!(
        window.previous_scheduled_through,
        input.expected_scheduled_through
    );
    assert_eq!(window.scheduled_through, input.scheduled_before);
    assert!(window
        .created_doses
        .windows(2)
        .all(|w| w[0].scheduled_at < w[1].scheduled_at));
    assert!(window
        .created_doses
        .iter()
        .all(|d| d.scheduled_stock_policy.stock_units_per_dose == 2));
    let after = f.evidence().await;
    assert_eq!(after["stock"], before["stock"]);
    assert_eq!(after["movements"], before["movements"]);
    let repeated = f.extend(input.clone()).await.unwrap();
    let TreatmentCourseReceipt::SupplyWindowCreated {
        metadata: again,
        result: same,
        ..
    } = repeated
    else {
        panic!("same operation")
    };
    assert!(again.replayed);
    assert_eq!(same.fulfillment_id, window.fulfillment_id);
    assert_eq!(again.recorded_at, metadata.recorded_at);
    assert_eq!(f.evidence().await, after);
    let replay = hms_db::pharmacy::generate_mar_for_prescription_authorized(
        f.db.pool(),
        GenerateMarCommand {
            authorization: f.actor.identity.authorization.clone(),
            facility_id: f.db.facility_id(),
            prescription_id: f.source,
            admission_case_id: f.admission,
            days: 1,
            first_dose_at: Some(f.first),
            actor_user_id: f.db.owner_user_id(),
        },
        f.actor.clone(),
    )
    .await
    .unwrap();
    assert_eq!(replay.pharmacy_fulfillment_id, Some(f.initial));
    assert_eq!(replay.existing_count, 4);
    assert_eq!(replay.created_count, 0);
    assert_eq!(replay.requested_dose_count, 4);
    assert_eq!(f.detail().await.counts.generated_scheduled_doses, 8);
}

#[tokio::test]
async fn local_stop_preserves_source_supplied_history_and_original_window_membership() {
    let f = Fixture::new().await;
    let input = f.window(&f.detail().await);
    let key = input.client_request_id;
    let window = f.extend(input).await.unwrap();
    let TreatmentCourseReceipt::SupplyWindowCreated { result: window, .. } = window else {
        panic!("window")
    };
    hms_db::pharmacy::dispense_fulfillment_authorized(
        f.db.pool(),
        DispenseFulfillmentCommand {
            authorization: f.actor.identity.authorization.clone(),
            facility_id: f.db.facility_id(),
            fulfillment_id: f.initial,
            item_id: f.item,
            location_id: f.location,
            quantity: 2,
            actor_user_id: f.db.owner_user_id(),
        },
        f.actor.clone(),
    )
    .await
    .unwrap();
    let before = f.evidence().await;
    let detail = f.detail().await;
    assert_eq!(detail.counts.supplied_doses, 2);
    assert_eq!(detail.counts.issued_stock_quantity, Some(4));
    let input = f.stop(&detail);
    let key_stop = input.client_request_id;
    let receipt = f.stop_course(input.clone()).await.unwrap();
    let TreatmentCourseReceipt::Stopped { result: stop, .. } = &receipt else {
        panic!("stop")
    };
    assert_eq!(stop.retired_pending_dose_count, 8);
    assert_eq!(stop.cancelled_fulfillment_count, 2);
    let source: String = sqlx::query_scalar("SELECT status FROM prescriptions WHERE id=$1")
        .bind(f.source)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(source, "active");
    let current = f.detail().await;
    assert_eq!(current.summary.status, TreatmentCourseStatus::Stopped);
    assert_eq!(current.counts.supplied_doses, 2);
    assert_eq!(current.counts.issued_stock_quantity, Some(4));
    assert_eq!(current.counts.awaiting_supply_doses, 0);
    assert!(!current.can_request_schedule_window);
    assert_eq!(f.evidence().await["stock"], before["stock"]);
    assert_eq!(f.evidence().await["movements"], before["movements"]);
    let original = repo::get_treatment_course_request(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.admission,
        f.course,
        key,
    )
    .await
    .unwrap();
    let TreatmentCourseReceipt::SupplyWindowCreated { result: saved, .. } = original else {
        panic!("original window")
    };
    assert_eq!(saved.created_dose_count, 4);
    assert_eq!(saved.fulfillment_id, window.fulfillment_id);
    let members = repo::list_treatment_course_doses(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.admission,
        f.course,
        TreatmentCourseDoseQuery {
            request_id: Some(key_stop),
            ..Default::default()
        },
        None,
        101,
    )
    .await
    .unwrap();
    assert_eq!(members.len(), 8);
    assert!(members.iter().all(|d| d.local_stop_id == Some(stop.id)
        && matches!(
            d.original_request_membership
                .as_ref()
                .unwrap()
                .status_at_command,
            hms_domain::ward::MedicationAdministrationStatus::Scheduled
        )));
    let repeated = f.stop_course(input).await.unwrap();
    let TreatmentCourseReceipt::Stopped {
        metadata, result, ..
    } = repeated
    else {
        panic!("stop replay")
    };
    assert!(metadata.replayed);
    assert_eq!(result.recorded_at, stop.recorded_at);
}

#[tokio::test]
async fn either_controlled_classification_blocks_new_demand_but_keeps_local_retirement_available() {
    let f = Fixture::new().await;
    for (flag, kind) in [(true, "medication"), (false, "controlled_substance")] {
        sqlx::query("UPDATE inventory_items SET controlled=$2,item_type=$3 WHERE id=$1")
            .bind(f.item)
            .bind(flag)
            .bind(kind)
            .execute(f.db.pool())
            .await
            .unwrap();
        let detail = f.detail().await;
        assert!(detail.can_stop_course);
        assert!(!detail.can_request_schedule_window);
        assert_eq!(
            detail.window_unavailable_reason,
            Some(TreatmentUnavailableReason::StockItemNotActionable)
        );
        assert!(detail.supply_window_constraints.is_none());
        let before = f.evidence().await;
        let error = f.extend(f.window(&detail)).await.unwrap_err();
        assert_eq!(
            error.downcast_ref::<hms_db::clinical::stock_basis::StockBasisError>(),
            Some(&hms_db::clinical::stock_basis::StockBasisError::ControlledItem)
        );
        assert_eq!(f.evidence().await, before);
    }
    let before = f.evidence().await;
    f.stop_course(f.stop(&f.detail().await)).await.unwrap();
    assert_eq!(f.evidence().await["stock"], before["stock"]);
    assert_eq!(f.evidence().await["movements"], before["movements"]);
}

#[tokio::test]
async fn stale_terminal_source_can_be_retired_locally_without_rewriting_given_or_non_given_evidence(
) {
    use hms_domain::ward::{
        MedicationAdministrationOutcome as Outcome, MedicationAdministrationStatus as Status,
    };
    let f = Fixture::new().await;
    f.supply(2).await.unwrap();
    let doses = f.doses().await;
    f.outcome(doses[0].id, Outcome::Administered).await;
    f.outcome(doses[1].id, Outcome::Refused).await;
    let historical = f.doses().await;
    sqlx::query(
        "UPDATE prescriptions SET status='completed',dose='Synthetic later regimen' WHERE id=$1",
    )
    .bind(f.source)
    .execute(f.db.pool())
    .await
    .unwrap();
    let detail = f.detail().await;
    assert!(!detail.source_matches_course);
    assert!(detail.can_stop_course);
    assert!(!detail.can_request_schedule_window);
    let before = f.evidence().await;
    typed(
        &f.extend(f.window(&detail)).await.unwrap_err(),
        repo::TreatmentCourseError::SourceChanged,
    );
    assert_eq!(f.evidence().await, before);
    let stopped = f.stop_course(f.stop(&detail)).await.unwrap();
    let TreatmentCourseReceipt::Stopped { result, .. } = stopped else {
        panic!("actual local stop")
    };
    assert_eq!(
        result.source_status_at_stop,
        hms_domain::clinical::PrescriptionStatus::Completed
    );
    assert_eq!(result.retired_pending_dose_count, 2);
    let after = f.doses().await;
    for index in 0..2 {
        assert_eq!(
            serde_json::to_value(&after[index]).unwrap(),
            serde_json::to_value(&historical[index]).unwrap()
        );
        assert!(after[index].local_stop_id.is_none());
    }
    assert!(matches!(after[0].status, Status::Administered));
    assert!(matches!(after[1].status, Status::Refused));
    let detail = f.detail().await;
    assert_eq!(
        detail.summary.source_status,
        hms_domain::clinical::PrescriptionStatus::Completed
    );
    assert_eq!(detail.summary.status, TreatmentCourseStatus::Stopped);
    assert_eq!(detail.counts.given_doses, 1);
    assert_eq!(detail.counts.explicit_non_given_doses, 1);
    assert_eq!(detail.counts.issued_stock_quantity, Some(4));
    assert_eq!(f.evidence().await["stock"], before["stock"]);
    assert_eq!(f.evidence().await["movements"], before["movements"]);
}

#[tokio::test]
async fn missing_or_mixed_physical_evidence_is_unknown_rather_than_a_unit_or_balance_guess() {
    let f = Fixture::new().await;
    f.supply(2).await.unwrap();
    let ids = f.doses().await;
    sqlx::query("UPDATE medication_administrations SET dispensed_stock_quantity=NULL,dispensed_stock_unit=NULL WHERE id=$1")
        .bind(ids[0].id).execute(f.db.pool()).await.unwrap();
    let detail = f.detail().await;
    assert_eq!(detail.counts.supplied_doses, 2);
    assert_eq!(detail.counts.issued_stock_unrecorded_doses, 1);
    assert_eq!(detail.counts.issued_stock_quantity, None);
    assert_eq!(detail.counts.issued_stock_unit, None);
    assert_eq!(
        detail.counts.stock_total_unavailable_reason,
        Some(TreatmentStockTotalUnavailableReason::MissingEvidence)
    );
    assert_eq!(detail.counts.days_of_supply, None);
    sqlx::query("UPDATE medication_administrations SET dispensed_stock_quantity=2,dispensed_stock_unit='Synthetic alternate recorded unit' WHERE id=$1")
        .bind(ids[0].id).execute(f.db.pool()).await.unwrap();
    let detail = f.detail().await;
    assert_eq!(detail.counts.issued_stock_quantity, None);
    assert_eq!(detail.counts.issued_stock_unit, None);
    assert_eq!(
        detail.counts.stock_total_unavailable_reason,
        Some(TreatmentStockTotalUnavailableReason::MixedUnits)
    );
}

#[tokio::test]
async fn new_window_rejects_changed_context_and_invalid_bounds_without_demand_or_audit() {
    let f = Fixture::new().await;
    let detail = f.detail().await;
    let before = f.evidence().await;
    let mut input = f.window(&detail);
    input.scheduled_before = input.expected_scheduled_through;
    typed(
        &f.extend(input).await.unwrap_err(),
        repo::TreatmentCourseError::WindowInvalid,
    );
    let mut input = f.window(&detail);
    input.scheduled_before = input.expected_scheduled_through + Duration::days(32);
    typed(
        &f.extend(input).await.unwrap_err(),
        repo::TreatmentCourseError::WindowInvalid,
    );
    let mut input = f.window(&detail);
    input.expected_context_token = "0".repeat(64);
    typed(
        &f.extend(input).await.unwrap_err(),
        repo::TreatmentCourseError::ContextChanged,
    );
    let mut input = f.window(&detail);
    input.expected_scheduled_through -= Duration::seconds(1);
    typed(
        &f.extend(input).await.unwrap_err(),
        repo::TreatmentCourseError::SnapshotChanged,
    );
    assert_eq!(f.evidence().await, before);
}

#[tokio::test]
async fn request_identity_and_append_only_evidence_preserve_the_original_command() {
    let f = Fixture::new().await;
    let input = f.window(&f.detail().await);
    f.extend(input.clone()).await.unwrap();
    let before = f.evidence().await;
    let mut changed = input.clone();
    changed.note = Some("Synthetic changed intent".into());
    typed(
        &f.extend(changed).await.unwrap_err(),
        repo::TreatmentCourseError::RequestConflict,
    );
    assert_eq!(f.evidence().await, before);
    for statement in [
        "UPDATE treatment_course_requests SET reviewed_input='{}'::jsonb",
        "DELETE FROM treatment_course_requests",
        "UPDATE treatment_course_request_doses SET original_membership='{}'::jsonb",
        "DELETE FROM treatment_course_request_doses",
    ] {
        assert!(sqlx::query(statement).execute(f.db.pool()).await.is_err());
    }
    let detail = f.detail().await;
    f.stop_course(f.stop(&detail)).await.unwrap();
    for statement in [
        "UPDATE medication_course_stops SET reason='Synthetic rewrite'",
        "DELETE FROM medication_course_stops",
    ] {
        assert!(sqlx::query(statement).execute(f.db.pool()).await.is_err());
    }
    let original = repo::get_treatment_course_request(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.admission,
        f.course,
        input.client_request_id,
    )
    .await
    .unwrap();
    let TreatmentCourseReceipt::SupplyWindowCreated {
        reviewed_input,
        result,
        ..
    } = original
    else {
        panic!("saved window")
    };
    assert_eq!(
        reviewed_input.note.as_deref(),
        Some("Synthetic explicitly reviewed window")
    );
    assert_eq!(result.created_dose_count, 4);
}

#[tokio::test]
async fn source_hold_resume_and_stop_cannot_resurrect_or_rewrite_a_local_stop() {
    use hms_domain::clinical::{PrescriptionStatus, UpdatePrescriptionRequest};
    let f = Fixture::new().await;
    f.stop_course(f.stop(&f.detail().await)).await.unwrap();
    let saved = serde_json::to_value(f.detail().await.local_stop).unwrap();
    let doses = serde_json::to_value(f.doses().await).unwrap();
    for status in [
        PrescriptionStatus::OnHold,
        PrescriptionStatus::Active,
        PrescriptionStatus::Stopped,
    ] {
        hms_db::clinical::update_prescription_authorized(
            f.db.pool(),
            f.actor.clone(),
            f.source,
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
        .unwrap()
        .unwrap();
        let detail = f.detail().await;
        assert_eq!(detail.summary.status, TreatmentCourseStatus::Stopped);
        assert_eq!(detail.summary.source_status, status);
        assert_eq!(serde_json::to_value(detail.local_stop).unwrap(), saved);
        assert_eq!(serde_json::to_value(f.doses().await).unwrap(), doses);
    }
}

async fn wait_for_source_waiters(pool: &hms_db::PgPool, minimum: i64) {
    tokio::time::timeout(std::time::Duration::from_secs(4), async {
        loop {
            let waiting:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%prescriptions%'")
                .fetch_one(pool).await.unwrap();
            if waiting >= minimum { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("actual commands reach the held prescription parent");
}

#[tokio::test]
async fn supply_and_local_stop_serialize_in_both_publication_orders_without_an_extra_stock_move() {
    use std::sync::Arc;
    for supply_first in [true, false] {
        let f = Arc::new(Fixture::new().await);
        let stop = f.stop(&f.detail().await);
        let mut held = f.db.pool().begin().await.unwrap();
        sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
            .bind(f.source)
            .execute(&mut *held)
            .await
            .unwrap();
        let supply;
        let stopping;
        if supply_first {
            let operation = Arc::clone(&f);
            supply = tokio::spawn(async move { operation.supply(2).await });
            wait_for_source_waiters(f.db.pool(), 1).await;
            let operation = Arc::clone(&f);
            stopping = tokio::spawn(async move { operation.stop_course(stop).await });
        } else {
            let operation = Arc::clone(&f);
            stopping = tokio::spawn(async move { operation.stop_course(stop).await });
            wait_for_source_waiters(f.db.pool(), 1).await;
            let operation = Arc::clone(&f);
            supply = tokio::spawn(async move { operation.supply(2).await });
        }
        wait_for_source_waiters(f.db.pool(), 2).await;
        held.commit().await.unwrap();
        let (supplied, stopped) = tokio::time::timeout(std::time::Duration::from_secs(8), async {
            tokio::join!(supply, stopping)
        })
        .await
        .expect("both serialized writers finish without deadlock");
        stopped.unwrap().unwrap();
        let supplied = supplied.unwrap();
        assert_eq!(supplied.is_ok(), supply_first);
        let detail = f.detail().await;
        assert_eq!(detail.summary.status, TreatmentCourseStatus::Stopped);
        assert_eq!(
            detail.summary.source_status,
            hms_domain::clinical::PrescriptionStatus::Active
        );
        assert_eq!(
            detail.counts.supplied_doses,
            if supply_first { 2 } else { 0 }
        );
        let (stock,moves):(i64,i64)=sqlx::query_as("SELECT (SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE item_id=$1),(SELECT count(*) FROM stock_movements WHERE item_id=$1 AND movement_type='dispense')")
            .bind(f.item).fetch_one(f.db.pool()).await.unwrap();
        assert_eq!(stock, if supply_first { 96 } else { 100 });
        assert_eq!(moves, if supply_first { 1 } else { 0 });
    }
}

#[tokio::test]
async fn extension_and_stop_serialize_in_both_orders_with_one_immutable_membership() {
    use std::sync::Arc;
    for window_first in [true, false] {
        let f = Arc::new(Fixture::new().await);
        let detail = f.detail().await;
        let window = f.window(&detail);
        let stop = f.stop(&detail);
        let mut held = f.db.pool().begin().await.unwrap();
        sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
            .bind(f.source)
            .execute(&mut *held)
            .await
            .unwrap();
        let expanding;
        let stopping;
        if window_first {
            let operation = Arc::clone(&f);
            expanding = tokio::spawn(async move { operation.extend(window).await });
            wait_for_source_waiters(f.db.pool(), 1).await;
            let operation = Arc::clone(&f);
            stopping = tokio::spawn(async move { operation.stop_course(stop).await });
        } else {
            let operation = Arc::clone(&f);
            stopping = tokio::spawn(async move { operation.stop_course(stop).await });
            wait_for_source_waiters(f.db.pool(), 1).await;
            let operation = Arc::clone(&f);
            expanding = tokio::spawn(async move { operation.extend(window).await });
        }
        wait_for_source_waiters(f.db.pool(), 2).await;
        held.commit().await.unwrap();
        let (expanded, stopped) = tokio::time::timeout(std::time::Duration::from_secs(8), async {
            tokio::join!(expanding, stopping)
        })
        .await
        .expect("source-serialized changes finish");
        let (expanded, stopped) = (expanded.unwrap(), stopped.unwrap());
        assert_eq!(expanded.is_ok(), window_first);
        assert_ne!(expanded.is_ok(), stopped.is_ok());
        if window_first {
            typed(
                &stopped.unwrap_err(),
                repo::TreatmentCourseError::SnapshotChanged,
            );
            f.stop_course(f.stop(&f.detail().await)).await.unwrap();
        } else {
            typed(
                &expanded.unwrap_err(),
                repo::TreatmentCourseError::SnapshotChanged,
            );
        }
        let detail = f.detail().await;
        assert_eq!(detail.summary.status, TreatmentCourseStatus::Stopped);
        assert_eq!(
            detail.counts.generated_scheduled_doses,
            if window_first { 8 } else { 4 }
        );
        assert_eq!(detail.counts.supplied_doses, 0);
        let total: i64 = sqlx::query_scalar(
            "SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE item_id=$1",
        )
        .bind(f.item)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
        assert_eq!(total, 100);
    }
}

#[tokio::test]
async fn actual_given_and_local_stop_have_one_ordered_result_and_preserve_prior_stock_issue() {
    use std::sync::Arc;
    for given_first in [true, false] {
        let f = Arc::new(Fixture::new().await);
        f.supply(1).await.unwrap();
        let dose = f.doses().await[0].id;
        let input = f.stop(&f.detail().await);
        let before = f.evidence().await;
        let mut held = f.db.pool().begin().await.unwrap();
        sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
            .bind(f.source)
            .execute(&mut *held)
            .await
            .unwrap();
        let administering;
        let stopping;
        if given_first {
            let operation = Arc::clone(&f);
            administering = tokio::spawn(async move {
                operation
                    .outcome_result(
                        dose,
                        hms_domain::ward::MedicationAdministrationOutcome::Administered,
                    )
                    .await
            });
            wait_for_source_waiters(f.db.pool(), 1).await;
            let operation = Arc::clone(&f);
            stopping = tokio::spawn(async move { operation.stop_course(input).await });
        } else {
            let operation = Arc::clone(&f);
            stopping = tokio::spawn(async move { operation.stop_course(input).await });
            wait_for_source_waiters(f.db.pool(), 1).await;
            let operation = Arc::clone(&f);
            administering = tokio::spawn(async move {
                operation
                    .outcome_result(
                        dose,
                        hms_domain::ward::MedicationAdministrationOutcome::Administered,
                    )
                    .await
            });
        }
        wait_for_source_waiters(f.db.pool(), 2).await;
        held.commit().await.unwrap();
        let (administered, stopped) =
            tokio::time::timeout(std::time::Duration::from_secs(8), async {
                tokio::join!(administering, stopping)
            })
            .await
            .expect("actual Given and local stop finish after the shared source lock");
        assert_eq!(administered.unwrap().is_ok(), given_first);
        let stopped = stopped.unwrap().unwrap();
        let TreatmentCourseReceipt::Stopped { result, .. } = stopped else {
            panic!("local stop")
        };
        assert_eq!(
            result.retired_pending_dose_count,
            if given_first { 3 } else { 4 }
        );
        let detail = f.detail().await;
        assert_eq!(detail.counts.given_doses, if given_first { 1 } else { 0 });
        assert_eq!(detail.counts.supplied_doses, 1);
        assert_eq!(detail.counts.issued_stock_quantity, Some(2));
        assert_eq!(f.evidence().await["stock"], before["stock"]);
        assert_eq!(f.evidence().await["movements"], before["movements"]);
    }
}

#[tokio::test]
async fn scoped_course_filters_precede_limit_and_page_proof_cost_does_not_grow_with_rows() {
    let f = Fixture::new().await;
    for index in 0..199 {
        let source = Uuid::new_v4();
        sqlx::query("INSERT INTO prescriptions SELECT (jsonb_populate_record(NULL::prescriptions,to_jsonb(p)||jsonb_build_object('id',$2::uuid))).* FROM prescriptions p WHERE p.id=$1")
            .bind(f.source).bind(source).execute(f.db.pool()).await.unwrap();
        sqlx::query("INSERT INTO medication_courses SELECT (jsonb_populate_record(NULL::medication_courses,to_jsonb(c)||jsonb_build_object('id',$2::uuid,'prescription_id',$3::uuid,'status',$4::text,'created_at',clock_timestamp()))).* FROM medication_courses c WHERE c.id=$1")
            .bind(f.course).bind(Uuid::new_v4()).bind(source)
            .bind(if index<99 {"active"} else {"stopped"}).execute(f.db.pool()).await.unwrap();
    }
    let query = TreatmentCourseListQuery {
        status: Some(TreatmentCourseStatus::Active),
        ..Default::default()
    };
    let (first, first_cost) =
        hms_observability::with_request_query_counter(repo::list_treatment_courses(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.admission,
            query.clone(),
            None,
            1,
        ))
        .await;
    assert_eq!(first.unwrap().len(), 1);
    let (page, page_cost) =
        hms_observability::with_request_query_counter(repo::list_treatment_courses(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.admission,
            query,
            None,
            100,
        ))
        .await;
    let page = page.unwrap();
    assert_eq!(
        page.len(),
        100,
        "newer excluded terminal rows do not truncate the active page"
    );
    assert!(page.iter().all(|row| row.patient_id == f.patient
        && row.admission_case_id == f.admission
        && row.status == TreatmentCourseStatus::Active));
    assert_eq!(page_cost, first_cost);
    assert!(
        page_cost >= 6,
        "the measured cost includes mandatory live proof queries"
    );
    assert_eq!(
        repo::treatment_courses_context(f.db.pool(), f.actor.clone(), f.patient, f.admission)
            .await
            .unwrap()
            .generated_course_count,
        200
    );
    let body = serde_json::to_value(page).unwrap().to_string();
    assert!(!body.contains("Synthetic explicit instructions"));
    assert!(!body.contains("Synthetic explicit indication"));
}

#[tokio::test]
async fn source_wait_then_session_revocation_or_authority_expiry_prevents_all_new_course_effects() {
    use std::sync::Arc;
    for revoked in [true, false] {
        let mut fixture = Fixture::new().await;
        if !revoked {
            fixture
                .actor
                .identity
                .authorization
                .as_mut()
                .unwrap()
                .valid_until = Utc::now() + Duration::seconds(2);
        }
        let f = Arc::new(fixture);
        let input = f.window(&f.detail().await);
        let before = f.evidence().await;
        let mut held = f.db.pool().begin().await.unwrap();
        sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
            .bind(f.source)
            .execute(&mut *held)
            .await
            .unwrap();
        let operation = Arc::clone(&f);
        let writing = tokio::spawn(async move { operation.extend(input).await });
        wait_for_source_waiters(f.db.pool(), 1).await;
        if revoked {
            let session = f.actor.identity.authorization.as_ref().unwrap().session_id;
            sqlx::query(
                "UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1",
            )
            .bind(session)
            .execute(f.db.pool())
            .await
            .unwrap();
        } else {
            tokio::time::sleep(std::time::Duration::from_millis(2100)).await;
        }
        held.commit().await.unwrap();
        let error = writing.await.unwrap().unwrap_err();
        assert_eq!(
            error.downcast_ref::<hms_db::clinical::medication_access::MedicationAccessError>(),
            Some(&hms_db::clinical::medication_access::MedicationAccessError::AuthorityExpired)
        );
        assert_eq!(f.evidence().await, before);
    }
}

#[tokio::test]
async fn bounded_regular_window_has_exact_membership_and_constant_dose_page_proof_cost() {
    let f = Fixture::with_schedule("q4h", Some(40)).await;
    let detail = f.detail().await;
    assert!(detail.can_request_schedule_window);
    let mut input = f.window(&detail);
    input.scheduled_before = input.expected_scheduled_through + Duration::days(32);
    let before = f.evidence().await;
    typed(
        &f.extend(input).await.unwrap_err(),
        repo::TreatmentCourseError::WindowInvalid,
    );
    assert_eq!(f.evidence().await, before);
    let mut input = f.window(&detail);
    input.scheduled_before = input.expected_scheduled_through + Duration::days(30);
    let key = input.client_request_id;
    let saved = f.extend(input).await.unwrap();
    let TreatmentCourseReceipt::SupplyWindowCreated { result, .. } = saved else {
        panic!("window")
    };
    assert_eq!(result.created_dose_count, 180);
    assert_eq!(result.created_doses.len(), 180);
    assert_eq!(
        result
            .created_doses
            .iter()
            .map(|d| d.id)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        180
    );
    let query = TreatmentCourseDoseQuery {
        request_id: Some(key),
        ..Default::default()
    };
    let (first, cost) =
        hms_observability::with_request_query_counter(repo::list_treatment_course_doses(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.admission,
            f.course,
            query.clone(),
            None,
            1,
        ))
        .await;
    assert_eq!(first.unwrap().len(), 1);
    let (page, page_cost) =
        hms_observability::with_request_query_counter(repo::list_treatment_course_doses(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.admission,
            f.course,
            query,
            None,
            100,
        ))
        .await;
    let page = page.unwrap();
    assert_eq!(page.len(), 100);
    assert_eq!(page_cost, cost);
    assert!(cost >= 6);
    assert!(page.iter().all(|d| d
        .original_request_membership
        .as_ref()
        .unwrap()
        .pharmacy_fulfillment_id
        == Some(result.fulfillment_id)));
    assert_eq!(f.detail().await.counts.generated_scheduled_doses, 186);
    assert_eq!(f.evidence().await["stock"], before["stock"]);
    assert_eq!(f.evidence().await["movements"], before["movements"]);
}

#[tokio::test]
async fn once_elapsed_and_empty_windows_require_review_without_new_demand() {
    let f = Fixture::with_schedule("once", Some(10)).await;
    let detail = f.detail().await;
    assert_eq!(detail.summary.kind, TreatmentCourseKind::Once);
    assert!(!detail.can_request_schedule_window);
    let before = f.evidence().await;
    typed(
        &f.extend(f.window(&detail)).await.unwrap_err(),
        repo::TreatmentCourseError::WindowUnsupported,
    );
    assert_eq!(f.evidence().await, before);

    let f = Fixture::new().await;
    sqlx::query("UPDATE medication_courses SET scheduled_through=scheduled_through+interval '1 minute' WHERE id=$1").bind(f.course).execute(f.db.pool()).await.unwrap();
    let detail = f.detail().await;
    let mut input = f.window(&detail);
    input.scheduled_before = input.expected_scheduled_through + Duration::minutes(1);
    let before = f.evidence().await;
    typed(
        &f.extend(input).await.unwrap_err(),
        repo::TreatmentCourseError::WindowInvalid,
    );
    assert_eq!(f.evidence().await, before);
    sqlx::query("UPDATE medication_courses SET scheduled_through=clock_timestamp()-interval '1 second' WHERE id=$1").bind(f.course).execute(f.db.pool()).await.unwrap();
    let detail = f.detail().await;
    assert_eq!(
        detail.window_unavailable_reason,
        Some(TreatmentUnavailableReason::WindowElapsed)
    );
    typed(
        &f.extend(f.window(&detail)).await.unwrap_err(),
        repo::TreatmentCourseError::WindowElapsed,
    );
    assert_eq!(f.evidence().await, before);
}

#[tokio::test]
async fn one_original_header_across_both_kinds_cannot_be_relabelled_by_generation_replay() {
    let f = Fixture::new().await;
    assert!(sqlx::query("INSERT INTO pharmacy_fulfillments SELECT (jsonb_populate_record(NULL::pharmacy_fulfillments,to_jsonb(f)||jsonb_build_object('id',gen_random_uuid(),'source_kind','prn_aggregate'))).* FROM pharmacy_fulfillments f WHERE f.id=$1")
        .bind(f.initial).execute(f.db.pool()).await.is_err());
    sqlx::query("UPDATE pharmacy_fulfillments SET source_kind='prn_aggregate' WHERE id=$1")
        .bind(f.initial)
        .execute(f.db.pool())
        .await
        .unwrap();
    let before = f.evidence().await;
    let error = hms_db::pharmacy::generate_mar_for_prescription_authorized(
        f.db.pool(),
        GenerateMarCommand {
            authorization: f.actor.identity.authorization.clone(),
            facility_id: f.db.facility_id(),
            prescription_id: f.source,
            admission_case_id: f.admission,
            days: 1,
            first_dose_at: Some(f.first),
            actor_user_id: f.db.owner_user_id(),
        },
        f.actor.clone(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "mar_generation_parameters_locked");
    let kind: String =
        sqlx::query_scalar("SELECT source_kind FROM pharmacy_fulfillments WHERE id=$1")
            .bind(f.initial)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(kind, "prn_aggregate");
    assert_eq!(f.evidence().await, before);
}

#[tokio::test]
async fn final_audit_wait_expiry_rolls_back_new_window_membership_boundary_and_demand() {
    use std::sync::Arc;
    let mut fixture = Fixture::new().await;
    let input = fixture.window(&fixture.detail().await);
    let deadline = Utc::now() + Duration::seconds(2);
    fixture
        .actor
        .identity
        .authorization
        .as_mut()
        .unwrap()
        .valid_until = deadline;
    let f = Arc::new(fixture);
    let before = f.evidence().await;
    sqlx::raw_sql("CREATE FUNCTION treatment_test_pause_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='medication_course.supply_window_created' THEN PERFORM pg_advisory_xact_lock(402317023); END IF; RETURN NEW; END $$; CREATE TRIGGER treatment_test_pause_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION treatment_test_pause_audit()")
        .execute(f.db.pool()).await.unwrap();
    let mut held = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(402317023)")
        .execute(&mut *held)
        .await
        .unwrap();
    let operation = Arc::clone(&f);
    let writing = tokio::spawn(async move { operation.extend(input).await });
    tokio::time::timeout(std::time::Duration::from_secs(4),async {
        loop {
            let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%INSERT INTO audit_events%')").fetch_one(f.db.pool()).await.unwrap();
            if blocked {break;}
            assert!(!writing.is_finished(),"actual command must reach its final audit wait");
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("actual window reaches final transactional audit");
    loop {
        let expired: bool = sqlx::query_scalar("SELECT clock_timestamp()>=$1")
            .bind(deadline)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
        if expired {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    held.commit().await.unwrap();
    let error = writing.await.unwrap().unwrap_err();
    assert_eq!(
        error.downcast_ref::<hms_db::clinical::medication_access::MedicationAccessError>(),
        Some(&hms_db::clinical::medication_access::MedicationAccessError::AuthorityExpired)
    );
    assert_eq!(f.evidence().await, before);
    let boundary: DateTime<Utc> =
        sqlx::query_scalar("SELECT scheduled_through FROM medication_courses WHERE id=$1")
            .bind(f.course)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(boundary, f.first + Duration::days(1));
}

#[tokio::test]
async fn large_legacy_pending_membership_is_preserved_and_paged_as_original_stop_evidence() {
    let f = Fixture::new().await;
    sqlx::query("INSERT INTO medication_administrations SELECT (jsonb_populate_record(NULL::medication_administrations,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'dose_sequence',100+i,'scheduled_at',m.scheduled_at+(100+i)*interval '6 hours'))).* FROM (SELECT * FROM medication_administrations WHERE medication_course_id=$1 ORDER BY scheduled_at LIMIT 1) m CROSS JOIN generate_series(1,600) AS i")
        .bind(f.course).execute(f.db.pool()).await.unwrap();
    sqlx::query("UPDATE pharmacy_fulfillments SET requested_dose_count=604 WHERE id=$1")
        .bind(f.initial)
        .execute(f.db.pool())
        .await
        .unwrap();
    sqlx::query("INSERT INTO pharmacy_fulfillment_mar_entries SELECT $2,id FROM medication_administrations WHERE medication_course_id=$1 ON CONFLICT DO NOTHING").bind(f.course).bind(f.initial).execute(f.db.pool()).await.unwrap();
    let detail = f.detail().await;
    assert_eq!(detail.counts.generated_scheduled_doses, 604);
    let input = f.stop(&detail);
    let key = input.client_request_id;
    let before = f.evidence().await;
    let saved = f.stop_course(input).await.unwrap();
    let TreatmentCourseReceipt::Stopped { result, .. } = saved else {
        panic!("local stop")
    };
    assert_eq!(result.retired_pending_dose_count, 604);
    let query = TreatmentCourseDoseQuery {
        request_id: Some(key),
        ..Default::default()
    };
    let (first, one_cost) =
        hms_observability::with_request_query_counter(repo::list_treatment_course_doses(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.admission,
            f.course,
            query.clone(),
            None,
            1,
        ))
        .await;
    assert_eq!(first.unwrap().len(), 1);
    let (page, page_cost) =
        hms_observability::with_request_query_counter(repo::list_treatment_course_doses(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.admission,
            f.course,
            query.clone(),
            None,
            100,
        ))
        .await;
    let page = page.unwrap();
    assert_eq!(page.len(), 100);
    assert_eq!(page_cost, one_cost);
    let last = page.last().unwrap();
    let next = repo::list_treatment_course_doses(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.admission,
        f.course,
        query,
        Some(hms_db::ward::WardCursor {
            occurred_at: last.scheduled_at,
            id: last.id,
        }),
        100,
    )
    .await
    .unwrap();
    assert_eq!(next.len(), 100);
    assert!(next.iter().all(|d| d.scheduled_at > last.scheduled_at));
    assert!(page
        .iter()
        .chain(&next)
        .all(|d| d.local_stop_id == Some(result.id)
            && matches!(
                d.original_request_membership
                    .as_ref()
                    .unwrap()
                    .status_at_command,
                hms_domain::ward::MedicationAdministrationStatus::Scheduled
            )));
    assert_eq!(f.detail().await.counts.unrecorded_held_doses, 604);
    assert_eq!(f.evidence().await["stock"], before["stock"]);
    assert_eq!(f.evidence().await["movements"], before["movements"]);
}

#[tokio::test]
async fn stopping_selected_admission_course_does_not_mutate_another_episode_or_source() {
    let f = Fixture::new().await;
    let other_admission = Uuid::new_v4();
    let other_course = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases SELECT (jsonb_populate_record(NULL::admission_cases,to_jsonb(a)||jsonb_build_object('id',$2::uuid,'status','discharged','bed_id',NULL,'discharged_at',clock_timestamp()))).* FROM admission_cases a WHERE a.id=$1")
        .bind(f.admission).bind(other_admission).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO medication_courses SELECT (jsonb_populate_record(NULL::medication_courses,to_jsonb(c)||jsonb_build_object('id',$2::uuid,'admission_case_id',$3::uuid))).* FROM medication_courses c WHERE c.id=$1")
        .bind(f.course).bind(other_course).bind(other_admission).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO medication_administrations SELECT (jsonb_populate_record(NULL::medication_administrations,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'medication_course_id',$2::uuid,'admission_case_id',$3::uuid,'pharmacy_fulfillment_id',NULL))).* FROM medication_administrations m WHERE m.medication_course_id=$1")
        .bind(f.course).bind(other_course).bind(other_admission).execute(f.db.pool()).await.unwrap();
    let prior:serde_json::Value=sqlx::query_scalar("SELECT jsonb_build_object('source',(SELECT to_jsonb(p) FROM prescriptions p WHERE id=$1),'course',(SELECT to_jsonb(c) FROM medication_courses c WHERE id=$2),'doses',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM medication_administrations m WHERE medication_course_id=$2))")
        .bind(f.source).bind(other_course).fetch_one(f.db.pool()).await.unwrap();
    f.stop_course(f.stop(&f.detail().await)).await.unwrap();
    let after:serde_json::Value=sqlx::query_scalar("SELECT jsonb_build_object('source',(SELECT to_jsonb(p) FROM prescriptions p WHERE id=$1),'course',(SELECT to_jsonb(c) FROM medication_courses c WHERE id=$2),'doses',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM medication_administrations m WHERE medication_course_id=$2))")
        .bind(f.source).bind(other_course).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(after, prior);
    let historical = repo::get_treatment_course(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        other_admission,
        other_course,
    )
    .await
    .unwrap();
    assert_eq!(historical.summary.status, TreatmentCourseStatus::Active);
    assert!(!historical.can_stop_course);
    assert_eq!(
        historical.stop_unavailable_reason,
        Some(TreatmentUnavailableReason::AdmissionInactive)
    );
    assert!(!historical.can_request_schedule_window);
}

#[tokio::test]
async fn current_read_authority_recovers_exact_saved_intent_after_manage_withdrawal_without_new_write_rights(
) {
    let mut f = Fixture::new().await;
    let input = f.window(&f.detail().await);
    let original = f.extend(input.clone()).await.unwrap();
    sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.manage'").bind(f.db.owner_user_id()).execute(f.db.pool()).await.unwrap();
    sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
        .bind(f.db.owner_user_id())
        .execute(f.db.pool())
        .await
        .unwrap();
    f.actor = actor(&f.db).await;
    let current = f.detail().await;
    assert!(!current.can_stop_course);
    assert!(!current.can_request_schedule_window);
    assert_eq!(
        current.window_unavailable_reason,
        Some(TreatmentUnavailableReason::PermissionDenied)
    );
    let before = f.evidence().await;
    let replay = f.extend(input.clone()).await.unwrap();
    let (
        TreatmentCourseReceipt::SupplyWindowCreated {
            metadata: old,
            result: created,
            ..
        },
        TreatmentCourseReceipt::SupplyWindowCreated {
            metadata: again,
            result: saved,
            ..
        },
    ) = (original, replay)
    else {
        panic!("same original operation")
    };
    assert!(again.replayed);
    assert_eq!(again.recorded_at, old.recorded_at);
    assert_eq!(saved.fulfillment_id, created.fulfillment_id);
    let recovered = repo::get_treatment_course_request(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.admission,
        f.course,
        input.client_request_id,
    )
    .await
    .unwrap();
    assert!(matches!(
        recovered,
        TreatmentCourseReceipt::SupplyWindowCreated { .. }
    ));
    typed(
        &f.extend(f.window(&current)).await.unwrap_err(),
        repo::TreatmentCourseError::PermissionDenied,
    );
    let mut changed = input;
    changed.note = Some("Synthetic changed request after authority withdrawal".into());
    typed(
        &f.extend(changed).await.unwrap_err(),
        repo::TreatmentCourseError::RequestConflict,
    );
    assert_eq!(f.evidence().await, before);
}

async fn foreign_child_rejects_complete_review_and_writes(table: &str) {
    let f = Fixture::new().await;
    let detail = f.detail().await;
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities SELECT (jsonb_populate_record(NULL::facilities,to_jsonb(f)||jsonb_build_object('id',$2::uuid,'code',$3::text))).* FROM facilities f WHERE f.id=$1")
        .bind(f.db.facility_id()).bind(foreign).bind(format!("SYN{}",foreign.simple())).execute(f.db.pool()).await.unwrap();
    match table {
        "mar" => {
            sqlx::query("INSERT INTO medication_administrations SELECT (jsonb_populate_record(NULL::medication_administrations,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'facility_id',$2::uuid,'medication_name','Synthetic foreign-only medication'))).* FROM (SELECT * FROM medication_administrations WHERE medication_course_id=$1 LIMIT 1) m")
            .bind(f.course).bind(foreign).execute(f.db.pool()).await.unwrap();
        }
        "fulfillment" => {
            sqlx::query("INSERT INTO pharmacy_fulfillments SELECT (jsonb_populate_record(NULL::pharmacy_fulfillments,to_jsonb(f)||jsonb_build_object('id',gen_random_uuid(),'facility_id',$2::uuid,'medication_name','Synthetic foreign-only medication'))).* FROM pharmacy_fulfillments f WHERE f.id=$1")
            .bind(f.initial).bind(foreign).execute(f.db.pool()).await.unwrap();
        }
        _ => unreachable!(),
    }
    let before = f.evidence().await;
    let read = repo::get_treatment_course(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.admission,
        f.course,
    )
    .await;
    assert!(
        read.is_err(),
        "a complete course review must reject an imported foreign child"
    );
    typed(
        &read.unwrap_err(),
        repo::TreatmentCourseError::ReviewRequired,
    );
    typed(
        &f.stop_course(f.stop(&detail)).await.unwrap_err(),
        repo::TreatmentCourseError::ReviewRequired,
    );
    typed(
        &f.extend(f.window(&detail)).await.unwrap_err(),
        repo::TreatmentCourseError::ReviewRequired,
    );
    assert_eq!(f.evidence().await, before);
}

#[tokio::test]
async fn imported_foreign_facility_mar_child_is_review_required_without_exposing_or_mutating_it() {
    foreign_child_rejects_complete_review_and_writes("mar").await;
}

#[tokio::test]
async fn imported_foreign_facility_fulfillment_is_review_required_without_exposing_or_mutating_it()
{
    foreign_child_rejects_complete_review_and_writes("fulfillment").await;
}

#[tokio::test]
async fn final_audit_wait_past_schedule_boundary_cannot_publish_backfilled_window_demand() {
    use std::sync::Arc;
    let f = Arc::new(Fixture::new().await);
    let boundary: DateTime<Utc> =
        sqlx::query_scalar("SELECT clock_timestamp()+interval '3 seconds'")
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    let first = boundary - Duration::days(1);
    // A coherent explicitly configured short remaining boundary. No stock or
    // outcome history exists; actual original dose offsets stay unchanged.
    sqlx::query("UPDATE prescriptions SET first_dose_at=$2,start_date=$3 WHERE id=$1")
        .bind(f.source)
        .bind(first)
        .bind(first.date_naive())
        .execute(f.db.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE medication_courses SET first_dose_at=$2,generation_window_start=$2,generation_window_end=$3,scheduled_through=$3,prescription_first_dose_at=$2,prescription_start_date=$4 WHERE id=$1")
        .bind(f.course).bind(first).bind(boundary).bind(first.date_naive()).execute(f.db.pool()).await.unwrap();
    sqlx::query("UPDATE medication_administrations SET scheduled_at=$2+(dose_sequence-1)*interval '6 hours' WHERE medication_course_id=$1")
        .bind(f.course).bind(first).execute(f.db.pool()).await.unwrap();
    sqlx::query("UPDATE pharmacy_fulfillments SET coverage_start=$2,coverage_end=$3 WHERE id=$1")
        .bind(f.initial)
        .bind(first)
        .bind(boundary)
        .execute(f.db.pool())
        .await
        .unwrap();
    let input = f.window(&f.detail().await);
    let before = f.evidence().await;
    sqlx::raw_sql("CREATE FUNCTION treatment_test_pause_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='medication_course.supply_window_created' THEN PERFORM pg_advisory_xact_lock(402317024); END IF; RETURN NEW; END $$; CREATE TRIGGER treatment_test_pause_boundary BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION treatment_test_pause_boundary()")
        .execute(f.db.pool()).await.unwrap();
    let mut held = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(402317024)")
        .execute(&mut *held)
        .await
        .unwrap();
    let operation = Arc::clone(&f);
    let writing = tokio::spawn(async move { operation.extend(input).await });
    tokio::time::timeout(std::time::Duration::from_secs(4),async {
        loop {
            let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%INSERT INTO audit_events%')").fetch_one(f.db.pool()).await.unwrap();
            if blocked {break;}
            assert!(!writing.is_finished(),"a still-valid reviewed window must reach its actual final audit wait");
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("actual window reaches audit before its reviewed start expires");
    loop {
        let elapsed: bool = sqlx::query_scalar("SELECT clock_timestamp()>$1")
            .bind(boundary)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
        if elapsed {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    held.commit().await.unwrap();
    let result = writing.await.unwrap();
    assert!(
        result.is_err(),
        "elapsed schedule boundaries cannot publish new past-due demand"
    );
    typed(
        &result.unwrap_err(),
        repo::TreatmentCourseError::WindowElapsed,
    );
    assert_eq!(f.evidence().await, before);
    let saved_boundary: DateTime<Utc> =
        sqlx::query_scalar("SELECT scheduled_through FROM medication_courses WHERE id=$1")
            .bind(f.course)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(saved_boundary, boundary);
}
