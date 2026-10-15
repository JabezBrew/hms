use super::nhis_safety::{batch, claim};
use super::*;
use hms_db::billing::NhisWriteConflict;
use uuid::Uuid;

fn command(fixture: &BillingFixture, batch_id: Uuid) -> NhisBatchExportCommand {
    NhisBatchExportCommand {
        facility_id: fixture.facility_id,
        batch_id,
        actor_user_id: fixture.owner_id,
        request_id: Some("export-record-test".to_owned()),
    }
}

async fn ready_batch(fixture: &BillingFixture) -> (hms_domain::billing::NhisBatchListItem, Uuid) {
    let claim = claim(fixture).await;
    let batch = hms_db::billing::create_nhis_batch(&fixture.pool, batch(fixture, vec![claim.id]))
        .await
        .expect("batch creates");
    (batch, claim.id)
}

async fn audit_count(fixture: &BillingFixture, batch_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM audit_events WHERE resource_id = $1 AND event_type = 'billing.nhis_batch.exported'")
        .bind(batch_id).fetch_one(&fixture.pool).await.expect("audits count")
}

#[tokio::test]
async fn nhis_export_records_are_atomic_idempotent_and_preserve_claim_lifecycle() {
    let fixture = BillingFixture::create().await;
    let (batch, claim_id) = ready_batch(&fixture).await;
    let (left, right) = tokio::join!(
        hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id)),
        hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id)),
    );
    let left = left
        .expect("first request evaluates")
        .expect("record exists");
    let right = right
        .expect("concurrent replay evaluates")
        .expect("same record exists");
    assert_eq!(
        serde_json::to_value(&left).unwrap(),
        serde_json::to_value(&right).unwrap()
    );
    assert_eq!(left.export_format, "nhis_export_record_v1");
    let claim_status: String = sqlx::query_scalar("SELECT status FROM nhis_claims WHERE id = $1")
        .bind(claim_id)
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
    assert_eq!(
        claim_status, "ready",
        "an export record is not a submission"
    );
    let timestamp: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT exported_at FROM nhis_batches WHERE id = $1")
            .bind(batch.id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert_eq!(audit_count(&fixture, batch.id).await, 1);
    // A later claim lifecycle update must not be undone by viewing/replaying
    // the existing immutable export record.
    sqlx::query("UPDATE nhis_claims SET status = 'remitted' WHERE id = $1")
        .bind(claim_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    let replay = hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(replay.checksum, left.checksum);
    let saved: (String, chrono::DateTime<chrono::Utc>) =
        sqlx::query_as("SELECT status, exported_at FROM nhis_batches WHERE id = $1")
            .bind(batch.id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert_eq!(saved, ("exported".to_owned(), timestamp));
    let current: String = sqlx::query_scalar("SELECT status FROM nhis_claims WHERE id = $1")
        .bind(claim_id)
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
    assert_eq!(current, "remitted");
    assert_eq!(audit_count(&fixture, batch.id).await, 1);
    let records =
        hms_db::billing::list_nhis_export_jobs(&fixture.pool, fixture.facility_id, None, 1)
            .await
            .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].status, "recorded");
    assert!(records[0].expires_at.is_none());
}

#[tokio::test]
async fn nhis_export_never_moves_submitted_or_remitted_batches_backward() {
    let fixture = BillingFixture::create().await;
    for status in ["submitted", "remitted"] {
        let (batch, claim_id) = ready_batch(&fixture).await;
        sqlx::query("UPDATE nhis_batches SET status = $1 WHERE id = $2")
            .bind(status)
            .bind(batch.id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE nhis_claims SET status = $1 WHERE id = $2")
            .bind(status)
            .bind(claim_id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        let error = hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id))
            .await
            .expect_err("terminal batch rejects export");
        assert_eq!(
            error.downcast_ref::<NhisWriteConflict>(),
            Some(&NhisWriteConflict::ExportStateLocked)
        );
        let saved: (
            String,
            Option<String>,
            Option<chrono::DateTime<chrono::Utc>>,
        ) = sqlx::query_as(
            "SELECT status, export_checksum, exported_at FROM nhis_batches WHERE id = $1",
        )
        .bind(batch.id)
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
        assert_eq!(saved, (status.to_owned(), None, None));
        let current: String = sqlx::query_scalar("SELECT status FROM nhis_claims WHERE id = $1")
            .bind(claim_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
        assert_eq!(current, status);
        assert_eq!(audit_count(&fixture, batch.id).await, 0);
    }
}

#[tokio::test]
async fn nhis_export_validates_locked_claim_status_and_saved_summary_before_writing() {
    let fixture = BillingFixture::create().await;
    for status in ["draft", "submitted", "remitted", "rejected"] {
        let (batch, claim_id) = ready_batch(&fixture).await;
        sqlx::query("UPDATE nhis_claims SET status = $1 WHERE id = $2")
            .bind(status)
            .bind(claim_id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        let error = hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id))
            .await
            .expect_err("non-ready member rejects export");
        assert_eq!(
            error.downcast_ref::<NhisWriteConflict>(),
            Some(&NhisWriteConflict::ExportClaimsIneligible)
        );
        let saved: String = sqlx::query_scalar("SELECT status FROM nhis_batches WHERE id = $1")
            .bind(batch.id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
        assert_eq!(saved, "draft");
        assert_eq!(audit_count(&fixture, batch.id).await, 0);
    }
    for (column, value) in [
        ("claim_count", 0_i64),
        ("claim_count", 101),
        ("claim_count", 2),
        ("total_amount_minor", 1),
    ] {
        let (batch, _) = ready_batch(&fixture).await;
        let sql = format!("UPDATE nhis_batches SET {column} = $1 WHERE id = $2");
        sqlx::query(&sql)
            .bind(value)
            .bind(batch.id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        let error = hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id))
            .await
            .expect_err("inconsistent summary rejects export");
        assert_eq!(
            error.downcast_ref::<NhisWriteConflict>(),
            Some(&NhisWriteConflict::ExportSnapshotInvalid)
        );
        assert_eq!(audit_count(&fixture, batch.id).await, 0);
    }
    let (batch, claim_id) = ready_batch(&fixture).await;
    sqlx::query("UPDATE nhis_claims SET currency = 'USD' WHERE id = $1")
        .bind(claim_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    assert!(
        hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn nhis_export_checked_total_rejects_overflow_without_saving_a_record() {
    let fixture = BillingFixture::create().await;
    let first = claim(&fixture).await;
    let second = claim(&fixture).await;
    let batch = hms_db::billing::create_nhis_batch(
        &fixture.pool,
        batch(&fixture, vec![first.id, second.id]),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE nhis_claims SET amount_minor = $1 WHERE id = $2")
        .bind(i64::MAX)
        .bind(first.id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    let error = hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id))
        .await
        .expect_err("overflow is rejected");
    assert_eq!(
        error.downcast_ref::<NhisWriteConflict>(),
        Some(&NhisWriteConflict::AmountOutOfRange)
    );
    assert_eq!(audit_count(&fixture, batch.id).await, 0);
    let status: String = sqlx::query_scalar("SELECT status FROM nhis_batches WHERE id = $1")
        .bind(batch.id)
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
    assert_eq!(status, "draft");
}

#[tokio::test]
async fn nhis_export_audit_failure_rolls_back_record_and_invoice_lock_update() {
    let fixture = BillingFixture::create().await;
    let (batch, claim_id) = ready_batch(&fixture).await;
    sqlx::query("CREATE FUNCTION reject_export_record_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'billing.nhis_batch.exported' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$").execute(&fixture.pool).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_export_record_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_export_record_audit()").execute(&fixture.pool).await.unwrap();
    assert!(
        hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id))
            .await
            .is_err()
    );
    let saved: (
        String,
        Option<String>,
        Option<chrono::DateTime<chrono::Utc>>,
    ) = sqlx::query_as(
        "SELECT status, export_checksum, exported_at FROM nhis_batches WHERE id = $1",
    )
    .bind(batch.id)
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(saved, ("draft".to_owned(), None, None));
    let lock: String = sqlx::query_scalar("SELECT invoices.locked_reason FROM invoices INNER JOIN nhis_claims ON nhis_claims.invoice_id = invoices.id WHERE nhis_claims.id = $1").bind(claim_id).fetch_one(&fixture.pool).await.unwrap();
    assert_eq!(lock, "claim_created");
    assert_eq!(audit_count(&fixture, batch.id).await, 0);
}

#[tokio::test]
async fn nhis_export_is_facility_scoped_and_never_reconstructs_incomplete_old_records() {
    let fixture = BillingFixture::create().await;
    let (batch, _) = ready_batch(&fixture).await;
    let mut foreign = command(&fixture, batch.id);
    foreign.facility_id = Uuid::new_v4();
    assert!(hms_db::billing::export_nhis_batch(&fixture.pool, foreign)
        .await
        .unwrap()
        .is_none());
    sqlx::query("UPDATE nhis_batches SET status = 'exported', exported_at = now() WHERE id = $1")
        .bind(batch.id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    let error = hms_db::billing::export_nhis_batch(&fixture.pool, command(&fixture, batch.id))
        .await
        .expect_err("missing persisted checksum rejects replay");
    assert_eq!(
        error.downcast_ref::<NhisWriteConflict>(),
        Some(&NhisWriteConflict::ExportSnapshotInvalid)
    );
    assert_eq!(audit_count(&fixture, batch.id).await, 0);
}
