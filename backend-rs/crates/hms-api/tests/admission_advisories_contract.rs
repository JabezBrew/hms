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
    let body = if let Some(body) = body {
        request = request.header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    app.clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap()
}
fn base(patient: Uuid, case: Uuid) -> String {
    format!("/api/v2/patients/{patient}/chronicle/admissions/{case}/advisories")
}
async fn relationship(app: &TestApp, user: Uuid, patient: Uuid) {
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(app.state().facility_id()).bind(user).bind(patient).execute(&app.db_pool().await).await.unwrap();
}
async fn fixture(app: &TestApp, status: &str) -> (Uuid, Uuid) {
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
    let case:Uuid=sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,$4) RETURNING id").bind(facility).bind(patient).bind(ward).bind(status).fetch_one(&pool).await.unwrap();
    relationship(app, owner, patient).await;
    (patient, case)
}
async fn data(response: axum::response::Response) -> Value {
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await["data"].clone()
}
async fn context(app: &TestApp, token: &str, patient: Uuid, case: Uuid) -> Value {
    data(send(app, token, Method::GET, base(patient, case), None).await).await
}
async fn counts(app: &TestApp) -> (i64, i64) {
    sqlx::query_as("SELECT (SELECT count(*) FROM admission_advisories),(SELECT count(*) FROM admission_advisory_commands)").fetch_one(&app.db_pool().await).await.unwrap()
}
fn create(context: &Value, kind: &str) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"expected_context_token":context["context_token"],"task_type":kind,"notes":"SYNTHETIC-PROTECTED-ADVISORY"})
}
async fn grant_limited(app: &TestApp, full: bool) {
    let id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for p in [
        PermissionCode::PatientDemographicsView,
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::AdmissionManage,
        PermissionCode::WardBoardViewAll,
    ] {
        grant_test_permission(app, id, p).await;
    }
    for f in [
        FeatureKey::Patients,
        FeatureKey::Encounters,
        FeatureKey::Admissions,
    ] {
        grant_test_feature(app, id, f).await;
    }
    grant_test_patient_visibility(app, id, PatientDataVisibility::Demographics).await;
    if full {
        grant_test_patient_visibility(app, id, PatientDataVisibility::FullClinical).await;
    }
}

#[tokio::test]
async fn eight_real_nonblocking_types_and_distinct_immutable_terminal_decisions() {
    let app = app().await;
    let (patient, case) = fixture(&app, "ready_for_activation").await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let first_context = context(&app, &token, patient, case).await;
    assert_eq!(
        first_context["available_types"].as_array().unwrap().len(),
        8
    );
    assert_eq!(first_context["complete"], true);
    let mut receipts = Vec::new();
    for kind in [
        "pharmacy_med_rec",
        "baseline_lab_followup",
        "infection_control",
        "dietary",
        "social_work",
        "transport",
        "documents",
        "other",
    ] {
        let current = context(&app, &token, patient, case).await;
        let command = create(&current, kind);
        let receipt = data(
            send(
                &app,
                &token,
                Method::POST,
                base(patient, case),
                Some(command.clone()),
            )
            .await,
        )
        .await;
        assert_eq!(receipt["advisory"]["phase"], "pre_activation");
        assert_eq!(receipt["advisory"]["status"], "pending");
        assert_eq!(receipt["advisory"]["version"], 1);
        assert_eq!(receipt["advisory"]["notes"], command["notes"]);
        assert_eq!(receipt["advisory"]["can_complete"], false);
        let replay = data(
            send(
                &app,
                &token,
                Method::POST,
                base(patient, case),
                Some(command.clone()),
            )
            .await,
        )
        .await;
        assert_eq!(replay["replayed"], true);
        assert_eq!(replay["advisory"], receipt["advisory"]);
        receipts.push((command, receipt));
    }
    let current = context(&app, &token, patient, case).await;
    assert_eq!(current["advisories"].as_array().unwrap().len(), 8);
    assert_eq!(current["counts_by_status"]["pending"], 8);
    assert_eq!(current["can_create"], false);
    assert!(current["advisories"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row.get("notes").is_none() && row.get("decision").is_none()));
    for (index, (decision, reason)) in [
        ("completed", None),
        (
            "acknowledged_unresolved",
            Some("Synthetic unresolved follow-up"),
        ),
        ("cancelled", Some("Synthetic deliberate retirement")),
    ]
    .into_iter()
    .enumerate()
    {
        let id = receipts[index].1["advisory"]["id"].as_str().unwrap();
        let current = context(&app, &token, patient, case).await;
        let command = json!({"client_request_id":Uuid::new_v4(),"expected_context_token":current["context_token"],"expected_version":1,"decision":decision,"reason":reason});
        let url = format!("{}/{id}/decision", base(patient, case));
        let receipt = data(
            send(
                &app,
                &token,
                Method::POST,
                url.clone(),
                Some(command.clone()),
            )
            .await,
        )
        .await;
        assert_eq!(receipt["advisory"]["status"], decision);
        assert_eq!(receipt["advisory"]["version"], 2);
        assert_eq!(receipt["advisory"]["decision"]["source"], "manual");
        assert_eq!(receipt["advisory"]["decision"]["reason"], json!(reason));
        assert!(receipt["advisory"]["decision"]["recorded_by_user_id"].is_string());
        assert!(receipt["advisory"]["decision"]["recorded_at"].is_string());
        assert_eq!(
            data(
                send(
                    &app,
                    &token,
                    Method::POST,
                    url.clone(),
                    Some(command.clone())
                )
                .await
            )
            .await["advisory"],
            receipt["advisory"]
        );
        let mut changed = command.clone();
        changed["client_request_id"] = json!(Uuid::new_v4());
        changed["expected_version"] = json!(2);
        assert_eq!(
            send(&app, &token, Method::POST, url, Some(changed))
                .await
                .status(),
            StatusCode::CONFLICT
        );
        let original = data(
            send(
                &app,
                &token,
                Method::GET,
                format!(
                    "{}/requests/{}",
                    base(patient, case),
                    receipts[index].0["client_request_id"].as_str().unwrap()
                ),
                None,
            )
            .await,
        )
        .await;
        assert_eq!(original["advisory"], receipts[index].1["advisory"]);
        assert_eq!(original["replayed"], true);
    }
    let current = context(&app, &token, patient, case).await;
    assert_eq!(
        current["counts_by_status"],
        json!({"pending":5,"completed":1,"acknowledged_unresolved":1,"cancelled":1})
    );
    let row: (String, Option<Uuid>) =
        sqlx::query_as("SELECT status,bed_id FROM admission_cases WHERE id=$1")
            .bind(case)
            .fetch_one(&app.db_pool().await)
            .await
            .unwrap();
    assert_eq!(row, ("ready_for_activation".into(), None));
    let page = data(
        send(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/patients/{patient}/chronicle/admission-advisory-cases?limit=1"),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(page[0]["admission_case_id"], case.to_string());
}

#[tokio::test]
async fn strict_invalid_scope_blocker_types_versions_and_reasons_create_no_effects() {
    let app = app().await;
    let (patient, case) = fixture(&app, "admitted").await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let current = context(&app, &token, patient, case).await;
    let baseline = counts(&app).await;
    for (key, value) in [
        ("blocking", json!(false)),
        ("phase", json!("pre_activation")),
        ("assigned_role", json!("nurse")),
        ("snapshot", json!({"notes":"Synthetic untrusted"})),
    ] {
        let mut command = create(&current, "other");
        command[key] = value;
        assert_eq!(
            send(
                &app,
                &token,
                Method::POST,
                base(patient, case),
                Some(command)
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
    }
    for kind in [
        "medical_order",
        "registration",
        "nursing_intake",
        "admission_documentation",
        "financial",
        "placement",
    ] {
        assert_eq!(
            send(
                &app,
                &token,
                Method::POST,
                base(patient, case),
                Some(create(&current, kind))
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let mut empty = create(&current, "other");
    empty["notes"] = json!("   ");
    assert_eq!(
        send(&app, &token, Method::POST, base(patient, case), Some(empty))
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(counts(&app).await, baseline);
    let original = create(&current, "other");
    let first = data(
        send(
            &app,
            &token,
            Method::POST,
            base(patient, case),
            Some(original.clone()),
        )
        .await,
    )
    .await;
    assert_eq!(first["advisory"]["phase"], "post_activation");
    let id = first["advisory"]["id"].as_str().unwrap();
    let after = counts(&app).await;
    let mut changed = original;
    changed["notes"] = json!("Synthetic changed reviewed body");
    assert_eq!(
        send(
            &app,
            &token,
            Method::POST,
            base(patient, case),
            Some(changed)
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    let current = context(&app, &token, patient, case).await;
    for decision in ["acknowledged_unresolved", "cancelled"] {
        let cmd = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"expected_context_token":current["context_token"],"decision":decision,"reason":"  "});
        assert_eq!(
            send(
                &app,
                &token,
                Method::POST,
                format!("{}/{id}/decision", base(patient, case)),
                Some(cmd)
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let bad = json!({"client_request_id":Uuid::new_v4(),"expected_version":2,"expected_context_token":current["context_token"],"decision":"completed","reason":null});
    assert_eq!(
        send(
            &app,
            &token,
            Method::POST,
            format!("{}/{id}/decision", base(patient, case)),
            Some(bad)
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    for path in [
        base(patient, Uuid::new_v4()),
        base(Uuid::new_v4(), case),
        format!("{}/{}", base(patient, case), Uuid::new_v4()),
    ] {
        let response = send(&app, &token, Method::GET, path, None).await;
        assert!(matches!(
            response.status(),
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND | StatusCode::CONFLICT
        ));
        assert!(!json_body(response)
            .await
            .to_string()
            .contains("SYNTHETIC-PROTECTED-ADVISORY"));
    }
    assert_eq!(counts(&app).await, after);
}

#[tokio::test]
async fn full_visibility_ordinary_relationship_features_and_ward_rights_are_all_required() {
    let app = app().await;
    let (patient, case) = fixture(&app, "admitted").await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let current = context(&app, &owner, patient, case).await;
    let first = data(
        send(
            &app,
            &owner,
            Method::POST,
            base(patient, case),
            Some(create(&current, "other")),
        )
        .await,
    )
    .await;
    let id = first["advisory"]["id"].as_str().unwrap();
    grant_limited(&app, false).await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    relationship(&app, limited, patient).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in [
        base(patient, case),
        format!("{}/{id}", base(patient, case)),
        format!("/api/v2/patients/{patient}/chronicle/admission-advisory-cases"),
    ] {
        let r = send(&app, &token, Method::GET, path, None).await;
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
        assert!(!json_body(r)
            .await
            .to_string()
            .contains("SYNTHETIC-PROTECTED-ADVISORY"));
    }
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::FullClinical).await;
    sqlx::query("DELETE FROM patient_contexts WHERE user_id=$1 AND patient_id=$2")
        .bind(limited)
        .bind(patient)
        .execute(&app.db_pool().await)
        .await
        .unwrap();
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        send(&app, &token, Method::GET, base(patient, case), None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    relationship(&app, limited, patient).await;
    assert_eq!(
        send(&app, &token, Method::GET, base(patient, case), None)
            .await
            .status(),
        StatusCode::OK
    );
    let pool = app.db_pool().await;
    sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code=$2")
        .bind(limited)
        .bind(hms_db::codec::encode(PermissionCode::WardBoardViewAll).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
        .bind(limited)
        .execute(&pool)
        .await
        .unwrap();
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = send(&app, &token, Method::GET, base(patient, case), None).await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "admission_advisory_ward_denied"
    );
    let page = data(
        send(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/patients/{patient}/chronicle/admission-advisory-cases?limit=1"),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(page, json!([]));
    grant_test_permission(&app, limited, PermissionCode::WardBoardViewAll).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        send(&app, &token, Method::GET, base(patient, case), None)
            .await
            .status(),
        StatusCode::OK
    );
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'admissions',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(app.state().facility_id()).execute(&app.db_pool().await).await.unwrap();
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            format!("{}/{id}", base(patient, case)),
            None
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn operational_case_cancel_atomically_retires_only_pending_without_exposing_notes() {
    let app = app().await;
    let (patient, case) = fixture(&app, "ready_for_activation").await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let current = context(&app, &owner, patient, case).await;
    let completed = data(
        send(
            &app,
            &owner,
            Method::POST,
            base(patient, case),
            Some(create(&current, "other")),
        )
        .await,
    )
    .await;
    let complete_id = completed["advisory"]["id"].as_str().unwrap();
    let current = context(&app, &owner, patient, case).await;
    let completed=data(send(&app,&owner,Method::POST,format!("{}/{complete_id}/decision",base(patient,case)),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"expected_context_token":current["context_token"],"decision":"completed","reason":null}))).await).await;
    let current = context(&app, &owner, patient, case).await;
    let original = create(&current, "transport");
    let pending = data(
        send(
            &app,
            &owner,
            Method::POST,
            base(patient, case),
            Some(original.clone()),
        )
        .await,
    )
    .await;
    let pending_id = pending["advisory"]["id"].as_str().unwrap();
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for permission in [
        PermissionCode::PatientDemographicsView,
        PermissionCode::AdmissionManage,
    ] {
        grant_test_permission(&app, limited, permission).await;
    }
    for f in [FeatureKey::Patients, FeatureKey::Admissions] {
        grant_test_feature(&app, limited, f).await;
    }
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let path = format!("/api/v2/admissions/cases/{case}/cancel");
    assert_eq!(
        send(
            &app,
            &token,
            Method::POST,
            path.clone(),
            Some(json!({"reason":"Synthetic silently ignored reason is forbidden"}))
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    let result = data(send(&app, &token, Method::POST, path, None).await).await;
    assert_eq!(result["status"], "cancelled");
    assert!(!result.to_string().contains("SYNTHETIC-PROTECTED-ADVISORY"));
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            format!("{}/{pending_id}", base(patient, case)),
            None
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        data(
            send(
                &app,
                &owner,
                Method::GET,
                format!("{}/{complete_id}", base(patient, case)),
                None
            )
            .await
        )
        .await["decision"],
        completed["advisory"]["decision"]
    );
    let retired = data(
        send(
            &app,
            &owner,
            Method::GET,
            format!("{}/{pending_id}", base(patient, case)),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(retired["status"], "cancelled");
    assert_eq!(retired["decision"]["source"], "admission_case_cancelled");
    assert_eq!(
        retired["decision"]["system_reason_code"],
        "admission_case_cancelled"
    );
    assert_eq!(retired["decision"]["reason"], Value::Null);
    assert_eq!(
        retired["decision"]["recorded_by_user_id"],
        limited.to_string()
    );
    let recovered = data(
        send(
            &app,
            &owner,
            Method::GET,
            format!(
                "{}/requests/{}",
                base(patient, case),
                original["client_request_id"].as_str().unwrap()
            ),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(recovered["advisory"], pending["advisory"]);
    assert_eq!(recovered["replayed"], true);
    assert_eq!(
        context(&app, &owner, patient, case).await["can_create"],
        false
    );
}

#[tokio::test]
async fn actual_discharge_is_nonblocking_and_records_episode_retirement_with_operational_rights() {
    let app = app().await;
    let (patient, case) = fixture(&app, "admitted").await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let current = context(&app, &owner, patient, case).await;
    let pending = data(
        send(
            &app,
            &owner,
            Method::POST,
            base(patient, case),
            Some(create(&current, "baseline_lab_followup")),
        )
        .await,
    )
    .await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let admission = hms_db::ward::get_admission_context(&pool, facility, case)
        .await
        .unwrap()
        .unwrap();
    let discharge = hms_db::ward::request_discharge(
        &pool,
        Uuid::new_v4(),
        facility,
        &admission,
        None,
        None,
        owner_id,
    )
    .await
    .unwrap();
    let before_blocked = counts(&app).await;
    let blocked = send(
        &app,
        &owner,
        Method::POST,
        format!("/api/v2/discharges/{}/complete", discharge.id),
        None,
    )
    .await;
    assert_eq!(blocked.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(blocked).await["error"]["code"],
        "discharge_blockers_open"
    );
    assert_eq!(counts(&app).await, before_blocked);
    // Isolate the closure contract with explicit, audited fixture overrides.
    // This does not claim that the separate source-clearance workflow is complete.
    for kind in [
        hms_domain::ward::DischargeBlockerKind::DischargeSummary,
        hms_domain::ward::DischargeBlockerKind::NursingRelease,
        hms_domain::ward::DischargeBlockerKind::PharmacyClearance,
        hms_domain::ward::DischargeBlockerKind::BillingClearance,
    ] {
        hms_db::ward::override_discharge_blocker(
            &pool,
            facility,
            discharge.id,
            kind,
            "Synthetic explicit closure fixture override".into(),
            owner_id,
            Utc::now(),
        )
        .await
        .unwrap()
        .unwrap();
    }
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for p in [
        PermissionCode::PatientDemographicsView,
        PermissionCode::AdmissionManage,
    ] {
        grant_test_permission(&app, limited, p).await;
    }
    for f in [FeatureKey::Patients, FeatureKey::Admissions] {
        grant_test_feature(&app, limited, f).await;
    }
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let url = format!("/api/v2/discharges/{}/complete", discharge.id);
    assert_eq!(
        send(
            &app,
            &token,
            Method::POST,
            url.clone(),
            Some(json!({"notes":"Synthetic unsupported completion text"}))
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    let result = data(send(&app, &token, Method::POST, url, None).await).await;
    assert_eq!(result["status"], "completed");
    assert!(!result.to_string().contains("SYNTHETIC-PROTECTED-ADVISORY"));
    let id = pending["advisory"]["id"].as_str().unwrap();
    let retired = data(
        send(
            &app,
            &owner,
            Method::GET,
            format!("{}/{id}", base(patient, case)),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(retired["status"], "cancelled");
    assert_eq!(retired["decision"]["source"], "admission_discharged");
    assert_eq!(
        retired["decision"]["system_reason_code"],
        "admission_discharged"
    );
    assert_eq!(
        retired["decision"]["recorded_by_user_id"],
        limited.to_string()
    );
    assert_eq!(retired["decision"]["reason"], Value::Null);
    let current = context(&app, &owner, patient, case).await;
    assert_eq!(current["admission_status"], "discharged");
    assert_eq!(current["can_create"], false);
    assert_eq!(current["counts_by_status"]["cancelled"], 1);
}

#[tokio::test]
async fn real_case_lock_wait_cannot_publish_cancel_after_exact_session_revocation() {
    let app = app().await;
    let (patient, case) = fixture(&app, "ready_for_activation").await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let current = context(&app, &token, patient, case).await;
    let pending = data(
        send(
            &app,
            &token,
            Method::POST,
            base(patient, case),
            Some(create(&current, "other")),
        )
        .await,
    )
    .await;
    let baseline = counts(&app).await;
    let pool = app.db_pool().await;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM admission_cases WHERE id=$1 FOR UPDATE")
        .bind(case)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let app_for_task = app.clone();
    let task_token = token.clone();
    let mut task = tokio::spawn(async move {
        send(
            &app_for_task,
            &task_token,
            Method::POST,
            format!("/api/v2/admissions/cases/{case}/cancel"),
            None,
        )
        .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut task)
            .await
            .is_err(),
        "production closure must wait for the actual source lock"
    );
    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
        .bind(access_claims(&token).session_id)
        .execute(&pool)
        .await
        .unwrap();
    blocker.commit().await.unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let state: String = sqlx::query_scalar("SELECT status FROM admission_cases WHERE id=$1")
        .bind(case)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "ready_for_activation");
    let state: String = sqlx::query_scalar("SELECT status FROM admission_advisories WHERE id=$1")
        .bind(Uuid::parse_str(pending["advisory"]["id"].as_str().unwrap()).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "pending");
    assert_eq!(counts(&app).await, baseline);
}

#[tokio::test]
async fn direct_rich_read_and_new_task_reauthorize_after_real_case_lock_wait() {
    let app = app().await;
    let (patient, case) = fixture(&app, "admitted").await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let current = context(&app, &owner, patient, case).await;
    let first = data(
        send(
            &app,
            &owner,
            Method::POST,
            base(patient, case),
            Some(create(&current, "other")),
        )
        .await,
    )
    .await;
    let id = first["advisory"]["id"].as_str().unwrap().to_owned();
    for operation in ["read", "create"] {
        let (token, _, _) = login(app.clone(), "owner@hms.local").await;
        let current = context(&app, &token, patient, case).await;
        let input = create(&current, "transport");
        let baseline = counts(&app).await;
        let pool = app.db_pool().await;
        let mut blocker = pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM admission_cases WHERE id=$1 FOR UPDATE")
            .bind(case)
            .fetch_one(&mut *blocker)
            .await
            .unwrap();
        let app_for_task = app.clone();
        let task_token = token.clone();
        let detail_path = format!("{}/{id}", base(patient, case));
        let mut task = tokio::spawn(async move {
            if operation == "read" {
                send(&app_for_task, &task_token, Method::GET, detail_path, None).await
            } else {
                send(
                    &app_for_task,
                    &task_token,
                    Method::POST,
                    base(patient, case),
                    Some(input),
                )
                .await
            }
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), &mut task)
                .await
                .is_err(),
            "production advisory operation must wait on the case parent"
        );
        sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
            .bind(access_claims(&token).session_id)
            .execute(&pool)
            .await
            .unwrap();
        blocker.commit().await.unwrap();
        let response = tokio::time::timeout(std::time::Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!json_body(response)
            .await
            .to_string()
            .contains("SYNTHETIC-PROTECTED-ADVISORY"));
        assert_eq!(counts(&app).await, baseline);
    }
}
