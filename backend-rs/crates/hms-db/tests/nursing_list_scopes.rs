use chrono::{Duration, Utc};
use hms_db::{test_support::TestDb, ward::*};
use hms_domain::ward::{HandoffStatus, NursingAlertStatus, TreatmentSheetStatus};
use uuid::Uuid;

#[tokio::test]
async fn active_critical_alerts_filter_before_limit_and_stay_indexed_with_generic_plans() {
    let db = TestDb::hospital().await.unwrap();
    let selected = db
        .scenario("critical-selected")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let other = db
        .scenario("critical-other")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let start = Utc::now() - Duration::days(1);
    sqlx::query("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,CASE WHEN sequence % 2 = 0 THEN 'critical' ELSE 'low' END,'Synthetic historical alert','acknowledged',$4 + sequence * interval '1 second' FROM generate_series(1,5000) sequence")
        .bind(db.facility_id()).bind(other.admission.id).bind(other.patient.id).bind(start).execute(db.pool()).await.unwrap();
    sqlx::query("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,'low','Synthetic open low alert','open',$4 + sequence * interval '1 second' FROM generate_series(1,100) sequence")
        .bind(db.facility_id()).bind(selected.admission.id).bind(selected.patient.id).bind(start).execute(db.pool()).await.unwrap();
    let now = Utc::now();
    let ids: Vec<Uuid> = sqlx::query_scalar("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,'critical','Synthetic current critical alert','open',$4 FROM generate_series(1,3) RETURNING id")
        .bind(db.facility_id()).bind(selected.admission.id).bind(selected.patient.id).bind(now).fetch_all(db.pool()).await.unwrap();
    let filters = NursingAlertFilters {
        status: Some(NursingAlertStatus::Open),
        critical_only: true,
        descending: true,
        ..Default::default()
    };
    let (page, count) = hms_observability::with_request_query_counter(list_nursing_alerts_scoped(
        db.pool(),
        db.facility_id(),
        None,
        2,
        filters.clone(),
    ))
    .await;
    let page = page.unwrap();
    assert_eq!(count, 1);
    assert_eq!(page.len(), 2);
    assert!(page.iter().all(|row| ids.contains(&row.id)));
    let last = page.last().unwrap();
    let next = list_nursing_alerts_scoped(
        db.pool(),
        db.facility_id(),
        Some(WardCursor {
            occurred_at: last.created_at,
            id: last.id,
        }),
        2,
        filters.clone(),
    )
    .await
    .unwrap();
    assert_eq!(next.len(), 1);
    assert!(!page.iter().any(|row| row.id == next[0].id));
    let scoped = list_nursing_alerts_scoped(
        db.pool(),
        db.facility_id(),
        None,
        50,
        NursingAlertFilters {
            patient_id: Some(other.patient.id),
            ..filters.clone()
        },
    )
    .await
    .unwrap();
    assert!(scoped.is_empty());
    let edge = list_nursing_alerts_scoped(
        db.pool(),
        db.facility_id(),
        None,
        50,
        NursingAlertFilters {
            created_from: Some(now),
            created_before: Some(now + Duration::microseconds(1)),
            ..filters.clone()
        },
    )
    .await
    .unwrap();
    assert_eq!(edge.len(), 3);
    let excluded = list_nursing_alerts_scoped(
        db.pool(),
        db.facility_id(),
        None,
        50,
        NursingAlertFilters {
            created_before: Some(now),
            ..filters
        },
    )
    .await
    .unwrap();
    assert!(excluded.is_empty());
    // A dense current queue also needs ordered limit reads without sorting its
    // entire active set. The earlier fixture checks only three current rows.
    sqlx::query("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,'critical','Synthetic current queue','open',$4 + sequence * interval '1 second' FROM generate_series(1,5000) sequence")
        .bind(db.facility_id()).bind(selected.admission.id).bind(selected.patient.id).bind(start).execute(db.pool()).await.unwrap();
    sqlx::query("ANALYZE nursing_alerts")
        .execute(db.pool())
        .await
        .unwrap();
    let indexes: Vec<String> = sqlx::query_scalar("SELECT indexname FROM pg_indexes WHERE tablename='nursing_alerts' AND indexname='nursing_alerts_open_critical_cursor_idx'")
        .fetch_all(db.pool()).await.unwrap();
    assert_eq!(
        indexes,
        vec!["nursing_alerts_open_critical_cursor_idx"],
        "the new migration installs the hot-path index"
    );
    let mut generic_plan = db.pool().begin().await.unwrap();
    sqlx::query("SET LOCAL plan_cache_mode = force_generic_plan")
        .execute(&mut *generic_plan)
        .await
        .unwrap();
    sqlx::query("PREPARE nursing_priority(uuid) AS SELECT id FROM nursing_alerts WHERE facility_id=$1 AND status='open' AND severity IN ('high','critical') ORDER BY created_at DESC,id DESC LIMIT 50")
        .execute(&mut *generic_plan).await.unwrap();
    let plan: serde_json::Value = sqlx::query_scalar(&format!(
        "EXPLAIN(FORMAT JSON) EXECUTE nursing_priority('{}')",
        db.facility_id()
    ))
    .fetch_one(&mut *generic_plan)
    .await
    .unwrap();
    assert!(
        plan.to_string()
            .contains("nursing_alerts_open_critical_cursor_idx"),
        "generic priority reads use the ordered partial index"
    );
    assert!(!plan.to_string().contains("Seq Scan"));
    assert!(!plan.to_string().contains("\"Sort\""));
    assert!(
        plan.to_string().contains("$1"),
        "the check uses a genuinely generic prepared plan"
    );
    sqlx::query("DEALLOCATE nursing_priority")
        .execute(&mut *generic_plan)
        .await
        .unwrap();
    generic_plan.rollback().await.unwrap();
}

#[tokio::test]
async fn treatment_and_handoff_scopes_page_without_facility_preview_truncation() {
    let db = TestDb::hospital().await.unwrap();
    let selected = db
        .scenario("header-selected")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let other = db
        .scenario("header-other")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let now = Utc::now();
    for (scope, count, start) in [(&other, 120, now - Duration::days(10)), (&selected, 3, now)] {
        sqlx::query("INSERT INTO treatment_sheets(id,facility_id,admission_case_id,patient_id,sheet_date,status,updated_at) SELECT gen_random_uuid(),$1,$2,$3,DATE '2026-01-01'+sequence,'active',$4 FROM generate_series(1,$5) sequence")
            .bind(db.facility_id()).bind(scope.admission.id).bind(scope.patient.id).bind(start).bind(count).execute(db.pool()).await.unwrap();
        sqlx::query("INSERT INTO handoffs(id,facility_id,ward_id,from_user_id,to_user_id,shift_label,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,$3,'night','draft',$4 FROM generate_series(1,$5) sequence")
            .bind(db.facility_id()).bind(scope.ward.id).bind(db.owner_user_id()).bind(start).bind(count).execute(db.pool()).await.unwrap();
    }
    let filters = TreatmentSheetFilters {
        patient_id: Some(selected.patient.id),
        admission_case_id: Some(selected.admission.id),
        ward_id: Some(selected.ward.id),
        status: Some(TreatmentSheetStatus::Active),
        ..Default::default()
    };
    let (first, count) = hms_observability::with_request_query_counter(
        list_treatment_sheets_scoped(db.pool(), db.facility_id(), None, 2, filters.clone()),
    )
    .await;
    let first = first.unwrap();
    assert_eq!(count, 1);
    assert_eq!(first.len(), 2);
    let last = first.last().unwrap();
    let next = list_treatment_sheets_scoped(
        db.pool(),
        db.facility_id(),
        Some(WardCursor {
            occurred_at: last.updated_at,
            id: last.id,
        }),
        2,
        filters.clone(),
    )
    .await
    .unwrap();
    assert_eq!(next.len(), 1);
    assert!(first.iter().all(|row| row.id != next[0].id));
    assert!(list_treatment_sheets_scoped(
        db.pool(),
        db.facility_id(),
        None,
        2,
        TreatmentSheetFilters {
            ward_id: Some(other.ward.id),
            ..filters
        }
    )
    .await
    .unwrap()
    .is_empty());
    let target = &first[0];
    let exact = list_treatment_sheets_scoped(
        db.pool(),
        db.facility_id(),
        None,
        1,
        TreatmentSheetFilters {
            id: Some(target.id),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(exact[0].id, target.id);
    let filters = HandoffFilters {
        ward_id: Some(selected.ward.id),
        shift_label: Some("night".into()),
        status: Some(HandoffStatus::Draft),
        created_from: Some(now),
        created_before: Some(now + Duration::microseconds(1)),
        descending: true,
    };
    let (first, count) = hms_observability::with_request_query_counter(list_handoffs_scoped(
        db.pool(),
        db.facility_id(),
        None,
        2,
        filters.clone(),
    ))
    .await;
    let first = first.unwrap();
    assert_eq!(count, 1);
    assert_eq!(first.len(), 2);
    let last = first.last().unwrap();
    let next = list_handoffs_scoped(
        db.pool(),
        db.facility_id(),
        Some(WardCursor {
            occurred_at: last.created_at,
            id: last.id,
        }),
        2,
        filters.clone(),
    )
    .await
    .unwrap();
    assert_eq!(next.len(), 1);
    assert!(first.iter().all(|row| row.id != next[0].id));
    assert!(list_handoffs_scoped(
        db.pool(),
        db.facility_id(),
        None,
        50,
        HandoffFilters {
            created_before: Some(now),
            ..filters
        }
    )
    .await
    .unwrap()
    .is_empty());
}

#[tokio::test]
async fn incoherent_patient_admission_and_foreign_facility_rows_never_project() {
    let db = TestDb::hospital().await.unwrap();
    let selected = db
        .scenario("coherent-target")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let other = db
        .scenario("coherent-other")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'NURSING-FOREIGN','Synthetic foreign facility','hospital')").bind(foreign).execute(db.pool()).await.unwrap();
    for (facility, patient) in [
        (db.facility_id(), other.patient.id),
        (foreign, selected.patient.id),
    ] {
        sqlx::query("INSERT INTO treatment_sheets(id,facility_id,admission_case_id,patient_id,sheet_date,status) VALUES(gen_random_uuid(),$1,$2,$3,CASE WHEN $1=$4 THEN DATE '2026-01-01' ELSE DATE '2026-01-02' END,'active')").bind(facility).bind(selected.admission.id).bind(patient).bind(db.facility_id()).execute(db.pool()).await.unwrap();
        sqlx::query("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status) VALUES(gen_random_uuid(),$1,$2,$3,'critical','Synthetic invalid context','open')").bind(facility).bind(selected.admission.id).bind(patient).execute(db.pool()).await.unwrap();
    }
    assert!(list_treatment_sheets_scoped(
        db.pool(),
        db.facility_id(),
        None,
        100,
        Default::default()
    )
    .await
    .unwrap()
    .is_empty());
    assert!(
        list_nursing_alerts_scoped(db.pool(), db.facility_id(), None, 100, Default::default())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        list_treatment_sheets_scoped(db.pool(), foreign, None, 100, Default::default())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        list_nursing_alerts_scoped(db.pool(), foreign, None, 100, Default::default())
            .await
            .unwrap()
            .is_empty()
    );
}

async fn wait_for_blocker(pool: &hms_db::PgPool, blocker: i32) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let blocked: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))",
        )
        .bind(blocker)
        .fetch_one(pool)
        .await
        .unwrap();
        if blocked {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "handoff must wait for the actual reference lock"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn handoff_reference_locks_recheck_deactivation_before_any_insert_or_audit() {
    let db = TestDb::hospital().await.unwrap();
    let scope = db
        .scenario("handoff-lock")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let recipient = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for ward_change in [true, false] {
        let mut blocker = db.pool().begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await
            .unwrap();
        if ward_change {
            sqlx::query("UPDATE wards SET status='inactive' WHERE id=$1")
                .bind(scope.ward.id)
                .execute(&mut *blocker)
                .await
                .unwrap();
        } else {
            sqlx::query("UPDATE users SET is_active=false WHERE id=$1")
                .bind(recipient)
                .execute(&mut *blocker)
                .await
                .unwrap();
        }
        let pool = db.pool().clone();
        let command = NewHandoff {
            id: Uuid::new_v4(),
            facility_id: db.facility_id(),
            ward_id: scope.ward.id,
            from_user_id: db.owner_user_id(),
            to_user_id: recipient,
            shift_label: "night".into(),
            request_id: None,
        };
        let id = command.id;
        let waiting = tokio::spawn(async move { create_handoff(&pool, command).await });
        wait_for_blocker(db.pool(), pid).await;
        blocker.commit().await.unwrap();
        let error = waiting.await.unwrap().unwrap_err();
        assert!(matches!(
            error.downcast_ref::<HandoffError>(),
            Some(HandoffError::InvalidReference)
        ));
        let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM handoffs WHERE id=$1")
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(rows, 0);
        let audit: i64 =
            sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE resource_id=$1")
                .bind(id)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(audit, 0);
        if ward_change {
            sqlx::query("UPDATE wards SET status='active' WHERE id=$1")
                .bind(scope.ward.id)
                .execute(db.pool())
                .await
                .unwrap();
        } else {
            sqlx::query("UPDATE users SET is_active=true WHERE id=$1")
                .bind(recipient)
                .execute(db.pool())
                .await
                .unwrap();
        }
    }
}

async fn fail_handoff_audit(pool: &hms_db::PgPool) {
    sqlx::query("CREATE OR REPLACE FUNCTION deny_handoff_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type LIKE 'nursing.handoff.%' THEN RAISE EXCEPTION 'Synthetic handoff audit denial'; END IF; RETURN NEW; END $$").execute(pool).await.unwrap();
    sqlx::query("CREATE TRIGGER deny_handoff_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_handoff_audit()").execute(pool).await.unwrap();
}
async fn restore_handoff_audit(pool: &hms_db::PgPool) {
    sqlx::query("DROP TRIGGER deny_handoff_audit ON audit_events")
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn handoff_audit_failure_rolls_back_and_concurrent_sender_finalization_is_immutable() {
    let db = TestDb::hospital().await.unwrap();
    let scope = db
        .scenario("handoff-audit")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let recipient = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let command = NewHandoff {
        id: Uuid::new_v4(),
        facility_id: db.facility_id(),
        ward_id: scope.ward.id,
        from_user_id: db.owner_user_id(),
        to_user_id: recipient,
        shift_label: "night".into(),
        request_id: None,
    };
    fail_handoff_audit(db.pool()).await;
    assert!(create_handoff(db.pool(), command.clone()).await.is_err());
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM handoffs WHERE id=$1")
        .bind(command.id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(rows, 0);
    restore_handoff_audit(db.pool()).await;
    let created = create_handoff(db.pool(), command.clone()).await.unwrap();
    assert!(created.completed_at.is_none());
    fail_handoff_audit(db.pool()).await;
    assert!(complete_handoff(
        db.pool(),
        db.facility_id(),
        created.id,
        db.owner_user_id(),
        None
    )
    .await
    .is_err());
    let status: (String, Option<chrono::DateTime<Utc>>) =
        sqlx::query_as("SELECT status,completed_at FROM handoffs WHERE id=$1")
            .bind(created.id)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(status, ("draft".into(), None));
    restore_handoff_audit(db.pool()).await;
    assert!(matches!(
        complete_handoff(db.pool(), db.facility_id(), created.id, recipient, None)
            .await
            .unwrap_err()
            .downcast_ref::<HandoffError>(),
        Some(HandoffError::NotSender)
    ));
    let mut completions = vec![];
    for _ in 0..8 {
        let pool = db.pool().clone();
        let facility = db.facility_id();
        let actor = db.owner_user_id();
        let id = created.id;
        completions.push(tokio::spawn(async move {
            complete_handoff(&pool, facility, id, actor, None)
                .await
                .unwrap()
                .unwrap()
        }));
    }
    let mut times = vec![];
    for result in completions {
        times.push(result.await.unwrap().completed_at.unwrap());
    }
    assert!(times.iter().all(|time| *time == times[0]));
    let audits:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='nursing.handoff.finalized'").bind(created.id).fetch_one(db.pool()).await.unwrap();
    assert_eq!(audits, 1);
    sqlx::query("UPDATE users SET is_active=false WHERE id=$1")
        .bind(recipient)
        .execute(db.pool())
        .await
        .unwrap();
    assert!(
        get_handoff(db.pool(), db.facility_id(), created.id)
            .await
            .unwrap()
            .is_some(),
        "historical inactive recipients remain readable"
    );
}

#[tokio::test]
async fn alert_acknowledgment_preserves_first_actor_time_and_atomic_audit_under_replay_and_races() {
    let db = TestDb::hospital().await.unwrap();
    let scope = db
        .scenario("alert-provenance")
        .admission_case_with_available_bed()
        .await
        .unwrap();
    let owner = db.owner_user_id();
    let recipient = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let command = NewNursingAlert {
        id: Uuid::new_v4(),
        facility_id: db.facility_id(),
        admission_case_id: scope.admission.id,
        patient_id: scope.patient.id,
        severity: hms_domain::ward::NursingAlertSeverity::Critical,
        title: "Synthetic provenance alert".into(),
        created_by_user_id: owner,
    };
    create_nursing_alert(db.pool(), command.clone())
        .await
        .unwrap();
    sqlx::query("CREATE FUNCTION deny_alert_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='nursing.alert.acknowledged' THEN RAISE EXCEPTION 'Synthetic alert audit denial'; END IF; RETURN NEW; END $$").execute(db.pool()).await.unwrap();
    sqlx::query("CREATE TRIGGER deny_alert_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_alert_audit()").execute(db.pool()).await.unwrap();
    assert!(
        acknowledge_nursing_alert(db.pool(), db.facility_id(), command.id, owner)
            .await
            .is_err()
    );
    let original: (String, Option<Uuid>, Option<chrono::DateTime<Utc>>) = sqlx::query_as(
        "SELECT status,acknowledged_by_user_id,acknowledged_at FROM nursing_alerts WHERE id=$1",
    )
    .bind(command.id)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(original, ("open".into(), None, None));
    sqlx::query("DROP TRIGGER deny_alert_audit ON audit_events")
        .execute(db.pool())
        .await
        .unwrap();
    let first = acknowledge_nursing_alert(db.pool(), db.facility_id(), command.id, owner)
        .await
        .unwrap()
        .unwrap();
    let before: (Uuid, chrono::DateTime<Utc>, chrono::DateTime<Utc>) = sqlx::query_as(
        "SELECT acknowledged_by_user_id,acknowledged_at,updated_at FROM nursing_alerts WHERE id=$1",
    )
    .bind(command.id)
    .fetch_one(db.pool())
    .await
    .unwrap();
    let repeated = acknowledge_nursing_alert(db.pool(), db.facility_id(), command.id, recipient)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.acknowledged_at, repeated.acknowledged_at);
    let after: (Uuid, chrono::DateTime<Utc>, chrono::DateTime<Utc>) = sqlx::query_as(
        "SELECT acknowledged_by_user_id,acknowledged_at,updated_at FROM nursing_alerts WHERE id=$1",
    )
    .bind(command.id)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(before, after);
    assert_eq!(after.0, owner);
    let audits: Vec<(Uuid, serde_json::Value)> = sqlx::query_as("SELECT actor_user_id,metadata FROM audit_events WHERE resource_id=$1 AND event_type='nursing.alert.acknowledged'").bind(command.id).fetch_all(db.pool()).await.unwrap();
    assert_eq!(audits, vec![(owner, serde_json::json!({}))]);

    let raced = NewNursingAlert {
        id: Uuid::new_v4(),
        ..command.clone()
    };
    create_nursing_alert(db.pool(), raced.clone())
        .await
        .unwrap();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(8));
    let mut attempts = vec![];
    for index in 0..8 {
        let pool = db.pool().clone();
        let facility = db.facility_id();
        let id = raced.id;
        let actor = if index % 2 == 0 { owner } else { recipient };
        let barrier = barrier.clone();
        attempts.push(tokio::spawn(async move {
            barrier.wait().await;
            acknowledge_nursing_alert(&pool, facility, id, actor)
                .await
                .unwrap()
                .unwrap()
        }));
    }
    let mut receipts = vec![];
    for attempt in attempts {
        receipts.push(attempt.await.unwrap());
    }
    assert!(receipts
        .iter()
        .all(|receipt| receipt.acknowledged_at == receipts[0].acknowledged_at));
    let actor: Uuid =
        sqlx::query_scalar("SELECT acknowledged_by_user_id FROM nursing_alerts WHERE id=$1")
            .bind(raced.id)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert!([owner, recipient].contains(&actor));
    let audits: Vec<Uuid> = sqlx::query_scalar("SELECT actor_user_id FROM audit_events WHERE resource_id=$1 AND event_type='nursing.alert.acknowledged'").bind(raced.id).fetch_all(db.pool()).await.unwrap();
    assert_eq!(audits, vec![actor]);

    // Historical acknowledged rows lacking an actor must not acquire a fictional
    // actor or a new timestamp merely because an authorized user opens the action.
    sqlx::query("UPDATE nursing_alerts SET acknowledged_by_user_id=NULL WHERE id=$1")
        .bind(command.id)
        .execute(db.pool())
        .await
        .unwrap();
    let legacy = acknowledge_nursing_alert(db.pool(), db.facility_id(), command.id, recipient)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(legacy.acknowledged_at, first.acknowledged_at);
    let legacy_actor: Option<Uuid> =
        sqlx::query_scalar("SELECT acknowledged_by_user_id FROM nursing_alerts WHERE id=$1")
            .bind(command.id)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(legacy_actor, None);
}
