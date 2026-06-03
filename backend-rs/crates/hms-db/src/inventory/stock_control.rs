use chrono::{DateTime, Utc};
use hms_domain::inventory::{
    InventoryItemStockLocationItem, RequisitionStatus, StandingOrderListItem, StandingOrderStatus,
    StockBatchListItem, StockCheckQueueItem, StockCheckQueueStatus, StockMovementListItem,
    StockMovementType, StockRequisitionListItem, StockTransferListItem, StorageLocationStockItem,
    SupplyRequestDispenseResult, TransferStatus,
};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use super::{
    apply_cursor, apply_stock_delta_tx, insert_movement, InventoryCursor, NewStandingOrder,
    NewStockBatch, NewStockRequisition, NewStockTransfer, StandingOrderFilters, StockBatchFilters,
    StockRequisitionFilters, StockTransferFilters, SupplyDispenseLine,
};
use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug, FromRow)]
struct BatchRow {
    id: Uuid,
    item_id: Uuid,
    item_name: String,
    location_id: Uuid,
    location_name: String,
    batch_number: String,
    expires_on: Option<chrono::NaiveDate>,
    quantity_on_hand: i64,
    received_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct MovementRow {
    id: Uuid,
    item_id: Uuid,
    item_name: String,
    location_id: Uuid,
    movement_type: String,
    quantity: i64,
    balance_after: i64,
    reason: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct TransferRow {
    id: Uuid,
    item_id: Uuid,
    item_name: String,
    from_location_id: Uuid,
    to_location_id: Uuid,
    quantity: i64,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct RequisitionRow {
    id: Uuid,
    requesting_location_id: Uuid,
    requesting_location_name: String,
    status: String,
    priority: String,
    rejection_reason: Option<String>,
    rejected_at: Option<DateTime<Utc>>,
    cancelled_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct LocationStockRow {
    item_id: Uuid,
    location_id: Uuid,
    location_name: String,
    quantity_on_hand: i64,
}

#[derive(Clone, Debug, FromRow)]
struct StorageLocationStockRow {
    item_id: Uuid,
    item_name: String,
    location_id: Uuid,
    location_name: String,
    quantity_on_hand: i64,
    batch_count: i64,
    earliest_expiry: Option<chrono::NaiveDate>,
    last_received_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct StandingOrderRow {
    id: Uuid,
    requesting_location_id: Uuid,
    requesting_location_name: String,
    frequency: String,
    status: String,
    next_run_on: chrono::NaiveDate,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct SupplyDispenseRow {
    id: Uuid,
    requisition_id: Uuid,
    status: String,
    line_count: i64,
    dispensed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct StockCheckQueueRow {
    id: Uuid,
    location_id: Uuid,
    status: String,
    reason: String,
    created_at: DateTime<Utc>,
}

pub async fn list_storage_location_stock(
    pool: &PgPool,
    facility_id: Uuid,
    location_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<StorageLocationStockItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT stock_batches.item_id,
               inventory_items.name AS item_name,
               stock_batches.location_id,
               storage_locations.name AS location_name,
               COALESCE(SUM(stock_batches.quantity_on_hand), 0)::BIGINT AS quantity_on_hand,
               COUNT(stock_batches.id)::BIGINT AS batch_count,
               MIN(stock_batches.expires_on) AS earliest_expiry,
               MAX(stock_batches.received_at) AS last_received_at
        FROM stock_batches
        INNER JOIN inventory_items ON inventory_items.id = stock_batches.item_id
        INNER JOIN storage_locations ON storage_locations.id = stock_batches.location_id
        WHERE stock_batches.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND stock_batches.location_id = ");
    query.push_bind(location_id);
    query.push(" AND inventory_items.is_active = TRUE");
    query.push(" AND storage_locations.is_active = TRUE");
    query.push(
        r#"
        GROUP BY stock_batches.item_id,
                 inventory_items.name,
                 stock_batches.location_id,
                 storage_locations.name
        HAVING COALESCE(SUM(stock_batches.quantity_on_hand), 0) > 0
        "#,
    );
    if let Some(cursor) = cursor {
        query.push(" AND (MAX(stock_batches.received_at), stock_batches.item_id) < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY last_received_at DESC, stock_batches.item_id DESC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<StorageLocationStockRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(storage_location_stock_from_row)
        .collect())
}

pub async fn list_batches(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    filters: StockBatchFilters,
) -> anyhow::Result<Vec<StockBatchListItem>> {
    let mut query = batch_query();
    query.push(" WHERE stock_batches.facility_id = ");
    query.push_bind(facility_id);
    apply_batch_filters(&mut query, &filters);
    apply_cursor(
        &mut query,
        "stock_batches.received_at",
        "stock_batches.id",
        cursor,
    );
    query.push(" ORDER BY stock_batches.received_at DESC, stock_batches.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<BatchRow>().fetch_all(pool).await?;
    Ok(rows.into_iter().map(batch_from_row).collect())
}

pub async fn list_item_batches(
    pool: &PgPool,
    facility_id: Uuid,
    item_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<StockBatchListItem>> {
    let mut query = batch_query();
    query.push(" WHERE stock_batches.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND stock_batches.item_id = ");
    query.push_bind(item_id);
    apply_cursor(
        &mut query,
        "stock_batches.received_at",
        "stock_batches.id",
        cursor,
    );
    query.push(" ORDER BY stock_batches.received_at DESC, stock_batches.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<BatchRow>().fetch_all(pool).await?;
    Ok(rows.into_iter().map(batch_from_row).collect())
}

pub async fn create_batch(
    pool: &PgPool,
    batch: NewStockBatch,
) -> anyhow::Result<StockBatchListItem> {
    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO stock_batches (
            id, facility_id, item_id, location_id, batch_number, expires_on, quantity_on_hand
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(batch.id)
    .bind(batch.facility_id)
    .bind(batch.item_id)
    .bind(batch.location_id)
    .bind(&batch.batch_number)
    .bind(batch.expires_on)
    .bind(batch.quantity_received)
    .execute(&mut *transaction)
    .await?;

    insert_movement(
        &mut transaction,
        batch.facility_id,
        batch.item_id,
        Some(batch.id),
        batch.location_id,
        StockMovementType::Receipt,
        batch.quantity_received,
        batch.quantity_received,
        "stock_receipt",
        batch.actor_user_id,
    )
    .await?;

    transaction.commit().await?;
    fetch_batch_by_id(pool, batch.facility_id, batch.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created stock batch was not found"))
}

pub async fn list_movements(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<StockMovementListItem>> {
    let mut query = movement_query();
    query.push(" WHERE stock_movements.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(
        &mut query,
        "stock_movements.created_at",
        "stock_movements.id",
        cursor,
    );
    query.push(" ORDER BY stock_movements.created_at DESC, stock_movements.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<MovementRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(movement_from_row).collect()
}

pub async fn list_item_movements(
    pool: &PgPool,
    facility_id: Uuid,
    item_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<StockMovementListItem>> {
    let mut query = movement_query();
    query.push(" WHERE stock_movements.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND stock_movements.item_id = ");
    query.push_bind(item_id);
    apply_cursor(
        &mut query,
        "stock_movements.created_at",
        "stock_movements.id",
        cursor,
    );
    query.push(" ORDER BY stock_movements.created_at DESC, stock_movements.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<MovementRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(movement_from_row).collect()
}

pub async fn list_item_stock_by_location(
    pool: &PgPool,
    facility_id: Uuid,
    item_id: Uuid,
) -> anyhow::Result<Vec<InventoryItemStockLocationItem>> {
    let rows = sqlx::query_as::<_, LocationStockRow>(
        r#"
        SELECT stock_batches.item_id,
               stock_batches.location_id,
               storage_locations.name AS location_name,
               COALESCE(SUM(stock_batches.quantity_on_hand), 0)::BIGINT AS quantity_on_hand
        FROM stock_batches
        INNER JOIN storage_locations ON storage_locations.id = stock_batches.location_id
        WHERE stock_batches.facility_id = $1
          AND stock_batches.item_id = $2
        GROUP BY stock_batches.item_id, stock_batches.location_id, storage_locations.name
        ORDER BY storage_locations.name ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .bind(item_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(location_stock_from_row).collect())
}

pub async fn list_transfers(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    filters: StockTransferFilters,
) -> anyhow::Result<Vec<StockTransferListItem>> {
    let mut query = transfer_query();
    query.push(" WHERE stock_transfers.facility_id = ");
    query.push_bind(facility_id);
    if let Some(status) = filters.status {
        query.push(" AND stock_transfers.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(from_location_id) = filters.from_location_id {
        query.push(" AND stock_transfers.from_location_id = ");
        query.push_bind(from_location_id);
    }
    if let Some(to_location_id) = filters.to_location_id {
        query.push(" AND stock_transfers.to_location_id = ");
        query.push_bind(to_location_id);
    }
    if let Some(pattern) = lower_like_contains_pattern(filters.search.as_deref()) {
        let search_id = uuid_search(filters.search.as_deref());
        query.push(" AND (LOWER(inventory_items.name) LIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR LOWER(inventory_items.code) LIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\'");
        if let Some(search_id) = search_id {
            query.push(" OR stock_transfers.id = ");
            query.push_bind(search_id);
        }
        query.push(")");
    }
    apply_cursor(
        &mut query,
        "stock_transfers.created_at",
        "stock_transfers.id",
        cursor,
    );
    query.push(" ORDER BY stock_transfers.created_at DESC, stock_transfers.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<TransferRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(transfer_from_row).collect()
}

pub async fn get_transfer(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<StockTransferListItem>> {
    fetch_transfer_by_id(pool, facility_id, id).await
}

pub async fn create_transfer(
    pool: &PgPool,
    transfer: NewStockTransfer,
) -> anyhow::Result<StockTransferListItem> {
    sqlx::query(
        r#"
        INSERT INTO stock_transfers (
            id, facility_id, item_id, from_location_id, to_location_id, quantity, status, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(transfer.id)
    .bind(transfer.facility_id)
    .bind(transfer.item_id)
    .bind(transfer.from_location_id)
    .bind(transfer.to_location_id)
    .bind(transfer.quantity)
    .bind(codec::encode(TransferStatus::Requested)?)
    .bind(transfer.actor_user_id)
    .execute(pool)
    .await?;
    fetch_transfer_by_id(pool, transfer.facility_id, transfer.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created transfer was not found"))
}

pub async fn list_requisitions(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    filters: StockRequisitionFilters,
) -> anyhow::Result<Vec<StockRequisitionListItem>> {
    let mut query = requisition_query();
    query.push(" WHERE stock_requisitions.facility_id = ");
    query.push_bind(facility_id);
    if let Some(status) = filters.status {
        query.push(" AND stock_requisitions.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(requesting_location_id) = filters.requesting_location_id {
        query.push(" AND stock_requisitions.requesting_location_id = ");
        query.push_bind(requesting_location_id);
    }
    if let Some(priority) = filters
        .priority
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        query.push(" AND stock_requisitions.priority = ");
        query.push_bind(priority.to_owned());
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        let search_id = uuid_search(filters.search.as_deref());
        query.push(" AND (storage_locations.name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR storage_locations.code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\'");
        if let Some(search_id) = search_id {
            query.push(" OR stock_requisitions.id = ");
            query.push_bind(search_id);
        }
        query.push(")");
    }
    apply_cursor(
        &mut query,
        "stock_requisitions.created_at",
        "stock_requisitions.id",
        cursor,
    );
    query.push(" ORDER BY stock_requisitions.created_at DESC, stock_requisitions.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<RequisitionRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(requisition_from_row).collect()
}

pub async fn list_standing_orders(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    filters: StandingOrderFilters,
) -> anyhow::Result<Vec<StandingOrderListItem>> {
    let mut query = standing_order_query();
    query.push(" WHERE inventory_standing_orders.facility_id = ");
    query.push_bind(facility_id);
    if let Some(status) = filters.status {
        query.push(" AND inventory_standing_orders.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(is_active) = filters.is_active {
        query.push(" AND inventory_standing_orders.status ");
        if is_active {
            query.push("= ");
            query.push_bind(codec::encode(StandingOrderStatus::Active)?);
        } else {
            query.push("<> ");
            query.push_bind(codec::encode(StandingOrderStatus::Active)?);
        }
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        let search_id = uuid_search(filters.search.as_deref());
        query.push(" AND (storage_locations.name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR storage_locations.code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\'");
        if let Some(search_id) = search_id {
            query.push(" OR inventory_standing_orders.id = ");
            query.push_bind(search_id);
        }
        query.push(")");
    }
    apply_cursor(
        &mut query,
        "inventory_standing_orders.created_at",
        "inventory_standing_orders.id",
        cursor,
    );
    query.push(
        " ORDER BY inventory_standing_orders.created_at DESC, inventory_standing_orders.id DESC LIMIT ",
    );
    query.push_bind(limit);
    let rows = query
        .build_query_as::<StandingOrderRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(standing_order_from_row).collect()
}

pub async fn get_requisition(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<StockRequisitionListItem>> {
    fetch_requisition_by_id(pool, facility_id, id).await
}

pub async fn create_requisition(
    pool: &PgPool,
    requisition: NewStockRequisition,
) -> anyhow::Result<StockRequisitionListItem> {
    sqlx::query(
        r#"
        INSERT INTO stock_requisitions (
            id, facility_id, requesting_location_id, status, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(requisition.id)
    .bind(requisition.facility_id)
    .bind(requisition.requesting_location_id)
    .bind(codec::encode(RequisitionStatus::Requested)?)
    .bind(requisition.actor_user_id)
    .execute(pool)
    .await?;
    fetch_requisition_by_id(pool, requisition.facility_id, requisition.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created requisition was not found"))
}

pub async fn submit_requisition(
    pool: &PgPool,
    facility_id: Uuid,
    requisition_id: Uuid,
) -> anyhow::Result<Option<StockRequisitionListItem>> {
    transition_requisition_status(
        pool,
        facility_id,
        requisition_id,
        &[RequisitionStatus::Requested, RequisitionStatus::Pending],
        RequisitionStatus::Pending,
    )
    .await
}

pub async fn approve_requisition(
    pool: &PgPool,
    facility_id: Uuid,
    requisition_id: Uuid,
) -> anyhow::Result<Option<StockRequisitionListItem>> {
    transition_requisition_status(
        pool,
        facility_id,
        requisition_id,
        &[
            RequisitionStatus::Requested,
            RequisitionStatus::Pending,
            RequisitionStatus::Approved,
        ],
        RequisitionStatus::Approved,
    )
    .await
}

pub async fn fulfill_requisition(
    pool: &PgPool,
    facility_id: Uuid,
    requisition_id: Uuid,
) -> anyhow::Result<Option<StockRequisitionListItem>> {
    transition_requisition_status(
        pool,
        facility_id,
        requisition_id,
        &[RequisitionStatus::Approved, RequisitionStatus::Fulfilled],
        RequisitionStatus::Fulfilled,
    )
    .await
}

pub async fn reject_requisition(
    pool: &PgPool,
    facility_id: Uuid,
    requisition_id: Uuid,
    reason: String,
) -> anyhow::Result<Option<StockRequisitionListItem>> {
    sqlx::query(
        r#"
        UPDATE stock_requisitions
        SET status = $1,
            rejection_reason = $2,
            rejected_at = now(),
            cancelled_at = NULL
        WHERE facility_id = $3
          AND id = $4
          AND status = ANY($5)
        "#,
    )
    .bind(codec::encode(RequisitionStatus::Rejected)?)
    .bind(reason)
    .bind(facility_id)
    .bind(requisition_id)
    .bind(codec::encode_slice(&[
        RequisitionStatus::Requested,
        RequisitionStatus::Pending,
    ])?)
    .execute(pool)
    .await?;
    fetch_requisition_by_id(pool, facility_id, requisition_id).await
}

pub async fn cancel_requisition(
    pool: &PgPool,
    facility_id: Uuid,
    requisition_id: Uuid,
) -> anyhow::Result<Option<StockRequisitionListItem>> {
    sqlx::query(
        r#"
        UPDATE stock_requisitions
        SET status = $1,
            cancelled_at = now()
        WHERE facility_id = $2
          AND id = $3
          AND status = ANY($4)
        "#,
    )
    .bind(codec::encode(RequisitionStatus::Cancelled)?)
    .bind(facility_id)
    .bind(requisition_id)
    .bind(codec::encode_slice(&[
        RequisitionStatus::Requested,
        RequisitionStatus::Pending,
        RequisitionStatus::Approved,
        RequisitionStatus::Cancelled,
    ])?)
    .execute(pool)
    .await?;
    fetch_requisition_by_id(pool, facility_id, requisition_id).await
}

pub async fn create_standing_order(
    pool: &PgPool,
    standing_order: NewStandingOrder,
) -> anyhow::Result<StandingOrderListItem> {
    sqlx::query(
        r#"
        INSERT INTO inventory_standing_orders (
            id, facility_id, requesting_location_id, frequency, status, next_run_on, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(standing_order.id)
    .bind(standing_order.facility_id)
    .bind(standing_order.requesting_location_id)
    .bind(codec::encode(standing_order.frequency)?)
    .bind(codec::encode(StandingOrderStatus::Active)?)
    .bind(standing_order.next_run_on)
    .bind(standing_order.actor_user_id)
    .execute(pool)
    .await?;
    fetch_standing_order_by_id(pool, standing_order.facility_id, standing_order.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created standing order was not found"))
}

pub async fn generate_draft_requisition_from_standing_order(
    pool: &PgPool,
    facility_id: Uuid,
    standing_order_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<StockRequisitionListItem> {
    let standing_order = fetch_standing_order_by_id(pool, facility_id, standing_order_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("standing order was not found"))?;
    if standing_order.status != StandingOrderStatus::Active {
        anyhow::bail!("standing order must be active");
    }
    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO stock_requisitions (
            id, facility_id, requesting_location_id, status, created_by_user_id, source_type, source_id
        )
        VALUES ($1, $2, $3, $4, $5, 'standing_order', $6)
        "#,
    )
    .bind(id)
    .bind(facility_id)
    .bind(standing_order.requesting_location_id)
    .bind(codec::encode(RequisitionStatus::Requested)?)
    .bind(actor_user_id)
    .bind(standing_order_id)
    .execute(pool)
    .await?;
    fetch_requisition_by_id(pool, facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("generated requisition was not found"))
}

pub async fn dispense_supply_request(
    pool: &PgPool,
    facility_id: Uuid,
    requisition_id: Uuid,
    lines: Vec<SupplyDispenseLine>,
    actor_user_id: Uuid,
) -> anyhow::Result<SupplyRequestDispenseResult> {
    if lines.is_empty() {
        anyhow::bail!("at least one supply dispense line is required");
    }
    let mut tx = pool.begin().await?;
    let status = sqlx::query_scalar::<_, String>(
        "SELECT status FROM stock_requisitions WHERE facility_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(facility_id)
    .bind(requisition_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| anyhow::anyhow!("requisition was not found"))?;
    let status: RequisitionStatus = codec::decode(&status)?;
    if !matches!(
        status,
        RequisitionStatus::Requested
            | RequisitionStatus::Pending
            | RequisitionStatus::Approved
            | RequisitionStatus::Fulfilled
    ) {
        anyhow::bail!("requisition cannot be dispensed from its current state");
    }
    for line in &lines {
        if line.quantity <= 0 {
            anyhow::bail!("supply dispense quantity must be positive");
        }
        apply_stock_delta_tx(
            &mut tx,
            facility_id,
            line.item_id,
            line.location_id,
            -line.quantity,
            "supply_request_dispense",
            actor_user_id,
        )
        .await?;
    }
    sqlx::query("UPDATE stock_requisitions SET status = $3 WHERE facility_id = $1 AND id = $2")
        .bind(facility_id)
        .bind(requisition_id)
        .bind(codec::encode(RequisitionStatus::Fulfilled)?)
        .execute(&mut *tx)
        .await?;

    let dispense_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO supply_request_dispenses (
            id, facility_id, requisition_id, status, line_count, dispensed_by_user_id
        )
        VALUES ($1, $2, $3, 'dispensed', $4, $5)
        "#,
    )
    .bind(dispense_id)
    .bind(facility_id)
    .bind(requisition_id)
    .bind(lines.len() as i64)
    .bind(actor_user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    fetch_supply_dispense_by_id(pool, facility_id, dispense_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created supply dispense was not found"))
}

pub async fn enqueue_stock_check(
    pool: &PgPool,
    facility_id: Uuid,
    location_id: Uuid,
    reason: String,
    actor_user_id: Uuid,
) -> anyhow::Result<StockCheckQueueItem> {
    if reason.trim().is_empty() {
        anyhow::bail!("stock check reason is required");
    }
    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO stock_check_queue (
            id, facility_id, location_id, status, reason, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(id)
    .bind(facility_id)
    .bind(location_id)
    .bind(codec::encode(StockCheckQueueStatus::Queued)?)
    .bind(reason.trim())
    .bind(actor_user_id)
    .execute(pool)
    .await?;
    fetch_stock_check_by_id(pool, facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created stock check was not found"))
}

pub async fn transition_stock_check(
    pool: &PgPool,
    facility_id: Uuid,
    stock_check_id: Uuid,
    target_status: StockCheckQueueStatus,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<StockCheckQueueItem>> {
    match target_status {
        StockCheckQueueStatus::Queued => {
            anyhow::bail!("stock check cannot transition back to queued")
        }
        StockCheckQueueStatus::InProgress => {
            sqlx::query(
                "UPDATE stock_check_queue
                 SET status = $4, started_by_user_id = $5, started_at = now()
                 WHERE facility_id = $1 AND id = $2 AND status = $3",
            )
            .bind(facility_id)
            .bind(stock_check_id)
            .bind(codec::encode(StockCheckQueueStatus::Queued)?)
            .bind(codec::encode(target_status)?)
            .bind(actor_user_id)
            .execute(pool)
            .await?;
        }
        StockCheckQueueStatus::Completed => {
            sqlx::query(
                "UPDATE stock_check_queue
                 SET status = $4, completed_by_user_id = $5, completed_at = now()
                 WHERE facility_id = $1 AND id = $2 AND status = $3",
            )
            .bind(facility_id)
            .bind(stock_check_id)
            .bind(codec::encode(StockCheckQueueStatus::InProgress)?)
            .bind(codec::encode(target_status)?)
            .bind(actor_user_id)
            .execute(pool)
            .await?;
        }
        StockCheckQueueStatus::Cancelled => {
            sqlx::query(
                "UPDATE stock_check_queue
                 SET status = $4, cancelled_by_user_id = $5, cancelled_at = now()
                 WHERE facility_id = $1 AND id = $2 AND status = ANY($3)",
            )
            .bind(facility_id)
            .bind(stock_check_id)
            .bind(codec::encode_slice(&[
                StockCheckQueueStatus::Queued,
                StockCheckQueueStatus::InProgress,
            ])?)
            .bind(codec::encode(target_status)?)
            .bind(actor_user_id)
            .execute(pool)
            .await?;
        }
    }
    fetch_stock_check_by_id(pool, facility_id, stock_check_id).await
}

fn apply_batch_filters(query: &mut QueryBuilder<Postgres>, filters: &StockBatchFilters) {
    if filters.expired == Some(true) {
        query.push(
            " AND stock_batches.expires_on IS NOT NULL \
             AND stock_batches.expires_on < CURRENT_DATE",
        );
        return;
    }

    if let Some(days) = filters.expiring_within_days.filter(|days| *days >= 0) {
        query.push(
            " AND stock_batches.expires_on IS NOT NULL \
             AND stock_batches.expires_on >= CURRENT_DATE \
             AND stock_batches.expires_on <= CURRENT_DATE + (",
        );
        query.push_bind(days);
        query.push(" * INTERVAL '1 day')");
    }
}

async fn fetch_batch_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<StockBatchListItem>> {
    let mut query = batch_query();
    query.push(" WHERE stock_batches.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND stock_batches.id = ");
    query.push_bind(id);
    query
        .build_query_as::<BatchRow>()
        .fetch_optional(pool)
        .await?
        .map(Ok::<_, anyhow::Error>)
        .transpose()
        .map(|row| row.map(batch_from_row))
}

async fn fetch_transfer_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<StockTransferListItem>> {
    let mut query = transfer_query();
    query.push(" WHERE stock_transfers.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND stock_transfers.id = ");
    query.push_bind(id);
    query
        .build_query_as::<TransferRow>()
        .fetch_optional(pool)
        .await?
        .map(transfer_from_row)
        .transpose()
}

async fn fetch_requisition_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<StockRequisitionListItem>> {
    let mut query = requisition_query();
    query.push(" WHERE stock_requisitions.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND stock_requisitions.id = ");
    query.push_bind(id);
    query
        .build_query_as::<RequisitionRow>()
        .fetch_optional(pool)
        .await?
        .map(requisition_from_row)
        .transpose()
}

async fn fetch_standing_order_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<StandingOrderListItem>> {
    let mut query = standing_order_query();
    query.push(" WHERE inventory_standing_orders.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND inventory_standing_orders.id = ");
    query.push_bind(id);
    query.push(" LIMIT 1");
    query
        .build_query_as::<StandingOrderRow>()
        .fetch_optional(pool)
        .await?
        .map(standing_order_from_row)
        .transpose()
}

async fn fetch_supply_dispense_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<SupplyRequestDispenseResult>> {
    let row = sqlx::query_as::<_, SupplyDispenseRow>(
        r#"
        SELECT id, requisition_id, status, line_count, dispensed_at
        FROM supply_request_dispenses
        WHERE facility_id = $1 AND id = $2
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(supply_dispense_from_row))
}

async fn fetch_stock_check_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<StockCheckQueueItem>> {
    sqlx::query_as::<_, StockCheckQueueRow>(
        r#"
        SELECT id, location_id, status, reason, created_at
        FROM stock_check_queue
        WHERE facility_id = $1 AND id = $2
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .map(stock_check_from_row)
    .transpose()
}

async fn transition_requisition_status(
    pool: &PgPool,
    facility_id: Uuid,
    requisition_id: Uuid,
    allowed_statuses: &[RequisitionStatus],
    target_status: RequisitionStatus,
) -> anyhow::Result<Option<StockRequisitionListItem>> {
    let allowed = codec::encode_slice(allowed_statuses)?;
    let target = codec::encode(target_status)?;
    sqlx::query(
        r#"
        UPDATE stock_requisitions
        SET status = $4
        WHERE facility_id = $1
          AND id = $2
          AND status = ANY($3)
        "#,
    )
    .bind(facility_id)
    .bind(requisition_id)
    .bind(allowed)
    .bind(target)
    .execute(pool)
    .await?;
    fetch_requisition_by_id(pool, facility_id, requisition_id).await
}

fn batch_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT stock_batches.id,
               stock_batches.item_id,
               inventory_items.name AS item_name,
               stock_batches.location_id,
               storage_locations.name AS location_name,
               stock_batches.batch_number,
               stock_batches.expires_on,
               stock_batches.quantity_on_hand,
               stock_batches.received_at
        FROM stock_batches
        INNER JOIN inventory_items ON inventory_items.id = stock_batches.item_id
        INNER JOIN storage_locations ON storage_locations.id = stock_batches.location_id
        "#,
    )
}

fn movement_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT stock_movements.id,
               stock_movements.item_id,
               inventory_items.name AS item_name,
               stock_movements.location_id,
               stock_movements.movement_type,
               stock_movements.quantity,
               stock_movements.balance_after,
               stock_movements.reason,
               stock_movements.created_at
        FROM stock_movements
        INNER JOIN inventory_items ON inventory_items.id = stock_movements.item_id
        "#,
    )
}

fn transfer_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT stock_transfers.id,
               stock_transfers.item_id,
               inventory_items.name AS item_name,
               stock_transfers.from_location_id,
               stock_transfers.to_location_id,
               stock_transfers.quantity,
               stock_transfers.status,
               stock_transfers.created_at
        FROM stock_transfers
        INNER JOIN inventory_items
            ON inventory_items.id = stock_transfers.item_id
           AND inventory_items.facility_id = stock_transfers.facility_id
        "#,
    )
}

fn requisition_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT stock_requisitions.id,
               stock_requisitions.requesting_location_id,
               storage_locations.name AS requesting_location_name,
               stock_requisitions.status,
               stock_requisitions.priority,
               stock_requisitions.rejection_reason,
               stock_requisitions.rejected_at,
               stock_requisitions.cancelled_at,
               stock_requisitions.created_at
        FROM stock_requisitions
        INNER JOIN storage_locations
            ON storage_locations.id = stock_requisitions.requesting_location_id
           AND storage_locations.facility_id = stock_requisitions.facility_id
        "#,
    )
}

fn standing_order_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT inventory_standing_orders.id,
               inventory_standing_orders.requesting_location_id,
               storage_locations.name AS requesting_location_name,
               inventory_standing_orders.frequency,
               inventory_standing_orders.status,
               inventory_standing_orders.next_run_on,
               inventory_standing_orders.created_at
        FROM inventory_standing_orders
        INNER JOIN storage_locations
            ON storage_locations.id = inventory_standing_orders.requesting_location_id
           AND storage_locations.facility_id = inventory_standing_orders.facility_id
        "#,
    )
}

fn like_contains_pattern(search: Option<&str>) -> Option<String> {
    let search = search?.trim();
    if search.is_empty() {
        return None;
    }
    let mut escaped = String::with_capacity(search.len());
    for ch in search.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '%' => escaped.push_str("\\%"),
            '_' => escaped.push_str("\\_"),
            _ => escaped.push(ch),
        }
    }
    Some(format!("%{escaped}%"))
}

fn lower_like_contains_pattern(search: Option<&str>) -> Option<String> {
    like_contains_pattern(search).map(|pattern| pattern.to_lowercase())
}

fn uuid_search(search: Option<&str>) -> Option<Uuid> {
    Uuid::parse_str(search?.trim()).ok()
}

fn batch_from_row(row: BatchRow) -> StockBatchListItem {
    StockBatchListItem {
        id: row.id,
        item_id: row.item_id,
        item_name: row.item_name,
        location_id: row.location_id,
        location_name: row.location_name,
        batch_number: row.batch_number,
        expires_on: row.expires_on,
        quantity_on_hand: row.quantity_on_hand,
        received_at: row.received_at,
    }
}

fn movement_from_row(row: MovementRow) -> anyhow::Result<StockMovementListItem> {
    Ok(StockMovementListItem {
        id: row.id,
        item_id: row.item_id,
        item_name: row.item_name,
        location_id: row.location_id,
        movement_type: codec::decode(&row.movement_type)?,
        quantity: row.quantity,
        balance_after: row.balance_after,
        reason: row.reason,
        created_at: row.created_at,
    })
}

fn location_stock_from_row(row: LocationStockRow) -> InventoryItemStockLocationItem {
    InventoryItemStockLocationItem {
        item_id: row.item_id,
        location_id: row.location_id,
        location_name: row.location_name,
        quantity_on_hand: row.quantity_on_hand,
    }
}

fn storage_location_stock_from_row(row: StorageLocationStockRow) -> StorageLocationStockItem {
    StorageLocationStockItem {
        item_id: row.item_id,
        item_name: row.item_name,
        location_id: row.location_id,
        location_name: row.location_name,
        quantity_on_hand: row.quantity_on_hand,
        batch_count: row.batch_count,
        earliest_expiry: row.earliest_expiry,
        last_received_at: row.last_received_at,
    }
}

fn transfer_from_row(row: TransferRow) -> anyhow::Result<StockTransferListItem> {
    Ok(StockTransferListItem {
        id: row.id,
        item_id: row.item_id,
        item_name: row.item_name,
        from_location_id: row.from_location_id,
        to_location_id: row.to_location_id,
        quantity: row.quantity,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}

fn requisition_from_row(row: RequisitionRow) -> anyhow::Result<StockRequisitionListItem> {
    Ok(StockRequisitionListItem {
        id: row.id,
        requesting_location_id: row.requesting_location_id,
        requesting_location_name: row.requesting_location_name,
        status: codec::decode(&row.status)?,
        priority: row.priority,
        rejection_reason: row.rejection_reason,
        rejected_at: row.rejected_at,
        cancelled_at: row.cancelled_at,
        created_at: row.created_at,
    })
}

fn standing_order_from_row(row: StandingOrderRow) -> anyhow::Result<StandingOrderListItem> {
    Ok(StandingOrderListItem {
        id: row.id,
        requesting_location_id: row.requesting_location_id,
        requesting_location_name: row.requesting_location_name,
        frequency: codec::decode(&row.frequency)?,
        status: codec::decode(&row.status)?,
        next_run_on: row.next_run_on,
        created_at: row.created_at,
    })
}

fn supply_dispense_from_row(row: SupplyDispenseRow) -> SupplyRequestDispenseResult {
    SupplyRequestDispenseResult {
        id: row.id,
        requisition_id: row.requisition_id,
        status: row.status,
        line_count: row.line_count,
        dispensed_at: row.dispensed_at,
    }
}

fn stock_check_from_row(row: StockCheckQueueRow) -> anyhow::Result<StockCheckQueueItem> {
    Ok(StockCheckQueueItem {
        id: row.id,
        location_id: row.location_id,
        status: codec::decode(&row.status)?,
        reason: row.reason,
        created_at: row.created_at,
    })
}
