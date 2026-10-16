mod support;
use support::*;
async fn get(app: TestApp, token: &str, path: String) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .uri(path)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn alert_acknowledgment_http_replay_by_another_actor_preserves_first_provenance() {
    let app = app().await;
    grant_test_patient_visibility(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PatientDataVisibility::FullClinical,
    )
    .await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, limited, PermissionCode::NursingTaskManage).await;
    grant_test_permission(&app, limited, PermissionCode::PatientDemographicsView).await;
    grant_test_feature(&app, limited, FeatureKey::Nursing).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::FullClinical).await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
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
    assign_nursing_actor(&app, limited, ward).await;
    let admission: Uuid = sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'admitted') RETURNING id").bind(facility).bind(patient).bind(ward).fetch_one(&pool).await.unwrap();
    let alert: Uuid = sqlx::query_scalar("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status) VALUES(gen_random_uuid(),$1,$2,$3,'critical','Synthetic acknowledgment provenance','open') RETURNING id").bind(facility).bind(admission).bind(patient).fetch_one(&pool).await.unwrap();
    let mut receipts = vec![];
    for token in [&owner_token, &limited_token, &owner_token] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/v2/nursing/alerts/{alert}/acknowledge"))
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        receipts.push(json_body(response).await["data"].clone());
    }
    assert_eq!(receipts[0], receipts[1]);
    assert_eq!(receipts[0], receipts[2]);
    assert_eq!(receipts[0]["status"], "acknowledged");
    assert!(receipts[0]["acknowledged_at"].is_string());
    let actor: Uuid =
        sqlx::query_scalar("SELECT acknowledged_by_user_id FROM nursing_alerts WHERE id=$1")
            .bind(alert)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(actor, owner);
    let audit: Vec<Uuid> = sqlx::query_scalar("SELECT actor_user_id FROM audit_events WHERE resource_id=$1 AND event_type='nursing.alert.acknowledged'").bind(alert).fetch_all(&pool).await.unwrap();
    assert_eq!(audit, vec![owner]);
}
#[tokio::test]
async fn nursing_scopes_filter_before_pages_and_reject_inconsistent_or_foreign_contexts() {
    let app = app().await;
    grant_test_patient_visibility(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PatientDataVisibility::FullClinical,
    )
    .await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let patients: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 ORDER BY id LIMIT 2")
            .bind(facility)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(patients.len(), 2);
    let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let other_ward:Uuid=sqlx::query_scalar("INSERT INTO wards(id,facility_id,code,name,status) VALUES(gen_random_uuid(),$1,'SCOPE-OTHER','Synthetic other ward','active') RETURNING id").bind(facility).fetch_one(&pool).await.unwrap();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let now = Utc::now();
    let mut admissions = vec![];
    for (index, patient) in patients.iter().enumerate() {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(id).bind(facility).bind(patient).bind(if index==0{ward}else{other_ward}).execute(&pool).await.unwrap();
        admissions.push(id);
        let count = if index == 0 { 3 } else { 120 };
        let time = if index == 0 {
            now
        } else {
            now - Duration::days(5)
        };
        sqlx::query("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,'critical','Synthetic scoped alert','open',$4 FROM generate_series(1,$5)").bind(facility).bind(id).bind(patient).bind(time).bind(count).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO treatment_sheets(id,facility_id,admission_case_id,patient_id,sheet_date,status,updated_at) SELECT gen_random_uuid(),$1,$2,$3,DATE '2026-01-01'+sequence,'active',$4 FROM generate_series(1,$5) sequence").bind(facility).bind(id).bind(patient).bind(time).bind(count).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO handoffs(id,facility_id,ward_id,from_user_id,to_user_id,shift_label,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,$3,'night','draft',$4 FROM generate_series(1,$5)").bind(facility).bind(if index==0{ward}else{other_ward}).bind(owner).bind(time).bind(count).execute(&pool).await.unwrap();
    }
    for (path, scope) in [
        (
            "alerts",
            format!(
                "patient_id={}&admission_case_id={}&ward_id={ward}&status=open&critical_only=true",
                patients[0], admissions[0]
            ),
        ),
        (
            "treatment-sheets",
            format!(
                "patient_id={}&admission_case_id={}&ward_id={ward}",
                patients[0], admissions[0]
            ),
        ),
        (
            "handoffs",
            format!("ward_id={ward}&shift_label=night&status=draft"),
        ),
    ] {
        let first = get(
            app.clone(),
            &token,
            format!("/api/v2/nursing/{path}?{scope}&limit=2&descending=true"),
        )
        .await;
        assert_eq!(first.status(), StatusCode::OK, "{path}");
        let first = json_body(first).await;
        assert_eq!(first["data"].as_array().unwrap().len(), 2);
        assert_eq!(first["page"]["has_next"], true);
        let cursor = first["page"]["next_cursor"].as_str().unwrap();
        let next = get(
            app.clone(),
            &token,
            format!("/api/v2/nursing/{path}?{scope}&limit=2&descending=true&cursor={cursor}"),
        )
        .await;
        assert_eq!(next.status(), StatusCode::OK);
        let next = json_body(next).await;
        assert_eq!(next["data"].as_array().unwrap().len(), 1);
        assert_eq!(next["page"]["has_next"], false);
        assert_ne!(first["data"][0]["id"], next["data"][0]["id"]);
        let unknown = get(
            app.clone(),
            &token,
            format!("/api/v2/nursing/{path}?ward_id={}", Uuid::new_v4()),
        )
        .await;
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    }
    for path in ["alerts", "treatment-sheets"] {
        for query in [
            format!(
                "patient_id={}&admission_case_id={}",
                patients[1], admissions[0]
            ),
            format!("admission_case_id={}&ward_id={other_ward}", admissions[0]),
        ] {
            assert_eq!(
                get(
                    app.clone(),
                    &token,
                    format!("/api/v2/nursing/{path}?{query}")
                )
                .await
                .status(),
                StatusCode::BAD_REQUEST
            );
        }
        assert_eq!(
            get(
                app.clone(),
                &token,
                format!(
                    "/api/v2/nursing/{path}?admission_case_id={}",
                    Uuid::new_v4()
                )
            )
            .await
            .status(),
            StatusCode::NOT_FOUND
        );
    }
    let foreign = Uuid::new_v4();
    let foreign_admission = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'SCOPE-FOREIGN','Synthetic foreign facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(foreign_admission).bind(foreign).bind(patients[0]).bind(ward).execute(&pool).await.unwrap();
    for path in ["alerts", "treatment-sheets"] {
        assert_eq!(
            get(
                app.clone(),
                &token,
                format!("/api/v2/nursing/{path}?admission_case_id={foreign_admission}")
            )
            .await
            .status(),
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        get(
            app.clone(),
            &token,
            format!("/api/v2/nursing/handoffs?patient_id={}", patients[0])
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    for path in ["alerts", "handoffs"] {
        assert_eq!(get(app.clone(),&token,format!("/api/v2/nursing/{path}?created_from=2026-01-02T00:00:00Z&created_before=2026-01-01T00:00:00Z")).await.status(),StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn active_critical_http_page_is_not_hidden_by_old_acknowledged_or_low_alerts() {
    let app = app().await;
    grant_test_patient_visibility(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PatientDataVisibility::FullClinical,
    )
    .await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
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
    let admission = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,CASE WHEN sequence%2=0 THEN 'low' ELSE 'critical' END,'Synthetic old alert',CASE WHEN sequence%2=0 THEN 'open' ELSE 'acknowledged' END,now()-interval '1 day' FROM generate_series(1,150)sequence").bind(facility).bind(admission).bind(patient).execute(&pool).await.unwrap();
    let id:Uuid=sqlx::query_scalar("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status) VALUES(gen_random_uuid(),$1,$2,$3,'high','Synthetic urgent alert','open') RETURNING id").bind(facility).bind(admission).bind(patient).fetch_one(&pool).await.unwrap();
    let response = get(
        app.clone(),
        &token,
        "/api/v2/nursing/alerts?status=open&critical_only=true&descending=true&limit=50".into(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let response = json_body(response).await;
    assert_eq!(response["data"].as_array().unwrap().len(), 1);
    assert_eq!(response["data"][0]["id"], id.to_string());
}

#[tokio::test]
async fn nursing_list_queries_require_feature_permission_and_patient_visibility_before_data() {
    let app = app().await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in ["alerts", "treatment-sheets", "handoffs"] {
        assert_eq!(
            get(app.clone(), &token, format!("/api/v2/nursing/{path}"))
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    grant_test_permission(&app, limited, PermissionCode::NursingTaskManage).await;
    grant_test_permission(&app, limited, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in ["alerts", "treatment-sheets", "handoffs"] {
        assert_eq!(
            get(app.clone(), &token, format!("/api/v2/nursing/{path}"))
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    grant_test_feature(&app, limited, FeatureKey::Nursing).await;
    let pool = app.db_pool().await;
    sqlx::query("DELETE FROM user_patient_visibility WHERE user_id=$1")
        .bind(limited)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
        .bind(limited)
        .execute(&pool)
        .await
        .unwrap();
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in ["alerts", "treatment-sheets"] {
        assert_eq!(
            get(app.clone(), &token, format!("/api/v2/nursing/{path}"))
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    // Handoff headers contain no patient association; no invented patient guard.
    assert_eq!(
        get(app, &token, "/api/v2/nursing/handoffs?limit=1".into())
            .await
            .status(),
        StatusCode::OK
    );
}

async fn post(
    app: TestApp,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .method(Method::POST)
            .uri(path)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
            .unwrap(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn explicit_nursing_permission_without_feature_cannot_write_headers_alerts_or_handoffs() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, limited, PermissionCode::NursingTaskManage).await;
    grant_test_permission(&app, limited, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
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
    let admission = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
    let alert:Uuid=sqlx::query_scalar("INSERT INTO nursing_alerts(id,facility_id,admission_case_id,patient_id,severity,title,status) VALUES(gen_random_uuid(),$1,$2,$3,'critical','Synthetic alert','open') RETURNING id").bind(facility).bind(admission).bind(patient).fetch_one(&pool).await.unwrap();
    let handoff:Uuid=sqlx::query_scalar("INSERT INTO handoffs(id,facility_id,ward_id,from_user_id,to_user_id,shift_label,status) VALUES(gen_random_uuid(),$1,$2,$3,$3,'night','draft') RETURNING id").bind(facility).bind(ward).bind(limited).fetch_one(&pool).await.unwrap();
    for (path, body) in [
        (
            "/api/v2/nursing/treatment-sheets".to_owned(),
            Some(json!({"admission_case_id":admission,"sheet_date":"2026-10-16"})),
        ),
        (
            "/api/v2/nursing/alerts".to_owned(),
            Some(
                json!({"admission_case_id":admission,"severity":"critical","title":"Synthetic denied alert"}),
            ),
        ),
        (format!("/api/v2/nursing/alerts/{alert}/acknowledge"), None),
        (
            "/api/v2/nursing/handoffs".to_owned(),
            Some(json!({"ward_id":ward,"to_user_id":owner,"shift_label":"night"})),
        ),
        (format!("/api/v2/nursing/handoffs/{handoff}/complete"), None),
    ] {
        assert_eq!(
            post(app.clone(), &token, &path, body).await.status(),
            StatusCode::FORBIDDEN
        );
    }
    let sheets: i64 =
        sqlx::query_scalar("SELECT count(*) FROM treatment_sheets WHERE admission_case_id=$1")
            .bind(admission)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(sheets, 0);
    let state: (String, Option<Uuid>) =
        sqlx::query_as("SELECT status,acknowledged_by_user_id FROM nursing_alerts WHERE id=$1")
            .bind(alert)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(state, ("open".into(), None));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM handoffs WHERE facility_id=$1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn handoff_headers_validate_references_and_only_sender_finalizes_with_immutable_audit() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let recipient = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let (sender_token, _, _) = login(app.clone(), "owner@hms.local").await;
    grant_test_permission(&app, recipient, PermissionCode::NursingTaskManage).await;
    grant_test_feature(&app, recipient, FeatureKey::Nursing).await;
    let (recipient_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let inactive_ward:Uuid=sqlx::query_scalar("INSERT INTO wards(id,facility_id,code,name,status) VALUES(gen_random_uuid(),$1,'INACTIVE-HEADER','Synthetic inactive ward','inactive') RETURNING id").bind(facility).fetch_one(&pool).await.unwrap();
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'HANDOFF-OTHER','Synthetic other facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    let foreign_ward:Uuid=sqlx::query_scalar("INSERT INTO wards(id,facility_id,code,name,status) VALUES(gen_random_uuid(),$1,'OTHER-HEADER','Synthetic foreign ward','active') RETURNING id").bind(foreign).fetch_one(&pool).await.unwrap();
    let foreign_user = Uuid::new_v4();
    let inactive_user = Uuid::new_v4();
    let unrelated = Uuid::new_v4();
    for (id, target_facility, active, email) in [
        (foreign_user, foreign, true, "foreign-header@hms.local"),
        (inactive_user, facility, false, "inactive-header@hms.local"),
        (unrelated, facility, true, "unrelated-header@hms.local"),
    ] {
        sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash,is_active) SELECT $1,$2,$3,'Synthetic header actor',password_hash,$4 FROM users WHERE id=$5").bind(id).bind(target_facility).bind(email).bind(active).bind(owner).execute(&pool).await.unwrap();
    }
    grant_test_permission(&app, unrelated, PermissionCode::NursingTaskManage).await;
    grant_test_feature(&app, unrelated, FeatureKey::Nursing).await;
    let (unrelated_token, _, _) = login(app.clone(), "unrelated-header@hms.local").await;
    for (target_ward, target_user) in [
        (foreign_ward, recipient),
        (inactive_ward, recipient),
        (ward, foreign_user),
        (ward, inactive_user),
    ] {
        let response = post(
            app.clone(),
            &sender_token,
            "/api/v2/nursing/handoffs",
            Some(json!({"ward_id":target_ward,"to_user_id":target_user,"shift_label":"night"})),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let value = json_body(response).await;
        assert_eq!(value["error"]["code"], "invalid_handoff_reference");
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM handoffs WHERE facility_id=$1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let audits:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type LIKE 'nursing.handoff.%'").bind(facility).fetch_one(&pool).await.unwrap();
    assert_eq!(audits, 0);
    let created = post(
        app.clone(),
        &sender_token,
        "/api/v2/nursing/handoffs",
        Some(json!({"ward_id":ward,"to_user_id":recipient,"shift_label":"night"})),
    )
    .await;
    assert_eq!(created.status(), StatusCode::OK);
    let created = json_body(created).await;
    let id = created["data"]["id"].as_str().unwrap();
    for token in [&recipient_token, &unrelated_token] {
        let denied = post(
            app.clone(),
            token,
            &format!("/api/v2/nursing/handoffs/{id}/complete"),
            None,
        )
        .await;
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        let denied = json_body(denied).await;
        assert_eq!(denied["error"]["code"], "handoff_sender_required");
    }
    let first = post(
        app.clone(),
        &sender_token,
        &format!("/api/v2/nursing/handoffs/{id}/complete"),
        None,
    )
    .await;
    assert_eq!(first.status(), StatusCode::OK);
    let first = json_body(first).await;
    assert!(first["data"]["completed_at"].is_string());
    let repeated = post(
        app.clone(),
        &sender_token,
        &format!("/api/v2/nursing/handoffs/{id}/complete"),
        None,
    )
    .await;
    assert_eq!(repeated.status(), StatusCode::OK);
    assert_eq!(first["data"], json_body(repeated).await["data"]);
    let actors:Vec<Uuid>=sqlx::query_scalar("SELECT actor_user_id FROM audit_events WHERE resource_id=$1 AND event_type IN ('nursing.handoff.created','nursing.handoff.finalized')").bind(Uuid::parse_str(id).unwrap()).fetch_all(&pool).await.unwrap();
    assert_eq!(actors, vec![owner, owner]);
    let metadata:Vec<Value>=sqlx::query_scalar("SELECT metadata FROM audit_events WHERE resource_id=$1 AND event_type LIKE 'nursing.handoff.%'").bind(Uuid::parse_str(id).unwrap()).fetch_all(&pool).await.unwrap();
    assert!(metadata.iter().all(|value| value == &json!({})));
}

#[tokio::test]
async fn unsupported_clinical_fields_are_generic_typed_rejections_without_side_effects() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let admission = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
    let before:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM handoffs),(SELECT count(*) FROM nursing_alerts),(SELECT count(*) FROM treatment_sheets)").fetch_one(&pool).await.unwrap();
    let private = "SYNTHETIC-PRIVATE-UNSUPPORTED-NARRATIVE";
    for (path, body) in [
        (
            "handoffs",
            json!({"ward_id":ward,"to_user_id":Uuid::from_u128(hms_db::provision::OWNER_USER_ID),"shift_label":"night","patient_condition":private}),
        ),
        (
            "treatment-sheets",
            json!({"admission_case_id":admission,"sheet_date":"2026-10-16","medication_name":private}),
        ),
        (
            "alerts",
            json!({"admission_case_id":admission,"severity":"critical","title":"Synthetic alert","patient_condition":private}),
        ),
    ] {
        let response = post(
            app.clone(),
            &token,
            &format!("/api/v2/nursing/{path}"),
            Some(body),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = json_body(response).await;
        assert_eq!(body["error"]["code"], "invalid_nursing_request");
        assert!(!body.to_string().contains(private));
    }
    for path in ["handoffs", "treatment-sheets", "alerts"] {
        let response = get(
            app.clone(),
            &token,
            format!("/api/v2/nursing/{path}?unsupported={private}"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = json_body(response).await;
        assert_eq!(body["error"]["code"], "invalid_nursing_list_query");
        assert!(!body.to_string().contains(private));
    }
    let after:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM handoffs),(SELECT count(*) FROM nursing_alerts),(SELECT count(*) FROM treatment_sheets)").fetch_one(&pool).await.unwrap();
    assert_eq!(before, after);
}

async fn assign_nursing_actor(app: &TestApp, user: Uuid, ward: Uuid) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let staff:Uuid=sqlx::query_scalar("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic nursing','Nurse',CURRENT_DATE) ON CONFLICT(user_id) DO UPDATE SET position=staff_profiles.position RETURNING id").bind(facility).bind(user).bind(format!("H-{user}")).fetch_one(&pool).await.unwrap();
    let practitioner:Uuid=sqlx::query_scalar("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES(gen_random_uuid(),$1,$2,$3,'Nursing','Synthetic') ON CONFLICT(staff_id) DO UPDATE SET qualification=practitioner_profiles.qualification RETURNING id").bind(facility).bind(staff).bind(format!("L-{user}")).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES(gen_random_uuid(),$1,$2,$3,'staff_nurse','Nurse','nursing') ON CONFLICT DO NOTHING").bind(facility).bind(ward).bind(practitioner).execute(&pool).await.unwrap();
}
