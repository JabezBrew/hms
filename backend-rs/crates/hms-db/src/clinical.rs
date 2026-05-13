use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::clinical::{
    AllergyListItem, AllergySeverity, AllergyStatus, ChartEntryListItem, ChartEntryType,
    ClinicalNoteDetail, ClinicalNoteListItem, ClinicalNoteStatus, ClinicalNoteTemplate,
    ClinicalNoteVersion, PatientChronicleSummary, PrescriptionListItem, PrescriptionStatus,
    ProblemListItem, ProblemStatus, UpdateAllergyRequest, UpdatePrescriptionRequest,
    UpdateProblemRequest,
};
use hms_domain::patients::PatientDetail;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct ClinicalCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NoteContext {
    pub id: Uuid,
    pub patient_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewClinicalNote {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub note_type: String,
    pub title: String,
    pub body: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewClinicalNoteTemplate {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub title: String,
    pub note_type: String,
    pub body_template: String,
}

#[derive(Clone, Debug)]
pub struct UpdateClinicalNoteTemplate {
    pub title: Option<String>,
    pub note_type: Option<String>,
    pub body_template: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug)]
pub struct NewProblem {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub label: String,
    pub onset_date: Option<NaiveDate>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewAllergy {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub substance: String,
    pub reaction: Option<String>,
    pub severity: AllergySeverity,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewPrescription {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub medication_name: String,
    pub dose: String,
    pub frequency: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewChartEntry {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub entry_type: ChartEntryType,
    pub measured_at: DateTime<Utc>,
    pub value: String,
    pub unit: Option<String>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct TemplateRow {
    id: Uuid,
    title: String,
    note_type: String,
    body_template: String,
    is_active: bool,
}

#[derive(Clone, Debug, FromRow)]
struct NoteRow {
    id: Uuid,
    patient_id: Uuid,
    note_type: String,
    title: String,
    status: String,
    version: i64,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct NoteDetailRow {
    id: Uuid,
    patient_id: Uuid,
    note_type: String,
    title: String,
    body: String,
    status: String,
    version: i64,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct NoteVersionRow {
    id: Uuid,
    note_id: Uuid,
    version: i64,
    body: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ProblemRow {
    id: Uuid,
    patient_id: Uuid,
    label: String,
    status: String,
    onset_date: Option<NaiveDate>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct AllergyRow {
    id: Uuid,
    patient_id: Uuid,
    substance: String,
    reaction: Option<String>,
    severity: String,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PrescriptionRow {
    id: Uuid,
    patient_id: Uuid,
    medication_name: String,
    dose: String,
    frequency: String,
    status: String,
    prescribed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ChartEntryRow {
    id: Uuid,
    patient_id: Uuid,
    entry_type: String,
    measured_at: DateTime<Utc>,
    value: String,
    unit: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct NoteContextRow {
    id: Uuid,
    patient_id: Uuid,
}

pub async fn list_note_templates(
    pool: &PgPool,
    facility_id: Uuid,
    limit: i64,
) -> anyhow::Result<Vec<ClinicalNoteTemplate>> {
    let rows = sqlx::query_as::<_, TemplateRow>(
        r#"
        SELECT id, title, note_type, body_template, is_active
        FROM clinical_note_templates
        WHERE facility_id = $1 AND is_active = TRUE
        ORDER BY title ASC, id ASC
        LIMIT $2
        "#,
    )
    .bind(facility_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(template_from_row).collect())
}

pub async fn get_note_template(
    pool: &PgPool,
    facility_id: Uuid,
    template_id: Uuid,
) -> anyhow::Result<Option<ClinicalNoteTemplate>> {
    let row = sqlx::query_as::<_, TemplateRow>(
        r#"
        SELECT id, title, note_type, body_template, is_active
        FROM clinical_note_templates
        WHERE facility_id = $1 AND id = $2 AND is_active = TRUE
        "#,
    )
    .bind(facility_id)
    .bind(template_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(template_from_row))
}

pub async fn create_note_template(
    pool: &PgPool,
    template: NewClinicalNoteTemplate,
) -> anyhow::Result<ClinicalNoteTemplate> {
    let row = sqlx::query_as::<_, TemplateRow>(
        r#"
        INSERT INTO clinical_note_templates (
            id,
            facility_id,
            title,
            note_type,
            body_template
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, title, note_type, body_template, is_active
        "#,
    )
    .bind(template.id)
    .bind(template.facility_id)
    .bind(template.title)
    .bind(template.note_type)
    .bind(template.body_template)
    .fetch_one(pool)
    .await?;
    Ok(template_from_row(row))
}

pub async fn update_note_template(
    pool: &PgPool,
    facility_id: Uuid,
    template_id: Uuid,
    update: UpdateClinicalNoteTemplate,
) -> anyhow::Result<Option<ClinicalNoteTemplate>> {
    let row = sqlx::query_as::<_, TemplateRow>(
        r#"
        UPDATE clinical_note_templates
        SET title = COALESCE($3, title),
            note_type = COALESCE($4, note_type),
            body_template = COALESCE($5, body_template),
            is_active = COALESCE($6, is_active),
            updated_at = now()
        WHERE facility_id = $1 AND id = $2
        RETURNING id, title, note_type, body_template, is_active
        "#,
    )
    .bind(facility_id)
    .bind(template_id)
    .bind(update.title)
    .bind(update.note_type)
    .bind(update.body_template)
    .bind(update.is_active)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(template_from_row))
}

pub async fn deactivate_note_template(
    pool: &PgPool,
    facility_id: Uuid,
    template_id: Uuid,
) -> anyhow::Result<Option<ClinicalNoteTemplate>> {
    update_note_template(
        pool,
        facility_id,
        template_id,
        UpdateClinicalNoteTemplate {
            title: None,
            note_type: None,
            body_template: None,
            is_active: Some(false),
        },
    )
    .await
}

pub async fn list_notes(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    cursor: Option<ClinicalCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ClinicalNoteListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT id, patient_id, note_type, title, status, version, updated_at
        FROM clinical_notes
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patient_id = ");
    query.push_bind(patient_id);
    if let Some(cursor) = cursor {
        query.push(" AND (updated_at, id) < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY updated_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<NoteRow>().fetch_all(pool).await?;
    rows.into_iter().map(note_from_row).collect()
}

pub async fn create_note(
    pool: &PgPool,
    note: NewClinicalNote,
) -> anyhow::Result<ClinicalNoteListItem> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, NoteRow>(
        r#"
        INSERT INTO clinical_notes (
            id,
            facility_id,
            patient_id,
            note_type,
            title,
            body,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, patient_id, note_type, title, status, version, updated_at
        "#,
    )
    .bind(note.id)
    .bind(note.facility_id)
    .bind(note.patient_id)
    .bind(&note.note_type)
    .bind(&note.title)
    .bind(&note.body)
    .bind(codec::encode(ClinicalNoteStatus::Draft)?)
    .bind(note.actor_user_id)
    .fetch_one(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO clinical_note_versions (id, note_id, version, body, created_by_user_id)
        VALUES ($1, $2, 1, $3, $4)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(note.id)
    .bind(&note.body)
    .bind(note.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    note_from_row(row)
}

pub async fn get_note_context(
    pool: &PgPool,
    facility_id: Uuid,
    note_id: Uuid,
) -> anyhow::Result<Option<NoteContext>> {
    Ok(sqlx::query_as::<_, NoteContextRow>(
        "SELECT id, patient_id FROM clinical_notes WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(note_id)
    .fetch_optional(pool)
    .await?
    .map(|row| NoteContext {
        id: row.id,
        patient_id: row.patient_id,
    }))
}

pub async fn get_note_detail(
    pool: &PgPool,
    facility_id: Uuid,
    note_id: Uuid,
) -> anyhow::Result<Option<ClinicalNoteDetail>> {
    let row = sqlx::query_as::<_, NoteDetailRow>(
        r#"
        SELECT id, patient_id, note_type, title, body, status, version, updated_at
        FROM clinical_notes
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(note_id)
    .fetch_optional(pool)
    .await?;
    row.map(note_detail_from_row).transpose()
}

pub async fn list_note_versions(
    pool: &PgPool,
    note_id: Uuid,
) -> anyhow::Result<Vec<ClinicalNoteVersion>> {
    let rows = sqlx::query_as::<_, NoteVersionRow>(
        r#"
        SELECT id, note_id, version, body, created_at
        FROM clinical_note_versions
        WHERE note_id = $1
        ORDER BY version DESC
        LIMIT 100
        "#,
    )
    .bind(note_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(note_version_from_row).collect()
}

pub async fn create_note_version(
    pool: &PgPool,
    note_id: Uuid,
    body: String,
    actor_user_id: Uuid,
) -> anyhow::Result<ClinicalNoteVersion> {
    let mut transaction = pool.begin().await?;
    let version = sqlx::query_scalar::<_, i64>(
        r#"
        UPDATE clinical_notes
        SET version = version + 1,
            body = $1,
            status = $2,
            updated_at = now()
        WHERE id = $3
        RETURNING version
        "#,
    )
    .bind(&body)
    .bind(codec::encode(ClinicalNoteStatus::Amended)?)
    .bind(note_id)
    .fetch_one(&mut *transaction)
    .await?;

    let row = sqlx::query_as::<_, NoteVersionRow>(
        r#"
        INSERT INTO clinical_note_versions (id, note_id, version, body, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, note_id, version, body, created_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(note_id)
    .bind(version)
    .bind(body)
    .bind(actor_user_id)
    .fetch_one(&mut *transaction)
    .await?;

    transaction.commit().await?;
    note_version_from_row(row)
}

pub async fn list_problems(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    cursor: Option<ClinicalCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ProblemListItem>> {
    let mut query =
        patient_table_query("patient_problems", "label, status, onset_date, created_at");
    apply_patient_cursor(
        &mut query,
        facility_id,
        patient_id,
        "created_at",
        cursor,
        limit,
    );
    let rows = query.build_query_as::<ProblemRow>().fetch_all(pool).await?;
    rows.into_iter().map(problem_from_row).collect()
}

pub async fn create_problem(pool: &PgPool, problem: NewProblem) -> anyhow::Result<ProblemListItem> {
    let row = sqlx::query_as::<_, ProblemRow>(
        r#"
        INSERT INTO patient_problems (
            id, facility_id, patient_id, label, status, onset_date, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, patient_id, label, status, onset_date, created_at
        "#,
    )
    .bind(problem.id)
    .bind(problem.facility_id)
    .bind(problem.patient_id)
    .bind(problem.label)
    .bind(codec::encode(ProblemStatus::Active)?)
    .bind(problem.onset_date)
    .bind(problem.actor_user_id)
    .fetch_one(pool)
    .await?;
    problem_from_row(row)
}

pub async fn get_problem(
    pool: &PgPool,
    facility_id: Uuid,
    problem_id: Uuid,
) -> anyhow::Result<Option<ProblemListItem>> {
    let row = sqlx::query_as::<_, ProblemRow>(
        r#"
        SELECT id, patient_id, label, status, onset_date, created_at
        FROM patient_problems
        WHERE facility_id = $1
          AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(problem_id)
    .fetch_optional(pool)
    .await?;

    row.map(problem_from_row).transpose()
}

pub async fn update_problem_status(
    pool: &PgPool,
    facility_id: Uuid,
    problem_id: Uuid,
    status: ProblemStatus,
) -> anyhow::Result<Option<ProblemListItem>> {
    let row = sqlx::query_as::<_, ProblemRow>(
        r#"
        UPDATE patient_problems
        SET status = $1
        WHERE facility_id = $2
          AND id = $3
        RETURNING id, patient_id, label, status, onset_date, created_at
        "#,
    )
    .bind(codec::encode(status)?)
    .bind(facility_id)
    .bind(problem_id)
    .fetch_optional(pool)
    .await?;

    row.map(problem_from_row).transpose()
}

pub async fn update_problem(
    pool: &PgPool,
    facility_id: Uuid,
    problem_id: Uuid,
    update: UpdateProblemRequest,
) -> anyhow::Result<Option<ProblemListItem>> {
    let status = update.status.map(codec::encode).transpose()?;
    let row = sqlx::query_as::<_, ProblemRow>(
        r#"
        UPDATE patient_problems
        SET label = COALESCE($1, label),
            onset_date = COALESCE($2, onset_date),
            status = COALESCE($3, status)
        WHERE facility_id = $4
          AND id = $5
        RETURNING id, patient_id, label, status, onset_date, created_at
        "#,
    )
    .bind(update.label)
    .bind(update.onset_date)
    .bind(status)
    .bind(facility_id)
    .bind(problem_id)
    .fetch_optional(pool)
    .await?;

    row.map(problem_from_row).transpose()
}

pub async fn list_allergies(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    cursor: Option<ClinicalCursor>,
    limit: i64,
) -> anyhow::Result<Vec<AllergyListItem>> {
    let mut query = patient_table_query(
        "patient_allergies",
        "substance, reaction, severity, status, created_at",
    );
    apply_patient_cursor(
        &mut query,
        facility_id,
        patient_id,
        "created_at",
        cursor,
        limit,
    );
    let rows = query.build_query_as::<AllergyRow>().fetch_all(pool).await?;
    rows.into_iter().map(allergy_from_row).collect()
}

pub async fn create_allergy(pool: &PgPool, allergy: NewAllergy) -> anyhow::Result<AllergyListItem> {
    let row = sqlx::query_as::<_, AllergyRow>(
        r#"
        INSERT INTO patient_allergies (
            id, facility_id, patient_id, substance, reaction, severity, status, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, patient_id, substance, reaction, severity, status, created_at
        "#,
    )
    .bind(allergy.id)
    .bind(allergy.facility_id)
    .bind(allergy.patient_id)
    .bind(allergy.substance)
    .bind(allergy.reaction)
    .bind(codec::encode(allergy.severity)?)
    .bind(codec::encode(AllergyStatus::Active)?)
    .bind(allergy.actor_user_id)
    .fetch_one(pool)
    .await?;
    allergy_from_row(row)
}

pub async fn get_allergy(
    pool: &PgPool,
    facility_id: Uuid,
    allergy_id: Uuid,
) -> anyhow::Result<Option<AllergyListItem>> {
    let row = sqlx::query_as::<_, AllergyRow>(
        r#"
        SELECT id, patient_id, substance, reaction, severity, status, created_at
        FROM patient_allergies
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(allergy_id)
    .fetch_optional(pool)
    .await?;
    row.map(allergy_from_row).transpose()
}

pub async fn update_allergy(
    pool: &PgPool,
    facility_id: Uuid,
    allergy_id: Uuid,
    update: UpdateAllergyRequest,
) -> anyhow::Result<Option<AllergyListItem>> {
    let severity = update.severity.map(codec::encode).transpose()?;
    let status = update.status.map(codec::encode).transpose()?;
    let row = sqlx::query_as::<_, AllergyRow>(
        r#"
        UPDATE patient_allergies
        SET substance = COALESCE($3, substance),
            reaction = COALESCE($4, reaction),
            severity = COALESCE($5, severity),
            status = COALESCE($6, status),
            updated_at = now()
        WHERE facility_id = $1 AND id = $2
        RETURNING id, patient_id, substance, reaction, severity, status, created_at
        "#,
    )
    .bind(facility_id)
    .bind(allergy_id)
    .bind(update.substance)
    .bind(update.reaction)
    .bind(severity)
    .bind(status)
    .fetch_optional(pool)
    .await?;
    row.map(allergy_from_row).transpose()
}

pub async fn deactivate_allergy(
    pool: &PgPool,
    facility_id: Uuid,
    allergy_id: Uuid,
) -> anyhow::Result<Option<AllergyListItem>> {
    update_allergy(
        pool,
        facility_id,
        allergy_id,
        UpdateAllergyRequest {
            substance: None,
            reaction: None,
            severity: None,
            status: Some(AllergyStatus::Inactive),
        },
    )
    .await
}

pub async fn list_prescriptions(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    cursor: Option<ClinicalCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PrescriptionListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT id, patient_id, medication_name, dose, frequency, status, prescribed_at
        FROM prescriptions
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patient_id = ");
    query.push_bind(patient_id);
    if let Some(cursor) = cursor {
        query.push(" AND (prescribed_at, id) < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY prescribed_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PrescriptionRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(prescription_from_row).collect()
}

pub async fn create_prescription(
    pool: &PgPool,
    prescription: NewPrescription,
) -> anyhow::Result<PrescriptionListItem> {
    let row = sqlx::query_as::<_, PrescriptionRow>(
        r#"
        INSERT INTO prescriptions (
            id, facility_id, patient_id, medication_name, dose, frequency, status, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, patient_id, medication_name, dose, frequency, status, prescribed_at
        "#,
    )
    .bind(prescription.id)
    .bind(prescription.facility_id)
    .bind(prescription.patient_id)
    .bind(prescription.medication_name)
    .bind(prescription.dose)
    .bind(prescription.frequency)
    .bind(codec::encode(PrescriptionStatus::Active)?)
    .bind(prescription.actor_user_id)
    .fetch_one(pool)
    .await?;
    prescription_from_row(row)
}

pub async fn get_prescription(
    pool: &PgPool,
    facility_id: Uuid,
    prescription_id: Uuid,
) -> anyhow::Result<Option<PrescriptionListItem>> {
    let row = sqlx::query_as::<_, PrescriptionRow>(
        r#"
        SELECT id, patient_id, medication_name, dose, frequency, status, prescribed_at
        FROM prescriptions
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(prescription_id)
    .fetch_optional(pool)
    .await?;
    row.map(prescription_from_row).transpose()
}

pub async fn update_prescription(
    pool: &PgPool,
    facility_id: Uuid,
    prescription_id: Uuid,
    update: UpdatePrescriptionRequest,
) -> anyhow::Result<Option<PrescriptionListItem>> {
    let status = update.status.map(codec::encode).transpose()?;
    let row = sqlx::query_as::<_, PrescriptionRow>(
        r#"
        UPDATE prescriptions
        SET medication_name = COALESCE($3, medication_name),
            dose = COALESCE($4, dose),
            frequency = COALESCE($5, frequency),
            status = COALESCE($6, status),
            updated_at = now()
        WHERE facility_id = $1 AND id = $2
        RETURNING id, patient_id, medication_name, dose, frequency, status, prescribed_at
        "#,
    )
    .bind(facility_id)
    .bind(prescription_id)
    .bind(update.medication_name)
    .bind(update.dose)
    .bind(update.frequency)
    .bind(status)
    .fetch_optional(pool)
    .await?;
    row.map(prescription_from_row).transpose()
}

pub async fn list_chart_entries(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    cursor: Option<ClinicalCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ChartEntryListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT id, patient_id, entry_type, measured_at, value, unit
        FROM chart_entries
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patient_id = ");
    query.push_bind(patient_id);
    if let Some(cursor) = cursor {
        query.push(" AND (measured_at, id) < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY measured_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<ChartEntryRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(chart_entry_from_row).collect()
}

pub async fn create_chart_entry(
    pool: &PgPool,
    entry: NewChartEntry,
) -> anyhow::Result<ChartEntryListItem> {
    let row = sqlx::query_as::<_, ChartEntryRow>(
        r#"
        INSERT INTO chart_entries (
            id, facility_id, patient_id, entry_type, measured_at, value, unit, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, patient_id, entry_type, measured_at, value, unit
        "#,
    )
    .bind(entry.id)
    .bind(entry.facility_id)
    .bind(entry.patient_id)
    .bind(codec::encode(entry.entry_type)?)
    .bind(entry.measured_at)
    .bind(entry.value)
    .bind(entry.unit)
    .bind(entry.actor_user_id)
    .fetch_one(pool)
    .await?;
    chart_entry_from_row(row)
}

pub async fn patient_chronicle_summary(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    limit: i64,
) -> anyhow::Result<Option<PatientChronicleSummary>> {
    let Some(patient) = crate::patients::get_patient(pool, facility_id, patient_id).await? else {
        return Ok(None);
    };
    let limit = limit.clamp(1, 100);

    Ok(Some(PatientChronicleSummary {
        patient: PatientDetail::from(&patient),
        generated_at: Utc::now(),
        notes: list_notes(pool, facility_id, patient_id, None, limit).await?,
        problems: list_problems(pool, facility_id, patient_id, None, limit).await?,
        allergies: list_allergies(pool, facility_id, patient_id, None, limit).await?,
        prescriptions: list_prescriptions(pool, facility_id, patient_id, None, limit).await?,
        chart_entries: list_chart_entries(pool, facility_id, patient_id, None, limit).await?,
    }))
}

fn patient_table_query(
    table: &'static str,
    fields: &'static str,
) -> QueryBuilder<'static, Postgres> {
    QueryBuilder::<Postgres>::new(format!(
        "SELECT id, patient_id, {fields} FROM {table} WHERE facility_id = "
    ))
}

fn apply_patient_cursor(
    query: &mut QueryBuilder<'static, Postgres>,
    facility_id: Uuid,
    patient_id: Uuid,
    time_column: &'static str,
    cursor: Option<ClinicalCursor>,
    limit: i64,
) {
    query.push_bind(facility_id);
    query.push(" AND patient_id = ");
    query.push_bind(patient_id);
    if let Some(cursor) = cursor {
        query.push(" AND (");
        query.push(time_column);
        query.push(", id) < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
    query.push(" ORDER BY ");
    query.push(time_column);
    query.push(" DESC, id DESC LIMIT ");
    query.push_bind(limit);
}

fn template_from_row(row: TemplateRow) -> ClinicalNoteTemplate {
    ClinicalNoteTemplate {
        id: row.id,
        title: row.title,
        note_type: row.note_type,
        body_template: row.body_template,
        is_active: row.is_active,
    }
}

fn note_from_row(row: NoteRow) -> anyhow::Result<ClinicalNoteListItem> {
    Ok(ClinicalNoteListItem {
        id: row.id,
        patient_id: row.patient_id,
        note_type: row.note_type,
        title: row.title,
        status: codec::decode(&row.status)?,
        version: row.version,
        updated_at: row.updated_at,
    })
}

fn note_detail_from_row(row: NoteDetailRow) -> anyhow::Result<ClinicalNoteDetail> {
    Ok(ClinicalNoteDetail {
        id: row.id,
        patient_id: row.patient_id,
        note_type: row.note_type,
        title: row.title,
        body: row.body,
        status: codec::decode(&row.status)?,
        version: row.version,
        updated_at: row.updated_at,
    })
}

fn note_version_from_row(row: NoteVersionRow) -> anyhow::Result<ClinicalNoteVersion> {
    Ok(ClinicalNoteVersion {
        id: row.id,
        note_id: row.note_id,
        version: row.version,
        body: row.body,
        created_at: row.created_at,
    })
}

fn problem_from_row(row: ProblemRow) -> anyhow::Result<ProblemListItem> {
    Ok(ProblemListItem {
        id: row.id,
        patient_id: row.patient_id,
        label: row.label,
        status: codec::decode(&row.status)?,
        onset_date: row.onset_date,
        created_at: row.created_at,
    })
}

fn allergy_from_row(row: AllergyRow) -> anyhow::Result<AllergyListItem> {
    Ok(AllergyListItem {
        id: row.id,
        patient_id: row.patient_id,
        substance: row.substance,
        reaction: row.reaction,
        severity: codec::decode(&row.severity)?,
        status: codec::decode(&row.status)?,
        created_at: row.created_at,
    })
}

fn prescription_from_row(row: PrescriptionRow) -> anyhow::Result<PrescriptionListItem> {
    Ok(PrescriptionListItem {
        id: row.id,
        patient_id: row.patient_id,
        medication_name: row.medication_name,
        dose: row.dose,
        frequency: row.frequency,
        status: codec::decode(&row.status)?,
        prescribed_at: row.prescribed_at,
    })
}

fn chart_entry_from_row(row: ChartEntryRow) -> anyhow::Result<ChartEntryListItem> {
    Ok(ChartEntryListItem {
        id: row.id,
        patient_id: row.patient_id,
        entry_type: codec::decode(&row.entry_type)?,
        measured_at: row.measured_at,
        value: row.value,
        unit: row.unit,
    })
}
