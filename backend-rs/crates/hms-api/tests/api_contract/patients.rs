use super::*;

#[tokio::test]
async fn patient_registry_uses_cursor_pagination_and_enforces_access() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1&include_total=true")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["page"]["limit"], 1);
    assert_eq!(body["page"]["has_next"], true);
    assert!(body["page"]["next_cursor"].is_string());
    assert!(body["data"][0]["display_name"].is_string());
    assert!(body["data"][0].get("patient_location").is_some());
    assert_eq!(body["meta"]["count_exact"], true);
    assert!(body["meta"]["total_count"].as_i64().unwrap_or_default() >= 1);

    let patient_id = body["data"][0]["id"].as_str().unwrap();
    let detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/patients/{patient_id}"))
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient detail succeeds");
    assert_eq!(detail.status(), StatusCode::OK);

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/patients")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "first_name": "Efua",
                        "last_name": "Owusu",
                        "date_of_birth": "1995-03-10",
                        "sex": "female"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("patient create succeeds");
    assert_eq!(create.status(), StatusCode::OK);
    let create_body = json_body(create).await;
    let registry_only_patient_id = create_body["data"]["id"]
        .as_str()
        .expect("created patient id exists");

    let newest = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("newest-first patient list succeeds");
    assert_eq!(newest.status(), StatusCode::OK);
    let newest_body = json_body(newest).await;
    assert_eq!(
        newest_body["data"][0]["id"].as_str(),
        Some(registry_only_patient_id),
        "patient registry should default to most recently registered first"
    );

    let lookup = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/patients/identity/lookup")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "first_name": "Efua",
                        "last_name": "Owusu",
                        "date_of_birth": "1995-03-10",
                        "sex": "female"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("identity lookup succeeds");
    assert_eq!(lookup.status(), StatusCode::OK);
    let lookup_body = json_body(lookup).await;
    assert_eq!(lookup_body["data"]["strong_duplicate_found"], true);
    assert!(lookup_body["data"]["lookup_id"].is_string());
    assert!(lookup_body["data"]["candidates"]
        .as_array()
        .expect("candidates array")
        .iter()
        .any(|candidate| candidate["patient_id"].as_str() == Some(registry_only_patient_id)));

    let duplicate_create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/patients")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "first_name": "Efua",
                        "last_name": "Owusu",
                        "date_of_birth": "1995-03-10",
                        "sex": "female"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("duplicate create evaluates");
    assert_eq!(duplicate_create.status(), StatusCode::CONFLICT);
    let duplicate_body = json_body(duplicate_create).await;
    assert_eq!(
        duplicate_body["error"]["code"].as_str(),
        Some("patient_duplicate_review_required")
    );
    let duplicate_lookup_id = duplicate_body["error"]["details"]["lookup_id"]
        .as_str()
        .expect("lookup id is returned")
        .to_owned();

    let duplicate_override = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/patients")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "first_name": "Efua",
                        "last_name": "Owusu",
                        "date_of_birth": "1995-03-10",
                        "sex": "female",
                        "duplicate_review": {
                            "lookup_id": duplicate_lookup_id,
                            "decision": "new_distinct_patient",
                            "reason_code": "different_person_confirmed"
                        }
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("duplicate override create succeeds");
    assert_eq!(duplicate_override.status(), StatusCode::OK);

    let denied_chronicle = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{registry_only_patient_id}/chronicle"
                ))
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("chronicle denial succeeds");
    assert_eq!(denied_chronicle.status(), StatusCode::FORBIDDEN);

    let break_glass = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/patients/{registry_only_patient_id}/break-glass"
                ))
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "category": "urgent_clinical_continuity",
                        "reason_text": "audit contract emergency access"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("break-glass request succeeds");
    assert_eq!(break_glass.status(), StatusCode::OK);

    let break_glass_chronicle = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{registry_only_patient_id}/chronicle/print"
                ))
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("x-request-id", "patient-break-glass-view-audit-test")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("break-glass Chronicle read succeeds");
    assert_eq!(break_glass_chronicle.status(), StatusCode::OK);

    let audit_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/audit-events?limit=10&search=patient-break-glass-view-audit-test")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient access audit list succeeds");
    assert_eq!(audit_response.status(), StatusCode::OK);
    let audit_body = json_body(audit_response).await;
    let audit_events = audit_body["data"]
        .as_array()
        .expect("patient access audit events are array");
    let patient_view_event = audit_events
        .iter()
        .find(|event| event["event_type"] == "patient.chronicle.outside_assignment_viewed")
        .expect("outside-assignment patient view audit event is returned");
    assert_eq!(
        patient_view_event["request_id"],
        "patient-break-glass-view-audit-test"
    );
    assert_eq!(patient_view_event["resource_type"], "patient_chronicle");
    assert_eq!(patient_view_event["resource_id"], registry_only_patient_id);

    let second_break_glass_chronicle = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{registry_only_patient_id}/chronicle/print"
                ))
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("x-request-id", "patient-break-glass-second-view-audit-test")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("second break-glass Chronicle read succeeds");
    assert_eq!(second_break_glass_chronicle.status(), StatusCode::OK);

    let second_audit_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/audit-events?limit=10&search=patient-break-glass-second-view-audit-test")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("second patient access audit list succeeds");
    assert_eq!(second_audit_response.status(), StatusCode::OK);
    let second_audit_body = json_body(second_audit_response).await;
    assert!(
        second_audit_body["data"]
            .as_array()
            .expect("second patient access audit events are array")
            .is_empty(),
        "outside-assignment Chronicle view should audit once per active break-glass grant"
    );

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_registry_honors_safe_server_side_ordering() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;

    for first_name in ["Alpha", "Zulu"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/patients")
                    .header(AUTHORIZATION, format!("Bearer {access_token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "first_name": first_name,
                            "last_name": "Sortorderprobe",
                            "date_of_birth": "1995-03-10",
                            "sex": "female"
                        })
                        .to_string(),
                    ))
                    .expect("request builds"),
            )
            .await
            .expect("patient create succeeds");
        assert_eq!(response.status(), StatusCode::OK);
    }

    let first_page = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1&search=Sortorderprobe&ordering=name")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ascending patient list succeeds");
    assert_eq!(first_page.status(), StatusCode::OK);
    let first_body = json_body(first_page).await;
    assert_eq!(
        first_body["data"][0]["display_name"],
        "Alpha Sortorderprobe"
    );
    let cursor = first_body["page"]["next_cursor"]
        .as_str()
        .expect("cursor exists")
        .to_owned();

    let second_page = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients?limit=1&search=Sortorderprobe&ordering=name&cursor={cursor}"
                ))
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("cursor patient list succeeds");
    assert_eq!(second_page.status(), StatusCode::OK);
    let second_body = json_body(second_page).await;
    assert_eq!(
        second_body["data"][0]["display_name"],
        "Zulu Sortorderprobe"
    );

    let descending = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1&search=Sortorderprobe&ordering=-name")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("descending patient list succeeds");
    assert_eq!(descending.status(), StatusCode::OK);
    let descending_body = json_body(descending).await;
    assert_eq!(
        descending_body["data"][0]["display_name"],
        "Zulu Sortorderprobe"
    );
}

#[tokio::test]
async fn patient_registry_rejects_unknown_ordering() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1&ordering=patient_location")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("invalid ordering request completes");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "invalid_patient_ordering");
}

#[tokio::test]
async fn patient_registry_ward_filter_defaults_to_current_admissions() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let ward_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward list succeeds");
    assert_eq!(ward_response.status(), StatusCode::OK);
    let ward_body = json_body(ward_response).await;
    let ward_id = ward_body["data"][0]["id"].as_str().expect("ward id exists");

    let cancelled_patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/patients")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "first_name": "Cancelled",
                        "last_name": "Wardfilterprobe",
                        "date_of_birth": "1984-02-11",
                        "sex": "female"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancelled-filter patient create succeeds");
    assert_eq!(cancelled_patient_response.status(), StatusCode::OK);
    let cancelled_patient_body = json_body(cancelled_patient_response).await;
    let cancelled_patient_id = cancelled_patient_body["data"]["id"]
        .as_str()
        .expect("cancelled-filter patient id exists");

    let cancelled_case_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions/cases")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": cancelled_patient_id,
                        "ward_id": ward_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancelled-filter admission case create succeeds");
    assert_eq!(cancelled_case_response.status(), StatusCode::OK);
    let cancelled_case_body = json_body(cancelled_case_response).await;
    let cancelled_case_id = cancelled_case_body["data"]["id"]
        .as_str()
        .expect("cancelled-filter admission case id exists");

    let cancel_case_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{cancelled_case_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("cancelled-filter admission case cancel succeeds");
    assert_eq!(cancel_case_response.status(), StatusCode::OK);

    let current_patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/patients")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "first_name": "Current",
                        "last_name": "Wardfilterprobe",
                        "date_of_birth": "1991-06-23",
                        "sex": "male"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("current-filter patient create succeeds");
    assert_eq!(current_patient_response.status(), StatusCode::OK);
    let current_patient_body = json_body(current_patient_response).await;
    let current_patient_id = current_patient_body["data"]["id"]
        .as_str()
        .expect("current-filter patient id exists");

    let current_case_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions/cases")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": current_patient_id,
                        "ward_id": ward_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("current-filter admission case create succeeds");
    assert_eq!(current_case_response.status(), StatusCode::OK);
    let current_case_body = json_body(current_case_response).await;
    let current_case_id = current_case_body["data"]["id"]
        .as_str()
        .expect("current-filter admission case id exists");

    let activate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{current_case_id}/activate"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("current-filter admission activates");
    assert_eq!(activate_response.status(), StatusCode::OK);

    let ward_only_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients?limit=10&search=Wardfilterprobe&ward_id={ward_id}&include_total=true"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward-only patient list succeeds");
    assert_eq!(ward_only_response.status(), StatusCode::OK);
    let ward_only_body = json_body(ward_only_response).await;
    let ward_only_rows = ward_only_body["data"]
        .as_array()
        .expect("ward-only patient list data exists");
    assert_eq!(ward_only_body["meta"]["total_count"], 1);
    assert_eq!(ward_only_rows[0]["id"], current_patient_id);
    assert!(ward_only_rows[0]["patient_location"].is_string());
    assert!(
        ward_only_rows
            .iter()
            .all(|row| row["id"].as_str() != Some(cancelled_patient_id)),
        "ward-only patient registry filter must not include cancelled historical admissions"
    );

    let explicit_cancelled_response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients?limit=10&search=Wardfilterprobe&ward_id={ward_id}&admission_status=cancelled&include_total=true"
                ))
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("explicit cancelled patient list succeeds");
    assert_eq!(explicit_cancelled_response.status(), StatusCode::OK);
    let explicit_cancelled_body = json_body(explicit_cancelled_response).await;
    let explicit_cancelled_rows = explicit_cancelled_body["data"]
        .as_array()
        .expect("explicit cancelled patient list data exists");
    assert_eq!(explicit_cancelled_body["meta"]["total_count"], 1);
    assert_eq!(explicit_cancelled_rows[0]["id"], cancelled_patient_id);
}

#[tokio::test]
async fn patient_registry_rejects_invalid_filter_ranges() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;

    for uri in [
        "/api/v2/patients?limit=1&age_min=80&age_max=20",
        "/api/v2/patients?limit=1&admission_start=2026-06-03&admission_end=2026-06-01",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(uri)
                    .header(AUTHORIZATION, format!("Bearer {access_token}"))
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("invalid filter request completes");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = json_body(response).await;
        assert_eq!(body["error"]["code"], "invalid_patient_registry_filter");
    }
}

#[tokio::test]
async fn patient_list_records_stable_query_metrics_without_phi_labels() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1&search=Ama%20Mensah")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(response.status(), StatusCode::OK);

    let metrics = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/metrics")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("metrics request succeeds");
    assert_eq!(metrics.status(), StatusCode::OK);
    let bytes = to_bytes(metrics.into_body(), usize::MAX)
        .await
        .expect("metrics body reads");
    let body = String::from_utf8(bytes.to_vec()).expect("metrics body is utf-8");

    assert!(body.contains("query=\"patient.registry.list_projection\""));
    assert!(body.contains("route=\"/api/v2/patients\""));
    assert!(!body.contains("Ama"));
    assert!(!body.contains("Mensah"));
    assert!(!body.contains("P-0000000001"));
}

#[tokio::test]
async fn patient_registry_hot_path_reuses_scoped_cache_and_invalidates_on_write() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&access_token);
    let user = app
        .state()
        .auth_user_for_claims(&claims)
        .await
        .expect("auth user lookup succeeds")
        .expect("auth user exists");
    let ctx = hms_access::RequestContext::new(
        "patient-list-cache-test".to_owned(),
        claims.session_id,
        user.clone(),
        user.features.clone(),
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );
    let query = hms_domain::patients::PatientListQuery {
        cursor: None,
        limit: Some(5),
        search: Some("Ama".to_owned()),
        patient_id: None,
        status: None,
        record_status: None,
        vital_status: None,
        admission_start: None,
        admission_end: None,
        ward_id: None,
        admission_status: None,
        attending_id: None,
        age_min: None,
        age_max: None,
        include_total: Some(false),
        ordering: None,
    };

    let (first, first_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .patients_service()
            .list_patients(&ctx, query.clone())
            .await
    })
    .await;
    first.expect("first patient list succeeds");
    assert!(
        first_queries > 0,
        "first patient registry hot page should hydrate from the database"
    );

    let (second, second_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .patients_service()
            .list_patients(&ctx, query.clone())
            .await
    })
    .await;
    second.expect("cached patient list succeeds");
    assert_eq!(
        second_queries, 0,
        "same scoped patient registry hot page should stay off the database while warm"
    );

    let cross_session_ctx = hms_access::RequestContext::new(
        "patient-list-cross-session-cache-test".to_owned(),
        Uuid::new_v4(),
        user.clone(),
        user.features.clone(),
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );
    let (cross_session, cross_session_queries) =
        hms_observability::with_request_query_counter(async {
            app.state()
                .patients_service()
                .list_patients(&cross_session_ctx, query.clone())
                .await
        })
        .await;
    cross_session.expect("cross-session cached patient list succeeds");
    assert_eq!(
        cross_session_queries, 0,
        "patient registry hot-page cache should survive session refresh when access scope is unchanged"
    );

    let mut same_scope_user = user.clone();
    same_scope_user.id = Uuid::new_v4();
    same_scope_user.email = "same-scope-registry-cache@hms.local".to_owned();
    let same_scope_ctx = hms_access::RequestContext::new(
        "patient-list-same-scope-cache-test".to_owned(),
        Uuid::new_v4(),
        same_scope_user,
        user.features.clone(),
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );
    let (same_scope, same_scope_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .patients_service()
            .list_patients(&same_scope_ctx, query.clone())
            .await
    })
    .await;
    same_scope.expect("same-scope cached patient list succeeds");
    assert_eq!(
        same_scope_queries, 0,
        "patient registry hot-page cache should be facility-scoped after the registry access gate"
    );

    app.state()
        .patients_service()
        .create_patient(
            &ctx,
            hms_domain::patients::CreatePatientRequest {
                first_name: "Cache".to_owned(),
                last_name: "Probe".to_owned(),
                date_of_birth: chrono::NaiveDate::from_ymd_opt(1999, 1, 1).expect("valid date"),
                sex: hms_domain::patients::Sex::Female,
                duplicate_review: None,
            },
        )
        .await
        .expect("patient create succeeds");

    let (after_write, after_write_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .patients_service()
            .list_patients(&ctx, query)
            .await
    })
    .await;
    after_write.expect("patient list after write succeeds");
    assert!(
        after_write_queries > 0,
        "patient registry hot-page cache should be invalidated after patient writes"
    );
}

#[tokio::test]
async fn patient_chronicle_startup_hot_path_reuses_scoped_cache() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&access_token);
    let user = app
        .state()
        .auth_user_for_claims(&claims)
        .await
        .expect("auth user lookup succeeds")
        .expect("auth user exists");
    let ctx = hms_access::RequestContext::new(
        "chronicle-cache-test".to_owned(),
        claims.session_id,
        user.clone(),
        user.features.clone(),
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    let patient_id = Uuid::parse_str(
        list_body["data"][0]["id"]
            .as_str()
            .expect("patient id exists"),
    )
    .expect("patient id is a uuid");
    let query = hms_api::services::patients::ChronicleTimelineQuery {
        cursor: None,
        limit: Some(20),
        entry_type: None,
        search: None,
        encounter_id: None,
    };

    let (first, first_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .patients_service()
            .get_patient_chronicle(&ctx, patient_id, query.clone())
            .await
    })
    .await;
    first.expect("first Chronicle startup succeeds");
    assert!(
        first_queries > 0,
        "first Chronicle startup should hydrate from the database"
    );

    let (second, second_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .patients_service()
            .get_patient_chronicle(&ctx, patient_id, query.clone())
            .await
    })
    .await;
    second.expect("cached Chronicle startup succeeds");
    assert_eq!(
        second_queries, 1,
        "same scoped Chronicle startup should recheck access before serving cached PHI"
    );

    let cross_session_ctx = hms_access::RequestContext::new(
        "chronicle-cross-session-cache-test".to_owned(),
        Uuid::new_v4(),
        user.clone(),
        user.features.clone(),
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );
    let (cross_session, cross_session_queries) =
        hms_observability::with_request_query_counter(async {
            app.state()
                .patients_service()
                .get_patient_chronicle(&cross_session_ctx, patient_id, query.clone())
                .await
        })
        .await;
    cross_session.expect("cross-session cached Chronicle startup succeeds");
    assert_eq!(
        cross_session_queries, 1,
        "Chronicle startup cache should survive session refresh while rechecking access"
    );

    let offsite_ctx = hms_access::RequestContext::new(
        "chronicle-offsite-cache-test".to_owned(),
        Uuid::new_v4(),
        user.clone(),
        user.features.clone(),
        hms_access::OffsiteState::OffsiteReadOnly,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );
    let (offsite, offsite_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .patients_service()
            .get_patient_chronicle(&offsite_ctx, patient_id, query)
            .await
    })
    .await;
    let offsite = offsite.expect("offsite Chronicle startup succeeds");
    assert!(
        offsite_queries > 0,
        "offsite Chronicle startup must not reuse an onsite write-capable cache entry"
    );
    assert!(
        offsite.data.permissions.read_only,
        "offsite Chronicle startup should remain read-only"
    );
}

#[tokio::test]
async fn patient_chronicle_startup_is_shaped_bounded_and_query_budgeted() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    let patient_id = list_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let (response, observed_queries) = hms_observability::with_request_query_counter(async {
        app.clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/v2/patients/{patient_id}/chronicle?limit=20"))
                    .header(AUTHORIZATION, auth_header)
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
    })
    .await;
    let response = response.expect("chronicle startup succeeds");
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        observed_queries <= 3,
        "Chronicle startup should stay within the request-context, patient, and shaped-read budget; observed {observed_queries}"
    );

    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body reads");
    assert!(
        bytes.len() <= 150 * 1024,
        "Chronicle startup payload was {} bytes, above the 150KiB first-view budget",
        bytes.len()
    );
    let body: Value = serde_json::from_slice(&bytes).expect("response body is json");

    assert_eq!(body["data"]["identity"]["id"], patient_id);
    assert!(body["data"]["active_context"].is_object());
    assert!(body["data"]["care_team"].is_array());
    assert!(body["data"]["summaries"]["problems"].is_array());
    assert!(body["data"]["summaries"]["allergies"].is_array());
    assert!(body["data"]["summaries"]["medications"].is_array());
    assert!(body["data"]["summaries"]["labs"].is_array());
    assert!(body["data"]["encounters"].is_array());
    let encounter_ids = body["data"]["encounters"]
        .as_array()
        .expect("encounters is an array")
        .iter()
        .filter_map(|encounter| encounter["id"].as_str())
        .collect::<std::collections::HashSet<_>>();
    for entry in body["data"]["timeline"]["data"]
        .as_array()
        .expect("timeline data is an array")
        .iter()
    {
        if let Some(encounter_id) = entry["encounter_id"].as_str() {
            assert!(
                encounter_ids.contains(encounter_id),
                "encounter-linked timeline entry {encounter_id} must be present in Chronicle visit focus options"
            );
        }
    }
    assert!(body["data"]["timeline"]["results"].is_null());
    assert!(body["data"]["timeline"]["data"].is_array());
    assert_eq!(body["data"]["timeline"]["page"]["limit"], 20);
    assert_eq!(body["data"]["permissions"]["can_view_chronicle"], true);
}

#[tokio::test]
async fn patient_validation_rules_are_available_from_v2_contract() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/validation-rules")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("validation rules request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let rules = body["data"].as_array().expect("rules are returned as data");
    assert!(
        rules.iter().any(|rule| {
            rule["field_name"] == "first_name"
                && rule["is_required"] == true
                && rule["is_active"] == true
        }),
        "baseline first_name required rule is exposed"
    );
    assert_eq!(body["page"]["has_next"], false);
}

#[tokio::test]
async fn patient_update_and_context_list_are_patient_access_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    let patient_id = list_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/patients/{patient_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "patient-update-test")
                .body(Body::from(
                    json!({
                        "first_name": "Akua",
                        "last_name": "Mensah",
                        "status": "active"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("patient update succeeds");
    let update_status = update_response.status();
    let update_body = json_body(update_response).await;
    assert_eq!(update_status, StatusCode::OK, "{update_body}");
    assert_eq!(update_body["data"]["first_name"], "Akua");
    assert_eq!(update_body["data"]["display_name"], "Akua Mensah");

    let context_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/context?limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient context list succeeds");
    let context_status = context_response.status();
    let context_body = json_body(context_response).await;
    assert_eq!(context_status, StatusCode::OK, "{context_body}");
    assert_eq!(context_body["data"][0]["id"], patient_id);
    assert!(context_body["data"][0]["context_kind"].is_string());

    let filtered_context_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/context?limit=5&patient_id={patient_id}"
                ))
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("filtered patient context list succeeds");
    let filtered_context_status = filtered_context_response.status();
    let filtered_context_body = json_body(filtered_context_response).await;
    assert_eq!(
        filtered_context_status,
        StatusCode::OK,
        "{filtered_context_body}"
    );
    let filtered_context_data = filtered_context_body["data"]
        .as_array()
        .expect("filtered context data array");
    assert!(!filtered_context_data.is_empty());
    assert!(filtered_context_data
        .iter()
        .all(|entry| entry["id"] == patient_id));

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/patients/{patient_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "first_name": "Denied" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("patient update denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
