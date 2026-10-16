use chrono::{Duration, Utc};
use hms_db::{inventory::*, test_support::TestDb};
use hms_domain::{inventory::RequisitionStatus, inventory_standing::*};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    item: Uuid,
    unit: String,
    source: Uuid,
    target: Uuid,
}
impl Fixture {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let(item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled ORDER BY id LIMIT 1").bind(db.facility_id()).fetch_one(db.pool()).await.unwrap();
        let ids:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 2").bind(db.facility_id()).fetch_all(db.pool()).await.unwrap();
        Self {
            db,
            item,
            unit,
            source: ids[0],
            target: ids[1],
        }
    }
    fn actor(&self) -> TemplateActor {
        TemplateActor {
            facility_id: self.db.facility_id(),
            user_id: self.db.owner_user_id(),
            request_id: Some("standing-issue-test".into()),
        }
    }
    fn action(&self) -> StandingRequestAction {
        StandingRequestAction {
            expected_source_version: 1,
        }
    }
    async fn request(&self, items: Vec<StandingTemplateItemInput>) -> RequisitionReview {
        let template = create_standing_template(
            self.db.pool(),
            self.actor(),
            CreateStandingTemplateRequest {
                name: "Synthetic conserved supplies".into(),
                requesting_location_id: self.target,
                fulfilling_location_id: self.source,
                frequency: TemplateFrequency::Daily,
                next_run_on: Utc::now().date_naive(),
                monthly_day: None,
                notes: None,
                items,
            },
        )
        .await
        .unwrap();
        generate_standing_template_run(
            self.db.pool(),
            self.actor(),
            template.summary.id,
            GenerateStandingTemplateRequest {
                expected_version: 1,
                scheduled_for: template.summary.next_run_on,
            },
        )
        .await
        .unwrap()
        .unwrap()
    }
    fn line(&self) -> StandingTemplateItemInput {
        StandingTemplateItemInput {
            item_id: self.item,
            quantity: 4,
            expected_unit: self.unit.clone(),
        }
    }
    async fn stock(&self, name: &str, qty: i64, days: i64) {
        create_batch(
            self.db.pool(),
            NewStockBatch {
                authorization: None,
                expected_unit: self.unit.clone(),
                id: Uuid::new_v4(),
                facility_id: self.db.facility_id(),
                item_id: self.item,
                location_id: self.source,
                batch_number: name.into(),
                expires_on: Some(Utc::now().date_naive() + Duration::days(days)),
                quantity_received: qty,
                actor_user_id: self.db.owner_user_id(),
            },
        )
        .await
        .unwrap();
    }
    async fn total(&self, location: Option<Uuid>) -> i64 {
        sqlx::query_scalar("SELECT COALESCE(sum(quantity_on_hand),0)::bigint FROM stock_batches WHERE facility_id=$1 AND item_id=$2 AND ($3::uuid IS NULL OR location_id=$3)").bind(self.db.facility_id()).bind(self.item).bind(location).fetch_one(self.db.pool()).await.unwrap()
    }
    async fn approved(&self, request: &RequisitionReview) {
        approve_standing_request(self.db.pool(), self.actor(), request.id, self.action())
            .await
            .unwrap()
            .unwrap();
    }
}
fn conflict<T: std::fmt::Debug>(result: anyhow::Result<T>, expected: StandingRequestError) {
    assert_eq!(
        result.unwrap_err().downcast_ref::<StandingRequestError>(),
        Some(&expected)
    );
}

#[tokio::test]
async fn generation_replay_waits_for_issue_and_returns_one_coherent_snapshot() {
    let f = Fixture::new().await;
    f.stock("REPLAY-ISSUE", 4, 3).await;
    let request = f.request(vec![f.line()]).await;
    f.approved(&request).await;
    // Hold the issue transaction at its final audit write, after it has changed
    // the header and lines but before either can become visible to another reader.
    sqlx::raw_sql("CREATE FUNCTION pause_standing_issue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='inventory.standing_request.issued' THEN PERFORM pg_advisory_xact_lock(87123); END IF; RETURN NEW; END $$; CREATE TRIGGER pause_standing_issue_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION pause_standing_issue_audit();")
        .execute(f.db.pool()).await.unwrap();
    let mut gate = f.db.pool().begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(87123)")
        .execute(&mut *gate)
        .await
        .unwrap();
    let pool = f.db.pool().clone();
    let actor = f.actor();
    let action = f.action();
    let id = request.id;
    let issue = tokio::spawn(async move { issue_standing_request(&pool, actor, id, action).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=87123)")
                .fetch_one(f.db.pool()).await.unwrap();
            if waiting { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("issue reached its atomic audit write");
    let pool = f.db.pool().clone();
    let actor = f.actor();
    let template = request.source_template_id;
    let run = GenerateStandingTemplateRequest {
        expected_version: request.template_version,
        scheduled_for: request.scheduled_for,
    };
    let mut replay =
        tokio::spawn(
            async move { generate_standing_template_run(&pool, actor, template, run).await },
        );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(150), &mut replay)
            .await
            .is_err(),
        "replay must wait for the request writer"
    );
    gate.commit().await.unwrap();
    let issued = issue.await.unwrap().unwrap().unwrap();
    let replayed = replay.await.unwrap().unwrap().unwrap();
    assert_eq!(replayed.status, RequisitionStatus::Fulfilled);
    assert_eq!(replayed.fulfilled_at, issued.fulfilled_at);
    assert_eq!(replayed.items[0].quantity_issued, 4);
    assert_eq!(f.total(Some(f.source)).await, 0);
    assert_eq!(f.total(Some(f.target)).await, 4);
}

#[tokio::test]
async fn cancel_and_issue_compete_without_reversing_either_terminal_decision() {
    let f = Fixture::new().await;
    f.stock("CANCEL-RACE", 4, 3).await;
    let request = f.request(vec![f.line()]).await;
    f.approved(&request).await;
    let (cancelled, issued) = tokio::join!(
        cancel_standing_request(f.db.pool(), f.actor(), request.id, f.action()),
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action())
    );
    assert_ne!(cancelled.is_ok(), issued.is_ok());
    let saved = get_requisition_review(f.db.pool(), f.db.facility_id(), request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(f.total(None).await, 4);
    if saved.status == RequisitionStatus::Cancelled {
        assert_eq!(saved.items[0].quantity_issued, 0);
        assert_eq!(f.total(Some(f.source)).await, 4);
        assert!(saved.cancelled_at.is_some());
        let replay = cancel_standing_request(f.db.pool(), f.actor(), request.id, f.action())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(replay.cancelled_at, saved.cancelled_at);
    } else {
        assert_eq!(saved.status, RequisitionStatus::Fulfilled);
        assert_eq!(saved.items[0].quantity_issued, 4);
        assert_eq!(f.total(Some(f.target)).await, 4);
    }
}

#[tokio::test]
async fn excessive_batch_fragmentation_rejects_before_any_stock_movement() {
    let f = Fixture::new().await;
    sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand,expires_on) SELECT gen_random_uuid(),$1,$2,$3,'SYNTHETIC-FRAGMENT-'||n,1,$4 FROM generate_series(1,501) AS n")
        .bind(f.db.facility_id()).bind(f.item).bind(f.source).bind(Utc::now().date_naive()+Duration::days(3)).execute(f.db.pool()).await.unwrap();
    let mut line = f.line();
    line.quantity = 501;
    let request = f.request(vec![line]).await;
    f.approved(&request).await;
    conflict(
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action()).await,
        StandingRequestError::TooFragmented,
    );
    assert_eq!(f.total(Some(f.source)).await, 501);
    assert_eq!(f.total(Some(f.target)).await, 0);
    let moves: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM stock_movements WHERE reason='standing_requisition_issue'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(moves, 0);
}

#[tokio::test]
async fn real_issue_preserves_total_stock_lot_expiry_and_immutable_concurrent_replay() {
    let f = Fixture::new().await;
    f.stock("EARLY", 2, 2).await;
    f.stock("LATER", 5, 10).await;
    f.stock("EXPIRED", 50, -1).await;
    let request = f.request(vec![f.line()]).await;
    conflict(
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action()).await,
        StandingRequestError::NotApproved,
    );
    f.approved(&request).await;
    let before = f.total(None).await;
    let (left, right) = tokio::join!(
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action()),
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action())
    );
    let left = left.unwrap().unwrap();
    let right = right.unwrap().unwrap();
    assert_eq!(
        serde_json::to_value(&left).unwrap(),
        serde_json::to_value(right).unwrap()
    );
    assert_eq!(left.status, RequisitionStatus::Fulfilled);
    assert_eq!(left.items[0].quantity_issued, 4);
    assert!(left.fulfilled_at.is_some());
    assert_eq!(left.fulfilled_by_user_id, Some(f.db.owner_user_id()));
    assert_eq!(f.total(None).await, before);
    assert_eq!(f.total(Some(f.source)).await, 53);
    assert_eq!(f.total(Some(f.target)).await, 4);
    let incoming:Vec<(String,i64,chrono::NaiveDate)>=sqlx::query_as("SELECT batch_number,quantity_on_hand,expires_on FROM stock_batches WHERE location_id=$1 ORDER BY expires_on").bind(f.target).fetch_all(f.db.pool()).await.unwrap();
    assert_eq!(incoming.len(), 2);
    assert_eq!(
        incoming[0],
        (
            "EARLY".into(),
            2,
            Utc::now().date_naive() + Duration::days(2)
        )
    );
    assert_eq!(incoming[1].0, "LATER");
    assert_eq!(incoming[1].1, 2);
    let expired: i64 = sqlx::query_scalar(
        "SELECT quantity_on_hand FROM stock_batches WHERE batch_number='EXPIRED'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(expired, 50);
    let moves:(i64,i64)=sqlx::query_as("SELECT count(*),sum(quantity)::bigint FROM stock_movements WHERE reason='standing_requisition_issue'").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(moves, (4, 0));
    let evidence: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM stock_requisition_issue_allocations WHERE requisition_id=$1",
    )
    .bind(request.id)
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(evidence, 2);
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_events WHERE event_type='inventory.standing_request.issued'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(audits, 1);
    sqlx::query("UPDATE inventory_items SET is_active=FALSE,unit='changed' WHERE id=$1")
        .bind(f.item)
        .execute(f.db.pool())
        .await
        .unwrap();
    let replay = issue_standing_request(f.db.pool(), f.actor(), request.id, f.action())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(replay.fulfilled_at, left.fulfilled_at);
    assert_eq!(f.total(None).await, before);
}

#[tokio::test]
async fn competing_requests_cannot_overspend_shared_source_batches() {
    let f = Fixture::new().await;
    f.stock("SCARCE", 4, 3).await;
    let first = f.request(vec![f.line()]).await;
    let second = f.request(vec![f.line()]).await;
    f.approved(&first).await;
    f.approved(&second).await;
    let (left, right) = tokio::join!(
        issue_standing_request(f.db.pool(), f.actor(), first.id, f.action()),
        issue_standing_request(f.db.pool(), f.actor(), second.id, f.action())
    );
    assert_ne!(left.is_ok(), right.is_ok());
    let failed = if left.is_err() { left } else { right };
    conflict(failed, StandingRequestError::InsufficientStock);
    assert_eq!(f.total(None).await, 4);
    assert_eq!(f.total(Some(f.source)).await, 0);
    assert_eq!(f.total(Some(f.target)).await, 4);
    let issued: i64 =
        sqlx::query_scalar("SELECT count(*) FROM stock_requisitions WHERE status='fulfilled'")
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(issued, 1);
}

#[tokio::test]
async fn a_multiline_shortage_or_audit_failure_rolls_back_every_stock_and_line_change() {
    let f = Fixture::new().await;
    f.stock("AVAILABLE", 10, 3).await;
    let other = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit) SELECT $1,facility_id,category_id,'SYNTHETIC-SECOND','Synthetic second item',item_type,unit FROM inventory_items WHERE id=$2")
        .bind(other).bind(f.item).execute(f.db.pool()).await.unwrap();
    let unit = f.unit.clone();
    let request = f
        .request(vec![
            f.line(),
            StandingTemplateItemInput {
                item_id: other,
                quantity: 3,
                expected_unit: unit,
            },
        ])
        .await;
    f.approved(&request).await;
    conflict(
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action()).await,
        StandingRequestError::InsufficientStock,
    );
    assert_eq!(f.total(Some(f.source)).await, 10);
    assert_eq!(f.total(Some(f.target)).await, 0);
    let saved = get_requisition_review(f.db.pool(), f.db.facility_id(), request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.status, RequisitionStatus::Approved);
    assert!(saved.items.iter().all(|i| i.quantity_issued == 0));
    let request = f.request(vec![f.line()]).await;
    f.approved(&request).await;
    sqlx::raw_sql("CREATE FUNCTION fail_issue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='inventory.standing_request.issued' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_issue_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_issue_audit();").execute(f.db.pool()).await.unwrap();
    assert!(
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action())
            .await
            .is_err()
    );
    assert_eq!(f.total(Some(f.source)).await, 10);
    assert_eq!(f.total(Some(f.target)).await, 0);
    let evidence: i64 =
        sqlx::query_scalar("SELECT count(*) FROM stock_requisition_issue_allocations")
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(evidence, 0);
    let moves: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM stock_movements WHERE reason='standing_requisition_issue'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(moves, 0);
    let saved = get_requisition_review(f.db.pool(), f.db.facility_id(), request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.status, RequisitionStatus::Approved);
    assert!(saved.fulfilled_at.is_none());
    assert_eq!(saved.items[0].quantity_issued, 0);
}

#[tokio::test]
async fn issue_is_facility_version_source_unit_and_expiry_guarded() {
    let f = Fixture::new().await;
    f.stock("EXPIRED-ONLY", 20, -1).await;
    let request = f.request(vec![f.line()]).await;
    f.approved(&request).await;
    let mut foreign = f.actor();
    foreign.facility_id = Uuid::new_v4();
    assert!(
        issue_standing_request(f.db.pool(), foreign, request.id, f.action())
            .await
            .unwrap()
            .is_none()
    );
    conflict(
        issue_standing_request(
            f.db.pool(),
            f.actor(),
            request.id,
            StandingRequestAction {
                expected_source_version: 2,
            },
        )
        .await,
        StandingRequestError::VersionConflict,
    );
    conflict(
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action()).await,
        StandingRequestError::InsufficientStock,
    );
    f.stock("VALID", 20, 5).await;
    sqlx::query("UPDATE inventory_items SET unit='box' WHERE id=$1")
        .bind(f.item)
        .execute(f.db.pool())
        .await
        .unwrap();
    conflict(
        issue_standing_request(f.db.pool(), f.actor(), request.id, f.action()).await,
        StandingRequestError::UnitChanged,
    );
    assert_eq!(f.total(Some(f.source)).await, 40);
    assert_eq!(f.total(Some(f.target)).await, 0);
}
