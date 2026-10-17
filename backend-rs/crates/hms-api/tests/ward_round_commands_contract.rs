mod support;
use support::*;

async fn send(
    app: TestApp,
    token: &str,
    method: Method,
    path: String,
    body: Option<Value>,
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = if let Some(body) = body {
        builder = builder.header("content-type", "application/json");
        Body::from(serde_json::to_vec(&body).unwrap())
    } else {
        Body::empty()
    };
    app.oneshot(builder.body(body).unwrap()).await.unwrap()
}
async fn fixture(app: &TestApp) -> (Uuid, Uuid, Uuid) {
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_patient_visibility(app, owner, PatientDataVisibility::FullClinical).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let patient:Uuid=sqlx::query_scalar("SELECT p.id FROM patients p WHERE p.facility_id=$1 AND NOT EXISTS(SELECT 1 FROM admission_cases a WHERE a.facility_id=p.facility_id AND a.patient_id=p.id AND a.status IN ('ready_for_activation','admitted','discharge_pending')) ORDER BY p.id LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
    let ward: Uuid = sqlx::query_scalar(
        "SELECT id FROM wards WHERE facility_id=$1 AND status='active' ORDER BY id LIMIT 1",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    let admission:Uuid=sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'admitted') RETURNING id").bind(facility).bind(patient).bind(ward).fetch_one(&pool).await.unwrap();
    context(app, owner, patient).await;
    (patient, admission, ward)
}
async fn context(app: &TestApp, user: Uuid, patient: Uuid) {
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(app.state().facility_id()).bind(user).bind(patient).execute(&app.db_pool().await).await.unwrap();
}
async fn limited(app: &TestApp, patient: Uuid, full: bool) {
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for p in [
        PermissionCode::PatientDemographicsView,
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::ClinicalDocumentationManage,
        PermissionCode::NursingTaskManage,
    ] {
        grant_test_permission(app, user, p).await;
    }
    for feature in [
        FeatureKey::Patients,
        FeatureKey::Encounters,
        FeatureKey::Nursing,
    ] {
        grant_test_feature(app, user, feature).await;
    }
    grant_test_patient_visibility(app, user, PatientDataVisibility::Demographics).await;
    if full {
        grant_test_patient_visibility(app, user, PatientDataVisibility::FullClinical).await;
    }
    context(app, user, patient).await;
}
fn path(patient: Uuid) -> String {
    format!("/api/v2/patients/{patient}/chronicle/ward-rounds")
}
fn draft(admission: Uuid) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"ward_round_id":null,"expected_version":0,"admission_case_id":admission,"note_sections":{"interval_history":null,"examination":null,"assessment":"Synthetic protected round assessment","plan":"Synthetic reviewed plan","clinical_readiness_blockers":[]},"rendered_note":"Synthetic complete protected narrative","actions":[{"action_type":"nursing_task","payload":{"title":"Synthetic ward task","instruction":"Synthetic instruction","due_at":Utc::now(),"task_type":"ward_round","assigned_to_user_id":null}}]})
}
async fn counts(app: &TestApp) -> (i64, i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT count(*) FROM ward_rounds),(SELECT count(*) FROM ward_round_commands),(SELECT count(*) FROM nursing_tasks),(SELECT count(*) FROM audit_events)").fetch_one(&app.db_pool().await).await.unwrap()
}
async fn save(app: &TestApp, token: &str, patient: Uuid, input: Value) -> Value {
    let r = send(
        app.clone(),
        token,
        Method::POST,
        format!("{}/draft", path(patient)),
        Some(input),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    json_body(r).await["data"].clone()
}

#[tokio::test]
async fn actual_complete_draft_commit_receipt_and_selected_context_are_coherent() {
    let app = app().await;
    let (patient, admission, _) = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let context = send(
        app.clone(),
        &token,
        Method::GET,
        format!("{}/current?admission_case_id={admission}", path(patient)),
        None,
    )
    .await;
    assert_eq!(context.status(), StatusCode::OK);
    let context = json_body(context).await;
    assert_eq!(context["data"]["admission_case_id"], admission.to_string());
    assert!(context["data"]["ward_round"].is_null());
    assert_eq!(context["data"]["permissions"]["can_edit_draft"], true);
    let input = draft(admission);
    let saved = save(&app, &token, patient, input.clone()).await;
    let id = saved["ward_round"]["id"].as_str().unwrap();
    assert_eq!(
        saved["ward_round"]["actions"][0]["payload"],
        input["actions"][0]["payload"]
    );
    assert_eq!(saved["ward_round"]["actions"][0]["position"], 0);
    assert_eq!(saved["ward_round"]["permissions"]["read_only"], true);
    let before = counts(&app).await;
    let command = json!({"client_request_id":Uuid::new_v4(),"expected_version":1});
    let result = send(
        app.clone(),
        &token,
        Method::POST,
        format!("{}/{id}/commit", path(patient)),
        Some(command.clone()),
    )
    .await;
    assert_eq!(result.status(), StatusCode::OK);
    let result = json_body(result).await["data"].clone();
    assert_eq!(result["operation"], "committed");
    assert_eq!(result["created_artifacts"].as_array().unwrap().len(), 1);
    assert!(result["ward_round"]["signed_at"].is_string());
    assert_eq!(
        result["ward_round"]["signed_by_user_id"],
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID).to_string()
    );
    let replay = send(
        app.clone(),
        &token,
        Method::POST,
        format!("{}/{id}/commit", path(patient)),
        Some(command),
    )
    .await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(json_body(replay).await["data"]["replayed"], true);
    assert_eq!(counts(&app).await.2, before.2 + 1);
    let original = send(
        app.clone(),
        &token,
        Method::GET,
        format!(
            "{}/requests/{}",
            path(patient),
            input["client_request_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(original.status(), StatusCode::OK);
    let original = json_body(original).await;
    assert_eq!(original["data"]["ward_round"]["status"], "draft");
    assert_eq!(
        original["data"]["ward_round"]["rendered_note"],
        input["rendered_note"]
    );
    let before = counts(&app).await;
    let retired = send(
        app.clone(),
        &token,
        Method::POST,
        path(patient),
        Some(json!({"admission_case_id":admission,"rendered_note":"Must not overwrite"})),
    )
    .await;
    assert_eq!(retired.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(retired).await["error"]["code"],
        "ward_round_atomic_draft_required"
    );
    assert_eq!(counts(&app).await, before);
}

#[tokio::test]
async fn full_visibility_actual_ward_and_active_assignee_precede_persistence() {
    let app = app().await;
    let (patient, admission, _) = fixture(&app).await;
    limited(&app, patient, false).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let before = counts(&app).await;
    for (method, p, b) in [
        (
            Method::GET,
            format!("{}/current?admission_case_id={admission}", path(patient)),
            None,
        ),
        (
            Method::POST,
            format!("{}/draft", path(patient)),
            Some(draft(admission)),
        ),
    ] {
        let response = send(app.clone(), &token, method, p, b).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!json_body(response)
            .await
            .to_string()
            .contains("Synthetic protected"));
    }
    assert_eq!(counts(&app).await, before);
    limited(&app, patient, true).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let before = counts(&app).await;
    let denied = send(
        app.clone(),
        &token,
        Method::POST,
        format!("{}/draft", path(patient)),
        Some(draft(admission)),
    )
    .await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "nursing_ward_access_denied"
    );
    assert_eq!(counts(&app).await, before);
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let before = counts(&app).await;
    let mut assigned = draft(admission);
    assigned["actions"][0]["payload"]["assigned_to_user_id"] =
        json!(Uuid::from_u128(hms_db::provision::LIMITED_USER_ID));
    let denied = send(
        app.clone(),
        &owner,
        Method::POST,
        format!("{}/draft", path(patient)),
        Some(assigned),
    )
    .await;
    assert_eq!(denied.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "nursing_assignee_changed"
    );
    assert_eq!(counts(&app).await, before);
}

#[tokio::test]
async fn strict_supported_commands_reject_ignored_fields_and_prn_defaults_without_echo_or_writes() {
    let app = app().await;
    let (patient, admission, _) = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let before = counts(&app).await;
    for field in ["unsupported_clinical_text", "unknown_section"] {
        let mut input = draft(admission);
        if field == "unknown_section" {
            input["note_sections"][field] = json!("SYNTHETIC-DO-NOT-ECHO");
        } else {
            input[field] = json!("SYNTHETIC-DO-NOT-ECHO");
        }
        let r = send(
            app.clone(),
            &token,
            Method::POST,
            format!("{}/draft", path(patient)),
            Some(input),
        )
        .await;
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        assert!(!json_body(r)
            .await
            .to_string()
            .contains("SYNTHETIC-DO-NOT-ECHO"));
    }
    let mut input = draft(admission);
    input["actions"] = json!([{"action_type":"prescription","payload":{"operation":"start","medication_name":"Synthetic medication","dose":"Explicit dose","frequency":"PRN","instructions":"","reason":"","route":"oral","start_date":Utc::now().date_naive(),"duration_days":null,"first_dose_at":null}}]);
    let r = send(
        app.clone(),
        &token,
        Method::POST,
        format!("{}/draft", path(patient)),
        Some(input),
    )
    .await;
    assert_eq!(r.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(r).await["error"]["code"],
        "ward_round_prescribing_panel_required"
    );
    assert_eq!(counts(&app).await, before);
}

#[tokio::test]
async fn imported_wrong_patient_child_is_rejected_without_foreign_narrative_or_side_effects() {
    let app = app().await;
    let (patient, admission, _) = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let saved = save(&app, &token, patient, draft(admission)).await;
    let id = saved["ward_round"]["id"].as_str().unwrap();
    let pool = app.db_pool().await;
    let foreign: Uuid =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id<>$2 LIMIT 1")
            .bind(app.state().facility_id())
            .bind(patient)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO ward_round_actions(id,facility_id,ward_round_id,patient_id,admission_case_id,action_type,status,title,instruction,payload) VALUES(gen_random_uuid(),$1,$2,$3,$4,'nursing_task','draft','SYNTHETIC-FOREIGN-NARRATIVE','SYNTHETIC-FOREIGN-NARRATIVE','{}'::jsonb)").bind(app.state().facility_id()).bind(Uuid::parse_str(id).unwrap()).bind(foreign).bind(admission).execute(&pool).await.unwrap();
    let before = counts(&app).await;
    for (method, p, body) in [
        (Method::GET, format!("{}/{id}", path(patient)), None),
        (
            Method::POST,
            format!("{}/{id}/commit", path(patient)),
            Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1})),
        ),
    ] {
        let r = send(app.clone(), &token, method, p, body).await;
        assert_eq!(r.status(), StatusCode::CONFLICT);
        let body = json_body(r).await;
        assert_eq!(body["error"]["code"], "ward_round_draft_review_required");
        assert!(!body.to_string().contains("SYNTHETIC-FOREIGN-NARRATIVE"));
    }
    assert_eq!(counts(&app).await, before);
}

async fn wait_for_block(pool: &hms_db::PgPool, pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async {loop {let n:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))").bind(pid).fetch_one(pool).await.unwrap();if n>0 {break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("real Ward Round request waits on source row");
}
async fn waiting_proof(read: bool, expire: bool, nursing: bool) {
    let app = app().await;
    let (patient, admission, _) = fixture(&app).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let mut initial = draft(admission);
    if !nursing {
        initial["actions"] = json!([]);
    }
    let saved = save(&app, &owner, patient, initial).await;
    let id = saved["ward_round"]["id"].as_str().unwrap().to_owned();
    limited(&app, patient, true).await;
    if nursing {
        grant_test_permission(
            &app,
            Uuid::from_u128(hms_db::provision::LIMITED_USER_ID),
            PermissionCode::WardBoardViewAll,
        )
        .await;
    }
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let timed_assignment = if expire {
        let permission = if nursing {
            PermissionCode::NursingTaskManage
        } else if read {
            PermissionCode::ClinicalDocumentationView
        } else {
            PermissionCode::ClinicalDocumentationManage
        };
        let permission_text = serde_json::to_value(permission)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned();
        sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code=$2")
            .bind(user)
            .bind(permission_text)
            .execute(&pool)
            .await
            .unwrap();
        let ends: chrono::DateTime<Utc> =
            sqlx::query_scalar("SELECT clock_timestamp()+interval '5 minutes'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let assignment = hms_db::admin::create_permission_assignment(
            &pool,
            hms_db::admin::NewPermissionAssignment {
                facility_id: facility,
                grantee_user_id: user,
                permission_code: permission,
                scope_type: "facility".into(),
                scope_id: None,
                granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
                starts_at: ends - Duration::minutes(6),
                ends_at: Some(ends),
                reason_code: "temporary_clinical_cover".into(),
            },
            None,
        )
        .await
        .unwrap();
        Some(assignment.id)
    } else {
        None
    };
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let claims = access_claims(&token);
    // Finish genuine factor/password setup before arming the short workflow
    // deadline. Four seconds must test the source-row wait, not setup duration.
    // This isolated fixture does not change permission/session versions after
    // authentication; discard setup's cached facts before the protected call.
    let end = if let Some(assignment_id) = timed_assignment {
        let ends: chrono::DateTime<Utc> = sqlx::query_scalar(
            "UPDATE permission_assignments SET ends_at=clock_timestamp()+interval '4 seconds' WHERE facility_id=$1 AND id=$2 AND grantee_user_id=$3 RETURNING ends_at",
        )
        .bind(facility)
        .bind(assignment_id)
        .bind(user)
        .fetch_one(&pool)
        .await
        .unwrap();
        app.state().invalidate_auth_cache_for_user(facility, user);
        Some(ends)
    } else {
        None
    };
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM ward_rounds WHERE id=$1 FOR UPDATE")
        .bind(Uuid::parse_str(&id).unwrap())
        .execute(&mut *held)
        .await
        .unwrap();
    let before = counts(&app).await;
    let target = if read {
        format!("{}/{id}", path(patient))
    } else {
        format!("{}/{id}/commit", path(patient))
    };
    let copy = app.clone();
    let pending = tokio::spawn(async move {
        send(
            copy,
            &token,
            if read { Method::GET } else { Method::POST },
            target,
            if read {
                None
            } else {
                Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1}))
            },
        )
        .await
    });
    wait_for_block(&pool, pid).await;
    if let Some(end) = end {
        let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 50)).await;
    } else {
        sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
            .bind(claims.session_id)
            .execute(&pool)
            .await
            .unwrap();
    }
    held.commit().await.unwrap();
    let result = pending.await.unwrap();
    assert_eq!(result.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(result).await["error"]["code"],
        "ward_round_authorization_expired"
    );
    assert_eq!(counts(&app).await, before);
}
#[tokio::test]
async fn waiting_commit_rechecks_actual_revoked_session() {
    waiting_proof(false, false, false).await;
}
#[tokio::test]
async fn waiting_commit_rechecks_natural_managed_clinical_authority_expiry() {
    waiting_proof(false, true, false).await;
}
#[tokio::test]
async fn waiting_full_narrative_read_rechecks_actual_revoked_session() {
    waiting_proof(true, false, false).await;
}
#[tokio::test]
async fn waiting_full_narrative_read_rechecks_natural_managed_authority_expiry() {
    waiting_proof(true, true, false).await;
}

#[tokio::test]
async fn waiting_task_commit_rechecks_natural_managed_nursing_authority_expiry() {
    waiting_proof(false, true, true).await;
}
