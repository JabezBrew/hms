use chrono::{DateTime, Utc};
use hms_domain::ward::{NursingTaskListItem, NursingTaskStatus, NursingTaskType};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::WardCursor;

#[derive(Clone, Debug)]
pub struct NewNursingTask {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub task_type: NursingTaskType,
    pub title: Option<String>,
    pub instruction: Option<String>,
    pub due_at: DateTime<Utc>,
    pub assigned_to_user_id: Option<Uuid>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct NursingTaskFilters {
    pub patient_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
}

#[derive(Clone, Debug, FromRow)]
struct NursingTaskRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    task_type: String,
    title: Option<String>,
    instruction: Option<String>,
    status: String,
    due_at: DateTime<Utc>,
}

pub async fn list_nursing_tasks(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
    filters: NursingTaskFilters,
) -> anyhow::Result<Vec<NursingTaskListItem>> {
    let mut query = nursing_task_query();
    query.push(" WHERE nursing_tasks.facility_id = ");
    query.push_bind(facility_id);
    if let Some(patient_id) = filters.patient_id {
        query.push(" AND nursing_tasks.patient_id = ");
        query.push_bind(patient_id);
    }
    if let Some(admission_case_id) = filters.admission_case_id {
        query.push(" AND nursing_tasks.admission_case_id = ");
        query.push_bind(admission_case_id);
    }
    if let Some(cursor) = cursor {
        query.push(" AND (nursing_tasks.due_at, nursing_tasks.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY nursing_tasks.due_at ASC, nursing_tasks.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.nursing_tasks.list",
        query.build_query_as::<NursingTaskRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(nursing_task_from_row).collect()
}

pub async fn create_nursing_task(
    pool: &PgPool,
    task: NewNursingTask,
) -> anyhow::Result<NursingTaskListItem> {
    observe_db_query(
        "ward.nursing_tasks.create",
        sqlx::query(
            r#"
        INSERT INTO nursing_tasks (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            ward_id,
            task_type,
            title,
            instruction,
            status,
            due_at,
            assigned_to_user_id,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#,
        )
        .bind(task.id)
        .bind(task.facility_id)
        .bind(task.admission_case_id)
        .bind(task.patient_id)
        .bind(task.ward_id)
        .bind(codec::encode(task.task_type)?)
        .bind(task.title)
        .bind(task.instruction)
        .bind(codec::encode(NursingTaskStatus::Open)?)
        .bind(task.due_at)
        .bind(task.assigned_to_user_id)
        .bind(task.actor_user_id)
        .execute(pool),
    )
    .await?;

    nursing_task_by_id(pool, task.facility_id, task.id).await
}

pub async fn complete_nursing_task(
    pool: &PgPool,
    facility_id: Uuid,
    task_id: Uuid,
) -> anyhow::Result<Option<NursingTaskListItem>> {
    observe_db_query(
        "ward.nursing_tasks.complete",
        sqlx::query(
            r#"
        UPDATE nursing_tasks
        SET status = $1,
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
        )
        .bind(codec::encode(NursingTaskStatus::Completed)?)
        .bind(facility_id)
        .bind(task_id)
        .execute(pool),
    )
    .await?;

    optional_nursing_task_by_id(pool, facility_id, task_id).await
}

pub async fn cancel_nursing_task(
    pool: &PgPool,
    facility_id: Uuid,
    task_id: Uuid,
) -> anyhow::Result<Option<NursingTaskListItem>> {
    observe_db_query(
        "ward.nursing_tasks.cancel",
        sqlx::query(
            r#"
        UPDATE nursing_tasks
        SET status = $1,
            completed_at = NULL,
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
        )
        .bind(codec::encode(NursingTaskStatus::Cancelled)?)
        .bind(facility_id)
        .bind(task_id)
        .execute(pool),
    )
    .await?;

    optional_nursing_task_by_id(pool, facility_id, task_id).await
}

pub async fn get_nursing_task(
    pool: &PgPool,
    facility_id: Uuid,
    task_id: Uuid,
) -> anyhow::Result<Option<NursingTaskListItem>> {
    optional_nursing_task_by_id(pool, facility_id, task_id).await
}

fn nursing_task_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT nursing_tasks.id,
               nursing_tasks.admission_case_id,
               nursing_tasks.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               nursing_tasks.task_type,
               nursing_tasks.title,
               nursing_tasks.instruction,
               nursing_tasks.status,
               nursing_tasks.due_at
        FROM nursing_tasks
        JOIN patients ON patients.id = nursing_tasks.patient_id
        "#,
    )
}

async fn nursing_task_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    task_id: Uuid,
) -> anyhow::Result<NursingTaskListItem> {
    optional_nursing_task_by_id(pool, facility_id, task_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("nursing task was not found after write"))
}

async fn optional_nursing_task_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    task_id: Uuid,
) -> anyhow::Result<Option<NursingTaskListItem>> {
    let mut query = nursing_task_query();
    query.push(" WHERE nursing_tasks.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND nursing_tasks.id = ");
    query.push_bind(task_id);
    let row = observe_db_query(
        "ward.nursing_tasks.get",
        query
            .build_query_as::<NursingTaskRow>()
            .fetch_optional(pool),
    )
    .await?;
    row.map(nursing_task_from_row).transpose()
}

fn nursing_task_from_row(row: NursingTaskRow) -> anyhow::Result<NursingTaskListItem> {
    Ok(NursingTaskListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        task_type: codec::decode(&row.task_type)?,
        title: row.title,
        instruction: row.instruction,
        status: codec::decode(&row.status)?,
        due_at: row.due_at,
    })
}
