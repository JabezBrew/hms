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
    pub request_id: Option<String>,
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
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Default)]
pub struct HandoffFilters {
    pub ward_id: Option<Uuid>,
    pub shift_label: Option<String>,
    pub status: Option<HandoffStatus>,
    pub created_from: Option<DateTime<Utc>>,
    pub created_before: Option<DateTime<Utc>>,
    pub descending: bool,
}

pub async fn list_handoffs(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<HandoffListItem>> {
    list_handoffs_scoped(pool, facility_id, cursor, limit, HandoffFilters::default()).await
}

pub async fn list_handoffs_scoped(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
    filters: HandoffFilters,
) -> anyhow::Result<Vec<HandoffListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        "SELECT handoffs.id, handoffs.ward_id, wards.name AS ward_name, handoffs.from_user_id, handoffs.to_user_id, handoffs.shift_label, handoffs.status, handoffs.created_at, handoffs.completed_at FROM handoffs JOIN wards ON wards.id = handoffs.ward_id AND wards.facility_id = handoffs.facility_id JOIN users sender ON sender.id=handoffs.from_user_id AND sender.facility_id=handoffs.facility_id JOIN users recipient ON recipient.id=handoffs.to_user_id AND recipient.facility_id=handoffs.facility_id WHERE handoffs.facility_id = "
    );
    query.push_bind(facility_id);
    if let Some(id) = filters.ward_id {
        query.push(" AND handoffs.ward_id = ").push_bind(id);
    }
    if let Some(shift) = filters.shift_label {
        query.push(" AND handoffs.shift_label = ").push_bind(shift);
    }
    if let Some(status) = filters.status {
        query
            .push(" AND handoffs.status = ")
            .push_bind(codec::encode(status)?);
    }
    if let Some(from) = filters.created_from {
        query.push(" AND handoffs.created_at >= ").push_bind(from);
    }
    if let Some(before) = filters.created_before {
        query.push(" AND handoffs.created_at < ").push_bind(before);
    }
    if let Some(cursor) = cursor {
        query.push(if filters.descending {
            " AND (handoffs.created_at, handoffs.id) < ("
        } else {
            " AND (handoffs.created_at, handoffs.id) > ("
        });
        query
            .push_bind(cursor.occurred_at)
            .push(", ")
            .push_bind(cursor.id)
            .push(")");
    }
    query
        .push(if filters.descending {
            " ORDER BY handoffs.created_at DESC, handoffs.id DESC LIMIT "
        } else {
            " ORDER BY handoffs.created_at ASC, handoffs.id ASC LIMIT "
        })
        .push_bind(limit);
    let rows = observe_db_query(
        "ward.handoffs.list",
        query.build_query_as::<HandoffRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(handoff_from_row).collect()
}

#[derive(Debug)]
pub enum HandoffError {
    InvalidReference,
    NotSender,
    InvalidStatus,
}
impl std::fmt::Display for HandoffError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidReference => "Select an active ward and active users from this facility.",
            Self::NotSender => "Only the sender may finalize this shift header.",
            Self::InvalidStatus => "This shift header cannot be finalized from its current status.",
        })
    }
}
impl std::error::Error for HandoffError {}

pub async fn create_handoff(pool: &PgPool, handoff: NewHandoff) -> anyhow::Result<HandoffListItem> {
    let mut transaction = pool.begin().await?;
    let ward_name: Option<String> = sqlx::query_scalar(
        "SELECT name FROM wards WHERE facility_id=$1 AND id=$2 AND status='active' FOR SHARE",
    )
    .bind(handoff.facility_id)
    .bind(handoff.ward_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(ward_name) = ward_name else {
        return Err(HandoffError::InvalidReference.into());
    };
    let mut users = vec![handoff.from_user_id, handoff.to_user_id];
    users.sort();
    users.dedup();
    let active_users: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND id=ANY($2) AND is_active ORDER BY id FOR SHARE")
        .bind(handoff.facility_id).bind(&users).fetch_all(&mut *transaction).await?;
    if active_users != users {
        return Err(HandoffError::InvalidReference.into());
    }
    let created_at: DateTime<Utc> = sqlx::query_scalar("INSERT INTO handoffs(id,facility_id,ward_id,from_user_id,to_user_id,shift_label,status) VALUES($1,$2,$3,$4,$5,$6,'draft') RETURNING created_at")
        .bind(handoff.id).bind(handoff.facility_id).bind(handoff.ward_id).bind(handoff.from_user_id).bind(handoff.to_user_id).bind(&handoff.shift_label).fetch_one(&mut *transaction).await?;
    handoff_audit(
        &mut transaction,
        handoff.facility_id,
        handoff.from_user_id,
        handoff.id,
        handoff.request_id,
        "nursing.handoff.created",
    )
    .await?;
    let result = HandoffListItem {
        id: handoff.id,
        ward_id: handoff.ward_id,
        ward_name,
        from_user_id: handoff.from_user_id,
        to_user_id: handoff.to_user_id,
        shift_label: handoff.shift_label,
        status: HandoffStatus::Draft,
        created_at,
        completed_at: None,
    };
    transaction.commit().await?;
    Ok(result)
}

/// Completion finalizes the sender's header. It is not recipient acknowledgment.
pub async fn complete_handoff(
    pool: &PgPool,
    facility_id: Uuid,
    handoff_id: Uuid,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<HandoffListItem>> {
    let mut transaction = pool.begin().await?;
    let existing = sqlx::query_as::<_,HandoffRow>("SELECT handoffs.id,handoffs.ward_id,wards.name AS ward_name,handoffs.from_user_id,handoffs.to_user_id,handoffs.shift_label,handoffs.status,handoffs.created_at,handoffs.completed_at FROM handoffs JOIN wards ON wards.id=handoffs.ward_id AND wards.facility_id=handoffs.facility_id JOIN users sender ON sender.id=handoffs.from_user_id AND sender.facility_id=handoffs.facility_id JOIN users recipient ON recipient.id=handoffs.to_user_id AND recipient.facility_id=handoffs.facility_id WHERE handoffs.facility_id=$1 AND handoffs.id=$2 FOR UPDATE OF handoffs")
        .bind(facility_id).bind(handoff_id).fetch_optional(&mut *transaction).await?;
    let Some(mut row) = existing else {
        return Ok(None);
    };
    if row.from_user_id != actor_user_id {
        return Err(HandoffError::NotSender.into());
    }
    if row.status == "completed" {
        let result = handoff_from_row(row)?;
        transaction.commit().await?;
        return Ok(Some(result));
    }
    if row.status != "draft" {
        return Err(HandoffError::InvalidStatus.into());
    }
    row.completed_at=Some(sqlx::query_scalar::<_,DateTime<Utc>>("UPDATE handoffs SET status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 RETURNING completed_at")
        .bind(facility_id).bind(handoff_id).fetch_one(&mut *transaction).await?);
    row.status = "completed".into();
    handoff_audit(
        &mut transaction,
        facility_id,
        actor_user_id,
        handoff_id,
        request_id,
        "nursing.handoff.finalized",
    )
    .await?;
    let result = handoff_from_row(row)?;
    transaction.commit().await?;
    Ok(Some(result))
}

async fn handoff_audit(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility: Uuid,
    actor: Uuid,
    id: Uuid,
    request_id: Option<String>,
    event: &str,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'handoff',$6,'{}'::jsonb)")
        .bind(Uuid::new_v4()).bind(facility).bind(actor).bind(request_id).bind(event).bind(id).execute(&mut **transaction).await?;
    Ok(())
}

pub async fn get_handoff(
    pool: &PgPool,
    facility_id: Uuid,
    handoff_id: Uuid,
) -> anyhow::Result<Option<HandoffListItem>> {
    optional_handoff_by_id(pool, facility_id, handoff_id).await
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
               handoffs.created_at,
               handoffs.completed_at
        FROM handoffs
        JOIN wards ON wards.id = handoffs.ward_id
        JOIN users sender ON sender.id=handoffs.from_user_id AND sender.facility_id=handoffs.facility_id
        JOIN users recipient ON recipient.id=handoffs.to_user_id AND recipient.facility_id=handoffs.facility_id
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
        completed_at: row.completed_at,
    })
}
