use super::*;

#[tokio::test]
async fn laboratory_orders_specimens_results_and_verification_are_patient_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let patient_response = app
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
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let catalog = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/test-catalog")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("catalog list succeeds");
    assert_eq!(catalog.status(), StatusCode::OK);
    let catalog_body = json_body(catalog).await;
    let test_id = catalog_body["data"][0]["id"]
        .as_str()
        .expect("test id exists");

    let test_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/test-catalog/{test_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("catalog detail succeeds");
    assert_eq!(test_detail.status(), StatusCode::OK);
    let test_detail_body = json_body(test_detail).await;
    assert_eq!(test_detail_body["data"]["id"], test_id);

    let panels = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/panels")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("panel list succeeds");
    assert_eq!(panels.status(), StatusCode::OK);
    let panels_body = json_body(panels).await;
    let panel_id = panels_body["data"][0]["id"]
        .as_str()
        .expect("panel id exists");

    let panel_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/panels/{panel_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("panel detail succeeds");
    assert_eq!(panel_detail.status(), StatusCode::OK);
    let panel_detail_body = json_body(panel_detail).await;
    assert_eq!(panel_detail_body["data"]["id"], panel_id);

    let order_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/orders")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "test_ids": [],
                        "panel_ids": [panel_id],
                        "priority": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("lab order create succeeds");
    assert_eq!(order_response.status(), StatusCode::OK);
    let order_body = json_body(order_response).await;
    let order_id = order_body["data"]["id"].as_str().expect("order id exists");
    assert_eq!(order_body["data"]["status"], "ordered");
    assert!(order_body["data"]["test_count"].as_i64().unwrap() >= 1);

    let submit_order = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/laboratory/orders/{order_id}/submit"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("order submit succeeds");
    assert_eq!(submit_order.status(), StatusCode::OK);
    let submit_order_body = json_body(submit_order).await;
    assert_eq!(submit_order_body["data"]["id"], order_id);
    assert_eq!(submit_order_body["data"]["status"], "ordered");

    let order_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/orders/{order_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("lab order detail succeeds");
    assert_eq!(order_detail.status(), StatusCode::OK);
    let order_detail_body = json_body(order_detail).await;
    assert_eq!(order_detail_body["data"]["id"], order_id);
    assert_eq!(order_detail_body["data"]["patient_id"], patient_id);
    let order_tests = order_detail_body["data"]["order_tests"]
        .as_array()
        .expect("order tests are included for result entry");
    assert!(!order_tests.is_empty());
    assert!(order_tests[0]["test"]["name"].is_string());
    let panel_order_test_id = order_tests[0]["test"]["id"]
        .as_str()
        .expect("panel order test id exists");

    let orders = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/orders?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("lab order list succeeds");
    assert_eq!(orders.status(), StatusCode::OK);
    let orders_body = json_body(orders).await;
    assert_eq!(orders_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(orders_body["page"]["limit"], 1);

    let ordered_orders = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/orders?status=ordered&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("status-filtered order list succeeds");
    assert_eq!(ordered_orders.status(), StatusCode::OK);
    let ordered_orders_body = json_body(ordered_orders).await;
    assert!(ordered_orders_body["data"]
        .as_array()
        .expect("orders are an array")
        .iter()
        .all(|order| order["status"] == "ordered"));

    let specimen_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/specimens")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": order_id,
                        "specimen_type": "blood"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("specimen create succeeds");
    assert_eq!(specimen_response.status(), StatusCode::OK);
    let specimen_body = json_body(specimen_response).await;
    let specimen_id = specimen_body["data"]["id"]
        .as_str()
        .expect("specimen id exists");
    assert_eq!(specimen_body["data"]["status"], "collected");

    let collect_order = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/laboratory/orders/{order_id}/collect"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("order collect succeeds");
    assert_eq!(collect_order.status(), StatusCode::OK);
    let collect_order_body = json_body(collect_order).await;
    assert_eq!(collect_order_body["data"]["id"], order_id);
    assert_eq!(collect_order_body["data"]["status"], "specimen_collected");

    let receive_specimen = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/specimens/{specimen_id}/receive"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("specimen receive succeeds");
    assert_eq!(receive_specimen.status(), StatusCode::OK);
    let receive_specimen_body = json_body(receive_specimen).await;
    assert_eq!(receive_specimen_body["data"]["id"], specimen_id);
    assert_eq!(receive_specimen_body["data"]["status"], "received");

    let start_processing_order = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/orders/{order_id}/start-processing"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("order processing start succeeds");
    assert_eq!(start_processing_order.status(), StatusCode::OK);
    let start_processing_order_body = json_body(start_processing_order).await;
    assert_eq!(start_processing_order_body["data"]["id"], order_id);
    assert_eq!(
        start_processing_order_body["data"]["status"],
        "result_entered"
    );
    assert_eq!(
        start_processing_order_body["data"]["specimens"][0]["id"],
        specimen_id
    );
    assert_eq!(
        start_processing_order_body["data"]["specimens"][0]["order_id"],
        order_id
    );

    let specimen_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/specimens/{specimen_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("specimen detail succeeds");
    assert_eq!(specimen_detail.status(), StatusCode::OK);
    let specimen_detail_body = json_body(specimen_detail).await;
    assert_eq!(specimen_detail_body["data"]["id"], specimen_id);
    assert_eq!(specimen_detail_body["data"]["order_id"], order_id);

    let specimens = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/specimens?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("specimen list succeeds");
    assert_eq!(specimens.status(), StatusCode::OK);

    let result_entered_orders = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/orders?status=result_entered&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("result-entered order list succeeds");
    assert_eq!(result_entered_orders.status(), StatusCode::OK);
    let result_entered_orders_body = json_body(result_entered_orders).await;
    let result_entered_order = result_entered_orders_body["data"]
        .as_array()
        .expect("orders are an array")
        .iter()
        .find(|order| order["id"] == order_id)
        .expect("result-entered order appears in worklist");
    assert_eq!(result_entered_order["specimens"][0]["id"], specimen_id);
    assert_eq!(result_entered_order["specimens"][0]["order_id"], order_id);

    let result_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "specimen_id": specimen_id,
                        "test_id": panel_order_test_id,
                        "value": "negative",
                        "unit": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("result create succeeds");
    assert_eq!(result_response.status(), StatusCode::OK);
    let result_body = json_body(result_response).await;
    let result_id = result_body["data"]["id"]
        .as_str()
        .expect("result id exists");
    assert_eq!(result_body["data"]["status"], "entered");

    let result_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/results/{result_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("result detail succeeds");
    assert_eq!(result_detail.status(), StatusCode::OK);
    let result_detail_body = json_body(result_detail).await;
    assert_eq!(result_detail_body["data"]["id"], result_id);
    assert_eq!(result_detail_body["data"]["specimen_id"], specimen_id);

    let results = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/results?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("result list succeeds");
    assert_eq!(results.status(), StatusCode::OK);

    let unverified_results = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/results?is_verified=false&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("unverified result list succeeds");
    assert_eq!(unverified_results.status(), StatusCode::OK);
    let unverified_results_body = json_body(unverified_results).await;
    assert!(unverified_results_body["data"]
        .as_array()
        .expect("results are an array")
        .iter()
        .all(|result| result["verified_at"].is_null()));

    let bulk_verify = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results/bulk-verify")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": order_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("bulk result verification succeeds");
    assert_eq!(bulk_verify.status(), StatusCode::OK);
    let bulk_verify_body = json_body(bulk_verify).await;
    assert_eq!(bulk_verify_body["data"]["verified_count"], 1);

    let verify = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/laboratory/results/{result_id}/verify"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("result verification succeeds");
    assert_eq!(verify.status(), StatusCode::OK);
    let verify_body = json_body(verify).await;
    assert_eq!(verify_body["data"]["status"], "verified");
    assert!(verify_body["data"]["verified_at"].is_string());

    let bulk_order_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/orders")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "test_ids": [test_id],
                        "panel_ids": [],
                        "priority": "routine"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("bulk result lab order create succeeds");
    assert_eq!(bulk_order_response.status(), StatusCode::OK);
    let bulk_order_body = json_body(bulk_order_response).await;
    let bulk_order_id = bulk_order_body["data"]["id"]
        .as_str()
        .expect("bulk order id exists");

    let bulk_specimen_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/specimens")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": bulk_order_id,
                        "specimen_type": "blood"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("bulk result specimen create succeeds");
    assert_eq!(bulk_specimen_response.status(), StatusCode::OK);
    let bulk_specimen_body = json_body(bulk_specimen_response).await;
    let bulk_specimen_id = bulk_specimen_body["data"]["id"]
        .as_str()
        .expect("bulk specimen id exists");

    let bulk_result_create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results/bulk")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": bulk_order_id,
                        "specimen_id": bulk_specimen_id,
                        "results": [{
                            "order_test_id": test_id,
                            "value": "positive",
                            "unit": null
                        }]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("bulk result create succeeds");
    assert_eq!(bulk_result_create.status(), StatusCode::OK);
    let bulk_result_create_body = json_body(bulk_result_create).await;
    assert_eq!(bulk_result_create_body["data"]["created_count"], 1);
    assert_eq!(
        bulk_result_create_body["data"]["results"][0]["status"],
        "entered"
    );

    let cancel_order_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/orders")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "test_ids": [test_id],
                        "panel_ids": [],
                        "priority": "routine"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable lab order create succeeds");
    assert_eq!(cancel_order_response.status(), StatusCode::OK);
    let cancel_order_body = json_body(cancel_order_response).await;
    let cancel_order_id = cancel_order_body["data"]["id"]
        .as_str()
        .expect("cancel order id exists");

    let cancel_order = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/orders/{cancel_order_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "cancellation_reason": "Duplicate order"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("order cancel succeeds");
    assert_eq!(cancel_order.status(), StatusCode::OK);
    let cancel_order_body = json_body(cancel_order).await;
    assert_eq!(cancel_order_body["data"]["id"], cancel_order_id);
    assert_eq!(cancel_order_body["data"]["status"], "cancelled");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/orders?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("laboratory denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let denied_order_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/orders/{order_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("laboratory order detail denial succeeds");
    assert_eq!(denied_order_detail.status(), StatusCode::FORBIDDEN);

    let denied_order_action = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/orders/{order_id}/start-processing"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("laboratory order action denial succeeds");
    assert_eq!(denied_order_action.status(), StatusCode::FORBIDDEN);

    let denied_specimen_action = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/specimens/{specimen_id}/receive"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("laboratory specimen action denial succeeds");
    assert_eq!(denied_specimen_action.status(), StatusCode::FORBIDDEN);

    let denied_bulk_verify = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results/bulk-verify")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": order_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("laboratory bulk verification denial succeeds");
    assert_eq!(denied_bulk_verify.status(), StatusCode::FORBIDDEN);

    let denied_bulk_create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results/bulk")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": bulk_order_id,
                        "specimen_id": bulk_specimen_id,
                        "results": [{
                            "order_test_id": test_id,
                            "value": "positive"
                        }]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("laboratory bulk result create denial succeeds");
    assert_eq!(denied_bulk_create.status(), StatusCode::FORBIDDEN);
}
