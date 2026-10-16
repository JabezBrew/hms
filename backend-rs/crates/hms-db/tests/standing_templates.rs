use chrono::{Duration, NaiveDate, Utc};
use hms_db::{inventory::*, test_support::TestDb};
use hms_domain::{inventory::StandingOrderStatus, inventory_standing::*};
use uuid::Uuid;

struct Fixture {
    db: TestDb,
    item: Uuid,
    unit: String,
    requesting: Uuid,
    fulfilling: Uuid,
}
impl Fixture {
    async fn new() -> Self {
        let db = TestDb::hospital().await.unwrap();
        let (item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled ORDER BY id LIMIT 1").bind(db.facility_id()).fetch_one(db.pool()).await.unwrap();
        let locations:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 2").bind(db.facility_id()).fetch_all(db.pool()).await.unwrap();
        assert_eq!(locations.len(), 2);
        Self {
            db,
            item,
            unit,
            requesting: locations[0],
            fulfilling: locations[1],
        }
    }
    fn actor(&self) -> TemplateActor {
        TemplateActor {
            facility_id: self.db.facility_id(),
            user_id: self.db.owner_user_id(),
            request_id: Some("standing-template-test".into()),
        }
    }
    fn data(&self) -> CreateStandingTemplateRequest {
        CreateStandingTemplateRequest {
            name: "Synthetic weekly supplies".into(),
            requesting_location_id: self.requesting,
            fulfilling_location_id: self.fulfilling,
            frequency: TemplateFrequency::Weekly,
            next_run_on: Utc::now().date_naive() - Duration::days(14),
            monthly_day: None,
            notes: Some("Synthetic stock note".into()),
            items: vec![StandingTemplateItemInput {
                item_id: self.item,
                quantity: 4,
                expected_unit: self.unit.clone(),
            }],
        }
    }
    async fn create(&self) -> StandingTemplateDetail {
        create_standing_template(self.db.pool(), self.actor(), self.data())
            .await
            .unwrap()
    }
    fn run(&self, template: &StandingTemplateDetail) -> GenerateStandingTemplateRequest {
        GenerateStandingTemplateRequest {
            scheduled_for: template.summary.next_run_on,
            expected_version: template.summary.version,
        }
    }
}
fn conflict<T: std::fmt::Debug>(result: anyhow::Result<T>, expected: StandingTemplateError) {
    assert_eq!(
        result.unwrap_err().downcast_ref::<StandingTemplateError>(),
        Some(&expected)
    );
}

#[test]
fn standing_schedule_preserves_month_anchor_and_skips_missed_backlog_without_a_loop() {
    let date = |v: &str| NaiveDate::parse_from_str(v, "%Y-%m-%d").unwrap();
    assert_eq!(
        next_standing_occurrence(
            date("2026-01-31"),
            TemplateFrequency::Monthly,
            Some(31),
            date("2026-01-31")
        ),
        Some(date("2026-02-28"))
    );
    assert_eq!(
        next_standing_occurrence(
            date("2026-02-28"),
            TemplateFrequency::Monthly,
            Some(31),
            date("2026-02-28")
        ),
        Some(date("2026-03-31"))
    );
    assert_eq!(
        next_standing_occurrence(
            date("2024-01-31"),
            TemplateFrequency::Monthly,
            Some(31),
            date("2024-02-27")
        ),
        Some(date("2024-02-29"))
    );
    assert_eq!(
        next_standing_occurrence(
            date("2020-01-06"),
            TemplateFrequency::Biweekly,
            None,
            date("2026-10-15")
        ),
        Some(date("2026-10-19"))
    );
    assert_eq!(
        next_standing_occurrence(
            date("2020-01-01"),
            TemplateFrequency::Daily,
            None,
            date("2026-10-15")
        ),
        Some(date("2026-10-16"))
    );
}

#[tokio::test]
async fn concurrent_due_runs_save_real_lines_once_and_replay_without_rewriting_schedule_or_audit() {
    let f = Fixture::new().await;
    let template = f.create().await;
    let (left, right) = tokio::join!(
        generate_standing_template_run(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            f.run(&template)
        ),
        generate_standing_template_run(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            f.run(&template)
        )
    );
    let left = left.unwrap().unwrap();
    let right = right.unwrap().unwrap();
    assert_eq!(left.id, right.id);
    assert_eq!(left.items.len(), 1);
    assert_eq!(left.items[0].quantity_requested, 4);
    assert_eq!(left.items[0].quantity_issued, 0);
    assert_eq!(left.source_template_id, template.summary.id);
    assert_eq!(left.template_version, 1);
    let updated = get_standing_template(f.db.pool(), f.db.facility_id(), template.summary.id)
        .await
        .unwrap()
        .unwrap();
    assert!(updated.summary.next_run_on > Utc::now().date_naive());
    assert_eq!(updated.summary.last_requisition_id, Some(left.id));
    let audits:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE event_type='inventory.standing_template.request_generated'").fetch_one(f.db.pool()).await.unwrap();
    assert_eq!(audits, 1);
    let requests: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM stock_requisitions WHERE source_type='standing_order_template'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(requests, 1);
    // Config edits do not rewrite an existing request snapshot or permit another
    // generation for the already recorded occurrence.
    let mut config = f.data();
    config.items[0].quantity = 9;
    config.next_run_on = updated.summary.next_run_on;
    update_standing_template(
        f.db.pool(),
        f.actor(),
        template.summary.id,
        UpdateStandingTemplateRequest {
            expected_version: 1,
            template: config,
        },
    )
    .await
    .unwrap()
    .unwrap();
    let replay = generate_standing_template_run(
        f.db.pool(),
        f.actor(),
        template.summary.id,
        f.run(&template),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(replay.id, left.id);
    assert_eq!(replay.items[0].quantity_requested, 4);
    assert_eq!(replay.template_version, 1);
    let summary = get_requisition(f.db.pool(), f.db.facility_id(), left.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(summary.line_count, 1);
    assert_eq!(
        summary.source_type.as_deref(),
        Some("standing_order_template")
    );
    conflict(
        update_standing_template(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            UpdateStandingTemplateRequest {
                expected_version: 2,
                template: f.data(),
            },
        )
        .await,
        StandingTemplateError::OccurrenceChanged,
    );
}

#[tokio::test]
async fn fulfilled_manual_supply_cannot_repeat_stock_movements() {
    let f = Fixture::new().await;
    create_batch(
        f.db.pool(),
        NewStockBatch {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            item_id: f.item,
            location_id: f.fulfilling,
            batch_number: "SYNTHETIC-ONCE".into(),
            expires_on: None,
            quantity_received: 10,
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await
    .unwrap();
    let request = create_requisition(
        f.db.pool(),
        NewStockRequisition {
            id: Uuid::new_v4(),
            facility_id: f.db.facility_id(),
            requesting_location_id: f.requesting,
            actor_user_id: f.db.owner_user_id(),
        },
    )
    .await
    .unwrap();
    let lines = || {
        vec![SupplyDispenseLine {
            item_id: f.item,
            location_id: f.fulfilling,
            quantity: 4,
        }]
    };
    dispense_supply_request(
        f.db.pool(),
        f.db.facility_id(),
        request.id,
        lines(),
        f.db.owner_user_id(),
    )
    .await
    .unwrap();
    assert!(dispense_supply_request(
        f.db.pool(),
        f.db.facility_id(),
        request.id,
        lines(),
        f.db.owner_user_id()
    )
    .await
    .is_err());
    let remaining: i64 = sqlx::query_scalar(
        "SELECT quantity_on_hand FROM stock_batches WHERE batch_number='SYNTHETIC-ONCE'",
    )
    .fetch_one(f.db.pool())
    .await
    .unwrap();
    assert_eq!(remaining, 6);
    let issues: i64 =
        sqlx::query_scalar("SELECT count(*) FROM supply_request_dispenses WHERE requisition_id=$1")
            .bind(request.id)
            .fetch_one(f.db.pool())
            .await
            .unwrap();
    assert_eq!(issues, 1);
}

#[tokio::test]
async fn templates_validate_references_units_and_empty_or_duplicate_lines_before_any_write() {
    let f = Fixture::new().await;
    let mut empty = f.data();
    empty.items.clear();
    conflict(
        create_standing_template(f.db.pool(), f.actor(), empty).await,
        StandingTemplateError::InvalidInput,
    );
    let mut duplicate = f.data();
    duplicate.items.push(StandingTemplateItemInput {
        item_id: f.item,
        quantity: 1,
        expected_unit: f.unit.clone(),
    });
    conflict(
        create_standing_template(f.db.pool(), f.actor(), duplicate).await,
        StandingTemplateError::InvalidInput,
    );
    let mut zero = f.data();
    zero.items[0].quantity = 0;
    conflict(
        create_standing_template(f.db.pool(), f.actor(), zero).await,
        StandingTemplateError::InvalidInput,
    );
    let mut foreign = f.data();
    foreign.requesting_location_id = Uuid::new_v4();
    conflict(
        create_standing_template(f.db.pool(), f.actor(), foreign).await,
        StandingTemplateError::ReferencesUnavailable,
    );
    let mut unit = f.data();
    unit.items[0].expected_unit = "wrong unit".into();
    conflict(
        create_standing_template(f.db.pool(), f.actor(), unit).await,
        StandingTemplateError::UnitChanged,
    );
    sqlx::query("UPDATE inventory_items SET controlled=TRUE WHERE id=$1")
        .bind(f.item)
        .execute(f.db.pool())
        .await
        .unwrap();
    conflict(
        create_standing_template(f.db.pool(), f.actor(), f.data()).await,
        StandingTemplateError::ReferencesUnavailable,
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_standing_order_templates")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn a_catalog_unit_change_requires_explicit_template_review_before_generation() {
    let f = Fixture::new().await;
    let template = f.create().await;
    sqlx::query("UPDATE inventory_items SET unit='box' WHERE id=$1")
        .bind(f.item)
        .execute(f.db.pool())
        .await
        .unwrap();
    let current = get_standing_template(f.db.pool(), f.db.facility_id(), template.summary.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(current.items[0].unit, f.unit);
    assert_eq!(current.items[0].current_unit, "box");
    assert!(current.items[0].requires_unit_review);
    conflict(
        generate_standing_template_run(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            f.run(&template),
        )
        .await,
        StandingTemplateError::UnitChanged,
    );
    conflict(
        update_standing_template(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            UpdateStandingTemplateRequest {
                expected_version: 1,
                template: f.data(),
            },
        )
        .await,
        StandingTemplateError::UnitChanged,
    );
    let mut config = f.data();
    config.items[0].expected_unit = "box".into();
    config.items[0].quantity = 1;
    let reviewed = update_standing_template(
        f.db.pool(),
        f.actor(),
        template.summary.id,
        UpdateStandingTemplateRequest {
            expected_version: 1,
            template: config,
        },
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(reviewed.summary.version, 2);
    assert_eq!(reviewed.items[0].unit, "box");
    assert!(!reviewed.items[0].requires_unit_review);
    let request = generate_standing_template_run(
        f.db.pool(),
        f.actor(),
        template.summary.id,
        f.run(&reviewed),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(request.items[0].unit, "box");
    assert_eq!(request.items[0].quantity_requested, 1);
}

#[tokio::test]
async fn pausing_and_cancelling_remain_possible_after_references_deactivate_and_terminal_is_safe() {
    let f = Fixture::new().await;
    let template = f.create().await;
    sqlx::query("UPDATE inventory_items SET is_active=FALSE WHERE id=$1")
        .bind(f.item)
        .execute(f.db.pool())
        .await
        .unwrap();
    let paused = change_standing_template_status(
        f.db.pool(),
        f.actor(),
        template.summary.id,
        StandingTemplateStatusRequest {
            expected_version: 1,
            status: StandingOrderStatus::Paused,
        },
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(paused.summary.status, StandingOrderStatus::Paused);
    conflict(
        change_standing_template_status(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            StandingTemplateStatusRequest {
                expected_version: 2,
                status: StandingOrderStatus::Active,
            },
        )
        .await,
        StandingTemplateError::ReferencesUnavailable,
    );
    let cancelled = change_standing_template_status(
        f.db.pool(),
        f.actor(),
        template.summary.id,
        StandingTemplateStatusRequest {
            expected_version: 2,
            status: StandingOrderStatus::Cancelled,
        },
    )
    .await
    .unwrap()
    .unwrap();
    conflict(
        change_standing_template_status(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            StandingTemplateStatusRequest {
                expected_version: cancelled.summary.version,
                status: StandingOrderStatus::Active,
            },
        )
        .await,
        StandingTemplateError::Terminal,
    );
    conflict(
        generate_standing_template_run(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            f.run(&cancelled),
        )
        .await,
        StandingTemplateError::Terminal,
    );
}

#[tokio::test]
async fn generation_checks_version_occurrence_future_dates_and_facility_before_persistence() {
    let f = Fixture::new().await;
    let template = f.create().await;
    conflict(
        generate_standing_template_run(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            GenerateStandingTemplateRequest {
                expected_version: 2,
                scheduled_for: template.summary.next_run_on,
            },
        )
        .await,
        StandingTemplateError::VersionConflict,
    );
    conflict(
        generate_standing_template_run(
            f.db.pool(),
            f.actor(),
            template.summary.id,
            GenerateStandingTemplateRequest {
                expected_version: 1,
                scheduled_for: Utc::now().date_naive(),
            },
        )
        .await,
        StandingTemplateError::OccurrenceChanged,
    );
    let mut future = f.data();
    future.next_run_on = Utc::now().date_naive() + Duration::days(1);
    let future = create_standing_template(f.db.pool(), f.actor(), future)
        .await
        .unwrap();
    conflict(
        generate_standing_template_run(f.db.pool(), f.actor(), future.summary.id, f.run(&future))
            .await,
        StandingTemplateError::NotDue,
    );
    let mut foreign = f.actor();
    foreign.facility_id = Uuid::new_v4();
    assert!(generate_standing_template_run(
        f.db.pool(),
        foreign,
        template.summary.id,
        f.run(&template)
    )
    .await
    .unwrap()
    .is_none());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_standing_order_runs")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn generation_audit_failure_rolls_back_lines_request_run_and_next_date() {
    let f = Fixture::new().await;
    let template = f.create().await;
    sqlx::raw_sql("CREATE FUNCTION fail_standing_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='inventory.standing_template.request_generated' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_standing_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_standing_audit();").execute(f.db.pool()).await.unwrap();
    assert!(generate_standing_template_run(
        f.db.pool(),
        f.actor(),
        template.summary.id,
        f.run(&template)
    )
    .await
    .is_err());
    let current = get_standing_template(f.db.pool(), f.db.facility_id(), template.summary.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(current.summary.next_run_on, template.summary.next_run_on);
    assert!(current.summary.last_requisition_id.is_none());
    for table in [
        "stock_requisitions",
        "stock_requisition_items",
        "inventory_standing_order_runs",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(f.db.pool())
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[tokio::test]
async fn line_backed_requests_cannot_use_metadata_fulfill_or_arbitrary_supply_dispense() {
    let f = Fixture::new().await;
    let template = f.create().await;
    let request = generate_standing_template_run(
        f.db.pool(),
        f.actor(),
        template.summary.id,
        f.run(&template),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        fulfill_requisition(f.db.pool(), f.db.facility_id(), request.id)
            .await
            .is_err()
    );
    assert!(dispense_supply_request(
        f.db.pool(),
        f.db.facility_id(),
        request.id,
        vec![SupplyDispenseLine {
            item_id: f.item,
            location_id: f.fulfilling,
            quantity: 1
        }],
        f.db.owner_user_id()
    )
    .await
    .is_err());
    let saved = get_requisition_review(f.db.pool(), f.db.facility_id(), request.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.items[0].quantity_issued, 0);
    assert_eq!(
        saved.status,
        hms_domain::inventory::RequisitionStatus::Requested
    );
    let moves: i64 = sqlx::query_scalar("SELECT count(*) FROM stock_movements")
        .fetch_one(f.db.pool())
        .await
        .unwrap();
    assert_eq!(moves, 0);
}
