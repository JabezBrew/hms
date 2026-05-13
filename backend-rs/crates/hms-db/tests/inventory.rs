use chrono::{Duration, Utc};
use hms_db::inventory::{
    NewGoodsReceivedNote, NewPurchaseOrder, NewStockBatch, NewStockRequisition, StockBatchFilters,
};
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;
use uuid::Uuid;

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
