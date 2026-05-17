use chrono::{DateTime, Utc};
use hms_domain::inventory::{ControlledMovementType, StockMovementType};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

mod catalog;
mod controlled_substances;
mod pharmacy;
mod procurement;
mod stock_control;

pub use catalog::{
    get_item, get_location, inventory_dashboard_summary, list_categories, list_items,
    list_locations, list_suppliers,
};
pub use controlled_substances::{
    create_controlled_count, create_controlled_movement, get_controlled_register_entry,
    list_controlled_register, list_controlled_register_entries,
    validate_controlled_register_balance,
};
pub use pharmacy::{create_dispense, list_dispenses};
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
struct ItemContextRow {
    controlled: bool,
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
    hms_observability::observe_db_query(
        "inventory.stock_movements.insert",
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
        .execute(&mut **transaction),
    )
    .await?;
    Ok(())
}

async fn item_context(
    pool: &PgPool,
    facility_id: Uuid,
    item_id: Uuid,
) -> anyhow::Result<ItemContextRow> {
    hms_observability::observe_db_query(
        "inventory.items.context",
        sqlx::query_as::<_, ItemContextRow>(
            "SELECT controlled FROM inventory_items WHERE facility_id = $1 AND id = $2",
        )
        .bind(facility_id)
        .bind(item_id)
        .fetch_optional(pool),
    )
    .await?
    .ok_or_else(|| anyhow::anyhow!("inventory item was not found"))
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
