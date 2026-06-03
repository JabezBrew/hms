use super::*;

#[tokio::test]
async fn billing_and_nhis_workflows_are_patient_scoped_and_cash_controlled() {
    let app = app().await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;

    let limited_catalog_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/service-catalog?limit=1&is_active=true")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("limited service catalog request succeeds");
    let limited_catalog_status = limited_catalog_response.status();
    let limited_catalog_body = json_body(limited_catalog_response).await;
    assert_eq!(
        limited_catalog_status,
        StatusCode::OK,
        "{limited_catalog_body}"
    );
    let limited_services = limited_catalog_body["data"]
        .as_array()
        .expect("limited catalog array exists");
    assert_eq!(limited_services.len(), 1);
    assert_eq!(limited_catalog_body["page"]["limit"], 1);
    assert!(limited_catalog_body["page"]["has_next"].as_bool().unwrap());
    assert!(limited_services[0]["active"].as_bool().unwrap());
    assert!(limited_services[0]["active_price_id"].as_str().is_some());
    assert!(
        limited_services[0]["active_price_amount_minor"]
            .as_i64()
            .unwrap_or_default()
            > 0
    );

    let rules_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/rules?limit=1&rule_type=cash_required&is_active=true")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("billing rules request succeeds");
    assert_eq!(rules_response.status(), StatusCode::OK);
    let rules = json_body(rules_response).await;
    assert_eq!(rules["page"]["limit"], 1);
    assert_eq!(rules["data"][0]["rule_type"], "cash_required");
    let billing_rule_id = rules["data"][0]["id"]
        .as_str()
        .expect("seed billing rule exists")
        .to_owned();

    let rule_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/rules/{billing_rule_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("billing rule detail request succeeds");
    let rule_detail_status = rule_detail_response.status();
    let rule_detail_body = json_body(rule_detail_response).await;
    assert_eq!(rule_detail_status, StatusCode::OK, "{rule_detail_body}");
    assert_eq!(rule_detail_body["data"]["id"], billing_rule_id);

    let prices_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/service-prices")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("service prices request succeeds");
    assert_eq!(prices_response.status(), StatusCode::OK);
    let prices = json_body(prices_response).await;
    let service_price_id = prices["data"][0]["id"]
        .as_str()
        .expect("seed service price exists")
        .to_owned();

    let drawers_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/cash-drawers")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("cash drawers request succeeds");
    assert_eq!(drawers_response.status(), StatusCode::OK);
    let drawers = json_body(drawers_response).await;
    let drawer_id = drawers["data"][0]["id"]
        .as_str()
        .expect("seed cash drawer exists")
        .to_owned();

    let stale_sessions_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/cash-sessions?limit=100")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("cash session list succeeds");
    assert_eq!(stale_sessions_response.status(), StatusCode::OK);
    let stale_sessions = json_body(stale_sessions_response).await;
    for session in stale_sessions["data"]
        .as_array()
        .expect("sessions are an array")
    {
        if session["drawer_id"].as_str() == Some(drawer_id.as_str())
            && session["status"].as_str() == Some("open")
        {
            let stale_id = session["id"].as_str().expect("stale session id exists");
            let expected = session["expected_cash_minor"]
                .as_i64()
                .expect("expected cash exists");
            let close_stale_response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri(format!("/api/v2/billing/cash-sessions/{stale_id}/close"))
                        .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({ "counted_cash_minor": expected }).to_string(),
                        ))
                        .expect("request builds"),
                )
                .await
                .expect("stale cash session close succeeds");
            assert_eq!(close_stale_response.status(), StatusCode::OK);
        }
    }

    let open_session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/billing/cash-sessions")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "drawer_id": drawer_id,
                        "opening_float_minor": 1_000
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cash session open succeeds");
    let open_session_status = open_session_response.status();
    let open_session = json_body(open_session_response).await;
    assert_eq!(
        open_session_status,
        StatusCode::OK,
        "cash session open response: {open_session}"
    );
    let session_id = open_session["data"]["id"]
        .as_str()
        .expect("cash session id exists")
        .to_owned();

    let open_sessions_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/cash-sessions?status=open&limit=5")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("open cash sessions list succeeds");
    assert_eq!(open_sessions_response.status(), StatusCode::OK);
    let open_sessions = json_body(open_sessions_response).await;
    assert!(open_sessions["data"]
        .as_array()
        .expect("open cash sessions are an array")
        .iter()
        .any(|row| row["id"] == session_id && row["status"] == "open"));

    let session_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/cash-sessions/{session_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("cash session detail succeeds");
    assert_eq!(session_detail_response.status(), StatusCode::OK);
    let session_detail = json_body(session_detail_response).await;
    assert_eq!(session_detail["data"]["id"], session_id);
    assert_eq!(session_detail["data"]["status"], "open");

    let patients_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patients request succeeds");
    assert_eq!(patients_response.status(), StatusCode::OK);
    let patients = json_body(patients_response).await;
    let patient_id = patients["data"][0]["id"]
        .as_str()
        .expect("seed patient exists")
        .to_owned();

    let invoice_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/billing/invoices")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service_price_id": service_price_id,
                        "quantity": 2
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("invoice create succeeds");
    assert_eq!(invoice_response.status(), StatusCode::OK);
    let invoice = json_body(invoice_response).await;
    assert_eq!(invoice["data"]["status"], "issued");
    let invoice_id = invoice["data"]["id"]
        .as_str()
        .expect("invoice id exists")
        .to_owned();
    let gross_amount = invoice["data"]["gross_amount_minor"]
        .as_i64()
        .expect("invoice amount exists");
    assert!(gross_amount > 0);

    let invoice_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/invoices/{invoice_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("invoice detail succeeds");
    assert_eq!(invoice_detail_response.status(), StatusCode::OK);
    let invoice_detail = json_body(invoice_detail_response).await;
    assert_eq!(invoice_detail["data"]["id"], invoice_id);
    assert_eq!(invoice_detail["data"]["patient_id"], patient_id);
    assert_eq!(invoice_detail["data"]["gross_amount_minor"], gross_amount);

    let payment_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/billing/payments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "invoice_id": invoice_id,
                        "amount_minor": gross_amount,
                        "method": "cash",
                        "cash_session_id": session_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("payment create succeeds");
    assert_eq!(payment_response.status(), StatusCode::OK);
    let payment = json_body(payment_response).await;
    assert_eq!(payment["data"]["method"], "cash");
    let payment_id = payment["data"]["id"]
        .as_str()
        .expect("payment id exists")
        .to_owned();
    let receipt_number = payment["data"]["receipt_number"]
        .as_str()
        .expect("receipt number exists")
        .to_owned();

    let receipts_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/receipts?limit=1")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("receipts request succeeds");
    assert_eq!(receipts_response.status(), StatusCode::OK);
    let receipts = json_body(receipts_response).await;
    assert_eq!(receipts["data"][0]["amount_minor"], gross_amount);
    let receipt_id = receipts["data"][0]["id"]
        .as_str()
        .expect("receipt id exists")
        .to_owned();
    assert_eq!(receipts["data"][0]["payment_id"], payment_id);
    assert_eq!(receipts["data"][0]["receipt_number"], receipt_number);

    let receipt_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/receipts/{receipt_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("receipt detail succeeds");
    assert_eq!(receipt_detail_response.status(), StatusCode::OK);
    let receipt_detail = json_body(receipt_detail_response).await;
    assert_eq!(receipt_detail["data"]["id"], receipt_id);
    assert_eq!(receipt_detail["data"]["payment_id"], payment_id);
    assert_eq!(receipt_detail["data"]["invoice_id"], invoice_id);

    let receipt_by_number_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/billing/receipts/by-number/{receipt_number}"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("receipt by number succeeds");
    assert_eq!(receipt_by_number_response.status(), StatusCode::OK);
    let receipt_by_number = json_body(receipt_by_number_response).await;
    assert_eq!(receipt_by_number["data"]["id"], receipt_id);
    assert_eq!(receipt_by_number["data"]["receipt_number"], receipt_number);

    let receipt_by_payment_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/payments/{payment_id}/receipt"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("receipt by payment succeeds");
    assert_eq!(receipt_by_payment_response.status(), StatusCode::OK);
    let receipt_by_payment = json_body(receipt_by_payment_response).await;
    assert_eq!(receipt_by_payment["data"]["id"], receipt_id);
    assert_eq!(receipt_by_payment["data"]["payment_id"], payment_id);

    let patient_invoices_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/billing/invoices?limit=10&patient_id={patient_id}"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient invoice list succeeds");
    assert_eq!(patient_invoices_response.status(), StatusCode::OK);
    let patient_invoices = json_body(patient_invoices_response).await;
    assert_eq!(patient_invoices["data"][0]["patient_id"], patient_id);

    let missing_patient_id = Uuid::new_v4();
    let missing_patient_invoices = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/billing/invoices?limit=10&patient_id={missing_patient_id}"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("missing patient invoice list succeeds");
    assert_eq!(missing_patient_invoices.status(), StatusCode::NOT_FOUND);

    let claim_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nhis/claims")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "invoice_id": invoice_id }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("claim create succeeds");
    assert_eq!(claim_response.status(), StatusCode::OK);
    let claim = json_body(claim_response).await;
    let claim_id = claim["data"]["id"]
        .as_str()
        .expect("claim id exists")
        .to_owned();
    assert_eq!(claim["data"]["amount_minor"], gross_amount);

    let claim_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/nhis/claims/{claim_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("claim detail succeeds");
    assert_eq!(claim_detail_response.status(), StatusCode::OK);
    let claim_detail = json_body(claim_detail_response).await;
    assert_eq!(claim_detail["data"]["id"], claim_id);
    assert_eq!(claim_detail["data"]["invoice_id"], invoice_id);
    assert_eq!(claim_detail["data"]["patient_id"], patient_id);
    assert_eq!(claim_detail["data"]["amount_minor"], gross_amount);

    let dashboard_summary_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/dashboard-summary")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("billing dashboard summary succeeds");
    assert_eq!(dashboard_summary_response.status(), StatusCode::OK);
    let dashboard_summary = json_body(dashboard_summary_response).await;
    assert!(
        dashboard_summary["data"]["revenue_today_minor"]
            .as_i64()
            .expect("revenue today exists")
            >= gross_amount
    );
    assert!(
        dashboard_summary["data"]["revenue_this_week_minor"]
            .as_i64()
            .expect("week revenue exists")
            >= gross_amount
    );
    assert!(
        dashboard_summary["data"]["pending_claims"]
            .as_i64()
            .expect("pending claims count exists")
            >= 1
    );
    assert!(
        dashboard_summary["data"]["pending_claims_amount_minor"]
            .as_i64()
            .expect("pending claims amount exists")
            >= gross_amount
    );
    assert!(
        dashboard_summary["data"]["invoices_created_today"]
            .as_i64()
            .expect("today invoice count exists")
            >= 1
    );
    assert!(
        dashboard_summary["data"]["payments_received_today"]
            .as_i64()
            .expect("today payment count exists")
            >= 1
    );
    assert!(
        dashboard_summary["data"]["unique_patients_billed"]
            .as_i64()
            .expect("unique patients count exists")
            >= 1
    );

    let batch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nhis/batches")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "claim_ids": [claim_id] }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("batch create succeeds");
    assert_eq!(batch_response.status(), StatusCode::OK);
    let batch = json_body(batch_response).await;
    let batch_id = batch["data"]["id"]
        .as_str()
        .expect("batch id exists")
        .to_owned();
    assert_eq!(batch["data"]["claim_count"], 1);

    let export_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/nhis/batches/{batch_id}/export"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("x-request-id", "nhis-export-audit-api-test")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("batch export succeeds");
    assert_eq!(export_response.status(), StatusCode::OK);
    let export_body = json_body(export_response).await;
    assert_eq!(export_body["data"]["claim_count"], 1);
    assert!(export_body["data"]["checksum"].as_str().is_some());

    let export_audit_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/audit-events?limit=10&search=nhis-export-audit-api-test")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("NHIS export audit list succeeds");
    assert_eq!(export_audit_response.status(), StatusCode::OK);
    let export_audit_body = json_body(export_audit_response).await;
    let export_audit_events = export_audit_body["data"]
        .as_array()
        .expect("export audit events are array");
    let export_event = export_audit_events
        .iter()
        .find(|event| event["event_type"] == "billing.nhis_batch.exported")
        .expect("NHIS export audit event is returned");
    assert_eq!(export_event["request_id"], "nhis-export-audit-api-test");
    assert_eq!(export_event["resource_type"], "nhis_batch");
    assert_eq!(export_event["resource_id"], batch_id);

    let remittance_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nhis/remittance-imports")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "batch_id": batch_id,
                        "reference": format!("NHIS-REM-{batch_id}"),
                        "total_paid_minor": gross_amount
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("remittance create succeeds");
    assert_eq!(remittance_response.status(), StatusCode::OK);

    let close_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/billing/cash-sessions/{session_id}/close"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "counted_cash_minor": gross_amount + 1_000 }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cash session close succeeds");
    assert_eq!(close_response.status(), StatusCode::OK);
    let close_body = json_body(close_response).await;
    assert_eq!(close_body["data"]["status"], "closed");
    assert_eq!(close_body["data"]["variance_minor"], 0);

    let limited_response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/invoices?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("billing denial succeeds");
    let limited_status = limited_response.status();
    let limited_body = json_body(limited_response).await;
    assert_eq!(limited_status, StatusCode::FORBIDDEN, "{limited_body}");
}

#[tokio::test]
async fn payment_reversal_writes_admin_visible_audit_event() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let owner = Actor::login(&app, "owner@hms.local").await;

    let prices = assert_json_status(
        api_get(app.clone(), &owner, "/api/v2/billing/service-prices").await,
        StatusCode::OK,
    )
    .await;
    let service_price_id = prices["data"][0]["id"]
        .as_str()
        .expect("seed service price exists")
        .to_owned();

    let patients = assert_json_status(
        api_get(app.clone(), &owner, "/api/v2/patients?limit=1").await,
        StatusCode::OK,
    )
    .await;
    let patient_id = patients["data"][0]["id"]
        .as_str()
        .expect("seed patient exists")
        .to_owned();

    let invoice = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/billing/invoices",
            json!({
                "patient_id": patient_id,
                "service_price_id": service_price_id,
                "quantity": 1
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let invoice_id = invoice["data"]["id"]
        .as_str()
        .expect("invoice id exists")
        .to_owned();
    let gross_amount = invoice["data"]["gross_amount_minor"]
        .as_i64()
        .expect("invoice amount exists");
    assert!(gross_amount > 0);

    let payment = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/billing/payments",
            json!({
                "invoice_id": invoice_id,
                "amount_minor": gross_amount,
                "method": "mobile_money"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let payment_id = payment["data"]["id"]
        .as_str()
        .expect("payment id exists")
        .to_owned();

    let supervisor_user_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let reverse_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/billing/payments/{payment_id}/reverse"))
                .header(AUTHORIZATION, owner.bearer())
                .header("content-type", "application/json")
                .header("x-request-id", "payment-reversal-audit-api-test")
                .body(Body::from(
                    json!({
                        "amount_minor": 1,
                        "reversal_kind": "refund",
                        "approval": {
                            "supervisor_user_id": supervisor_user_id,
                            "reason": "audit contract reversal"
                        }
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("payment reversal request succeeds");
    assert_json_status(reverse_response, StatusCode::OK).await;

    let audit_body = assert_json_status(
        api_get(
            app,
            &owner,
            "/api/v2/admin/audit-events?limit=10&search=payment-reversal-audit-api-test",
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let audit_events = audit_body["data"]
        .as_array()
        .expect("payment audit events are array");
    let event = audit_events
        .iter()
        .find(|event| event["event_type"] == "billing.payment_refund.recorded")
        .expect("payment reversal audit event is returned");
    assert_eq!(event["request_id"], "payment-reversal-audit-api-test");
    assert_eq!(event["resource_type"], "payment");
    assert_eq!(event["resource_id"], payment_id);
}
