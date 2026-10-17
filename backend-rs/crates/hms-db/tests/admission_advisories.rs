use chrono::{Duration, Utc};
use hms_db::{test_support::TestDb, ward::admission_advisories::*};
use hms_domain::{admission_advisories::*, deployment::DeploymentProfile, ward::*};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    patient: Uuid,
    case_id: Uuid,
    ward: Uuid,
    actor: AdvisoryActor,
}
async fn actor(db: &TestDb, user: Uuid, patient: Uuid, all: bool) -> AdvisoryActor {
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
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(db.facility_id()).bind(user).bind(patient).execute(db.pool()).await.unwrap();
    AdvisoryActor {
        facility_id: db.facility_id(),
        user_id: user,
        request_id: None,
        authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
            resolved_network_policy_version: Some(
                hms_db::network::get_policy(db.pool(), db.facility_id())
                    .await
                    .unwrap()
                    .version,
            ),
            session_id: session,
            session_version: versions.0,
            permission_version: versions.1,
            active_profile: DeploymentProfile::Hospital,
            valid_until: now + Duration::minutes(15),
        },
        can_write: true,
        can_view_all_wards: all,
    }
}
impl Fixture {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let care = db
            .scenario("synthetic-advisory")
            .admission_case_with_available_bed()
            .await
            .unwrap();
        let actor = actor(&db, db.owner_user_id(), care.patient.id, true).await;
        Self {
            db,
            patient: care.patient.id,
            case_id: care.admission.id,
            ward: care.ward.id,
            actor,
        }
    }
    async fn context(&self) -> AdmissionAdvisoryContext {
        context(
            self.db.pool(),
            self.actor.clone(),
            self.patient,
            self.case_id,
        )
        .await
        .unwrap()
    }
    async fn input(&self, kind: AdmissionAdvisoryType) -> CreateAdmissionAdvisoryRequest {
        CreateAdmissionAdvisoryRequest {
            client_request_id: Uuid::new_v4(),
            expected_context_token: self.context().await.context_token,
            task_type: kind,
            notes: "Synthetic reviewed admission follow-up".into(),
        }
    }
    async fn create(&self, kind: AdmissionAdvisoryType) -> AdmissionAdvisoryReceipt {
        create(
            self.db.pool(),
            self.actor.clone(),
            self.patient,
            self.case_id,
            self.input(kind).await,
        )
        .await
        .unwrap()
    }
    async fn decision(
        &self,
        decision: AdmissionAdvisoryDecision,
        reason: Option<&str>,
    ) -> DecideAdmissionAdvisoryRequest {
        DecideAdmissionAdvisoryRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: 1,
            expected_context_token: self.context().await.context_token,
            decision,
            reason: reason.map(str::to_owned),
        }
    }
    fn closure(&self) -> AdmissionClosureActor {
        AdmissionClosureActor {
            facility_id: self.actor.facility_id,
            user_id: self.actor.user_id,
            request_id: None,
            authorization: self.actor.authorization.clone(),
        }
    }
    async fn counts(&self) -> (i64, i64, i64) {
        sqlx::query_as("SELECT (SELECT count(*) FROM admission_advisories),(SELECT count(*) FROM admission_advisory_commands),(SELECT count(*) FROM audit_events)").fetch_one(self.db.pool()).await.unwrap()
    }
    async fn discharge(&self) -> Uuid {
        hms_db::ward::activate_admission_case(
            self.db.pool(),
            self.actor.facility_id,
            self.case_id,
            self.actor.user_id,
        )
        .await
        .unwrap()
        .unwrap();
        let a = hms_db::ward::get_admission_context(
            self.db.pool(),
            self.actor.facility_id,
            self.case_id,
        )
        .await
        .unwrap()
        .unwrap();
        let d = hms_db::ward::request_discharge(
            self.db.pool(),
            Uuid::new_v4(),
            self.actor.facility_id,
            &a,
            None,
            None,
            self.actor.user_id,
        )
        .await
        .unwrap();
        for kind in [
            DischargeBlockerKind::DischargeSummary,
            DischargeBlockerKind::NursingRelease,
            DischargeBlockerKind::PharmacyClearance,
            DischargeBlockerKind::BillingClearance,
        ] {
            hms_db::ward::override_discharge_blocker(
                self.db.pool(),
                self.actor.facility_id,
                d.id,
                kind,
                "Synthetic explicit source blocker override".into(),
                self.actor.user_id,
                Utc::now(),
            )
            .await
            .unwrap()
            .unwrap();
        }
        d.id
    }
}
fn error(value: anyhow::Error, expected: AdvisoryError) {
    assert_eq!(value.downcast_ref::<AdvisoryError>(), Some(&expected));
}

#[tokio::test]
async fn all_eight_real_kinds_are_nonblocking_and_capture_actual_pre_activation_phase() {
    let f = Fixture::new().await;
    let before = f.context().await;
    assert_eq!(before.admission_status, AdmissionStatus::ReadyForActivation);
    assert!(before.can_create);
    let admitted_at: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT admitted_at FROM admission_cases WHERE id=$1")
            .bind(f.case_id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert!(admitted_at <= Utc::now());
    let mut ids = Vec::new();
    for kind in AdmissionAdvisoryType::ALL {
        let saved = f.create(kind).await;
        assert_eq!(
            saved.advisory.summary.phase,
            AdmissionAdvisoryPhase::PreActivation
        );
        assert_eq!(
            saved.advisory.summary.status,
            AdmissionAdvisoryStatus::Pending
        );
        assert_eq!(saved.advisory.summary.captured_ward_id, f.ward);
        assert!(!saved.advisory.summary.can_complete);
        ids.push(saved.advisory.summary.id);
    }
    let c = f.context().await;
    assert!(c.complete);
    assert_eq!(c.advisories.len(), 8);
    assert_eq!(c.counts_by_status.pending, 8);
    assert!(c.available_types.is_empty());
    assert!(!c.can_create);
    for (id, decision, reason) in [
        (ids[0], AdmissionAdvisoryDecision::Completed, None),
        (
            ids[1],
            AdmissionAdvisoryDecision::AcknowledgedUnresolved,
            Some("Synthetic issue remains unresolved"),
        ),
        (
            ids[2],
            AdmissionAdvisoryDecision::Cancelled,
            Some("Synthetic no longer required"),
        ),
    ] {
        let result = decide(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case_id,
            id,
            f.decision(decision, reason).await,
        )
        .await
        .unwrap();
        assert_eq!(
            result.advisory.decision.unwrap().source,
            AdmissionAdvisoryDecisionSource::Manual
        );
    }
    let c = f.context().await;
    assert_eq!(
        (
            c.counts_by_status.pending,
            c.counts_by_status.completed,
            c.counts_by_status.acknowledged_unresolved,
            c.counts_by_status.cancelled
        ),
        (5, 1, 1, 1)
    );
    let state: (String, Option<Uuid>) =
        sqlx::query_as("SELECT status,bed_id FROM admission_cases WHERE id=$1")
            .bind(f.case_id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(state, ("ready_for_activation".into(), None));
    let active = hms_db::ward::activate_admission_case(
        f.db.pool(),
        f.actor.facility_id,
        f.case_id,
        f.actor.user_id,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(active.status, AdmissionStatus::Admitted);
    assert_eq!(
        get(f.db.pool(), f.actor.clone(), f.patient, f.case_id, ids[3])
            .await
            .unwrap()
            .summary
            .phase,
        AdmissionAdvisoryPhase::PreActivation
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM nursing_tasks WHERE admission_case_id=$1"
        )
        .bind(f.case_id)
        .fetch_one(f.db.pool())
        .await
        .unwrap(),
        0
    );
}

#[tokio::test]
async fn exact_requests_recover_original_evidence_and_unique_kind_cannot_reopen() {
    let f = Fixture::new().await;
    let input = f.input(AdmissionAdvisoryType::PharmacyMedRec).await;
    let saved = create(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        input.clone(),
    )
    .await
    .unwrap();
    let before = f.counts().await;
    assert!(
        create(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case_id,
            input.clone()
        )
        .await
        .unwrap()
        .replayed
    );
    assert_eq!(f.counts().await, before);
    let mut duplicate = input.clone();
    duplicate.client_request_id = Uuid::new_v4();
    error(
        create(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case_id,
            duplicate,
        )
        .await
        .unwrap_err(),
        AdvisoryError::TypeExists,
    );
    let mut changed = input.clone();
    changed.notes = "Synthetic different intent".into();
    error(
        create(f.db.pool(), f.actor.clone(), f.patient, f.case_id, changed)
            .await
            .unwrap_err(),
        AdvisoryError::RequestConflict,
    );
    let decision = f.decision(AdmissionAdvisoryDecision::Completed, None).await;
    let done = decide(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        saved.advisory.summary.id,
        decision.clone(),
    )
    .await
    .unwrap();
    assert_eq!(done.advisory.summary.version, 2);
    assert!(done.advisory.decision.as_ref().unwrap().reason.is_none());
    let after = f.counts().await;
    assert!(
        decide(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case_id,
            saved.advisory.summary.id,
            decision.clone()
        )
        .await
        .unwrap()
        .replayed
    );
    assert_eq!(f.counts().await, after);
    let other = f.decision(AdmissionAdvisoryDecision::Completed, None).await;
    error(
        decide(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case_id,
            saved.advisory.summary.id,
            other,
        )
        .await
        .unwrap_err(),
        AdvisoryError::Terminal,
    );
    let old = receipt(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        input.client_request_id,
    )
    .await
    .unwrap();
    assert_eq!(
        old.advisory.summary.status,
        AdmissionAdvisoryStatus::Pending
    );
    assert_eq!(old.advisory.summary.version, 1);
    assert!(sqlx::query(
        "UPDATE admission_advisories SET decision_reason='Synthetic overwrite' WHERE id=$1"
    )
    .bind(saved.advisory.summary.id)
    .execute(f.db.pool())
    .await
    .is_err());
    assert!(sqlx::query("DELETE FROM admission_advisories WHERE id=$1")
        .bind(saved.advisory.summary.id)
        .execute(f.db.pool())
        .await
        .is_err());
    assert!(
        sqlx::query("UPDATE admission_advisory_commands SET operation='decided'")
            .execute(f.db.pool())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn one_terminal_cas_wins_and_manual_unresolved_or_cancel_require_explicit_reason() {
    let f = Fixture::new().await;
    let saved = f.create(AdmissionAdvisoryType::Other).await;
    let id = saved.advisory.summary.id;
    let before = f.counts().await;
    for kind in [
        AdmissionAdvisoryDecision::AcknowledgedUnresolved,
        AdmissionAdvisoryDecision::Cancelled,
    ] {
        error(
            decide(
                f.db.pool(),
                f.actor.clone(),
                f.patient,
                f.case_id,
                id,
                f.decision(kind, None).await,
            )
            .await
            .unwrap_err(),
            AdvisoryError::InvalidInput,
        );
    }
    assert_eq!(f.counts().await, before);
    let a = f.decision(AdmissionAdvisoryDecision::Completed, None).await;
    let b = f
        .decision(
            AdmissionAdvisoryDecision::AcknowledgedUnresolved,
            Some("Synthetic unresolved decision"),
        )
        .await;
    let (a, b) = tokio::join!(
        decide(f.db.pool(), f.actor.clone(), f.patient, f.case_id, id, a),
        decide(f.db.pool(), f.actor.clone(), f.patient, f.case_id, id, b)
    );
    assert_ne!(a.is_ok(), b.is_ok());
    let current = get(f.db.pool(), f.actor.clone(), f.patient, f.case_id, id)
        .await
        .unwrap();
    assert_eq!(current.summary.version, 2);
    assert!(current.decision.is_some());
    assert!(!current.summary.can_complete);
}

#[tokio::test]
async fn canonical_cancel_retires_only_pending_with_real_system_actor_and_preserved_history() {
    let f = Fixture::new().await;
    let pending = f.create(AdmissionAdvisoryType::Transport).await;
    let completed = f.create(AdmissionAdvisoryType::Documents).await;
    let unresolved = f.create(AdmissionAdvisoryType::Other).await;
    let done = decide(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        completed.advisory.summary.id,
        f.decision(AdmissionAdvisoryDecision::Completed, None).await,
    )
    .await
    .unwrap();
    let ack = decide(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        unresolved.advisory.summary.id,
        f.decision(
            AdmissionAdvisoryDecision::AcknowledgedUnresolved,
            Some("Synthetic unresolved follow-up"),
        )
        .await,
    )
    .await
    .unwrap();
    let cancelled =
        hms_db::ward::cancel_admission_case_authorized(f.db.pool(), f.closure(), f.case_id)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(cancelled.status, AdmissionStatus::Cancelled);
    let current = get(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        pending.advisory.summary.id,
    )
    .await
    .unwrap();
    let d = current.decision.unwrap();
    assert_eq!(d.status, AdmissionAdvisoryStatus::Cancelled);
    assert_eq!(
        d.source,
        AdmissionAdvisoryDecisionSource::AdmissionCaseCancelled
    );
    assert_eq!(
        d.system_reason_code,
        Some(AdmissionAdvisorySystemReason::AdmissionCaseCancelled)
    );
    assert_eq!(d.recorded_by_user_id, f.actor.user_id);
    assert!(d.reason.is_none());
    assert_eq!(
        serde_json::to_value(
            get(
                f.db.pool(),
                f.actor.clone(),
                f.patient,
                f.case_id,
                completed.advisory.summary.id
            )
            .await
            .unwrap()
            .decision
        )
        .unwrap(),
        serde_json::to_value(done.advisory.decision).unwrap()
    );
    assert_eq!(
        serde_json::to_value(
            get(
                f.db.pool(),
                f.actor.clone(),
                f.patient,
                f.case_id,
                unresolved.advisory.summary.id
            )
            .await
            .unwrap()
            .decision
        )
        .unwrap(),
        serde_json::to_value(ack.advisory.decision).unwrap()
    );
    assert!(create(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        f.input(AdmissionAdvisoryType::Dietary).await
    )
    .await
    .is_err());
    let original = receipt(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        pending.client_request_id,
    )
    .await
    .unwrap();
    assert_eq!(
        original.advisory.summary.status,
        AdmissionAdvisoryStatus::Pending
    );
}

#[tokio::test]
async fn pending_followup_does_not_block_discharge_and_actorless_completion_cannot_invent_evidence()
{
    let f = Fixture::new().await;
    let pending = f.create(AdmissionAdvisoryType::PharmacyMedRec).await;
    let d = f.discharge().await;
    let before = f.counts().await;
    error(
        hms_db::ward::complete_discharge(f.db.pool(), f.actor.facility_id, d)
            .await
            .unwrap_err(),
        AdvisoryError::AuthorityExpired,
    );
    assert_eq!(f.counts().await, before);
    let status: String = sqlx::query_scalar("SELECT status FROM admission_cases WHERE id=$1")
        .bind(f.case_id)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(status, "discharge_pending");
    let completed = hms_db::ward::complete_discharge_authorized(f.db.pool(), f.closure(), d)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(completed.status, DischargeStatus::Completed);
    let item = get(
        f.db.pool(),
        f.actor.clone(),
        f.patient,
        f.case_id,
        pending.advisory.summary.id,
    )
    .await
    .unwrap();
    assert_eq!(item.summary.status, AdmissionAdvisoryStatus::Cancelled);
    let event = item.decision.unwrap();
    assert_eq!(
        event.source,
        AdmissionAdvisoryDecisionSource::AdmissionDischarged
    );
    assert_eq!(
        event.system_reason_code,
        Some(AdmissionAdvisorySystemReason::AdmissionDischarged)
    );
    assert_eq!(event.recorded_by_user_id, f.actor.user_id);
}

#[tokio::test]
async fn audit_failure_rolls_back_advisory_and_both_canonical_closure_outcomes() {
    for discharge in [false, true] {
        let f = Fixture::new().await;
        let item = f.create(AdmissionAdvisoryType::InfectionControl).await;
        let d = if discharge {
            Some(f.discharge().await)
        } else {
            None
        };
        let before = f.counts().await;
        let state: (String, Option<Uuid>) =
            sqlx::query_as("SELECT status,bed_id FROM admission_cases WHERE id=$1")
                .bind(f.case_id)
                .fetch_one(f.db.pool())
                .await
                .unwrap();
        sqlx::raw_sql("CREATE FUNCTION reject_advisory_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admission_advisory.retired' THEN RAISE EXCEPTION 'synthetic audit refusal'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_advisory_retirement BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_advisory_retirement();").execute(f.db.pool()).await.unwrap();
        if let Some(d) = d {
            assert!(
                hms_db::ward::complete_discharge_authorized(f.db.pool(), f.closure(), d)
                    .await
                    .is_err()
            );
        } else {
            assert!(hms_db::ward::cancel_admission_case_authorized(
                f.db.pool(),
                f.closure(),
                f.case_id
            )
            .await
            .is_err());
        }
        assert_eq!(f.counts().await, before);
        assert_eq!(
            get(
                f.db.pool(),
                f.actor.clone(),
                f.patient,
                f.case_id,
                item.advisory.summary.id
            )
            .await
            .unwrap()
            .summary
            .status,
            AdmissionAdvisoryStatus::Pending
        );
        assert_eq!(
            sqlx::query_as::<_, (String, Option<Uuid>)>(
                "SELECT status,bed_id FROM admission_cases WHERE id=$1"
            )
            .bind(f.case_id)
            .fetch_one(f.db.pool())
            .await
            .unwrap(),
            state
        );
    }
}

async fn wait_for_waiters(pool: &hms_db::PgPool, minimum: i64) {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0")
                .fetch_one(pool).await.unwrap();
            if count >= minimum { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("both commands must actually wait on database locks");
}

#[tokio::test]
async fn manual_decision_and_both_canonical_closures_serialize_in_both_orders() {
    for discharge in [false, true] {
        for manual_first in [false, true] {
            let f = Fixture::new().await;
            let selected = f.create(AdmissionAdvisoryType::PharmacyMedRec).await;
            let other = f.create(AdmissionAdvisoryType::Documents).await;
            let discharge_id = if discharge {
                Some(f.discharge().await)
            } else {
                None
            };
            let decision = f.decision(AdmissionAdvisoryDecision::Completed, None).await;
            let event = if manual_first {
                "admission_advisory.decided"
            } else {
                "admission_advisory.retired"
            };
            sqlx::raw_sql(&format!("CREATE FUNCTION pause_advisory_closure_race() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='{event}' THEN PERFORM pg_advisory_xact_lock(731911); END IF; RETURN NEW; END; $$; CREATE TRIGGER pause_advisory_closure_race BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION pause_advisory_closure_race();")).execute(f.db.pool()).await.unwrap();
            let mut held = f.db.pool().begin().await.unwrap();
            sqlx::query("SELECT pg_advisory_xact_lock(731911)")
                .execute(&mut *held)
                .await
                .unwrap();
            let pool = f.db.pool().clone();
            let actor = f.actor.clone();
            let patient = f.patient;
            let case = f.case_id;
            let id = selected.advisory.summary.id;
            let manual = async move { decide(&pool, actor, patient, case, id, decision).await };
            let pool = f.db.pool().clone();
            let actor = f.closure();
            let closure = async move {
                if let Some(d) = discharge_id {
                    hms_db::ward::complete_discharge_authorized(&pool, actor, d)
                        .await
                        .map(|v| v.is_some())
                } else {
                    hms_db::ward::cancel_admission_case_authorized(&pool, actor, case)
                        .await
                        .map(|v| v.is_some())
                }
            };
            let (manual, closure) = if manual_first {
                let manual = tokio::spawn(manual);
                wait_for_waiters(f.db.pool(), 1).await;
                let closure = tokio::spawn(closure);
                wait_for_waiters(f.db.pool(), 2).await;
                (manual, closure)
            } else {
                let closure = tokio::spawn(closure);
                wait_for_waiters(f.db.pool(), 1).await;
                let manual = tokio::spawn(manual);
                wait_for_waiters(f.db.pool(), 2).await;
                (manual, closure)
            };
            held.commit().await.unwrap();
            let manual = tokio::time::timeout(std::time::Duration::from_secs(3), manual)
                .await
                .unwrap()
                .unwrap();
            let closure = tokio::time::timeout(std::time::Duration::from_secs(3), closure)
                .await
                .unwrap()
                .unwrap();
            assert!(closure.unwrap());
            assert_eq!(manual.is_ok(), manual_first);
            if let Err(e) = manual.as_ref() {
                assert_eq!(
                    e.downcast_ref::<AdvisoryError>(),
                    Some(&AdvisoryError::ContextChanged)
                );
            }
            let current = get(f.db.pool(), f.actor.clone(), patient, case, id)
                .await
                .unwrap();
            let actual = current.decision.unwrap();
            assert_eq!(
                actual.status,
                if manual_first {
                    AdmissionAdvisoryStatus::Completed
                } else {
                    AdmissionAdvisoryStatus::Cancelled
                }
            );
            let system_source = if discharge {
                AdmissionAdvisoryDecisionSource::AdmissionDischarged
            } else {
                AdmissionAdvisoryDecisionSource::AdmissionCaseCancelled
            };
            assert_eq!(
                actual.source,
                if manual_first {
                    AdmissionAdvisoryDecisionSource::Manual
                } else {
                    system_source
                }
            );
            if let Ok(original) = manual {
                assert_eq!(
                    serde_json::to_value(original.advisory.decision).unwrap(),
                    serde_json::to_value(&actual).unwrap()
                );
            }
            let retired = get(
                f.db.pool(),
                f.actor.clone(),
                patient,
                case,
                other.advisory.summary.id,
            )
            .await
            .unwrap();
            assert_eq!(retired.decision.unwrap().source, system_source);
            let counts: (i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM admission_advisory_commands WHERE operation='decided'),(SELECT count(*) FROM audit_events WHERE event_type='admission_advisory.retired')").fetch_one(f.db.pool()).await.unwrap();
            assert_eq!(counts, if manual_first { (1, 1) } else { (0, 2) });
        }
    }
}

async fn assigned_actor(f: &Fixture, ward: Uuid) -> (AdvisoryActor, Uuid) {
    let user = Uuid::new_v4();
    let staff = Uuid::new_v4();
    let practitioner = Uuid::new_v4();
    let assignment = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,$2,$3,'Synthetic assigned clinician',password_hash FROM users WHERE id=$4").bind(user).bind(f.actor.facility_id).bind(format!("advisory-{user}@hms.local")).bind(f.actor.user_id).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES($1,$2,$3,$4,'Synthetic ward','Clinician',CURRENT_DATE)").bind(staff).bind(f.actor.facility_id).bind(user).bind(format!("A-{user}")).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES($1,$2,$3,$4,'Synthetic','Synthetic qualification')").bind(practitioner).bind(f.actor.facility_id).bind(staff).bind(format!("L-{user}")).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES($1,$2,$3,$4,'medical_officer','Medical officer','medical')").bind(assignment).bind(f.actor.facility_id).bind(ward).bind(practitioner).execute(f.db.pool()).await.unwrap();
    (actor(&f.db, user, f.patient, false).await, assignment)
}

#[tokio::test]
async fn actual_current_ward_filters_before_limit_and_transfer_preserves_creation_ward() {
    let f = Fixture::new().await;
    let selected = f.create(AdmissionAdvisoryType::SocialWork).await;
    let other_ward = Uuid::new_v4();
    sqlx::query("INSERT INTO wards(id,facility_id,code,name,status) VALUES($1,$2,'SYNTHETIC-OTHER','Synthetic other ward','active')").bind(other_ward).bind(f.actor.facility_id).execute(f.db.pool()).await.unwrap();
    let (assigned, assignment) = assigned_actor(&f, f.ward).await;
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,'cancelled',clock_timestamp()+n*interval '1 second' FROM generate_series(1,125) n").bind(f.actor.facility_id).bind(f.patient).bind(other_ward).execute(f.db.pool()).await.unwrap();
    let q = AdmissionAdvisoryCaseQuery {
        include_closed: Some(true),
        ..Default::default()
    };
    let rows = list_cases(f.db.pool(), assigned.clone(), f.patient, q.clone(), None, 2)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].admission_case_id, f.case_id);
    let old_context = context(f.db.pool(), assigned.clone(), f.patient, f.case_id)
        .await
        .unwrap();
    sqlx::query("UPDATE admission_cases SET ward_id=$2,updated_at=clock_timestamp() WHERE id=$1")
        .bind(f.case_id)
        .bind(other_ward)
        .execute(f.db.pool())
        .await
        .unwrap();
    error(
        get(
            f.db.pool(),
            assigned.clone(),
            f.patient,
            f.case_id,
            selected.advisory.summary.id,
        )
        .await
        .unwrap_err(),
        AdvisoryError::WardDenied,
    );
    assert!(
        list_cases(f.db.pool(), assigned.clone(), f.patient, q.clone(), None, 2)
            .await
            .unwrap()
            .is_empty()
    );
    sqlx::query("UPDATE ward_staff_assignments SET ward_id=$2 WHERE id=$1")
        .bind(assignment)
        .bind(other_ward)
        .execute(f.db.pool())
        .await
        .unwrap();
    let current = context(f.db.pool(), assigned.clone(), f.patient, f.case_id)
        .await
        .unwrap();
    assert_ne!(current.context_token, old_context.context_token);
    let mut input = f
        .decision(
            AdmissionAdvisoryDecision::AcknowledgedUnresolved,
            Some("Synthetic issue remains unresolved after transfer"),
        )
        .await;
    input.expected_context_token = old_context.context_token;
    let before = f.counts().await;
    error(
        decide(
            f.db.pool(),
            assigned.clone(),
            f.patient,
            f.case_id,
            selected.advisory.summary.id,
            input.clone(),
        )
        .await
        .unwrap_err(),
        AdvisoryError::ContextChanged,
    );
    assert_eq!(f.counts().await, before);
    input.expected_context_token = current.context_token;
    let result = decide(
        f.db.pool(),
        assigned.clone(),
        f.patient,
        f.case_id,
        selected.advisory.summary.id,
        input,
    )
    .await
    .unwrap();
    assert_eq!(result.advisory.summary.captured_ward_id, f.ward);
    assert_eq!(
        result.advisory.decision.as_ref().unwrap().ward_id,
        other_ward
    );
    assert_eq!(
        result
            .advisory
            .decision
            .as_ref()
            .unwrap()
            .recorded_by_user_id,
        assigned.user_id
    );
    let first = list_cases(f.db.pool(), assigned.clone(), f.patient, q.clone(), None, 2)
        .await
        .unwrap();
    assert_eq!(first.len(), 2);
    let last = first.last().unwrap();
    let second = list_cases(
        f.db.pool(),
        assigned,
        f.patient,
        q,
        Some(AdvisoryCaseCursor {
            created_at: last.created_at,
            id: last.admission_case_id,
        }),
        2,
    )
    .await
    .unwrap();
    assert_eq!(second.len(), 2);
    assert!(second.iter().all(|r| !first
        .iter()
        .any(|a| a.admission_case_id == r.admission_case_id)));
}

#[tokio::test]
async fn context_token_fences_bed_changes_even_without_legacy_updated_at_bump() {
    let f = Fixture::new().await;
    let selected = f.create(AdmissionAdvisoryType::Other).await;
    let input = f.input(AdmissionAdvisoryType::Dietary).await;
    let decision = f.decision(AdmissionAdvisoryDecision::Completed, None).await;
    let before = f.counts().await;
    let at: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT updated_at FROM admission_cases WHERE id=$1")
            .bind(f.case_id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    sqlx::query("UPDATE admission_cases SET bed_id=(SELECT id FROM beds WHERE facility_id=$2 AND ward_id=$3 ORDER BY id LIMIT 1) WHERE id=$1").bind(f.case_id).bind(f.actor.facility_id).bind(f.ward).execute(f.db.pool()).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
            "SELECT updated_at FROM admission_cases WHERE id=$1"
        )
        .bind(f.case_id)
        .fetch_one(f.db.pool())
        .await
        .unwrap(),
        at
    );
    let current = f.context().await;
    assert_ne!(current.context_token, input.expected_context_token);
    error(
        create(f.db.pool(), f.actor.clone(), f.patient, f.case_id, input)
            .await
            .unwrap_err(),
        AdvisoryError::ContextChanged,
    );
    error(
        decide(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case_id,
            selected.advisory.summary.id,
            decision,
        )
        .await
        .unwrap_err(),
        AdvisoryError::ContextChanged,
    );
    assert_eq!(f.counts().await, before);
    assert_eq!(
        get(
            f.db.pool(),
            f.actor.clone(),
            f.patient,
            f.case_id,
            selected.advisory.summary.id
        )
        .await
        .unwrap()
        .summary
        .status,
        AdmissionAdvisoryStatus::Pending
    );
}

#[tokio::test]
async fn case_waiting_list_does_not_pin_facility_ahead_of_source_parent_and_feature_writer() {
    let f = Fixture::new().await;
    // A source command holds its admission parent before requesting live actor
    // proof. A list waiting for this parent must not already pin the facility.
    let mut source = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT id FROM admission_cases WHERE id=$1 FOR UPDATE")
        .bind(f.case_id)
        .execute(&mut *source)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let reader = f.actor.clone();
    let patient = f.patient;
    let mut list = tokio::spawn(async move {
        list_cases(
            &pool,
            reader,
            patient,
            AdmissionAdvisoryCaseQuery::default(),
            None,
            2,
        )
        .await
    });
    wait_for_waiters(f.db.pool(), 1).await;
    let pool = f.db.pool().clone();
    let facility = f.actor.facility_id;
    let user = f.actor.user_id;
    let mut publication = tokio::spawn(async move {
        hms_db::admin::update_feature_entitlement(
            &pool,
            facility,
            hms_domain::deployment::FeatureKey::Admissions,
            false,
            user,
            None,
        )
        .await
    });
    let published = tokio::time::timeout(std::time::Duration::from_secs(2), &mut publication).await;
    if published.is_err() {
        list.abort();
        publication.abort();
        source.rollback().await.unwrap();
        panic!("a parent-waiting list must not block the facility feature writer");
    }
    assert!(published.unwrap().unwrap().unwrap().is_some());
    // The original parent writer can now obtain its normal proof lock, so no
    // case -> facility -> case queue cycle exists.
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR SHARE")
        .bind(facility)
        .execute(&mut *source)
        .await
        .unwrap();
    source.commit().await.unwrap();
    let result = tokio::time::timeout(std::time::Duration::from_secs(2), &mut list)
        .await
        .unwrap()
        .unwrap();
    error(result.unwrap_err(), AdvisoryError::FeatureDisabled);
}
