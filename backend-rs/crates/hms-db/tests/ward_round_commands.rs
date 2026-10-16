use chrono::{Duration, Utc};
use hms_db::{test_support::TestDb, ward_rounds::governed::*};
use hms_domain::{deployment::DeploymentProfile, ward::*, ward_rounds::*};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    patient: Uuid,
    admission: Uuid,
    ward: Uuid,
    actor: WardRoundActor,
}
struct ScheduledSource {
    id: Uuid,
    item: Uuid,
    location: Uuid,
    fulfillment: Uuid,
}
impl ScheduledSource {
    async fn new(f: &Fixture) -> Self {
        let (item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled AND item_type='medication' ORDER BY id LIMIT 1").bind(f.actor.facility_id).fetch_one(f.db.pool()).await.unwrap();
        let location:Uuid=sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1").bind(f.actor.facility_id).fetch_one(f.db.pool()).await.unwrap();
        sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand) VALUES(gen_random_uuid(),$1,$2,$3,'SYNTHETIC-ROUND',100)").bind(f.actor.facility_id).bind(item).bind(location).execute(f.db.pool()).await.unwrap();
        let first = Utc::now() - Duration::hours(1);
        let id = Uuid::new_v4();
        hms_db::clinical::prescription_courses::create_with_stock_policy(
            f.db.pool(),
            hms_db::clinical::NewPrescription {
                id,
                facility_id: f.actor.facility_id,
                patient_id: f.patient,
                encounter_id: None,
                visit_id: None,
                discharge_case_id: None,
                medication_name: "Synthetic reviewed medicine".into(),
                dose: "Explicit clinical dose".into(),
                route: "oral".into(),
                frequency: "q6h".into(),
                inventory_item_id: Some(item),
                start_date: Some(first.date_naive()),
                duration_days: Some(2),
                first_dose_at: Some(first),
                actor_user_id: f.actor.user_id,
            },
            None,
            Some(hms_domain::clinical::ScheduledStockPolicyRequest {
                expected_stock_unit: unit,
                stock_units_per_dose: 2,
            }),
            Default::default(),
            None,
            Some(f.actor.authorization.clone()),
        )
        .await
        .unwrap();
        let generated = hms_db::pharmacy::generate_mar_for_prescription(
            f.db.pool(),
            hms_db::pharmacy::GenerateMarCommand {
                authorization: Some(f.actor.authorization.clone()),
                facility_id: f.actor.facility_id,
                prescription_id: id,
                admission_case_id: f.admission,
                days: 2,
                first_dose_at: Some(first),
                actor_user_id: f.actor.user_id,
            },
        )
        .await
        .unwrap();
        Self {
            id,
            item,
            location,
            fulfillment: generated.pharmacy_fulfillment_id.unwrap(),
        }
    }
    fn dispense(&self, f: &Fixture) -> hms_db::pharmacy::DispenseFulfillmentCommand {
        hms_db::pharmacy::DispenseFulfillmentCommand {
            authorization: Some(f.actor.authorization.clone()),
            facility_id: f.actor.facility_id,
            fulfillment_id: self.fulfillment,
            item_id: self.item,
            location_id: self.location,
            quantity: 1,
            actor_user_id: f.actor.user_id,
        }
    }
    async fn action(
        &self,
        f: &Fixture,
        status: hms_domain::clinical::PrescriptionStatus,
    ) -> WardRoundDraftActionInput {
        let detail = hms_db::clinical::prescription_courses::get_detail(
            f.db.pool(),
            f.actor.facility_id,
            self.id,
        )
        .await
        .unwrap()
        .unwrap();
        WardRoundDraftActionInput::Prescription(WardRoundPrescriptionCommand::Status(
            WardRoundPrescriptionStatusInput {
                prescription_id: self.id,
                expected_snapshot_token: detail.snapshot_token,
                status,
            },
        ))
    }
}
impl Fixture {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let a = db
            .scenario("synthetic-governed-round")
            .admission_case_with_available_bed()
            .await
            .unwrap();
        sqlx::query("UPDATE admission_cases SET status='admitted' WHERE id=$1")
            .bind(a.admission.id)
            .execute(db.pool())
            .await
            .unwrap();
        let user = db.owner_user_id();
        sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING")
            .bind(db.facility_id()).bind(user).bind(a.patient.id).execute(db.pool()).await.unwrap();
        let versions: (i64, i64) =
            sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
                .bind(user)
                .fetch_one(db.pool())
                .await
                .unwrap();
        let session = Uuid::new_v4();
        let now = Utc::now();
        hms_db::auth::insert_refresh_session(
            db.pool(),
            &hms_db::auth::NewRefreshSession {
                token_hash: Uuid::new_v4().to_string(),
                session_id: session,
                session_family_id: session,
                rotated_from_session_id: None,
                user_id: user,
                facility_id: db.facility_id(),
                session_version: versions.0,
                permission_version_at_issue: versions.1,
                csrf_token_hash: "synthetic-hash".into(),
                expires_at: now + Duration::hours(1),
                session_started_at: now,
                idle_expires_at: now + Duration::minutes(30),
                absolute_expires_at: now + Duration::hours(1),
                device_label: None,
            },
        )
        .await
        .unwrap();
        let actor = WardRoundActor {
            facility_id: db.facility_id(),
            user_id: user,
            request_id: None,
            authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
                session_id: session,
                session_version: versions.0,
                permission_version: versions.1,
                active_profile: DeploymentProfile::Hospital,
                valid_until: now + Duration::minutes(15),
            },
            can_write: true,
            can_prescribe: true,
            can_order_labs: true,
            can_create_nursing_task: true,
            can_request_discharge: true,
            can_view_all_wards: true,
        };
        Self {
            db,
            patient: a.patient.id,
            admission: a.admission.id,
            ward: a.ward.id,
            actor,
        }
    }
    fn draft(&self) -> SaveWardRoundDraftRequest {
        SaveWardRoundDraftRequest {
            client_request_id: Uuid::new_v4(),
            ward_round_id: None,
            expected_version: 0,
            admission_case_id: self.admission,
            note_sections: WardRoundNoteSections {
                assessment: Some("Synthetic reviewed assessment".into()),
                ..Default::default()
            },
            rendered_note: Some("Synthetic complete reviewed note".into()),
            actions: vec![self.task()],
        }
    }
    fn task(&self) -> WardRoundDraftActionInput {
        WardRoundDraftActionInput::NursingTask(WardRoundNursingTaskInput {
            title: "Synthetic protected task".into(),
            instruction: "Synthetic reviewed instructions".into(),
            due_at: Utc::now(),
            task_type: NursingTaskType::WardRound,
            assigned_to_user_id: None,
        })
    }
    async fn counts(&self) -> (i64, i64, i64, i64, i64, i64) {
        sqlx::query_as("SELECT (SELECT count(*) FROM ward_rounds),(SELECT count(*) FROM ward_round_actions),(SELECT count(*) FROM ward_round_commands),(SELECT count(*) FROM nursing_tasks),(SELECT count(*) FROM lab_orders),(SELECT count(*) FROM audit_events)").fetch_one(self.db.pool()).await.unwrap()
    }
    async fn save(&self, input: SaveWardRoundDraftRequest) -> WardRoundCommandReceipt {
        save(self.db.pool(), self.actor.clone(), self.patient, input)
            .await
            .unwrap()
    }
}
fn error(value: anyhow::Error, expected: WardRoundError) {
    assert_eq!(value.downcast_ref::<WardRoundError>(), Some(&expected));
}

#[tokio::test]
async fn complete_snapshot_cas_commit_and_original_receipts_are_atomic_and_immutable() {
    let f = Fixture::new().await;
    let input = f.draft();
    let before = f.counts().await;
    let initial = current(f.db.pool(), f.actor.clone(), f.patient, Some(f.admission))
        .await
        .unwrap();
    assert!(initial.ward_round.is_none());
    assert!(initial.permissions.can_edit_draft);
    assert!(!initial.permissions.can_commit);
    let saved = f.save(input.clone()).await;
    let id = saved.ward_round.id;
    assert_eq!(saved.ward_round.actions[0].position, Some(0));
    assert_eq!(
        saved.ward_round.actions[0].payload,
        serde_json::to_value(match &input.actions[0] {
            WardRoundDraftActionInput::NursingTask(p) => p,
            _ => unreachable!(),
        })
        .unwrap()
    );
    assert!(saved.ward_round.permissions.read_only);
    assert!(!saved.ward_round.permissions.can_edit_draft);
    let again = f.save(input.clone()).await;
    assert!(again.replayed);
    assert_eq!(again.ward_round.version, 1);
    assert_eq!(f.counts().await.0, before.0 + 1);
    let mut overwrite = input.clone();
    overwrite.client_request_id = Uuid::new_v4();
    error(
        save(f.db.pool(), f.actor.clone(), f.patient, overwrite)
            .await
            .unwrap_err(),
        WardRoundError::DraftExists,
    );
    let mut stale = input.clone();
    stale.ward_round_id = Some(id);
    stale.expected_version = 9;
    stale.client_request_id = Uuid::new_v4();
    error(
        save(f.db.pool(), f.actor.clone(), f.patient, stale)
            .await
            .unwrap_err(),
        WardRoundError::SourceChanged,
    );
    let command = CommitWardRoundRequest {
        client_request_id: Uuid::new_v4(),
        expected_version: 1,
    };
    let result = commit(f.db.pool(), f.actor.clone(), f.patient, id, command.clone())
        .await
        .unwrap();
    assert_eq!(result.ward_round.status, WardRoundStatus::Committed);
    assert_eq!(result.created_artifacts.len(), 1);
    assert_eq!(result.ward_round.signed_by_user_id, Some(f.actor.user_id));
    assert!(result.ward_round.signed_at.is_some());
    let after = f.counts().await;
    assert_eq!(after.3, before.3 + 1);
    let repeated = commit(f.db.pool(), f.actor.clone(), f.patient, id, command.clone())
        .await
        .unwrap();
    assert!(repeated.replayed);
    assert_eq!(f.counts().await, after);
    let old = receipt(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        input.client_request_id,
    )
    .await
    .unwrap();
    assert_eq!(old.ward_round.status, WardRoundStatus::Draft);
    assert_eq!(old.ward_round.version, 1);
    assert!(old.created_artifacts.is_empty());
    let mut wrong = command;
    wrong.expected_version = 2;
    error(
        commit(f.db.pool(), f.actor.clone(), f.patient, id, wrong)
            .await
            .unwrap_err(),
        WardRoundError::RequestConflict,
    );
    assert!(sqlx::query(
        "UPDATE ward_round_commands SET command_type='saved_draft' WHERE facility_id=$1"
    )
    .bind(f.actor.facility_id)
    .execute(f.db.pool())
    .await
    .is_err());
    assert!(
        sqlx::query("DELETE FROM ward_round_commands WHERE facility_id=$1")
            .bind(f.actor.facility_id)
            .execute(f.db.pool())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn nursing_actions_require_real_ward_membership_and_eligible_assignee_without_writes() {
    let f = Fixture::new().await;
    let before = f.counts().await;
    let mut actor = f.actor.clone();
    actor.can_view_all_wards = false;
    let value = save(f.db.pool(), actor, f.patient, f.draft())
        .await
        .unwrap_err();
    assert_eq!(
        value.downcast_ref::<hms_db::ward::nursing_access::NursingError>(),
        Some(&hms_db::ward::nursing_access::NursingError::WardDenied)
    );
    assert_eq!(f.counts().await, before);
    let mut input = f.draft();
    if let WardRoundDraftActionInput::NursingTask(p) = &mut input.actions[0] {
        p.assigned_to_user_id = Some(f.actor.user_id);
    }
    let value = save(f.db.pool(), f.actor.clone(), f.patient, input)
        .await
        .unwrap_err();
    assert_eq!(
        value.downcast_ref::<hms_db::ward::nursing_access::NursingError>(),
        Some(&hms_db::ward::nursing_access::NursingError::InvalidAssignee)
    );
    assert_eq!(f.counts().await, before);
}

#[tokio::test]
async fn every_selected_lab_reference_and_active_admission_are_revalidated_before_any_artifact() {
    let f = Fixture::new().await;
    let before = f.counts().await;
    let test: Uuid = sqlx::query_scalar("SELECT id FROM lab_tests WHERE facility_id=$1 LIMIT 1")
        .bind(f.actor.facility_id)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    let mut input = f.draft();
    input.actions.push(WardRoundDraftActionInput::LabOrder(
        WardRoundLabOrderInput {
            test_ids: vec![test, Uuid::new_v4()],
            panel_ids: vec![],
            priority: hms_domain::laboratory::LabPriority::Routine,
        },
    ));
    error(
        save(f.db.pool(), f.actor.clone(), f.patient, input)
            .await
            .unwrap_err(),
        WardRoundError::CatalogChanged,
    );
    assert_eq!(f.counts().await, before);
    let saved = f.save(f.draft()).await;
    sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
        .bind(f.admission)
        .execute(f.db.pool())
        .await
        .unwrap();
    let before = f.counts().await;
    error(
        commit(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1,
            },
        )
        .await
        .unwrap_err(),
        WardRoundError::ContextChanged,
    );
    assert_eq!(f.counts().await, before);
    let context = current(f.db.pool(), f.actor.clone(), f.patient, Some(f.admission))
        .await
        .unwrap();
    assert!(context.permissions.read_only);
    assert!(!context.permissions.can_commit);
    let old = receipt(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        saved.client_request_id,
    )
    .await
    .unwrap();
    assert_eq!(old.ward_round.version, 1);
}

#[tokio::test]
async fn commit_audit_failure_rolls_back_nursing_lab_prescription_discharge_and_source_snapshot() {
    let f = Fixture::new().await;
    let test: Uuid = sqlx::query_scalar("SELECT id FROM lab_tests WHERE facility_id=$1 LIMIT 1")
        .bind(f.actor.facility_id)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    let mut input = f.draft();
    input.actions.push(WardRoundDraftActionInput::Prescription(
        WardRoundPrescriptionCommand::Start(WardRoundScheduledPrescriptionInput {
            medication_name: "Synthetic scheduled medication".into(),
            dose: "Reviewed clinical dose".into(),
            route: "oral".into(),
            frequency: "daily".into(),
            instructions: "Synthetic instructions".into(),
            reason: "Synthetic indication".into(),
            start_date: Utc::now().date_naive(),
            duration_days: Some(2),
            first_dose_at: None,
        }),
    ));
    input.actions.push(WardRoundDraftActionInput::LabOrder(
        WardRoundLabOrderInput {
            test_ids: vec![test],
            panel_ids: vec![],
            priority: hms_domain::laboratory::LabPriority::Routine,
        },
    ));
    input
        .actions
        .push(WardRoundDraftActionInput::DischargeRequest(
            WardRoundDischargeInput {},
        ));
    let saved = f.save(input).await;
    let before = f.counts().await;
    let meds: i64 = sqlx::query_scalar("SELECT count(*) FROM prescriptions")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION reject_round_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='ward_round.committed' THEN RAISE EXCEPTION 'synthetic audit refusal'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_round_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_round_audit();").execute(f.db.pool()).await.unwrap();
    assert!(commit(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        saved.ward_round.id,
        CommitWardRoundRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: 1
        }
    )
    .await
    .is_err());
    assert_eq!(f.counts().await, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM prescriptions")
            .fetch_one(f.db.pool())
            .await
            .unwrap(),
        meds
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM discharge_cases WHERE admission_case_id=$1"
        )
        .bind(f.admission)
        .fetch_one(f.db.pool())
        .await
        .unwrap(),
        0
    );
    sqlx::query("DROP TRIGGER reject_round_audit ON audit_events")
        .execute(f.db.pool())
        .await
        .unwrap();
    let result = commit(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        saved.ward_round.id,
        CommitWardRoundRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: 1,
        },
    )
    .await
    .unwrap();
    assert_eq!(result.created_artifacts.len(), 4);
    let docs:(String,String)=sqlx::query_as("SELECT instructions,reason FROM prescriptions WHERE patient_id=$1 ORDER BY prescribed_at DESC LIMIT 1").bind(f.patient).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(
        docs,
        (
            "Synthetic instructions".into(),
            "Synthetic indication".into()
        )
    );
}

#[tokio::test]
async fn aggregate_edit_and_commit_serialize_without_post_commit_child_changes() {
    let f = Fixture::new().await;
    let input = f.draft();
    let saved = f.save(input.clone()).await;
    let id = saved.ward_round.id;
    let mut update = input;
    update.ward_round_id = Some(id);
    update.expected_version = 1;
    update.client_request_id = Uuid::new_v4();
    update.actions.clear();
    let (edit, signed) = tokio::join!(
        save(f.db.pool(), f.actor.clone(), f.patient, update),
        commit(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1
            }
        )
    );
    assert_ne!(edit.is_ok(), signed.is_ok());
    let detail = get(f.db.pool(), f.actor.clone(), f.patient, id)
        .await
        .unwrap();
    if signed.is_ok() {
        assert_eq!(detail.status, WardRoundStatus::Committed);
        assert_eq!(detail.actions.len(), 1);
        assert_eq!(detail.actions[0].status, WardRoundActionStatus::Committed);
    } else {
        assert_eq!(detail.status, WardRoundStatus::Draft);
        assert!(detail.actions.is_empty());
    }
}

#[tokio::test]
async fn original_command_scope_and_explicit_prescription_contract_fail_closed() {
    let f = Fixture::new().await;
    let before = f.counts().await;
    let mut input = f.draft();
    input.actions = vec![WardRoundDraftActionInput::Prescription(
        WardRoundPrescriptionCommand::Start(WardRoundScheduledPrescriptionInput {
            medication_name: "Synthetic PRN".into(),
            dose: "Explicit dose".into(),
            route: "oral".into(),
            frequency: " PrN ".into(),
            instructions: String::new(),
            reason: String::new(),
            start_date: Utc::now().date_naive(),
            duration_days: None,
            first_dose_at: None,
        }),
    )];
    error(
        save(f.db.pool(), f.actor.clone(), f.patient, input)
            .await
            .unwrap_err(),
        WardRoundError::PrescribingPanelRequired,
    );
    assert_eq!(f.counts().await, before);
    let saved = f.save(f.draft()).await;
    let mut actor = f.actor.clone();
    actor.user_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    error(
        receipt(f.db.pool(), actor, f.patient, saved.client_request_id)
            .await
            .unwrap_err(),
        WardRoundError::NotFound,
    );
    error(
        receipt(
            f.db.pool(),
            f.actor.clone(),
            Uuid::new_v4(),
            saved.client_request_id,
        )
        .await
        .unwrap_err(),
        WardRoundError::NotFound,
    );
}

#[tokio::test]
async fn saved_human_prescription_and_lab_targets_are_immutable_and_revalidated() {
    let f = Fixture::new().await;
    let source = ScheduledSource::new(&f).await;
    let (test, name, code): (Uuid, String, String) = sqlx::query_as(
        "SELECT id,name,code FROM lab_tests WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
    )
    .bind(f.actor.facility_id)
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    let panel = Uuid::new_v4();
    sqlx::query("INSERT INTO lab_panels(id,facility_id,code,name) VALUES($1,$2,'SYNTHETIC-ROUND','Synthetic reviewed panel')").bind(panel).bind(f.actor.facility_id).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO lab_panel_tests(panel_id,test_id) VALUES($1,$2)")
        .bind(panel)
        .bind(test)
        .execute(f.db.pool())
        .await
        .unwrap();
    let mut input = f.draft();
    input.actions = vec![
        source
            .action(&f, hms_domain::clinical::PrescriptionStatus::Stopped)
            .await,
        WardRoundDraftActionInput::LabOrder(WardRoundLabOrderInput {
            test_ids: vec![],
            panel_ids: vec![panel],
            priority: hms_domain::laboratory::LabPriority::Routine,
        }),
    ];
    let saved = f.save(input.clone()).await;
    let targets = &saved.ward_round.actions[0].reviewed_targets;
    assert_eq!(targets[0].display_name, "Synthetic reviewed medicine");
    assert_eq!(
        targets[0].prescription.as_ref().unwrap().dose,
        "Explicit clinical dose"
    );
    let targets = &saved.ward_round.actions[1].reviewed_targets;
    assert_eq!(targets[0].display_name, "Synthetic reviewed panel");
    assert!(targets[0].selected);
    assert_eq!(targets[1].display_name, name);
    assert_eq!(targets[1].code, Some(code));
    assert!(!targets[1].selected);
    let before = f.counts().await;
    sqlx::query("UPDATE lab_tests SET name='Synthetic renamed test' WHERE id=$1")
        .bind(test)
        .execute(f.db.pool())
        .await
        .unwrap();
    error(
        commit(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1,
            },
        )
        .await
        .unwrap_err(),
        WardRoundError::SourceChanged,
    );
    assert_eq!(f.counts().await, before);
    let old = receipt(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        saved.client_request_id,
    )
    .await
    .unwrap();
    assert_eq!(
        old.ward_round.actions[1].reviewed_targets[1].display_name,
        name
    );
    let mut revised = input;
    revised.ward_round_id = Some(saved.ward_round.id);
    revised.expected_version = 1;
    revised.client_request_id = Uuid::new_v4();
    let saved = f.save(revised).await;
    sqlx::query(
        "UPDATE prescriptions SET status='on_hold',updated_at=clock_timestamp() WHERE id=$1",
    )
    .bind(source.id)
    .execute(f.db.pool())
    .await
    .unwrap();
    let before = f.counts().await;
    error(
        commit(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 2,
            },
        )
        .await
        .unwrap_err(),
        WardRoundError::SourceChanged,
    );
    assert_eq!(f.counts().await, before);
}

#[tokio::test]
async fn oversized_imported_panel_is_bounded_and_rejected_without_a_partial_draft() {
    let f = Fixture::new().await;
    let panel = Uuid::new_v4();
    sqlx::query("INSERT INTO lab_panels(id,facility_id,code,name) VALUES($1,$2,'SYNTHETIC-OVERSIZED','Synthetic imported panel')").bind(panel).bind(f.actor.facility_id).execute(f.db.pool()).await.unwrap();
    sqlx::query("WITH tests AS (INSERT INTO lab_tests(id,facility_id,code,name,specimen_type) SELECT gen_random_uuid(),$1,'SYNTHETIC-BOUND-'||n,'Synthetic test '||n,'blood' FROM generate_series(1,1200) n RETURNING id) INSERT INTO lab_panel_tests(panel_id,test_id) SELECT $2,id FROM tests").bind(f.actor.facility_id).bind(panel).execute(f.db.pool()).await.unwrap();
    let before = f.counts().await;
    let mut input = f.draft();
    input.actions.push(WardRoundDraftActionInput::LabOrder(
        WardRoundLabOrderInput {
            test_ids: vec![],
            panel_ids: vec![panel],
            priority: hms_domain::laboratory::LabPriority::Routine,
        },
    ));
    error(
        save(f.db.pool(), f.actor.clone(), f.patient, input)
            .await
            .unwrap_err(),
        WardRoundError::CatalogChanged,
    );
    assert_eq!(f.counts().await, before);
}

#[tokio::test]
async fn saved_task_requires_current_feature_and_current_active_ward_at_commit() {
    let f = Fixture::new().await;
    let saved = f.save(f.draft()).await;
    let before = f.counts().await;
    hms_db::admin::update_feature_entitlement(
        f.db.pool(),
        f.actor.facility_id,
        hms_domain::deployment::FeatureKey::Nursing,
        false,
        f.actor.user_id,
        None,
    )
    .await
    .unwrap()
    .unwrap();
    let after_feature = f.counts().await;
    error(
        commit(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1,
            },
        )
        .await
        .unwrap_err(),
        WardRoundError::FeatureDisabled,
    );
    assert_eq!(f.counts().await, after_feature);
    assert_eq!(after_feature.3, before.3);
    hms_db::admin::update_feature_entitlement(
        f.db.pool(),
        f.actor.facility_id,
        hms_domain::deployment::FeatureKey::Nursing,
        true,
        f.actor.user_id,
        None,
    )
    .await
    .unwrap()
    .unwrap();
    sqlx::query("UPDATE wards SET status='inactive' WHERE id=$1")
        .bind(f.ward)
        .execute(f.db.pool())
        .await
        .unwrap();
    let before = f.counts().await;
    error(
        commit(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1,
            },
        )
        .await
        .unwrap_err(),
        WardRoundError::ContextChanged,
    );
    assert_eq!(f.counts().await, before);
}

#[tokio::test]
async fn populated_legacy_children_are_rejected_without_unbounded_or_partial_review() {
    let f = Fixture::new().await;
    let saved = f.save(f.draft()).await;
    sqlx::query("INSERT INTO ward_round_actions(id,facility_id,ward_round_id,patient_id,admission_case_id,action_type,status,title,payload) SELECT gen_random_uuid(),$1,$2,$3,$4,'nursing_task','draft','Synthetic legacy action','{}'::jsonb FROM generate_series(1,250)").bind(f.actor.facility_id).bind(saved.ward_round.id).bind(f.patient).bind(f.admission).execute(f.db.pool()).await.unwrap();
    let before = f.counts().await;
    let mut replacement = f.draft();
    replacement.ward_round_id = Some(saved.ward_round.id);
    replacement.expected_version = 1;
    replacement.rendered_note =
        Some("Synthetic replacement must not overwrite prior evidence".into());
    error(
        save(f.db.pool(), f.actor.clone(), f.patient, replacement)
            .await
            .unwrap_err(),
        WardRoundError::DraftReviewRequired,
    );
    assert_eq!(f.counts().await, before);
    let original_note: String =
        sqlx::query_scalar("SELECT rendered_note FROM ward_rounds WHERE id=$1")
            .bind(saved.ward_round.id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(Some(original_note), saved.ward_round.rendered_note);
    error(
        get(f.db.pool(), f.actor.clone(), f.patient, saved.ward_round.id)
            .await
            .unwrap_err(),
        WardRoundError::DraftReviewRequired,
    );
    error(
        current(f.db.pool(), f.actor.clone(), f.patient, Some(f.admission))
            .await
            .unwrap_err(),
        WardRoundError::DraftReviewRequired,
    );
    error(
        commit(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1,
            },
        )
        .await
        .unwrap_err(),
        WardRoundError::DraftReviewRequired,
    );
    assert_eq!(f.counts().await, before);
    let original = receipt(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        saved.client_request_id,
    )
    .await
    .unwrap();
    assert_eq!(original.ward_round.actions.len(), 1);
}

#[tokio::test]
async fn inconsistent_imported_action_or_artifact_scope_never_leaks_or_commits() {
    for artifact in [false, true] {
        let f = Fixture::new().await;
        let saved = f.save(f.draft()).await;
        let foreign: Uuid = sqlx::query_scalar(
            "SELECT id FROM patients WHERE facility_id=$1 AND id<>$2 ORDER BY id LIMIT 1",
        )
        .bind(f.actor.facility_id)
        .bind(f.patient)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
        if artifact {
            sqlx::query("INSERT INTO ward_round_artifact_links(id,facility_id,ward_round_id,patient_id,admission_case_id,resource_type,resource_id,title) VALUES(gen_random_uuid(),$1,$2,$3,$4,'nursing_task',gen_random_uuid(),'SYNTHETIC-FOREIGN-NARRATIVE')").bind(f.actor.facility_id).bind(saved.ward_round.id).bind(foreign).bind(f.admission).execute(f.db.pool()).await.unwrap();
        } else {
            sqlx::query("INSERT INTO ward_round_actions(id,facility_id,ward_round_id,patient_id,admission_case_id,action_type,status,title,instruction,payload) VALUES(gen_random_uuid(),$1,$2,$3,$4,'nursing_task','draft','SYNTHETIC-FOREIGN-NARRATIVE','SYNTHETIC-FOREIGN-NARRATIVE','{}'::jsonb)").bind(f.actor.facility_id).bind(saved.ward_round.id).bind(foreign).bind(f.admission).execute(f.db.pool()).await.unwrap();
        }
        let before = f.counts().await;
        error(
            get(f.db.pool(), f.actor.clone(), f.patient, saved.ward_round.id)
                .await
                .unwrap_err(),
            WardRoundError::DraftReviewRequired,
        );
        error(
            commit(
                f.db.pool(),
                f.actor.clone(),
                f.patient,
                saved.ward_round.id,
                CommitWardRoundRequest {
                    client_request_id: Uuid::new_v4(),
                    expected_version: 1,
                },
            )
            .await
            .unwrap_err(),
            WardRoundError::DraftReviewRequired,
        );
        assert_eq!(f.counts().await, before);
        let legacy = hms_db::ward_rounds::get_ward_round(
            f.db.pool(),
            f.actor.facility_id,
            f.patient,
            saved.ward_round.id,
        )
        .await
        .unwrap()
        .unwrap();
        assert!(!serde_json::to_string(&legacy)
            .unwrap()
            .contains("SYNTHETIC-FOREIGN-NARRATIVE"));
    }
}

#[tokio::test]
async fn cancelled_legacy_actions_remain_history_and_ambiguous_prior_commit_needs_review() {
    let f = Fixture::new().await;
    let saved = f.save(f.draft()).await;
    sqlx::query("UPDATE ward_round_actions SET status='cancelled' WHERE ward_round_id=$1")
        .bind(saved.ward_round.id)
        .execute(f.db.pool())
        .await
        .unwrap();
    let mut input = f.draft();
    input.ward_round_id = Some(saved.ward_round.id);
    input.expected_version = 1;
    let saved = f.save(input).await;
    assert_eq!(saved.ward_round.actions.len(), 2);
    assert_eq!(saved.ward_round.action_counts.cancelled, 1);
    let before = f.counts().await;
    let signed = commit(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        saved.ward_round.id,
        CommitWardRoundRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: 2,
        },
    )
    .await
    .unwrap();
    assert_eq!(signed.created_artifacts.len(), 1);
    assert_eq!(signed.ward_round.action_counts.cancelled, 1);
    assert_eq!(f.counts().await.3, before.3 + 1);
    let input = f.draft();
    let saved = f.save(input).await;
    sqlx::query("UPDATE ward_round_actions SET status='committed' WHERE ward_round_id=$1")
        .bind(saved.ward_round.id)
        .execute(f.db.pool())
        .await
        .unwrap();
    let before = f.counts().await;
    error(
        get(f.db.pool(), f.actor.clone(), f.patient, saved.ward_round.id)
            .await
            .unwrap_err(),
        WardRoundError::DraftReviewRequired,
    );
    error(
        commit(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1,
            },
        )
        .await
        .unwrap_err(),
        WardRoundError::DraftReviewRequired,
    );
    assert_eq!(f.counts().await, before);
}

async fn wait_for_waiters(pool: &hms_db::PgPool, n: i64) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async {loop {
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0").fetch_one(pool).await.unwrap();
        if count>=n {break;}
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }}).await.expect("canonical commands actually contend on their database locks");
}

#[tokio::test]
async fn canonical_supply_and_round_stop_discharge_serialize_in_both_orders_without_stock_loss() {
    for supply_first in [true, false] {
        let f = Fixture::new().await;
        let source = ScheduledSource::new(&f).await;
        let mut input = f.draft();
        input.actions = vec![
            source
                .action(&f, hms_domain::clinical::PrescriptionStatus::Stopped)
                .await,
            WardRoundDraftActionInput::DischargeRequest(WardRoundDischargeInput {}),
        ];
        let saved = f.save(input).await;
        let predicate = if supply_first {
            "NEW.reason='pharmacy_fulfillment'"
        } else {
            "NEW.event_type='ward_round.committed'"
        };
        let table = if supply_first {
            "stock_movements"
        } else {
            "audit_events"
        };
        sqlx::raw_sql(&format!("CREATE FUNCTION pause_canonical_round_race() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF {predicate} THEN PERFORM pg_advisory_xact_lock(731901); END IF; RETURN NEW; END; $$; CREATE TRIGGER pause_canonical_round_race BEFORE INSERT ON {table} FOR EACH ROW EXECUTE FUNCTION pause_canonical_round_race();")).execute(f.db.pool()).await.unwrap();
        let mut held = f.db.pool().begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock(731901)")
            .execute(&mut *held)
            .await
            .unwrap();
        let pool = f.db.pool().clone();
        let command = source.dispense(&f);
        let supply = async move { hms_db::pharmacy::dispense_fulfillment(&pool, command).await };
        let pool = f.db.pool().clone();
        let actor = f.actor.clone();
        let patient = f.patient;
        let id = saved.ward_round.id;
        let round = async move {
            commit(
                &pool,
                actor,
                patient,
                id,
                CommitWardRoundRequest {
                    client_request_id: Uuid::new_v4(),
                    expected_version: 1,
                },
            )
            .await
        };
        let (supply, round) = if supply_first {
            let supply = tokio::spawn(supply);
            wait_for_waiters(f.db.pool(), 1).await;
            let round = tokio::spawn(round);
            wait_for_waiters(f.db.pool(), 2).await;
            (supply, round)
        } else {
            let round = tokio::spawn(round);
            wait_for_waiters(f.db.pool(), 1).await;
            let supply = tokio::spawn(supply);
            wait_for_waiters(f.db.pool(), 2).await;
            (supply, round)
        };
        held.commit().await.unwrap();
        let supplied = tokio::time::timeout(std::time::Duration::from_secs(3), supply)
            .await
            .unwrap()
            .unwrap();
        let signed = tokio::time::timeout(std::time::Duration::from_secs(3), round)
            .await
            .unwrap()
            .unwrap();
        assert!(
            signed.is_ok(),
            "round must complete without a canonical source/admission deadlock"
        );
        assert_eq!(supplied.is_ok(), supply_first);
        let (balance,moved,supplied_doses):(i64,i64,i64)=sqlx::query_as("SELECT (SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE item_id=$1),(SELECT COALESCE(sum(quantity),0)::bigint FROM stock_movements WHERE item_id=$1),(SELECT count(*) FROM medication_administrations WHERE prescription_id=$2 AND is_dispensed)").bind(source.item).bind(source.id).fetch_one(f.db.pool()).await.unwrap();
        assert_eq!(
            (balance, moved, supplied_doses),
            if supply_first {
                (98, -2, 1)
            } else {
                (100, 0, 0)
            }
        );
        let status: String = sqlx::query_scalar("SELECT status FROM prescriptions WHERE id=$1")
            .bind(source.id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
        assert_eq!(status, "stopped");
    }
}

#[tokio::test]
async fn canonical_discharge_cancel_wins_before_round_request_without_reopening_cancelled_case() {
    let f = Fixture::new().await;
    let admission =
        hms_db::ward::get_admission_context(f.db.pool(), f.actor.facility_id, f.admission)
            .await
            .unwrap()
            .unwrap();
    let case = hms_db::ward::request_discharge(
        f.db.pool(),
        Uuid::new_v4(),
        f.actor.facility_id,
        &admission,
        None,
        None,
        f.actor.user_id,
    )
    .await
    .unwrap();
    let mut input = f.draft();
    input.actions = vec![WardRoundDraftActionInput::DischargeRequest(
        WardRoundDischargeInput {},
    )];
    let saved = f.save(input).await;
    sqlx::raw_sql("CREATE FUNCTION pause_discharge_cancel_race() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='cancelled' THEN PERFORM pg_advisory_xact_lock(731902); END IF; RETURN NEW; END; $$; CREATE TRIGGER pause_discharge_cancel_race AFTER UPDATE ON discharge_cases FOR EACH ROW EXECUTE FUNCTION pause_discharge_cancel_race();").execute(f.db.pool()).await.unwrap();
    let mut held = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(731902)")
        .execute(&mut *held)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let facility = f.actor.facility_id;
    let cancelled =
        tokio::spawn(async move { hms_db::ward::cancel_discharge(&pool, facility, case.id).await });
    wait_for_waiters(f.db.pool(), 1).await;
    let pool = f.db.pool().clone();
    let actor = f.actor.clone();
    let patient = f.patient;
    let pending = tokio::spawn(async move {
        commit(
            &pool,
            actor,
            patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1,
            },
        )
        .await
    });
    wait_for_waiters(f.db.pool(), 2).await;
    held.commit().await.unwrap();
    assert!(cancelled.await.unwrap().unwrap().is_some());
    error(
        tokio::time::timeout(std::time::Duration::from_secs(3), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err(),
        WardRoundError::DischargeReviewRequired,
    );
    let status:(String,String)=sqlx::query_as("SELECT d.status,a.status FROM discharge_cases d JOIN admission_cases a ON a.id=d.admission_case_id WHERE d.id=$1").bind(case.id).fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(status, ("cancelled".into(), "admitted".into()));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM ward_round_commands WHERE command_type='committed'"
        )
        .fetch_one(f.db.pool())
        .await
        .unwrap(),
        0
    );
}

#[tokio::test]
async fn sibling_prn_supply_and_round_discharge_share_group_before_admission_lock() {
    use hms_domain::clinical::{
        NewPrescriptionCourseRequest, PrescriptionCourseRelation, PrescriptionStatus,
        PrnPolicyRequest,
    };
    let f = Fixture::new().await;
    let source = ScheduledSource::new(&f).await;
    let unit: String = sqlx::query_scalar("SELECT unit FROM inventory_items WHERE id=$1")
        .bind(source.item)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    let root = Uuid::new_v4();
    let policy = PrnPolicyRequest {
        expected_stock_unit: unit.clone(),
        minimum_interval_hours: 4,
        maximum_doses_per_24_hours: 2,
        indication: "Synthetic reviewed indication".into(),
        stock_units_per_dose: 2,
    };
    hms_db::clinical::prescription_courses::create_with_stock_policy(
        f.db.pool(),
        hms_db::clinical::NewPrescription {
            id: root,
            facility_id: f.actor.facility_id,
            patient_id: f.patient,
            encounter_id: None,
            visit_id: None,
            discharge_case_id: None,
            medication_name: "Synthetic PRN root".into(),
            dose: "Explicit dose".into(),
            route: "oral".into(),
            frequency: "prn".into(),
            inventory_item_id: Some(source.item),
            start_date: Some(Utc::now().date_naive()),
            duration_days: Some(2),
            first_dose_at: None,
            actor_user_id: f.actor.user_id,
        },
        Some(policy.clone()),
        None,
        Default::default(),
        None,
        Some(f.actor.authorization.clone()),
    )
    .await
    .unwrap();
    let detail =
        hms_db::clinical::prescription_courses::get_detail(f.db.pool(), f.actor.facility_id, root)
            .await
            .unwrap()
            .unwrap();
    let successor = hms_db::clinical::prescription_courses::create_new_course(
        f.db.pool(),
        hms_db::clinical::prescription_courses::PrescriptionActor {
            facility_id: f.actor.facility_id,
            user_id: f.actor.user_id,
            request_id: None,
            authorization: Some(f.actor.authorization.clone()),
        },
        root,
        NewPrescriptionCourseRequest {
            client_request_id: Uuid::new_v4(),
            expected_snapshot_token: detail.snapshot_token,
            relation: PrescriptionCourseRelation::Replacement,
            change_reason: "Synthetic reviewed replacement".into(),
            medication_name: "Synthetic PRN successor".into(),
            dose: "Explicit dose".into(),
            route: "oral".into(),
            frequency: "prn".into(),
            instructions: "".into(),
            reason: "".into(),
            start_date: Utc::now().date_naive(),
            duration_days: Some(2),
            first_dose_at: None,
            encounter_id: None,
            visit_id: None,
            inventory_item_id: Some(source.item),
            expected_stock_unit: Some(unit),
            prn_policy: Some(policy),
            scheduled_stock_policy: None,
        },
    )
    .await
    .unwrap();
    let successor_id = successor.prescription.prescription.id;
    let dose = hms_db::ward::request_prn_dose(
        f.db.pool(),
        hms_db::ward::RequestPrnDose {
            facility_id: f.actor.facility_id,
            prescription_id: successor_id,
            admission_case_id: f.admission,
            client_request_id: Uuid::new_v4(),
            indication: "Synthetic current dose indication".into(),
            actor_user_id: f.actor.user_id,
            request_id: None,
        },
    )
    .await
    .unwrap();
    let detail =
        hms_db::clinical::prescription_courses::get_detail(f.db.pool(), f.actor.facility_id, root)
            .await
            .unwrap()
            .unwrap();
    let mut input = f.draft();
    input.actions.push(WardRoundDraftActionInput::Prescription(
        WardRoundPrescriptionCommand::Status(WardRoundPrescriptionStatusInput {
            prescription_id: root,
            expected_snapshot_token: detail.snapshot_token,
            status: PrescriptionStatus::Stopped,
        }),
    ));
    input
        .actions
        .push(WardRoundDraftActionInput::DischargeRequest(
            WardRoundDischargeInput {},
        ));
    let saved = f.save(input).await;
    sqlx::raw_sql("CREATE FUNCTION pause_prn_round_race() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='nursing.task.created' THEN PERFORM pg_advisory_xact_lock(731903); END IF; RETURN NEW; END; $$; CREATE TRIGGER pause_prn_round_race BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION pause_prn_round_race();").execute(f.db.pool()).await.unwrap();
    let mut held = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(731903)")
        .execute(&mut *held)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let actor = f.actor.clone();
    let patient = f.patient;
    let round = tokio::spawn(async move {
        commit(
            &pool,
            actor,
            patient,
            saved.ward_round.id,
            CommitWardRoundRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: 1,
            },
        )
        .await
    });
    wait_for_waiters(f.db.pool(), 1).await;
    let pool = f.db.pool().clone();
    let mut command = source.dispense(&f);
    command.fulfillment_id = dose.pharmacy_fulfillment_id;
    let supply =
        tokio::spawn(async move { hms_db::pharmacy::dispense_fulfillment(&pool, command).await });
    wait_for_waiters(f.db.pool(), 2).await;
    held.commit().await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(3), round)
            .await
            .unwrap()
            .unwrap()
            .is_ok()
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(3), supply)
            .await
            .unwrap()
            .unwrap()
            .is_ok()
    );
}
