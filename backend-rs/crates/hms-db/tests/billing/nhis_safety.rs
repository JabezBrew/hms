use super::*;
use hms_db::billing::{NewNhisBatch, NhisWriteConflict};
use uuid::Uuid;

async fn payer(fixture: &BillingFixture, active: bool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO insurance_providers (id, facility_id, code, name, payer_type, is_active) VALUES ($1, $2, $3, 'Synthetic payer', 'nhis', $4)")
        .bind(id).bind(fixture.facility_id).bind(id.to_string()).bind(active)
        .execute(&fixture.pool).await.expect("synthetic payer creates");
    id
}

async fn mapping(
    fixture: &BillingFixture,
    payer_id: Option<Uuid>,
    code: &str,
) -> NewNhisServiceMapping {
    let service_id = sqlx::query_scalar("SELECT service_id FROM service_prices WHERE id = $1")
        .bind(fixture.service_price_id)
        .fetch_one(&fixture.pool)
        .await
        .expect("service exists");
    NewNhisServiceMapping {
        id: Uuid::new_v4(),
        facility_id: fixture.facility_id,
        payer_id,
        service_id,
        nhis_code: code.to_owned(),
        effective_from: chrono::Utc::now().date_naive(),
        effective_until: None,
        actor_user_id: fixture.owner_id,
        request_id: Some("nhis-safety-test".to_owned()),
    }
}

async fn claim(fixture: &BillingFixture) -> hms_domain::billing::ClaimListItem {
    let invoice = fixture
        .create_invoice(&format!("INV-{}", Uuid::new_v4()), 1)
        .await;
    hms_db::billing::create_claim(
        &fixture.pool,
        NewClaim {
            id: Uuid::new_v4(),
            facility_id: fixture.facility_id,
            invoice_id: invoice.id,
            claim_number: format!("CLM-{}", Uuid::new_v4()),
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("synthetic claim creates")
}

fn batch(fixture: &BillingFixture, claim_ids: Vec<Uuid>) -> NewNhisBatch {
    NewNhisBatch {
        id: Uuid::new_v4(),
        facility_id: fixture.facility_id,
        batch_number: format!("BATCH-{}", Uuid::new_v4()),
        claim_ids,
        actor_user_id: fixture.owner_id,
        request_id: Some("nhis-batch-safety-test".to_owned()),
    }
}

fn conflict<T: std::fmt::Debug>(result: anyhow::Result<T>, expected: NhisWriteConflict) {
    let error = result.expect_err("unsafe write is rejected");
    assert_eq!(error.downcast_ref::<NhisWriteConflict>(), Some(&expected));
}

async fn batch_count(fixture: &BillingFixture) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM nhis_batches WHERE facility_id = $1")
        .bind(fixture.facility_id)
        .fetch_one(&fixture.pool)
        .await
        .expect("batches count")
}

#[tokio::test]
async fn nhis_mapping_versions_serialize_across_payers_and_audit_only_safe_facts() {
    let fixture = BillingFixture::create().await;
    let first_payer = payer(&fixture, true).await;
    let second_payer = payer(&fixture, true).await;
    let first = mapping(&fixture, Some(first_payer), "FIRST-CODE").await;
    let second = mapping(&fixture, Some(second_payer), "SECOND-CODE").await;
    let (first, second) = tokio::join!(
        hms_db::billing::create_nhis_service_mapping(&fixture.pool, first),
        hms_db::billing::create_nhis_service_mapping(&fixture.pool, second),
    );
    let first = first.expect("first payer mapping saves");
    let second = second.expect("second payer mapping saves concurrently");
    let mut versions = [first.version_number, second.version_number];
    versions.sort_unstable();
    assert_eq!(versions, [1, 2]);
    let generic = hms_db::billing::create_nhis_service_mapping(
        &fixture.pool,
        mapping(&fixture, None, "GENERIC").await,
    )
    .await
    .expect("generic mapping shares the service version counter");
    assert_eq!(generic.version_number, 3);
    let metadata = sqlx::query_scalar::<_, serde_json::Value>("SELECT metadata FROM audit_events WHERE resource_id = $1 AND event_type = 'billing.nhis_service_mapping.created'")
        .bind(first.id).fetch_one(&fixture.pool).await.expect("mapping audit saves atomically");
    assert_eq!(
        metadata,
        serde_json::json!({"version_number": first.version_number, "payer_specific": true})
    );
    let request_id = sqlx::query_scalar::<_, String>(
        "SELECT request_id FROM audit_events WHERE resource_id = $1",
    )
    .bind(first.id)
    .fetch_one(&fixture.pool)
    .await
    .expect("request correlation saves");
    assert_eq!(request_id, "nhis-safety-test");
}

#[tokio::test]
async fn nhis_mapping_requires_active_same_facility_service_and_payer() {
    let fixture = BillingFixture::create().await;
    let inactive_payer = payer(&fixture, false).await;
    let foreign_facility = Uuid::new_v4();
    let foreign_payer = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities (id, code, name, deployment_profile) VALUES ($1, 'FOREIGN', 'Synthetic facility', 'hospital')")
        .bind(foreign_facility).execute(&fixture.pool).await.expect("foreign fixture facility creates");
    sqlx::query("INSERT INTO insurance_providers (id, facility_id, code, name) VALUES ($1, $2, 'FOREIGN', 'Synthetic foreign payer')")
        .bind(foreign_payer).bind(foreign_facility).execute(&fixture.pool).await.expect("foreign payer creates");
    conflict(
        hms_db::billing::create_nhis_service_mapping(
            &fixture.pool,
            mapping(&fixture, Some(foreign_payer), "FOREIGN-PAYER").await,
        )
        .await,
        NhisWriteConflict::PayerUnavailable,
    );
    conflict(
        hms_db::billing::create_nhis_service_mapping(
            &fixture.pool,
            mapping(&fixture, Some(inactive_payer), "INACTIVE-PAYER").await,
        )
        .await,
        NhisWriteConflict::PayerUnavailable,
    );
    conflict(
        hms_db::billing::create_nhis_service_mapping(
            &fixture.pool,
            mapping(&fixture, Some(Uuid::new_v4()), "MISSING-PAYER").await,
        )
        .await,
        NhisWriteConflict::PayerUnavailable,
    );
    let mut foreign = mapping(&fixture, None, "FOREIGN-SERVICE").await;
    foreign.facility_id = Uuid::new_v4();
    conflict(
        hms_db::billing::create_nhis_service_mapping(&fixture.pool, foreign).await,
        NhisWriteConflict::ServiceUnavailable,
    );
    let inactive = mapping(&fixture, None, "INACTIVE-SERVICE").await;
    sqlx::query("UPDATE service_catalog SET active = FALSE WHERE id = $1")
        .bind(inactive.service_id)
        .execute(&fixture.pool)
        .await
        .expect("service deactivates");
    conflict(
        hms_db::billing::create_nhis_service_mapping(&fixture.pool, inactive).await,
        NhisWriteConflict::ServiceUnavailable,
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nhis_service_mappings")
        .fetch_one(&fixture.pool)
        .await
        .expect("mappings count");
    assert_eq!(count, 0);
}

#[tokio::test]
async fn nhis_claim_uses_only_effective_generic_mapping_and_keeps_its_saved_snapshot() {
    let fixture = BillingFixture::create().await;
    let payer_id = payer(&fixture, true).await;
    hms_db::billing::create_nhis_service_mapping(
        &fixture.pool,
        mapping(&fixture, Some(payer_id), "PAYER-ONLY").await,
    )
    .await
    .expect("payer mapping saves");
    let without_generic = claim(&fixture).await;
    assert!(without_generic.nhis_service_mapping_id.is_none());
    let generic = hms_db::billing::create_nhis_service_mapping(
        &fixture.pool,
        mapping(&fixture, None, "GENERIC-OLD").await,
    )
    .await
    .expect("generic saves");
    let saved = claim(&fixture).await;
    assert_eq!(saved.nhis_service_mapping_id, Some(generic.id));
    let mut future = mapping(&fixture, None, "GENERIC-FUTURE").await;
    future.effective_from = chrono::Utc::now().date_naive().succ_opt().unwrap();
    hms_db::billing::create_nhis_service_mapping(&fixture.pool, future)
        .await
        .expect("future generic saves");
    assert_eq!(
        claim(&fixture).await.nhis_service_mapping_id,
        Some(generic.id)
    );
    let replacement = hms_db::billing::create_nhis_service_mapping(
        &fixture.pool,
        mapping(&fixture, None, "GENERIC-NEW").await,
    )
    .await
    .expect("new generic saves");
    assert_eq!(
        claim(&fixture).await.nhis_service_mapping_id,
        Some(replacement.id)
    );
    let snapshot = hms_db::billing::get_claim(&fixture.pool, fixture.facility_id, saved.id)
        .await
        .expect("claim reads")
        .unwrap();
    assert_eq!(snapshot.nhis_service_mapping_id, Some(generic.id));
    assert_eq!(
        snapshot.nhis_service_mapping_version,
        Some(generic.version_number)
    );
    assert_eq!(snapshot.nhis_service_code.as_deref(), Some("GENERIC-OLD"));
    let old_end: Option<chrono::NaiveDate> =
        sqlx::query_scalar("SELECT effective_until FROM nhis_service_mappings WHERE id = $1")
            .bind(generic.id)
            .fetch_one(&fixture.pool)
            .await
            .expect("history reads");
    assert_eq!(old_end, None);
}

#[tokio::test]
async fn nhis_historical_invoice_uses_its_issue_date_instead_of_claim_creation_date() {
    let fixture = BillingFixture::create().await;
    let issued_at = chrono::Utc::now() - chrono::Duration::days(100);
    let mut old = mapping(&fixture, None, "INVOICE-DATE-CODE").await;
    old.effective_from = issued_at.date_naive().pred_opt().unwrap();
    old.effective_until = Some(chrono::Utc::now().date_naive());
    let old = hms_db::billing::create_nhis_service_mapping(&fixture.pool, old)
        .await
        .expect("historical mapping saves");
    hms_db::billing::create_nhis_service_mapping(
        &fixture.pool,
        mapping(&fixture, None, "CLAIM-DATE-CODE").await,
    )
    .await
    .expect("current mapping saves");
    let invoice = fixture.create_invoice("HISTORICAL-NHIS-INVOICE", 1).await;
    sqlx::query("UPDATE invoices SET issued_at = $1 WHERE id = $2")
        .bind(issued_at)
        .bind(invoice.id)
        .execute(&fixture.pool)
        .await
        .expect("historical fixture issue date sets");
    let saved = hms_db::billing::create_claim(
        &fixture.pool,
        NewClaim {
            id: Uuid::new_v4(),
            facility_id: fixture.facility_id,
            invoice_id: invoice.id,
            claim_number: "HISTORICAL-NHIS-CLAIM".to_owned(),
            actor_user_id: fixture.owner_id,
        },
    )
    .await
    .expect("historical invoice claim creates");
    assert_eq!(saved.nhis_service_mapping_id, Some(old.id));
    assert_eq!(
        saved.nhis_service_code.as_deref(),
        Some("INVOICE-DATE-CODE")
    );
}

#[tokio::test]
async fn nhis_batch_rejects_terminal_or_submitted_claims_without_partial_writes() {
    let fixture = BillingFixture::create().await;
    let draft = claim(&fixture).await;
    for status in ["submitted", "remitted", "rejected"] {
        let terminal = claim(&fixture).await;
        sqlx::query("UPDATE nhis_claims SET status = $1 WHERE id = $2")
            .bind(status)
            .bind(terminal.id)
            .execute(&fixture.pool)
            .await
            .expect("fixture status sets");
        conflict(
            hms_db::billing::create_nhis_batch(
                &fixture.pool,
                batch(&fixture, vec![draft.id, terminal.id]),
            )
            .await,
            NhisWriteConflict::ClaimsIneligible,
        );
        let statuses: Vec<String> = sqlx::query_scalar(
            "SELECT status FROM nhis_claims WHERE id = $1 OR id = $2 ORDER BY status",
        )
        .bind(draft.id)
        .bind(terminal.id)
        .fetch_all(&fixture.pool)
        .await
        .expect("statuses read");
        assert!(statuses.contains(&"draft".to_owned()));
        assert!(statuses.contains(&status.to_owned()));
    }
    assert_eq!(batch_count(&fixture).await, 0);
    let memberships: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM nhis_batch_claims")
        .fetch_one(&fixture.pool)
        .await
        .expect("membership counts");
    assert_eq!(memberships, 0);
}

#[tokio::test]
async fn nhis_batch_rejects_duplicate_missing_foreign_currency_and_overflow_sets() {
    let fixture = BillingFixture::create().await;
    let first = claim(&fixture).await;
    let second = claim(&fixture).await;
    for invalid in [vec![], (0..101).map(|_| Uuid::new_v4()).collect()] {
        conflict(
            hms_db::billing::create_nhis_batch(&fixture.pool, batch(&fixture, invalid)).await,
            NhisWriteConflict::InvalidClaimSet,
        );
    }
    conflict(
        hms_db::billing::create_nhis_batch(
            &fixture.pool,
            batch(&fixture, vec![first.id, first.id]),
        )
        .await,
        NhisWriteConflict::InvalidClaimSet,
    );
    conflict(
        hms_db::billing::create_nhis_batch(
            &fixture.pool,
            batch(&fixture, vec![first.id, Uuid::new_v4()]),
        )
        .await,
        NhisWriteConflict::ClaimsUnavailable,
    );
    let mut foreign = batch(&fixture, vec![first.id]);
    foreign.facility_id = Uuid::new_v4();
    conflict(
        hms_db::billing::create_nhis_batch(&fixture.pool, foreign).await,
        NhisWriteConflict::ClaimsUnavailable,
    );
    sqlx::query("UPDATE nhis_claims SET currency = 'USD' WHERE id = $1")
        .bind(second.id)
        .execute(&fixture.pool)
        .await
        .expect("currency sets");
    conflict(
        hms_db::billing::create_nhis_batch(
            &fixture.pool,
            batch(&fixture, vec![first.id, second.id]),
        )
        .await,
        NhisWriteConflict::MixedCurrencies,
    );
    sqlx::query("UPDATE nhis_claims SET currency = 'GHS', amount_minor = $1 WHERE id = $2")
        .bind(i64::MAX)
        .bind(second.id)
        .execute(&fixture.pool)
        .await
        .expect("large amount sets");
    conflict(
        hms_db::billing::create_nhis_batch(
            &fixture.pool,
            batch(&fixture, vec![first.id, second.id]),
        )
        .await,
        NhisWriteConflict::AmountOutOfRange,
    );
    assert_eq!(batch_count(&fixture).await, 0);
}

#[tokio::test]
async fn nhis_batch_concurrent_overlapping_sets_save_once_and_keep_ready_history() {
    let fixture = BillingFixture::create().await;
    let first = claim(&fixture).await;
    let second = claim(&fixture).await;
    sqlx::query("UPDATE nhis_claims SET status = 'ready' WHERE id = $1")
        .bind(second.id)
        .execute(&fixture.pool)
        .await
        .expect("ready fixture sets");
    let left = batch(&fixture, vec![first.id, second.id]);
    let right = batch(&fixture, vec![second.id, first.id]);
    let (left, right) = tokio::join!(
        hms_db::billing::create_nhis_batch(&fixture.pool, left),
        hms_db::billing::create_nhis_batch(&fixture.pool, right),
    );
    let saved = match (left, right) {
        (Ok(saved), error @ Err(_)) | (error @ Err(_), Ok(saved)) => {
            conflict(error, NhisWriteConflict::ClaimsAlreadyBatched);
            saved
        }
        other => panic!("exactly one overlapping batch should save: {other:?}"),
    };
    assert_eq!(saved.claim_count, 2);
    assert_eq!(
        saved.total_amount_minor,
        first.amount_minor + second.amount_minor
    );
    assert_eq!(batch_count(&fixture).await, 1);
    let statuses: Vec<String> =
        sqlx::query_scalar("SELECT status FROM nhis_claims WHERE id = ANY($1)")
            .bind(vec![first.id, second.id])
            .fetch_all(&fixture.pool)
            .await
            .expect("statuses read");
    assert_eq!(statuses, vec!["ready", "ready"]);
    let membership_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM nhis_batch_claims WHERE batch_id = $1")
            .bind(saved.id)
            .fetch_one(&fixture.pool)
            .await
            .expect("memberships read");
    assert_eq!(membership_count, 2);
    let audit: serde_json::Value = sqlx::query_scalar("SELECT metadata FROM audit_events WHERE resource_id = $1 AND event_type = 'billing.nhis_batch.created'").bind(saved.id).fetch_one(&fixture.pool).await.expect("audit saves");
    assert_eq!(audit, serde_json::json!({"claim_count": 2}));
}
