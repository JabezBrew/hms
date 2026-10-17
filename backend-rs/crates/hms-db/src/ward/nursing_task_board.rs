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
    assigned_to_user_id: Option<Uuid>,
    ward_id: Uuid,
    service_ward_id: Uuid,
    route_version: i64,
    completed_at: Option<DateTime<Utc>>,
    completed_by_user_id: Option<Uuid>,
    cancelled_at: Option<DateTime<Utc>>,
    cancelled_by_user_id: Option<Uuid>,
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
        WHERE facility_id = $2 AND id = $3 AND status='open'
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
            updated_at = now()
        WHERE facility_id = $2 AND id = $3 AND status='open'
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

/// Production list: current authority and effective service ward are applied before paging.
pub async fn list_nursing_tasks_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    filters: &hms_domain::ward::NursingTaskListQuery,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<NursingTaskListItem>> {
    use super::nursing_access as access;
    let mut tx = pool.begin().await?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    if let Some(id) = filters.ward_id {
        access::ward(&wards, id)?;
    }
    let mut q = nursing_task_query();
    q.push(" WHERE nursing_tasks.facility_id=")
        .push_bind(actor.facility_id);
    if let Some(ids) = wards {
        q.push(" AND nursing_tasks.service_ward_id=ANY(")
            .push_bind(ids)
            .push(")");
    }
    if let Some(id) = filters.ward_id {
        q.push(" AND nursing_tasks.service_ward_id=").push_bind(id);
    }
    if let Some(id) = filters.patient_id {
        q.push(" AND nursing_tasks.patient_id=").push_bind(id);
    }
    if let Some(id) = filters.admission_case_id {
        q.push(" AND nursing_tasks.admission_case_id=")
            .push_bind(id);
    }
    if let Some(kind) = filters.task_type {
        q.push(" AND nursing_tasks.task_type=")
            .push_bind(codec::encode(kind)?);
    }
    if let Some(status) = filters.status {
        q.push(" AND nursing_tasks.status=")
            .push_bind(codec::encode(status)?);
    }
    if let Some(from) = filters.due_from {
        q.push(" AND nursing_tasks.due_at>=").push_bind(from);
    }
    if let Some(before) = filters.due_before {
        q.push(" AND nursing_tasks.due_at<").push_bind(before);
    }
    let desc = filters.descending.unwrap_or(false);
    if let Some(c) = cursor {
        q.push(if desc {
            " AND (nursing_tasks.due_at,nursing_tasks.id)<("
        } else {
            " AND (nursing_tasks.due_at,nursing_tasks.id)>("
        })
        .push_bind(c.occurred_at)
        .push(",")
        .push_bind(c.id)
        .push(")");
    }
    q.push(if desc {
        " ORDER BY nursing_tasks.due_at DESC,nursing_tasks.id DESC LIMIT "
    } else {
        " ORDER BY nursing_tasks.due_at,nursing_tasks.id LIMIT "
    })
    .push_bind(limit.clamp(1, 101));
    let rows = observe_db_query(
        "ward.nursing_tasks.list",
        q.build_query_as::<NursingTaskRow>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(nursing_task_from_row)
        .collect::<anyhow::Result<Vec<_>>>()?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}

pub async fn create_nursing_task_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    task: NewNursingTask,
) -> anyhow::Result<NursingTaskListItem> {
    use super::nursing_access as access;
    let mut tx = pool.begin().await?;
    crate::network::prelock_publication_users_tx(
        &mut tx,
        actor.facility_id,
        actor.user_id,
        &task.assigned_to_user_id.into_iter().collect::<Vec<_>>(),
    )
    .await?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    access::admission(
        &mut tx,
        &actor,
        &wards,
        task.admission_case_id,
        task.patient_id,
        Some(task.ward_id),
        true,
    )
    .await?;
    if let Some(user) = task.assigned_to_user_id {
        access::assignee(&mut tx, actor.facility_id, task.ward_id, user).await?;
    }
    sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,title,instruction,status,due_at,assigned_to_user_id,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11)")
        .bind(task.id).bind(actor.facility_id).bind(task.admission_case_id).bind(task.patient_id).bind(task.ward_id).bind(codec::encode(task.task_type)?).bind(task.title).bind(task.instruction).bind(task.due_at).bind(task.assigned_to_user_id).bind(actor.user_id).execute(&mut *tx).await?;
    access::audit(
        &mut tx,
        &actor,
        task.id,
        "nursing.task.created",
        "nursing_task",
    )
    .await?;
    let result = task_tx(&mut tx, actor.facility_id, task.id).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}

/// One source lock serializes competing terminal decisions. Same-state reads never rewrite provenance.
pub async fn decide_nursing_task_for_actor(
    pool: &PgPool,
    mut actor: super::nursing_access::NursingActor,
    id: Uuid,
    target: NursingTaskStatus,
) -> anyhow::Result<NursingTaskListItem> {
    use super::nursing_access::{self as access, NursingError};
    let mut tx = pool.begin().await?;
    let row:Option<(Uuid,Uuid,Uuid,String)>=sqlx::query_as("SELECT patient_id,admission_case_id,service_ward_id,status FROM nursing_tasks WHERE facility_id=$1 AND id=$2 FOR UPDATE")
        .bind(actor.facility_id).bind(id).fetch_optional(&mut *tx).await?;
    let (patient, admission, ward, status) = row.ok_or(NursingError::NotFound)?;
    let wards = access::verify(&mut tx, &mut actor).await?;
    access::ward(&wards, ward)?;
    let requested = codec::encode(target)?;
    if status != requested {
        if status != "open" || target == NursingTaskStatus::Open {
            return Err(NursingError::TerminalConflict.into());
        }
        if target == NursingTaskStatus::Completed {
            access::admission(
                &mut tx,
                &actor,
                &wards,
                admission,
                patient,
                Some(ward),
                true,
            )
            .await?;
            sqlx::query("UPDATE nursing_tasks SET status='completed',completed_at=clock_timestamp(),completed_by_user_id=$3,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND status='open'")
                .bind(actor.facility_id).bind(id).bind(actor.user_id).execute(&mut *tx).await?;
        } else {
            // Cancellation retires the captured task; it does not claim care was performed.
            sqlx::query("UPDATE nursing_tasks SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by_user_id=$3,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND status='open'")
                .bind(actor.facility_id).bind(id).bind(actor.user_id).execute(&mut *tx).await?;
        }
        access::audit(
            &mut tx,
            &actor,
            id,
            if target == NursingTaskStatus::Completed {
                "nursing.task.completed"
            } else {
                "nursing.task.cancelled"
            },
            "nursing_task",
        )
        .await?;
    }
    let result = task_tx(&mut tx, actor.facility_id, id).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
async fn task_tx(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<NursingTaskListItem> {
    let mut q = nursing_task_query();
    q.push(" WHERE nursing_tasks.facility_id=")
        .push_bind(facility)
        .push(" AND nursing_tasks.id=")
        .push_bind(id);
    nursing_task_from_row(
        q.build_query_as::<NursingTaskRow>()
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(super::nursing_access::NursingError::NotFound)?,
    )
}

fn nursing_task_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT nursing_tasks.assigned_to_user_id, nursing_tasks.ward_id, nursing_tasks.service_ward_id, nursing_tasks.route_version, nursing_tasks.completed_at, nursing_tasks.completed_by_user_id,
               nursing_tasks.cancelled_at, nursing_tasks.cancelled_by_user_id, nursing_tasks.id,
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
        JOIN patients ON patients.id = nursing_tasks.patient_id AND patients.facility_id=nursing_tasks.facility_id
        JOIN admission_cases task_admission ON task_admission.id=nursing_tasks.admission_case_id AND task_admission.facility_id=nursing_tasks.facility_id AND task_admission.patient_id=nursing_tasks.patient_id
        JOIN wards task_ward ON task_ward.id=nursing_tasks.ward_id AND task_ward.facility_id=nursing_tasks.facility_id
        JOIN wards service_ward ON service_ward.id=nursing_tasks.service_ward_id AND service_ward.facility_id=nursing_tasks.facility_id
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
        assigned_to_user_id: row.assigned_to_user_id,
        ward_id: row.ward_id,
        service_ward_id: row.service_ward_id,
        route_version: row.route_version,
        completed_at: row.completed_at,
        completed_by_user_id: row.completed_by_user_id,
        cancelled_at: row.cancelled_at,
        cancelled_by_user_id: row.cancelled_by_user_id,
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
