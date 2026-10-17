//! Durable placement evidence and canonical lifecycle repository contracts.
use chrono::{Duration, Utc};
use hms_db::{
    test_support::TestDb,
    ward::{self, admission_moves as moves},
};
use hms_domain::{deployment::DeploymentProfile, ward_moves::*};
use sha2::{Digest, Sha256};
use uuid::Uuid;
fn must<T, E>(v: Result<T, E>, message: &'static str) -> T {
    v.unwrap_or_else(|_| panic!("{message}"))
}
struct Fixture {
    db: TestDb,
    actor: moves::AdmissionMoveActor,
    patient: Uuid,
    case: Uuid,
    destination: Uuid,
}
impl Fixture {
    async fn new() -> Self {
        let db = must(
            TestDb::hospital().await,
            "isolated placement database starts",
        );
        let care = must(
            db.scenario("move-core-source")
                .admission_case_with_available_bed()
                .await,
            "real ready source exists",
        );
        let destination = must(
            db.scenario("move-core-destination")
                .ward_with_available_bed()
                .await,
            "real destination exists",
        );
        must(
            ward::activate_admission_case(
                db.pool(),
                db.facility_id(),
                care.admission.id,
                db.owner_user_id(),
            )
            .await,
            "canonical activation persists",
        )
        .expect("canonical activation returns actual episode");
        must(sqlx::query("INSERT INTO user_permissions(user_id,permission_code) VALUES($1,'ward_board.view_all') ON CONFLICT DO NOTHING").bind(db.owner_user_id()).execute(db.pool()).await,"explicit all-ward authority persists");
        must(sqlx::query("INSERT INTO user_patient_visibility(user_id,visibility) VALUES($1,'full_clinical'),($1,'demographics') ON CONFLICT DO NOTHING").bind(db.owner_user_id()).execute(db.pool()).await,"current Full and demographics persist");
        must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(db.facility_id()).bind(db.owner_user_id()).bind(care.patient.id).execute(db.pool()).await,"ordinary care relationship persists");
        let (sv, pv): (i64, i64) = must(
            sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
                .bind(db.owner_user_id())
                .fetch_one(db.pool())
                .await,
            "current actor versions load",
        );
        let session = Uuid::new_v4();
        let now = Utc::now();
        must(
            hms_db::auth::insert_refresh_session(
                db.pool(),
                &hms_db::auth::NewRefreshSession {
                    token_hash: Uuid::new_v4().to_string(),
                    session_id: session,
                    session_family_id: session,
                    rotated_from_session_id: None,
                    user_id: db.owner_user_id(),
                    facility_id: db.facility_id(),
                    session_version: sv,
                    permission_version_at_issue: pv,
                    csrf_token_hash: "synthetic-hash".into(),
                    expires_at: now + Duration::hours(1),
                    session_started_at: now,
                    idle_expires_at: now + Duration::hours(1),
                    absolute_expires_at: now + Duration::hours(1),
                    device_label: None,
                },
            )
            .await,
            "real actor session persists",
        );
        let actor = moves::AdmissionMoveActor {
            facility_id: db.facility_id(),
            user_id: db.owner_user_id(),
            request_id: None,
            authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
                session_id: session,
                session_version: sv,
                permission_version: pv,
                active_profile: DeploymentProfile::Hospital,
                valid_until: now + Duration::minutes(10),
                resolved_network_policy_version: Some(
                    must(
                        hms_db::network::get_policy(db.pool(), db.facility_id()).await,
                        "network publication loads",
                    )
                    .version,
                ),
            },
        };
        Self {
            db,
            actor,
            patient: care.patient.id,
            case: care.admission.id,
            destination: destination.bed.id,
        }
    }
    async fn context(&self) -> AdmissionPlacementContext {
        must(
            moves::context(self.db.pool(), self.actor.clone(), self.patient, self.case).await,
            "protected source context loads",
        )
    }
    async fn input(&self) -> AdmissionMoveRequest {
        let c = self.context().await;
        let candidates = must(
            moves::destinations(
                self.db.pool(),
                self.actor.clone(),
                self.patient,
                self.case,
                None,
                None,
                None,
                101,
            )
            .await,
            "bounded real destinations load",
        );
        let d = candidates
            .into_iter()
            .find(|v| v.0.labels.bed_id == self.destination)
            .expect("explicit selected destination exists")
            .0;
        AdmissionMoveRequest {
            client_request_id: Uuid::new_v4(),
            expected_placement_token: c.placement_token,
            destination_bed_id: self.destination,
            expected_destination_token: d.candidate_token,
            expected_task_membership_token: c
                .task_membership_token
                .expect("bounded membership token exists"),
            task_policy: AdmissionMoveTaskPolicy::RouteAllClearAssignees,
            reason: "Synthetic explicit reviewed movement".into(),
        }
    }
    async fn save(&self) -> AdmissionMoveReceipt {
        must(
            moves::move_admission(
                self.db.pool(),
                self.actor.clone(),
                self.patient,
                self.case,
                self.input().await,
            )
            .await,
            "real governed move commits",
        )
    }
}

#[tokio::test]
async fn canonical_activation_and_discharge_close_only_known_intervals_at_actual_lifecycle_clock() {
    let f = Fixture::new().await;
    let before = f.context().await;
    assert!(
        before
            .current_placement
            .as_ref()
            .is_some_and(|p| p.origin == AdmissionPlacementOrigin::Activation)
            && !before.placement_history_partial,
        "real activation creates known start rather than observation"
    );
    let saved = f.save().await;
    let dc=must(sqlx::query_scalar::<_,Uuid>("INSERT INTO discharge_cases(id,facility_id,admission_case_id,patient_id,status,created_by_user_id) VALUES(gen_random_uuid(),$1,$2,$3,'requested',$4) RETURNING id").bind(f.db.facility_id()).bind(f.case).bind(f.patient).bind(f.db.owner_user_id()).fetch_one(f.db.pool()).await,"actual pending discharge root inserts");
    // Canonical explicit overrides resolve each independent blocker for this isolated lifecycle test.
    for kind in [
        "open_nursing_tasks",
        "unverified_results",
        "pending_lab_orders",
        "discharge_summary",
        "nursing_release",
        "billing_clearance",
    ] {
        must(sqlx::query("INSERT INTO discharge_blocker_overrides(id,facility_id,discharge_case_id,blocker_type,reason,overridden_by_user_id,reauth_verified_at) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic lifecycle isolation',$4,clock_timestamp())").bind(f.db.facility_id()).bind(dc).bind(kind).bind(f.db.owner_user_id()).execute(f.db.pool()).await,"explicit isolated blocker control persists");
    }
    let result = must(
        ward::complete_discharge(f.db.pool(), f.db.facility_id(), dc).await,
        "canonical discharge completes",
    );
    assert!(
        result.is_some(),
        "actual discharge transition returns saved result"
    );
    let c = f.context().await;
    assert!(
        c.current_placement.is_none()
            && c.placement_revision == saved.movement.history.placement_revision + 1
            && c.admitted_at == before.admitted_at,
        "discharge closes known placement, advances revision and preserves original admission time"
    );
    let facts:(i64,i64,bool)=must(sqlx::query_as("SELECT count(*),count(*) FILTER(WHERE ended_at IS NULL),bool_and(ended_at>=started_at) FROM admission_placements WHERE admission_case_id=$1").bind(f.case).fetch_one(f.db.pool()).await,"closed actual interval facts load");
    assert_eq!(facts, (2, 0, true));
}

#[tokio::test]
async fn unledgered_service_route_or_assignee_change_cannot_commit_and_origin_coverage_cannot_be_rewritten(
) {
    let f = Fixture::new().await;
    let c = f.context().await;
    let task = Uuid::new_v4();
    must(sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,status,due_at,assigned_to_user_id) VALUES($1,$2,$3,$4,$5,'other','open',clock_timestamp(),$6)").bind(task).bind(f.db.facility_id()).bind(f.case).bind(f.patient).bind(c.ward_id).bind(f.actor.user_id).execute(f.db.pool()).await,"synthetic assigned work persists");
    let mut outcomes = vec![];
    for target in [true, false] {
        let mut tx = must(f.db.pool().begin().await, "invalid route probe begins");
        let changed=sqlx::query("UPDATE nursing_tasks SET service_ward_id=CASE WHEN $2 THEN (SELECT ward_id FROM beds WHERE id=$3) ELSE service_ward_id END,assigned_to_user_id=NULL,route_version=route_version+1 WHERE id=$1").bind(task).bind(target).bind(f.destination).execute(&mut *tx).await;
        outcomes.push(if changed.is_ok() {
            tx.commit().await.is_err()
        } else {
            let _ = tx.rollback().await;
            true
        });
    }
    let mut tx = must(f.db.pool().begin().await, "coverage rewrite probe begins");
    let rewrite=sqlx::query("UPDATE admission_cases SET placement_history_partial=true,placement_known_from=clock_timestamp() WHERE id=$1").bind(f.case).execute(&mut *tx).await;
    let denied = rewrite.is_err();
    must(tx.rollback().await, "invalid coverage probe rolls back");
    assert!(
        outcomes.into_iter().all(|v| v) && denied,
        "assignment/routing needs immutable event and established coverage is immutable"
    );
    let taskfacts: (i64, bool) = must(
        sqlx::query_as(
            "SELECT route_version,assigned_to_user_id IS NOT NULL FROM nursing_tasks WHERE id=$1",
        )
        .bind(task)
        .fetch_one(f.db.pool())
        .await,
        "unchanged source work facts load",
    );
    assert_eq!(taskfacts, (0, true));
}

#[tokio::test]
async fn command_commit_rejects_wrong_root_null_result_and_full_movement_or_review_mismatch() {
    let f = Fixture::new().await;
    let saved = f.save().await;
    let other = must(
        f.db.scenario("receipt-other-case")
            .admission_case_with_available_bed()
            .await,
        "different real root exists",
    );
    let mut results = vec![];
    for mode in 0..5 {
        let mut receipt = must(
            serde_json::to_value(&saved),
            "saved immutable receipt encodes",
        );
        let key = Uuid::new_v4();
        receipt["client_request_id"] = serde_json::json!(key);
        receipt["reviewed_input"]["client_request_id"] = serde_json::json!(key);
        if mode == 2 {
            receipt["movement"]["reason"] =
                serde_json::json!("Synthetic mismatched protected detail");
        }
        if mode == 3 {
            receipt["reviewed_input"]["destination_bed_id"] = serde_json::json!(Uuid::new_v4());
        }
        if mode == 4 {
            receipt["movement"] = serde_json::json!({"id":saved.movement.history.id,"patient_id":f.patient,"admission_case_id":f.case,"recorded_by_user_id":f.actor.user_id,"placement_revision":saved.movement.history.placement_revision});
        }
        let (patient, case) = if mode == 0 {
            (other.patient.id, other.admission.id)
        } else {
            (f.patient, f.case)
        };
        let digest = Sha256::digest(must(
            serde_json::to_vec(&receipt["reviewed_input"]),
            "reviewed input digest encodes",
        ))
        .to_vec();
        let mut tx = must(f.db.pool().begin().await, "invalid receipt probe begins");
        let inserted=sqlx::query("INSERT INTO admission_move_commands(facility_id,request_key_hash,patient_id,admission_case_id,actor_user_id,payload_digest,result_id,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(f.db.facility_id()).bind(Sha256::digest(key.as_bytes()).to_vec()).bind(patient).bind(case).bind(f.actor.user_id).bind(digest).bind(if mode==1{None}else{Some(saved.movement.history.id)}).bind(receipt).bind(saved.recorded_at).execute(&mut *tx).await;
        results.push(if inserted.is_ok() {
            tx.commit().await.is_err()
        } else {
            let _ = tx.rollback().await;
            true
        });
    }
    assert!(results.into_iter().all(|v|v),"deferred completion rejects wrong scope, missing result and altered/minimal movement or reviewed identity");
    let count: i64 = must(
        sqlx::query_scalar("SELECT count(*) FROM admission_move_commands")
            .fetch_one(f.db.pool())
            .await,
        "durable command count loads",
    );
    assert_eq!(count, 1, "only the real exact complete receipt survives");
}

#[tokio::test]
async fn defensive_receipt_projection_rejects_altered_body_even_with_valid_result_identity() {
    let f = Fixture::new().await;
    let saved = f.save().await;
    let key = Uuid::new_v4();
    let mut bad = must(serde_json::to_value(&saved), "saved typed receipt encodes");
    bad["client_request_id"] = serde_json::json!(key);
    bad["reviewed_input"]["client_request_id"] = serde_json::json!(key);
    bad["movement"]["reason"] = serde_json::json!("Synthetic imported mismatched detail");
    let digest = Sha256::digest(must(
        serde_json::to_vec(&bad["reviewed_input"]),
        "bad import reviewed digest encodes",
    ))
    .to_vec();
    let mut tx = must(
        f.db.pool().begin().await,
        "isolated deliberate corruption probe begins",
    );
    // This isolated database simulates preexisting corruption; normal writes keep the guard enabled.
    must(
        sqlx::query(
            "ALTER TABLE admission_move_commands DISABLE TRIGGER admission_move_command_complete",
        )
        .execute(&mut *tx)
        .await,
        "one isolated import guard disables for defensive seam",
    );
    must(sqlx::query("INSERT INTO admission_move_commands(facility_id,request_key_hash,patient_id,admission_case_id,actor_user_id,payload_digest,result_id,receipt,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(f.db.facility_id()).bind(Sha256::digest(key.as_bytes()).to_vec()).bind(f.patient).bind(f.case).bind(f.actor.user_id).bind(digest).bind(saved.movement.history.id).bind(bad).bind(saved.recorded_at).execute(&mut *tx).await,"deliberate isolated corrupt import persists");
    must(
        sqlx::query(
            "ALTER TABLE admission_move_commands ENABLE TRIGGER admission_move_command_complete",
        )
        .execute(&mut *tx)
        .await,
        "canonical guard reenables before import transaction commits",
    );
    must(tx.commit().await, "isolated corruption seam commits");
    let out = moves::receipt(f.db.pool(), f.actor.clone(), f.patient, f.case, key).await;
    assert!(
        out.is_err_and(|e| e.is::<moves::MoveError>()),
        "typed receipt projection compares the full immutable movement, not matching IDs alone"
    );
}

#[tokio::test]
async fn governed_move_commits_mixed_assigned_and_unassigned_task_evidence() {
    let f = Fixture::new().await;
    let c = f.context().await;
    must(sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,status,due_at,created_by_user_id,assigned_to_user_id) SELECT gen_random_uuid(),$1,$2,$3,$4,'other','open',clock_timestamp(),$5,CASE WHEN n=1 THEN $5 ELSE NULL END FROM generate_series(1,2) n").bind(f.db.facility_id()).bind(f.case).bind(f.patient).bind(c.ward_id).bind(f.actor.user_id).execute(f.db.pool()).await,"mixed assigned and unassigned source tasks persist");
    let out = moves::move_admission(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case,
        f.input().await,
    )
    .await;
    if let Err(error) = &out {
        // Bounded static diagnostics only: no arbitrary SQL error/body/identity text.
        let db = error
            .chain()
            .find_map(|cause| cause.downcast_ref::<sqlx::Error>())
            .and_then(|e| e.as_database_error());
        let code = db
            .as_ref()
            .and_then(|e| e.code())
            .map(|v| v.to_string())
            .unwrap_or_else(|| "none".into());
        let known = [
            "nursing_task_route_evidence_required",
            "nursing_task_route_scope_invalid",
            "admission_move_evidence_incomplete",
            "admission_move_command_incomplete",
            "admission_move_scope_invalid",
            "nursing_task_route_invalid",
            "nursing_task_origin_immutable",
        ]
        .into_iter()
        .find(|label| db.as_ref().is_some_and(|e| e.message() == *label))
        .unwrap_or("other");
        eprintln!("mixed_task_commit_sqlstate={code} known_guard={known}");
    }
    assert!(
        out.is_ok(),
        "a complete governed move commits all mixed task routing evidence atomically"
    );
    let saved = out.unwrap();
    assert!(
        saved.movement.task_result.open_task_count == 2
            && saved.movement.task_result.cleared_assignee_count == 1,
        "complete immutable counts match mixed source membership"
    );
}

#[tokio::test]
async fn migration_refuses_legacy_case_bed_foreign_ward_and_foreign_patient_tuples() {
    use std::borrow::Cow;
    let mut refused = vec![];
    for foreign_patient in [false, true] {
        let database = must(
            hms_db::test_support::TestDatabase::create(),
            "isolated historical database starts",
        );
        let pool = must(
            hms_db::connect(database.database_url()).await,
            "historical database connects",
        );
        let old = sqlx::migrate::Migrator {
            migrations: Cow::Owned(
                hms_db::migrate::MIGRATOR
                    .iter()
                    .filter(|m| m.version < 202610170025)
                    .cloned()
                    .collect(),
            ),
            ..sqlx::migrate::Migrator::DEFAULT
        };
        must(old.run(&pool).await, "real migrations through024 apply");
        must(
            hms_db::provision::provision_baseline(
                &pool,
                &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
            )
            .await,
            "historical isolated baseline provisions",
        );
        let facility: Uuid = must(
            sqlx::query_scalar("SELECT facility_id FROM users WHERE id=$1")
                .bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID))
                .fetch_one(&pool)
                .await,
            "historical facility loads",
        );
        let other = Uuid::new_v4();
        must(sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,$2,'Synthetic other facility','hospital')").bind(other).bind(format!("SYN-{}",other.simple())).execute(&pool).await,"foreign synthetic facility inserts");
        let patient = Uuid::new_v4();
        must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,'Synthetic','Legacy tuple','2000-01-01','other','active','registered','presumed_alive')").bind(patient).bind(if foreign_patient{other}else{facility}).bind(format!("SYN-{}",patient.simple())).execute(&pool).await,"legacy scoped patient inserts");
        let ward = Uuid::new_v4();
        must(sqlx::query("INSERT INTO wards(id,facility_id,code,name,status) VALUES($1,$2,$3,'Synthetic legacy ward','active')").bind(ward).bind(if foreign_patient{facility}else{other}).bind(format!("SYN-{}",ward.simple())).execute(&pool).await,"legacy scoped ward inserts");
        let bed = Uuid::new_v4();
        must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,bed_code,status) VALUES($1,$2,$3,'SYN-LEGACY-TUPLE','occupied')").bind(bed).bind(facility).bind(ward).execute(&pool).await,"old plain foreign keys permit mismatched imported bed ward tuple");
        must(sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,bed_id,status) VALUES(gen_random_uuid(),$1,$2,$3,$4,'admitted')").bind(facility).bind(patient).bind(ward).bind(bed).execute(&pool).await,"old plain foreign keys permit mismatched imported episode tuple");
        let outcome = hms_db::migrate::run(&pool).await;
        let is_refused = outcome.is_err();
        let untouched:bool=must(sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admission_placements')").fetch_one(&pool).await,"atomic migration refusal leaves no new placement ledger");
        refused.push((is_refused, untouched));
        pool.close().await;
    }
    eprintln!(
        "legacy_scoped_rollout_refused={:?}",
        refused.iter().map(|v| v.0).collect::<Vec<_>>()
    );
    assert!(refused.iter().all(|v|v.0&&v.1),"rollout rejects foreign ward and foreign patient evidence before creating placements, without inventing attribution");
}

#[tokio::test]
async fn governed_move_commits_one_and_five_hundred_tasks_with_bounded_repository_roundtrips() {
    use hms_observability::with_request_query_counter;
    let mut measured = vec![];
    for count in [1_i32, 500] {
        let f = Fixture::new().await;
        let c = f.context().await;
        must(sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,status,due_at,assigned_to_user_id) SELECT gen_random_uuid(),$1,$2,$3,$4,'other','open',clock_timestamp(),$5 FROM generate_series(1,$6)").bind(f.db.facility_id()).bind(f.case).bind(f.patient).bind(c.ward_id).bind(f.actor.user_id).bind(count).execute(f.db.pool()).await,"set-based complete reviewed work inserts");
        let input = f.input().await;
        let (result, queries) = with_request_query_counter(moves::move_admission(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case,
            input,
        ))
        .await;
        let saved = must(
            result,
            "complete governed bulk move commits with all deferred constraints enabled",
        );
        let events: i64 = must(
            sqlx::query_scalar(
                "SELECT count(*) FROM nursing_task_routes WHERE admission_case_id=$1",
            )
            .bind(f.case)
            .fetch_one(f.db.pool())
            .await,
            "committed immutable event count loads",
        );
        assert!(
            events == i64::from(count)
                && saved.movement.task_result.routed_task_count == events
                && saved.movement.task_result.cleared_assignee_count == events,
            "full command routes and clears complete1/500 membership with one durable event each"
        );
        measured.push(queries);
    }
    eprintln!("governed_move_observed_repository_roundtrips={measured:?}");
    assert!(measured[0]>20&&measured[0]==measured[1],"observed explicit repository statement roundtrips are constant1vs500; BEGIN/COMMIT and database-internal constraint work are excluded");
}

#[tokio::test]
async fn deferred_move_completion_rejects_missing_route_and_wrong_cleared_count_with_other_placement_facts_complete(
) {
    use serde_json::json;
    let f = Fixture::new().await;
    let c = f.context().await;
    let task = Uuid::new_v4();
    must(sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,status,due_at,assigned_to_user_id) VALUES($1,$2,$3,$4,$5,'other','open',clock_timestamp(),$6)").bind(task).bind(f.db.facility_id()).bind(f.case).bind(f.patient).bind(c.ward_id).bind(f.actor.user_id).execute(f.db.pool()).await,"one real reviewed assigned source task inserts");
    let source = c
        .current_placement
        .expect("real activation has exact known interval");
    let destination = must(
        moves::destinations(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case,
            None,
            None,
            None,
            101,
        )
        .await,
        "actual candidate list loads",
    )
    .into_iter()
    .find(|v| v.0.labels.bed_id == f.destination)
    .unwrap()
    .0
    .labels;
    let name: String = must(
        sqlx::query_scalar("SELECT display_name FROM users WHERE id=$1")
            .bind(f.actor.user_id)
            .fetch_one(f.db.pool())
            .await,
        "retained actor display snapshot loads",
    );
    let mut rejected = vec![];
    for missing in [true, false] {
        let mut tx = must(
            f.db.pool().begin().await,
            "isolated incomplete evidence transaction begins",
        );
        let at: chrono::DateTime<Utc> = must(
            sqlx::query_scalar("SELECT clock_timestamp()")
                .fetch_one(&mut *tx)
                .await,
            "single actual probe clock loads",
        );
        let id = Uuid::new_v4();
        let next = Uuid::new_v4();
        let revision = c.placement_revision + 1;
        let due = at + Duration::minutes(i64::from(c.source_cleaning_minutes));
        let cleared = if missing { 1_i32 } else { 0 };
        let detail = json!({"id":id,"patient_id":f.patient,"admission_case_id":f.case,"placement_revision":revision,"moved_at":at,"recorded_by_user_id":f.actor.user_id,"recorded_by_display_name":name,"source":source.labels,"destination":destination,"routed_task_count":1,"cleared_assignee_count":cleared,
   "episode":{"encounter_id":c.encounter_id,"visit_id":c.visit_id,"admitted_at":c.admitted_at,"status":c.status},"source_placement":source,"destination_placement":{"id":next,"placement_revision":revision,"labels":destination,"started_at":at,"origin":"move","legacy_unknown_prefix":false},"reason":"Synthetic deferred evidence probe","task_policy":"route_all_clear_assignees","task_result":{"open_task_count":1,"routed_task_count":1,"cleared_assignee_count":cleared},"source_bed_release":{"status":"cleaning","cleaning_minutes":c.source_cleaning_minutes,"cleaning_due_at":due},"placement_history_partial":false});
        must(sqlx::query("INSERT INTO admission_moves(id,facility_id,admission_case_id,patient_id,placement_revision,actor_user_id,actor_display_name,moved_at,source_ward_id,source_bed_id,destination_ward_id,destination_bed_id,reason,source_cleaning_minutes,source_cleaning_due_at,routed_task_count,cleared_assignee_count,reviewed_task_ids,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Synthetic deferred evidence probe',$13,$14,1,$15,$16,$17)").bind(id).bind(f.db.facility_id()).bind(f.case).bind(f.patient).bind(revision).bind(f.actor.user_id).bind(&name).bind(at).bind(c.ward_id).bind(c.bed_id).bind(destination.ward_id).bind(destination.bed_id).bind(c.source_cleaning_minutes).bind(due).bind(cleared).bind(vec![task]).bind(detail).execute(&mut *tx).await,"full scoped header passes immediate identity guards");
        must(sqlx::query("UPDATE admission_placements SET ended_at=$2,close_kind='move',closing_move_id=$3 WHERE id=$1").bind(source.id).bind(at).bind(id).execute(&mut *tx).await,"exact source interval closes");
        must(sqlx::query("INSERT INTO admission_placements(id,facility_id,admission_case_id,patient_id,ward_id,bed_id,placement_revision,started_at,origin,legacy_unknown_prefix,opening_move_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'move',false,$9)").bind(next).bind(f.db.facility_id()).bind(f.case).bind(f.patient).bind(destination.ward_id).bind(destination.bed_id).bind(revision).bind(at).bind(id).execute(&mut *tx).await,"exact destination interval opens");
        must(sqlx::query("UPDATE admission_cases SET ward_id=$2,bed_id=$3,placement_revision=$4,updated_at=$5 WHERE id=$1").bind(f.case).bind(destination.ward_id).bind(destination.bed_id).bind(revision).bind(at).execute(&mut *tx).await,"root has complete exact interval placement");
        must(sqlx::query("UPDATE beds SET status=CASE WHEN id=$1 THEN 'cleaning' ELSE 'occupied' END,cleaning_due_at=CASE WHEN id=$1 THEN $3 ELSE NULL END,updated_at=$4 WHERE id IN($1,$2)").bind(c.bed_id).bind(destination.bed_id).bind(due).bind(at).execute(&mut *tx).await,"both bed states match complete movement facts");
        must(sqlx::query("UPDATE nursing_tasks SET service_ward_id=$2,assigned_to_user_id=NULL,route_version=1,updated_at=$3 WHERE id=$1").bind(task).bind(destination.ward_id).bind(at).execute(&mut *tx).await,"real source work is routed pending deferred evidence");
        if !missing {
            must(sqlx::query("INSERT INTO nursing_task_routes(id,facility_id,task_id,admission_case_id,patient_id,move_id,route_version,origin_ward_id,from_service_ward_id,to_service_ward_id,from_assigned_to_user_id,to_assigned_to_user_id,routed_by_user_id,routed_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,1,$6,$6,$7,$8,NULL,$8,$9)").bind(f.db.facility_id()).bind(task).bind(f.case).bind(f.patient).bind(id).bind(c.ward_id).bind(destination.ward_id).bind(f.actor.user_id).bind(at).execute(&mut *tx).await,"scoped event records actual old assignment while header claims zero clears");
        }
        let err = tx.commit().await.err();
        let exact = err
            .as_ref()
            .and_then(|e| e.as_database_error())
            .is_some_and(|e| {
                e.code().as_deref() == Some("P0001")
                    && e.message() == "admission_move_evidence_incomplete"
            });
        rejected.push(exact);
    }
    assert!(rejected.into_iter().all(|v|v),"deferred complete guard rejects absent route evidence and wrong aggregate clear count with remaining placement tuple/time/body facts complete");
    let count: i64 = must(
        sqlx::query_scalar("SELECT count(*) FROM admission_moves WHERE admission_case_id=$1")
            .bind(f.case)
            .fetch_one(f.db.pool())
            .await,
        "failed complete probes leave no saved movement",
    );
    assert_eq!(count, 0);
}
