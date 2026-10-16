use chrono::{Duration, Utc};
use hms_db::{
    test_support::TestDb,
    ward::{nursing_access::*, *},
};
use hms_domain::{
    deployment::{DeploymentProfile, FeatureKey},
    ward::*,
};
use serde_json::json;
use uuid::Uuid;
struct Fixture {
    db: TestDb,
    patient: Uuid,
    admission: Uuid,
    ward: Uuid,
    actor: NursingActor,
}
async fn actor(db: &TestDb, user: Uuid) -> NursingActor {
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
    NursingActor {
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
            .scenario("synthetic-nursing-safety")
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
    fn input(&self) -> NewNursingTask {
        NewNursingTask {
            id: Uuid::new_v4(),
            facility_id: self.actor.facility_id,
            admission_case_id: self.admission,
            patient_id: self.patient,
            ward_id: self.ward,
            task_type: NursingTaskType::Observation,
            title: Some("Synthetic task".into()),
            instruction: Some("Synthetic nursing instruction".into()),
            due_at: Utc::now(),
            assigned_to_user_id: None,
            actor_user_id: self.actor.user_id,
        }
    }
    async fn create(&self) -> NursingTaskListItem {
        create_nursing_task_for_actor(self.db.pool(), self.actor.clone(), self.input())
            .await
            .unwrap()
    }
    fn vitals(&self) -> NewPatientVitals {
        NewPatientVitals {
            id: Uuid::new_v4(),
            facility_id: self.actor.facility_id,
            admission_case_id: self.admission,
            patient_id: self.patient,
            recorded_at: Utc::now(),
            temperature_c: None,
            systolic_bp: None,
            diastolic_bp: None,
            pulse: Some(80),
            respiratory_rate: None,
            oxygen_saturation: None,
            recorded_by_user_id: self.actor.user_id,
        }
    }
}
fn task_query(value: serde_json::Value) -> NursingTaskListQuery {
    serde_json::from_value(value).unwrap()
}
async fn wait_for_block(pool: &hms_db::PgPool, pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{let n:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))").bind(pid).fetch_one(pool).await.unwrap();if n>0{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("actual nursing operation reaches held row");
}
async fn nurse(f: &Fixture, ward: Uuid, index: usize) -> (Uuid, Uuid) {
    let user = Uuid::new_v4();
    let staff = Uuid::new_v4();
    let practitioner = Uuid::new_v4();
    let assignment = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,$2,$3,'Synthetic assigned nurse',password_hash FROM users WHERE id=$4").bind(user).bind(f.actor.facility_id).bind(format!("nursing-{user}@hms.local")).bind(f.actor.user_id).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES($1,$2,$3,$4,'Synthetic ward','Nurse',CURRENT_DATE)").bind(staff).bind(f.actor.facility_id).bind(user).bind(format!("H-{user}")).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES($1,$2,$3,$4,'Nursing','Synthetic qualification')").bind(practitioner).bind(f.actor.facility_id).bind(staff).bind(format!("L-{user}")).execute(f.db.pool()).await.unwrap();
    sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category,assigned_at) VALUES($1,$2,$3,$4,'staff_nurse','Nurse','nursing',TIMESTAMPTZ '2026-10-01T00:00:00Z'+$5*interval '1 second')").bind(assignment).bind(f.actor.facility_id).bind(ward).bind(practitioner).bind(index as i32).execute(f.db.pool()).await.unwrap();
    (user, assignment)
}

#[tokio::test]
async fn competing_task_decisions_have_one_immutable_winner() {
    let f = Fixture::new().await;
    let task = f.create().await;
    let (a, b) = tokio::join!(
        decide_nursing_task_for_actor(
            f.db.pool(),
            f.actor.clone(),
            task.id,
            NursingTaskStatus::Completed
        ),
        decide_nursing_task_for_actor(
            f.db.pool(),
            f.actor.clone(),
            task.id,
            NursingTaskStatus::Cancelled
        )
    );
    assert_ne!(a.is_ok(), b.is_ok());
    let (saved, error) = if let Ok(a) = a {
        (a, b.unwrap_err())
    } else {
        (b.unwrap(), a.unwrap_err())
    };
    assert_eq!(error.downcast_ref(), Some(&NursingError::TerminalConflict));
    let before = serde_json::to_value(&saved).unwrap();
    let replay = decide_nursing_task_for_actor(f.db.pool(), f.actor.clone(), task.id, saved.status)
        .await
        .unwrap();
    assert_eq!(serde_json::to_value(replay).unwrap(), before);
    assert!(if saved.status == NursingTaskStatus::Completed {
        saved.completed_at.is_some()
            && saved.completed_by_user_id == Some(f.actor.user_id)
            && saved.cancelled_at.is_none()
    } else {
        saved.cancelled_at.is_some()
            && saved.cancelled_by_user_id == Some(f.actor.user_id)
            && saved.completed_at.is_none()
    });
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE resource_id=$1")
        .bind(task.id)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 2);
}
#[tokio::test]
async fn task_captured_ward_and_observation_current_ward_filter_before_limit() {
    let f = Fixture::new().await;
    let other =
        f.db.scenario("nursing-disjoint-ward")
            .admission_case_with_available_bed()
            .await
            .unwrap();
    let (user, _) = nurse(&f, f.ward, 0).await;
    let mut scoped = actor(&f.db, user).await;
    scoped.can_view_all_wards = false;
    let old = f.create().await;
    let later = f.create().await;
    sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,title,instruction,status,due_at) SELECT gen_random_uuid(),$1,$2,$3,$4,'observation','Other ward','Not authorized','open',clock_timestamp()-interval '1 day' FROM generate_series(1,40)").bind(f.actor.facility_id).bind(other.admission.id).bind(other.patient.id).bind(other.ward.id).execute(f.db.pool()).await.unwrap();
    let q = task_query(json!({"task_type":"observation","status":"open"}));
    let first = list_nursing_tasks_for_actor(f.db.pool(), scoped.clone(), &q, None, 1)
        .await
        .unwrap();
    assert_eq!(first[0].id, old.id);
    let next = list_nursing_tasks_for_actor(
        f.db.pool(),
        scoped.clone(),
        &q,
        Some(WardCursor {
            occurred_at: first[0].due_at,
            id: first[0].id,
        }),
        1,
    )
    .await
    .unwrap();
    assert_eq!(next[0].id, later.id);
    let forbidden = task_query(json!({"ward_id":other.ward.id}));
    assert_eq!(
        list_nursing_tasks_for_actor(f.db.pool(), scoped.clone(), &forbidden, None, 1)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&NursingError::WardDenied)
    );
    create_patient_vitals_for_actor(f.db.pool(), f.actor.clone(), f.vitals())
        .await
        .unwrap();
    sqlx::query("UPDATE admission_cases SET ward_id=$2 WHERE id=$1")
        .bind(f.admission)
        .bind(other.ward.id)
        .execute(f.db.pool())
        .await
        .unwrap();
    assert_eq!(
        decide_nursing_task_for_actor(
            f.db.pool(),
            f.actor.clone(),
            old.id,
            NursingTaskStatus::Completed
        )
        .await
        .unwrap_err()
        .downcast_ref(),
        Some(&NursingError::InvalidContext)
    );
    assert_eq!(
        list_nursing_tasks_for_actor(f.db.pool(), scoped.clone(), &q, None, 10)
            .await
            .unwrap()
            .len(),
        2
    );
    let q: PatientVitalsListQuery =
        serde_json::from_value(json!({"patient_id":f.patient})).unwrap();
    assert!(
        list_patient_vitals_for_actor(f.db.pool(), scoped, &q, None, None, 10)
            .await
            .unwrap()
            .is_empty()
    );
}
#[tokio::test]
async fn care_closure_or_transfer_rejects_new_completion_but_allows_cancellation_retirement() {
    let f = Fixture::new().await;
    let task = f.create().await;
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
    let actor = f.actor.clone();
    let wait = tokio::spawn(async move {
        decide_nursing_task_for_actor(&pool, actor, task.id, NursingTaskStatus::Completed).await
    });
    wait_for_block(f.db.pool(), pid).await;
    held.commit().await.unwrap();
    assert_eq!(
        wait.await.unwrap().unwrap_err().downcast_ref(),
        Some(&NursingError::InvalidContext)
    );
    let saved = decide_nursing_task_for_actor(
        f.db.pool(),
        f.actor.clone(),
        task.id,
        NursingTaskStatus::Cancelled,
    )
    .await
    .unwrap();
    assert_eq!(saved.status, NursingTaskStatus::Cancelled);
    assert!(saved.completed_at.is_none());
    assert_eq!(
        create_patient_vitals_for_actor(f.db.pool(), f.actor.clone(), f.vitals())
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&NursingError::InvalidContext)
    );
}
#[tokio::test]
async fn waiting_task_decision_rechecks_session_revocation_and_natural_deadline() {
    for expires in [false, true] {
        let f = Fixture::new().await;
        let task = f.create().await;
        let mut proof = f.actor.clone();
        if expires {
            proof.valid_until = Utc::now() + Duration::seconds(1);
        }
        let mut held = f.db.pool().begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await
            .unwrap();
        sqlx::query("SELECT id FROM nursing_tasks WHERE id=$1 FOR UPDATE")
            .bind(task.id)
            .execute(&mut *held)
            .await
            .unwrap();
        let pool = f.db.pool().clone();
        let wait = tokio::spawn(async move {
            decide_nursing_task_for_actor(&pool, proof, task.id, NursingTaskStatus::Completed).await
        });
        wait_for_block(f.db.pool(), pid).await;
        if expires {
            tokio::time::sleep(std::time::Duration::from_millis(1150)).await;
        } else {
            sqlx::query(
                "UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1",
            )
            .bind(f.actor.session_id)
            .execute(f.db.pool())
            .await
            .unwrap();
        }
        held.commit().await.unwrap();
        assert_eq!(
            wait.await.unwrap().unwrap_err().downcast_ref(),
            Some(&NursingError::AuthorizationExpired)
        );
        assert_eq!(
            get_nursing_task(f.db.pool(), f.actor.facility_id, task.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            NursingTaskStatus::Open
        );
    }
}
#[tokio::test]
async fn optional_assignee_requires_actual_active_local_ward_membership() {
    let f = Fixture::new().await;
    let (user, assignment) = nurse(&f, f.ward, 0).await;
    let mut input = f.input();
    input.assigned_to_user_id = Some(user);
    create_nursing_task_for_actor(f.db.pool(), f.actor.clone(), input.clone())
        .await
        .unwrap();
    sqlx::query("UPDATE ward_staff_assignments SET is_active=false WHERE id=$1")
        .bind(assignment)
        .execute(f.db.pool())
        .await
        .unwrap();
    input.id = Uuid::new_v4();
    assert_eq!(
        create_nursing_task_for_actor(f.db.pool(), f.actor.clone(), input)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&NursingError::InvalidAssignee)
    );
}
#[tokio::test]
async fn task_audit_failure_rolls_back_decision_and_provenance() {
    let f = Fixture::new().await;
    let task = f.create().await;
    sqlx::query("CREATE FUNCTION reject_nursing_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='nursing.task.completed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$").execute(f.db.pool()).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_nursing_decision BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_nursing_decision()").execute(f.db.pool()).await.unwrap();
    assert!(decide_nursing_task_for_actor(
        f.db.pool(),
        f.actor.clone(),
        task.id,
        NursingTaskStatus::Completed
    )
    .await
    .is_err());
    let saved = get_nursing_task(f.db.pool(), f.actor.facility_id, task.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.status, NursingTaskStatus::Open);
    assert!(saved.completed_at.is_none() && saved.completed_by_user_id.is_none());
}

async fn feature_writer(f: &Fixture, delete: bool) {
    if delete {
        hms_db::admin::delete_feature_entitlement(
            f.db.pool(),
            f.actor.facility_id,
            FeatureKey::Nursing,
            f.actor.user_id,
            None,
        )
        .await
        .unwrap();
    } else {
        hms_db::admin::update_feature_entitlement(
            f.db.pool(),
            f.actor.facility_id,
            FeatureKey::Nursing,
            false,
            f.actor.user_id,
            None,
        )
        .await
        .unwrap();
    }
}
#[tokio::test]
async fn feature_publication_and_protected_recording_serialize_in_both_orders() {
    for delete in [false, true] {
        for nursing_first in [false, true] {
            let mut f = Fixture::new().await;
            if delete {
                sqlx::query("UPDATE facilities SET deployment_profile='clinic' WHERE id=$1")
                    .bind(f.actor.facility_id)
                    .execute(f.db.pool())
                    .await
                    .unwrap();
                f.actor.active_profile = DeploymentProfile::Clinic;
                hms_db::admin::update_feature_entitlement(
                    f.db.pool(),
                    f.actor.facility_id,
                    FeatureKey::Nursing,
                    true,
                    f.actor.user_id,
                    None,
                )
                .await
                .unwrap();
            }
            let event = if nursing_first {
                "nursing.vitals.recorded"
            } else if delete {
                "admin.feature_entitlement.deleted"
            } else {
                "admin.feature_entitlement.updated"
            };
            sqlx::query(&format!("CREATE FUNCTION hold_nursing9_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='{event}' THEN PERFORM pg_advisory_xact_lock(719018); END IF; RETURN NEW; END $$")).execute(f.db.pool()).await.unwrap();
            sqlx::query("CREATE TRIGGER hold_nursing9_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION hold_nursing9_audit()").execute(f.db.pool()).await.unwrap();
            let mut barrier = f.db.pool().begin().await.unwrap();
            let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *barrier)
                .await
                .unwrap();
            sqlx::query("SELECT pg_advisory_xact_lock(719018)")
                .execute(&mut *barrier)
                .await
                .unwrap();
            let shared = std::sync::Arc::new(f);
            let first = shared.clone();
            let nursing = if nursing_first {
                Some(tokio::spawn(async move {
                    create_patient_vitals_for_actor(
                        first.db.pool(),
                        first.actor.clone(),
                        first.vitals(),
                    )
                    .await
                }))
            } else {
                None
            };
            let writer = if !nursing_first {
                let f = shared.clone();
                Some(tokio::spawn(
                    async move { feature_writer(&f, delete).await },
                ))
            } else {
                None
            };
            wait_for_block(shared.db.pool(), pid).await;
            let nursing = if let Some(n) = nursing {
                n
            } else {
                let f = shared.clone();
                tokio::spawn(async move {
                    create_patient_vitals_for_actor(f.db.pool(), f.actor.clone(), f.vitals()).await
                })
            };
            let writer = if let Some(w) = writer {
                w
            } else {
                let f = shared.clone();
                tokio::spawn(async move { feature_writer(&f, delete).await })
            };
            tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{let count:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0").fetch_one(shared.db.pool()).await.unwrap();if count>=2{break;}assert!(!nursing.is_finished()&&!writer.is_finished());tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("both actual public feature writer and nursing command are serialized");
            barrier.commit().await.unwrap();
            let result = nursing.await.unwrap();
            writer.await.unwrap();
            if nursing_first {
                assert!(result.is_ok());
            } else {
                assert_eq!(
                    result.unwrap_err().downcast_ref(),
                    Some(&NursingError::FeatureDisabled)
                );
            }
            let rows: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM patient_vitals WHERE admission_case_id=$1",
            )
            .bind(shared.admission)
            .fetch_one(shared.db.pool())
            .await
            .unwrap();
            assert_eq!(rows, if nursing_first { 1 } else { 0 });
            let q = task_query(json!({}));
            assert_eq!(
                list_nursing_tasks_for_actor(shared.db.pool(), shared.actor.clone(), &q, None, 1)
                    .await
                    .unwrap_err()
                    .downcast_ref(),
                Some(&NursingError::FeatureDisabled)
            );
        }
    }
}
#[tokio::test]
async fn revoked_assignment_is_rechecked_after_a_real_assignment_wait() {
    let f = Fixture::new().await;
    let task = f.create().await;
    let (user, id) = nurse(&f, f.ward, 0).await;
    let mut proof = actor(&f.db, user).await;
    proof.can_view_all_wards = false;
    let mut held = f.db.pool().begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("UPDATE ward_staff_assignments SET is_active=false WHERE id=$1")
        .bind(id)
        .execute(&mut *held)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let wait = tokio::spawn(async move {
        decide_nursing_task_for_actor(&pool, proof, task.id, NursingTaskStatus::Completed).await
    });
    wait_for_block(f.db.pool(), pid).await;
    held.commit().await.unwrap();
    assert_eq!(
        wait.await.unwrap().unwrap_err().downcast_ref(),
        Some(&NursingError::WardDenied)
    );
    assert_eq!(
        get_nursing_task(f.db.pool(), f.actor.facility_id, task.id)
            .await
            .unwrap()
            .unwrap()
            .status,
        NursingTaskStatus::Open
    );
}

#[tokio::test]
async fn malformed_care_tuples_are_excluded_before_paging_and_query_cost_is_constant() {
    let f = Fixture::new().await;
    let other =
        f.db.scenario("nursing-malformed-patient")
            .registered_patient()
            .await
            .unwrap();
    let (user, _) = nurse(&f, f.ward, 0).await;
    let mut proof = actor(&f.db, user).await;
    proof.can_view_all_wards = false;
    sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,instruction,status,due_at) VALUES(gen_random_uuid(),$1,$2,$3,$4,'observation','Synthetic mismatched tuple','open',clock_timestamp()-interval '1 day')").bind(f.actor.facility_id).bind(f.admission).bind(other.id).bind(f.ward).execute(f.db.pool()).await.unwrap();
    let task = f.create().await;
    let q = task_query(json!({}));
    let (first, cost) = hms_observability::with_request_query_counter(
        list_nursing_tasks_for_actor(f.db.pool(), proof.clone(), &q, None, 1),
    )
    .await;
    assert_eq!(first.unwrap()[0].id, task.id);
    assert_eq!(cost, 9);
    for _ in 0..5 {
        f.create().await;
    }
    let (page, larger_cost) = hms_observability::with_request_query_counter(
        list_nursing_tasks_for_actor(f.db.pool(), proof, &q, None, 50),
    )
    .await;
    assert_eq!(page.unwrap().len(), 6);
    assert_eq!(larger_cost, cost);
    sqlx::query("INSERT INTO monitoring_events(id,facility_id,admission_case_id,patient_id,event_kind,summary,recorded_at) VALUES(gen_random_uuid(),$1,$2,$3,'observation','Synthetic mismatched monitoring',clock_timestamp()-interval '1 day')").bind(f.actor.facility_id).bind(f.admission).bind(other.id).execute(f.db.pool()).await.unwrap();
    let input = NewMonitoringEvent {
        id: Uuid::new_v4(),
        facility_id: f.actor.facility_id,
        admission_case_id: f.admission,
        patient_id: f.patient,
        event_kind: MonitoringEventKind::Observation,
        summary: "Synthetic selected event".into(),
        recorded_at: Utc::now(),
        recorded_by_user_id: f.actor.user_id,
    };
    let saved = create_monitoring_event_for_actor(f.db.pool(), f.actor.clone(), input)
        .await
        .unwrap();
    let query: MonitoringEventListQuery =
        serde_json::from_value(json!({"event_kind":"observation"})).unwrap();
    let rows = list_monitoring_events_for_actor(f.db.pool(), f.actor.clone(), &query, None, 1)
        .await
        .unwrap();
    assert_eq!(rows[0].id, saved.id);
}
#[tokio::test]
async fn terminal_legacy_task_reads_do_not_infer_a_historical_actor_or_time() {
    let f = Fixture::new().await;
    let task = f.create().await;
    sqlx::query("UPDATE nursing_tasks SET status='completed',completed_at=NULL,completed_by_user_id=NULL WHERE id=$1").bind(task.id).execute(f.db.pool()).await.unwrap();
    let saved = decide_nursing_task_for_actor(
        f.db.pool(),
        f.actor.clone(),
        task.id,
        NursingTaskStatus::Completed,
    )
    .await
    .unwrap();
    assert!(saved.completed_at.is_none() && saved.completed_by_user_id.is_none());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE resource_id=$1")
        .bind(task.id)
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn actual_explicit_open_critical_query_excludes_old_acknowledged_and_low_rows() {
    let f = Fixture::new().await;
    sqlx::query("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,CASE WHEN n%2=0 THEN 'critical' ELSE 'low' END,'Synthetic excluded alert',CASE WHEN n%2=0 THEN 'acknowledged' ELSE 'open' END,clock_timestamp()-interval '1 day' FROM generate_series(1,200)n").bind(f.actor.facility_id).bind(f.admission).bind(f.patient).execute(f.db.pool()).await.unwrap();
    let saved = create_nursing_alert_for_actor(
        f.db.pool(),
        f.actor.clone(),
        NewNursingAlert {
            id: Uuid::new_v4(),
            facility_id: f.actor.facility_id,
            admission_case_id: f.admission,
            patient_id: f.patient,
            severity: NursingAlertSeverity::Critical,
            title: "Synthetic selected critical alert".into(),
            created_by_user_id: f.actor.user_id,
        },
    )
    .await
    .unwrap();
    let q: NursingAlertListQuery =
        serde_json::from_value(json!({"status":"open","critical_only":true,"descending":true}))
            .unwrap();
    let rows = list_nursing_alerts_for_actor(f.db.pool(), f.actor.clone(), &q, None, 1)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, saved.id);
}
#[tokio::test]
async fn persistence_rejects_new_empty_vitals_without_inventing_measurements() {
    let f = Fixture::new().await;
    assert!(sqlx::query("INSERT INTO patient_vitals(id,facility_id,admission_case_id,patient_id,recorded_at) VALUES(gen_random_uuid(),$1,$2,$3,clock_timestamp())").bind(f.actor.facility_id).bind(f.admission).bind(f.patient).execute(f.db.pool()).await.is_err());
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_vitals WHERE admission_case_id=$1")
            .bind(f.admission)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(count, 0);
}
