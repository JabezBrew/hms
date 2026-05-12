use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::ward::{
    AdmissionCaseListItem, AdmissionStatus, BedListItem, BedStatus, DischargeCaseListItem,
    DischargeStatus, FluidBalanceListItem, HandoffListItem, HandoffStatus,
    MedicationAdministrationListItem, MedicationAdministrationStatus, MonitoringEventKind,
    MonitoringEventListItem, NursingAlertListItem, NursingAlertSeverity, NursingAlertStatus,
    NursingTaskListItem, NursingTaskStatus, NursingTaskType, PatientVitalsListItem,
    TreatmentSheetListItem, TreatmentSheetStatus, WardBoardItem, WardListItem, WardSectionListItem,
    WardStatus, WardStockRequestListItem, WardStockRequestStatus,
};
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

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
pub struct NewWardSection {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub ward_id: Uuid,
    pub code: String,
    pub name: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewBed {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub ward_id: Uuid,
    pub section_id: Option<Uuid>,
    pub bed_code: String,
    pub actor_user_id: Uuid,
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

#[derive(Clone, Debug)]
pub struct NewNursingTask {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub task_type: NursingTaskType,
    pub due_at: DateTime<Utc>,
    pub assigned_to_user_id: Option<Uuid>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewMedicationAdministration {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub medication_name: String,
    pub scheduled_at: DateTime<Utc>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewHandoff {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub ward_id: Uuid,
    pub from_user_id: Uuid,
    pub to_user_id: Uuid,
    pub shift_label: String,
}

#[derive(Clone, Debug)]
pub struct NewTreatmentSheet {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub sheet_date: NaiveDate,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewPatientVitals {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub recorded_at: DateTime<Utc>,
    pub temperature_c: Option<f32>,
    pub systolic_bp: Option<i32>,
    pub diastolic_bp: Option<i32>,
    pub pulse: Option<i32>,
    pub respiratory_rate: Option<i32>,
    pub oxygen_saturation: Option<i32>,
    pub recorded_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewNursingAlert {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub severity: NursingAlertSeverity,
    pub title: String,
    pub created_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewMonitoringEvent {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub event_kind: MonitoringEventKind,
    pub summary: String,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewFluidBalanceEntry {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub recorded_at: DateTime<Utc>,
    pub intake_ml: i32,
    pub output_ml: i32,
    pub recorded_by_user_id: Uuid,
}

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
struct WardRow {
    id: Uuid,
    code: String,
    name: String,
    status: String,
    active_bed_count: i64,
    occupied_bed_count: i64,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct WardSectionRow {
    id: Uuid,
    ward_id: Uuid,
    code: String,
    name: String,
    status: String,
    active_bed_count: i64,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct BedRow {
    id: Uuid,
    ward_id: Uuid,
    section_id: Option<Uuid>,
    bed_code: String,
    status: String,
    created_at: DateTime<Utc>,
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
struct NursingTaskRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    task_type: String,
    status: String,
    due_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct MedicationAdministrationRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    medication_name: String,
    scheduled_at: DateTime<Utc>,
    administered_at: Option<DateTime<Utc>>,
    status: String,
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

#[derive(Clone, Debug, FromRow)]
struct TreatmentSheetRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    sheet_date: NaiveDate,
    status: String,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PatientVitalsRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    recorded_at: DateTime<Utc>,
    temperature_c: Option<f32>,
    systolic_bp: Option<i32>,
    diastolic_bp: Option<i32>,
    pulse: Option<i32>,
    respiratory_rate: Option<i32>,
    oxygen_saturation: Option<i32>,
}

#[derive(Clone, Debug, FromRow)]
struct NursingAlertRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    severity: String,
    title: String,
    status: String,
    created_at: DateTime<Utc>,
    acknowledged_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct MonitoringEventRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    event_kind: String,
    summary: String,
    recorded_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct FluidBalanceRow {
    id: Uuid,
    admission_case_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_display_name: String,
    recorded_at: DateTime<Utc>,
    intake_ml: i32,
    output_ml: i32,
    net_ml: i32,
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

pub async fn list_wards(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<WardListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT wards.id,
               wards.code,
               wards.name,
               wards.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               COALESCE(bed_counts.occupied_bed_count, 0) AS occupied_bed_count,
               wards.created_at
        FROM wards
        LEFT JOIN (
            SELECT ward_id,
                   count(*) FILTER (WHERE status != 'closed') AS active_bed_count,
                   count(*) FILTER (WHERE status = 'occupied') AS occupied_bed_count
            FROM beds
            WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(
        r#"
            GROUP BY ward_id
        ) bed_counts ON bed_counts.ward_id = wards.id
        WHERE wards.facility_id =
        "#,
    );
    query.push_bind(facility_id);

    if let Some(cursor) = cursor {
        query.push(" AND (wards.created_at, wards.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY wards.created_at ASC, wards.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query.build_query_as::<WardRow>().fetch_all(pool).await?;
    rows.into_iter().map(ward_from_row).collect()
}

pub async fn get_ward(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Uuid,
) -> anyhow::Result<Option<WardListItem>> {
    let row = sqlx::query_as::<_, WardRow>(
        r#"
        SELECT wards.id,
               wards.code,
               wards.name,
               wards.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               COALESCE(bed_counts.occupied_bed_count, 0) AS occupied_bed_count,
               wards.created_at
        FROM wards
        LEFT JOIN (
            SELECT ward_id,
                   count(*) FILTER (WHERE status != 'closed') AS active_bed_count,
                   count(*) FILTER (WHERE status = 'occupied') AS occupied_bed_count
            FROM beds
            WHERE facility_id = $1
            GROUP BY ward_id
        ) bed_counts ON bed_counts.ward_id = wards.id
        WHERE wards.facility_id = $1
          AND wards.id = $2
        "#,
    )
    .bind(facility_id)
    .bind(ward_id)
    .fetch_optional(pool)
    .await?;

    row.map(ward_from_row).transpose()
}

pub async fn list_ward_sections(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<WardSectionListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT ward_sections.id,
               ward_sections.ward_id,
               ward_sections.code,
               ward_sections.name,
               ward_sections.status,
               COALESCE(bed_counts.active_bed_count, 0) AS active_bed_count,
               ward_sections.created_at
        FROM ward_sections
        LEFT JOIN (
            SELECT section_id,
                   count(*) FILTER (WHERE status != 'closed') AS active_bed_count
            FROM beds
            WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(
        r#"
              AND section_id IS NOT NULL
            GROUP BY section_id
        ) bed_counts ON bed_counts.section_id = ward_sections.id
        WHERE ward_sections.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND ward_sections.ward_id = ");
    query.push_bind(ward_id);

    if let Some(cursor) = cursor {
        query.push(" AND (ward_sections.created_at, ward_sections.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY ward_sections.created_at ASC, ward_sections.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<WardSectionRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(ward_section_from_row).collect()
}

pub async fn create_ward_section(
    pool: &PgPool,
    section: NewWardSection,
) -> anyhow::Result<WardSectionListItem> {
    let row = sqlx::query_as::<_, WardSectionRow>(
        r#"
        WITH inserted AS (
            INSERT INTO ward_sections (
                id,
                facility_id,
                ward_id,
                code,
                name,
                status,
                created_by_user_id
            )
            SELECT $1, $2, $3, $4, $5, $6, $7
            WHERE EXISTS (
                SELECT 1
                FROM wards
                WHERE wards.facility_id = $2
                  AND wards.id = $3
            )
            RETURNING id,
                      ward_id,
                      code,
                      name,
                      status,
                      created_at
        )
        SELECT inserted.id,
               inserted.ward_id,
               inserted.code,
               inserted.name,
               inserted.status,
               0::bigint AS active_bed_count,
               inserted.created_at
        FROM inserted
        "#,
    )
    .bind(section.id)
    .bind(section.facility_id)
    .bind(section.ward_id)
    .bind(section.code)
    .bind(section.name)
    .bind(codec::encode(WardStatus::Active)?)
    .bind(section.actor_user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("ward not found for section"))?;

    ward_section_from_row(row)
}

pub async fn list_ward_beds(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<BedListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT beds.id,
               beds.ward_id,
               beds.section_id,
               beds.bed_code,
               beds.status,
               beds.created_at
        FROM beds
        WHERE beds.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND beds.ward_id = ");
    query.push_bind(ward_id);

    if let Some(cursor) = cursor {
        query.push(" AND (beds.created_at, beds.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }

    query.push(" ORDER BY beds.created_at ASC, beds.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query.build_query_as::<BedRow>().fetch_all(pool).await?;
    rows.into_iter().map(bed_from_row).collect()
}

pub async fn create_bed(pool: &PgPool, bed: NewBed) -> anyhow::Result<BedListItem> {
    let row = sqlx::query_as::<_, BedRow>(
        r#"
        INSERT INTO beds (
            id,
            facility_id,
            ward_id,
            section_id,
            bed_code,
            status,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7
        WHERE EXISTS (
            SELECT 1
            FROM wards
            WHERE wards.facility_id = $2
              AND wards.id = $3
        )
          AND (
              $4::uuid IS NULL
              OR EXISTS (
                  SELECT 1
                  FROM ward_sections
                  WHERE ward_sections.facility_id = $2
                    AND ward_sections.ward_id = $3
                    AND ward_sections.id = $4
                    AND ward_sections.status = 'active'
              )
          )
        RETURNING id,
                  ward_id,
                  section_id,
                  bed_code,
                  status,
                  created_at
        "#,
    )
    .bind(bed.id)
    .bind(bed.facility_id)
    .bind(bed.ward_id)
    .bind(bed.section_id)
    .bind(bed.bed_code)
    .bind(codec::encode(BedStatus::Available)?)
    .bind(bed.actor_user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("ward or section not found for bed"))?;

    bed_from_row(row)
}

pub async fn list_ward_board(
    pool: &PgPool,
    facility_id: Uuid,
    ward_id: Option<Uuid>,
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

    let rows = query
        .build_query_as::<DischargeCaseRow>()
        .fetch_all(pool)
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
    let row = query
        .build_query_as::<DischargeCaseRow>()
        .fetch_optional(pool)
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
    .execute(&mut *transaction)
    .await?;

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
    .execute(&mut *transaction)
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
    let row = sqlx::query_as::<_, DischargeContextRow>(
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
    .fetch_optional(&mut *transaction)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let admission = sqlx::query_as::<_, AdmissionContextRow>(
        r#"
        UPDATE admission_cases
        SET status = $1,
            discharged_at = COALESCE(discharged_at, now()),
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        RETURNING id, patient_id, ward_id, bed_id
        "#,
    )
    .bind(codec::encode(AdmissionStatus::Discharged)?)
    .bind(facility_id)
    .bind(row.admission_case_id)
    .fetch_one(&mut *transaction)
    .await?;

    if let Some(bed_id) = admission.bed_id {
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
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(Some(
        discharge_item_by_admission(pool, facility_id, row.admission_case_id).await?,
    ))
}

pub async fn list_nursing_tasks(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<NursingTaskListItem>> {
    let mut query = nursing_task_query();
    query.push(" WHERE nursing_tasks.facility_id = ");
    query.push_bind(facility_id);
    if let Some(cursor) = cursor {
        query.push(" AND (nursing_tasks.due_at, nursing_tasks.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY nursing_tasks.due_at ASC, nursing_tasks.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<NursingTaskRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(nursing_task_from_row).collect()
}

pub async fn create_nursing_task(
    pool: &PgPool,
    task: NewNursingTask,
) -> anyhow::Result<NursingTaskListItem> {
    sqlx::query(
        r#"
        INSERT INTO nursing_tasks (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            ward_id,
            task_type,
            status,
            due_at,
            assigned_to_user_id,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(task.id)
    .bind(task.facility_id)
    .bind(task.admission_case_id)
    .bind(task.patient_id)
    .bind(task.ward_id)
    .bind(codec::encode(task.task_type)?)
    .bind(codec::encode(NursingTaskStatus::Open)?)
    .bind(task.due_at)
    .bind(task.assigned_to_user_id)
    .bind(task.actor_user_id)
    .execute(pool)
    .await?;

    nursing_task_by_id(pool, task.facility_id, task.id).await
}

pub async fn complete_nursing_task(
    pool: &PgPool,
    facility_id: Uuid,
    task_id: Uuid,
) -> anyhow::Result<Option<NursingTaskListItem>> {
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
    .execute(pool)
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

pub async fn list_medication_administrations(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<MedicationAdministrationListItem>> {
    let mut query = medication_query();
    query.push(" WHERE medication_administrations.facility_id = ");
    query.push_bind(facility_id);
    if let Some(cursor) = cursor {
        query.push(
            " AND (medication_administrations.scheduled_at, medication_administrations.id) > (",
        );
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY medication_administrations.scheduled_at ASC, medication_administrations.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<MedicationAdministrationRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(medication_from_row).collect()
}

pub async fn schedule_medication_administration(
    pool: &PgPool,
    medication: NewMedicationAdministration,
) -> anyhow::Result<MedicationAdministrationListItem> {
    sqlx::query(
        r#"
        INSERT INTO medication_administrations (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            medication_name,
            scheduled_at,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(medication.id)
    .bind(medication.facility_id)
    .bind(medication.admission_case_id)
    .bind(medication.patient_id)
    .bind(&medication.medication_name)
    .bind(medication.scheduled_at)
    .bind(codec::encode(MedicationAdministrationStatus::Scheduled)?)
    .bind(medication.actor_user_id)
    .execute(pool)
    .await?;

    medication_by_id(pool, medication.facility_id, medication.id).await
}

pub async fn administer_medication(
    pool: &PgPool,
    facility_id: Uuid,
    medication_id: Uuid,
    actor_user_id: Uuid,
    witness_user_id: Option<Uuid>,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    sqlx::query(
        r#"
        UPDATE medication_administrations
        SET status = $1,
            administered_at = COALESCE(administered_at, now()),
            administered_by_user_id = $2,
            witness_user_id = $3,
            updated_at = now()
        WHERE facility_id = $4 AND id = $5
        "#,
    )
    .bind(codec::encode(MedicationAdministrationStatus::Administered)?)
    .bind(actor_user_id)
    .bind(witness_user_id)
    .bind(facility_id)
    .bind(medication_id)
    .execute(pool)
    .await?;

    optional_medication_by_id(pool, facility_id, medication_id).await
}

pub async fn get_medication_administration(
    pool: &PgPool,
    facility_id: Uuid,
    medication_id: Uuid,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    optional_medication_by_id(pool, facility_id, medication_id).await
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

    let rows = query.build_query_as::<HandoffRow>().fetch_all(pool).await?;
    rows.into_iter().map(handoff_from_row).collect()
}

pub async fn create_handoff(pool: &PgPool, handoff: NewHandoff) -> anyhow::Result<HandoffListItem> {
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
    .execute(pool)
    .await?;

    handoff_by_id(pool, handoff.facility_id, handoff.id).await
}

pub async fn complete_handoff(
    pool: &PgPool,
    facility_id: Uuid,
    handoff_id: Uuid,
) -> anyhow::Result<Option<HandoffListItem>> {
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
    .execute(pool)
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

pub async fn list_treatment_sheets(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<TreatmentSheetListItem>> {
    let mut query = treatment_sheet_query();
    query.push(" WHERE treatment_sheets.facility_id = ");
    query.push_bind(facility_id);
    if let Some(cursor) = cursor {
        query.push(" AND (treatment_sheets.updated_at, treatment_sheets.id) > (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY treatment_sheets.updated_at ASC, treatment_sheets.id ASC LIMIT ");
    query.push_bind(limit);

    let rows = query
        .build_query_as::<TreatmentSheetRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(treatment_sheet_from_row).collect()
}

pub async fn create_treatment_sheet(
    pool: &PgPool,
    sheet: NewTreatmentSheet,
) -> anyhow::Result<TreatmentSheetListItem> {
    sqlx::query(
        r#"
        INSERT INTO treatment_sheets (
            id,
            facility_id,
            admission_case_id,
            patient_id,
            sheet_date,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (admission_case_id, sheet_date) DO UPDATE
        SET updated_at = now()
        "#,
    )
    .bind(sheet.id)
    .bind(sheet.facility_id)
    .bind(sheet.admission_case_id)
    .bind(sheet.patient_id)
    .bind(sheet.sheet_date)
    .bind(codec::encode(TreatmentSheetStatus::Active)?)
    .bind(sheet.actor_user_id)
    .execute(pool)
    .await?;

    treatment_sheet_by_admission_date(
        pool,
        sheet.facility_id,
        sheet.admission_case_id,
        sheet.sheet_date,
    )
    .await
}

pub async fn list_patient_vitals(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PatientVitalsListItem>> {
    let mut query = patient_vitals_query();
    query.push(" WHERE patient_vitals.facility_id = ");
    query.push_bind(facility_id);
    append_forward_cursor(
        &mut query,
        "patient_vitals.recorded_at",
        "patient_vitals.id",
        cursor,
    );
    query.push(" ORDER BY patient_vitals.recorded_at ASC, patient_vitals.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PatientVitalsRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(patient_vitals_from_row).collect())
}

pub async fn create_patient_vitals(
    pool: &PgPool,
    vitals: NewPatientVitals,
) -> anyhow::Result<PatientVitalsListItem> {
    sqlx::query(
        r#"
        INSERT INTO patient_vitals (
            id, facility_id, admission_case_id, patient_id, recorded_at, temperature_c,
            systolic_bp, diastolic_bp, pulse, respiratory_rate, oxygen_saturation,
            recorded_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        WHERE EXISTS (
            SELECT 1
            FROM admission_cases
            WHERE admission_cases.facility_id = $2
              AND admission_cases.id = $3
              AND admission_cases.patient_id = $4
        )
        "#,
    )
    .bind(vitals.id)
    .bind(vitals.facility_id)
    .bind(vitals.admission_case_id)
    .bind(vitals.patient_id)
    .bind(vitals.recorded_at)
    .bind(vitals.temperature_c)
    .bind(vitals.systolic_bp)
    .bind(vitals.diastolic_bp)
    .bind(vitals.pulse)
    .bind(vitals.respiratory_rate)
    .bind(vitals.oxygen_saturation)
    .bind(vitals.recorded_by_user_id)
    .execute(pool)
    .await?;
    patient_vitals_by_id(pool, vitals.facility_id, vitals.id).await
}

pub async fn list_nursing_alerts(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<NursingAlertListItem>> {
    let mut query = nursing_alert_query();
    query.push(" WHERE nursing_alerts.facility_id = ");
    query.push_bind(facility_id);
    append_forward_cursor(
        &mut query,
        "nursing_alerts.created_at",
        "nursing_alerts.id",
        cursor,
    );
    query.push(" ORDER BY nursing_alerts.created_at ASC, nursing_alerts.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<NursingAlertRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(nursing_alert_from_row).collect()
}

pub async fn create_nursing_alert(
    pool: &PgPool,
    alert: NewNursingAlert,
) -> anyhow::Result<NursingAlertListItem> {
    sqlx::query(
        r#"
        INSERT INTO nursing_alerts (
            id, facility_id, admission_case_id, patient_id, severity, title, status,
            created_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
            SELECT 1
            FROM admission_cases
            WHERE admission_cases.facility_id = $2
              AND admission_cases.id = $3
              AND admission_cases.patient_id = $4
        )
        "#,
    )
    .bind(alert.id)
    .bind(alert.facility_id)
    .bind(alert.admission_case_id)
    .bind(alert.patient_id)
    .bind(codec::encode(alert.severity)?)
    .bind(alert.title)
    .bind(codec::encode(NursingAlertStatus::Open)?)
    .bind(alert.created_by_user_id)
    .execute(pool)
    .await?;
    nursing_alert_by_id(pool, alert.facility_id, alert.id).await
}

pub async fn acknowledge_nursing_alert(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<NursingAlertListItem>> {
    sqlx::query(
        r#"
        UPDATE nursing_alerts
        SET status = $1,
            acknowledged_by_user_id = $2,
            acknowledged_at = COALESCE(acknowledged_at, now()),
            updated_at = now()
        WHERE facility_id = $3 AND id = $4
        "#,
    )
    .bind(codec::encode(NursingAlertStatus::Acknowledged)?)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(alert_id)
    .execute(pool)
    .await?;
    optional_nursing_alert_by_id(pool, facility_id, alert_id).await
}

pub async fn get_nursing_alert(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
) -> anyhow::Result<Option<NursingAlertListItem>> {
    optional_nursing_alert_by_id(pool, facility_id, alert_id).await
}

pub async fn list_monitoring_events(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<MonitoringEventListItem>> {
    let mut query = monitoring_event_query();
    query.push(" WHERE monitoring_events.facility_id = ");
    query.push_bind(facility_id);
    append_forward_cursor(
        &mut query,
        "monitoring_events.recorded_at",
        "monitoring_events.id",
        cursor,
    );
    query.push(" ORDER BY monitoring_events.recorded_at ASC, monitoring_events.id ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<MonitoringEventRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(monitoring_event_from_row).collect()
}

pub async fn create_monitoring_event(
    pool: &PgPool,
    event: NewMonitoringEvent,
) -> anyhow::Result<MonitoringEventListItem> {
    sqlx::query(
        r#"
        INSERT INTO monitoring_events (
            id, facility_id, admission_case_id, patient_id, event_kind, summary,
            recorded_at, recorded_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
            SELECT 1
            FROM admission_cases
            WHERE admission_cases.facility_id = $2
              AND admission_cases.id = $3
              AND admission_cases.patient_id = $4
        )
        "#,
    )
    .bind(event.id)
    .bind(event.facility_id)
    .bind(event.admission_case_id)
    .bind(event.patient_id)
    .bind(codec::encode(event.event_kind)?)
    .bind(event.summary)
    .bind(event.recorded_at)
    .bind(event.recorded_by_user_id)
    .execute(pool)
    .await?;
    monitoring_event_by_id(pool, event.facility_id, event.id).await
}

pub async fn list_fluid_balance_entries(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<FluidBalanceListItem>> {
    let mut query = fluid_balance_query();
    query.push(" WHERE fluid_balance_entries.facility_id = ");
    query.push_bind(facility_id);
    append_forward_cursor(
        &mut query,
        "fluid_balance_entries.recorded_at",
        "fluid_balance_entries.id",
        cursor,
    );
    query.push(
        " ORDER BY fluid_balance_entries.recorded_at ASC, fluid_balance_entries.id ASC LIMIT ",
    );
    query.push_bind(limit);
    let rows = query
        .build_query_as::<FluidBalanceRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(fluid_balance_from_row).collect())
}

pub async fn create_fluid_balance_entry(
    pool: &PgPool,
    entry: NewFluidBalanceEntry,
) -> anyhow::Result<FluidBalanceListItem> {
    sqlx::query(
        r#"
        INSERT INTO fluid_balance_entries (
            id, facility_id, admission_case_id, patient_id, recorded_at, intake_ml,
            output_ml, recorded_by_user_id
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
            SELECT 1
            FROM admission_cases
            WHERE admission_cases.facility_id = $2
              AND admission_cases.id = $3
              AND admission_cases.patient_id = $4
        )
        "#,
    )
    .bind(entry.id)
    .bind(entry.facility_id)
    .bind(entry.admission_case_id)
    .bind(entry.patient_id)
    .bind(entry.recorded_at)
    .bind(entry.intake_ml)
    .bind(entry.output_ml)
    .bind(entry.recorded_by_user_id)
    .execute(pool)
    .await?;
    fluid_balance_by_id(pool, entry.facility_id, entry.id).await
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

fn nursing_task_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT nursing_tasks.id,
               nursing_tasks.admission_case_id,
               nursing_tasks.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               nursing_tasks.task_type,
               nursing_tasks.status,
               nursing_tasks.due_at
        FROM nursing_tasks
        JOIN patients ON patients.id = nursing_tasks.patient_id
        "#,
    )
}

fn medication_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT medication_administrations.id,
               medication_administrations.admission_case_id,
               medication_administrations.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               medication_administrations.medication_name,
               medication_administrations.scheduled_at,
               medication_administrations.administered_at,
               medication_administrations.status
        FROM medication_administrations
        JOIN patients ON patients.id = medication_administrations.patient_id
        "#,
    )
}

fn treatment_sheet_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT treatment_sheets.id,
               treatment_sheets.admission_case_id,
               treatment_sheets.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               treatment_sheets.sheet_date,
               treatment_sheets.status,
               treatment_sheets.updated_at
        FROM treatment_sheets
        JOIN patients ON patients.id = treatment_sheets.patient_id
        "#,
    )
}

fn patient_vitals_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT patient_vitals.id,
               patient_vitals.admission_case_id,
               patient_vitals.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               patient_vitals.recorded_at,
               patient_vitals.temperature_c,
               patient_vitals.systolic_bp,
               patient_vitals.diastolic_bp,
               patient_vitals.pulse,
               patient_vitals.respiratory_rate,
               patient_vitals.oxygen_saturation
        FROM patient_vitals
        JOIN patients
          ON patients.id = patient_vitals.patient_id
         AND patients.facility_id = patient_vitals.facility_id
        "#,
    )
}

fn nursing_alert_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT nursing_alerts.id,
               nursing_alerts.admission_case_id,
               nursing_alerts.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               nursing_alerts.severity,
               nursing_alerts.title,
               nursing_alerts.status,
               nursing_alerts.created_at,
               nursing_alerts.acknowledged_at
        FROM nursing_alerts
        JOIN patients
          ON patients.id = nursing_alerts.patient_id
         AND patients.facility_id = nursing_alerts.facility_id
        "#,
    )
}

fn monitoring_event_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT monitoring_events.id,
               monitoring_events.admission_case_id,
               monitoring_events.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               monitoring_events.event_kind,
               monitoring_events.summary,
               monitoring_events.recorded_at
        FROM monitoring_events
        JOIN patients
          ON patients.id = monitoring_events.patient_id
         AND patients.facility_id = monitoring_events.facility_id
        "#,
    )
}

fn fluid_balance_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(
        r#"
        SELECT fluid_balance_entries.id,
               fluid_balance_entries.admission_case_id,
               fluid_balance_entries.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_display_name,
               fluid_balance_entries.recorded_at,
               fluid_balance_entries.intake_ml,
               fluid_balance_entries.output_ml,
               fluid_balance_entries.intake_ml - fluid_balance_entries.output_ml AS net_ml
        FROM fluid_balance_entries
        JOIN patients
          ON patients.id = fluid_balance_entries.patient_id
         AND patients.facility_id = fluid_balance_entries.facility_id
        "#,
    )
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

fn append_forward_cursor(
    query: &mut QueryBuilder<'_, Postgres>,
    time_column: &str,
    id_column: &str,
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

async fn ward_board_item_by_admission(
    pool: &PgPool,
    facility_id: Uuid,
    admission_id: Uuid,
) -> anyhow::Result<WardBoardItem> {
    let mut query = ward_board_query();
    query.push(" WHERE admission_cases.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND admission_cases.id = ");
    query.push_bind(admission_id);
    let row = query
        .build_query_as::<WardBoardRow>()
        .fetch_one(pool)
        .await?;
    ward_board_from_row(row)
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
    let row = query
        .build_query_as::<DischargeCaseRow>()
        .fetch_one(pool)
        .await?;
    discharge_from_row(row)
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
    let row = query
        .build_query_as::<NursingTaskRow>()
        .fetch_optional(pool)
        .await?;
    row.map(nursing_task_from_row).transpose()
}

async fn medication_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    medication_id: Uuid,
) -> anyhow::Result<MedicationAdministrationListItem> {
    optional_medication_by_id(pool, facility_id, medication_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("medication administration was not found after write"))
}

async fn optional_medication_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    medication_id: Uuid,
) -> anyhow::Result<Option<MedicationAdministrationListItem>> {
    let mut query = medication_query();
    query.push(" WHERE medication_administrations.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND medication_administrations.id = ");
    query.push_bind(medication_id);
    let row = query
        .build_query_as::<MedicationAdministrationRow>()
        .fetch_optional(pool)
        .await?;
    row.map(medication_from_row).transpose()
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
    let row = sqlx::query_as::<_, HandoffRow>(
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
    .fetch_optional(pool)
    .await?;
    row.map(handoff_from_row).transpose()
}

async fn treatment_sheet_by_admission_date(
    pool: &PgPool,
    facility_id: Uuid,
    admission_case_id: Uuid,
    sheet_date: NaiveDate,
) -> anyhow::Result<TreatmentSheetListItem> {
    let mut query = treatment_sheet_query();
    query.push(" WHERE treatment_sheets.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND treatment_sheets.admission_case_id = ");
    query.push_bind(admission_case_id);
    query.push(" AND treatment_sheets.sheet_date = ");
    query.push_bind(sheet_date);
    let row = query
        .build_query_as::<TreatmentSheetRow>()
        .fetch_one(pool)
        .await?;
    treatment_sheet_from_row(row)
}

async fn patient_vitals_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    vitals_id: Uuid,
) -> anyhow::Result<PatientVitalsListItem> {
    let mut query = patient_vitals_query();
    query.push(" WHERE patient_vitals.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND patient_vitals.id = ");
    query.push_bind(vitals_id);
    let row = query
        .build_query_as::<PatientVitalsRow>()
        .fetch_one(pool)
        .await?;
    Ok(patient_vitals_from_row(row))
}

async fn nursing_alert_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
) -> anyhow::Result<NursingAlertListItem> {
    optional_nursing_alert_by_id(pool, facility_id, alert_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("nursing alert was not found after write"))
}

async fn optional_nursing_alert_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    alert_id: Uuid,
) -> anyhow::Result<Option<NursingAlertListItem>> {
    let mut query = nursing_alert_query();
    query.push(" WHERE nursing_alerts.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND nursing_alerts.id = ");
    query.push_bind(alert_id);
    let row = query
        .build_query_as::<NursingAlertRow>()
        .fetch_optional(pool)
        .await?;
    row.map(nursing_alert_from_row).transpose()
}

async fn monitoring_event_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    event_id: Uuid,
) -> anyhow::Result<MonitoringEventListItem> {
    let mut query = monitoring_event_query();
    query.push(" WHERE monitoring_events.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND monitoring_events.id = ");
    query.push_bind(event_id);
    let row = query
        .build_query_as::<MonitoringEventRow>()
        .fetch_one(pool)
        .await?;
    monitoring_event_from_row(row)
}

async fn fluid_balance_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    entry_id: Uuid,
) -> anyhow::Result<FluidBalanceListItem> {
    let mut query = fluid_balance_query();
    query.push(" WHERE fluid_balance_entries.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND fluid_balance_entries.id = ");
    query.push_bind(entry_id);
    let row = query
        .build_query_as::<FluidBalanceRow>()
        .fetch_one(pool)
        .await?;
    Ok(fluid_balance_from_row(row))
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

#[derive(Clone, Debug, FromRow)]
struct DischargeContextRow {
    admission_case_id: Uuid,
}

fn ward_from_row(row: WardRow) -> anyhow::Result<WardListItem> {
    Ok(WardListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        status: codec::decode(&row.status)?,
        active_bed_count: row.active_bed_count,
        occupied_bed_count: row.occupied_bed_count,
        created_at: row.created_at,
    })
}

fn ward_section_from_row(row: WardSectionRow) -> anyhow::Result<WardSectionListItem> {
    Ok(WardSectionListItem {
        id: row.id,
        ward_id: row.ward_id,
        code: row.code,
        name: row.name,
        status: codec::decode(&row.status)?,
        active_bed_count: row.active_bed_count,
        created_at: row.created_at,
    })
}

fn bed_from_row(row: BedRow) -> anyhow::Result<BedListItem> {
    Ok(BedListItem {
        id: row.id,
        ward_id: row.ward_id,
        section_id: row.section_id,
        bed_code: row.bed_code,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
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

fn nursing_task_from_row(row: NursingTaskRow) -> anyhow::Result<NursingTaskListItem> {
    Ok(NursingTaskListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        task_type: codec::decode(&row.task_type)?,
        status: codec::decode(&row.status)?,
        due_at: row.due_at,
    })
}

fn medication_from_row(
    row: MedicationAdministrationRow,
) -> anyhow::Result<MedicationAdministrationListItem> {
    Ok(MedicationAdministrationListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        medication_name: row.medication_name,
        scheduled_at: row.scheduled_at,
        administered_at: row.administered_at,
        status: codec::decode(&row.status)?,
    })
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

fn treatment_sheet_from_row(row: TreatmentSheetRow) -> anyhow::Result<TreatmentSheetListItem> {
    Ok(TreatmentSheetListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        sheet_date: row.sheet_date,
        status: codec::decode(&row.status)?,
        updated_at: row.updated_at,
    })
}

fn patient_vitals_from_row(row: PatientVitalsRow) -> PatientVitalsListItem {
    PatientVitalsListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        recorded_at: row.recorded_at,
        temperature_c: row.temperature_c,
        systolic_bp: row.systolic_bp,
        diastolic_bp: row.diastolic_bp,
        pulse: row.pulse,
        respiratory_rate: row.respiratory_rate,
        oxygen_saturation: row.oxygen_saturation,
    }
}

fn nursing_alert_from_row(row: NursingAlertRow) -> anyhow::Result<NursingAlertListItem> {
    Ok(NursingAlertListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        severity: codec::decode(&row.severity)?,
        title: row.title,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
        acknowledged_at: row.acknowledged_at,
    })
}

fn monitoring_event_from_row(row: MonitoringEventRow) -> anyhow::Result<MonitoringEventListItem> {
    Ok(MonitoringEventListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        event_kind: codec::decode(&row.event_kind)?,
        summary: row.summary,
        recorded_at: row.recorded_at,
    })
}

fn fluid_balance_from_row(row: FluidBalanceRow) -> FluidBalanceListItem {
    FluidBalanceListItem {
        id: row.id,
        admission_case_id: row.admission_case_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_display_name: row.patient_display_name,
        recorded_at: row.recorded_at,
        intake_ml: row.intake_ml,
        output_ml: row.output_ml,
        net_ml: row.net_ml,
    }
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
