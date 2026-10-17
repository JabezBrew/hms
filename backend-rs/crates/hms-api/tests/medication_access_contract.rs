mod support;
use support::*;

async fn send(
    app: &TestApp,
    token: &str,
    method: Method,
    path: String,
    body: Option<Value>,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    app.clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap()
}
async fn fixture(app: &TestApp) -> (Uuid, Uuid, Uuid, Uuid, Uuid) {
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
    let source:Uuid=sqlx::query_scalar("INSERT INTO prescriptions(id,facility_id,patient_id,medication_name,dose,route,frequency,status,created_by_user_id) VALUES(gen_random_uuid(),$1,$2,'Synthetic medication','1 tablet','oral','daily','active',$3) RETURNING id").bind(facility).bind(patient).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).fetch_one(&pool).await.unwrap();
    let dose:Uuid=sqlx::query_scalar("INSERT INTO medication_administrations(id,facility_id,patient_id,admission_case_id,medication_name,dose,route,frequency,scheduled_at,status) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic medication','1 tablet','oral','daily',clock_timestamp(),'scheduled') RETURNING id").bind(facility).bind(patient).bind(admission).fetch_one(&pool).await.unwrap();
    (patient, admission, ward, source, dose)
}
async fn nurse(app: &TestApp, full: bool, ward: Option<Uuid>, patient: Option<Uuid>) -> String {
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for p in [
        PermissionCode::NursingTaskManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(app, user, p).await;
    }
    grant_test_feature(app, user, FeatureKey::Nursing).await;
    grant_test_patient_visibility(app, user, PatientDataVisibility::Demographics).await;
    grant_test_patient_visibility(
        app,
        user,
        if full {
            PatientDataVisibility::FullClinical
        } else {
            PatientDataVisibility::ClinicalSummary
        },
    )
    .await;
    if let Some(ward) = ward {
        let practitioner =
            create_test_practitioner_for_user(app, user, "MED-ACCESS", "MED-ACCESS-LIC").await;
        sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES(gen_random_uuid(),$1,$2,$3,'staff_nurse','Nurse','nursing') ON CONFLICT DO NOTHING").bind(app.state().facility_id()).bind(ward).bind(practitioner).execute(&app.db_pool().await).await.unwrap();
    }
    if let Some(patient) = patient {
        sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(app.state().facility_id()).bind(user).bind(patient).execute(&app.db_pool().await).await.unwrap();
    }
    login(app.clone(), "limited@hms.local").await.0
}
#[tokio::test]
async fn summary_cannot_read_rich_mar_or_prn_or_record_outcomes() {
    let app = app().await;
    let (patient, admission, ward, _, dose) = fixture(&app).await;
    let token = nurse(&app, false, Some(ward), Some(patient)).await;
    for path in [format!("/api/v2/nursing/medication-administrations?patient_id={patient}&admission_case_id={admission}"),format!("/api/v2/nursing/prn-orders?admission_case_id={admission}")]{
        assert_eq!(send(&app,&token,Method::GET,path,None).await.status(),StatusCode::FORBIDDEN);
    }
    assert_eq!(
        send(
            &app,
            &token,
            Method::POST,
            format!("/api/v2/nursing/medication-administrations/{dose}/outcome"),
            Some(json!({"status":"refused","reason_not_given":"Synthetic reason"}))
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    let saved: String =
        sqlx::query_scalar("SELECT status FROM medication_administrations WHERE id=$1")
            .bind(dose)
            .fetch_one(&app.db_pool().await)
            .await
            .unwrap();
    assert_eq!(saved, "scheduled");
}

#[tokio::test]
async fn lean_dated_treatment_header_keeps_demographic_policy_with_actual_ward_scope() {
    let app = app().await;
    let (patient, admission, ward, _, _) = fixture(&app).await;
    let token = nurse(&app, false, Some(ward), Some(patient)).await;
    let response = send(
        &app,
        &token,
        Method::POST,
        "/api/v2/nursing/treatment-sheets".into(),
        Some(json!({"admission_case_id":admission,"sheet_date":Utc::now().date_naive()})),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let header = json_body(response).await;
    assert!(header["data"].get("medication_name").is_none());
    assert!(header["data"].get("entries").is_none());
    let path = format!(
        "/api/v2/nursing/treatment-sheets?patient_id={patient}&admission_case_id={admission}"
    );
    assert_eq!(
        send(&app, &token, Method::GET, path.clone(), None)
            .await
            .status(),
        StatusCode::OK
    );
    sqlx::query("UPDATE ward_staff_assignments a SET is_active=false FROM practitioner_profiles p JOIN staff_profiles s ON s.id=p.staff_id WHERE p.id=a.practitioner_profile_id AND s.user_id=$1").bind(Uuid::from_u128(hms_db::provision::LIMITED_USER_ID)).execute(&app.db_pool().await).await.unwrap();
    assert_eq!(
        send(&app, &token, Method::GET, path, None).await.status(),
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn full_clinical_without_actual_ward_assignment_cannot_read_or_record_bedside_medication() {
    let app = app().await;
    let (patient, admission, _, _, dose) = fixture(&app).await;
    let token = nurse(&app, true, None, Some(patient)).await;
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/nursing/medication-administrations?admission_case_id={admission}"),
            None
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            &app,
            &token,
            Method::POST,
            format!("/api/v2/nursing/medication-administrations/{dose}/outcome"),
            Some(json!({"status":"refused","reason_not_given":"Synthetic reason"}))
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn full_assigned_nurse_still_needs_ordinary_patient_relationship() {
    let app = app().await;
    let (patient, admission, ward, _, _) = fixture(&app).await;
    let token = nurse(&app, true, Some(ward), None).await;
    let pool = app.db_pool().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    sqlx::query("DELETE FROM patient_contexts WHERE user_id=$1 AND patient_id=$2")
        .bind(user)
        .bind(patient)
        .execute(&pool)
        .await
        .unwrap();
    let authored: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM clinical_notes WHERE created_by_user_id=$1 AND patient_id=$2",
    )
    .bind(user)
    .bind(patient)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(authored, 0);
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/nursing/medication-administrations?admission_case_id={admission}"),
            None
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn central_pharmacy_requires_prescription_purpose_but_not_bedside_relationship() {
    let app = app().await;
    let (patient, admission, _, source, _) = fixture(&app).await;
    let pool = app.db_pool().await;
    let course:Uuid=sqlx::query_scalar("INSERT INTO medication_courses(id,facility_id,patient_id,admission_case_id,prescription_id,medication_name,dose,route,frequency,first_dose_at,generation_window_start,generation_window_end,status) SELECT gen_random_uuid(),facility_id,patient_id,$2,id,medication_name,dose,route,frequency,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 day','active' FROM prescriptions WHERE id=$1 RETURNING id").bind(source).bind(admission).fetch_one(&pool).await.unwrap();
    let fulfillment:Uuid=sqlx::query_scalar("INSERT INTO pharmacy_fulfillments(id,facility_id,patient_id,admission_case_id,prescription_id,medication_course_id,medication_name,dose,route,frequency,coverage_start,coverage_end,status,requested_dose_count) SELECT gen_random_uuid(),facility_id,patient_id,admission_case_id,prescription_id,id,medication_name,dose,route,frequency,generation_window_start,generation_window_end,'pending',1 FROM medication_courses WHERE id=$1 RETURNING id").bind(course).fetch_one(&pool).await.unwrap();
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for p in [
        PermissionCode::PharmacyDispense,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&app, user, p).await;
    }
    grant_test_feature(&app, user, FeatureKey::Pharmacy).await;
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    grant_test_patient_visibility(&app, user, PatientDataVisibility::ClinicalSummary).await;
    let token = login(app.clone(), "limited@hms.local").await.0;
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            "/api/v2/pharmacy/dispensing-queue?limit=1".into(),
            None
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Prescription).await;
    let token = login(app.clone(), "limited@hms.local").await.0;
    let response = send(
        &app,
        &token,
        Method::GET,
        "/api/v2/pharmacy/dispensing-queue?limit=1".into(),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"][0]["id"], fulfillment.to_string());
    assert_eq!(body["data"][0]["patient_id"], patient.to_string());
    let related:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM patient_contexts WHERE user_id=$1) OR EXISTS(SELECT 1 FROM clinical_notes WHERE created_by_user_id=$1) OR EXISTS(SELECT 1 FROM ward_staff_assignments a JOIN practitioner_profiles p ON p.id=a.practitioner_profile_id JOIN staff_profiles s ON s.id=p.staff_id WHERE s.user_id=$1)").bind(user).fetch_one(&pool).await.unwrap();
    assert!(
        !related,
        "central pharmacist has no bedside relationship or assignment"
    );
}

#[tokio::test]
async fn authorized_bedside_review_and_terminal_replay_survive_discharge_without_new_care() {
    let app = app().await;
    let (patient, admission, ward, _, dose) = fixture(&app).await;
    let token = nurse(&app, true, Some(ward), Some(patient)).await;
    let path=format!("/api/v2/nursing/medication-administrations?patient_id={patient}&admission_case_id={admission}");
    let response = send(&app, &token, Method::GET, path.clone(), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["data"][0]["id"], dose.to_string());
    let command = json!({"status":"refused","reason_not_given":"Synthetic reviewed reason"});
    let outcome = format!("/api/v2/nursing/medication-administrations/{dose}/outcome");
    let response = send(
        &app,
        &token,
        Method::POST,
        outcome.clone(),
        Some(command.clone()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let receipt = json_body(response).await;
    sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
        .bind(admission)
        .execute(&app.db_pool().await)
        .await
        .unwrap();
    assert_eq!(
        send(&app, &token, Method::GET, path, None).await.status(),
        StatusCode::OK
    );
    let replay = send(&app, &token, Method::POST, outcome, Some(command)).await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(json_body(replay).await["data"], receipt["data"]);
    let new_care=send(&app,&token,Method::POST,"/api/v2/nursing/medication-administrations".into(),Some(json!({"admission_case_id":admission,"medication_name":"Synthetic additional care","dose":"1 tablet","route":"oral","frequency":"daily","scheduled_at":Utc::now()}))).await;
    assert_eq!(new_care.status(), StatusCode::CONFLICT);
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM medication_administrations WHERE admission_case_id=$1",
    )
    .bind(admission)
    .fetch_one(&app.db_pool().await)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn mar_scope_filters_more_than_one_page_of_other_wards_before_limit() {
    let app = app().await;
    let (patient, own_admission, ward, _, dose) = fixture(&app).await;
    let pool = app.db_pool().await;
    let other:Uuid=sqlx::query_scalar("INSERT INTO wards(id,facility_id,code,name,status) VALUES(gen_random_uuid(),$1,'MED-OTHER','Synthetic other ward','active') RETURNING id").bind(app.state().facility_id()).fetch_one(&pool).await.unwrap();
    let admission:Uuid=sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'discharged') RETURNING id").bind(app.state().facility_id()).bind(patient).bind(other).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO medication_administrations(id,facility_id,patient_id,admission_case_id,medication_name,dose,scheduled_at,status) SELECT gen_random_uuid(),$1,$2,$3,'Synthetic excluded','1',clock_timestamp()-interval '1 day'+n*interval '1 minute','scheduled' FROM generate_series(1,120) n").bind(app.state().facility_id()).bind(patient).bind(admission).execute(&pool).await.unwrap();
    let later:Uuid=sqlx::query_scalar("INSERT INTO medication_administrations(id,facility_id,patient_id,admission_case_id,medication_name,dose,scheduled_at,status) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic later eligible','1',clock_timestamp()+interval '1 hour','scheduled') RETURNING id").bind(app.state().facility_id()).bind(patient).bind(own_admission).fetch_one(&pool).await.unwrap();
    let token = nurse(&app, true, Some(ward), Some(patient)).await;
    let path = format!("/api/v2/nursing/medication-administrations?patient_id={patient}");
    assert_eq!(
        send(&app, &token, Method::GET, format!("{path}&limit=1"), None)
            .await
            .status(),
        StatusCode::OK
    );
    let response = send(
        &app,
        &token,
        Method::GET,
        format!("/api/v2/nursing/medication-administrations?patient_id={patient}&limit=1"),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let small_queries = response
        .extensions()
        .get::<hms_observability::RequestMetricsSnapshot>()
        .unwrap()
        .db_query_count;
    let body = json_body(response).await;
    assert_eq!(body["data"][0]["id"], dose.to_string());
    assert_eq!(body["page"]["has_next"], true);
    let cursor = body["page"]["next_cursor"].as_str().unwrap();
    let second = send(
        &app,
        &token,
        Method::GET,
        format!("{path}&limit=1&cursor={cursor}"),
        None,
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    let second = json_body(second).await;
    assert_eq!(second["data"][0]["id"], later.to_string());
    assert_eq!(second["page"]["has_next"], false);
    let large = send(&app, &token, Method::GET, format!("{path}&limit=100"), None).await;
    assert_eq!(large.status(), StatusCode::OK);
    let large_queries = large
        .extensions()
        .get::<hms_observability::RequestMetricsSnapshot>()
        .unwrap()
        .db_query_count;
    assert_eq!(
        small_queries, large_queries,
        "page-size changes do not add per-row authorization queries"
    );
    assert!(
        small_queries >= 10,
        "source and live proof statements are measured rather than hidden"
    );
    assert_eq!(json_body(large).await["data"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn late_nonadministration_remains_explicit_actual_time_while_given_requires_active_care() {
    let app = app().await;
    let (patient, admission, ward, _, dose) = fixture(&app).await;
    let token = nurse(&app, true, Some(ward), Some(patient)).await;
    let pool = app.db_pool().await;
    sqlx::query("UPDATE admission_cases SET status='discharged' WHERE id=$1")
        .bind(admission)
        .execute(&pool)
        .await
        .unwrap();
    let before: chrono::DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&pool)
        .await
        .unwrap();
    let path = format!("/api/v2/nursing/medication-administrations/{dose}/outcome");
    assert_eq!(
        send(
            &app,
            &token,
            Method::POST,
            path.clone(),
            Some(json!({"status":"administered"}))
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    let response = send(
        &app,
        &token,
        Method::POST,
        path,
        Some(json!({"status":"missed","reason_not_given":"Synthetic late review reason"})),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"]["status"], "missed");
    assert!(body["data"]["administered_at"].is_null());
    let recorded =
        chrono::DateTime::parse_from_rfc3339(body["data"]["outcome_recorded_at"].as_str().unwrap())
            .unwrap();
    assert!(recorded >= before);
    assert_eq!(
        body["data"]["outcome_recorded_by_user_id"],
        Uuid::from_u128(hms_db::provision::LIMITED_USER_ID).to_string()
    );
}
#[tokio::test]
async fn prescription_patch_wait_rechecks_exact_revoked_session_before_source_changes() {
    let app = app().await;
    let (patient, _, _, source, _) = fixture(&app).await;
    let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_patient_visibility(&app, user, PatientDataVisibility::FullClinical).await;
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(app.state().facility_id()).bind(user).bind(patient).execute(&app.db_pool().await).await.unwrap();
    let token = login(app.clone(), "owner@hms.local").await.0;
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
        .bind(source)
        .execute(&mut *held)
        .await
        .unwrap();
    let copy = app.clone();
    let pending = tokio::spawn(async move {
        send(
            &copy,
            &token,
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{source}"),
            Some(json!({"status":"on_hold"})),
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{let n:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))").bind(pid).fetch_one(&pool).await.unwrap();if n>0{break;}assert!(!pending.is_finished(),"request reaches held prescription");tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&pool)
        .await
        .unwrap();
    held.commit().await.unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(3), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let status: String = sqlx::query_scalar("SELECT status FROM prescriptions WHERE id=$1")
        .bind(source)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "active");
}

async fn wait_for_block(pool: &hms_db::PgPool, pid: i32) {
    waiter_blocked_by(pool, pid).await;
}
async fn waiter_blocked_by(pool: &hms_db::PgPool, pid: i32) -> i32 {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let waiting: Option<i32> = sqlx::query_scalar("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) ORDER BY pid LIMIT 1")
                .bind(pid).fetch_optional(pool).await.unwrap();
            if let Some(waiting) = waiting {
                return waiting;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("actual medication operation reaches the held production lock")
}
async fn outcome_proof_wait(change: &str) {
    let app = app().await;
    let (patient, _, ward, _, dose) = fixture(&app).await;
    let pool = app.db_pool().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let mut token = nurse(&app, true, Some(ward), Some(patient)).await;
    let end = if change == "expiry" {
        sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='nursing.task.manage'").bind(user).execute(&pool).await.unwrap();
        let end: chrono::DateTime<Utc> =
            sqlx::query_scalar("SELECT clock_timestamp()+interval '5 seconds'")
                .fetch_one(&pool)
                .await
                .unwrap();
        hms_db::admin::create_permission_assignment(
            &pool,
            hms_db::admin::NewPermissionAssignment {
                facility_id: app.state().facility_id(),
                grantee_user_id: user,
                permission_code: PermissionCode::NursingTaskManage,
                scope_type: "facility".into(),
                scope_id: None,
                granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
                starts_at: end - Duration::minutes(1),
                ends_at: Some(end),
                reason_code: "temporary_medication_cover".into(),
            },
            None,
        )
        .await
        .unwrap();
        token = login(app.clone(), "limited@hms.local").await.0;
        Some(end)
    } else {
        None
    };
    let claims = access_claims(&token);
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
        send(
            &copy,
            &token,
            Method::POST,
            format!("/api/v2/nursing/medication-administrations/{dose}/outcome"),
            Some(json!({"status":"refused","reason_not_given":"Synthetic retained reason"})),
        )
        .await
    });
    wait_for_block(&pool, pid).await;
    match change {
        "expiry" => {
            let millis:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end.unwrap()).fetch_one(&pool).await.unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(millis as u64 + 30)).await;
        }
        "session" => {
            sqlx::query(
                "UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1",
            )
            .bind(claims.session_id)
            .execute(&pool)
            .await
            .unwrap();
        }
        "assignment" => {
            sqlx::query("UPDATE ward_staff_assignments a SET is_active=false FROM practitioner_profiles p JOIN staff_profiles s ON s.id=p.staff_id WHERE p.id=a.practitioner_profile_id AND s.user_id=$1").bind(user).execute(&mut *held).await.unwrap();
        }
        "feature" => {
            sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'nursing',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(app.state().facility_id()).execute(&mut *held).await.unwrap();
        }
        _ => panic!("unsupported synthetic mutation"),
    }
    held.commit().await.unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(3), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let state:(String,i64)=sqlx::query_as("SELECT status,(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='nursing.medication_outcome.recorded') FROM medication_administrations WHERE id=$1").bind(dose).fetch_one(&pool).await.unwrap();
    assert_eq!(state, ("scheduled".into(), 0));
}
#[tokio::test]
async fn outcome_wait_rechecks_exact_session() {
    outcome_proof_wait("session").await;
}
#[tokio::test]
async fn outcome_wait_rechecks_naturally_expiring_managed_permission() {
    outcome_proof_wait("expiry").await;
}
#[tokio::test]
async fn outcome_wait_rechecks_current_ward_assignment() {
    outcome_proof_wait("assignment").await;
}
#[tokio::test]
async fn outcome_wait_rechecks_current_nursing_feature() {
    outcome_proof_wait("feature").await;
}

#[tokio::test]
async fn prescription_wait_cannot_publish_under_a_replaced_connection_policy() {
    use hms_domain::network::{NetworkOffsiteMode, UpdateNetworkPolicyRequest};
    let app = app().await;
    let (patient, _, _, source, _) = fixture(&app).await;
    let pool = app.db_pool().await;
    let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let facility = app.state().facility_id();
    grant_test_patient_visibility(&app, user, PatientDataVisibility::FullClinical).await;
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(facility).bind(user).bind(patient).execute(&pool).await.unwrap();
    let token = login(app.clone(), "owner@hms.local").await.0;
    let current = hms_db::network::get_policy(&pool, facility).await.unwrap();
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
        .bind(source)
        .execute(&mut *held)
        .await
        .unwrap();
    let copy = app.clone();
    let pending = tokio::spawn(async move {
        send(
            &copy,
            &token,
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{source}"),
            Some(json!({"status":"on_hold"})),
        )
        .await
    });
    wait_for_block(&pool, pid).await;
    // Canonical explicit local-operator publication can intentionally recover
    // or lock out a connection; it does not pretend to be an HTTP user's proof.
    hms_db::network::update_policy(
        &pool,
        hms_db::network::NetworkPolicyActor {
            facility_id: facility,
            user_id: None,
            request_id: None,
            reauth_deadline: None,
            auth_versions: None,
            session_id: None,
            active_profile: None,
            resolved_policy_version: None,
        },
        UpdateNetworkPolicyRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: current.version,
            onsite_cidrs: vec!["192.0.2.0/24".into()],
            offsite_mode: NetworkOffsiteMode::Deny,
            reason: "Synthetic operator policy change".into(),
        },
        None,
    )
    .await
    .unwrap();
    held.commit().await.unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(3), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let state:(String,i64)=sqlx::query_as("SELECT status,(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='clinical.prescription.updated') FROM prescriptions WHERE id=$1").bind(source).fetch_one(&pool).await.unwrap();
    assert_eq!(state, ("active".into(), 0));
}

async fn publish_first_deny(
    pool: &hms_db::PgPool,
    facility: Uuid,
) -> hms_domain::network::NetworkPolicyWriteResult {
    hms_db::network::update_policy(
        pool,
        hms_db::network::NetworkPolicyActor {
            facility_id: facility,
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
            onsite_cidrs: vec!["192.0.2.0/24".into()],
            offsite_mode: hms_domain::network::NetworkOffsiteMode::Deny,
            reason: "Synthetic first operator publication".into(),
        },
        None,
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn unconfigured_read_locks_only_default_sentinel_before_first_policy_publication() {
    let app = app_without_network_policy().await;
    let (patient, _, ward, _, dose) = fixture(&app).await;
    let token = nurse(&app, true, Some(ward), Some(patient)).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    assert!(
        !hms_db::network::get_policy(&pool, facility)
            .await
            .unwrap()
            .configured
    );
    let mut held_rows = pool.begin().await.unwrap();
    let rows_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held_rows)
        .await
        .unwrap();
    sqlx::query("LOCK TABLE medication_administrations IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *held_rows)
        .await
        .unwrap();
    let mut held_audit = pool.begin().await.unwrap();
    let audit_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held_audit)
        .await
        .unwrap();
    sqlx::query("LOCK TABLE audit_events IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *held_audit)
        .await
        .unwrap();
    let copy = app.clone();
    let read = tokio::spawn(async move {
        send(
            &copy,
            &token,
            Method::GET,
            format!("/api/v2/nursing/medication-administrations?patient_id={patient}"),
            None,
        )
        .await
    });
    // The bounded MAR projection waits only after the real proof acquired v0.
    let read_pid = waiter_blocked_by(&pool, rows_pid).await;
    let publisher_pool = pool.clone();
    let publisher =
        tokio::spawn(async move { publish_first_deny(&publisher_pool, facility).await });
    wait_for_block(&pool, read_pid).await;
    held_rows.commit().await.unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(3), read)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["data"][0]["id"], dose.to_string());
    wait_for_block(&pool, audit_pid).await;
    let default = hms_db::network::get_policy(&pool, facility).await.unwrap();
    assert!(!default.configured);
    assert_eq!(default.version, 0);
    assert!(default.onsite_cidrs.is_empty());
    assert_eq!(
        default.offsite_mode,
        hms_domain::network::NetworkOffsiteMode::Readonly
    );
    let evidence: (i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM facility_network_policy_versions WHERE facility_id=$1),(SELECT count(*) FROM facility_network_policy_commands WHERE facility_id=$1)")
        .bind(facility).fetch_one(&pool).await.unwrap();
    assert_eq!(
        evidence,
        (0, 0),
        "the sentinel creates no publication evidence"
    );
    held_audit.commit().await.unwrap();
    let published = tokio::time::timeout(std::time::Duration::from_secs(3), publisher)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(published.policy.version, 1);
}

#[tokio::test]
async fn first_policy_publication_wins_before_unconfigured_medication_proof() {
    let app = app_without_network_policy().await;
    let (patient, _, ward, _, _) = fixture(&app).await;
    let token = nurse(&app, true, Some(ward), Some(patient)).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let mut held_audit = pool.begin().await.unwrap();
    let audit_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held_audit)
        .await
        .unwrap();
    sqlx::query("LOCK TABLE audit_events IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *held_audit)
        .await
        .unwrap();
    let publisher_pool = pool.clone();
    let publisher =
        tokio::spawn(async move { publish_first_deny(&publisher_pool, facility).await });
    let publisher_pid = waiter_blocked_by(&pool, audit_pid).await;
    let copy = app.clone();
    let read = tokio::spawn(async move {
        send(
            &copy,
            &token,
            Method::GET,
            format!("/api/v2/nursing/medication-administrations?patient_id={patient}"),
            None,
        )
        .await
    });
    // Middleware sees the committed absent-v0 state. Its later sentinel insert
    // must wait for the real publication, then reject the old resolved version.
    wait_for_block(&pool, publisher_pid).await;
    held_audit.commit().await.unwrap();
    let published = tokio::time::timeout(std::time::Duration::from_secs(3), publisher)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(published.policy.version, 1);
    let response = tokio::time::timeout(std::time::Duration::from_secs(3), read)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = json_body(response).await;
    assert!(body.get("data").is_none());
    let evidence: (i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM facility_network_policy_versions WHERE facility_id=$1),(SELECT count(*) FROM facility_network_policy_commands WHERE facility_id=$1)")
        .bind(facility).fetch_one(&pool).await.unwrap();
    assert_eq!(evidence, (1, 1));
}

#[tokio::test]
async fn valid_prn_request_source_wait_rechecks_session_without_reserving_a_dose() {
    let app = app().await;
    let (patient, admission, ward, _, _) = fixture(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(facility).bind(owner).bind(patient).execute(&pool).await.unwrap();
    let encounter:Uuid=sqlx::query_scalar("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status) VALUES(gen_random_uuid(),$1,$2,'inpatient','in_progress') RETURNING id").bind(facility).bind(patient).fetch_one(&pool).await.unwrap();
    let(item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled AND item_type='medication' LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
    let owner_token = login(app.clone(), "owner@hms.local").await.0;
    let source=send(&app,&owner_token,Method::POST,format!("/api/v2/patients/{patient}/clinical/prescriptions"),Some(json!({"encounter_id":encounter,"admission_case_id":admission,"medication_name":"Synthetic indicated PRN","dose":"1 tablet","route":"oral","frequency":"prn","inventory_item_id":item,"prn_policy":{"expected_stock_unit":unit,"minimum_interval_hours":4,"maximum_doses_per_24_hours":2,"stock_units_per_dose":1,"indication":"Synthetic prescribing indication"}}))).await;
    assert_eq!(source.status(), StatusCode::OK);
    let body = json_body(source).await;
    let source = Uuid::parse_str(body["data"]["id"].as_str().unwrap()).unwrap();
    let token = nurse(&app, true, Some(ward), Some(patient)).await;
    let claims = access_claims(&token);
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
        .bind(source)
        .execute(&mut *held)
        .await
        .unwrap();
    let copy = app.clone();
    let pending = tokio::spawn(async move {
        send(&copy,&token,Method::POST,"/api/v2/nursing/prn-dose-requests".into(),Some(json!({"prescription_id":source,"admission_case_id":admission,"client_request_id":Uuid::new_v4(),"indication":"Synthetic current reason"}))).await
    });
    wait_for_block(&pool, pid).await;
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(claims.session_id)
        .execute(&pool)
        .await
        .unwrap();
    held.commit().await.unwrap();
    let denied = tokio::time::timeout(std::time::Duration::from_secs(3), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM medication_administrations WHERE prescription_id=$1),(SELECT count(*) FROM pharmacy_fulfillments WHERE prescription_id=$1),(SELECT count(*) FROM audit_events a JOIN medication_administrations m ON m.id=a.resource_id WHERE m.prescription_id=$1 AND a.event_type='medication.prn_requested')").bind(source).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (0, 0, 0));
}
