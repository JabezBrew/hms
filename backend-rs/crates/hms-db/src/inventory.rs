use chrono::{DateTime, Utc};
use hms_domain::inventory::{
    ControlledMovementType, ControlledSubstanceBalanceValidation,
    ControlledSubstanceRegisterEntryItem, ControlledSubstanceRegisterItem, DispenseStatus,
    PharmacyDispenseListItem, StockMovementType,
};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

mod catalog;
mod procurement;
mod stock_control;

pub use catalog::{
    get_item, get_location, inventory_dashboard_summary, list_categories, list_items,
    list_locations, list_suppliers,
};
pub use procurement::{
    accept_grn, approve_purchase_order, create_grn, create_purchase_order, get_grn,
    get_purchase_order, inspect_grn, list_grns, list_purchase_orders, send_purchase_order,
};
pub use stock_control::{
    approve_requisition, cancel_requisition, create_batch, create_requisition, create_transfer,
    fulfill_requisition, get_requisition, get_transfer, list_batches, list_item_batches,
    list_item_movements, list_item_stock_by_location, list_movements, list_requisitions,
    list_storage_location_stock, list_transfers, reject_requisition, submit_requisition,
};

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

#[derive(Clone, Debug, Default)]
pub struct SupplierFilters {
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct StockBatchFilters {
    pub expired: Option<bool>,
    pub expiring_within_days: Option<i32>,
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

pub(super) fn apply_cursor(
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

pub(super) fn apply_forward_cursor(
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
