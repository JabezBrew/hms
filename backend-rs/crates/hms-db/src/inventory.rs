use chrono::{DateTime, Utc};
use hms_domain::inventory::{
    ControlledMovementType, ControlledSubstanceBalanceValidation,
    ControlledSubstanceRegisterEntryItem, ControlledSubstanceRegisterItem, DispenseStatus,
    GoodsReceivedNoteListItem, GoodsReceivedStatus, InventoryCategoryListItem,
    InventoryItemListItem, InventoryItemStockLocationItem, PharmacyDispenseListItem,
    PurchaseOrderListItem, PurchaseOrderStatus, RequisitionStatus, StockBatchListItem,
    StockMovementListItem, StockMovementType, StockRequisitionListItem, StockTransferListItem,
    StorageLocationListItem, StorageLocationStockItem, TransferStatus,
};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct InventoryCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug, Default)]
pub struct InventoryItemFilters {
    pub search: Option<String>,
    pub category_id: Option<Uuid>,
    pub location_id: Option<Uuid>,
    pub stock_status: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewStockBatch {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub batch_number: String,
    pub expires_on: Option<chrono::NaiveDate>,
    pub quantity_received: i64,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewStockTransfer {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub item_id: Uuid,
    pub from_location_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: i64,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewStockRequisition {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub requesting_location_id: Uuid,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewPurchaseOrder {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub supplier_name: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewGoodsReceivedNote {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub purchase_order_id: Uuid,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewControlledMovement {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub movement_type: ControlledMovementType,
    pub quantity_delta: i64,
    pub witness_user_id: Option<Uuid>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewControlledCount {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub register_entry_id: Uuid,
    pub actual_count: i64,
    pub witness_user_id: Uuid,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewPharmacyDispense {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub quantity: i64,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct CategoryRow {
    id: Uuid,
    code: String,
    name: String,
}

#[derive(Clone, Debug, FromRow)]
struct ItemRow {
    id: Uuid,
    category_id: Uuid,
    category_name: String,
    code: String,
    name: String,
    item_type: String,
    unit: String,
    controlled: bool,
    total_stock: i64,
    nearest_expiry: Option<chrono::NaiveDate>,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct LocationRow {
    id: Uuid,
    code: String,
    name: String,
}

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
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PurchaseOrderRow {
    id: Uuid,
    supplier_name: String,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct GrnRow {
    id: Uuid,
    purchase_order_id: Uuid,
    supplier_name: String,
    status: String,
    received_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ControlledRow {
    id: Uuid,
    item_id: Uuid,
    item_name: String,
    location_id: Uuid,
    location_name: String,
    movement_type: String,
    quantity_delta: i64,
    balance_after: i64,
    current_balance: i64,
    unit_of_measure: String,
    entry_count: i64,
    total_dispensed: i64,
    total_received: i64,
    total_wastage: i64,
    has_discrepancy: bool,
    discrepancy_count: i64,
    witness_user_id: Option<Uuid>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ControlledEntryRow {
    id: Uuid,
    entry_number: i64,
    entry_type: String,
    quantity: i64,
    balance_before: i64,
    balance_after: i64,
    witness_user_id: Option<Uuid>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ControlledContextRow {
    item_id: Uuid,
    location_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct ControlledBalanceRow {
    current_balance: i64,
    computed_balance: i64,
}

#[derive(Clone, Debug, FromRow)]
struct DispenseRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    item_id: Uuid,
    item_name: String,
    location_id: Uuid,
    quantity: i64,
    status: String,
    dispensed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ItemContextRow {
    controlled: bool,
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

pub async fn list_categories(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<InventoryCategoryListItem>> {
    let rows = sqlx::query_as::<_, CategoryRow>(
        r#"
        SELECT id, code, name
        FROM inventory_categories
        WHERE facility_id = $1 AND is_active = TRUE
        ORDER BY code ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(category_from_row).collect())
}

pub async fn list_items(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    filters: InventoryItemFilters,
) -> anyhow::Result<Vec<InventoryItemListItem>> {
    let mut query = item_query();
    query.push(" WHERE inventory_items.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND inventory_items.is_active = TRUE");
    if let Some(search) = filters
        .search
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let search = format!("%{}%", search.to_lowercase());
        query.push(" AND (LOWER(inventory_items.name) LIKE ");
        query.push_bind(search.clone());
        query.push(" OR LOWER(inventory_items.code) LIKE ");
        query.push_bind(search);
        query.push(")");
    }
    if let Some(category_id) = filters.category_id {
        query.push(" AND inventory_items.category_id = ");
        query.push_bind(category_id);
    }
    if let Some(location_id) = filters.location_id {
        query.push(" AND stock_batches.location_id = ");
        query.push_bind(location_id);
    }
    apply_cursor(
        &mut query,
        "inventory_items.updated_at",
        "inventory_items.id",
        cursor,
    );
    query.push(
        r#"
        GROUP BY inventory_items.id,
                 inventory_items.category_id,
                 inventory_categories.name,
                 inventory_items.code,
                 inventory_items.name,
                 inventory_items.item_type,
                 inventory_items.unit,
                 inventory_items.controlled,
                 inventory_items.updated_at
        "#,
    );
    match filters.stock_status.as_deref() {
        Some("out_of_stock") => {
            query.push(" HAVING COALESCE(SUM(stock_batches.quantity_on_hand), 0) = 0");
        }
        Some("low_stock") => {
            query.push(" HAVING COALESCE(SUM(stock_batches.quantity_on_hand), 0) <= 0");
        }
        Some("in_stock") => {
            query.push(" HAVING COALESCE(SUM(stock_batches.quantity_on_hand), 0) > 0");
        }
        Some("expiring") => {
            query
                .push(" HAVING MIN(stock_batches.expires_on) <= CURRENT_DATE + INTERVAL '30 days'");
        }
        _ if filters.location_id.is_some() => {
            query.push(" HAVING COALESCE(SUM(stock_batches.quantity_on_hand), 0) > 0");
        }
        _ => {}
    }
    query.push(" ORDER BY inventory_items.updated_at DESC, inventory_items.id DESC LIMIT ");
    query.push_bind(limit);

    let rows = query.build_query_as::<ItemRow>().fetch_all(pool).await?;
    rows.into_iter().map(item_from_row).collect()
}

pub async fn get_item(
    pool: &PgPool,
    facility_id: Uuid,
    item_id: Uuid,
) -> anyhow::Result<Option<InventoryItemListItem>> {
    let mut query = item_query();
    query.push(" WHERE inventory_items.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND inventory_items.id = ");
    query.push_bind(item_id);
    query.push(" AND inventory_items.is_active = TRUE");
    query.push(
        r#"
        GROUP BY inventory_items.id,
                 inventory_items.category_id,
                 inventory_categories.name,
                 inventory_items.code,
                 inventory_items.name,
                 inventory_items.item_type,
                 inventory_items.unit,
                 inventory_items.controlled,
                 inventory_items.updated_at
        LIMIT 1
        "#,
    );

    let row = query
        .build_query_as::<ItemRow>()
        .fetch_optional(pool)
        .await?;

    row.map(item_from_row).transpose()
}

pub async fn list_locations(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<StorageLocationListItem>> {
    let rows = sqlx::query_as::<_, LocationRow>(
        r#"
        SELECT id, code, name
        FROM storage_locations
        WHERE facility_id = $1 AND is_active = TRUE
        ORDER BY code ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(location_from_row).collect())
}

pub async fn get_location(
    pool: &PgPool,
    facility_id: Uuid,
    location_id: Uuid,
) -> anyhow::Result<Option<StorageLocationListItem>> {
    let row = sqlx::query_as::<_, LocationRow>(
        r#"
        SELECT id, code, name
        FROM storage_locations
        WHERE facility_id = $1 AND id = $2 AND is_active = TRUE
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .bind(location_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(location_from_row))
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
) -> anyhow::Result<Vec<StockBatchListItem>> {
    let mut query = batch_query();
    query.push(" WHERE stock_batches.facility_id = ");
    query.push_bind(facility_id);
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
) -> anyhow::Result<Vec<StockTransferListItem>> {
    let mut query = transfer_query();
    query.push(" WHERE stock_transfers.facility_id = ");
    query.push_bind(facility_id);
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
) -> anyhow::Result<Vec<StockRequisitionListItem>> {
    let mut query = requisition_query();
    query.push(" WHERE stock_requisitions.facility_id = ");
    query.push_bind(facility_id);
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

pub async fn list_purchase_orders(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PurchaseOrderListItem>> {
    let mut query = purchase_order_query();
    query.push(" WHERE facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PurchaseOrderRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(purchase_order_from_row).collect()
}

pub async fn get_purchase_order(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PurchaseOrderListItem>> {
    fetch_purchase_order_by_id(pool, facility_id, id).await
}

pub async fn create_purchase_order(
    pool: &PgPool,
    order: NewPurchaseOrder,
) -> anyhow::Result<PurchaseOrderListItem> {
    sqlx::query(
        r#"
        INSERT INTO purchase_orders (id, facility_id, supplier_name, status, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(order.id)
    .bind(order.facility_id)
    .bind(&order.supplier_name)
    .bind(codec::encode(PurchaseOrderStatus::Draft)?)
    .bind(order.actor_user_id)
    .execute(pool)
    .await?;
    fetch_purchase_order_by_id(pool, order.facility_id, order.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created purchase order was not found"))
}

pub async fn approve_purchase_order(
    pool: &PgPool,
    facility_id: Uuid,
    purchase_order_id: Uuid,
) -> anyhow::Result<Option<PurchaseOrderListItem>> {
    transition_purchase_order_status(
        pool,
        facility_id,
        purchase_order_id,
        &[PurchaseOrderStatus::Draft, PurchaseOrderStatus::Approved],
        PurchaseOrderStatus::Approved,
    )
    .await
}

pub async fn list_grns(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<GoodsReceivedNoteListItem>> {
    let mut query = grn_query();
    query.push(" WHERE goods_received_notes.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(
        &mut query,
        "goods_received_notes.received_at",
        "goods_received_notes.id",
        cursor,
    );
    query.push(
        " ORDER BY goods_received_notes.received_at DESC, goods_received_notes.id DESC LIMIT ",
    );
    query.push_bind(limit);
    let rows = query.build_query_as::<GrnRow>().fetch_all(pool).await?;
    rows.into_iter().map(grn_from_row).collect()
}

pub async fn get_grn(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<GoodsReceivedNoteListItem>> {
    fetch_grn_by_id(pool, facility_id, id).await
}

pub async fn create_grn(
    pool: &PgPool,
    grn: NewGoodsReceivedNote,
) -> anyhow::Result<GoodsReceivedNoteListItem> {
    sqlx::query(
        r#"
        INSERT INTO goods_received_notes (
            id, facility_id, purchase_order_id, status, received_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(grn.id)
    .bind(grn.facility_id)
    .bind(grn.purchase_order_id)
    .bind(codec::encode(GoodsReceivedStatus::Received)?)
    .bind(grn.actor_user_id)
    .execute(pool)
    .await?;
    fetch_grn_by_id(pool, grn.facility_id, grn.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created GRN was not found"))
}

pub async fn list_controlled_register(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ControlledSubstanceRegisterItem>> {
    let mut query = QueryBuilder::new(
        r#"
        WITH register_stats AS (
            SELECT facility_id,
                   item_id,
                   location_id,
                   count(*)::bigint AS entry_count,
                   coalesce(sum(CASE WHEN movement_type = 'dispense' THEN abs(quantity_delta) ELSE 0 END), 0)::bigint AS total_dispensed,
                   coalesce(sum(CASE WHEN movement_type = 'receipt' THEN quantity_delta ELSE 0 END), 0)::bigint AS total_received,
                   coalesce(sum(CASE WHEN movement_type = 'adjustment' AND quantity_delta < 0 THEN abs(quantity_delta) ELSE 0 END), 0)::bigint AS total_wastage,
                   count(*) FILTER (WHERE movement_type = 'count' AND quantity_delta <> 0)::bigint AS discrepancy_count
            FROM controlled_substance_register
            WHERE facility_id = "#,
    );
    query.push_bind(facility_id);
    query.push(
        r#"
            GROUP BY facility_id, item_id, location_id
        ),
        latest AS (
            SELECT DISTINCT ON (facility_id, item_id, location_id)
                   id,
                   facility_id,
                   item_id,
                   location_id,
                   movement_type,
                   quantity_delta,
                   balance_after,
                   witness_user_id,
                   created_at
            FROM controlled_substance_register
            WHERE facility_id = "#,
    );
    query.push_bind(facility_id);
    query.push(
        r#"
            ORDER BY facility_id, item_id, location_id, created_at DESC, id DESC
        )
        SELECT latest.id,
               latest.item_id,
               inventory_items.name AS item_name,
               latest.location_id,
               storage_locations.name AS location_name,
               latest.movement_type,
               latest.quantity_delta,
               latest.balance_after,
               latest.balance_after AS current_balance,
               inventory_items.unit AS unit_of_measure,
               register_stats.entry_count,
               register_stats.total_dispensed,
               register_stats.total_received,
               register_stats.total_wastage,
               register_stats.discrepancy_count > 0 AS has_discrepancy,
               register_stats.discrepancy_count,
               latest.witness_user_id,
               latest.created_at
        FROM latest
        INNER JOIN inventory_items ON inventory_items.id = latest.item_id
        INNER JOIN storage_locations ON storage_locations.id = latest.location_id
        INNER JOIN register_stats ON register_stats.facility_id = latest.facility_id
            AND register_stats.item_id = latest.item_id
            AND register_stats.location_id = latest.location_id
        WHERE latest.facility_id = "#,
    );
    query.push_bind(facility_id);
    apply_cursor(&mut query, "latest.created_at", "latest.id", cursor);
    query.push(" ORDER BY latest.created_at DESC, latest.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<ControlledRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(controlled_from_row).collect()
}

pub async fn get_controlled_register_entry(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<ControlledSubstanceRegisterItem>> {
    fetch_controlled_by_id(pool, facility_id, id).await
}

pub async fn list_controlled_register_entries(
    pool: &PgPool,
    facility_id: Uuid,
    register_entry_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ControlledSubstanceRegisterEntryItem>> {
    let mut query = QueryBuilder::new(
        r#"
        WITH target AS (
            SELECT item_id, location_id
            FROM controlled_substance_register
            WHERE facility_id = "#,
    );
    query.push_bind(facility_id);
    query.push(" AND id = ");
    query.push_bind(register_entry_id);
    query.push(
        r#"
        ),
        ledger AS (
            SELECT controlled_substance_register.id,
                   row_number() OVER (
                       ORDER BY controlled_substance_register.created_at ASC,
                                controlled_substance_register.id ASC
                   )::bigint AS entry_number,
                   controlled_substance_register.movement_type AS entry_type,
                   controlled_substance_register.quantity_delta AS quantity,
                   coalesce(lag(controlled_substance_register.balance_after) OVER (
                       ORDER BY controlled_substance_register.created_at ASC,
                                controlled_substance_register.id ASC
                   ), 0)::bigint AS balance_before,
                   controlled_substance_register.balance_after,
                   controlled_substance_register.witness_user_id,
                   controlled_substance_register.created_at
            FROM controlled_substance_register
            INNER JOIN target ON target.item_id = controlled_substance_register.item_id
                AND target.location_id = controlled_substance_register.location_id
            WHERE controlled_substance_register.facility_id = "#,
    );
    query.push_bind(facility_id);
    query.push("\n        )\n        SELECT * FROM ledger WHERE TRUE");
    apply_forward_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<ControlledEntryRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(controlled_entry_from_row).collect()
}

pub async fn validate_controlled_register_balance(
    pool: &PgPool,
    facility_id: Uuid,
    register_entry_id: Uuid,
) -> anyhow::Result<Option<ControlledSubstanceBalanceValidation>> {
    let Some(context) = controlled_context_by_id(pool, facility_id, register_entry_id).await?
    else {
        return Ok(None);
    };
    let row = sqlx::query_as::<_, ControlledBalanceRow>(
        r#"
        WITH ledger AS (
            SELECT quantity_delta, balance_after, created_at, id
            FROM controlled_substance_register
            WHERE facility_id = $1 AND item_id = $2 AND location_id = $3
        ),
        current_row AS (
            SELECT balance_after AS current_balance
            FROM ledger
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        )
        SELECT coalesce((SELECT current_balance FROM current_row), 0)::bigint AS current_balance,
               coalesce((SELECT sum(quantity_delta) FROM ledger), 0)::bigint AS computed_balance
        "#,
    )
    .bind(facility_id)
    .bind(context.item_id)
    .bind(context.location_id)
    .fetch_one(pool)
    .await?;

    Ok(Some(ControlledSubstanceBalanceValidation {
        register_id: register_entry_id,
        current_balance: row.current_balance,
        computed_balance: row.computed_balance,
        valid: row.current_balance == row.computed_balance,
        checked_at: chrono::Utc::now(),
    }))
}

pub async fn create_controlled_count(
    pool: &PgPool,
    count: NewControlledCount,
) -> anyhow::Result<ControlledSubstanceRegisterItem> {
    if count.actual_count < 0 {
        anyhow::bail!("controlled count cannot be negative");
    }
    let context = controlled_context_by_id(pool, count.facility_id, count.register_entry_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("controlled register entry was not found"))?;
    let current_balance = current_controlled_balance(
        pool,
        count.facility_id,
        context.item_id,
        context.location_id,
    )
    .await?;
    create_controlled_movement(
        pool,
        NewControlledMovement {
            id: count.id,
            facility_id: count.facility_id,
            item_id: context.item_id,
            location_id: context.location_id,
            movement_type: ControlledMovementType::Count,
            quantity_delta: count.actual_count - current_balance,
            witness_user_id: Some(count.witness_user_id),
            actor_user_id: count.actor_user_id,
        },
    )
    .await
}

pub async fn create_controlled_movement(
    pool: &PgPool,
    movement: NewControlledMovement,
) -> anyhow::Result<ControlledSubstanceRegisterItem> {
    let item = item_context(pool, movement.facility_id, movement.item_id).await?;
    if !item.controlled {
        anyhow::bail!("controlled register requires a controlled item");
    }
    if movement.quantity_delta < 0 && movement.witness_user_id.is_none() {
        anyhow::bail!("negative controlled movement requires a witness");
    }
    let current_balance = current_controlled_balance(
        pool,
        movement.facility_id,
        movement.item_id,
        movement.location_id,
    )
    .await?;
    let next_balance = current_balance + movement.quantity_delta;
    if next_balance < 0 {
        anyhow::bail!("controlled balance cannot become negative");
    }

    sqlx::query(
        r#"
        INSERT INTO controlled_substance_register (
            id, facility_id, item_id, location_id, movement_type, quantity_delta, balance_after,
            witness_user_id, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(movement.id)
    .bind(movement.facility_id)
    .bind(movement.item_id)
    .bind(movement.location_id)
    .bind(codec::encode(movement.movement_type)?)
    .bind(movement.quantity_delta)
    .bind(next_balance)
    .bind(movement.witness_user_id)
    .bind(movement.actor_user_id)
    .execute(pool)
    .await?;
    fetch_controlled_by_id(pool, movement.facility_id, movement.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created controlled register entry was not found"))
}

pub async fn list_dispenses(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PharmacyDispenseListItem>> {
    let mut query = dispense_query();
    query.push(" WHERE pharmacy_dispenses.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(
        &mut query,
        "pharmacy_dispenses.dispensed_at",
        "pharmacy_dispenses.id",
        cursor,
    );
    query.push(" ORDER BY pharmacy_dispenses.dispensed_at DESC, pharmacy_dispenses.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<DispenseRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(dispense_from_row).collect()
}

pub async fn create_dispense(
    pool: &PgPool,
    dispense: NewPharmacyDispense,
) -> anyhow::Result<PharmacyDispenseListItem> {
    let item = item_context(pool, dispense.facility_id, dispense.item_id).await?;
    if item.controlled {
        anyhow::bail!("controlled items require controlled-substance register workflow");
    }
    let mut transaction = pool.begin().await?;
    let batch = sqlx::query_as::<_, (Uuid, i64)>(
        r#"
        SELECT id, quantity_on_hand
        FROM stock_batches
        WHERE facility_id = $1
          AND item_id = $2
          AND location_id = $3
          AND quantity_on_hand >= $4
        ORDER BY expires_on ASC NULLS LAST, received_at ASC, id ASC
        LIMIT 1
        FOR UPDATE
        "#,
    )
    .bind(dispense.facility_id)
    .bind(dispense.item_id)
    .bind(dispense.location_id)
    .bind(dispense.quantity)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some((batch_id, quantity_on_hand)) = batch else {
        anyhow::bail!("insufficient stock for dispense");
    };
    let balance_after = quantity_on_hand - dispense.quantity;
    sqlx::query("UPDATE stock_batches SET quantity_on_hand = $1, updated_at = now() WHERE id = $2")
        .bind(balance_after)
        .bind(batch_id)
        .execute(&mut *transaction)
        .await?;

    insert_movement(
        &mut transaction,
        dispense.facility_id,
        dispense.item_id,
        Some(batch_id),
        dispense.location_id,
        StockMovementType::Dispense,
        -dispense.quantity,
        balance_after,
        "pharmacy_dispense",
        dispense.actor_user_id,
    )
    .await?;

    sqlx::query(
        r#"
        INSERT INTO pharmacy_dispenses (
            id, facility_id, patient_id, item_id, location_id, quantity, status, dispensed_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(dispense.id)
    .bind(dispense.facility_id)
    .bind(dispense.patient_id)
    .bind(dispense.item_id)
    .bind(dispense.location_id)
    .bind(dispense.quantity)
    .bind(codec::encode(DispenseStatus::Dispensed)?)
    .bind(dispense.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_dispense_by_id(pool, dispense.facility_id, dispense.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created dispense was not found"))
}

async fn insert_movement(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    item_id: Uuid,
    batch_id: Option<Uuid>,
    location_id: Uuid,
    movement_type: StockMovementType,
    quantity: i64,
    balance_after: i64,
    reason: &'static str,
    actor_user_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO stock_movements (
            id, facility_id, item_id, batch_id, location_id, movement_type, quantity,
            balance_after, reason, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(facility_id)
    .bind(item_id)
    .bind(batch_id)
    .bind(location_id)
    .bind(codec::encode(movement_type)?)
    .bind(quantity)
    .bind(balance_after)
    .bind(reason)
    .bind(actor_user_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn item_context(
    pool: &PgPool,
    facility_id: Uuid,
    item_id: Uuid,
) -> anyhow::Result<ItemContextRow> {
    sqlx::query_as::<_, ItemContextRow>(
        "SELECT controlled FROM inventory_items WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(item_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("inventory item was not found"))
}

async fn current_controlled_balance(
    pool: &PgPool,
    facility_id: Uuid,
    item_id: Uuid,
    location_id: Uuid,
) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>(
        r#"
        SELECT balance_after
        FROM controlled_substance_register
        WHERE facility_id = $1 AND item_id = $2 AND location_id = $3
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .bind(item_id)
    .bind(location_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(0))
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

async fn fetch_purchase_order_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PurchaseOrderListItem>> {
    let mut query = purchase_order_query();
    query.push(" WHERE facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND id = ");
    query.push_bind(id);
    query
        .build_query_as::<PurchaseOrderRow>()
        .fetch_optional(pool)
        .await?
        .map(purchase_order_from_row)
        .transpose()
}

async fn transition_purchase_order_status(
    pool: &PgPool,
    facility_id: Uuid,
    purchase_order_id: Uuid,
    allowed_statuses: &[PurchaseOrderStatus],
    target_status: PurchaseOrderStatus,
) -> anyhow::Result<Option<PurchaseOrderListItem>> {
    let allowed = codec::encode_slice(allowed_statuses)?;
    let target = codec::encode(target_status)?;
    sqlx::query(
        r#"
        UPDATE purchase_orders
        SET status = $4
        WHERE facility_id = $1
          AND id = $2
          AND status = ANY($3)
        "#,
    )
    .bind(facility_id)
    .bind(purchase_order_id)
    .bind(allowed)
    .bind(target)
    .execute(pool)
    .await?;
    fetch_purchase_order_by_id(pool, facility_id, purchase_order_id).await
}

async fn fetch_grn_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<GoodsReceivedNoteListItem>> {
    let mut query = grn_query();
    query.push(" WHERE goods_received_notes.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND goods_received_notes.id = ");
    query.push_bind(id);
    query
        .build_query_as::<GrnRow>()
        .fetch_optional(pool)
        .await?
        .map(grn_from_row)
        .transpose()
}

async fn fetch_controlled_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<ControlledSubstanceRegisterItem>> {
    let mut query = controlled_query();
    query.push(" WHERE controlled_substance_register.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND controlled_substance_register.id = ");
    query.push_bind(id);
    query
        .build_query_as::<ControlledRow>()
        .fetch_optional(pool)
        .await?
        .map(controlled_from_row)
        .transpose()
}

async fn controlled_context_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<ControlledContextRow>> {
    sqlx::query_as::<_, ControlledContextRow>(
        r#"
        SELECT item_id, location_id
        FROM controlled_substance_register
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
}

async fn fetch_dispense_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PharmacyDispenseListItem>> {
    let mut query = dispense_query();
    query.push(" WHERE pharmacy_dispenses.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND pharmacy_dispenses.id = ");
    query.push_bind(id);
    query
        .build_query_as::<DispenseRow>()
        .fetch_optional(pool)
        .await?
        .map(dispense_from_row)
        .transpose()
}

fn item_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT inventory_items.id,
               inventory_items.category_id,
               inventory_categories.name AS category_name,
               inventory_items.code,
               inventory_items.name,
               inventory_items.item_type,
               inventory_items.unit,
               inventory_items.controlled,
               COALESCE(SUM(stock_batches.quantity_on_hand), 0)::BIGINT AS total_stock,
               MIN(stock_batches.expires_on) FILTER (
                   WHERE stock_batches.quantity_on_hand > 0
               ) AS nearest_expiry,
               inventory_items.updated_at
        FROM inventory_items
        INNER JOIN inventory_categories ON inventory_categories.id = inventory_items.category_id
        LEFT JOIN stock_batches ON stock_batches.item_id = inventory_items.id
            AND stock_batches.facility_id = inventory_items.facility_id
        "#,
    )
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
        INNER JOIN inventory_items ON inventory_items.id = stock_transfers.item_id
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
               stock_requisitions.created_at
        FROM stock_requisitions
        INNER JOIN storage_locations ON storage_locations.id = stock_requisitions.requesting_location_id
        "#,
    )
}

fn purchase_order_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new("SELECT id, supplier_name, status, created_at FROM purchase_orders")
}

fn grn_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT goods_received_notes.id,
               goods_received_notes.purchase_order_id,
               purchase_orders.supplier_name,
               goods_received_notes.status,
               goods_received_notes.received_at
        FROM goods_received_notes
        INNER JOIN purchase_orders ON purchase_orders.id = goods_received_notes.purchase_order_id
        "#,
    )
}

fn controlled_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT controlled_substance_register.id,
               controlled_substance_register.item_id,
               inventory_items.name AS item_name,
               controlled_substance_register.location_id,
               storage_locations.name AS location_name,
               controlled_substance_register.movement_type,
               controlled_substance_register.quantity_delta,
               controlled_substance_register.balance_after,
               (
                   SELECT latest.balance_after
                   FROM controlled_substance_register AS latest
                   WHERE latest.facility_id = controlled_substance_register.facility_id
                     AND latest.item_id = controlled_substance_register.item_id
                     AND latest.location_id = controlled_substance_register.location_id
                   ORDER BY latest.created_at DESC, latest.id DESC
                   LIMIT 1
               ) AS current_balance,
               inventory_items.unit AS unit_of_measure,
               (
                   SELECT count(*)::bigint
                   FROM controlled_substance_register AS stats
                   WHERE stats.facility_id = controlled_substance_register.facility_id
                     AND stats.item_id = controlled_substance_register.item_id
                     AND stats.location_id = controlled_substance_register.location_id
               ) AS entry_count,
               (
                   SELECT coalesce(sum(abs(stats.quantity_delta)), 0)::bigint
                   FROM controlled_substance_register AS stats
                   WHERE stats.facility_id = controlled_substance_register.facility_id
                     AND stats.item_id = controlled_substance_register.item_id
                     AND stats.location_id = controlled_substance_register.location_id
                     AND stats.movement_type = 'dispense'
               ) AS total_dispensed,
               (
                   SELECT coalesce(sum(stats.quantity_delta), 0)::bigint
                   FROM controlled_substance_register AS stats
                   WHERE stats.facility_id = controlled_substance_register.facility_id
                     AND stats.item_id = controlled_substance_register.item_id
                     AND stats.location_id = controlled_substance_register.location_id
                     AND stats.movement_type = 'receipt'
               ) AS total_received,
               (
                   SELECT coalesce(sum(abs(stats.quantity_delta)), 0)::bigint
                   FROM controlled_substance_register AS stats
                   WHERE stats.facility_id = controlled_substance_register.facility_id
                     AND stats.item_id = controlled_substance_register.item_id
                     AND stats.location_id = controlled_substance_register.location_id
                     AND stats.movement_type = 'adjustment'
                     AND stats.quantity_delta < 0
               ) AS total_wastage,
               (
                   SELECT count(*)::bigint
                   FROM controlled_substance_register AS stats
                   WHERE stats.facility_id = controlled_substance_register.facility_id
                     AND stats.item_id = controlled_substance_register.item_id
                     AND stats.location_id = controlled_substance_register.location_id
                     AND stats.movement_type = 'count'
                     AND stats.quantity_delta <> 0
               ) > 0 AS has_discrepancy,
               (
                   SELECT count(*)::bigint
                   FROM controlled_substance_register AS stats
                   WHERE stats.facility_id = controlled_substance_register.facility_id
                     AND stats.item_id = controlled_substance_register.item_id
                     AND stats.location_id = controlled_substance_register.location_id
                     AND stats.movement_type = 'count'
                     AND stats.quantity_delta <> 0
               ) AS discrepancy_count,
               controlled_substance_register.witness_user_id,
               controlled_substance_register.created_at
        FROM controlled_substance_register
        INNER JOIN inventory_items ON inventory_items.id = controlled_substance_register.item_id
        INNER JOIN storage_locations ON storage_locations.id = controlled_substance_register.location_id
        "#,
    )
}

fn dispense_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT pharmacy_dispenses.id,
               pharmacy_dispenses.patient_id,
               patients.patient_code,
               pharmacy_dispenses.item_id,
               inventory_items.name AS item_name,
               pharmacy_dispenses.location_id,
               pharmacy_dispenses.quantity,
               pharmacy_dispenses.status,
               pharmacy_dispenses.dispensed_at
        FROM pharmacy_dispenses
        INNER JOIN patients ON patients.id = pharmacy_dispenses.patient_id
        INNER JOIN inventory_items ON inventory_items.id = pharmacy_dispenses.item_id
        "#,
    )
}

fn apply_cursor(
    query: &mut QueryBuilder<'static, Postgres>,
    time_column: &'static str,
    id_column: &'static str,
    cursor: Option<InventoryCursor>,
) {
    if let Some(cursor) = cursor {
        query.push(" AND (");
        query.push(time_column);
        query.push(", ");
        query.push(id_column);
        query.push(") < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
}

fn apply_forward_cursor(
    query: &mut QueryBuilder<'static, Postgres>,
    time_column: &'static str,
    id_column: &'static str,
    cursor: Option<InventoryCursor>,
) {
    if let Some(cursor) = cursor {
        query.push(" AND (");
        query.push(time_column);
        query.push(", ");
        query.push(id_column);
        query.push(") > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
}

fn category_from_row(row: CategoryRow) -> InventoryCategoryListItem {
    InventoryCategoryListItem {
        id: row.id,
        code: row.code,
        name: row.name,
    }
}

fn item_from_row(row: ItemRow) -> anyhow::Result<InventoryItemListItem> {
    Ok(InventoryItemListItem {
        id: row.id,
        category_id: row.category_id,
        category_name: row.category_name,
        code: row.code.clone(),
        sku: row.code,
        name: row.name,
        item_type: codec::decode(&row.item_type)?,
        unit: row.unit.clone(),
        unit_of_measure: row.unit,
        controlled: row.controlled,
        is_controlled: row.controlled,
        total_stock: row.total_stock,
        nearest_expiry: row.nearest_expiry,
        updated_at: row.updated_at,
    })
}

fn location_from_row(row: LocationRow) -> StorageLocationListItem {
    StorageLocationListItem {
        id: row.id,
        code: row.code,
        name: row.name,
    }
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
        created_at: row.created_at,
    })
}

fn purchase_order_from_row(row: PurchaseOrderRow) -> anyhow::Result<PurchaseOrderListItem> {
    Ok(PurchaseOrderListItem {
        id: row.id,
        supplier_name: row.supplier_name,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}

fn grn_from_row(row: GrnRow) -> anyhow::Result<GoodsReceivedNoteListItem> {
    Ok(GoodsReceivedNoteListItem {
        id: row.id,
        purchase_order_id: row.purchase_order_id,
        supplier_name: row.supplier_name,
        status: codec::decode(&row.status)?,
        received_at: row.received_at,
    })
}

fn controlled_from_row(row: ControlledRow) -> anyhow::Result<ControlledSubstanceRegisterItem> {
    Ok(ControlledSubstanceRegisterItem {
        id: row.id,
        item_id: row.item_id,
        item_name: row.item_name,
        location_id: row.location_id,
        location_name: row.location_name,
        movement_type: codec::decode(&row.movement_type)?,
        quantity_delta: row.quantity_delta,
        balance_after: row.balance_after,
        current_balance: row.current_balance,
        unit_of_measure: row.unit_of_measure,
        entry_count: row.entry_count,
        total_dispensed: row.total_dispensed,
        total_received: row.total_received,
        total_wastage: row.total_wastage,
        has_discrepancy: row.has_discrepancy,
        discrepancy_count: row.discrepancy_count,
        witness_user_id: row.witness_user_id,
        created_at: row.created_at,
    })
}

fn controlled_entry_from_row(
    row: ControlledEntryRow,
) -> anyhow::Result<ControlledSubstanceRegisterEntryItem> {
    Ok(ControlledSubstanceRegisterEntryItem {
        id: row.id,
        entry_number: row.entry_number,
        entry_type: codec::decode(&row.entry_type)?,
        quantity: row.quantity,
        balance_before: row.balance_before,
        balance_after: row.balance_after,
        witness_user_id: row.witness_user_id,
        created_at: row.created_at,
    })
}

fn dispense_from_row(row: DispenseRow) -> anyhow::Result<PharmacyDispenseListItem> {
    Ok(PharmacyDispenseListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        item_id: row.item_id,
        item_name: row.item_name,
        location_id: row.location_id,
        quantity: row.quantity,
        status: codec::decode(&row.status)?,
        dispensed_at: row.dispensed_at,
    })
}
