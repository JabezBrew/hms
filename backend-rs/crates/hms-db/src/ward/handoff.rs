use chrono::{DateTime, Utc};
use hms_domain::ward::{HandoffListItem, HandoffStatus};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::WardCursor;

#[derive(Clone, Debug)]
pub struct NewHandoff {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub ward_id: Uuid,
    pub from_user_id: Uuid,
    pub to_user_id: Uuid,
    pub shift_label: String,
}

#[derive(Clone, Debug, FromRow)]
struct HandoffRow {
    id: Uuid,
    ward_id: Uuid,
    ward_name: String,
    from_user_id: Uuid,
    to_user_id: Uuid,
    shift_label: String,
    status: String,
    created_at: DateTime<Utc>,
}

pub async fn list_handoffs(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<HandoffListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT handoffs.id,
               handoffs.ward_id,
               wards.name AS ward_name,
               handoffs.from_user_id,
               handoffs.to_user_id,
               handoffs.shift_label,
               handoffs.status,
               handoffs.created_at
        FROM handoffs
        JOIN wards ON wards.id = handoffs.ward_id
        WHERE handoffs.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND wards.facility_id = ");
    query.push_bind(facility_id);
    if let Some(cursor) = cursor {
        query.push(" AND (handoffs.created_at, handoffs.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY handoffs.created_at ASC, handoffs.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.handoffs.list",
        query.build_query_as::<HandoffRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(handoff_from_row).collect()
}

pub async fn create_handoff(pool: &PgPool, handoff: NewHandoff) -> anyhow::Result<HandoffListItem> {
    observe_db_query(
        "ward.handoffs.create",
        sqlx::query(
            r#"
        INSERT INTO handoffs (
            id,
            facility_id,
            ward_id,
            from_user_id,
            to_user_id,
            shift_label,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        )
        .bind(handoff.id)
        .bind(handoff.facility_id)
        .bind(handoff.ward_id)
        .bind(handoff.from_user_id)
        .bind(handoff.to_user_id)
        .bind(&handoff.shift_label)
        .bind(codec::encode(HandoffStatus::Draft)?)
        .execute(pool),
    )
    .await?;

    handoff_by_id(pool, handoff.facility_id, handoff.id).await
}

pub async fn complete_handoff(
    pool: &PgPool,
    facility_id: Uuid,
    handoff_id: Uuid,
) -> anyhow::Result<Option<HandoffListItem>> {
    observe_db_query(
        "ward.handoffs.complete",
        sqlx::query(
            r#"
        UPDATE handoffs
        SET status = $1,
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
        )
        .bind(codec::encode(HandoffStatus::Completed)?)
        .bind(facility_id)
        .bind(handoff_id)
        .execute(pool),
    )
    .await?;

    optional_handoff_by_id(pool, facility_id, handoff_id).await
}

pub async fn get_handoff(
    pool: &PgPool,
    facility_id: Uuid,
    handoff_id: Uuid,
) -> anyhow::Result<Option<HandoffListItem>> {
    optional_handoff_by_id(pool, facility_id, handoff_id).await
}

async fn handoff_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    handoff_id: Uuid,
) -> anyhow::Result<HandoffListItem> {
    optional_handoff_by_id(pool, facility_id, handoff_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("handoff was not found after write"))
}

async fn optional_handoff_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    handoff_id: Uuid,
) -> anyhow::Result<Option<HandoffListItem>> {
    let row = observe_db_query(
        "ward.handoffs.get",
        sqlx::query_as::<_, HandoffRow>(
            r#"
        SELECT handoffs.id,
               handoffs.ward_id,
               wards.name AS ward_name,
               handoffs.from_user_id,
               handoffs.to_user_id,
               handoffs.shift_label,
               handoffs.status,
               handoffs.created_at
        FROM handoffs
        JOIN wards ON wards.id = handoffs.ward_id
        WHERE handoffs.facility_id = $1
          AND wards.facility_id = $1
          AND handoffs.id = $2
        "#,
        )
        .bind(facility_id)
        .bind(handoff_id)
        .fetch_optional(pool),
    )
    .await?;
    row.map(handoff_from_row).transpose()
}

fn handoff_from_row(row: HandoffRow) -> anyhow::Result<HandoffListItem> {
    Ok(HandoffListItem {
        id: row.id,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        from_user_id: row.from_user_id,
        to_user_id: row.to_user_id,
        shift_label: row.shift_label,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}
