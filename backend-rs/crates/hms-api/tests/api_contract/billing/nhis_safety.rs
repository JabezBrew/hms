use super::*;

async fn post(app: &TestApp, token: &str, path: &str, payload: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .header("x-request-id", "nhis-write-contract")
                .body(Body::from(payload.to_string()))
                .expect("request builds"),
        )
        .await
        .expect("NHIS request completes")
}

#[tokio::test]
async fn nhis_mapping_http_checks_permission_and_active_references_and_returns_persisted_versions()
{
    let app = app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    let pool = app.db_pool().await;
    let (facility_id, service_id): (Uuid, Uuid) = sqlx::query_as(
        "SELECT facility_id, id FROM service_catalog ORDER BY created_at, id LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .expect("service exists");
    let payload = json!({"service_id": service_id, "nhis_code": "SYNTHETIC-CODE", "effective_from": Utc::now().date_naive()});
    assert_eq!(
        post(
            &app,
            &limited,
            "/api/v2/nhis/service-mappings",
            payload.clone()
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    for expected_version in [1, 2] {
        let response = post(
            &app,
            &owner,
            "/api/v2/nhis/service-mappings",
            payload.clone(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["version_number"], expected_version);
        assert_eq!(body["data"]["nhis_code"], "SYNTHETIC-CODE");
    }
    let payer_failure = post(&app, &owner, "/api/v2/nhis/service-mappings", json!({
        "service_id": service_id, "payer_id": Uuid::new_v4(), "nhis_code": "UNSAVED", "effective_from": Utc::now().date_naive(),
    })).await;
    assert_eq!(payer_failure.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(payer_failure).await["error"]["code"],
        "nhis_payer_unavailable"
    );
    sqlx::query("UPDATE service_catalog SET active = FALSE WHERE facility_id = $1 AND id = $2")
        .bind(facility_id)
        .bind(service_id)
        .execute(&pool)
        .await
        .expect("service deactivates");
    let response = post(&app, &owner, "/api/v2/nhis/service-mappings", payload).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "nhis_service_unavailable"
    );
    let audits: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_events WHERE event_type = 'billing.nhis_service_mapping.created' AND request_id = 'nhis-write-contract'").fetch_one(&pool).await.expect("audits count");
    assert_eq!(audits, 2);
}

#[tokio::test]
async fn nhis_batch_http_rejects_terminal_or_assigned_claims_with_clear_conflicts() {
    let app = app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let (facility_id, actor_user_id): (Uuid, Uuid) =
        sqlx::query_as("SELECT facility_id, id FROM users WHERE email = 'owner@hms.local'")
            .fetch_one(&pool)
            .await
            .expect("owner exists");
    let patient_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("patient exists");
    let service_price_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM service_prices WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("price exists");
    let mut claim_ids = vec![];
    for _ in 0..2 {
        let invoice = hms_db::billing::create_invoice(
            &pool,
            hms_db::billing::NewInvoice {
                id: Uuid::new_v4(),
                facility_id,
                patient_id,
                encounter_id: None,
                visit_id: None,
                admission_case_id: None,
                service_price_id,
                quantity: 1,
                invoice_number: format!("INV-{}", Uuid::new_v4()),
                source_type: None,
                source_id: None,
                is_auto_generated: false,
                actor_user_id,
            },
        )
        .await
        .expect("invoice fixture creates");
        let claim = hms_db::billing::create_claim(
            &pool,
            hms_db::billing::NewClaim {
                id: Uuid::new_v4(),
                facility_id,
                invoice_id: invoice.id,
                claim_number: format!("CLM-{}", Uuid::new_v4()),
                actor_user_id,
            },
        )
        .await
        .expect("claim fixture creates");
        claim_ids.push(claim.id);
    }
    sqlx::query("UPDATE nhis_claims SET status = 'submitted' WHERE id = $1")
        .bind(claim_ids[0])
        .execute(&pool)
        .await
        .expect("submitted fixture sets");
    let payload = json!({"claim_ids": claim_ids});
    let response = post(&app, &owner, "/api/v2/nhis/batches", payload.clone()).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "nhis_batch_claims_ineligible"
    );
    let unchanged: String = sqlx::query_scalar("SELECT status FROM nhis_claims WHERE id = $1")
        .bind(claim_ids[0])
        .fetch_one(&pool)
        .await
        .expect("status reads");
    assert_eq!(unchanged, "submitted");
    sqlx::query("UPDATE nhis_claims SET status = 'draft' WHERE id = $1")
        .bind(claim_ids[0])
        .execute(&pool)
        .await
        .expect("draft fixture restores");
    let created = post(&app, &owner, "/api/v2/nhis/batches", payload.clone()).await;
    assert_eq!(created.status(), StatusCode::OK);
    assert_eq!(json_body(created).await["data"]["claim_count"], 2);
    let repeat = post(&app, &owner, "/api/v2/nhis/batches", payload).await;
    assert_eq!(repeat.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(repeat).await["error"]["code"],
        "nhis_batch_claims_already_batched"
    );
    let batches: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM nhis_batches WHERE facility_id = $1")
            .bind(facility_id)
            .fetch_one(&pool)
            .await
            .expect("batches count");
    assert_eq!(batches, 1);
}
