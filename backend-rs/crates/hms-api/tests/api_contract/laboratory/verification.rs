use super::*;

#[tokio::test]
async fn laboratory_order_verification_waits_for_every_requested_test_and_retries_safely() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth = format!("Bearer {token}");
    let (status, patients) =
        lab_request(&app, &auth, Method::GET, "/api/v2/patients?limit=1", None).await;
    assert_eq!(status, StatusCode::OK);
    let patient_id = patients["data"][0]["id"]
        .as_str()
        .expect("synthetic patient exists");
    let (status, tests) = lab_request(
        &app,
        &auth,
        Method::GET,
        "/api/v2/laboratory/test-catalog?limit=2",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let tests = tests["data"].as_array().expect("test catalog exists");
    assert_eq!(tests.len(), 2);
    let test_ids: Vec<_> = tests.iter().map(|test| test["id"].clone()).collect();
    let order_payload =
        json!({ "patient_id": patient_id, "test_ids": test_ids, "priority": "routine" });
    let (status, order) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/orders",
        Some(order_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{order}");
    let order_id = order["data"]["id"].as_str().expect("order exists");
    let (status, specimen) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/specimens",
        Some(json!({ "order_id": order_id, "specimen_type": "blood" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{specimen}");
    let specimen_id = specimen["data"]["id"].as_str().expect("specimen exists");
    let result_payload =
        json!({ "specimen_id": specimen_id, "test_id": test_ids[0], "value": "synthetic result" });
    let (status, result) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/results",
        Some(result_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    let result_id = result["data"]["id"].as_str().expect("result exists");
    let verify_uri = format!("/api/v2/laboratory/results/{result_id}/verify");
    let (status, verified) = lab_request(&app, &auth, Method::POST, &verify_uri, None).await;
    assert_eq!(status, StatusCode::OK, "{verified}");
    let verified_at = verified["data"]["verified_at"].clone();
    assert!(verified_at.is_string());
    let order_uri = format!("/api/v2/laboratory/orders/{order_id}");
    let (status, pending) = lab_request(&app, &auth, Method::GET, &order_uri, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(pending["data"]["status"], "result_entered");
    let (status, retried) = lab_request(&app, &auth, Method::POST, &verify_uri, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(retried["data"]["verified_at"], verified_at);

    let (status, second) = lab_request(&app, &auth, Method::POST, "/api/v2/laboratory/results", Some(json!({ "specimen_id": specimen_id, "test_id": test_ids[1], "value": "synthetic result" }))).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    let bulk_payload = json!({ "order_id": order_id });
    let (status, bulk) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/results/bulk-verify",
        Some(bulk_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{bulk}");
    assert_eq!(bulk["data"]["verified_count"], 1);
    let (status, complete) = lab_request(&app, &auth, Method::GET, &order_uri, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(complete["data"]["status"], "verified");
    let (status, repeat) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/results/bulk-verify",
        Some(bulk_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(repeat["data"]["verified_count"], 0);

    let (status, cancelled_order) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/orders",
        Some(order_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cancelled_id = cancelled_order["data"]["id"]
        .as_str()
        .expect("second order exists");
    let specimen_payload = json!({ "order_id": cancelled_id, "specimen_type": "blood" });
    let (status, cancelled_specimen) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/specimens",
        Some(specimen_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let specimen_id = cancelled_specimen["data"]["id"]
        .as_str()
        .expect("second specimen exists");
    let result_payload =
        json!({ "specimen_id": specimen_id, "test_id": test_ids[0], "value": "synthetic result" });
    let (status, pending_result) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/results",
        Some(result_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let pending_id = pending_result["data"]["id"]
        .as_str()
        .expect("pending result exists");
    let cancel_uri = format!("/api/v2/laboratory/orders/{cancelled_id}/cancel");
    let (status, cancellation) = lab_request(
        &app,
        &auth,
        Method::POST,
        &cancel_uri,
        Some(json!({ "cancellation_reason": "Synthetic duplicate order" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancellation}");
    let (status, denial) = lab_request(
        &app,
        &auth,
        Method::POST,
        &format!("/api/v2/laboratory/results/{pending_id}/verify"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{denial}");
    let (status, denial) = lab_request(
        &app,
        &auth,
        Method::POST,
        "/api/v2/laboratory/specimens",
        Some(specimen_payload),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{denial}");
    let (status, denial) = lab_request(&app, &auth, Method::POST, "/api/v2/laboratory/results", Some(json!({ "specimen_id": specimen_id, "test_id": test_ids[1], "value": "synthetic result" }))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{denial}");
    let (status, still_cancelled) = lab_request(
        &app,
        &auth,
        Method::GET,
        &format!("/api/v2/laboratory/orders/{cancelled_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(still_cancelled["data"]["status"], "cancelled");
}

async fn lab_request(
    app: &TestApp,
    auth: &str,
    method: Method,
    uri: &str,
    payload: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header(AUTHORIZATION, auth)
        .header("content-type", "application/json")
        .body(
            payload
                .map(|value| Body::from(value.to_string()))
                .unwrap_or_else(Body::empty),
        )
        .expect("request builds");
    let response = app
        .clone()
        .oneshot(request)
        .await
        .expect("request succeeds");
    (response.status(), json_body(response).await)
}
