use chrono::{DateTime, Utc};
use hms_domain::ward::{AdmissionStatus, BedStatus, DischargeCaseListItem, DischargeStatus};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::{AdmissionContext, WardCursor};

#[derive(Clone, Debug, FromRow)]
struct DischargeCaseRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    status: String,
    requested_at: DateTime<Utc>,
    discharged_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionContextRow {
    bed_id: Option<Uuid>,
}

#[derive(Clone, Debug, FromRow)]
struct DischargeContextRow {
    admission_case_id: Uuid,
}

pub async fn list_discharge_cases(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<DischargeCaseListItem>> {
    let mut query = discharge_query();
    query.push(" WHERE discharge_cases.facility_id = ");
    query.push_bind(facility_id);
    if let Some(cursor) = cursor {
        query.push(" AND (discharge_cases.requested_at, discharge_cases.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY discharge_cases.requested_at ASC, discharge_cases.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = observe_db_query(
        "ward.discharge_cases.list",
        query.build_query_as::<DischargeCaseRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter().map(discharge_from_row).collect()
}

pub async fn get_discharge_case(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let mut query = discharge_query();
    query.push(" WHERE discharge_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND discharge_cases.id = ");
    query.push_bind(discharge_case_id);
    let row = observe_db_query(
        "ward.discharge_cases.get",
        query
            .build_query_as::<DischargeCaseRow>()
            .fetch_optional(pool),
    )
    .await?;
    row.map(discharge_from_row).transpose()
}

pub async fn request_discharge(
    pool: &PgPool,
    id: Uuid,
    facility_id: Uuid,
    admission: &AdmissionContext,
    actor_user_id: Uuid,
) -> anyhow::Result<DischargeCaseListItem> {
    let mut transaction = pool.begin().await?;
    observe_db_query(
        "ward.discharge_cases.request.insert",
        sqlx::query(
            r#"
        INSERT INTO discharge_cases (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (admission_case_id) DO UPDATE
        SET status = EXCLUDED.status,
            updated_at = now()
        "#,
        )
        .bind(id)
        .bind(facility_id)
        .bind(admission.id)
        .bind(admission.patient_id)
        .bind(codec::encode(DischargeStatus::Requested)?)
        .bind(actor_user_id)
        .execute(&mut *transaction),
    )
    .await?;

    observe_db_query(
        "ward.discharge_cases.request.mark_admission_pending",
        sqlx::query(
            r#"
        UPDATE admission_cases
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
        )
        .bind(codec::encode(AdmissionStatus::DischargePending)?)
        .bind(facility_id)
        .bind(admission.id)
        .execute(&mut *transaction),
    )
    .await?;

    transaction.commit().await?;
    discharge_item_by_admission(pool, facility_id, admission.id).await
}

pub async fn complete_discharge(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let row = observe_db_query(
        "ward.discharge_cases.complete.mark_discharge",
        sqlx::query_as::<_, DischargeContextRow>(
            r#"
        UPDATE discharge_cases
        SET status = $1,
            discharged_at = COALESCE(discharged_at, now()),
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        RETURNING admission_case_id
        "#,
        )
        .bind(codec::encode(DischargeStatus::Completed)?)
        .bind(facility_id)
        .bind(discharge_case_id)
        .fetch_optional(&mut *transaction),
    )
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let admission = observe_db_query(
        "ward.discharge_cases.complete.mark_admission_discharged",
        sqlx::query_as::<_, AdmissionContextRow>(
            r#"
        UPDATE admission_cases
        SET status = $1,
            discharged_at = COALESCE(discharged_at, now()),
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        RETURNING bed_id
        "#,
        )
        .bind(codec::encode(AdmissionStatus::Discharged)?)
        .bind(facility_id)
        .bind(row.admission_case_id)
        .fetch_one(&mut *transaction),
    )
    .await?;

    if let Some(bed_id) = admission.bed_id {
        observe_db_query(
            "ward.discharge_cases.complete.release_bed",
            sqlx::query(
                r#"
            UPDATE beds
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2 AND id = $3
            "#,
            )
            .bind(codec::encode(BedStatus::Available)?)
            .bind(facility_id)
            .bind(bed_id)
            .execute(&mut *transaction),
        )
        .await?;
    }

    transaction.commit().await?;
    Ok(Some(
        discharge_item_by_admission(pool, facility_id, row.admission_case_id).await?,
    ))
}

pub async fn cancel_discharge(
    pool: &PgPool,
    facility_id: Uuid,
    discharge_case_id: Uuid,
) -> anyhow::Result<Option<DischargeCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let row = observe_db_query(
        "ward.discharge_cases.cancel.mark_discharge",
        sqlx::query_as::<_, DischargeContextRow>(
            r#"
        UPDATE discharge_cases
        SET status = $1,
            discharged_at = NULL,
            updated_at = now()
        WHERE facility_id = $2
          AND id = $3
          AND status <> $4
        RETURNING admission_case_id
        "#,
        )
        .bind(codec::encode(DischargeStatus::Cancelled)?)
        .bind(facility_id)
        .bind(discharge_case_id)
        .bind(codec::encode(DischargeStatus::Completed)?)
        .fetch_optional(&mut *transaction),
    )
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    observe_db_query(
        "ward.discharge_cases.cancel.restore_admission",
        sqlx::query(
            r#"
        UPDATE admission_cases
        SET status = $1,
            discharged_at = NULL,
            updated_at = now()
        WHERE facility_id = $2
          AND id = $3
          AND status <> $4
        "#,
        )
        .bind(codec::encode(AdmissionStatus::Admitted)?)
        .bind(facility_id)
        .bind(row.admission_case_id)
        .bind(codec::encode(AdmissionStatus::Discharged)?)
        .execute(&mut *transaction),
    )
    .await?;

    transaction.commit().await?;
    Ok(Some(
        discharge_item_by_admission(pool, facility_id, row.admission_case_id).await?,
    ))
}

fn discharge_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT discharge_cases.id,
               discharge_cases.admission_case_id,
               discharge_cases.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               discharge_cases.status,
               discharge_cases.requested_at,
               discharge_cases.discharged_at
        FROM discharge_cases
        JOIN patients ON patients.id = discharge_cases.patient_id
        "#,
    )
}

async fn discharge_item_by_admission(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<DischargeCaseListItem> {
    let mut query = discharge_query();
    query.push(" WHERE discharge_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND discharge_cases.admission_case_id = ");
    query.push_bind(admission_case_id);
    let row = observe_db_query(
        "ward.discharge_cases.get_by_admission",
        query.build_query_as::<DischargeCaseRow>().fetch_one(pool),
    )
    .await?;
    discharge_from_row(row)
}

fn discharge_from_row(row: DischargeCaseRow) -> anyhow::Result<DischargeCaseListItem> {
    Ok(DischargeCaseListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        status: codec::decode(&row.status)?,
        requested_at: row.requested_at,
        discharged_at: row.discharged_at,
    })
}
