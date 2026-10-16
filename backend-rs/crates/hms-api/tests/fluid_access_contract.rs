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

fn observation(patient: Uuid, admission: Uuid) -> Value {
    json!({"patient_id":patient,"client_request_id":Uuid::new_v4(),"admission_case_id":admission,"values":{"recorded_at":Utc::now()-Duration::minutes(1),"intake_ml":100,"output_ml":20,"metadata":{"intake_category":"oral","output_category":"urine","notes":"SYNTHETIC-PRIVATE-FLUID"}}})
}
async fn create(app: &TestApp, token: &str, patient: Uuid, admission: Uuid) -> Value {
    let r = send(
        app.clone(),
        token,
        Method::POST,
        "/api/v2/nursing/fluid-observations".into(),
        Some(observation(patient, admission)),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    json_body(r).await["data"].clone()
}
#[tokio::test]
async fn fluid_summary_is_scalar_while_all_narrative_and_write_surfaces_require_full() {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let saved = create(&app, &owner, patient, admission).await;
    let id = saved["entry_id"].as_str().unwrap();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, false).await;
    assign(&app, limited, ward).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let scalar = format!(
        "/api/v2/nursing/fluid-balance/summary?patient_id={patient}&admission_case_id={admission}"
    );
    assert_eq!(
        send(app.clone(), &token, Method::GET, scalar.clone(), None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::ClinicalSummary).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in [scalar,format!("/api/v2/nursing/fluid-balance/trends?patient_id={patient}&admission_case_id={admission}")]{let r=send(app.clone(),&token,Method::GET,path,None).await;assert_eq!(r.status(),StatusCode::OK);let v=json_body(r).await;assert!(!v.to_string().contains("SYNTHETIC-PRIVATE-FLUID"));assert!(!v.to_string().contains("metadata"));assert!(!v.to_string().contains("patient_display_name"));}
    for path in [format!("/api/v2/nursing/fluid-balance?patient_id={patient}"),format!("/api/v2/nursing/fluid-observations?patient_id={patient}"),format!("/api/v2/nursing/fluid-observations/summary?patient_id={patient}"),format!("/api/v2/nursing/fluid-observations/{id}"),format!("/api/v2/nursing/fluid-observations/{id}/history"),format!("/api/v2/nursing/fluid-observations/context?patient_id={patient}&admission_case_id={admission}"),format!("/api/v2/nursing/fluid-monitoring/assessment?admission_case_id={admission}")]{let r=send(app.clone(),&token,Method::GET,path,None).await;assert_eq!(r.status(),StatusCode::FORBIDDEN);assert!(!json_body(r).await.to_string().contains("SYNTHETIC-PRIVATE-FLUID"));}
    for (path, body) in [
        (
            "/api/v2/nursing/fluid-observations".into(),
            observation(patient, admission),
        ),
        (
            "/api/v2/nursing/fluid-balance".into(),
            json!({"patient_id":patient,"admission_case_id":admission,"recorded_at":Utc::now(),"intake_ml":100,"output_ml":0}),
        ),
        (
            format!("/api/v2/nursing/fluid-observations/{id}/void"),
            json!({"client_request_id":Uuid::new_v4(),"reason":"Synthetic review"}),
        ),
        (
            format!("/api/v2/nursing/fluid-observations/{id}/corrections"),
            json!({"client_request_id":Uuid::new_v4(),"reason":"Synthetic review","replacement":observation(patient,admission)["values"]}),
        ),
    ] {
        assert_eq!(
            send(app.clone(), &token, Method::POST, path, Some(body))
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_balance_entries WHERE admission_case_id=$1")
            .bind(admission)
            .fetch_one(&app.db_pool().await)
            .await
            .unwrap();
    assert_eq!(count, 1);
}
#[tokio::test]
async fn fluid_scoped_pages_and_totals_use_actual_ward_and_reviewed_patient_context() {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    create(&app, &owner, patient, admission).await;
    create(&app, &owner, patient, admission).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let other:Uuid=sqlx::query_scalar("INSERT INTO wards(id,facility_id,code,name,status) VALUES(gen_random_uuid(),$1,'FLUID10-OTHER','Synthetic other ward','active') RETURNING id").bind(facility).fetch_one(&pool).await.unwrap();
    let other_admission:Uuid=sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'discharged') RETURNING id").bind(facility).bind(patient).bind(other).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO fluid_balance_entries(id,facility_id,patient_id,admission_case_id,recorded_at,intake_ml,output_ml) SELECT gen_random_uuid(),$1,$2,$3,now(),900,0 FROM generate_series(1,125)").bind(facility).bind(patient).bind(other_admission).execute(&pool).await.unwrap();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, true).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let context=format!("/api/v2/nursing/fluid-observations/context?patient_id={patient}&admission_case_id={admission}");
    assert_eq!(
        send(app.clone(), &token, Method::GET, context.clone(), None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assign(&app, limited, ward).await;
    let r = send(app.clone(), &token, Method::GET, context.clone(), None).await;
    assert_eq!(r.status(), StatusCode::OK);
    let v = json_body(r).await;
    assert_eq!(v["data"]["patient_id"], patient.to_string());
    assert_eq!(v["data"]["status"], "admitted");
    assert_eq!(v["data"]["can_record_observation"], true);
    for path in ["fluid-observations", "fluid-balance"] {
        let r = send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/nursing/{path}?patient_id={patient}&descending=true&limit=1"),
            None,
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        let v = json_body(r).await;
        assert_eq!(v["data"].as_array().unwrap().len(), 1);
        assert_eq!(v["data"][0]["admission_case_id"], admission.to_string());
        assert_eq!(v["page"]["has_next"], true);
        let c = v["page"]["next_cursor"].as_str().unwrap();
        let r = send(
            app.clone(),
            &token,
            Method::GET,
            format!(
                "/api/v2/nursing/{path}?patient_id={patient}&descending=true&limit=1&cursor={c}"
            ),
            None,
        )
        .await;
        let next = json_body(r).await;
        assert_eq!(next["data"].as_array().unwrap().len(), 1);
        assert_eq!(next["page"]["has_next"], false);
        assert_ne!(next["data"][0]["id"], v["data"][0]["id"]);
    }
    for path in ["fluid-observations/summary", "fluid-balance/summary"] {
        let r = send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/nursing/{path}?patient_id={patient}"),
            None,
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        let v = json_body(r).await;
        assert_eq!(v["data"]["entry_count"], 2);
        assert_eq!(v["data"]["total_intake_ml"], 200);
    }
    let wrong: Uuid =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id<>$2 LIMIT 1")
            .bind(facility)
            .bind(patient)
            .fetch_one(&pool)
            .await
            .unwrap();
    for (path, body) in [
        (
            "/api/v2/nursing/fluid-observations",
            observation(wrong, admission),
        ),
        (
            "/api/v2/nursing/fluid-balance",
            json!({"patient_id":wrong,"admission_case_id":admission,"recorded_at":Utc::now(),"intake_ml":100,"output_ml":0}),
        ),
    ] {
        assert_eq!(
            send(app.clone(), &token, Method::POST, path.into(), Some(body))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
        .bind(admission)
        .execute(&pool)
        .await
        .unwrap();
    let r = send(app.clone(), &token, Method::GET, context, None).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(json_body(r).await["data"]["can_record_observation"], false);
    for (path, body) in [
        (
            "/api/v2/nursing/fluid-observations",
            observation(patient, admission),
        ),
        (
            "/api/v2/nursing/fluid-balance",
            json!({"patient_id":patient,"admission_case_id":admission,"recorded_at":Utc::now(),"intake_ml":100,"output_ml":0}),
        ),
    ] {
        assert_eq!(
            send(app.clone(), &token, Method::POST, path.into(), Some(body))
                .await
                .status(),
            StatusCode::CONFLICT
        );
    }
}
async fn wait_for_block(pool: &hms_db::PgPool, pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{let n:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))").bind(pid).fetch_one(pool).await.unwrap();if n>0{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("actual HTTP nursing operation waits on held source");
}

async fn waiting_fluid(read: bool, expire: bool) {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let made = create(&app, &owner, patient, admission).await;
    let root = Uuid::parse_str(made["root_entry_id"].as_str().unwrap()).unwrap();
    let id = made["entry_id"].as_str().unwrap().to_owned();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, true).await;
    assign(&app, limited, ward).await;
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
    sqlx::query("SELECT id FROM fluid_observation_roots WHERE id=$1 FOR UPDATE")
        .bind(root)
        .execute(&mut *held)
        .await
        .unwrap();
    let copy = app.clone();
    let path = if read {
        format!("/api/v2/nursing/fluid-observations/{id}/history")
    } else {
        format!("/api/v2/nursing/fluid-observations/{id}/void")
    };
    let key = Uuid::new_v4();
    let pending = tokio::spawn(async move {
        send(
            copy,
            &token,
            if read { Method::GET } else { Method::POST },
            path,
            (!read).then(|| json!({"client_request_id":key,"reason":"Synthetic waiting review"})),
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
    let current: Option<Uuid> =
        sqlx::query_scalar("SELECT current_entry_id FROM fluid_observation_roots WHERE id=$1")
            .bind(root)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(current.is_some());
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_write_commands WHERE client_request_id=$1")
            .bind(key)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 0);
}
#[tokio::test]
async fn fluid_read_wait_rechecks_natural_permission_expiry() {
    waiting_fluid(true, true).await;
}
#[tokio::test]
async fn fluid_write_wait_rechecks_revoked_session() {
    waiting_fluid(false, false).await;
}
#[tokio::test]
async fn fluid_configuration_uses_explicit_admin_without_inferred_nursing_or_full() {
    let app = app().await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, limited, PermissionCode::AdminAuthorityManage).await;
    grant_test_feature(&app, limited, FeatureKey::Admin).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let p = json!({"client_request_id":Uuid::new_v4(),"expected_version":0,"reason":"Synthetic explicit admin review","values":{"min_daily_intake_target":1500,"max_daily_output_threshold":3000,"negative_balance_alert_threshold":-500,"positive_balance_alert_threshold":2000,"enable_intake_alerts":false,"enable_output_alerts":false,"enable_balance_alerts":false}});
    let r = send(
        app.clone(),
        &token,
        Method::POST,
        "/api/v2/nursing/fluid-monitoring/rules".into(),
        Some(p),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        send(
            app.clone(),
            &token,
            Method::GET,
            "/api/v2/nursing/fluid-monitoring/rules".into(),
            None
        )
        .await
        .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn fluid_source_read_and_mutation_cannot_cross_current_ward_authority() {
    let app = app().await;
    let (patient, admission, _) = fixture(&app).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let made = create(&app, &owner, patient, admission).await;
    let id = made["entry_id"].as_str().unwrap();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, true).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in [format!("/api/v2/nursing/fluid-observations/{id}"),format!("/api/v2/nursing/fluid-observations/{id}/history"),format!("/api/v2/nursing/fluid-balance/summary?patient_id={patient}&admission_case_id={admission}")]{assert_eq!(send(app.clone(),&token,Method::GET,path,None).await.status(),StatusCode::FORBIDDEN);}
    for (suffix, body) in [
        (
            "void",
            json!({"client_request_id":Uuid::new_v4(),"reason":"Synthetic unauthorized change"}),
        ),
        (
            "corrections",
            json!({"client_request_id":Uuid::new_v4(),"reason":"Synthetic unauthorized change","replacement":observation(patient,admission)["values"]}),
        ),
    ] {
        assert_eq!(
            send(
                app.clone(),
                &token,
                Method::POST,
                format!("/api/v2/nursing/fluid-observations/{id}/{suffix}"),
                Some(body)
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
    }
    let pool = app.db_pool().await;
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM fluid_balance_entries WHERE admission_case_id=$1),(SELECT count(*) FROM fluid_observation_actions),(SELECT count(*) FROM fluid_write_commands)").bind(admission).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 0, 1));
}
#[tokio::test]
async fn legacy_fluid_scalar_read_rechecks_session_after_facility_wait() {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, false).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::ClinicalSummary).await;
    assign(&app, limited, ward).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
        .bind(app.state().facility_id())
        .execute(&mut *held)
        .await
        .unwrap();
    let copy = app.clone();
    let pending = tokio::spawn(async move {
        send(copy,&token,Method::GET,format!("/api/v2/nursing/fluid-balance/summary?patient_id={patient}&admission_case_id={admission}"),None).await
    });
    wait_for_block(&pool, pid).await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&pool)
        .await
        .unwrap();
    held.commit().await.unwrap();
    assert_eq!(pending.await.unwrap().status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unsupported_legacy_fluid_fields_are_rejected_without_echo_or_write() {
    let app = app().await;
    let (patient, admission, _) = fixture(&app).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let r=send(app.clone(),&owner,Method::POST,"/api/v2/nursing/fluid-balance".into(),Some(json!({"patient_id":patient,"admission_case_id":admission,"recorded_at":Utc::now(),"intake_ml":100,"output_ml":0,"notes":"SYNTHETIC-UNSAVED-PRIVATE-DETAIL"}))).await;
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert!(!json_body(r)
        .await
        .to_string()
        .contains("SYNTHETIC-UNSAVED-PRIVATE-DETAIL"));
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_balance_entries WHERE admission_case_id=$1")
            .bind(admission)
            .fetch_one(&app.db_pool().await)
            .await
            .unwrap();
    assert_eq!(n, 0);
}
