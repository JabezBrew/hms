use super::*;

async fn request(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("x-request-id", "nhis-export-contract")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn nhis_export_http_returns_idempotent_records_without_submission_or_fabricated_jobs() {
    let app = app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    let pool = app.db_pool().await;
    let (facility_id, actor_user_id): (Uuid, Uuid) =
        sqlx::query_as("SELECT facility_id, id FROM users WHERE email = 'owner@hms.local'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let patient_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let service_price_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM service_prices WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .unwrap();
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
    .unwrap();
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
    .unwrap();
    let batch = hms_db::billing::create_nhis_batch(
        &pool,
        hms_db::billing::NewNhisBatch {
            id: Uuid::new_v4(),
            facility_id,
            batch_number: format!("BATCH-{}", Uuid::new_v4()),
            claim_ids: vec![claim.id],
            actor_user_id,
            request_id: None,
        },
    )
    .await
    .unwrap();
    let path = format!("/api/v2/nhis/batches/{}/export", batch.id);
    assert_eq!(
        request(&app, &limited, Method::POST, &path).await.status(),
        StatusCode::FORBIDDEN
    );
    let first = request(&app, &owner, Method::POST, &path).await;
    assert_eq!(first.status(), StatusCode::OK);
    let first = json_body(first).await;
    assert_eq!(first["data"]["batch_id"], batch.id.to_string());
    assert_eq!(first["data"]["export_format"], "nhis_export_record_v1");
    assert!(first["data"]["checksum"].as_str().is_some());
    assert!(first["data"].get("id").is_none());
    assert!(first["data"].get("status").is_none());
    let replay = request(&app, &owner, Method::POST, &path).await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(json_body(replay).await["data"], first["data"]);
    let status: String = sqlx::query_scalar("SELECT status FROM nhis_claims WHERE id = $1")
        .bind(claim.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "ready");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_events WHERE event_type = 'billing.nhis_batch.exported' AND resource_id = $1").bind(batch.id).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
    let records = request(&app, &owner, Method::GET, "/api/v2/nhis/exports").await;
    assert_eq!(records.status(), StatusCode::OK);
    let records = json_body(records).await;
    assert_eq!(records["data"][0]["status"], "recorded");
    assert!(records["data"][0]["expires_at"].is_null());
    sqlx::query("UPDATE nhis_batches SET status = 'remitted' WHERE id = $1")
        .bind(batch.id)
        .execute(&pool)
        .await
        .unwrap();
    let rejected = request(&app, &owner, Method::POST, &path).await;
    assert_eq!(rejected.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(rejected).await["error"]["code"],
        "nhis_export_state_locked"
    );
    assert_eq!(
        request(
            &app,
            &owner,
            Method::POST,
            &format!("/api/v2/nhis/batches/{}/export", Uuid::new_v4())
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
}
