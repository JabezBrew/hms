use chrono::{Duration, Utc};
use hms_db::inventory::{
    CatalogEditCommand, NewControlledCount, NewControlledMovement, NewGoodsReceivedNote,
    NewPurchaseOrder, NewStandingOrder, NewStockBatch, NewStockRequisition, StockBatchFilters,
    SupplyDispenseLine,
};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::inventory::{
    ControlledDiscrepancyCategory, ControlledMovementType, GoodsReceivedStatus,
    PurchaseOrderStatus, RequisitionStatus, StandingOrderFrequency, StockCheckQueueStatus,
};
use uuid::Uuid;

#[tokio::test]
async fn supplier_list_is_bounded_and_searchable() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");

    let rows = hms_db::inventory::list_suppliers(
        &pool,
        facility_id,
        None,
        1,
        hms_db::inventory::SupplierFilters {
            search: Some("medical".to_owned()),
            is_active: Some(true),
        },
    )
    .await
    .expect("suppliers list");

    assert_eq!(rows.len(), 1);
    assert!(rows[0].name.to_lowercase().contains("medical"));
    assert!(rows[0].is_active);
}

#[tokio::test]
async fn storage_location_list_respects_requested_limit() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");

    let rows = hms_db::inventory::list_locations(&pool, facility_id, None, 1)
        .await
        .expect("storage locations list");

    assert_eq!(rows.len(), 1);
}

#[tokio::test]
async fn stock_batch_lists_can_filter_expired_and_expiring_ranges() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");
    let item_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM inventory_items WHERE facility_id = $1 AND controlled = false ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("normal inventory item exists");
    let location_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM storage_locations WHERE facility_id = $1 ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("storage location exists");

    let today = Utc::now().date_naive();
    let expired = hms_db::inventory::create_batch(
        &pool,
        NewStockBatch {
            id: Uuid::new_v4(),
            facility_id,
            item_id,
            location_id,
            batch_number: "EXP-001".to_owned(),
            expires_on: Some(today - Duration::days(1)),
            quantity_received: 10,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("expired batch creates");
    let expiring = hms_db::inventory::create_batch(
        &pool,
        NewStockBatch {
            id: Uuid::new_v4(),
            facility_id,
            item_id,
            location_id,
            batch_number: "SOON-001".to_owned(),
            expires_on: Some(today + Duration::days(7)),
            quantity_received: 10,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("expiring batch creates");
    let later = hms_db::inventory::create_batch(
        &pool,
        NewStockBatch {
            id: Uuid::new_v4(),
            facility_id,
            item_id,
            location_id,
            batch_number: "LATER-001".to_owned(),
            expires_on: Some(today + Duration::days(60)),
            quantity_received: 10,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("later batch creates");

    let expired_rows = hms_db::inventory::list_batches(
        &pool,
        facility_id,
        None,
        25,
        StockBatchFilters {
            expired: Some(true),
            expiring_within_days: None,
        },
    )
    .await
    .expect("expired batches list");
    assert!(expired_rows.iter().any(|row| row.id == expired.id));
    assert!(!expired_rows.iter().any(|row| row.id == expiring.id));
    assert!(!expired_rows.iter().any(|row| row.id == later.id));

    let expiring_rows = hms_db::inventory::list_batches(
        &pool,
        facility_id,
        None,
        25,
        StockBatchFilters {
            expired: None,
            expiring_within_days: Some(30),
        },
    )
    .await
    .expect("expiring batches list");
    assert!(expiring_rows.iter().any(|row| row.id == expiring.id));
    assert!(!expiring_rows.iter().any(|row| row.id == expired.id));
    assert!(!expiring_rows.iter().any(|row| row.id == later.id));
}

#[tokio::test]
async fn procurement_repositories_manage_purchase_orders_and_grns() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");

    let order = hms_db::inventory::create_purchase_order(
        &pool,
        NewPurchaseOrder {
            id: Uuid::new_v4(),
            facility_id,
            supplier_name: "Procurement Supplier".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("purchase order creates");
    assert!(matches!(order.status, PurchaseOrderStatus::Draft));

    let order_detail = hms_db::inventory::get_purchase_order(&pool, facility_id, order.id)
        .await
        .expect("purchase order detail loads")
        .expect("purchase order exists");
    assert_eq!(order_detail.supplier_name, "Procurement Supplier");
    let listed_orders = hms_db::inventory::list_purchase_orders(&pool, facility_id, None, 25)
        .await
        .expect("purchase orders list");
    assert!(listed_orders.iter().any(|row| row.id == order.id));

    let approved = hms_db::inventory::approve_purchase_order(&pool, facility_id, order.id)
        .await
        .expect("purchase order approval succeeds")
        .expect("purchase order exists");
    assert!(matches!(approved.status, PurchaseOrderStatus::Approved));
    let sent = hms_db::inventory::send_purchase_order(&pool, facility_id, order.id)
        .await
        .expect("purchase order send succeeds")
        .expect("purchase order exists");
    assert!(matches!(sent.status, PurchaseOrderStatus::Sent));

    let grn = hms_db::inventory::create_grn(
        &pool,
        NewGoodsReceivedNote {
            id: Uuid::new_v4(),
            facility_id,
            purchase_order_id: order.id,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("GRN creates");
    assert!(matches!(grn.status, GoodsReceivedStatus::PendingInspection));

    let grn_detail = hms_db::inventory::get_grn(&pool, facility_id, grn.id)
        .await
        .expect("GRN detail loads")
        .expect("GRN exists");
    assert_eq!(grn_detail.purchase_order_id, order.id);
    let listed_grns = hms_db::inventory::list_grns(&pool, facility_id, None, 25)
        .await
        .expect("GRNs list");
    assert!(listed_grns.iter().any(|row| row.id == grn.id));

    let inspected = hms_db::inventory::inspect_grn(&pool, facility_id, grn.id)
        .await
        .expect("GRN inspection succeeds")
        .expect("GRN exists");
    assert!(matches!(inspected.status, GoodsReceivedStatus::Inspecting));
    let accepted = hms_db::inventory::accept_grn(&pool, facility_id, grn.id)
        .await
        .expect("GRN accept succeeds")
        .expect("GRN exists");
    assert!(matches!(accepted.status, GoodsReceivedStatus::Accepted));
}

#[tokio::test]
async fn inventory_dashboard_summary_uses_facility_scoped_aggregates() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");
    let item_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM inventory_items WHERE facility_id = $1 AND is_active = TRUE ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("inventory item exists");
    let location_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM storage_locations WHERE facility_id = $1 ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("storage location exists");

    let before = hms_db::inventory::inventory_dashboard_summary(&pool, facility_id, 30)
        .await
        .expect("baseline dashboard summary aggregates");
    let today = Utc::now().date_naive();
    hms_db::inventory::create_batch(
        &pool,
        NewStockBatch {
            id: Uuid::new_v4(),
            facility_id,
            item_id,
            location_id,
            batch_number: "DASH-SOON-001".to_owned(),
            expires_on: Some(today + Duration::days(7)),
            quantity_received: 10,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("expiring batch creates");
    let empty_batch = hms_db::inventory::create_batch(
        &pool,
        NewStockBatch {
            id: Uuid::new_v4(),
            facility_id,
            item_id,
            location_id,
            batch_number: "DASH-ZERO-001".to_owned(),
            expires_on: None,
            quantity_received: 1,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("zero-stock batch creates");
    sqlx::query("UPDATE stock_batches SET quantity_on_hand = 0 WHERE id = $1")
        .bind(empty_batch.id)
        .execute(&pool)
        .await
        .expect("zero stock adjustment applies");

    let requisition = hms_db::inventory::create_requisition(
        &pool,
        NewStockRequisition {
            id: Uuid::new_v4(),
            facility_id,
            requesting_location_id: location_id,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("requisition creates");
    hms_db::inventory::submit_requisition(&pool, facility_id, requisition.id)
        .await
        .expect("requisition submit succeeds")
        .expect("requisition exists");
    let purchase_order = hms_db::inventory::create_purchase_order(
        &pool,
        NewPurchaseOrder {
            id: Uuid::new_v4(),
            facility_id,
            supplier_name: "Dashboard Supplier".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("purchase order creates");
    hms_db::inventory::create_grn(
        &pool,
        NewGoodsReceivedNote {
            id: Uuid::new_v4(),
            facility_id,
            purchase_order_id: purchase_order.id,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("GRN creates");

    let summary = hms_db::inventory::inventory_dashboard_summary(&pool, facility_id, 30)
        .await
        .expect("dashboard summary aggregates");

    assert_eq!(summary.total_items, before.total_items);
    assert_eq!(summary.low_stock_count, before.low_stock_count + 1);
    assert_eq!(summary.expiring_soon_count, before.expiring_soon_count + 1);
    assert_eq!(summary.expiring_count, before.expiring_count + 1);
    assert_eq!(
        summary.pending_requisitions,
        before.pending_requisitions + 1
    );
    assert_eq!(summary.pending_grns, before.pending_grns + 1);
    assert_eq!(summary.total_stock_value_minor, 0);
    assert_eq!(summary.total_value_minor, 0);
    assert_eq!(summary.discrepancies, 0);
}

#[tokio::test]
async fn controlled_count_logs_discrepancy_audit_and_adjusts_stock_immediately() {
    let db = provisioned_inventory_db().await;
    let pool = db.pool();
    let facility_id = db.facility_id();
    let owner_id = db.owner_user_id();
    let item_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM inventory_items WHERE facility_id = $1 AND controlled = true ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(pool)
    .await
    .expect("controlled item exists");
    let location_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM storage_locations WHERE facility_id = $1 AND code = 'PHARM'",
    )
    .bind(facility_id)
    .fetch_one(pool)
    .await
    .expect("pharmacy location exists");

    let receipt = hms_db::inventory::create_controlled_movement(
        pool,
        NewControlledMovement {
            id: Uuid::new_v4(),
            facility_id,
            item_id,
            location_id,
            movement_type: ControlledMovementType::Receipt,
            quantity_delta: 10,
            witness_user_id: Some(owner_id),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("controlled receipt creates stock");

    let stock_after_receipt =
        hms_db::inventory::list_item_stock_by_location(&pool, facility_id, item_id)
            .await
            .expect("controlled stock lists");
    assert!(stock_after_receipt
        .iter()
        .any(|row| row.location_id == location_id && row.quantity_on_hand == 10));

    let count = hms_db::inventory::create_controlled_count(
        pool,
        NewControlledCount {
            id: Uuid::new_v4(),
            facility_id,
            register_entry_id: receipt.id,
            actual_count: 8,
            witness_user_id: owner_id,
            actor_user_id: owner_id,
            category: ControlledDiscrepancyCategory::Missing,
            reason: "Sealed count found two ampoules missing".to_owned(),
        },
    )
    .await
    .expect("controlled count logs discrepancy");

    assert_eq!(count.movement_type, ControlledMovementType::Count);
    assert_eq!(count.quantity_delta, -2);
    assert_eq!(count.current_balance, 8);
    assert_eq!(count.discrepancy_count, 1);

    let stock_after_count =
        hms_db::inventory::list_item_stock_by_location(pool, facility_id, item_id)
            .await
            .expect("controlled stock lists after count");
    assert!(stock_after_count
        .iter()
        .any(|row| row.location_id == location_id && row.quantity_on_hand == 8));

    let discrepancy = hms_db::inventory::list_controlled_discrepancies(pool, facility_id, None, 10)
        .await
        .expect("discrepancies list");
    assert_eq!(discrepancy.len(), 1);
    assert_eq!(discrepancy[0].register_entry_id, count.id);
    assert_eq!(
        discrepancy[0].category,
        ControlledDiscrepancyCategory::Missing
    );
    assert_eq!(discrepancy[0].expected_balance, 10);
    assert_eq!(discrepancy[0].actual_count, 8);
    assert_eq!(discrepancy[0].severity, "high");

    let audit_metadata = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT metadata FROM audit_events
         WHERE facility_id = $1
           AND event_type = 'controlled_substance.discrepancy.logged'
           AND resource_id = $2
         LIMIT 1",
    )
    .bind(facility_id)
    .bind(discrepancy[0].id)
    .fetch_one(pool)
    .await
    .expect("high-severity discrepancy audit exists");
    assert_eq!(audit_metadata["severity"], "high");
    assert_eq!(audit_metadata["category"], "missing");
}

#[tokio::test]
async fn effective_dated_catalog_edit_records_version_updates_item_and_audits() {
    let db = provisioned_inventory_db().await;
    let pool = db.pool();
    let facility_id = db.facility_id();
    let owner_id = db.owner_user_id();
    let item_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM inventory_items WHERE facility_id = $1 AND controlled = false ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(pool)
    .await
    .expect("inventory item exists");

    let version = hms_db::inventory::apply_catalog_edit(
        pool,
        CatalogEditCommand {
            id: Uuid::new_v4(),
            facility_id,
            item_id,
            effective_from: Utc::now().date_naive(),
            code: "PARA500".to_owned(),
            name: "Paracetamol 500mg tablet - formulary preferred".to_owned(),
            unit: "tablet".to_owned(),
            reason: "Formulary catalog parity edit".to_owned(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("catalog edit applies");

    assert_eq!(version.item_id, item_id);
    assert_eq!(version.effective_to, None);
    assert_eq!(
        version.name,
        "Paracetamol 500mg tablet - formulary preferred"
    );

    let item = hms_db::inventory::get_item(pool, facility_id, item_id)
        .await
        .expect("item loads")
        .expect("item exists");
    assert_eq!(item.name, "Paracetamol 500mg tablet - formulary preferred");

    let audit_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM audit_events
         WHERE facility_id = $1
           AND event_type = 'inventory.catalog.edited'
           AND resource_id = $2
           AND metadata->>'severity' = 'high'",
    )
    .bind(facility_id)
    .bind(item_id)
    .fetch_one(pool)
    .await
    .expect("audit count loads");
    assert_eq!(audit_count, 1);
}

#[tokio::test]
async fn standing_orders_supply_dispense_and_stock_check_queue_have_explicit_states() {
    let db = provisioned_inventory_db().await;
    let pool = db.pool();
    let facility_id = db.facility_id();
    let owner_id = db.owner_user_id();
    let item_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM inventory_items WHERE facility_id = $1 AND controlled = false ORDER BY code LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(pool)
    .await
    .expect("inventory item exists");
    let location_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM storage_locations WHERE facility_id = $1 AND code = 'PHARM'",
    )
    .bind(facility_id)
    .fetch_one(pool)
    .await
    .expect("pharmacy location exists");

    hms_db::inventory::create_batch(
        pool,
        NewStockBatch {
            id: Uuid::new_v4(),
            facility_id,
            item_id,
            location_id,
            batch_number: "SUPPLY-001".to_owned(),
            expires_on: None,
            quantity_received: 25,
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("stock batch creates");

    let standing_order = hms_db::inventory::create_standing_order(
        pool,
        NewStandingOrder {
            id: Uuid::new_v4(),
            facility_id,
            requesting_location_id: location_id,
            frequency: StandingOrderFrequency::Weekly,
            next_run_on: Utc::now().date_naive(),
            actor_user_id: owner_id,
        },
    )
    .await
    .expect("standing order creates");

    let draft = hms_db::inventory::generate_draft_requisition_from_standing_order(
        pool,
        facility_id,
        standing_order.id,
        owner_id,
    )
    .await
    .expect("standing order generates draft requisition");
    assert_eq!(draft.status, RequisitionStatus::Requested);
    assert_eq!(draft.requesting_location_id, location_id);

    let dispense = hms_db::inventory::dispense_supply_request(
        pool,
        facility_id,
        draft.id,
        vec![SupplyDispenseLine {
            item_id,
            location_id,
            quantity: 4,
        }],
        owner_id,
    )
    .await
    .expect("supply request dispenses");
    assert_eq!(dispense.status, "dispensed");
    assert_eq!(dispense.line_count, 1);

    let stock_after_dispense =
        hms_db::inventory::list_item_stock_by_location(pool, facility_id, item_id)
            .await
            .expect("stock lists");
    assert!(stock_after_dispense
        .iter()
        .any(|row| row.location_id == location_id && row.quantity_on_hand == 21));

    let queue = hms_db::inventory::enqueue_stock_check(
        pool,
        facility_id,
        location_id,
        "Weekly cycle count".to_owned(),
        owner_id,
    )
    .await
    .expect("stock check queues");
    assert_eq!(queue.status, StockCheckQueueStatus::Queued);

    let in_progress = hms_db::inventory::transition_stock_check(
        pool,
        facility_id,
        queue.id,
        StockCheckQueueStatus::InProgress,
        owner_id,
    )
    .await
    .expect("stock check starts")
    .expect("stock check exists");
    assert_eq!(in_progress.status, StockCheckQueueStatus::InProgress);

    let completed = hms_db::inventory::transition_stock_check(
        pool,
        facility_id,
        queue.id,
        StockCheckQueueStatus::Completed,
        owner_id,
    )
    .await
    .expect("stock check completes")
    .expect("stock check exists");
    assert_eq!(completed.status, StockCheckQueueStatus::Completed);
}

async fn provisioned_inventory_db() -> hms_db::test_support::TestDb {
    hms_db::test_support::TestDb::hospital()
        .await
        .expect("test database provisions")
}
