use chrono::{Duration, Utc};
use hms_db::{
    test_support::TestDb,
    ward::{patient_handover::*, WardCursor},
};
use hms_domain::{deployment::DeploymentProfile, patient_handover::*};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    patient: Uuid,
    admission: Uuid,
    ward: Uuid,
    actor: HandoverActor,
}
async fn actor(db: &TestDb, user: Uuid) -> HandoverActor {
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
    HandoverActor {
        facility_id: db.facility_id(),
        user_id: user,
        request_id: None,
        session_id: session,
        session_version: versions.0,
        permission_version: versions.1,
        active_profile: DeploymentProfile::Hospital,
        valid_until: now + Duration::minutes(15),
        can_view_all_wards: true,
    }
}
impl Fixture {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let a = db
            .scenario("synthetic-patient-handover")
            .admission_case_with_available_bed()
            .await
            .unwrap();
        sqlx::query("UPDATE admission_cases SET status='admitted' WHERE id=$1")
            .bind(a.admission.id)
            .execute(db.pool())
            .await
            .unwrap();
        let actor = actor(&db, db.owner_user_id()).await;
        Self {
            db,
            patient: a.patient.id,
            admission: a.admission.id,
            ward: a.ward.id,
            actor,
        }
    }
    fn input(&self) -> CreatePatientHandoverRequest {
        CreatePatientHandoverRequest {
            client_request_id: Uuid::new_v4(),
            patient_id: self.patient,
            admission_case_id: self.admission,
            shift_date: Utc::now().date_naive(),
            shift_type: HandoverShift::Night,
            intended_recipient_user_id: None,
            narrative: narrative(),
        }
    }
    async fn create(&self) -> PatientHandoverReceipt {
        create(self.db.pool(), self.actor.clone(), self.input())
            .await
            .unwrap()
    }
    fn amendment(&self, r: &PatientHandoverReceipt) -> AmendPatientHandoverRequest {
        AmendPatientHandoverRequest {
            client_request_id: Uuid::new_v4(),
            expected_revision: r.handover.header.revision,
            shift_date: r.handover.current.shift_date,
            shift_type: HandoverShift::Evening,
            intended_recipient_user_id: r.handover.current.intended_recipient_user_id,
            narrative: HandoverNarrative {
                patient_condition: "Synthetic amended condition".into(),
                ..narrative()
            },
            reason: "Synthetic correction rationale".into(),
        }
    }
}
fn narrative() -> HandoverNarrative {
    HandoverNarrative {
        patient_condition: "Synthetic patient condition".into(),
        ongoing_issues: "Synthetic ongoing issues".into(),
        pending_tasks: "Synthetic narrative tasks, not task orders".into(),
        medication_changes: "Synthetic medication narrative, not a prescription".into(),
        key_events: "Synthetic events".into(),
        care_plan_updates: "Synthetic care plan".into(),
        family_updates: "Synthetic family update".into(),
    }
}
fn query(p: Uuid, a: Option<Uuid>, closed: bool) -> PatientHandoverListQuery {
    PatientHandoverListQuery {
        patient_id: p,
        admission_case_id: a,
        shift_date: None,
        include_voided: Some(closed),
        cursor: None,
        limit: Some(25),
    }
}

#[tokio::test]
async fn exact_receipts_and_append_only_history_survive_discharge_amendment_and_void() {
    let f = Fixture::new().await;
    let command = f.input();
    let saved = create(f.db.pool(), f.actor.clone(), command.clone())
        .await
        .unwrap();
    assert_eq!(saved.handover.current.narrative, narrative());
    assert_eq!(saved.handover.header.author_user_id, f.actor.user_id);
    let serialized = serde_json::to_value(
        list(
            f.db.pool(),
            f.actor.facility_id,
            &query(f.patient, None, false),
            None,
            None,
            25,
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert!(serialized[0].get("narrative").is_none());
    assert!(!serialized
        .to_string()
        .contains("Synthetic patient condition"));
    sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
        .bind(f.admission)
        .execute(f.db.pool())
        .await
        .unwrap();
    let replay = create(f.db.pool(), f.actor.clone(), command.clone())
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(
        serde_json::to_value(&saved.handover).unwrap(),
        serde_json::to_value(&replay.handover).unwrap()
    );
    assert_eq!(
        create(f.db.pool(), f.actor.clone(), f.input())
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&HandoverError::InvalidContext)
    );
    let amended = amend(
        f.db.pool(),
        f.actor.clone(),
        saved.handover.header.id,
        f.amendment(&saved),
    )
    .await
    .unwrap();
    assert_eq!(amended.handover.header.revision, 2);
    let void_command = VoidPatientHandoverRequest {
        client_request_id: Uuid::new_v4(),
        expected_revision: 2,
        reason: "Synthetic duplicate record".into(),
    };
    let voided = void(
        f.db.pool(),
        f.actor.clone(),
        saved.handover.header.id,
        void_command.clone(),
    )
    .await
    .unwrap();
    assert_eq!(voided.handover.header.status, PatientHandoverStatus::Voided);
    let replayed_void = void(
        f.db.pool(),
        f.actor.clone(),
        saved.handover.header.id,
        void_command,
    )
    .await
    .unwrap();
    assert_eq!(
        replayed_void.handover.current.id,
        voided.handover.current.id
    );
    let old = receipt(
        f.db.pool(),
        f.actor.facility_id,
        f.patient,
        f.actor.user_id,
        command.client_request_id,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(old.handover.header.revision, 1);
    assert_eq!(old.handover.header.status, PatientHandoverStatus::Recorded);
    assert!(list(
        f.db.pool(),
        f.actor.facility_id,
        &query(f.patient, None, false),
        None,
        None,
        25
    )
    .await
    .unwrap()
    .is_empty());
    assert_eq!(
        list(
            f.db.pool(),
            f.actor.facility_id,
            &query(f.patient, None, true),
            None,
            None,
            25
        )
        .await
        .unwrap()
        .len(),
        1
    );
    let versions = history(
        f.db.pool(),
        f.actor.facility_id,
        saved.handover.header.id,
        None,
        25,
    )
    .await
    .unwrap();
    assert_eq!(versions.len(), 3);
    let original = get_revision(
        f.db.pool(),
        f.actor.facility_id,
        saved.handover.header.id,
        versions.last().unwrap().id,
    )
    .await
    .unwrap();
    assert_eq!(original.narrative, narrative());
    assert!(sqlx::query(
        "UPDATE patient_handover_revisions SET patient_condition='overwrite' WHERE id=$1"
    )
    .bind(original.id)
    .execute(f.db.pool())
    .await
    .is_err());
    assert!(
        sqlx::query("DELETE FROM patient_handover_commands WHERE facility_id=$1")
            .bind(f.actor.facility_id)
            .execute(f.db.pool())
            .await
            .is_err()
    );
    let headers: i64 = sqlx::query_scalar("SELECT count(*) FROM handoffs")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(headers, 0);
}

#[tokio::test]
async fn concurrent_create_replays_once_and_expected_revision_serializes_competing_edits() {
    let f = Fixture::new().await;
    let input = f.input();
    let mut tasks = vec![];
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(8));
    for _ in 0..8 {
        let pool = f.db.pool().clone();
        let actor = f.actor.clone();
        let input = input.clone();
        let barrier = barrier.clone();
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            create(&pool, actor, input).await.unwrap()
        }));
    }
    let mut receipts = vec![];
    for t in tasks {
        receipts.push(t.await.unwrap());
    }
    let id = receipts[0].handover.header.id;
    assert!(receipts.iter().all(|r| r.handover.header.id == id));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE resource_id=$1")
        .bind(id)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 1);
    let mut changed = input.clone();
    changed.narrative.patient_condition = "Different clinical request".into();
    assert_eq!(
        create(f.db.pool(), f.actor.clone(), changed)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&HandoverError::RequestConflict)
    );
    let other_user = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash,is_active,password_change_required) VALUES($1,$2,$3,'Synthetic eligible handover reviewer','synthetic-not-used-for-signin',true,false)")
        .bind(other_user).bind(f.db.facility_id()).bind(format!("handover-reviewer-{other_user}@example.invalid")).execute(f.db.pool()).await.unwrap();
    let other = actor(&f.db, other_user).await;
    assert_eq!(
        amend(f.db.pool(), other, id, f.amendment(&receipts[0]))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&HandoverError::NotAuthor)
    );
    let a = f.amendment(&receipts[0]);
    let b = f.amendment(&receipts[0]);
    let (a, b) = tokio::join!(
        amend(f.db.pool(), f.actor.clone(), id, a),
        amend(f.db.pool(), f.actor.clone(), id, b)
    );
    assert!(a.is_ok() != b.is_ok());
    let failure = if a.is_err() {
        a.unwrap_err()
    } else {
        b.unwrap_err()
    };
    assert_eq!(
        failure.downcast_ref(),
        Some(&HandoverError::RevisionChanged)
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM patient_handover_commands")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn audit_failure_rolls_back_every_clinical_transition_and_command() {
    let f = Fixture::new().await;
    sqlx::query("CREATE FUNCTION deny_handover_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type LIKE 'nursing.patient_handover.%' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$").execute(f.db.pool()).await.unwrap();
    async fn enable(pool: &hms_db::PgPool) {
        sqlx::query("CREATE TRIGGER deny_handover_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_handover_audit()").execute(pool).await.unwrap();
    }
    async fn disable(pool: &hms_db::PgPool) {
        sqlx::query("DROP TRIGGER deny_handover_audit ON audit_events")
            .execute(pool)
            .await
            .unwrap();
    }
    enable(f.db.pool()).await;
    assert!(create(f.db.pool(), f.actor.clone(), f.input())
        .await
        .is_err());
    disable(f.db.pool()).await;
    let saved = f.create().await;
    let id = saved.handover.header.id;
    enable(f.db.pool()).await;
    assert!(amend(f.db.pool(), f.actor.clone(), id, f.amendment(&saved))
        .await
        .is_err());
    assert!(void(
        f.db.pool(),
        f.actor.clone(),
        id,
        VoidPatientHandoverRequest {
            client_request_id: Uuid::new_v4(),
            expected_revision: 1,
            reason: "Synthetic void reason".into()
        }
    )
    .await
    .is_err());
    disable(f.db.pool()).await;
    assert_eq!(
        detail(f.db.pool(), f.actor.facility_id, id)
            .await
            .unwrap()
            .header
            .revision,
        1
    );
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM patient_handovers),(SELECT count(*) FROM patient_handover_revisions),(SELECT count(*) FROM patient_handover_commands)").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(counts, (1, 1, 1));
}

async fn wait_for_block(pool: &hms_db::PgPool, pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(pool).await.unwrap();if waiting{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
}
#[tokio::test]
async fn waiting_writes_recheck_database_clock_deadline_and_revoked_session() {
    let f = Fixture::new().await;
    let saved = f.create().await;
    let id = saved.handover.header.id;
    for revoke in [false, true] {
        let mut lock = f.db.pool().begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *lock)
            .await
            .unwrap();
        sqlx::query("SELECT id FROM patient_handovers WHERE id=$1 FOR UPDATE")
            .bind(id)
            .execute(&mut *lock)
            .await
            .unwrap();
        let mut authority = f.actor.clone();
        if !revoke {
            authority.valid_until = Utc::now() + Duration::milliseconds(200);
        }
        let pool = f.db.pool().clone();
        let input = f.amendment(&saved);
        let write = tokio::spawn(async move { amend(&pool, authority, id, input).await });
        wait_for_block(f.db.pool(), pid).await;
        if revoke {
            sqlx::query(
                "UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1",
            )
            .bind(f.actor.session_id)
            .execute(f.db.pool())
            .await
            .unwrap();
        } else {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        lock.commit().await.unwrap();
        assert_eq!(
            write.await.unwrap().unwrap_err().downcast_ref(),
            Some(&HandoverError::AuthorizationExpired)
        );
        assert_eq!(
            detail(f.db.pool(), f.actor.facility_id, id)
                .await
                .unwrap()
                .header
                .revision,
            1
        );
    }
}

#[tokio::test]
async fn clinical_context_is_locked_before_recording_and_invalid_tuple_leaves_nothing() {
    let f = Fixture::new().await;
    let other =
        f.db.scenario("handover-other-patient")
            .registered_patient()
            .await
            .unwrap();
    let mut invalid = f.input();
    invalid.patient_id = other.id;
    assert_eq!(
        create(f.db.pool(), f.actor.clone(), invalid)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&HandoverError::InvalidContext)
    );
    let mut lock = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *lock)
        .await
        .unwrap();
    sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
        .bind(f.admission)
        .execute(&mut *lock)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let actor = f.actor.clone();
    let input = f.input();
    let write = tokio::spawn(async move { create(&pool, actor, input).await });
    wait_for_block(f.db.pool(), pid).await;
    lock.commit().await.unwrap();
    assert_eq!(
        write.await.unwrap().unwrap_err().downcast_ref(),
        Some(&HandoverError::InvalidContext)
    );
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM patient_handovers")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(rows, 0);
    let commands: i64 = sqlx::query_scalar("SELECT count(*) FROM patient_handover_commands")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(commands, 0);
}

async fn nurse(f: &Fixture, ward: Uuid, index: usize) -> (Uuid, Uuid) {
    let user = Uuid::new_v4();
    let staff = Uuid::new_v4();
    let practitioner = Uuid::new_v4();
    let assignment = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,$2,$3,'Synthetic assigned nurse',password_hash FROM users WHERE id=$4").bind(user).bind(f.actor.facility_id).bind(format!("handover-{user}@hms.local")).bind(f.actor.user_id).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES($1,$2,$3,$4,'Synthetic ward','Nurse',CURRENT_DATE)").bind(staff).bind(f.actor.facility_id).bind(user).bind(format!("H-{user}")).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES($1,$2,$3,$4,'Nursing','Synthetic qualification')").bind(practitioner).bind(f.actor.facility_id).bind(staff).bind(format!("L-{user}")).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category,assigned_at) VALUES($1,$2,$3,$4,'staff_nurse','Nurse','nursing',TIMESTAMPTZ '2026-10-01T00:00:00Z'+$5*interval '1 second')").bind(assignment).bind(f.actor.facility_id).bind(ward).bind(practitioner).bind(index as i32).execute(f.db.pool()).await.unwrap();
    (user, assignment)
}

#[tokio::test]
async fn recipient_retirement_preserves_existing_evidence_and_rejects_new_stale_choices() {
    let f = Fixture::new().await;
    let (user, assignment) = nurse(&f, f.ward, 0).await;
    let mut input = f.input();
    input.intended_recipient_user_id = Some(user);
    let saved = create(f.db.pool(), f.actor.clone(), input).await.unwrap();
    sqlx::query("UPDATE users SET is_active=false WHERE id=$1")
        .bind(user)
        .execute(f.db.pool())
        .await
        .unwrap();
    let changed = amend(
        f.db.pool(),
        f.actor.clone(),
        saved.handover.header.id,
        f.amendment(&saved),
    )
    .await
    .unwrap();
    assert_eq!(
        changed.handover.current.intended_recipient_user_id,
        Some(user)
    );
    let retired = void(
        f.db.pool(),
        f.actor.clone(),
        saved.handover.header.id,
        VoidPatientHandoverRequest {
            client_request_id: Uuid::new_v4(),
            expected_revision: 2,
            reason: "Synthetic correction of retired recipient record".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        retired.handover.current.intended_recipient_user_id,
        Some(user)
    );
    let (user2, assignment2) = nurse(&f, f.ward, 1).await;
    let mut lock = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *lock)
        .await
        .unwrap();
    sqlx::query("UPDATE ward_staff_assignments SET is_active=false WHERE id=$1")
        .bind(assignment2)
        .execute(&mut *lock)
        .await
        .unwrap();
    let mut input = f.input();
    input.intended_recipient_user_id = Some(user2);
    let pool = f.db.pool().clone();
    let actor = f.actor.clone();
    let write = tokio::spawn(async move { create(&pool, actor, input).await });
    wait_for_block(f.db.pool(), pid).await;
    lock.commit().await.unwrap();
    assert_eq!(
        write.await.unwrap().unwrap_err().downcast_ref(),
        Some(&HandoverError::InvalidRecipient)
    );
    let options = recipients(
        f.db.pool(),
        f.actor.facility_id,
        f.patient,
        f.admission,
        None,
        None,
        101,
    )
    .await
    .unwrap();
    assert!(!options
        .iter()
        .any(|r| [assignment, assignment2].contains(&r.id)));
}

#[tokio::test]
async fn ward_assignment_is_enforced_again_after_source_waits_and_before_clinical_reads() {
    let f = Fixture::new().await;
    let (user, assignment) = nurse(&f, f.ward, 0).await;
    let mut assigned = actor(&f.db, user).await;
    assigned.can_view_all_wards = false;
    let saved = create(f.db.pool(), assigned.clone(), f.input())
        .await
        .unwrap();
    let id = saved.handover.header.id;
    assert!(detail_for_user(
        f.db.pool(),
        {
            let mut proof = actor(&f.db, user).await;
            proof.can_view_all_wards = false;
            proof
        },
        id
    )
    .await
    .is_ok());
    let mut lock = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *lock)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM patient_handovers WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *lock)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let input = f.amendment(&saved);
    let write = tokio::spawn(async move { amend(&pool, assigned, id, input).await });
    wait_for_block(f.db.pool(), pid).await;
    sqlx::query("UPDATE ward_staff_assignments SET is_active=false WHERE id=$1")
        .bind(assignment)
        .execute(f.db.pool())
        .await
        .unwrap();
    lock.commit().await.unwrap();
    assert_eq!(
        write.await.unwrap().unwrap_err().downcast_ref(),
        Some(&HandoverError::WardAccessDenied)
    );
    assert_eq!(
        detail_for_user(
            f.db.pool(),
            {
                let mut proof = actor(&f.db, user).await;
                proof.can_view_all_wards = false;
                proof
            },
            id
        )
        .await
        .unwrap_err()
        .downcast_ref(),
        Some(&HandoverError::WardAccessDenied)
    );
    assert_eq!(
        history_for_user(
            f.db.pool(),
            {
                let mut proof = actor(&f.db, user).await;
                proof.can_view_all_wards = false;
                proof
            },
            id,
            None,
            25
        )
        .await
        .unwrap_err()
        .downcast_ref(),
        Some(&HandoverError::WardAccessDenied)
    );
    assert!(
        !has_patient_scope(f.db.pool(), f.actor.facility_id, user, f.patient, None)
            .await
            .unwrap()
    );
    assert!(list(
        f.db.pool(),
        f.actor.facility_id,
        &query(f.patient, None, true),
        Some(user),
        None,
        25
    )
    .await
    .unwrap()
    .is_empty());
}

#[tokio::test]
async fn patient_and_recipient_pages_are_scoped_before_limits_and_have_constant_query_counts() {
    let f = Fixture::new().await;
    let other =
        f.db.scenario("handover-paging-other")
            .admission_case_with_available_bed()
            .await
            .unwrap();
    sqlx::query("UPDATE admission_cases SET status='admitted' WHERE id=$1")
        .bind(other.admission.id)
        .execute(f.db.pool())
        .await
        .unwrap();
    for index in 0..121 {
        let mut input = f.input();
        input.patient_id = other.patient.id;
        input.admission_case_id = other.admission.id;
        create(f.db.pool(), f.actor.clone(), input).await.unwrap();
        nurse(&f, other.ward.id, index).await;
    }
    for index in 0..3 {
        f.create().await;
        nurse(&f, f.ward, index).await;
    }
    let (first, count) = hms_observability::with_request_query_counter(list(
        f.db.pool(),
        f.actor.facility_id,
        &query(f.patient, Some(f.admission), false),
        None,
        None,
        2,
    ))
    .await;
    let first = first.unwrap();
    assert_eq!(count, 1);
    assert_eq!(first.len(), 2);
    assert!(first.iter().all(|r| r.patient_id == f.patient));
    let last = first.last().unwrap();
    let second = list(
        f.db.pool(),
        f.actor.facility_id,
        &query(f.patient, Some(f.admission), false),
        None,
        Some(WardCursor {
            occurred_at: last.created_at,
            id: last.id,
        }),
        2,
    )
    .await
    .unwrap();
    assert_eq!(second.len(), 1);
    assert!(!first.iter().any(|r| r.id == second[0].id));
    let (first, count) = hms_observability::with_request_query_counter(recipients(
        f.db.pool(),
        f.actor.facility_id,
        f.patient,
        f.admission,
        None,
        None,
        2,
    ))
    .await;
    let first = first.unwrap();
    assert_eq!(count, 1);
    assert_eq!(first.len(), 2);
    let last = first.last().unwrap();
    let second = recipients(
        f.db.pool(),
        f.actor.facility_id,
        f.patient,
        f.admission,
        None,
        Some(WardCursor {
            occurred_at: last.assigned_at,
            id: last.id,
        }),
        2,
    )
    .await
    .unwrap();
    assert_eq!(second.len(), 1);
    assert!(!first.iter().any(|r| r.id == second[0].id));
    assert!(serde_json::to_vec(&first).unwrap().len() < 4096);
}
