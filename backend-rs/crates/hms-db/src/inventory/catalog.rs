use chrono::{DateTime, Utc};
use hms_domain::inventory::{
    GoodsReceivedStatus, InventoryCatalogVersionItem, InventoryCategoryListItem,
    InventoryDashboardSummary, InventoryItemListItem, RequisitionStatus, StorageLocationListItem,
    SupplierListItem,
};
use serde_json::json;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use super::{
    apply_cursor, apply_forward_cursor, CatalogEditCommand, InventoryCursor, InventoryItemFilters,
    SupplierFilters,
};
use crate::codec;
use crate::PgPool;

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
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct SupplierRow {
    id: Uuid,
    code: String,
    name: String,
    contact_name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct InventoryDashboardSummaryRow {
    total_items: i64,
    low_stock_count: i64,
    expiring_soon_count: i64,
    expiring_count: i64,
    total_stock_value_minor: i64,
    total_value_minor: i64,
    pending_requisitions: i64,
    pending_grns: i64,
    discrepancies: i64,
}

#[derive(Clone, Debug, FromRow)]
struct CatalogVersionRow {
    id: Uuid,
    item_id: Uuid,
    effective_from: chrono::NaiveDate,
    effective_to: Option<chrono::NaiveDate>,
    code: String,
    name: String,
    unit: String,
    reason: String,
    created_at: DateTime<Utc>,
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
    cursor: Option<InventoryCursor>,
    limit: i64,
) -> anyhow::Result<Vec<StorageLocationListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT id, code, name, created_at
        FROM storage_locations
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND is_active = TRUE");
    apply_forward_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<LocationRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(location_from_row).collect())
}

pub async fn list_suppliers(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    filters: SupplierFilters,
) -> anyhow::Result<Vec<SupplierListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT id, code, name, contact_name, phone, email, is_active, created_at
        FROM inventory_suppliers
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(is_active) = filters.is_active {
        query.push(" AND is_active = ");
        query.push_bind(is_active);
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR contact_name ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_forward_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at ASC, id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<SupplierRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(supplier_from_row).collect())
}

pub async fn get_location(
    pool: &PgPool,
    facility_id: Uuid,
    location_id: Uuid,
) -> anyhow::Result<Option<StorageLocationListItem>> {
    let row = sqlx::query_as::<_, LocationRow>(
        r#"
        SELECT id, code, name, created_at
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

pub async fn apply_catalog_edit(
    pool: &PgPool,
    edit: CatalogEditCommand,
) -> anyhow::Result<InventoryCatalogVersionItem> {
    let mut tx = pool.begin().await?;
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
            SELECT 1 FROM inventory_items
            WHERE facility_id = $1 AND id = $2 AND is_active = TRUE
         )",
    )
    .bind(edit.facility_id)
    .bind(edit.item_id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        anyhow::bail!("inventory item was not found");
    }

    let previous_effective_to = edit
        .effective_from
        .pred_opt()
        .unwrap_or(edit.effective_from);
    sqlx::query(
        "UPDATE inventory_item_catalog_versions
         SET effective_to = $3
         WHERE facility_id = $1
           AND item_id = $2
           AND effective_to IS NULL",
    )
    .bind(edit.facility_id)
    .bind(edit.item_id)
    .bind(previous_effective_to)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO inventory_item_catalog_versions (
            id, facility_id, item_id, effective_from, code, name, unit, reason, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(edit.id)
    .bind(edit.facility_id)
    .bind(edit.item_id)
    .bind(edit.effective_from)
    .bind(&edit.code)
    .bind(&edit.name)
    .bind(&edit.unit)
    .bind(&edit.reason)
    .bind(edit.actor_user_id)
    .execute(&mut *tx)
    .await?;

    if edit.effective_from <= Utc::now().date_naive() {
        sqlx::query(
            "UPDATE inventory_items
             SET code = $3, name = $4, unit = $5, updated_at = now()
             WHERE facility_id = $1 AND id = $2",
        )
        .bind(edit.facility_id)
        .bind(edit.item_id)
        .bind(&edit.code)
        .bind(&edit.name)
        .bind(&edit.unit)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO audit_events (
            id, facility_id, actor_user_id, event_type, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(edit.facility_id)
    .bind(edit.actor_user_id)
    .bind("inventory.catalog.edited")
    .bind("inventory_item")
    .bind(edit.item_id)
    .bind(json!({
        "severity": "high",
        "effective_from": edit.effective_from,
        "reason": edit.reason,
    }))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    fetch_catalog_version_by_id(pool, edit.facility_id, edit.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created catalog version was not found"))
}

pub async fn inventory_dashboard_summary(
    pool: &PgPool,
    facility_id: Uuid,
    expiring_within_days: i32,
) -> anyhow::Result<InventoryDashboardSummary> {
    let requested = codec::encode(RequisitionStatus::Requested)?;
    let pending = codec::encode(RequisitionStatus::Pending)?;
    let received = codec::encode(GoodsReceivedStatus::Received)?;
    let pending_inspection = codec::encode(GoodsReceivedStatus::PendingInspection)?;
    let inspecting = codec::encode(GoodsReceivedStatus::Inspecting)?;

    let row = sqlx::query_as::<_, InventoryDashboardSummaryRow>(
        r#"
        WITH item_metrics AS (
            SELECT COUNT(*)::BIGINT AS total_items
            FROM inventory_items
            WHERE facility_id = $1
              AND is_active = TRUE
        ),
        batch_metrics AS (
            SELECT (COUNT(*) FILTER (WHERE quantity_on_hand <= 0))::BIGINT AS low_stock_count,
                   (COUNT(*) FILTER (
                       WHERE expires_on IS NOT NULL
                         AND expires_on >= CURRENT_DATE
                         AND expires_on <= CURRENT_DATE + ($2 * INTERVAL '1 day')
                   ))::BIGINT AS expiring_soon_count
            FROM stock_batches
            WHERE facility_id = $1
        ),
        requisition_metrics AS (
            SELECT COUNT(*)::BIGINT AS pending_requisitions
            FROM stock_requisitions
            WHERE facility_id = $1
              AND status IN ($3, $4)
        ),
        grn_metrics AS (
            SELECT COUNT(*)::BIGINT AS pending_grns
            FROM goods_received_notes
            WHERE facility_id = $1
              AND status IN ($5, $6, $7)
        ),
        discrepancy_metrics AS (
            SELECT COUNT(*)::BIGINT AS discrepancies
            FROM controlled_substance_discrepancies
            WHERE facility_id = $1
              AND status = 'logged'
        )
        SELECT item_metrics.total_items,
               batch_metrics.low_stock_count,
               batch_metrics.expiring_soon_count,
               batch_metrics.expiring_soon_count AS expiring_count,
               0::BIGINT AS total_stock_value_minor,
               0::BIGINT AS total_value_minor,
               requisition_metrics.pending_requisitions,
               grn_metrics.pending_grns,
               discrepancy_metrics.discrepancies
        FROM item_metrics
        CROSS JOIN batch_metrics
        CROSS JOIN requisition_metrics
        CROSS JOIN grn_metrics
        CROSS JOIN discrepancy_metrics
        "#,
    )
    .bind(facility_id)
    .bind(expiring_within_days)
    .bind(requested)
    .bind(pending)
    .bind(received)
    .bind(pending_inspection)
    .bind(inspecting)
    .fetch_one(pool)
    .await?;

    Ok(InventoryDashboardSummary {
        total_items: row.total_items,
        low_stock_count: row.low_stock_count,
        expiring_soon_count: row.expiring_soon_count,
        expiring_count: row.expiring_count,
        total_stock_value_minor: row.total_stock_value_minor,
        total_value_minor: row.total_value_minor,
        pending_requisitions: row.pending_requisitions,
        pending_grns: row.pending_grns,
        discrepancies: row.discrepancies,
    })
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

async fn fetch_catalog_version_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<InventoryCatalogVersionItem>> {
    let row = sqlx::query_as::<_, CatalogVersionRow>(
        r#"
        SELECT id, item_id, effective_from, effective_to, code, name, unit, reason, created_at
        FROM inventory_item_catalog_versions
        WHERE facility_id = $1 AND id = $2
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(catalog_version_from_row))
}

fn catalog_version_from_row(row: CatalogVersionRow) -> InventoryCatalogVersionItem {
    InventoryCatalogVersionItem {
        id: row.id,
        item_id: row.item_id,
        effective_from: row.effective_from,
        effective_to: row.effective_to,
        code: row.code,
        name: row.name,
        unit: row.unit,
        reason: row.reason,
        created_at: row.created_at,
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
        created_at: row.created_at,
    }
}

fn supplier_from_row(row: SupplierRow) -> SupplierListItem {
    SupplierListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        contact_name: row.contact_name,
        phone: row.phone,
        email: row.email,
        is_active: row.is_active,
        created_at: row.created_at,
    }
}
