use chrono::{DateTime, Utc};
use hms_domain::inventory::{
    GoodsReceivedNoteListItem, GoodsReceivedStatus, PurchaseOrderListItem, PurchaseOrderStatus,
};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use super::{
    apply_cursor, GoodsReceivedNoteFilters, InventoryCursor, NewGoodsReceivedNote,
    NewPurchaseOrder, PurchaseOrderFilters,
};
use crate::codec;
use crate::PgPool;

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

pub async fn list_purchase_orders(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    filters: PurchaseOrderFilters,
) -> anyhow::Result<Vec<PurchaseOrderListItem>> {
    let mut query = purchase_order_query();
    query.push(" WHERE purchase_orders.facility_id = ");
    query.push_bind(facility_id);
    if let Some(status) = filters.status {
        query.push(" AND purchase_orders.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(pattern) = like_contains_pattern(filters.supplier.as_deref()) {
        query.push(" AND purchase_orders.supplier_name ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\'");
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        let search_id = uuid_search(filters.search.as_deref());
        query.push(" AND (purchase_orders.supplier_name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\'");
        if let Some(search_id) = search_id {
            query.push(" OR purchase_orders.id = ");
            query.push_bind(search_id);
        }
        query.push(")");
    }
    apply_cursor(
        &mut query,
        "purchase_orders.created_at",
        "purchase_orders.id",
        cursor,
    );
    query.push(" ORDER BY purchase_orders.created_at DESC, purchase_orders.id DESC LIMIT ");
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

pub async fn send_purchase_order(
    pool: &PgPool,
    facility_id: Uuid,
    purchase_order_id: Uuid,
) -> anyhow::Result<Option<PurchaseOrderListItem>> {
    transition_purchase_order_status(
        pool,
        facility_id,
        purchase_order_id,
        &[PurchaseOrderStatus::Approved, PurchaseOrderStatus::Sent],
        PurchaseOrderStatus::Sent,
    )
    .await
}

pub async fn list_grns(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<InventoryCursor>,
    limit: i64,
    filters: GoodsReceivedNoteFilters,
) -> anyhow::Result<Vec<GoodsReceivedNoteListItem>> {
    let mut query = grn_query();
    query.push(" WHERE goods_received_notes.facility_id = ");
    query.push_bind(facility_id);
    if let Some(status) = filters.status {
        query.push(" AND goods_received_notes.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        let search_id = uuid_search(filters.search.as_deref());
        query.push(" AND (purchase_orders.supplier_name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\'");
        if let Some(search_id) = search_id {
            query.push(" OR goods_received_notes.id = ");
            query.push_bind(search_id);
            query.push(" OR goods_received_notes.purchase_order_id = ");
            query.push_bind(search_id);
        }
        query.push(")");
    }
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
    .bind(codec::encode(GoodsReceivedStatus::PendingInspection)?)
    .bind(grn.actor_user_id)
    .execute(pool)
    .await?;
    fetch_grn_by_id(pool, grn.facility_id, grn.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created GRN was not found"))
}

pub async fn inspect_grn(
    pool: &PgPool,
    facility_id: Uuid,
    grn_id: Uuid,
) -> anyhow::Result<Option<GoodsReceivedNoteListItem>> {
    transition_grn_status(
        pool,
        facility_id,
        grn_id,
        &[
            GoodsReceivedStatus::Received,
            GoodsReceivedStatus::PendingInspection,
            GoodsReceivedStatus::Inspecting,
        ],
        GoodsReceivedStatus::Inspecting,
    )
    .await
}

pub async fn accept_grn(
    pool: &PgPool,
    facility_id: Uuid,
    grn_id: Uuid,
) -> anyhow::Result<Option<GoodsReceivedNoteListItem>> {
    transition_grn_status(
        pool,
        facility_id,
        grn_id,
        &[
            GoodsReceivedStatus::Inspecting,
            GoodsReceivedStatus::Accepted,
        ],
        GoodsReceivedStatus::Accepted,
    )
    .await
}

async fn fetch_purchase_order_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PurchaseOrderListItem>> {
    let mut query = purchase_order_query();
    query.push(" WHERE purchase_orders.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND purchase_orders.id = ");
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

async fn transition_grn_status(
    pool: &PgPool,
    facility_id: Uuid,
    grn_id: Uuid,
    allowed_statuses: &[GoodsReceivedStatus],
    target_status: GoodsReceivedStatus,
) -> anyhow::Result<Option<GoodsReceivedNoteListItem>> {
    let allowed = codec::encode_slice(allowed_statuses)?;
    let target = codec::encode(target_status)?;
    sqlx::query(
        r#"
        UPDATE goods_received_notes
        SET status = $4
        WHERE facility_id = $1
          AND id = $2
          AND status = ANY($3)
        "#,
    )
    .bind(facility_id)
    .bind(grn_id)
    .bind(allowed)
    .bind(target)
    .execute(pool)
    .await?;
    fetch_grn_by_id(pool, facility_id, grn_id).await
}

fn purchase_order_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        "SELECT purchase_orders.id, purchase_orders.supplier_name, purchase_orders.status, purchase_orders.created_at FROM purchase_orders",
    )
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
        INNER JOIN purchase_orders
            ON purchase_orders.id = goods_received_notes.purchase_order_id
           AND purchase_orders.facility_id = goods_received_notes.facility_id
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

fn uuid_search(search: Option<&str>) -> Option<Uuid> {
    Uuid::parse_str(search?.trim()).ok()
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
