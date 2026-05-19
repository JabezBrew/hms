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
                .uri("/api/v2/patients?limit=1")
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

    assert!(body.contains("query=\"patient.registry.list\""));
    assert!(body.contains("route=\"/api/v2/patients\""));
    assert!(!body.contains("Ama"));
    assert!(!body.contains("Mensah"));
    assert!(!body.contains("P-0000000001"));
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
