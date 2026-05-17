use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::ward::{
    MedicationAdministrationListItem, MedicationAdministrationStatus, TreatmentSheetListItem,
    TreatmentSheetStatus,
};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

use super::WardCursor;

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
pub struct NewTreatmentSheet {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub sheet_date: NaiveDate,
    pub actor_user_id: Uuid,
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
