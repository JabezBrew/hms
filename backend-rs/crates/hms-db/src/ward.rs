use chrono::{DateTime, Utc};
use hms_domain::ward::{AdmissionCaseListItem, AdmissionStatus, BedStatus, WardBoardItem};
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

mod admin;
mod bed_management;
mod discharge_cases;
mod handoff;
mod mar;
mod nursing_task_board;
mod observations_monitoring;
mod ward_stock;

pub use admin::{
    create_ward, create_ward_section, get_ward, get_ward_section_by_id, list_ward_sections,
    list_wards, update_ward, update_ward_section, NewWard, NewWardSection, WardSectionUpdate,
    WardUpdate,
};
pub use bed_management::{
    create_bed, get_bed_by_id, list_section_beds, list_ward_beds, update_bed, BedUpdate, NewBed,
};
pub use discharge_cases::{
    cancel_discharge, complete_discharge, get_discharge_case, list_discharge_cases,
    request_discharge,
};
pub use handoff::{complete_handoff, create_handoff, get_handoff, list_handoffs, NewHandoff};
pub use mar::{
    administer_medication, create_treatment_sheet, get_medication_administration,
    list_medication_administrations, list_treatment_sheets, schedule_medication_administration,
    NewMedicationAdministration, NewTreatmentSheet,
};
pub use nursing_task_board::{
    cancel_nursing_task, complete_nursing_task, create_nursing_task, get_nursing_task,
    list_nursing_tasks, NewNursingTask,
};
pub use observations_monitoring::{
    acknowledge_nursing_alert, create_fluid_balance_entry, create_monitoring_event,
    create_nursing_alert, create_patient_vitals, get_nursing_alert, list_fluid_balance_entries,
    list_monitoring_events, list_nursing_alerts, list_patient_vitals, NewFluidBalanceEntry,
    NewMonitoringEvent, NewNursingAlert, NewPatientVitals,
};
pub use ward_stock::{
    approve_ward_stock_request, create_ward_stock_request, fulfill_ward_stock_request,
    list_ward_stock_requests, NewWardStockRequest,
};

#[derive(Clone, Debug)]
pub struct WardCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub struct AdmissionContext {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub bed_id: Option<Uuid>,
}

#[derive(Clone, Debug)]
pub struct NewAdmission {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub bed_id: Option<Uuid>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewAdmissionCase {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct WardBoardRow {
    admission_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    ward_id: Uuid,
    ward_name: String,
    bed_id: Option<Uuid>,
    bed_code: Option<String>,
    admission_status: String,
    admitted_at: DateTime<Utc>,
    open_nursing_task_count: i64,
    due_medication_count: i64,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionCaseRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    ward_id: Uuid,
    ward_name: String,
    bed_id: Option<Uuid>,
    bed_code: Option<String>,
    status: String,
    created_at: DateTime<Utc>,
    admitted_at: Option<DateTime<Utc>>,
    discharged_at: Option<DateTime<Utc>>,
}

pub async fn list_ward_board(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<WardBoardItem>> {
    let mut query = ward_board_query();
    query.push(" WHERE admission_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND admission_cases.status IN ('admitted', 'discharge_pending')");

    if let Some(ward_id) = ward_id {
        query.push(" AND admission_cases.ward_id = ");
        query.push_bind(ward_id);
    }

    if let Some(patient_id) = patient_id {
        query.push(" AND admission_cases.patient_id = ");
        query.push_bind(patient_id);
    }

    if let Some(cursor) = cursor {
        query.push(" AND (admission_cases.admitted_at, admission_cases.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY admission_cases.admitted_at ASC, admission_cases.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<WardBoardRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(ward_board_from_row).collect()
}

pub async fn get_ward_board_admission(
    pool: &PgPool,
    facility_id: Uuid,
    admission_id: Uuid,
) -> anyhow::Result<Option<WardBoardItem>> {
    let mut query = ward_board_query();
    query.push(" WHERE admission_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND admission_cases.status IN ('admitted', 'discharge_pending')");
    query.push(" AND admission_cases.id = ");
    query.push_bind(admission_id);
    let row = query
        .build_query_as::<WardBoardRow>()
        .fetch_optional(pool)
        .await?;
    row.map(ward_board_from_row).transpose()
}

pub async fn get_admission_context(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<Option<AdmissionContext>> {
    Ok(sqlx::query_as::<_, AdmissionContextRow>(
        r#"
        SELECT id,
               patient_id,
               ward_id,
               bed_id
        FROM admission_cases
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(admission_case_id)
    .fetch_optional(pool)
    .await?
    .map(|row| AdmissionContext {
        id: row.id,
        patient_id: row.patient_id,
        ward_id: row.ward_id,
        bed_id: row.bed_id,
    }))
}

pub async fn list_admission_cases(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<AdmissionCaseListItem>> {
    let mut query = admission_case_query();
    query.push(" WHERE admission_cases.facility_id = ");
    query.push_bind(facility_id);

    if let Some(cursor) = cursor {
        query.push(" AND (admission_cases.created_at, admission_cases.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY admission_cases.created_at ASC, admission_cases.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<AdmissionCaseRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(admission_case_from_row).collect()
}

pub async fn get_admission_case(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    optional_admission_case_by_id(pool, facility_id, admission_case_id).await
}

pub async fn create_admission_case(
    pool: &PgPool,
    admission: NewAdmissionCase,
) -> anyhow::Result<AdmissionCaseListItem> {
    let inserted = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO admission_cases (
            id,
            facility_id,
            patient_id,
            ward_id,
            bed_id,
            status,
            attending_user_id,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, NULL, $5, $6, $6
        WHERE EXISTS (
            SELECT 1
            FROM patients
            WHERE patients.facility_id = $2
              AND patients.id = $3
        )
          AND EXISTS (
            SELECT 1
            FROM wards
            WHERE wards.facility_id = $2
              AND wards.id = $4
              AND wards.status = 'active'
        )
        RETURNING id
        "#,
    )
    .bind(admission.id)
    .bind(admission.facility_id)
    .bind(admission.patient_id)
    .bind(admission.ward_id)
    .bind(codec::encode(AdmissionStatus::ReadyForActivation)?)
    .bind(admission.actor_user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("patient or ward not found for admission case"))?;

    admission_case_by_id(pool, admission.facility_id, inserted).await
}

pub async fn reserve_admission_bed(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
    requested_bed_id: Option<Uuid>,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let case = sqlx::query_as::<_, AdmissionContextStatusRow>(
        r#"
        SELECT id,
               patient_id,
               ward_id,
               bed_id,
               status
        FROM admission_cases
        WHERE facility_id = $1
          AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(facility_id)
    .bind(admission_case_id)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(case) = case else {
        return Ok(None);
    };
    if case.status != codec::encode(AdmissionStatus::ReadyForActivation)? {
        return Ok(None);
    }

    let bed_id = match requested_bed_id.or(case.bed_id) {
        Some(bed_id) => {
            let locked_bed =
                lock_available_bed(&mut transaction, facility_id, case.ward_id, Some(bed_id))
                    .await?;
            if locked_bed.is_none() {
                return Ok(None);
            }
            Some(bed_id)
        }
        None => lock_available_bed(&mut transaction, facility_id, case.ward_id, None).await?,
    };

    let Some(bed_id) = bed_id else {
        return Ok(None);
    };

    sqlx::query(
        r#"
        UPDATE beds
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND ward_id = $3
          AND id = $4
        "#,
    )
    .bind(codec::encode(BedStatus::Reserved)?)
    .bind(facility_id)
    .bind(case.ward_id)
    .bind(bed_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE admission_cases
        SET bed_id = $1,
            attending_user_id = $2,
            updated_at = now()
        WHERE facility_id = $3
          AND id = $4
        "#,
    )
    .bind(bed_id)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(case.id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    optional_admission_case_by_id(pool, facility_id, case.id).await
}

pub async fn activate_admission_case(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let case = sqlx::query_as::<_, AdmissionContextStatusRow>(
        r#"
        SELECT id,
               patient_id,
               ward_id,
               bed_id,
               status
        FROM admission_cases
        WHERE facility_id = $1
          AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(facility_id)
    .bind(admission_case_id)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(case) = case else {
        return Ok(None);
    };
    if case.status != codec::encode(AdmissionStatus::ReadyForActivation)? {
        return Ok(None);
    }

    let bed_id = match case.bed_id {
        Some(bed_id) => {
            let status = sqlx::query_scalar::<_, String>(
                r#"
                SELECT status
                FROM beds
                WHERE facility_id = $1
                  AND ward_id = $2
                  AND id = $3
                FOR UPDATE
                "#,
            )
            .bind(facility_id)
            .bind(case.ward_id)
            .bind(bed_id)
            .fetch_optional(&mut *transaction)
            .await?;
            match status.as_deref() {
                Some("available") | Some("reserved") => Some(bed_id),
                _ => return Ok(None),
            }
        }
        None => lock_available_bed(&mut transaction, facility_id, case.ward_id, None).await?,
    };

    let Some(bed_id) = bed_id else {
        return Ok(None);
    };

    sqlx::query(
        r#"
        UPDATE beds
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND ward_id = $3
          AND id = $4
        "#,
    )
    .bind(codec::encode(BedStatus::Occupied)?)
    .bind(facility_id)
    .bind(case.ward_id)
    .bind(bed_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE admission_cases
        SET bed_id = $1,
            status = $2,
            admitted_at = now(),
            attending_user_id = $3,
            updated_at = now()
        WHERE facility_id = $4
          AND id = $5
        "#,
    )
    .bind(bed_id)
    .bind(codec::encode(AdmissionStatus::Admitted)?)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(case.id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    optional_admission_case_by_id(pool, facility_id, case.id).await
}

pub async fn cancel_admission_case(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    let mut transaction = pool.begin().await?;
    let case = sqlx::query_as::<_, AdmissionContextStatusRow>(
        r#"
        SELECT id,
               patient_id,
               ward_id,
               bed_id,
               status
        FROM admission_cases
        WHERE facility_id = $1
          AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(facility_id)
    .bind(admission_case_id)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(case) = case else {
        return Ok(None);
    };
    if case.status != codec::encode(AdmissionStatus::ReadyForActivation)? {
        return Ok(None);
    }

    if let Some(bed_id) = case.bed_id {
        sqlx::query(
            r#"
            UPDATE beds
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2
              AND ward_id = $3
              AND id = $4
              AND status = $5
            "#,
        )
        .bind(codec::encode(BedStatus::Available)?)
        .bind(facility_id)
        .bind(case.ward_id)
        .bind(bed_id)
        .bind(codec::encode(BedStatus::Reserved)?)
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query(
        r#"
        UPDATE admission_cases
        SET status = $1,
            attending_user_id = $2,
            updated_at = now()
        WHERE facility_id = $3
          AND id = $4
        "#,
    )
    .bind(codec::encode(AdmissionStatus::Cancelled)?)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(case.id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    optional_admission_case_by_id(pool, facility_id, case.id).await
}

pub async fn admit_patient(
    pool: &PgPool,
    admission: NewAdmission,
) -> anyhow::Result<WardBoardItem> {
    let mut transaction = pool.begin().await?;
    let bed_id = match admission.bed_id {
        Some(bed_id) => Some(bed_id),
        None => {
            sqlx::query_scalar::<_, Uuid>(
                r#"
            SELECT id
            FROM beds
            WHERE facility_id = $1
              AND ward_id = $2
              AND status = $3
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            "#,
            )
            .bind(admission.facility_id)
            .bind(admission.ward_id)
            .bind(codec::encode(BedStatus::Available)?)
            .fetch_optional(&mut *transaction)
            .await?
        }
    };

    sqlx::query(
        r#"
        INSERT INTO admission_cases (
            id,
            facility_id,
            patient_id,
            ward_id,
            bed_id,
            status,
            attending_user_id,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        "#,
    )
    .bind(admission.id)
    .bind(admission.facility_id)
    .bind(admission.patient_id)
    .bind(admission.ward_id)
    .bind(bed_id)
    .bind(codec::encode(AdmissionStatus::Admitted)?)
    .bind(admission.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    if let Some(bed_id) = bed_id {
        sqlx::query(
            r#"
            UPDATE beds
            SET status = $1,
                updated_at = now()
            WHERE facility_id = $2
              AND ward_id = $3
              AND id = $4
            "#,
        )
        .bind(codec::encode(BedStatus::Occupied)?)
        .bind(admission.facility_id)
        .bind(admission.ward_id)
        .bind(bed_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    ward_board_item_by_admission(pool, admission.facility_id, admission.id).await
}

fn ward_board_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT admission_cases.id AS admission_id,
               admission_cases.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               admission_cases.ward_id,
               wards.name AS ward_name,
               admission_cases.bed_id,
               beds.bed_code,
               admission_cases.status AS admission_status,
               admission_cases.admitted_at,
               COALESCE(task_counts.open_nursing_task_count, 0) AS open_nursing_task_count,
               COALESCE(med_counts.due_medication_count, 0) AS due_medication_count
        FROM admission_cases
        JOIN patients ON patients.id = admission_cases.patient_id
        JOIN wards ON wards.id = admission_cases.ward_id
        LEFT JOIN beds ON beds.id = admission_cases.bed_id
        LEFT JOIN (
            SELECT admission_case_id, count(*) AS open_nursing_task_count
            FROM nursing_tasks
            WHERE status = 'open'
            GROUP BY admission_case_id
        ) task_counts ON task_counts.admission_case_id = admission_cases.id
        LEFT JOIN (
            SELECT admission_case_id, count(*) AS due_medication_count
            FROM medication_administrations
            WHERE status = 'scheduled' AND scheduled_at <= now()
            GROUP BY admission_case_id
        ) med_counts ON med_counts.admission_case_id = admission_cases.id
        "#,
    )
}

fn admission_case_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT admission_cases.id,
               admission_cases.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               admission_cases.ward_id,
               wards.name AS ward_name,
               admission_cases.bed_id,
               beds.bed_code,
               admission_cases.status,
               admission_cases.created_at,
               CASE
                   WHEN admission_cases.status IN ('admitted', 'discharge_pending', 'discharged')
                   THEN admission_cases.admitted_at
                   ELSE NULL
               END AS admitted_at,
               admission_cases.discharged_at
        FROM admission_cases
        JOIN patients
          ON patients.id = admission_cases.patient_id
         AND patients.facility_id = admission_cases.facility_id
        JOIN wards
          ON wards.id = admission_cases.ward_id
         AND wards.facility_id = admission_cases.facility_id
        LEFT JOIN beds
          ON beds.id = admission_cases.bed_id
         AND beds.facility_id = admission_cases.facility_id
        "#,
    )
}

async fn ward_board_item_by_admission(
    pool: &PgPool,
    facility_id: Uuid,
    admission_id: Uuid,
) -> anyhow::Result<WardBoardItem> {
    get_ward_board_admission(pool, facility_id, admission_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("ward board admission was not found after write"))
}

async fn admission_case_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<AdmissionCaseListItem> {
    optional_admission_case_by_id(pool, facility_id, admission_case_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("admission case was not found after write"))
}

async fn optional_admission_case_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
) -> anyhow::Result<Option<AdmissionCaseListItem>> {
    let mut query = admission_case_query();
    query.push(" WHERE admission_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND admission_cases.id = ");
    query.push_bind(admission_case_id);
    let row = query
        .build_query_as::<AdmissionCaseRow>()
        .fetch_optional(pool)
        .await?;
    row.map(admission_case_from_row).transpose()
}

async fn lock_available_bed(
    transaction: &mut Transaction<'_, Postgres>,
    facility_id: Uuid,
    ward_id: Uuid,
    bed_id: Option<Uuid>,
) -> anyhow::Result<Option<Uuid>> {
    match bed_id {
        Some(bed_id) => sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id
            FROM beds
            WHERE facility_id = $1
              AND ward_id = $2
              AND id = $3
              AND status = $4
            FOR UPDATE
            "#,
        )
        .bind(facility_id)
        .bind(ward_id)
        .bind(bed_id)
        .bind(codec::encode(BedStatus::Available)?)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(Into::into),
        None => sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id
            FROM beds
            WHERE facility_id = $1
              AND ward_id = $2
              AND status = $3
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            "#,
        )
        .bind(facility_id)
        .bind(ward_id)
        .bind(codec::encode(BedStatus::Available)?)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(Into::into),
    }
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionContextRow {
    id: Uuid,
    patient_id: Uuid,
    ward_id: Uuid,
    bed_id: Option<Uuid>,
}

#[derive(Clone, Debug, FromRow)]
struct AdmissionContextStatusRow {
    id: Uuid,
    ward_id: Uuid,
    bed_id: Option<Uuid>,
    status: String,
}

fn ward_board_from_row(row: WardBoardRow) -> anyhow::Result<WardBoardItem> {
    Ok(WardBoardItem {
        admission_id: row.admission_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        bed_id: row.bed_id,
        bed_code: row.bed_code,
        admission_status: codec::decode(&row.admission_status)?,
        admitted_at: row.admitted_at,
        open_nursing_task_count: row.open_nursing_task_count,
        due_medication_count: row.due_medication_count,
    })
}

fn admission_case_from_row(row: AdmissionCaseRow) -> anyhow::Result<AdmissionCaseListItem> {
    Ok(AdmissionCaseListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        bed_id: row.bed_id,
        bed_code: row.bed_code,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
        admitted_at: row.admitted_at,
        discharged_at: row.discharged_at,
    })
}
