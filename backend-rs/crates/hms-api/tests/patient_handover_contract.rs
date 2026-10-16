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
fn input(patient: Uuid, admission: Uuid) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"patient_id":patient,"admission_case_id":admission,"shift_date":Utc::now().date_naive(),"shift_type":"night","intended_recipient_user_id":null,"narrative":{"patient_condition":"Synthetic clinical handover condition","ongoing_issues":"Synthetic ongoing issue","pending_tasks":"Synthetic narrative only","medication_changes":"Synthetic narrative only","key_events":"Synthetic event","care_plan_updates":"Synthetic plan","family_updates":"Synthetic family update"}})
}
fn amend(saved: &Value) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"expected_revision":saved["handover"]["revision"],"shift_date":saved["handover"]["current"]["shift_date"],"shift_type":"evening","intended_recipient_user_id":null,"narrative":saved["handover"]["current"]["narrative"],"reason":"Synthetic correction reason"})
}

#[tokio::test]
async fn actual_http_patient_handover_records_amends_voids_and_recovers_immutable_history() {
    let app = app().await;
    let pool = app.db_pool().await;
    let (patient, admission, _) = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let command = input(patient, admission);
    let saved = send(
        app.clone(),
        &token,
        Method::POST,
        "/api/v2/nursing/patient-handovers".into(),
        Some(command.clone()),
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = json_body(saved).await["data"].clone();
    let id = saved["handover"]["id"].as_str().unwrap();
    let original = saved["handover"]["current"]["id"].as_str().unwrap();
    assert_eq!(saved["handover"]["patient_id"], patient.to_string());
    assert_eq!(saved["handover"]["revision"], 1);
    let list=send(app.clone(),&token,Method::GET,format!("/api/v2/nursing/patient-handovers?patient_id={patient}&admission_case_id={admission}&limit=1"),None).await;
    assert_eq!(list.status(), StatusCode::OK);
    let list = json_body(list).await;
    assert!(list["data"][0].get("narrative").is_none());
    assert!(list["data"][0].get("current").is_none());
    sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
        .bind(admission)
        .execute(&pool)
        .await
        .unwrap();
    let amended = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/nursing/patient-handovers/{id}/amend"),
        Some(amend(&saved)),
    )
    .await;
    assert_eq!(amended.status(), StatusCode::OK);
    let amended = json_body(amended).await;
    assert_eq!(amended["data"]["handover"]["revision"], 2);
    let void=send(app.clone(),&token,Method::POST,format!("/api/v2/nursing/patient-handovers/{id}/void"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_revision":2,"reason":"Synthetic duplicate report"}))).await;
    assert_eq!(void.status(), StatusCode::OK);
    assert_eq!(
        json_body(void).await["data"]["handover"]["status"],
        "voided"
    );
    let history = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/nursing/patient-handovers/{id}/history?limit=2"),
        None,
    )
    .await;
    assert_eq!(history.status(), StatusCode::OK);
    let history = json_body(history).await;
    assert_eq!(history["data"].as_array().unwrap().len(), 2);
    assert_eq!(history["page"]["has_next"], true);
    assert!(history["data"][0].get("narrative").is_none());
    let original_read = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/nursing/patient-handovers/{id}/revisions/{original}"),
        None,
    )
    .await;
    assert_eq!(original_read.status(), StatusCode::OK);
    assert_eq!(
        json_body(original_read).await["data"]["narrative"],
        command["narrative"]
    );
    let key = command["client_request_id"].as_str().unwrap();
    let receipt = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/nursing/patient-handovers/requests/{key}?patient_id={patient}"),
        None,
    )
    .await;
    assert_eq!(receipt.status(), StatusCode::OK);
    assert_eq!(
        json_body(receipt).await["data"]["handover"],
        saved["handover"]
    );
    let replay = send(
        app.clone(),
        &token,
        Method::POST,
        "/api/v2/nursing/patient-handovers".into(),
        Some(command),
    )
    .await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(
        json_body(replay).await["data"]["handover"],
        saved["handover"]
    );
    let closed = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/nursing/patient-handovers?patient_id={patient}&include_voided=true"),
        None,
    )
    .await;
    assert_eq!(json_body(closed).await["data"].as_array().unwrap().len(), 1);
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

#[tokio::test]
async fn full_clinical_data_class_does_not_grant_unassigned_ward_access() {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, true).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for(method,path,body)in[(Method::GET,format!("/api/v2/nursing/patient-handovers?patient_id={patient}&admission_case_id={admission}"),None),(Method::GET,format!("/api/v2/nursing/patient-handovers/recipients?patient_id={patient}&admission_case_id={admission}"),None),(Method::POST,"/api/v2/nursing/patient-handovers".into(),Some(input(patient,admission)))]{let r=send(app.clone(),&token,method,path,body).await;assert_eq!(r.status(),StatusCode::FORBIDDEN);assert_eq!(json_body(r).await["error"]["code"],"handover_ward_scope_denied");}
    assign(&app, limited, ward).await;
    let recorded = send(
        app.clone(),
        &token,
        Method::POST,
        "/api/v2/nursing/patient-handovers".into(),
        Some(input(patient, admission)),
    )
    .await;
    assert_eq!(recorded.status(), StatusCode::OK);
    let saved = json_body(recorded).await["data"].clone();
    let id = saved["handover"]["id"].as_str().unwrap();
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let other_actor = send(
        app.clone(),
        &owner_token,
        Method::POST,
        format!("/api/v2/nursing/patient-handovers/{id}/amend"),
        Some(amend(&saved)),
    )
    .await;
    assert_eq!(other_actor.status(), StatusCode::FORBIDDEN);
    let pool = app.db_pool().await;
    sqlx::query("UPDATE ward_staff_assignments SET is_active=false,is_primary=false WHERE facility_id=$1 AND ward_id=$2").bind(app.state().facility_id()).bind(ward).execute(&pool).await.unwrap();
    for path in [
        format!("/api/v2/nursing/patient-handovers/{id}"),
        format!("/api/v2/nursing/patient-handovers/{id}/history"),
        format!(
            "/api/v2/nursing/patient-handovers/requests/{}?patient_id={patient}",
            saved["client_request_id"].as_str().unwrap()
        ),
    ] {
        assert_eq!(
            send(app.clone(), &token, Method::GET, path, None)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
}

#[tokio::test]
async fn narrative_access_requires_feature_and_full_clinical_and_rejects_unsupported_fields() {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let saved = send(
        app.clone(),
        &owner,
        Method::POST,
        "/api/v2/nursing/patient-handovers".into(),
        Some(input(patient, admission)),
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = json_body(saved).await["data"].clone();
    let id = saved["handover"]["id"].as_str().unwrap();
    grant_nursing(&app, limited, false).await;
    assign(&app, limited, ward).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in [
        format!("/api/v2/nursing/patient-handovers?patient_id={patient}"),
        format!("/api/v2/nursing/patient-handovers/{id}"),
        format!("/api/v2/nursing/patient-handovers/{id}/history"),
    ] {
        assert_eq!(
            send(app.clone(), &token, Method::GET, path, None)
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
    let (no_feature, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        send(
            app.clone(),
            &no_feature,
            Method::POST,
            "/api/v2/nursing/patient-handovers".into(),
            Some(input(patient, admission))
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );

    let mut bad = input(patient, admission);
    bad["acknowledged"] = json!(true);
    let rejected = send(
        app.clone(),
        &owner,
        Method::POST,
        "/api/v2/nursing/patient-handovers".into(),
        Some(bad),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let body = json_body(rejected).await;
    assert!(!body.to_string().contains("Synthetic clinical"));
    assert_eq!(body["error"]["code"], "invalid_patient_handover_request");
    let unknown = send(
        app.clone(),
        &owner,
        Method::GET,
        format!(
            "/api/v2/nursing/patient-handovers?patient_id={patient}&free_text=SYNTHETIC-PRIVATE"
        ),
        None,
    )
    .await;
    assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
    assert!(!json_body(unknown)
        .await
        .to_string()
        .contains("SYNTHETIC-PRIVATE"));
}

async fn waiting_handover_requires_live_authority(expire_grant: bool, read_only: bool) {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_nursing(&app, limited, true).await;
    assign(&app, limited, ward).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let created = send(
        app.clone(),
        &token,
        Method::POST,
        "/api/v2/nursing/patient-handovers".into(),
        Some(input(patient, admission)),
    )
    .await;
    assert_eq!(created.status(), StatusCode::OK);
    let saved = json_body(created).await["data"].clone();
    let id = Uuid::parse_str(saved["handover"]["id"].as_str().unwrap()).unwrap();
    let expiry = if expire_grant {
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
    assert_eq!(
        send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/nursing/patient-handovers/{id}"),
            None
        )
        .await
        .status(),
        StatusCode::OK
    );
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM patient_handovers WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *held)
        .await
        .unwrap();
    let mut pending = Vec::new();
    let paths = if read_only {
        vec![
            format!("/api/v2/nursing/patient-handovers/{id}"),
            format!("/api/v2/nursing/patient-handovers/{id}/history"),
            format!(
                "/api/v2/nursing/patient-handovers/{id}/revisions/{}",
                saved["handover"]["current"]["id"].as_str().unwrap()
            ),
            format!(
                "/api/v2/nursing/patient-handovers/requests/{}?patient_id={patient}",
                saved["client_request_id"].as_str().unwrap()
            ),
        ]
    } else {
        vec![format!("/api/v2/nursing/patient-handovers/{id}/amend")]
    };
    let expected_waiters = paths.len() as i64;
    for path in paths {
        let pending_app = app.clone();
        let token = token.clone();
        let request = if read_only { None } else { Some(amend(&saved)) };
        pending.push(tokio::spawn(async move {
            send(
                pending_app,
                &token,
                if read_only { Method::GET } else { Method::POST },
                path,
                request,
            )
            .await
        }));
    }
    tokio::time::timeout(std::time::Duration::from_secs(2),async{loop{let waiting:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))").bind(pid).fetch_one(&pool).await.unwrap();if waiting>=expected_waiters{break;}assert!(pending.iter().all(|p| !p.is_finished()),"authorized handover writer must wait on the source row");tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("real handover writer reaches held source lock");
    if let Some(ends) = expiry {
        let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(ends).fetch_one(&pool).await.unwrap();
        assert!(
            remaining > 0,
            "request reached the row while managed permission was still live"
        );
        tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 100)).await;
    } else {
        sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
            .bind(claims.session_id)
            .execute(&pool)
            .await
            .unwrap();
    }
    held.commit().await.unwrap();
    for operation in pending {
        let result = tokio::time::timeout(std::time::Duration::from_secs(3), operation)
            .await
            .unwrap()
            .unwrap();
        let status = result.status();
        let body = json_body(result).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{}", body["error"]["code"]);
        assert_eq!(body["error"]["code"], "handover_authorization_expired");
    }
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM patient_handover_revisions),(SELECT count(*) FROM patient_handover_commands),(SELECT count(*) FROM audit_events WHERE event_type LIKE 'nursing.patient_handover.%')").fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 1, 1));
    let revision: i64 =
        sqlx::query_scalar("SELECT current_revision FROM patient_handovers WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(revision, 1);
}
#[tokio::test]
async fn waiting_handover_cannot_outlive_naturally_expiring_nursing_authority() {
    waiting_handover_requires_live_authority(true, false).await;
}
#[tokio::test]
async fn waiting_handover_cannot_use_a_revoked_session() {
    waiting_handover_requires_live_authority(false, false).await;
}

#[tokio::test]
async fn waiting_handover_reads_cannot_outlive_naturally_expiring_nursing_authority() {
    waiting_handover_requires_live_authority(true, true).await;
}
#[tokio::test]
async fn waiting_handover_reads_cannot_use_a_revoked_session() {
    waiting_handover_requires_live_authority(false, true).await;
}

#[tokio::test]
async fn patient_handover_rejects_mismatched_and_foreign_admission_scope_before_any_write() {
    let app = app().await;
    let (patient, admission, ward) = fixture(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let other = Uuid::new_v4();
    let other_admission = Uuid::new_v4();
    sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) VALUES($1,$2,'SYN-HANDOVER-OTHER','Synthetic','Other',DATE '1990-01-01','female','active')").bind(other).bind(facility).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(other_admission).bind(facility).bind(other).bind(ward).execute(&pool).await.unwrap();
    let foreign = Uuid::new_v4();
    let foreign_patient = Uuid::new_v4();
    let foreign_ward = Uuid::new_v4();
    let foreign_admission = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) SELECT $1,'handover-other','Synthetic other',deployment_profile FROM facilities WHERE id=$2").bind(foreign).bind(facility).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) VALUES($1,$2,'SYN-HANDOVER-FOREIGN','Synthetic','Foreign',DATE '1990-01-01','female','active')").bind(foreign_patient).bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO wards(id,facility_id,code,name,status) VALUES($1,$2,'SYN-HANDOVER','Synthetic foreign ward','active')").bind(foreign_ward).bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(foreign_admission).bind(foreign).bind(foreign_patient).bind(foreign_ward).execute(&pool).await.unwrap();
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    for candidate in [other_admission, foreign_admission] {
        for(method,path,body)in[(Method::POST,"/api/v2/nursing/patient-handovers".into(),Some(input(patient,candidate))),(Method::GET,format!("/api/v2/nursing/patient-handovers?patient_id={patient}&admission_case_id={candidate}"),None),(Method::GET,format!("/api/v2/nursing/patient-handovers/recipients?patient_id={patient}&admission_case_id={candidate}"),None)] {
            let result=send(app.clone(),&token,method,path,body).await;let status=result.status();let data=json_body(result).await;
            assert!(matches!(status,StatusCode::BAD_REQUEST|StatusCode::NOT_FOUND|StatusCode::FORBIDDEN));assert!(data.get("data").is_none());assert!(!data.to_string().contains("Synthetic foreign"));
        }
    }
    let result = send(
        app.clone(),
        &token,
        Method::POST,
        "/api/v2/nursing/patient-handovers".into(),
        Some(input(foreign_patient, admission)),
    )
    .await;
    assert!(matches!(
        result.status(),
        StatusCode::NOT_FOUND | StatusCode::FORBIDDEN
    ));
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM patient_handovers),(SELECT count(*) FROM patient_handover_commands),(SELECT count(*) FROM audit_events WHERE event_type LIKE 'nursing.patient_handover.%')").fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (0, 0, 0));
}
