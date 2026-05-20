use chrono::{DateTime, Utc};
use hms_domain::inventory::{
    ControlledDiscrepancyCategory, ControlledMovementType, StandingOrderFrequency,
    StockMovementType,
};
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
    apply_catalog_edit, get_item, get_location, inventory_dashboard_summary, list_categories,
    list_items, list_locations, list_suppliers,
};
pub use controlled_substances::{
    create_controlled_count, create_controlled_movement, get_controlled_register_entry,
    list_controlled_discrepancies, list_controlled_register, list_controlled_register_entries,
    validate_controlled_register_balance,
};
pub use pharmacy::{create_dispense, list_dispenses};
pub use procurement::{
    accept_grn, approve_purchase_order, create_grn, create_purchase_order, get_grn,
    get_purchase_order, inspect_grn, list_grns, list_purchase_orders, send_purchase_order,
};
pub use stock_control::{
    approve_requisition, cancel_requisition, create_batch, create_requisition,
    create_standing_order, create_transfer, dispense_supply_request, enqueue_stock_check,
    fulfill_requisition, generate_draft_requisition_from_standing_order, get_requisition,
    get_transfer, list_batches, list_item_batches, list_item_movements,
    list_item_stock_by_location, list_movements, list_requisitions, list_storage_location_stock,
    list_transfers, reject_requisition, submit_requisition, transition_stock_check,
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
pub struct NewStandingOrder {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub requesting_location_id: Uuid,
    pub frequency: StandingOrderFrequency,
    pub next_run_on: chrono::NaiveDate,
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
    pub category: ControlledDiscrepancyCategory,
    pub reason: String,
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

#[derive(Clone, Debug)]
pub struct CatalogEditCommand {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub item_id: Uuid,
    pub effective_from: chrono::NaiveDate,
    pub code: String,
    pub name: String,
    pub unit: String,
    pub reason: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct SupplyDispenseLine {
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub quantity: i64,
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

async fn apply_stock_delta_tx(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    item_id: Uuid,
    location_id: Uuid,
    quantity_delta: i64,
    reason: &'static str,
    actor_user_id: Uuid,
) -> anyhow::Result<()> {
    if quantity_delta == 0 {
        return Ok(());
    }

    if quantity_delta > 0 {
        let existing_batch = hms_observability::observe_db_query(
            "inventory.stock_batches.select_adjustment_batch",
            sqlx::query_as::<_, (Uuid, i64)>(
                r#"
                SELECT id, quantity_on_hand
                FROM stock_batches
                WHERE facility_id = $1 AND item_id = $2 AND location_id = $3
                ORDER BY received_at DESC, id DESC
                LIMIT 1
                FOR UPDATE
                "#,
            )
            .bind(facility_id)
            .bind(item_id)
            .bind(location_id)
            .fetch_optional(&mut **transaction),
        )
        .await?;
        let (batch_id, balance_after) = if let Some((batch_id, quantity_on_hand)) = existing_batch {
            let balance_after = quantity_on_hand + quantity_delta;
            sqlx::query(
                "UPDATE stock_batches SET quantity_on_hand = $1, updated_at = now() WHERE id = $2",
            )
            .bind(balance_after)
            .bind(batch_id)
            .execute(&mut **transaction)
            .await?;
            (Some(batch_id), balance_after)
        } else {
            let batch_id = Uuid::new_v4();
            sqlx::query(
                r#"
                INSERT INTO stock_batches (
                    id, facility_id, item_id, location_id, batch_number, quantity_on_hand
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                "#,
            )
            .bind(batch_id)
            .bind(facility_id)
            .bind(item_id)
            .bind(location_id)
            .bind("CONTROLLED-LEDGER")
            .bind(quantity_delta)
            .execute(&mut **transaction)
            .await?;
            (Some(batch_id), quantity_delta)
        };
        insert_movement(
            transaction,
            facility_id,
            item_id,
            batch_id,
            location_id,
            StockMovementType::Adjustment,
            quantity_delta,
            balance_after,
            reason,
            actor_user_id,
        )
        .await?;
        return Ok(());
    }

    let mut remaining = -quantity_delta;
    let batches = hms_observability::observe_db_query(
        "inventory.stock_batches.lock_for_negative_adjustment",
        sqlx::query_as::<_, (Uuid, i64)>(
            r#"
            SELECT id, quantity_on_hand
            FROM stock_batches
            WHERE facility_id = $1
              AND item_id = $2
              AND location_id = $3
              AND quantity_on_hand > 0
            ORDER BY expires_on ASC NULLS LAST, received_at ASC, id ASC
            FOR UPDATE
            "#,
        )
        .bind(facility_id)
        .bind(item_id)
        .bind(location_id)
        .fetch_all(&mut **transaction),
    )
    .await?;

    let total_available: i64 = batches.iter().map(|(_, quantity)| *quantity).sum();
    if total_available < remaining {
        anyhow::bail!("insufficient stock for adjustment");
    }

    let mut first_batch_id = None;
    for (batch_id, quantity_on_hand) in batches {
        if remaining == 0 {
            break;
        }
        first_batch_id.get_or_insert(batch_id);
        let consumed = remaining.min(quantity_on_hand);
        remaining -= consumed;
        sqlx::query(
            "UPDATE stock_batches SET quantity_on_hand = $1, updated_at = now() WHERE id = $2",
        )
        .bind(quantity_on_hand - consumed)
        .bind(batch_id)
        .execute(&mut **transaction)
        .await?;
    }

    let balance_after = total_available + quantity_delta;
    insert_movement(
        transaction,
        facility_id,
        item_id,
        first_batch_id,
        location_id,
        StockMovementType::Adjustment,
        quantity_delta,
        balance_after,
        reason,
        actor_user_id,
    )
    .await
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
