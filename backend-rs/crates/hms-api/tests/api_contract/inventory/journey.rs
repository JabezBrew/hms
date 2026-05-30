use super::*;

#[tokio::test]
async fn pharmacy_dispense_hot_page_reuses_scoped_cache() {
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
        "pharmacy-dispense-cache-test".to_owned(),
        claims.session_id,
        user.clone(),
        user.features.clone(),
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );
    let query = hms_domain::inventory::InventoryListQuery {
        cursor: None,
        limit: Some(10),
    };

    let (first, first_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .inventory_services()
            .pharmacy()
            .list_dispenses(&ctx, query.clone())
            .await
    })
    .await;
    first.expect("first pharmacy dispense list succeeds");
    assert!(
        first_queries > 0,
        "first pharmacy dispense hot page should hydrate from the database"
    );

    let (second, second_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .inventory_services()
            .pharmacy()
            .list_dispenses(&ctx, query)
            .await
    })
    .await;
    second.expect("cached pharmacy dispense list succeeds");
    assert_eq!(
        second_queries, 0,
        "same scoped pharmacy dispense hot page should stay off the database while warm"
    );
}

#[tokio::test]
async fn inventory_controlled_substances_and_pharmacy_dispensing_follow_access_rules() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");
    let stale_reauth_header = format!("Bearer {}", token_with_stale_reauth(&access_token));
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);

    let items_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/items")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory item list succeeds");
    assert_eq!(items_response.status(), StatusCode::OK);
    let items_body = json_body(items_response).await;
    let items = items_body["data"].as_array().expect("items array exists");
    let paracetamol_id = items
        .iter()
        .find(|item| item["controlled"] == false)
        .and_then(|item| item["id"].as_str())
        .expect("normal item exists");
    let morphine_id = items
        .iter()
        .find(|item| item["controlled"] == true)
        .and_then(|item| item["id"].as_str())
        .expect("controlled item exists");

    let invalid_item_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/items/not-a-uuid")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("invalid inventory item detail route succeeds");
    assert_eq!(
        invalid_item_detail_response.status(),
        StatusCode::BAD_REQUEST
    );

    let item_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/items/{paracetamol_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory item detail succeeds");
    let item_detail_status = item_detail_response.status();
    let item_detail_body = json_body(item_detail_response).await;
    assert_eq!(item_detail_status, StatusCode::OK, "{item_detail_body}");
    assert_eq!(item_detail_body["data"]["id"], paracetamol_id);
    assert_eq!(item_detail_body["data"]["controlled"], false);

    let locations_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/storage-locations")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location list succeeds");
    assert_eq!(locations_response.status(), StatusCode::OK);
    let locations_body = json_body(locations_response).await;
    let locations = locations_body["data"]
        .as_array()
        .expect("locations array exists");
    let main_location_id = locations
        .iter()
        .find(|location| location["code"] == "MAIN")
        .and_then(|location| location["id"].as_str())
        .expect("main location exists");
    let pharmacy_location_id = locations
        .iter()
        .find(|location| location["code"] == "PHARM")
        .and_then(|location| location["id"].as_str())
        .expect("pharmacy location exists");

    let limited_locations_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/storage-locations?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("limited location list succeeds");
    let limited_locations_status = limited_locations_response.status();
    let limited_locations_body = json_body(limited_locations_response).await;
    assert_eq!(
        limited_locations_status,
        StatusCode::OK,
        "{limited_locations_body}"
    );
    assert_eq!(
        limited_locations_body["data"]
            .as_array()
            .expect("limited locations array exists")
            .len(),
        1
    );
    assert_eq!(limited_locations_body["page"]["limit"], 1);
    assert!(limited_locations_body["page"]["has_next"]
        .as_bool()
        .unwrap());

    let suppliers_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/suppliers?search=medical&limit=1&is_active=true")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("supplier list succeeds");
    let suppliers_status = suppliers_response.status();
    let suppliers_body = json_body(suppliers_response).await;
    assert_eq!(suppliers_status, StatusCode::OK, "{suppliers_body}");
    let suppliers = suppliers_body["data"]
        .as_array()
        .expect("suppliers array exists");
    assert_eq!(suppliers.len(), 1);
    assert_eq!(suppliers_body["page"]["limit"], 1);
    assert!(suppliers_body["page"]["has_next"].as_bool().unwrap());
    assert!(suppliers[0]["name"]
        .as_str()
        .expect("supplier name exists")
        .to_lowercase()
        .contains("medical"));

    let location_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/storage-locations/{pharmacy_location_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location detail succeeds");
    assert_eq!(location_detail_response.status(), StatusCode::OK);
    let location_detail_body = json_body(location_detail_response).await;
    assert_eq!(location_detail_body["data"]["id"], pharmacy_location_id);
    assert_eq!(location_detail_body["data"]["code"], "PHARM");
    assert_eq!(location_detail_body["data"]["name"], "Pharmacy Store");

    let batch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/stock-batches")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": paracetamol_id,
                        "location_id": pharmacy_location_id,
                        "batch_number": "B-001",
                        "expires_on": "2027-01-31",
                        "quantity_received": 100
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock batch create succeeds");
    assert_eq!(batch_response.status(), StatusCode::OK);
    let batch_body = json_body(batch_response).await;
    assert_eq!(batch_body["data"]["quantity_on_hand"], 100);

    let today = Utc::now().date_naive();
    for (batch_number, expires_on) in [
        ("EXP-API-001", today - Duration::days(1)),
        ("SOON-API-001", today + Duration::days(7)),
        ("LATER-API-001", today + Duration::days(60)),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/inventory/stock-batches")
                    .header(AUTHORIZATION, auth_header.clone())
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "item_id": paracetamol_id,
                            "location_id": pharmacy_location_id,
                            "batch_number": batch_number,
                            "expires_on": expires_on,
                            "quantity_received": 5
                        })
                        .to_string(),
                    ))
                    .expect("request builds"),
            )
            .await
            .expect("stock batch create succeeds");
        assert_eq!(response.status(), StatusCode::OK);
    }

    let expired_batches = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/stock-batches?expired=true&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("expired stock batches list succeeds");
    assert_eq!(expired_batches.status(), StatusCode::OK);
    let expired_batches_body = json_body(expired_batches).await;
    let expired_rows = expired_batches_body["data"]
        .as_array()
        .expect("expired batches are an array");
    assert!(expired_rows
        .iter()
        .any(|row| row["batch_number"] == "EXP-API-001"));
    assert!(
        !expired_rows
            .iter()
            .any(|row| row["batch_number"] == "SOON-API-001"
                || row["batch_number"] == "LATER-API-001")
    );

    let expiring_batches = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/stock-batches?expiring_within_days=30&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("expiring stock batches list succeeds");
    assert_eq!(expiring_batches.status(), StatusCode::OK);
    let expiring_batches_body = json_body(expiring_batches).await;
    assert!(expiring_batches_body["data"]
        .as_array()
        .expect("expiring batches are an array")
        .iter()
        .any(|row| row["batch_number"] == "SOON-API-001"));
    assert!(!expiring_batches_body["data"]
        .as_array()
        .expect("expiring batches are an array")
        .iter()
        .any(|row| row["batch_number"] == "EXP-API-001" || row["batch_number"] == "LATER-API-001"));

    let item_batches = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items/{paracetamol_id}/stock-batches?limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("item stock batches list succeeds");
    assert_eq!(item_batches.status(), StatusCode::OK);
    let item_batches_body = json_body(item_batches).await;
    assert!(item_batches_body["data"]
        .as_array()
        .expect("item batches are an array")
        .iter()
        .any(|row| row["item_id"] == paracetamol_id && row["batch_number"] == "B-001"));

    let movements = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/stock-movements?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock movement list succeeds");
    assert_eq!(movements.status(), StatusCode::OK);
    let movements_body = json_body(movements).await;
    assert_eq!(movements_body["data"][0]["movement_type"], "receipt");

    let item_movements = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items/{paracetamol_id}/stock-movements?limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("item stock movements list succeeds");
    assert_eq!(item_movements.status(), StatusCode::OK);
    let item_movements_body = json_body(item_movements).await;
    assert_eq!(item_movements_body["data"][0]["item_id"], paracetamol_id);
    assert_eq!(item_movements_body["data"][0]["movement_type"], "receipt");

    let item_stock_by_location = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items/{paracetamol_id}/stock-by-location"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("item stock by location succeeds");
    assert_eq!(item_stock_by_location.status(), StatusCode::OK);
    let item_stock_by_location_body = json_body(item_stock_by_location).await;
    assert!(item_stock_by_location_body["data"]
        .as_array()
        .expect("stock by location is an array")
        .iter()
        .any(|row| row["item_id"] == paracetamol_id
            && row["location_id"] == pharmacy_location_id
            && row["quantity_on_hand"] == 115));

    let location_filtered_items = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items?location={pharmacy_location_id}&limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location-filtered item list succeeds");
    assert_eq!(location_filtered_items.status(), StatusCode::OK);
    let location_filtered_items_body = json_body(location_filtered_items).await;
    assert_eq!(location_filtered_items_body["page"]["limit"], 10);
    let location_filtered_rows = location_filtered_items_body["data"]
        .as_array()
        .expect("location-filtered inventory items are an array");
    assert!(location_filtered_rows.iter().any(|row| {
        row["id"] == paracetamol_id && row["total_stock"] == 115 && row["sku"] == "PARA500"
    }));

    let location_stock = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/storage-locations/{pharmacy_location_id}/stock?limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location stock succeeds");
    assert_eq!(location_stock.status(), StatusCode::OK);
    let location_stock_body = json_body(location_stock).await;
    assert_eq!(location_stock_body["page"]["limit"], 10);
    assert!(location_stock_body["data"]
        .as_array()
        .expect("location stock is an array")
        .iter()
        .any(|row| row["item_id"] == paracetamol_id
            && row["location_id"] == pharmacy_location_id
            && row["quantity_on_hand"] == 115
            && row["batch_count"] == 4));

    let transfer_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/transfers")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": paracetamol_id,
                        "from_location_id": main_location_id,
                        "to_location_id": pharmacy_location_id,
                        "quantity": 5
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock transfer create succeeds");
    assert_eq!(transfer_response.status(), StatusCode::OK);
    let transfer_body = json_body(transfer_response).await;
    let transfer_id = transfer_body["data"]["id"]
        .as_str()
        .expect("transfer id exists");
    let transfer_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/transfers/{transfer_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock transfer detail succeeds");
    assert_eq!(transfer_detail_response.status(), StatusCode::OK);
    let transfer_detail_body = json_body(transfer_detail_response).await;
    assert_eq!(transfer_detail_body["data"]["id"], transfer_id);

    let requisition_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/requisitions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "requesting_location_id": pharmacy_location_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock requisition create succeeds");
    assert_eq!(requisition_response.status(), StatusCode::OK);
    let requisition_body = json_body(requisition_response).await;
    let requisition_id = requisition_body["data"]["id"]
        .as_str()
        .expect("requisition id exists");
    let requisition_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/requisitions/{requisition_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition detail succeeds");
    assert_eq!(requisition_detail_response.status(), StatusCode::OK);
    let requisition_detail_body = json_body(requisition_detail_response).await;
    assert_eq!(requisition_detail_body["data"]["id"], requisition_id);
    assert_eq!(requisition_detail_body["data"]["status"], "requested");

    let requisition_submit_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{requisition_id}/submit"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition submit succeeds");
    assert_eq!(requisition_submit_response.status(), StatusCode::OK);
    let requisition_submit_body = json_body(requisition_submit_response).await;
    assert_eq!(requisition_submit_body["data"]["id"], requisition_id);
    assert_eq!(requisition_submit_body["data"]["status"], "pending");

    let requisition_approve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{requisition_id}/approve"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition approve succeeds");
    assert_eq!(requisition_approve_response.status(), StatusCode::OK);
    let requisition_approve_body = json_body(requisition_approve_response).await;
    assert_eq!(requisition_approve_body["data"]["id"], requisition_id);
    assert_eq!(requisition_approve_body["data"]["status"], "approved");

    let requisition_fulfill_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{requisition_id}/fulfill"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition fulfill succeeds");
    assert_eq!(requisition_fulfill_response.status(), StatusCode::OK);
    let requisition_fulfill_body = json_body(requisition_fulfill_response).await;
    assert_eq!(requisition_fulfill_body["data"]["id"], requisition_id);
    assert_eq!(requisition_fulfill_body["data"]["status"], "fulfilled");

    let reject_requisition_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/requisitions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "requesting_location_id": pharmacy_location_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock requisition create for rejection succeeds");
    assert_eq!(reject_requisition_response.status(), StatusCode::OK);
    let reject_requisition_body = json_body(reject_requisition_response).await;
    let reject_requisition_id = reject_requisition_body["data"]["id"]
        .as_str()
        .expect("reject requisition id exists");
    let reject_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{reject_requisition_id}/reject"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "reason": "Duplicate ward stock request" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock requisition reject succeeds");
    assert_eq!(reject_response.status(), StatusCode::OK);
    let reject_body = json_body(reject_response).await;
    assert_eq!(reject_body["data"]["id"], reject_requisition_id);
    assert_eq!(reject_body["data"]["status"], "rejected");
    assert_eq!(
        reject_body["data"]["rejection_reason"],
        "Duplicate ward stock request"
    );
    assert!(reject_body["data"]["rejected_at"].is_string());

    let cancel_requisition_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/requisitions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "requesting_location_id": pharmacy_location_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock requisition create for cancellation succeeds");
    assert_eq!(cancel_requisition_response.status(), StatusCode::OK);
    let cancel_requisition_body = json_body(cancel_requisition_response).await;
    let cancel_requisition_id = cancel_requisition_body["data"]["id"]
        .as_str()
        .expect("cancel requisition id exists");
    let cancel_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{cancel_requisition_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition cancel succeeds");
    assert_eq!(cancel_response.status(), StatusCode::OK);
    let cancel_body = json_body(cancel_response).await;
    assert_eq!(cancel_body["data"]["id"], cancel_requisition_id);
    assert_eq!(cancel_body["data"]["status"], "cancelled");
    assert!(cancel_body["data"]["cancelled_at"].is_string());

    let po_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/purchase-orders")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "supplier_name": "HMS Supplier" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("purchase order create succeeds");
    assert_eq!(po_response.status(), StatusCode::OK);
    let po_body = json_body(po_response).await;
    let purchase_order_id = po_body["data"]["id"]
        .as_str()
        .expect("purchase order id exists");
    let po_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/purchase-orders/{purchase_order_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("purchase order detail succeeds");
    assert_eq!(po_detail_response.status(), StatusCode::OK);
    let po_detail_body = json_body(po_detail_response).await;
    assert_eq!(po_detail_body["data"]["id"], purchase_order_id);
    assert_eq!(po_detail_body["data"]["status"], "draft");

    let po_approve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/purchase-orders/{purchase_order_id}/approve"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("purchase order approve succeeds");
    assert_eq!(po_approve_response.status(), StatusCode::OK);
    let po_approve_body = json_body(po_approve_response).await;
    assert_eq!(po_approve_body["data"]["id"], purchase_order_id);
    assert_eq!(po_approve_body["data"]["status"], "approved");

    let po_send_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/purchase-orders/{purchase_order_id}/send"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("purchase order send succeeds");
    assert_eq!(po_send_response.status(), StatusCode::OK);
    let po_send_body = json_body(po_send_response).await;
    assert_eq!(po_send_body["data"]["id"], purchase_order_id);
    assert_eq!(po_send_body["data"]["status"], "sent");

    let grn_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/goods-received-notes")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "purchase_order_id": purchase_order_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("GRN create succeeds");
    assert_eq!(grn_response.status(), StatusCode::OK);
    let grn_body = json_body(grn_response).await;
    let grn_id = grn_body["data"]["id"].as_str().expect("GRN id exists");
    assert_eq!(grn_body["data"]["status"], "pending_inspection");
    let grn_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/goods-received-notes/{grn_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("GRN detail succeeds");
    assert_eq!(grn_detail_response.status(), StatusCode::OK);
    let grn_detail_body = json_body(grn_detail_response).await;
    assert_eq!(grn_detail_body["data"]["id"], grn_id);
    assert_eq!(grn_detail_body["data"]["status"], "pending_inspection");

    let inventory_dashboard_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/dashboard-summary?expiring_within_days=30")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory dashboard summary succeeds");
    assert_eq!(inventory_dashboard_response.status(), StatusCode::OK);
    let inventory_dashboard = json_body(inventory_dashboard_response).await;
    assert!(
        inventory_dashboard["data"]["total_items"]
            .as_i64()
            .expect("inventory item count exists")
            >= items.len() as i64
    );
    assert!(
        inventory_dashboard["data"]["expiring_soon_count"]
            .as_i64()
            .expect("expiring count exists")
            >= 1
    );
    assert!(
        inventory_dashboard["data"]["pending_grns"]
            .as_i64()
            .expect("pending GRN count exists")
            >= 1
    );

    let grn_inspect_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/goods-received-notes/{grn_id}/inspect"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("GRN inspect succeeds");
    assert_eq!(grn_inspect_response.status(), StatusCode::OK);
    let grn_inspect_body = json_body(grn_inspect_response).await;
    assert_eq!(grn_inspect_body["data"]["id"], grn_id);
    assert_eq!(grn_inspect_body["data"]["status"], "inspecting");

    let grn_accept_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/goods-received-notes/{grn_id}/accept"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("GRN accept succeeds");
    assert_eq!(grn_accept_response.status(), StatusCode::OK);
    let grn_accept_body = json_body(grn_accept_response).await;
    assert_eq!(grn_accept_body["data"]["id"], grn_id);
    assert_eq!(grn_accept_body["data"]["status"], "accepted");

    let stale_controlled_receipt = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/controlled-substances/register")
                .header(AUTHORIZATION, stale_reauth_header)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": morphine_id,
                        "location_id": pharmacy_location_id,
                        "movement_type": "receipt",
                        "quantity_delta": 10,
                        "witness_user_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stale controlled receipt denial succeeds");
    assert_eq!(stale_controlled_receipt.status(), StatusCode::FORBIDDEN);
    let stale_controlled_receipt_body = json_body(stale_controlled_receipt).await;
    assert_eq!(
        stale_controlled_receipt_body["error"]["code"],
        "reauth_required"
    );

    let controlled_receipt = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/controlled-substances/register")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": morphine_id,
                        "location_id": pharmacy_location_id,
                        "movement_type": "receipt",
                        "quantity_delta": 10,
                        "witness_user_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled receipt succeeds");
    assert_eq!(controlled_receipt.status(), StatusCode::OK);

    let missing_witness = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/controlled-substances/register")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": morphine_id,
                        "location_id": pharmacy_location_id,
                        "movement_type": "dispense",
                        "quantity_delta": -1,
                        "witness_user_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled witness validation succeeds");
    assert_eq!(missing_witness.status(), StatusCode::BAD_REQUEST);

    let controlled_dispense = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/controlled-substances/register")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": morphine_id,
                        "location_id": pharmacy_location_id,
                        "movement_type": "dispense",
                        "quantity_delta": -1,
                        "witness_user_id": owner_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled dispense succeeds");
    assert_eq!(controlled_dispense.status(), StatusCode::OK);
    let controlled_body = json_body(controlled_dispense).await;
    let controlled_id = controlled_body["data"]["id"]
        .as_str()
        .expect("controlled register id exists");
    assert_eq!(controlled_body["data"]["balance_after"], 9);
    let controlled_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled register detail succeeds");
    assert_eq!(controlled_detail_response.status(), StatusCode::OK);
    let controlled_detail_body = json_body(controlled_detail_response).await;
    assert_eq!(controlled_detail_body["data"]["id"], controlled_id);

    let controlled_entries_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/entries?limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled register entries succeeds");
    assert_eq!(controlled_entries_response.status(), StatusCode::OK);
    let controlled_entries_body = json_body(controlled_entries_response).await;
    let controlled_entries = controlled_entries_body["data"]
        .as_array()
        .expect("controlled entries array exists");
    assert_eq!(controlled_entries.len(), 2);
    assert_eq!(controlled_entries[0]["entry_number"], 1);
    assert_eq!(controlled_entries[0]["entry_type"], "receipt");
    assert_eq!(controlled_entries[0]["balance_before"], 0);
    assert_eq!(controlled_entries[0]["balance_after"], 10);
    assert_eq!(controlled_entries[1]["entry_number"], 2);
    assert_eq!(controlled_entries[1]["entry_type"], "dispense");
    assert_eq!(controlled_entries[1]["quantity"], -1);
    assert_eq!(controlled_entries[1]["balance_before"], 10);
    assert_eq!(controlled_entries[1]["balance_after"], 9);

    let controlled_balance_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/balance-validation"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled register balance validation succeeds");
    assert_eq!(controlled_balance_response.status(), StatusCode::OK);
    let controlled_balance_body = json_body(controlled_balance_response).await;
    assert_eq!(
        controlled_balance_body["data"]["register_id"],
        controlled_id
    );
    assert_eq!(controlled_balance_body["data"]["current_balance"], 9);
    assert_eq!(controlled_balance_body["data"]["computed_balance"], 9);
    assert_eq!(controlled_balance_body["data"]["valid"], true);

    let controlled_count_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/counts"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "actual_count": 8,
                        "witness_user_id": owner_id,
                        "category": "missing",
                        "reason": "non-PHI controlled count test",
                        "notes": "non-PHI controlled count test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled count succeeds");
    assert_eq!(controlled_count_response.status(), StatusCode::OK);
    let controlled_count_body = json_body(controlled_count_response).await;
    let controlled_count_id = controlled_count_body["data"]["id"]
        .as_str()
        .expect("controlled count entry id exists");
    assert_eq!(controlled_count_body["data"]["movement_type"], "count");
    assert_eq!(controlled_count_body["data"]["quantity_delta"], -1);
    assert_eq!(controlled_count_body["data"]["balance_after"], 8);
    assert_eq!(controlled_count_body["data"]["current_balance"], 8);
    assert_eq!(controlled_count_body["data"]["has_discrepancy"], true);
    assert_eq!(controlled_count_body["data"]["discrepancy_count"], 1);

    let controlled_register_list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/pharmacy/controlled-substances/register?limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled register summary list succeeds");
    assert_eq!(controlled_register_list_response.status(), StatusCode::OK);
    let controlled_register_list_body = json_body(controlled_register_list_response).await;
    let controlled_summary = controlled_register_list_body["data"]
        .as_array()
        .expect("controlled register summary array exists")
        .iter()
        .find(|row| row["id"] == controlled_count_id)
        .expect("latest controlled register summary exists");
    assert_eq!(controlled_summary["location_name"], "Pharmacy Store");
    assert_eq!(controlled_summary["current_balance"], 8);
    assert_eq!(controlled_summary["entry_count"], 3);
    assert_eq!(controlled_summary["total_received"], 10);
    assert_eq!(controlled_summary["total_dispensed"], 1);
    assert_eq!(controlled_summary["has_discrepancy"], true);
    assert_eq!(controlled_summary["discrepancy_count"], 1);

    let controlled_stock_after_count = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items/{morphine_id}/stock-by-location"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled stock by location succeeds");
    assert_eq!(controlled_stock_after_count.status(), StatusCode::OK);
    let controlled_stock_after_count_body = json_body(controlled_stock_after_count).await;
    assert!(controlled_stock_after_count_body["data"]
        .as_array()
        .expect("controlled stock by location is an array")
        .iter()
        .any(|row| row["location_id"] == pharmacy_location_id && row["quantity_on_hand"] == 8));

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

    let dispense_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/dispenses")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "item_id": paracetamol_id,
                        "location_id": pharmacy_location_id,
                        "quantity": 2
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("pharmacy dispense succeeds");
    assert_eq!(dispense_response.status(), StatusCode::OK);
    let dispense_body = json_body(dispense_response).await;
    assert_eq!(dispense_body["data"]["status"], "dispensed");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let detail_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/items/{paracetamol_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory item detail denial succeeds");
    assert_eq!(detail_denied.status(), StatusCode::FORBIDDEN);

    for denied_path in [
        format!("/api/v2/inventory/items/{paracetamol_id}/stock-batches?limit=1"),
        format!("/api/v2/inventory/items/{paracetamol_id}/stock-movements?limit=1"),
        format!("/api/v2/inventory/items/{paracetamol_id}/stock-by-location"),
        format!("/api/v2/inventory/items?location={pharmacy_location_id}&limit=1"),
        format!("/api/v2/inventory/storage-locations/{pharmacy_location_id}"),
        format!("/api/v2/inventory/storage-locations/{pharmacy_location_id}/stock?limit=1"),
        format!("/api/v2/inventory/transfers/{transfer_id}"),
        format!("/api/v2/inventory/requisitions/{requisition_id}"),
        format!("/api/v2/inventory/purchase-orders/{purchase_order_id}"),
        format!("/api/v2/inventory/goods-received-notes/{grn_id}"),
        format!("/api/v2/pharmacy/controlled-substances/register/{controlled_id}"),
        format!("/api/v2/pharmacy/controlled-substances/register/{controlled_id}/entries?limit=1"),
        format!(
            "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/balance-validation"
        ),
    ] {
        let denied_detail = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(denied_path)
                    .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("inventory detail denial succeeds");
        assert_eq!(denied_detail.status(), StatusCode::FORBIDDEN);
    }

    let count_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/counts"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "actual_count": 8,
                        "witness_user_id": owner_id,
                        "notes": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled count denial succeeds");
    assert_eq!(count_denied.status(), StatusCode::FORBIDDEN);

    let reject_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{requisition_id}/reject"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "reason": "No access" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("requisition reject denial succeeds");
    assert_eq!(reject_denied.status(), StatusCode::FORBIDDEN);

    for denied_path in [
        format!("/api/v2/inventory/requisitions/{requisition_id}/approve"),
        format!("/api/v2/inventory/requisitions/{requisition_id}/fulfill"),
        format!("/api/v2/inventory/requisitions/{requisition_id}/cancel"),
        format!("/api/v2/inventory/purchase-orders/{purchase_order_id}/approve"),
        format!("/api/v2/inventory/purchase-orders/{purchase_order_id}/send"),
        format!("/api/v2/inventory/goods-received-notes/{grn_id}/inspect"),
        format!("/api/v2/inventory/goods-received-notes/{grn_id}/accept"),
    ] {
        let denied_action = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(denied_path)
                    .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("inventory action denial succeeds");
        assert_eq!(denied_action.status(), StatusCode::FORBIDDEN);
    }

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/stock-batches?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
