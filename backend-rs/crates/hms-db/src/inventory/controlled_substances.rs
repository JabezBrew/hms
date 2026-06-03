use chrono::{DateTime, Utc};
use hms_domain::inventory::{
    ControlledDiscrepancyListItem, ControlledMovementType, ControlledSubstanceBalanceValidation,
    ControlledSubstanceRegisterEntryItem, ControlledSubstanceRegisterItem,
};
use serde_json::json;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use super::{
    apply_cursor, apply_forward_cursor, apply_stock_delta_tx, item_context, InventoryCursor,
    NewControlledCount, NewControlledMovement,
};
use crate::codec;
use crate::PgPool;

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
struct ControlledDiscrepancyRow {
    id: Uuid,
    register_entry_id: Uuid,
    category: String,
    expected_balance: i64,
    actual_count: i64,
    quantity_delta: i64,
    reason: String,
    status: String,
    severity: String,
    created_at: DateTime<Utc>,
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
    let rows = hms_observability::observe_db_query(
        "inventory.controlled_register.list",
        query.build_query_as::<ControlledRow>().fetch_all(pool),
    )
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
    let rows = hms_observability::observe_db_query(
        "inventory.controlled_register.entries",
        query.build_query_as::<ControlledEntryRow>().fetch_all(pool),
    )
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
    let row = hms_observability::observe_db_query(
        "inventory.controlled_register.validate_balance",
        sqlx::query_as::<_, ControlledBalanceRow>(
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
        .fetch_one(pool),
    )
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
    let quantity_delta = count.actual_count - current_balance;
    if count.reason.trim().is_empty() {
        anyhow::bail!("controlled discrepancy reason is required");
    }

    let mut tx = pool.begin().await?;
    let movement = NewControlledMovement {
        id: count.id,
        facility_id: count.facility_id,
        item_id: context.item_id,
        location_id: context.location_id,
        movement_type: ControlledMovementType::Count,
        quantity_delta,
        witness_user_id: Some(count.witness_user_id),
        actor_user_id: count.actor_user_id,
        request_id: count.request_id.clone(),
    };
    insert_controlled_movement_tx(&mut tx, movement.clone(), current_balance).await?;
    insert_controlled_movement_audit_tx(&mut tx, &movement, current_balance + quantity_delta)
        .await?;

    if quantity_delta != 0 {
        let discrepancy_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO controlled_substance_discrepancies (
                id, facility_id, register_entry_id, category, expected_balance, actual_count,
                quantity_delta, reason, status, severity, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'logged', 'high', $9)
            "#,
        )
        .bind(discrepancy_id)
        .bind(count.facility_id)
        .bind(count.id)
        .bind(codec::encode(count.category)?)
        .bind(current_balance)
        .bind(count.actual_count)
        .bind(quantity_delta)
        .bind(count.reason.trim())
        .bind(count.actor_user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO audit_events (
                id, facility_id, actor_user_id, request_id, event_type, resource_type, resource_id, metadata
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(Uuid::new_v4())
        .bind(count.facility_id)
        .bind(count.actor_user_id)
        .bind(count.request_id.clone())
        .bind("controlled_substance.discrepancy.logged")
        .bind("controlled_substance_discrepancy")
        .bind(discrepancy_id)
        .bind(json!({
            "severity": "high",
            "category": count.category,
            "expected_balance": current_balance,
            "actual_count": count.actual_count,
            "quantity_delta": quantity_delta,
        }))
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    fetch_controlled_by_id(pool, count.facility_id, count.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created controlled count was not found"))
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

    let mut tx = pool.begin().await?;
    insert_controlled_movement_tx(&mut tx, movement.clone(), current_balance).await?;
    insert_controlled_movement_audit_tx(&mut tx, &movement, next_balance).await?;
    tx.commit().await?;
    fetch_controlled_by_id(pool, movement.facility_id, movement.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created controlled register entry was not found"))
}

async fn insert_controlled_movement_audit_tx(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    movement: &NewControlledMovement,
    balance_after: i64,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO audit_events (
            id, facility_id, actor_user_id, request_id, event_type, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4())
    .bind(movement.facility_id)
    .bind(movement.actor_user_id)
    .bind(movement.request_id.as_deref())
    .bind("controlled_substance.movement.recorded")
    .bind("controlled_substance_register")
    .bind(movement.id)
    .bind(json!({
        "severity": "high",
        "movement_type": movement.movement_type,
        "quantity_delta": movement.quantity_delta,
        "balance_after": balance_after,
    }))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn list_controlled_discrepancies(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ControlledDiscrepancyListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT id, register_entry_id, category, expected_balance, actual_count, quantity_delta,
               reason, status, severity, created_at
        FROM controlled_substance_discrepancies
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    apply_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<ControlledDiscrepancyRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(discrepancy_from_row).collect()
}

async fn insert_controlled_movement_tx(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    movement: NewControlledMovement,
    current_balance: i64,
) -> anyhow::Result<()> {
    let next_balance = current_balance + movement.quantity_delta;
    if next_balance < 0 {
        anyhow::bail!("controlled balance cannot become negative");
    }
    hms_observability::observe_db_query(
        "inventory.controlled_register.insert_movement",
        sqlx::query(
            r#"
            INSERT INTO controlled_substance_register (
                id, facility_id, item_id, location_id, movement_type, quantity_delta,
                balance_after, witness_user_id, created_by_user_id
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
        .execute(&mut **tx),
    )
    .await?;
    apply_stock_delta_tx(
        tx,
        movement.facility_id,
        movement.item_id,
        movement.location_id,
        movement.quantity_delta,
        "controlled_substance_register",
        movement.actor_user_id,
    )
    .await
}

async fn current_controlled_balance(
    pool: &PgPool,
    facility_id: Uuid,
    item_id: Uuid,
    location_id: Uuid,
) -> anyhow::Result<i64> {
    Ok(hms_observability::observe_db_query(
        "inventory.controlled_register.current_balance",
        sqlx::query_scalar::<_, i64>(
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
        .fetch_optional(pool),
    )
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
    hms_observability::observe_db_query(
        "inventory.controlled_register.fetch_by_id",
        query.build_query_as::<ControlledRow>().fetch_optional(pool),
    )
    .await?
    .map(controlled_from_row)
    .transpose()
}

async fn controlled_context_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<ControlledContextRow>> {
    hms_observability::observe_db_query(
        "inventory.controlled_register.context_by_id",
        sqlx::query_as::<_, ControlledContextRow>(
            r#"
        SELECT item_id, location_id
        FROM controlled_substance_register
        WHERE facility_id = $1 AND id = $2
        "#,
        )
        .bind(facility_id)
        .bind(id)
        .fetch_optional(pool),
    )
    .await
    .map_err(Into::into)
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

fn discrepancy_from_row(
    row: ControlledDiscrepancyRow,
) -> anyhow::Result<ControlledDiscrepancyListItem> {
    Ok(ControlledDiscrepancyListItem {
        id: row.id,
        register_entry_id: row.register_entry_id,
        category: codec::decode(&row.category)?,
        expected_balance: row.expected_balance,
        actual_count: row.actual_count,
        quantity_delta: row.quantity_delta,
        reason: row.reason,
        status: row.status,
        severity: row.severity,
        created_at: row.created_at,
    })
}
