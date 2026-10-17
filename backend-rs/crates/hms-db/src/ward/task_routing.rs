//! Bounded, source-locked task routing inside an already authorized admission move.
use chrono::{DateTime, Utc};
use hms_observability::observe_db_query;
use serde::Serialize;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

const MAX_OPEN_TASKS: usize = 500;

#[derive(Clone, Debug, Serialize, FromRow, PartialEq, Eq)]
pub(crate) struct OpenTaskRoute {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub service_ward_id: Uuid,
    pub assigned_to_user_id: Option<Uuid>,
    pub route_version: i64,
    pub status: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RoutingError {
    Busy,
    TooMany,
    SourceChanged,
    InvalidScope,
}

impl std::fmt::Display for RoutingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Busy => "Reviewed nursing work is currently in use.",
            Self::TooMany => "The admission has too many open nursing tasks to move.",
            Self::SourceChanged => "Reviewed nursing work has changed.",
            Self::InvalidScope => "Reviewed nursing work has an inconsistent scope.",
        })
    }
}
impl std::error::Error for RoutingError {}

pub(crate) async fn read_open_routes_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    case: Uuid,
) -> anyhow::Result<Vec<OpenTaskRoute>> {
    // Do not remove malformed patient/ward tuples from the complete membership review.
    let rows = observe_db_query(
        "ward.task_routing.read_open",
        sqlx::query_as::<_, OpenTaskRoute>(
            "SELECT id,patient_id,ward_id,service_ward_id,assigned_to_user_id,route_version,status,updated_at FROM nursing_tasks WHERE facility_id=$1 AND admission_case_id=$2 AND status='open' ORDER BY id LIMIT 501",
        )
        .bind(facility)
        .bind(case)
        .fetch_all(&mut **tx),
    )
    .await?;
    validate_review(&rows)?;
    Ok(rows)
}

pub(crate) async fn lock_reviewed_routes_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    case: Uuid,
    reviewed: &[OpenTaskRoute],
) -> anyhow::Result<()> {
    validate_review(reviewed)?;
    if reviewed.is_empty() {
        return Ok(());
    }
    let ids: Vec<Uuid> = reviewed.iter().map(|task| task.id).collect();
    // Acquire only the reviewed children, in a stable order, before the parent's gate.
    let locked = observe_db_query(
        "ward.task_routing.lock_reviewed",
        sqlx::query_as::<_, OpenTaskRoute>(
            "SELECT id,patient_id,ward_id,service_ward_id,assigned_to_user_id,route_version,status,updated_at FROM nursing_tasks WHERE facility_id=$1 AND admission_case_id=$2 AND id=ANY($3) ORDER BY id FOR UPDATE NOWAIT",
        )
        .bind(facility)
        .bind(case)
        .bind(ids)
        .fetch_all(&mut **tx),
    )
    .await
    .map_err(lock_error)?;
    if locked != reviewed {
        return Err(RoutingError::SourceChanged.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn apply_reviewed_routes_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    case: Uuid,
    patient: Uuid,
    reviewed: &[OpenTaskRoute],
    move_id: Uuid,
    actor_user_id: Uuid,
    moved_at: DateTime<Utc>,
    destination_ward_id: Uuid,
) -> anyhow::Result<()> {
    validate_review(reviewed)?;
    if reviewed.is_empty() {
        return Ok(());
    }
    if facility.is_nil()
        || case.is_nil()
        || patient.is_nil()
        || move_id.is_nil()
        || actor_user_id.is_nil()
        || destination_ward_id.is_nil()
        || reviewed.iter().any(|task| task.patient_id != patient)
    {
        return Err(RoutingError::InvalidScope.into());
    }
    let ids: Vec<_> = reviewed.iter().map(|task| task.id).collect();
    let origins: Vec<_> = reviewed.iter().map(|task| task.ward_id).collect();
    let services: Vec<_> = reviewed.iter().map(|task| task.service_ward_id).collect();
    let assignees: Vec<_> = reviewed
        .iter()
        .map(|task| task.assigned_to_user_id)
        .collect();
    let versions: Vec<_> = reviewed.iter().map(|task| task.route_version).collect();
    let updated: Vec<_> = reviewed.iter().map(|task| task.updated_at).collect();
    let event_ids: Vec<_> = reviewed.iter().map(|_| Uuid::new_v4()).collect();

    // The caller retains exactly these source locks. Match every reviewed value defensively;
    // a membership change is a definite review conflict, never partial routing.
    let changed = observe_db_query(
        "ward.task_routing.apply",
        sqlx::query(
            r#"UPDATE nursing_tasks AS task
            SET service_ward_id=$4,assigned_to_user_id=NULL,route_version=task.route_version+1,updated_at=$5
            FROM UNNEST($6::uuid[],$7::uuid[],$8::uuid[],$9::uuid[],$10::bigint[],$11::timestamptz[])
                AS reviewed(id,origin_ward_id,service_ward_id,assignee_id,route_version,updated_at)
            WHERE task.facility_id=$1 AND task.admission_case_id=$2 AND task.patient_id=$3
              AND task.id=reviewed.id AND task.status='open'
              AND task.ward_id=reviewed.origin_ward_id AND task.service_ward_id=reviewed.service_ward_id
              AND task.assigned_to_user_id IS NOT DISTINCT FROM reviewed.assignee_id
              AND task.route_version=reviewed.route_version AND task.updated_at=reviewed.updated_at"#,
        )
        .bind(facility)
        .bind(case)
        .bind(patient)
        .bind(destination_ward_id)
        .bind(moved_at)
        .bind(&ids)
        .bind(&origins)
        .bind(&services)
        .bind(&assignees)
        .bind(&versions)
        .bind(&updated)
        .execute(&mut **tx),
    )
    .await?;
    if changed.rows_affected() != reviewed.len() as u64 {
        return Err(RoutingError::SourceChanged.into());
    }
    let inserted = observe_db_query(
        "ward.task_routing.record",
        sqlx::query(
            r#"INSERT INTO nursing_task_routes(
                id,facility_id,task_id,admission_case_id,patient_id,move_id,route_version,
                origin_ward_id,from_service_ward_id,to_service_ward_id,from_assigned_to_user_id,
                to_assigned_to_user_id,routed_by_user_id,routed_at)
            SELECT reviewed.event_id,$1,reviewed.task_id,$2,$3,$4,reviewed.route_version+1,
                reviewed.origin_ward_id,reviewed.service_ward_id,$5,reviewed.assignee_id,NULL,$6,$7
            FROM UNNEST($8::uuid[],$9::uuid[],$10::uuid[],$11::uuid[],$12::uuid[],$13::bigint[])
                AS reviewed(event_id,task_id,origin_ward_id,service_ward_id,assignee_id,route_version)"#,
        )
        .bind(facility)
        .bind(case)
        .bind(patient)
        .bind(move_id)
        .bind(destination_ward_id)
        .bind(actor_user_id)
        .bind(moved_at)
        .bind(event_ids)
        .bind(ids)
        .bind(origins)
        .bind(services)
        .bind(assignees)
        .bind(versions)
        .execute(&mut **tx),
    )
    .await?;
    if inserted.rows_affected() != reviewed.len() as u64 {
        return Err(RoutingError::SourceChanged.into());
    }
    Ok(())
}

fn validate_review(reviewed: &[OpenTaskRoute]) -> anyhow::Result<()> {
    if reviewed.len() > MAX_OPEN_TASKS {
        return Err(RoutingError::TooMany.into());
    }
    if reviewed.windows(2).any(|pair| pair[0].id >= pair[1].id)
        || reviewed.iter().any(|task| {
            task.id.is_nil()
                || task.patient_id.is_nil()
                || task.ward_id.is_nil()
                || task.service_ward_id.is_nil()
                || task.status != "open"
                || task.route_version < 0
                || task.route_version.checked_add(1).is_none()
        })
    {
        return Err(RoutingError::InvalidScope.into());
    }
    Ok(())
}

fn lock_error(error: sqlx::Error) -> anyhow::Error {
    if matches!(&error, sqlx::Error::Database(db) if db.code().as_deref() == Some("55P03")) {
        RoutingError::Busy.into()
    } else {
        error.into()
    }
}

#[cfg(test)]
#[path = "task_routing_tests.rs"]
mod tests;
