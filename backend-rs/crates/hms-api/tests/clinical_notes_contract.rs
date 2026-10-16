mod support;
use support::*;
async fn send(
    app: TestApp,
    token: &str,
    method: Method,
    path: String,
    body: Option<Value>,
) -> axum::response::Response {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = if let Some(v) = body {
        req = req.header("content-type", "application/json");
        Body::from(serde_json::to_vec(&v).unwrap())
    } else {
        Body::empty()
    };
    app.oneshot(req.body(body).unwrap()).await.unwrap()
}
async fn fixture(app: &TestApp) -> Uuid {
    grant_test_patient_visibility(
        app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PatientDataVisibility::FullClinical,
    )
    .await;
    sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(app.state().facility_id())
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap()
}
fn input() -> Value {
    json!({"client_request_id":Uuid::new_v4(),"encounter_id":null,"template_revision_id":null,"note_type":"doctor_note","title":"Synthetic exact note title","body":"  Synthetic exact note body\n"})
}
#[tokio::test]
async fn actual_http_record_amend_history_exact_version_and_receipt_preserve_provenance() {
    let app = app().await;
    let patient = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let cmd = input();
    let response = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/patients/{patient}/clinical/notes/record"),
        Some(cmd.clone()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let saved = json_body(response).await["data"].clone();
    let id = saved["note"]["id"].as_str().unwrap();
    assert_eq!(saved["note"]["body"], cmd["body"]);
    assert_eq!(saved["note"]["can_amend"], false);
    let detail = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/clinical/notes/{id}"),
        None,
    )
    .await;
    assert_eq!(detail.status(), StatusCode::OK);
    let detail = json_body(detail).await;
    assert_eq!(detail["data"]["can_amend"], true);
    assert!(detail["data"]["author_user_id"].is_string());
    let amendment = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"reason":"  Synthetic bounded reason  ","body":"Synthetic amended body"});
    let amended = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/clinical/notes/{id}/amendments"),
        Some(amendment.clone()),
    )
    .await;
    assert_eq!(amended.status(), StatusCode::OK);
    let amended = json_body(amended).await;
    assert_eq!(amended["data"]["reason"], "Synthetic bounded reason");
    assert_eq!(amended["data"]["note"]["version"], 2);
    let history = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/clinical/notes/{id}/history?limit=1"),
        None,
    )
    .await;
    assert_eq!(history.status(), StatusCode::OK);
    let history = json_body(history).await;
    assert_eq!(history["page"]["has_next"], true);
    assert!(history["data"][0].get("body").is_none());
    let cursor = history["page"]["next_cursor"].as_str().unwrap();
    let next = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/clinical/notes/{id}/history?limit=1&cursor={cursor}"),
        None,
    )
    .await;
    assert_eq!(next.status(), StatusCode::OK);
    let next = json_body(next).await;
    let version = next["data"][0]["id"].as_str().unwrap();
    let original = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/clinical/notes/{id}/versions/{version}"),
        None,
    )
    .await;
    assert_eq!(original.status(), StatusCode::OK);
    assert_eq!(json_body(original).await["data"]["body"], cmd["body"]);
    let key = cmd["client_request_id"].as_str().unwrap();
    let receipt = send(
        app.clone(),
        &token,
        Method::GET,
        format!("/api/v2/patients/{patient}/clinical/note-requests/{key}"),
        None,
    )
    .await;
    assert_eq!(receipt.status(), StatusCode::OK);
    let receipt = json_body(receipt).await;
    assert_eq!(receipt["data"]["note"], saved["note"]);
    assert_eq!(receipt["data"]["replayed"], true);
    let stale = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/clinical/notes/{id}/amendments"),
        Some({
            let mut stale = amendment.clone();
            stale["client_request_id"] = json!(Uuid::new_v4());
            stale
        }),
    )
    .await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
}
#[tokio::test]
async fn actual_http_template_catalog_is_metadata_and_selected_revision_is_pinned() {
    let app = app().await;
    let patient = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let template = json!({"client_request_id":Uuid::new_v4(),"title":"Synthetic literal %_ template","note_type":"doctor_note","body_template":"{\"description\":\"Preserved metadata\",\"sections\":[{\"section\":\"Assessment\",\"required\":true}]}","is_active":true});
    let response = send(
        app.clone(),
        &token,
        Method::POST,
        "/api/v2/clinical/note-templates/record".into(),
        Some(template.clone()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let saved = json_body(response).await["data"]["template"].clone();
    let id = saved["id"].as_str().unwrap();
    let revision = saved["current_revision_id"].clone();
    let list = send(
        app.clone(),
        &token,
        Method::GET,
        "/api/v2/clinical/note-templates?search=%25_&activity=all&limit=1".into(),
        None,
    )
    .await;
    assert_eq!(list.status(), StatusCode::OK);
    let list = json_body(list).await;
    assert_eq!(list["data"][0]["id"], id);
    assert!(list["data"][0].get("body_template").is_none());
    let mut cmd = input();
    cmd["template_revision_id"] = revision;
    cmd["body"] = json!("{\"assessment\":\"Synthetic reviewed structured evidence\"}");
    let response = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/patients/{patient}/clinical/notes/record"),
        Some(cmd),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let note = json_body(response).await;
    assert_eq!(
        note["data"]["note"]["template_revision"]["body_template"],
        template["body_template"]
    );
    let change = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"title":"Synthetic revised template","note_type":"doctor_note","body_template":"Synthetic plain starter","is_active":false,"change_summary":"Synthetic change"});
    let response = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/clinical/note-templates/{id}/changes"),
        Some(change),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let detail = send(
        app.clone(),
        &token,
        Method::GET,
        format!(
            "/api/v2/clinical/notes/{}",
            note["data"]["note"]["id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(detail.status(), StatusCode::OK);
    assert_eq!(
        json_body(detail).await["data"]["template_revision"]["body_template"],
        template["body_template"]
    );
}
#[tokio::test]
async fn legacy_mutations_and_unknown_clinical_fields_fail_without_writes_or_echo() {
    let app = app().await;
    let patient = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let mut cmd = input();
    cmd["unsupported_private_field"] = json!("Synthetic forbidden echo sentinel");
    let response = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/patients/{patient}/clinical/notes/record"),
        Some(cmd),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let response = json_body(response).await;
    assert!(!response
        .to_string()
        .contains("Synthetic forbidden echo sentinel"));
    let legacy=send(app.clone(),&token,Method::POST,format!("/api/v2/patients/{patient}/clinical/notes"),Some(json!({"note_type":"doctor_note","title":"Synthetic legacy note","body":"Synthetic unsupported old mutation"}))).await;
    assert_eq!(legacy.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(legacy).await["error"]["code"],
        "clinical_note_command_required"
    );
}
#[tokio::test]
async fn summary_visibility_cannot_read_record_or_amend_full_note_evidence() {
    let app = app().await;
    let patient = fixture(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let response = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/patients/{patient}/clinical/notes/record"),
        Some(input()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let id = json_body(response).await["data"]["note"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    sqlx::query(
        "DELETE FROM user_patient_visibility WHERE user_id=$1 AND visibility='full_clinical'",
    )
    .bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID))
    .execute(&app.db_pool().await)
    .await
    .unwrap();
    grant_test_patient_visibility(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PatientDataVisibility::ClinicalSummary,
    )
    .await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    for path in [
        format!("/api/v2/clinical/notes/{id}"),
        format!("/api/v2/clinical/notes/{id}/history"),
    ] {
        assert_eq!(
            send(app.clone(), &token, Method::GET, path, None)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        send(
            app.clone(),
            &token,
            Method::POST,
            format!("/api/v2/patients/{patient}/clinical/notes/record"),
            Some(input())
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}

async fn waiting_note_requires_live_authority(expire: bool) {
    let app = app().await;
    let patient = fixture(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_feature(&app, limited, FeatureKey::Encounters).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::FullClinical).await;
    for permission in [
        PermissionCode::PatientDemographicsView,
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::ClinicalDocumentationManage,
    ] {
        grant_test_permission(&app, limited, permission).await;
    }
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let command = input();
    let response = send(
        app.clone(),
        &token,
        Method::POST,
        format!("/api/v2/patients/{patient}/clinical/notes/record"),
        Some(command.clone()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let saved = json_body(response).await["data"].clone();
    let id = Uuid::parse_str(saved["note"]["id"].as_str().unwrap()).unwrap();
    let expiry = if expire {
        sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.manage'").bind(limited).execute(&pool).await.unwrap();
        let end: chrono::DateTime<Utc> =
            sqlx::query_scalar("SELECT clock_timestamp()+interval '4 seconds'")
                .fetch_one(&pool)
                .await
                .unwrap();
        hms_db::admin::create_permission_assignment(
            &pool,
            hms_db::admin::NewPermissionAssignment {
                facility_id: facility,
                grantee_user_id: limited,
                permission_code: PermissionCode::ClinicalDocumentationManage,
                scope_type: "facility".into(),
                scope_id: None,
                granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
                starts_at: end - Duration::minutes(1),
                ends_at: Some(end),
                reason_code: "synthetic_temporary_note_cover".into(),
            },
            None,
        )
        .await
        .unwrap();
        Some(end)
    } else {
        None
    };
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let claims = access_claims(&token);
    let mut lock = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM clinical_notes WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *lock)
        .await
        .unwrap();
    let key = command["client_request_id"].as_str().unwrap();
    let mut pending = Vec::new();
    for path in [
        format!("/api/v2/clinical/notes/{id}"),
        format!("/api/v2/clinical/notes/{id}/history"),
        format!("/api/v2/patients/{patient}/clinical/note-requests/{key}"),
    ] {
        let app = app.clone();
        let token = token.clone();
        pending.push(tokio::spawn(async move {
            send(app, &token, Method::GET, path, None).await
        }));
    }
    let cloned = app.clone();
    let token = token.clone();
    pending.push(tokio::spawn(async move{send(cloned,&token,Method::POST,format!("/api/v2/clinical/notes/{id}/amendments"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"reason":"Synthetic explicit reason","body":"Synthetic blocked amendment"}))).await}));
    tokio::time::timeout(std::time::Duration::from_secs(2),async{loop{let n:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND state='active'").fetch_one(&pool).await.unwrap();if n>=4{break;}assert!(pending.iter().all(|p|!p.is_finished()));tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
    if let Some(end) = expiry {
        let ms:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(end).fetch_one(&pool).await.unwrap();
        assert!(ms > 0);
        tokio::time::sleep(std::time::Duration::from_millis(ms as u64 + 100)).await;
    } else {
        sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
            .bind(claims.session_id)
            .execute(&pool)
            .await
            .unwrap();
    }
    lock.commit().await.unwrap();
    for task in pending {
        let response = tokio::time::timeout(std::time::Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        let status = response.status();
        let body = json_body(response).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{}", body["error"]["code"]);
        assert_eq!(body["error"]["code"], "clinical_note_authorization_expired");
    }
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM clinical_note_versions WHERE note_id=$1),(SELECT count(*) FROM clinical_note_commands WHERE result_id=$1),(SELECT count(*) FROM audit_events WHERE resource_id=$1)").bind(id).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 1, 1));
}
#[tokio::test]
async fn actual_http_waiting_reads_and_amendment_cannot_outlive_managed_permission() {
    waiting_note_requires_live_authority(true).await;
}
#[tokio::test]
async fn actual_http_waiting_reads_and_amendment_reject_revoked_session() {
    waiting_note_requires_live_authority(false).await;
}
