use chrono::{DateTime, Utc};
use hms_domain::ward::{WardStockRequestListItem, WardStockRequestStatus};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::WardCursor;

#[derive(Clone, Debug)]
pub struct NewWardStockRequest {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub ward_id: Uuid,
    pub requested_item: String,
    pub quantity_requested: i32,
    pub requested_by_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct WardStockRequestRow {
    id: Uuid,
    ward_id: Uuid,
    ward_name: String,
    requested_item: String,
    quantity_requested: i32,
    status: String,
    requested_at: DateTime<Utc>,
    approved_at: Option<DateTime<Utc>>,
    fulfilled_at: Option<DateTime<Utc>>,
}

pub async fn list_ward_stock_requests(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<WardStockRequestListItem>> {
    let mut query = ward_stock_request_query();
    query.push(" WHERE ward_stock_requests.facility_id = ");
    query.push_bind(facility_id);
    append_forward_cursor(
        &mut query,
        "ward_stock_requests.requested_at",
        "ward_stock_requests.id",
        cursor,
    );
    query.push(" ORDER BY ward_stock_requests.requested_at ASC, ward_stock_requests.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<WardStockRequestRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(ward_stock_request_from_row).collect()
}

pub async fn create_ward_stock_request(
    pool: &PgPool,
    request: NewWardStockRequest,
) -> anyhow::Result<WardStockRequestListItem> {
    sqlx::query(
        r#"
        INSERT INTO ward_stock_requests (
            id, facility_id, ward_id, requested_item, quantity_requested, status,
            requested_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7
        WHERE EXISTS (
            SELECT 1
            FROM wards
            WHERE wards.facility_id = $2
              AND wards.id = $3
        )
        "#,
    )
    .bind(request.id)
    .bind(request.facility_id)
    .bind(request.ward_id)
    .bind(request.requested_item)
    .bind(request.quantity_requested)
    .bind(codec::encode(WardStockRequestStatus::Requested)?)
    .bind(request.requested_by_user_id)
    .execute(pool)
    .await?;
    ward_stock_request_by_id(pool, request.facility_id, request.id).await
}

pub async fn approve_ward_stock_request(
    pool: &PgPool,
    facility_id: Uuid,
    request_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<WardStockRequestListItem>> {
    update_ward_stock_request_status(
        pool,
        facility_id,
        request_id,
        actor_user_id,
        WardStockRequestStatus::Approved,
    )
    .await
}

pub async fn fulfill_ward_stock_request(
    pool: &PgPool,
    facility_id: Uuid,
    request_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<WardStockRequestListItem>> {
    update_ward_stock_request_status(
        pool,
        facility_id,
        request_id,
        actor_user_id,
        WardStockRequestStatus::Fulfilled,
    )
    .await
}

fn ward_stock_request_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT ward_stock_requests.id,
               ward_stock_requests.ward_id,
               wards.name AS ward_name,
               ward_stock_requests.requested_item,
               ward_stock_requests.quantity_requested,
               ward_stock_requests.status,
               ward_stock_requests.requested_at,
               ward_stock_requests.approved_at,
               ward_stock_requests.fulfilled_at
        FROM ward_stock_requests
        JOIN wards
          ON wards.id = ward_stock_requests.ward_id
         AND wards.facility_id = ward_stock_requests.facility_id
        "#,
    )
}

async fn ward_stock_request_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    request_id: Uuid,
) -> anyhow::Result<WardStockRequestListItem> {
    optional_ward_stock_request_by_id(pool, facility_id, request_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("ward stock request was not found after write"))
}

async fn optional_ward_stock_request_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    request_id: Uuid,
) -> anyhow::Result<Option<WardStockRequestListItem>> {
    let mut query = ward_stock_request_query();
    query.push(" WHERE ward_stock_requests.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND ward_stock_requests.id = ");
    query.push_bind(request_id);
    let row = query
        .build_query_as::<WardStockRequestRow>()
        .fetch_optional(pool)
        .await?;
    row.map(ward_stock_request_from_row).transpose()
}

async fn update_ward_stock_request_status(
    pool: &PgPool,
    facility_id: Uuid,
    request_id: Uuid,
    actor_user_id: Uuid,
    status: WardStockRequestStatus,
) -> anyhow::Result<Option<WardStockRequestListItem>> {
    match status {
        WardStockRequestStatus::Approved => {
            sqlx::query(
                r#"
                UPDATE ward_stock_requests
                SET status = $1,
                    approved_by_user_id = $2,
                    approved_at = COALESCE(approved_at, now()),
                    updated_at = now()
                WHERE facility_id = $3
                  AND id = $4
                  AND status = $5
                "#,
            )
            .bind(codec::encode(WardStockRequestStatus::Approved)?)
            .bind(actor_user_id)
            .bind(facility_id)
            .bind(request_id)
            .bind(codec::encode(WardStockRequestStatus::Requested)?)
            .execute(pool)
            .await?;
        }
        WardStockRequestStatus::Fulfilled => {
            sqlx::query(
                r#"
                UPDATE ward_stock_requests
                SET status = $1,
                    fulfilled_by_user_id = $2,
                    fulfilled_at = COALESCE(fulfilled_at, now()),
                    updated_at = now()
                WHERE facility_id = $3
                  AND id = $4
                  AND status = $5
                "#,
            )
            .bind(codec::encode(WardStockRequestStatus::Fulfilled)?)
            .bind(actor_user_id)
            .bind(facility_id)
            .bind(request_id)
            .bind(codec::encode(WardStockRequestStatus::Approved)?)
            .execute(pool)
            .await?;
        }
        WardStockRequestStatus::Requested | WardStockRequestStatus::Cancelled => {}
    }

    optional_ward_stock_request_by_id(pool, facility_id, request_id).await
}

fn ward_stock_request_from_row(
    row: WardStockRequestRow,
) -> anyhow::Result<WardStockRequestListItem> {
    Ok(WardStockRequestListItem {
        id: row.id,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        requested_item: row.requested_item,
        quantity_requested: row.quantity_requested,
        status: codec::decode(&row.status)?,
        requested_at: row.requested_at,
        approved_at: row.approved_at,
        fulfilled_at: row.fulfilled_at,
    })
}

fn append_forward_cursor(
    query: &mut QueryBuilder<'_, Postgres>,
    time_column: &'static str,
    id_column: &'static str,
    cursor: Option<WardCursor>,
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
