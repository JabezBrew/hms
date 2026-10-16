mod support;
use support::*;
async fn send(
    app: TestApp,
    token: &str,
    method: Method,
    path: String,
    body: Option<Value>,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = if let Some(value) = body {
        request = request.header("content-type", "application/json");
        Body::from(serde_json::to_vec(&value).unwrap())
    } else {
        Body::empty()
    };
    app.oneshot(request.body(body).unwrap()).await.unwrap()
}
async fn fixture(app: &TestApp) -> (Uuid, Uuid, Uuid) {
    grant_test_patient_visibility(
        app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PatientDataVisibility::FullClinical,
    )
    .await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let admission:Uuid=sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'admitted') RETURNING id").bind(facility).bind(patient).bind(ward).fetch_one(&pool).await.unwrap();
    (patient, admission, ward)
}
async fn grant_nursing(app: &TestApp, user: Uuid, clinical: bool) {
    grant_test_permission(app, user, PermissionCode::NursingTaskManage).await;
    grant_test_permission(app, user, PermissionCode::PatientDemographicsView).await;
    grant_test_feature(app, user, FeatureKey::Nursing).await;
    grant_test_patient_visibility(app, user, PatientDataVisibility::Demographics).await;
    if clinical {
        grant_test_patient_visibility(app, user, PatientDataVisibility::FullClinical).await;
    }
}
async fn assign(app: &TestApp, user: Uuid, ward: Uuid) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let staff:Uuid=sqlx::query_scalar("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic nursing','Nurse',CURRENT_DATE) ON CONFLICT(user_id) DO UPDATE SET position=staff_profiles.position RETURNING id").bind(facility).bind(user).bind(format!("H-{user}")).fetch_one(&pool).await.unwrap();
    let practitioner:Uuid=sqlx::query_scalar("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES(gen_random_uuid(),$1,$2,$3,'Nursing','Synthetic') ON CONFLICT(staff_id) DO UPDATE SET qualification=practitioner_profiles.qualification RETURNING id").bind(facility).bind(staff).bind(format!("L-{user}")).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES(gen_random_uuid(),$1,$2,$3,'staff_nurse','Nurse','nursing') ON CONFLICT DO NOTHING").bind(facility).bind(ward).bind(practitioner).execute(&pool).await.unwrap();
}

fn task(admission: Uuid) -> Value {
    json!({"admission_case_id":admission,"task_type":"observation","title":"Synthetic task","instruction":"Synthetic private instruction","due_at":Utc::now(),"assigned_to_user_id":null})
}
fn vital(admission: Uuid) -> Value {
    json!({"admission_case_id":admission,"recorded_at":Utc::now(),"pulse":80})
}
async fn create_task(app: &TestApp, token: &str, admission: Uuid) -> Value {
    let response = send(
        app.clone(),
        token,
        Method::POST,
        "/api/v2/nursing/tasks".into(),
        Some(task(admission)),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await["data"].clone()
}
#[tokio::test]
async fn scalar_summary_reads_remain_available_while_narratives_and_writes_require_full() {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    assert_eq!(
        send(
            app.clone(),
            &owner,
            Method::POST,
            "/api/v2/nursing/vitals".into(),
            Some(vital(admission))
        )
        .await
        .status(),
        StatusCode::OK
    );
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, false).await;
    assign(&app, limited, ward).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/nursing/vitals?patient_id={patient}"),
            None
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::ClinicalSummary).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let response = send(
        app.clone(),
        &token,
        Method::GET,
        format!(
            "/api/v2/nursing/vitals?patient_id={patient}&admission_case_id={admission}&limit=1"
        ),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["data"][0]["pulse"], 80);
    for path in ["tasks", "monitoring-events", "alerts"] {
        let response = send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/nursing/{path}?patient_id={patient}"),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!json_body(response)
            .await
            .to_string()
            .contains("Synthetic private"));
    }
    for (path, body) in [
        ("tasks", task(admission)),
        ("vitals", vital(admission)),
        (
            "monitoring-events",
            json!({"admission_case_id":admission,"event_kind":"observation","summary":"Synthetic private summary","recorded_at":Utc::now()}),
        ),
        (
            "alerts",
            json!({"admission_case_id":admission,"severity":"high","title":"Synthetic private alert"}),
        ),
    ] {
        assert_eq!(
            send(
                app.clone(),
                &token,
                Method::POST,
                format!("/api/v2/nursing/{path}"),
                Some(body)
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
    }
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::FullClinical).await;
    let pool = app.db_pool().await;
    sqlx::query("DELETE FROM user_features WHERE user_id=$1 AND feature_key='nursing'")
        .bind(limited)
        .execute(&pool)
        .await
        .unwrap();
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for (path, body) in [
        ("tasks", task(admission)),
        ("vitals", vital(admission)),
        (
            "monitoring-events",
            json!({"admission_case_id":admission,"event_kind":"observation","summary":"Synthetic private summary","recorded_at":Utc::now()}),
        ),
    ] {
        assert_eq!(
            send(
                app.clone(),
                &token,
                Method::POST,
                format!("/api/v2/nursing/{path}"),
                Some(body)
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
    }
}
#[tokio::test]
async fn task_terminal_http_receipts_preserve_actual_actor_time_and_reject_other_decisions() {
    let app = app().await;
    let (_, admission, ward) = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let saved = create_task(&app, &token, admission).await;
    assert_eq!(saved["ward_id"], ward.to_string());
    assert!(saved["assigned_to_user_id"].is_null());
    let id = saved["id"].as_str().unwrap();
    let unsupported = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/nursing/tasks/{id}/complete"),
        Some(json!({"completion_notes":"SYNTHETIC-UNSAVED"})),
    )
    .await;
    assert_eq!(unsupported.status(), StatusCode::BAD_REQUEST);
    assert!(!json_body(unsupported)
        .await
        .to_string()
        .contains("SYNTHETIC-UNSAVED"));
    let completed = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/nursing/tasks/{id}/complete"),
        None,
    )
    .await;
    assert_eq!(completed.status(), StatusCode::OK);
    let completed = json_body(completed).await["data"].clone();
    assert!(completed["completed_at"].is_string());
    assert_eq!(
        completed["completed_by_user_id"],
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID).to_string()
    );
    let replay = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/nursing/tasks/{id}/complete"),
        None,
    )
    .await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(json_body(replay).await["data"], completed);
    let wrong = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/nursing/tasks/{id}/cancel"),
        None,
    )
    .await;
    assert_eq!(wrong.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(wrong).await["error"]["code"],
        "nursing_decision_conflict"
    );
    let cancelled = create_task(&app, &token, admission).await;
    let id = cancelled["id"].as_str().unwrap();
    assert_eq!(
        send(
            app.clone(),
            &token,
            Method::POST,
            format!("/api/v2/nursing/tasks/{id}/cancel"),
            None
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        send(
            app.clone(),
            &token,
            Method::POST,
            format!("/api/v2/nursing/tasks/{id}/complete"),
            None
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    let mut bad = task(admission);
    bad["unsupported_private_field"] = json!("SYNTHETIC-SECRET");
    let denied = send(
        app.clone(),
        &token,
        Method::POST,
        "/api/v2/nursing/tasks".into(),
        Some(bad),
    )
    .await;
    assert_eq!(denied.status(), StatusCode::BAD_REQUEST);
    assert!(!json_body(denied)
        .await
        .to_string()
        .contains("SYNTHETIC-SECRET"));
    let empty = json!({"admission_case_id":admission,"recorded_at":Utc::now()});
    assert_eq!(
        send(
            app.clone(),
            &token,
            Method::POST,
            "/api/v2/nursing/vitals".into(),
            Some(empty)
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    for path in ["tasks", "vitals", "monitoring-events"] {
        let denied = send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/nursing/{path}?private_unknown=SYNTHETIC-SECRET"),
            None,
        )
        .await;
        assert_eq!(denied.status(), StatusCode::BAD_REQUEST);
        assert!(!json_body(denied)
            .await
            .to_string()
            .contains("SYNTHETIC-SECRET"));
    }
}
async fn wait_for_block(pool: &hms_db::PgPool, pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{let n:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))").bind(pid).fetch_one(pool).await.unwrap();if n>0{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("actual HTTP nursing operation waits on held source");
}
async fn waiting_proof(read: bool, expire: bool) {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, true).await;
    assign(&app, limited, ward).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let task = create_task(&app, &owner, admission).await;
    let id = task["id"].as_str().unwrap().to_owned();
    let ends = if expire {
        sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='nursing.task.manage'").bind(limited).execute(&pool).await.unwrap();
        let ends: chrono::DateTime<Utc> =
            sqlx::query_scalar("SELECT clock_timestamp()+interval '4 seconds'")
                .fetch_one(&pool)
                .await
                .unwrap();
        hms_db::admin::create_permission_assignment(
            &pool,
            hms_db::admin::NewPermissionAssignment {
                facility_id: facility,
                grantee_user_id: limited,
                permission_code: PermissionCode::NursingTaskManage,
                scope_type: "facility".into(),
                scope_id: None,
                granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
                starts_at: ends - Duration::minutes(1),
                ends_at: Some(ends),
                reason_code: "temporary_nursing_cover".into(),
            },
            None,
        )
        .await
        .unwrap();
        Some(ends)
    } else {
        None
    };
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let claims = access_claims(&token);
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    if read {
        sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
            .bind(facility)
            .execute(&mut *held)
            .await
            .unwrap();
    } else {
        sqlx::query("SELECT id FROM nursing_tasks WHERE id=$1 FOR UPDATE")
            .bind(Uuid::parse_str(&id).unwrap())
            .execute(&mut *held)
            .await
            .unwrap();
    }
    let path = if read {
        format!("/api/v2/nursing/vitals?patient_id={patient}")
    } else {
        format!("/api/v2/nursing/tasks/{id}/complete")
    };
    let copy = app.clone();
    let pending = tokio::spawn(async move {
        send(
            copy,
            &token,
            if read { Method::GET } else { Method::POST },
            path,
            None,
        )
        .await
    });
    wait_for_block(&pool, pid).await;
    if let Some(ends) = ends {
        let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(ends).fetch_one(&pool).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 50)).await;
    } else {
        sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
            .bind(claims.session_id)
            .execute(&pool)
            .await
            .unwrap();
    }
    held.commit().await.unwrap();
    let denied = pending.await.unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "nursing_authorization_expired"
    );
    let status: String = sqlx::query_scalar("SELECT status FROM nursing_tasks WHERE id=$1")
        .bind(Uuid::parse_str(&id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "open");
}
#[tokio::test]
async fn waiting_task_http_write_rechecks_revoked_session() {
    waiting_proof(false, false).await;
}
#[tokio::test]
async fn waiting_task_http_write_rechecks_natural_nursing_grant_expiry() {
    waiting_proof(false, true).await;
}
#[tokio::test]
async fn waiting_scalar_http_read_rechecks_revoked_session() {
    waiting_proof(true, false).await;
}
#[tokio::test]
async fn waiting_scalar_http_read_rechecks_natural_nursing_grant_expiry() {
    waiting_proof(true, true).await;
}

#[tokio::test]
async fn actual_nursing_pages_apply_ward_relationships_before_limit_and_cursor() {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, true).await;
    assign(&app, limited, ward).await;
    let other:Uuid=sqlx::query_scalar("INSERT INTO wards(id,facility_id,code,name,status) VALUES(gen_random_uuid(),$1,'NURSING9-OTHER','Synthetic other ward','active') RETURNING id").bind(facility).fetch_one(&pool).await.unwrap();
    let other_admission:Uuid=sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'discharged') RETURNING id").bind(facility).bind(patient).bind(other).fetch_one(&pool).await.unwrap();
    for(table,extra,values,time)in[("nursing_tasks",",ward_id,task_type,instruction,status,due_at",format!(",'{other}','observation','Synthetic unassigned instruction','open',clock_timestamp()-interval '1 day'"),"due_at"),("patient_vitals",",pulse,recorded_at",",81,clock_timestamp()-interval '1 day'".into(),"recorded_at"),("monitoring_events",",event_kind,summary,recorded_at",",'observation','Synthetic unassigned narrative',clock_timestamp()-interval '1 day'".into(),"recorded_at"),("nursing_alerts",",severity,title,status,created_at",",'high','Synthetic unassigned alert','open',clock_timestamp()-interval '1 day'".into(),"created_at")]{
  let sql=format!("INSERT INTO {table}(id,facility_id,admission_case_id,patient_id{extra}) SELECT gen_random_uuid(),$1,$2,$3{values} FROM generate_series(1,30)");sqlx::query(&sql).bind(facility).bind(other_admission).bind(patient).execute(&pool).await.unwrap();let _=time;
 }
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let first = create_task(&app, &owner, admission).await;
    let second = create_task(&app, &owner, admission).await;
    for (path, body) in [
        ("vitals", vital(admission)),
        (
            "monitoring-events",
            json!({"admission_case_id":admission,"event_kind":"observation","summary":"Synthetic selected narrative","recorded_at":Utc::now()}),
        ),
        (
            "alerts",
            json!({"admission_case_id":admission,"severity":"high","title":"Synthetic selected alert"}),
        ),
    ] {
        assert_eq!(
            send(
                app.clone(),
                &owner,
                Method::POST,
                format!("/api/v2/nursing/{path}"),
                Some(body)
            )
            .await
            .status(),
            StatusCode::OK
        );
    }
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in ["tasks", "vitals", "monitoring-events", "alerts"] {
        let response = send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/nursing/{path}?patient_id={patient}&limit=1"),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let response = json_body(response).await;
        assert_eq!(
            response["data"][0]["admission_case_id"],
            admission.to_string()
        );
        assert!(!response.to_string().contains("unassigned"));
        let denied = send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/nursing/{path}?ward_id={other}&limit=1"),
            None,
        )
        .await;
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        if path == "tasks" {
            assert_eq!(response["data"][0]["id"], first["id"]);
            let cursor = response["page"]["next_cursor"].as_str().unwrap();
            let next = send(
                app.clone(),
                &token,
                Method::GET,
                format!("/api/v2/nursing/tasks?patient_id={patient}&limit=1&cursor={cursor}"),
                None,
            )
            .await;
            assert_eq!(next.status(), StatusCode::OK);
            assert_eq!(json_body(next).await["data"][0]["id"], second["id"]);
        }
    }
}

#[tokio::test]
async fn reviewed_patient_mismatch_rejects_vital_and_task_creation_before_any_insert_or_audit() {
    let app = app().await;
    let (patient, admission, _) = fixture(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let other: Uuid =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id<>$2 LIMIT 1")
            .bind(facility)
            .bind(patient)
            .fetch_one(&pool)
            .await
            .unwrap();
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let before:(i64,i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM nursing_tasks),(SELECT count(*) FROM patient_vitals),(SELECT count(*) FROM audit_events)").fetch_one(&pool).await.unwrap();
    for (path, mut body) in [("tasks", task(admission)), ("vitals", vital(admission))] {
        body["patient_id"] = json!(other);
        let response = send(
            app.clone(),
            &token,
            Method::POST,
            format!("/api/v2/nursing/{path}"),
            Some(body),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            json_body(response).await["error"]["code"],
            "invalid_nursing_patient_context"
        );
    }
    let after:(i64,i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM nursing_tasks),(SELECT count(*) FROM patient_vitals),(SELECT count(*) FROM audit_events)").fetch_one(&pool).await.unwrap();
    assert_eq!(after, before);
    for (path, mut body) in [("tasks", task(admission)), ("vitals", vital(admission))] {
        body["patient_id"] = json!(patient);
        let response = send(
            app.clone(),
            &token,
            Method::POST,
            format!("/api/v2/nursing/{path}"),
            Some(body),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            json_body(response).await["data"]["patient_id"],
            patient.to_string()
        );
    }
}
