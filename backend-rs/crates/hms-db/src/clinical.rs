use anyhow::Context;
use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::clinical::{
    AllergyListItem, AllergySeverity, AllergyStatus, ChartEntryListItem, ChartEntryType,
    ClinicalNoteDetail, ClinicalNoteListItem, ClinicalNoteStatus, ClinicalNoteTemplate,
    ClinicalNoteType, ClinicalNoteVersion, LaboratoryClinicalContext, PatientChronicleSummary,
    PharmacyClinicalContext, PrescriptionListItem, PrescriptionStatus, ProblemArtifactKind,
    ProblemArtifactLinkItem, ProblemListItem, ProblemStatus, UpdateAllergyRequest,
    UpdatePrescriptionRequest, UpdateProblemRequest,
};
use hms_domain::patients::{PatientDetail, PatientRecord};
use hms_observability::observe_db_query;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::admin::{insert_audit_event, NewAuditEvent};
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
    pub encounter_id: Option<Uuid>,
    pub note_type: ClinicalNoteType,
    pub title: String,
    pub body: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewClinicalNoteTemplate {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub title: String,
    pub note_type: ClinicalNoteType,
    pub body_template: String,
}

#[derive(Clone, Debug)]
pub struct UpdateClinicalNoteTemplate {
    pub title: Option<String>,
    pub note_type: Option<ClinicalNoteType>,
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
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub discharge_case_id: Option<Uuid>,
    pub medication_name: String,
    pub dose: String,
    pub route: String,
    pub frequency: String,
    pub inventory_item_id: Option<Uuid>,
    pub start_date: Option<NaiveDate>,
    pub duration_days: Option<i32>,
    pub first_dose_at: Option<DateTime<Utc>>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewChartEntry {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub entry_type: ChartEntryType,
    pub measured_at: DateTime<Utc>,
    pub value: String,
    pub unit: Option<String>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewProblemArtifactLink {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub problem_id: Uuid,
    pub artifact_kind: ProblemArtifactKind,
    pub artifact_id: Uuid,
    pub actor_user_id: Uuid,
    pub request_id: Option<String>,
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
    encounter_id: Option<Uuid>,
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
    encounter_id: Option<Uuid>,
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
struct ProblemArtifactLinkRow {
    id: Uuid,
    patient_id: Uuid,
    problem_id: Uuid,
    artifact_kind: String,
    artifact_id: Uuid,
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
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    discharge_case_id: Option<Uuid>,
    medication_name: String,
    dose: String,
    route: String,
    frequency: String,
    inventory_item_id: Option<Uuid>,
    start_date: Option<NaiveDate>,
    duration_days: Option<i32>,
    first_dose_at: Option<DateTime<Utc>>,
    status: String,
    prescribed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ChartEntryRow {
    id: Uuid,
    patient_id: Uuid,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
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

#[derive(Clone, Debug, FromRow)]
struct ChronicleSectionsRow {
    notes: JsonValue,
    problems: JsonValue,
    allergies: JsonValue,
    prescriptions: JsonValue,
    chart_entries: JsonValue,
}

#[derive(Clone, Debug, Default)]
pub struct ChronicleTimelineFilters {
    pub entry_type: Option<String>,
    pub search: Option<String>,
    pub encounter_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChronicleEncounterRead {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub encounter_type: String,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChronicleAdmissionRead {
    pub admission_id: Uuid,
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub bed_id: Option<Uuid>,
    pub bed_code: Option<String>,
    pub status: String,
    pub admitted_at: DateTime<Utc>,
    pub discharged_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChronicleCareTeamMemberRead {
    pub assignment_id: Uuid,
    pub encounter_id: Uuid,
    pub user_id: Uuid,
    pub display_name: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChronicleLabResultRead {
    pub id: Uuid,
    pub order_id: Uuid,
    pub specimen_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub test_id: Uuid,
    pub test_name: String,
    pub value: String,
    pub unit: Option<String>,
    pub status: String,
    pub entered_at: DateTime<Utc>,
    pub verified_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, FromRow)]
pub struct ChronicleTimelineEntryRead {
    pub entry_id: Uuid,
    pub entry_type: String,
    pub occurred_at: DateTime<Utc>,
    pub encounter_id: Option<Uuid>,
    pub title: String,
    pub summary: Option<String>,
    pub data: JsonValue,
}

#[derive(Clone, Debug)]
pub struct PatientChronicleStartupRead {
    pub active_encounter: Option<ChronicleEncounterRead>,
    pub active_admission: Option<ChronicleAdmissionRead>,
    pub encounters: Vec<ChronicleEncounterRead>,
    pub care_team: Vec<ChronicleCareTeamMemberRead>,
    pub notes: Vec<ClinicalNoteListItem>,
    pub problems: Vec<ProblemListItem>,
    pub allergies: Vec<AllergyListItem>,
    pub prescriptions: Vec<PrescriptionListItem>,
    pub chart_entries: Vec<ChartEntryListItem>,
    pub lab_results: Vec<ChronicleLabResultRead>,
    pub timeline_entries: Vec<ChronicleTimelineEntryRead>,
}

#[derive(Clone, Debug, FromRow)]
struct ChronicleStartupRow {
    active_encounter: JsonValue,
    active_admission: JsonValue,
    encounters: JsonValue,
    care_team: JsonValue,
    notes: JsonValue,
    problems: JsonValue,
    allergies: JsonValue,
    prescriptions: JsonValue,
    chart_entries: JsonValue,
    lab_results: JsonValue,
    timeline_entries: JsonValue,
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
    rows.into_iter().map(template_from_row).collect()
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
    row.map(template_from_row).transpose()
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
    .bind(codec::encode(template.note_type)?)
    .bind(template.body_template)
    .fetch_one(pool)
    .await?;
    template_from_row(row)
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
    .bind(update.note_type.map(codec::encode).transpose()?)
    .bind(update.body_template)
    .bind(update.is_active)
    .fetch_optional(pool)
    .await?;
    row.map(template_from_row).transpose()
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
    encounter_id: Option<Uuid>,
    cursor: Option<ClinicalCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ClinicalNoteListItem>> {
    let mut query = QueryBuilder::<Postgres>::new(
        r#"
        SELECT id, patient_id, encounter_id, note_type, title, status, version, updated_at
        FROM clinical_notes
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND patient_id = ");
    query.push_bind(patient_id);
    if let Some(encounter_id) = encounter_id {
        query.push(" AND encounter_id = ");
        query.push_bind(encounter_id);
    }
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
            encounter_id,
            note_type,
            title,
            body,
            status,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, patient_id, encounter_id, note_type, title, status, version, updated_at
        "#,
    )
    .bind(note.id)
    .bind(note.facility_id)
    .bind(note.patient_id)
    .bind(note.encounter_id)
    .bind(codec::encode(note.note_type)?)
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
        SELECT id, patient_id, encounter_id, note_type, title, body, status, version, updated_at
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

pub async fn create_problem_artifact_link(
    pool: &PgPool,
    link: NewProblemArtifactLink,
) -> anyhow::Result<Option<ProblemArtifactLinkItem>> {
    let problem_patient_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT patient_id
        FROM patient_problems
        WHERE facility_id = $1
          AND id = $2
        "#,
    )
    .bind(link.facility_id)
    .bind(link.problem_id)
    .fetch_optional(pool)
    .await?;

    let Some(problem_patient_id) = problem_patient_id else {
        return Ok(None);
    };

    let Some(artifact_patient_id) =
        artifact_patient_id(pool, link.facility_id, link.artifact_kind, link.artifact_id).await?
    else {
        return Ok(None);
    };

    if problem_patient_id != link.patient_id || artifact_patient_id != link.patient_id {
        return Ok(None);
    }

    let row = sqlx::query_as::<_, ProblemArtifactLinkRow>(
        r#"
        INSERT INTO problem_artifact_links (
            id,
            facility_id,
            patient_id,
            problem_id,
            artifact_kind,
            artifact_id,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (problem_id, artifact_kind, artifact_id)
        DO UPDATE SET problem_id = EXCLUDED.problem_id
        RETURNING id, patient_id, problem_id, artifact_kind, artifact_id, created_at
        "#,
    )
    .bind(link.id)
    .bind(link.facility_id)
    .bind(link.patient_id)
    .bind(link.problem_id)
    .bind(codec::encode(link.artifact_kind)?)
    .bind(link.artifact_id)
    .bind(link.actor_user_id)
    .fetch_one(pool)
    .await?;

    insert_audit_event(
        pool,
        NewAuditEvent {
            facility_id: link.facility_id,
            actor_user_id: Some(link.actor_user_id),
            request_id: link.request_id,
            event_type: "problem_artifact_link.created".to_owned(),
            resource_type: "problem_artifact_link".to_owned(),
            resource_id: Some(row.id),
            metadata: json!({
                "artifact_kind": row.artifact_kind,
                "artifact_id": row.artifact_id,
            }),
        },
    )
    .await?;

    problem_artifact_link_from_row(row).map(Some)
}

pub async fn list_problem_artifact_links(
    pool: &PgPool,
    facility_id: Uuid,
    artifact_kind: ProblemArtifactKind,
    artifact_id: Uuid,
) -> anyhow::Result<Vec<ProblemArtifactLinkItem>> {
    let rows = sqlx::query_as::<_, ProblemArtifactLinkRow>(
        r#"
        SELECT id, patient_id, problem_id, artifact_kind, artifact_id, created_at
        FROM problem_artifact_links
        WHERE facility_id = $1
          AND artifact_kind = $2
          AND artifact_id = $3
        ORDER BY created_at DESC, id DESC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .bind(codec::encode(artifact_kind)?)
    .bind(artifact_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(problem_artifact_link_from_row)
        .collect()
}

pub async fn delete_problem_artifact_link(
    pool: &PgPool,
    facility_id: Uuid,
    link_id: Uuid,
    actor_user_id: Uuid,
    request_id: Option<String>,
) -> anyhow::Result<Option<ProblemArtifactLinkItem>> {
    let row = sqlx::query_as::<_, ProblemArtifactLinkRow>(
        r#"
        DELETE FROM problem_artifact_links
        WHERE facility_id = $1
          AND id = $2
        RETURNING id, patient_id, problem_id, artifact_kind, artifact_id, created_at
        "#,
    )
    .bind(facility_id)
    .bind(link_id)
    .fetch_optional(pool)
    .await?;

    if let Some(row) = row {
        insert_audit_event(
            pool,
            NewAuditEvent {
                facility_id,
                actor_user_id: Some(actor_user_id),
                request_id,
                event_type: "problem_artifact_link.deleted".to_owned(),
                resource_type: "problem_artifact_link".to_owned(),
                resource_id: Some(row.id),
                metadata: json!({
                    "artifact_kind": row.artifact_kind,
                    "artifact_id": row.artifact_id,
                }),
            },
        )
        .await?;
        return problem_artifact_link_from_row(row).map(Some);
    }

    Ok(None)
}

pub async fn pharmacy_clinical_context(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<PharmacyClinicalContext> {
    Ok(PharmacyClinicalContext {
        patient_id,
        active_problems: list_active_problems(pool, facility_id, patient_id).await?,
        active_allergies: list_active_allergies(pool, facility_id, patient_id).await?,
        order_relevant_medications: list_active_prescriptions(pool, facility_id, patient_id)
            .await?,
    })
}

pub async fn laboratory_clinical_context(
    pool: &PgPool,
    facility_id: Uuid,
    order_id: Uuid,
) -> anyhow::Result<Option<LaboratoryClinicalContext>> {
    let Some(patient_id) =
        artifact_patient_id(pool, facility_id, ProblemArtifactKind::LabOrder, order_id).await?
    else {
        return Ok(None);
    };
    let linked_problems =
        linked_problems_for_artifact(pool, facility_id, ProblemArtifactKind::LabOrder, order_id)
            .await?;

    Ok(Some(LaboratoryClinicalContext {
        order_id,
        patient_id,
        linked_problems,
    }))
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
        SELECT id, patient_id, encounter_id, visit_id, discharge_case_id, medication_name, dose, route, frequency, inventory_item_id, start_date, duration_days, first_dose_at, status, prescribed_at
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
            id, facility_id, patient_id, encounter_id, visit_id, discharge_case_id, medication_name, dose, route, frequency, inventory_item_id, start_date, duration_days, first_dose_at, status, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id, patient_id, encounter_id, visit_id, discharge_case_id, medication_name, dose, route, frequency, inventory_item_id, start_date, duration_days, first_dose_at, status, prescribed_at
        "#,
    )
    .bind(prescription.id)
    .bind(prescription.facility_id)
    .bind(prescription.patient_id)
    .bind(prescription.encounter_id)
    .bind(prescription.visit_id)
    .bind(prescription.discharge_case_id)
    .bind(prescription.medication_name)
    .bind(prescription.dose)
    .bind(prescription.route)
    .bind(prescription.frequency)
    .bind(prescription.inventory_item_id)
    .bind(prescription.start_date)
    .bind(prescription.duration_days)
    .bind(prescription.first_dose_at)
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
        SELECT id, patient_id, encounter_id, visit_id, discharge_case_id, medication_name, dose, route, frequency, inventory_item_id, start_date, duration_days, first_dose_at, status, prescribed_at
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
            route = COALESCE($5, route),
            frequency = COALESCE($6, frequency),
            inventory_item_id = COALESCE($7, inventory_item_id),
            start_date = COALESCE($8, start_date),
            duration_days = COALESCE($9, duration_days),
            first_dose_at = COALESCE($10, first_dose_at),
            status = COALESCE($11, status),
            updated_at = now()
        WHERE facility_id = $1 AND id = $2
        RETURNING id, patient_id, encounter_id, visit_id, discharge_case_id, medication_name, dose, route, frequency, inventory_item_id, start_date, duration_days, first_dose_at, status, prescribed_at
        "#,
    )
    .bind(facility_id)
    .bind(prescription_id)
    .bind(update.medication_name)
    .bind(update.dose)
    .bind(update.route)
    .bind(update.frequency)
    .bind(update.inventory_item_id)
    .bind(update.start_date)
    .bind(update.duration_days)
    .bind(update.first_dose_at)
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
        SELECT id, patient_id, encounter_id, visit_id, entry_type, measured_at, value, unit
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
            id, facility_id, patient_id, encounter_id, visit_id, entry_type, measured_at, value, unit, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, patient_id, encounter_id, visit_id, entry_type, measured_at, value, unit
        "#,
    )
    .bind(entry.id)
    .bind(entry.facility_id)
    .bind(entry.patient_id)
    .bind(entry.encounter_id)
    .bind(entry.visit_id)
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

    patient_chronicle_summary_for_patient(pool, patient, limit)
        .await
        .map(Some)
}

pub async fn patient_chronicle_summary_for_patient(
    pool: &PgPool,
    patient: PatientRecord,
    limit: i64,
) -> anyhow::Result<PatientChronicleSummary> {
    let limit = limit.clamp(1, 100);
    let sections = patient_chronicle_sections(pool, patient.facility_id, patient.id, limit).await?;

    Ok(PatientChronicleSummary {
        patient: PatientDetail::from(&patient),
        generated_at: Utc::now(),
        notes: decode_chronicle_section(sections.notes, "notes")?,
        problems: decode_chronicle_section(sections.problems, "problems")?,
        allergies: decode_chronicle_section(sections.allergies, "allergies")?,
        prescriptions: decode_chronicle_section(sections.prescriptions, "prescriptions")?,
        chart_entries: decode_chronicle_section(sections.chart_entries, "chart_entries")?,
    })
}

pub async fn patient_chronicle_startup_for_patient(
    pool: &PgPool,
    patient: &PatientRecord,
    summary_limit: i64,
    timeline_limit: i64,
    cursor: Option<ClinicalCursor>,
    filters: ChronicleTimelineFilters,
) -> anyhow::Result<PatientChronicleStartupRead> {
    let summary_limit = summary_limit.clamp(1, 20);
    let timeline_limit = timeline_limit.clamp(1, 101);
    let cursor_occurred_at = cursor.as_ref().map(|cursor| cursor.occurred_at);
    let cursor_id = cursor.as_ref().map(|cursor| cursor.id);
    let search_pattern = filters
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    let row = observe_db_query(
        "clinical.patient_chronicle.startup",
        sqlx::query_as::<_, ChronicleStartupRow>(CHRONICLE_STARTUP_SQL)
            .bind(patient.facility_id)
            .bind(patient.id)
            .bind(summary_limit)
            .bind(timeline_limit)
            .bind(cursor_occurred_at)
            .bind(cursor_id)
            .bind(filters.entry_type)
            .bind(search_pattern)
            .bind(filters.encounter_id)
            .fetch_one(pool),
    )
    .await?;

    Ok(PatientChronicleStartupRead {
        active_encounter: decode_optional_chronicle_value(
            row.active_encounter,
            "active_encounter",
        )?,
        active_admission: decode_optional_chronicle_value(
            row.active_admission,
            "active_admission",
        )?,
        encounters: decode_chronicle_section(row.encounters, "encounters")?,
        care_team: decode_chronicle_section(row.care_team, "care_team")?,
        notes: decode_chronicle_section(row.notes, "notes")?,
        problems: decode_chronicle_section(row.problems, "problems")?,
        allergies: decode_chronicle_section(row.allergies, "allergies")?,
        prescriptions: decode_chronicle_section(row.prescriptions, "prescriptions")?,
        chart_entries: decode_chronicle_section(row.chart_entries, "chart_entries")?,
        lab_results: decode_chronicle_section(row.lab_results, "lab_results")?,
        timeline_entries: decode_chronicle_section(row.timeline_entries, "timeline_entries")?,
    })
}

pub async fn patient_chronicle_timeline(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    cursor: Option<ClinicalCursor>,
    limit: i64,
    filters: ChronicleTimelineFilters,
) -> anyhow::Result<Vec<ChronicleTimelineEntryRead>> {
    let limit = limit.clamp(1, 101);
    let cursor_occurred_at = cursor.as_ref().map(|cursor| cursor.occurred_at);
    let cursor_id = cursor.as_ref().map(|cursor| cursor.id);
    let search_pattern = filters
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    let rows = observe_db_query(
        "clinical.patient_chronicle.timeline",
        sqlx::query_as::<_, ChronicleTimelineEntryRead>(CHRONICLE_TIMELINE_SQL)
            .bind(facility_id)
            .bind(patient_id)
            .bind(limit)
            .bind(cursor_occurred_at)
            .bind(cursor_id)
            .bind(filters.entry_type)
            .bind(search_pattern)
            .bind(filters.encounter_id)
            .fetch_all(pool),
    )
    .await?;

    Ok(rows)
}

async fn patient_chronicle_sections(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    limit: i64,
) -> anyhow::Result<ChronicleSectionsRow> {
    let row = observe_db_query(
        "clinical.patient_chronicle.sections",
        sqlx::query_as::<_, ChronicleSectionsRow>(
            r#"
            SELECT
              COALESCE((
                SELECT jsonb_agg(to_jsonb(notes) ORDER BY notes.updated_at DESC, notes.id DESC)
                FROM (
                  SELECT id, patient_id, encounter_id, note_type, title, status, version, updated_at
                  FROM clinical_notes
                  WHERE facility_id = $1 AND patient_id = $2
                  ORDER BY updated_at DESC, id DESC
                  LIMIT $3
                ) notes
              ), '[]'::jsonb) AS notes,
              COALESCE((
                SELECT jsonb_agg(to_jsonb(problems) ORDER BY problems.created_at DESC, problems.id DESC)
                FROM (
                  SELECT id, patient_id, label, status, onset_date, created_at
                  FROM patient_problems
                  WHERE facility_id = $1 AND patient_id = $2
                  ORDER BY created_at DESC, id DESC
                  LIMIT $3
                ) problems
              ), '[]'::jsonb) AS problems,
              COALESCE((
                SELECT jsonb_agg(to_jsonb(allergies) ORDER BY allergies.created_at DESC, allergies.id DESC)
                FROM (
                  SELECT id, patient_id, substance, reaction, severity, status, created_at
                  FROM patient_allergies
                  WHERE facility_id = $1 AND patient_id = $2
                  ORDER BY created_at DESC, id DESC
                  LIMIT $3
                ) allergies
              ), '[]'::jsonb) AS allergies,
              COALESCE((
                SELECT jsonb_agg(to_jsonb(prescriptions) ORDER BY prescriptions.prescribed_at DESC, prescriptions.id DESC)
                FROM (
                  SELECT id, patient_id, medication_name, dose, route, frequency, inventory_item_id, start_date, duration_days, first_dose_at, status, prescribed_at
                  FROM prescriptions
                  WHERE facility_id = $1 AND patient_id = $2
                  ORDER BY prescribed_at DESC, id DESC
                  LIMIT $3
                ) prescriptions
              ), '[]'::jsonb) AS prescriptions,
              COALESCE((
                SELECT jsonb_agg(to_jsonb(chart_entries) ORDER BY chart_entries.measured_at DESC, chart_entries.id DESC)
                FROM (
                  SELECT id, patient_id, encounter_id, visit_id, entry_type, measured_at, value, unit
                  FROM chart_entries
                  WHERE facility_id = $1 AND patient_id = $2
                  ORDER BY measured_at DESC, id DESC
                  LIMIT $3
                ) chart_entries
              ), '[]'::jsonb) AS chart_entries
            "#,
        )
        .bind(facility_id)
        .bind(patient_id)
        .bind(limit)
        .fetch_one(pool),
    )
    .await?;
    Ok(row)
}

const CHRONICLE_STARTUP_SQL: &str = r#"
WITH patient_encounters AS (
  SELECT id, patient_id, encounter_type, status, started_at, ended_at
  FROM encounters
  WHERE facility_id = $1
    AND patient_id = $2
  ORDER BY started_at DESC, id DESC
  LIMIT 50
),
active_encounter AS (
  SELECT id, patient_id, encounter_type, status, started_at, ended_at
  FROM patient_encounters
  WHERE status = 'in_progress'
  ORDER BY started_at DESC, id DESC
  LIMIT 1
),
active_admission AS (
  SELECT admission_cases.id AS admission_id,
         admission_cases.patient_id,
         admission_cases.ward_id,
         wards.name AS ward_name,
         admission_cases.bed_id,
         beds.bed_code,
         admission_cases.status,
         admission_cases.admitted_at,
         admission_cases.discharged_at
  FROM admission_cases
  JOIN wards
    ON wards.id = admission_cases.ward_id
   AND wards.facility_id = admission_cases.facility_id
  LEFT JOIN beds
    ON beds.id = admission_cases.bed_id
   AND beds.facility_id = admission_cases.facility_id
  WHERE admission_cases.facility_id = $1
    AND admission_cases.patient_id = $2
    AND admission_cases.status IN ('admitted', 'discharge_pending')
  ORDER BY admission_cases.admitted_at DESC, admission_cases.id DESC
  LIMIT 1
),
care_team AS (
  SELECT assignments.id AS assignment_id,
         assignments.encounter_id,
         assignments.user_id,
         users.display_name,
         assignments.role,
         assignments.is_active,
         assignments.created_at
  FROM encounter_care_team_assignments assignments
  JOIN active_encounter ON active_encounter.id = assignments.encounter_id
  JOIN users ON users.id = assignments.user_id
  WHERE assignments.is_active = TRUE
  ORDER BY assignments.created_at ASC, assignments.id ASC
  LIMIT 10
),
	timeline_entries AS (
  SELECT entries.entry_id,
         entries.entry_type,
         entries.occurred_at,
         entries.encounter_id,
         entries.title,
         entries.summary,
         entries.data
  FROM (
    SELECT clinical_notes.id AS entry_id,
           CASE
             WHEN clinical_notes.note_type IN (
               'doctor_note',
               'nursing_note',
               'allied_health_note'
             )
             THEN clinical_notes.note_type
             ELSE 'doctor_note'
           END AS entry_type,
           'note' AS entry_category,
           clinical_notes.updated_at AS occurred_at,
           clinical_notes.encounter_id,
           NULL::uuid AS visit_id,
           clinical_notes.title,
           concat_ws(' · ', clinical_notes.note_type, clinical_notes.status) AS summary,
           jsonb_build_object(
             'note_type', clinical_notes.note_type,
             'status', clinical_notes.status,
             'version', clinical_notes.version
           ) AS data
    FROM clinical_notes
    WHERE clinical_notes.facility_id = $1
      AND clinical_notes.patient_id = $2

    UNION ALL

    SELECT prescriptions.id AS entry_id,
           'prescription' AS entry_type,
           'prescription' AS entry_category,
           prescriptions.prescribed_at AS occurred_at,
	           prescriptions.encounter_id AS encounter_id,
	           prescriptions.visit_id AS visit_id,
           prescriptions.medication_name AS title,
           concat_ws(' ', prescriptions.dose, prescriptions.frequency, prescriptions.status) AS summary,
           jsonb_build_object(
             'medication_name', prescriptions.medication_name,
             'dose', prescriptions.dose,
             'dosage', prescriptions.dose,
             'frequency', prescriptions.frequency,
             'frequency_display', prescriptions.frequency,
             'status', prescriptions.status
           ) AS data
    FROM prescriptions
    WHERE prescriptions.facility_id = $1
      AND prescriptions.patient_id = $2

    UNION ALL

    SELECT chart_entries.id AS entry_id,
           'vitals' AS entry_type,
           'vitals' AS entry_category,
           chart_entries.measured_at AS occurred_at,
           chart_entries.encounter_id AS encounter_id,
           chart_entries.visit_id AS visit_id,
           chart_entries.entry_type AS title,
           concat_ws(' ', chart_entries.value, chart_entries.unit) AS summary,
           CASE chart_entries.entry_type
             WHEN 'temperature' THEN jsonb_build_object('temperature', chart_entries.value)
             WHEN 'pulse' THEN jsonb_build_object('heart_rate', chart_entries.value)
             WHEN 'respiratory_rate' THEN jsonb_build_object('respiratory_rate', chart_entries.value)
             WHEN 'blood_pressure' THEN jsonb_build_object('blood_pressure', chart_entries.value)
             WHEN 'oxygen_saturation' THEN jsonb_build_object('oxygen_saturation', chart_entries.value, 'spo2', chart_entries.value)
             ELSE jsonb_build_object(
               'entry_type', chart_entries.entry_type,
               'value', chart_entries.value,
               'unit', chart_entries.unit
             )
           END AS data
    FROM chart_entries
    WHERE chart_entries.facility_id = $1
      AND chart_entries.patient_id = $2

    UNION ALL

    SELECT lab_results.id AS entry_id,
           'lab_result' AS entry_type,
           'lab_result' AS entry_category,
           lab_results.entered_at AS occurred_at,
	           lab_orders.encounter_id AS encounter_id,
	           lab_orders.visit_id AS visit_id,
           lab_tests.name AS title,
           concat_ws(' ', lab_results.value, lab_results.unit, lab_results.status) AS summary,
           jsonb_build_object(
             'order_id', lab_results.order_id,
             'specimen_id', lab_results.specimen_id,
             'test_id', lab_results.test_id,
             'test_name', lab_tests.name,
             'value', lab_results.value,
             'unit', lab_results.unit,
             'status', lab_results.status,
             'verified_at', lab_results.verified_at
           ) AS data
	    FROM lab_results
	    JOIN lab_orders
	      ON lab_orders.id = lab_results.order_id
	     AND lab_orders.facility_id = lab_results.facility_id
	    JOIN lab_tests
      ON lab_tests.id = lab_results.test_id
     AND lab_tests.facility_id = lab_results.facility_id
    WHERE lab_results.facility_id = $1
      AND lab_results.patient_id = $2

    UNION ALL

    SELECT patient_problems.id AS entry_id,
           'problem' AS entry_type,
           'problem' AS entry_category,
           patient_problems.created_at AS occurred_at,
           NULL::uuid AS encounter_id,
           NULL::uuid AS visit_id,
           patient_problems.label AS title,
           patient_problems.status AS summary,
           jsonb_build_object(
             'label', patient_problems.label,
             'status', patient_problems.status,
             'onset_date', patient_problems.onset_date
           ) AS data
    FROM patient_problems
    WHERE patient_problems.facility_id = $1
      AND patient_problems.patient_id = $2

    UNION ALL

    SELECT patient_allergies.id AS entry_id,
           'allergy' AS entry_type,
           'allergy' AS entry_category,
           patient_allergies.created_at AS occurred_at,
           NULL::uuid AS encounter_id,
           NULL::uuid AS visit_id,
           patient_allergies.substance AS title,
           concat_ws(' · ', patient_allergies.severity, patient_allergies.status) AS summary,
           jsonb_build_object(
             'substance', patient_allergies.substance,
             'reaction', patient_allergies.reaction,
             'severity', patient_allergies.severity,
             'status', patient_allergies.status
           ) AS data
    FROM patient_allergies
    WHERE patient_allergies.facility_id = $1
      AND patient_allergies.patient_id = $2

    UNION ALL

    SELECT ward_rounds.id AS entry_id,
           'ward_round' AS entry_type,
           'ward_round' AS entry_category,
           ward_rounds.signed_at AS occurred_at,
           NULL::uuid AS encounter_id,
           NULL::uuid AS visit_id,
           'Ward Round' AS title,
           concat_ws(' · ', 'signed', count(ward_round_actions.id)::text || ' actions') AS summary,
           jsonb_build_object(
             'status', ward_rounds.status,
             'version', ward_rounds.version,
             'action_counts', jsonb_build_object(
               'prescriptions', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'prescription'),
               'lab_orders', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'lab_order'),
               'nursing_tasks', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'nursing_task'),
               'discharge_requests', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'discharge_request')
             ),
             'created_artifacts', COALESCE((
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'resource_type', links.resource_type,
                   'resource_id', links.resource_id,
                   'title', links.title
                 )
                 ORDER BY links.created_at ASC, links.id ASC
               )
               FROM ward_round_artifact_links links
               WHERE links.ward_round_id = ward_rounds.id
             ), '[]'::jsonb)
           ) AS data
    FROM ward_rounds
    LEFT JOIN ward_round_actions
      ON ward_round_actions.ward_round_id = ward_rounds.id
    WHERE ward_rounds.facility_id = $1
      AND ward_rounds.patient_id = $2
      AND ward_rounds.status = 'committed'
      AND ward_rounds.signed_at IS NOT NULL
    GROUP BY ward_rounds.id, ward_rounds.status, ward_rounds.version, ward_rounds.signed_at
  ) entries
  WHERE ($5::timestamptz IS NULL OR (entries.occurred_at, entries.entry_id) < ($5::timestamptz, $6::uuid))
    AND ($7::text IS NULL OR entries.entry_category = $7)
    AND ($8::text IS NULL OR entries.title ILIKE $8 OR entries.summary ILIKE $8)
	    AND (
	      $9::uuid IS NULL
	      OR entries.encounter_id = $9
	      OR entries.visit_id = (
	        SELECT encounters.visit_id
        FROM encounters
        WHERE encounters.facility_id = $1
          AND encounters.patient_id = $2
	          AND encounters.id = $9
	      )
	      OR entries.entry_category IN ('problem', 'allergy')
	      OR (
	        entries.encounter_id IS NULL
	        AND entries.visit_id IS NULL
	        AND entries.entry_category IN ('prescription', 'lab_result', 'ward_round')
	        AND entries.occurred_at >= (
	          SELECT encounters.started_at
	          FROM encounters
	          WHERE encounters.facility_id = $1
	            AND encounters.patient_id = $2
	            AND encounters.id = $9
	        )
	        AND (
	          SELECT encounters.ended_at IS NULL
	            OR entries.occurred_at < encounters.ended_at
	          FROM encounters
	          WHERE encounters.facility_id = $1
	            AND encounters.patient_id = $2
	            AND encounters.id = $9
	        )
	      )
	    )
  ORDER BY entries.occurred_at DESC, entries.entry_id DESC
  LIMIT $4
)
SELECT
  COALESCE((SELECT to_jsonb(active_encounter) FROM active_encounter), 'null'::jsonb) AS active_encounter,
  COALESCE((SELECT to_jsonb(active_admission) FROM active_admission), 'null'::jsonb) AS active_admission,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(patient_encounters) ORDER BY patient_encounters.started_at DESC, patient_encounters.id DESC)
    FROM patient_encounters
  ), '[]'::jsonb) AS encounters,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(care_team) ORDER BY care_team.created_at ASC, care_team.assignment_id ASC)
    FROM care_team
  ), '[]'::jsonb) AS care_team,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(notes) ORDER BY notes.updated_at DESC, notes.id DESC)
    FROM (
      SELECT id, patient_id, encounter_id, note_type, title, status, version, updated_at
      FROM clinical_notes
      WHERE facility_id = $1 AND patient_id = $2
      ORDER BY updated_at DESC, id DESC
      LIMIT $3
    ) notes
  ), '[]'::jsonb) AS notes,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(problems) ORDER BY problems.created_at DESC, problems.id DESC)
    FROM (
      SELECT id, patient_id, label, status, onset_date, created_at
      FROM patient_problems
      WHERE facility_id = $1 AND patient_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    ) problems
  ), '[]'::jsonb) AS problems,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(allergies) ORDER BY allergies.created_at DESC, allergies.id DESC)
    FROM (
      SELECT id, patient_id, substance, reaction, severity, status, created_at
      FROM patient_allergies
      WHERE facility_id = $1 AND patient_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    ) allergies
  ), '[]'::jsonb) AS allergies,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(prescriptions) ORDER BY prescriptions.prescribed_at DESC, prescriptions.id DESC)
    FROM (
      SELECT id, patient_id, medication_name, dose, route, frequency, inventory_item_id, start_date, duration_days, first_dose_at, status, prescribed_at
      FROM prescriptions
      WHERE facility_id = $1 AND patient_id = $2
      ORDER BY prescribed_at DESC, id DESC
      LIMIT $3
    ) prescriptions
  ), '[]'::jsonb) AS prescriptions,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(chart_entries) ORDER BY chart_entries.measured_at DESC, chart_entries.id DESC)
    FROM (
      SELECT id, patient_id, encounter_id, visit_id, entry_type, measured_at, value, unit
      FROM chart_entries
      WHERE facility_id = $1 AND patient_id = $2
      ORDER BY measured_at DESC, id DESC
      LIMIT $3
    ) chart_entries
  ), '[]'::jsonb) AS chart_entries,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(labs) ORDER BY labs.entered_at DESC, labs.id DESC)
    FROM (
      SELECT lab_results.id,
             lab_results.order_id,
             lab_results.specimen_id,
             lab_results.patient_id,
             patients.patient_code,
             lab_results.test_id,
             lab_tests.name AS test_name,
             lab_results.value,
             lab_results.unit,
             lab_results.status,
             lab_results.entered_at,
             lab_results.verified_at
      FROM lab_results
      JOIN patients
        ON patients.id = lab_results.patient_id
       AND patients.facility_id = lab_results.facility_id
      JOIN lab_tests
        ON lab_tests.id = lab_results.test_id
       AND lab_tests.facility_id = lab_results.facility_id
      WHERE lab_results.facility_id = $1 AND lab_results.patient_id = $2
      ORDER BY lab_results.entered_at DESC, lab_results.id DESC
      LIMIT $3
    ) labs
  ), '[]'::jsonb) AS lab_results,
  COALESCE((
    SELECT jsonb_agg(to_jsonb(timeline_entries) ORDER BY timeline_entries.occurred_at DESC, timeline_entries.entry_id DESC)
    FROM timeline_entries
  ), '[]'::jsonb) AS timeline_entries
"#;

const CHRONICLE_TIMELINE_SQL: &str = r#"
SELECT entries.entry_id,
       entries.entry_type,
       entries.occurred_at,
       entries.encounter_id,
       entries.title,
       entries.summary,
       entries.data
FROM (
  SELECT clinical_notes.id AS entry_id,
         CASE
           WHEN clinical_notes.note_type IN (
             'doctor_note',
             'nursing_note',
             'allied_health_note'
           )
           THEN clinical_notes.note_type
           ELSE 'doctor_note'
         END AS entry_type,
         'note' AS entry_category,
         clinical_notes.updated_at AS occurred_at,
         clinical_notes.encounter_id,
         NULL::uuid AS visit_id,
         clinical_notes.title,
         concat_ws(' · ', clinical_notes.note_type, clinical_notes.status) AS summary,
         jsonb_build_object(
           'note_type', clinical_notes.note_type,
           'status', clinical_notes.status,
           'version', clinical_notes.version
         ) AS data
  FROM clinical_notes
  WHERE clinical_notes.facility_id = $1
    AND clinical_notes.patient_id = $2

  UNION ALL

  SELECT prescriptions.id AS entry_id,
         'prescription' AS entry_type,
         'prescription' AS entry_category,
         prescriptions.prescribed_at AS occurred_at,
         prescriptions.encounter_id AS encounter_id,
         prescriptions.visit_id AS visit_id,
         prescriptions.medication_name AS title,
         concat_ws(' ', prescriptions.dose, prescriptions.frequency, prescriptions.status) AS summary,
         jsonb_build_object(
           'medication_name', prescriptions.medication_name,
           'dose', prescriptions.dose,
           'dosage', prescriptions.dose,
           'frequency', prescriptions.frequency,
           'frequency_display', prescriptions.frequency,
           'status', prescriptions.status
         ) AS data
  FROM prescriptions
  WHERE prescriptions.facility_id = $1
    AND prescriptions.patient_id = $2

  UNION ALL

  SELECT chart_entries.id AS entry_id,
         'vitals' AS entry_type,
         'vitals' AS entry_category,
         chart_entries.measured_at AS occurred_at,
         chart_entries.encounter_id AS encounter_id,
         chart_entries.visit_id AS visit_id,
         chart_entries.entry_type AS title,
         concat_ws(' ', chart_entries.value, chart_entries.unit) AS summary,
         CASE chart_entries.entry_type
           WHEN 'temperature' THEN jsonb_build_object('temperature', chart_entries.value)
           WHEN 'pulse' THEN jsonb_build_object('heart_rate', chart_entries.value)
           WHEN 'respiratory_rate' THEN jsonb_build_object('respiratory_rate', chart_entries.value)
           WHEN 'blood_pressure' THEN jsonb_build_object('blood_pressure', chart_entries.value)
           WHEN 'oxygen_saturation' THEN jsonb_build_object('oxygen_saturation', chart_entries.value, 'spo2', chart_entries.value)
           ELSE jsonb_build_object(
             'entry_type', chart_entries.entry_type,
             'value', chart_entries.value,
             'unit', chart_entries.unit
           )
         END AS data
  FROM chart_entries
  WHERE chart_entries.facility_id = $1
    AND chart_entries.patient_id = $2

  UNION ALL

  SELECT lab_results.id AS entry_id,
         'lab_result' AS entry_type,
         'lab_result' AS entry_category,
         lab_results.entered_at AS occurred_at,
         lab_orders.encounter_id AS encounter_id,
         lab_orders.visit_id AS visit_id,
         lab_tests.name AS title,
         concat_ws(' ', lab_results.value, lab_results.unit, lab_results.status) AS summary,
         jsonb_build_object(
           'order_id', lab_results.order_id,
           'specimen_id', lab_results.specimen_id,
           'test_id', lab_results.test_id,
           'test_name', lab_tests.name,
           'value', lab_results.value,
           'unit', lab_results.unit,
           'status', lab_results.status,
           'verified_at', lab_results.verified_at
         ) AS data
	  FROM lab_results
	  JOIN lab_orders
	    ON lab_orders.id = lab_results.order_id
	   AND lab_orders.facility_id = lab_results.facility_id
	  JOIN lab_tests
    ON lab_tests.id = lab_results.test_id
   AND lab_tests.facility_id = lab_results.facility_id
  WHERE lab_results.facility_id = $1
    AND lab_results.patient_id = $2

  UNION ALL

  SELECT patient_problems.id AS entry_id,
         'problem' AS entry_type,
         'problem' AS entry_category,
         patient_problems.created_at AS occurred_at,
         NULL::uuid AS encounter_id,
         NULL::uuid AS visit_id,
         patient_problems.label AS title,
         patient_problems.status AS summary,
         jsonb_build_object(
           'label', patient_problems.label,
           'status', patient_problems.status,
           'onset_date', patient_problems.onset_date
         ) AS data
  FROM patient_problems
  WHERE patient_problems.facility_id = $1
    AND patient_problems.patient_id = $2

  UNION ALL

  SELECT patient_allergies.id AS entry_id,
         'allergy' AS entry_type,
         'allergy' AS entry_category,
         patient_allergies.created_at AS occurred_at,
         NULL::uuid AS encounter_id,
         NULL::uuid AS visit_id,
         patient_allergies.substance AS title,
         concat_ws(' · ', patient_allergies.severity, patient_allergies.status) AS summary,
         jsonb_build_object(
           'substance', patient_allergies.substance,
           'reaction', patient_allergies.reaction,
           'severity', patient_allergies.severity,
           'status', patient_allergies.status
         ) AS data
  FROM patient_allergies
  WHERE patient_allergies.facility_id = $1
    AND patient_allergies.patient_id = $2

  UNION ALL

  SELECT ward_rounds.id AS entry_id,
         'ward_round' AS entry_type,
         'ward_round' AS entry_category,
         ward_rounds.signed_at AS occurred_at,
         NULL::uuid AS encounter_id,
         NULL::uuid AS visit_id,
         'Ward Round' AS title,
         concat_ws(' · ', 'signed', count(ward_round_actions.id)::text || ' actions') AS summary,
         jsonb_build_object(
           'status', ward_rounds.status,
           'version', ward_rounds.version,
           'action_counts', jsonb_build_object(
             'prescriptions', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'prescription'),
             'lab_orders', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'lab_order'),
             'nursing_tasks', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'nursing_task'),
             'discharge_requests', count(ward_round_actions.id) FILTER (WHERE ward_round_actions.action_type = 'discharge_request')
           ),
           'created_artifacts', COALESCE((
             SELECT jsonb_agg(
               jsonb_build_object(
                 'resource_type', links.resource_type,
                 'resource_id', links.resource_id,
                 'title', links.title
               )
               ORDER BY links.created_at ASC, links.id ASC
             )
             FROM ward_round_artifact_links links
             WHERE links.ward_round_id = ward_rounds.id
           ), '[]'::jsonb)
         ) AS data
  FROM ward_rounds
  LEFT JOIN ward_round_actions
    ON ward_round_actions.ward_round_id = ward_rounds.id
  WHERE ward_rounds.facility_id = $1
    AND ward_rounds.patient_id = $2
    AND ward_rounds.status = 'committed'
    AND ward_rounds.signed_at IS NOT NULL
  GROUP BY ward_rounds.id, ward_rounds.status, ward_rounds.version, ward_rounds.signed_at
) entries
WHERE ($4::timestamptz IS NULL OR (entries.occurred_at, entries.entry_id) < ($4::timestamptz, $5::uuid))
  AND ($6::text IS NULL OR entries.entry_category = $6)
  AND ($7::text IS NULL OR entries.title ILIKE $7 OR entries.summary ILIKE $7)
	  AND (
	    $8::uuid IS NULL
	    OR entries.encounter_id = $8
	    OR entries.visit_id = (
      SELECT encounters.visit_id
      FROM encounters
      WHERE encounters.facility_id = $1
        AND encounters.patient_id = $2
	        AND encounters.id = $8
	    )
	    OR entries.entry_category IN ('problem', 'allergy')
	    OR (
	      entries.encounter_id IS NULL
	      AND entries.visit_id IS NULL
	      AND entries.entry_category IN ('prescription', 'lab_result', 'ward_round')
	      AND entries.occurred_at >= (
	        SELECT encounters.started_at
	        FROM encounters
	        WHERE encounters.facility_id = $1
	          AND encounters.patient_id = $2
	          AND encounters.id = $8
	      )
	      AND (
	        SELECT encounters.ended_at IS NULL
	          OR entries.occurred_at < encounters.ended_at
	        FROM encounters
	        WHERE encounters.facility_id = $1
	          AND encounters.patient_id = $2
	          AND encounters.id = $8
	      )
	    )
	  )
ORDER BY entries.occurred_at DESC, entries.entry_id DESC
LIMIT $3
"#;

fn decode_chronicle_section<T>(value: JsonValue, section: &'static str) -> anyhow::Result<Vec<T>>
where
    T: DeserializeOwned,
{
    serde_json::from_value(value)
        .with_context(|| format!("patient Chronicle section {section} could not be decoded"))
}

fn decode_optional_chronicle_value<T>(
    value: JsonValue,
    section: &'static str,
) -> anyhow::Result<Option<T>>
where
    T: DeserializeOwned,
{
    if value.is_null() {
        return Ok(None);
    }
    serde_json::from_value(value)
        .map(Some)
        .with_context(|| format!("patient Chronicle value {section} could not be decoded"))
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

async fn artifact_patient_id(
    pool: &PgPool,
    facility_id: Uuid,
    kind: ProblemArtifactKind,
    artifact_id: Uuid,
) -> anyhow::Result<Option<Uuid>> {
    let sql = match kind {
        ProblemArtifactKind::ClinicalNote => {
            "SELECT patient_id FROM clinical_notes WHERE facility_id = $1 AND id = $2"
        }
        ProblemArtifactKind::Prescription => {
            "SELECT patient_id FROM prescriptions WHERE facility_id = $1 AND id = $2"
        }
        ProblemArtifactKind::LabOrder => {
            "SELECT patient_id FROM lab_orders WHERE facility_id = $1 AND id = $2"
        }
        ProblemArtifactKind::Encounter => {
            "SELECT patient_id FROM encounters WHERE facility_id = $1 AND id = $2"
        }
    };

    Ok(sqlx::query_scalar::<_, Uuid>(sql)
        .bind(facility_id)
        .bind(artifact_id)
        .fetch_optional(pool)
        .await?)
}

async fn list_active_problems(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<Vec<ProblemListItem>> {
    let rows = sqlx::query_as::<_, ProblemRow>(
        r#"
        SELECT id, patient_id, label, status, onset_date, created_at
        FROM patient_problems
        WHERE facility_id = $1
          AND patient_id = $2
          AND status = $3
        ORDER BY created_at DESC, id DESC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .bind(codec::encode(ProblemStatus::Active)?)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(problem_from_row).collect()
}

async fn list_active_allergies(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<Vec<AllergyListItem>> {
    let rows = sqlx::query_as::<_, AllergyRow>(
        r#"
        SELECT id, patient_id, substance, reaction, severity, status, created_at
        FROM patient_allergies
        WHERE facility_id = $1
          AND patient_id = $2
          AND status = $3
        ORDER BY created_at DESC, id DESC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .bind(codec::encode(AllergyStatus::Active)?)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(allergy_from_row).collect()
}

async fn list_active_prescriptions(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
) -> anyhow::Result<Vec<PrescriptionListItem>> {
    let rows = sqlx::query_as::<_, PrescriptionRow>(
        r#"
        SELECT id, patient_id, encounter_id, visit_id, discharge_case_id, medication_name, dose, route, frequency, inventory_item_id, start_date, duration_days, first_dose_at, status, prescribed_at
        FROM prescriptions
        WHERE facility_id = $1
          AND patient_id = $2
          AND status IN ($3, $4)
        ORDER BY prescribed_at DESC, id DESC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .bind(codec::encode(PrescriptionStatus::Active)?)
    .bind(codec::encode(PrescriptionStatus::OnHold)?)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(prescription_from_row).collect()
}

async fn linked_problems_for_artifact(
    pool: &PgPool,
    facility_id: Uuid,
    artifact_kind: ProblemArtifactKind,
    artifact_id: Uuid,
) -> anyhow::Result<Vec<ProblemListItem>> {
    let rows = sqlx::query_as::<_, ProblemRow>(
        r#"
        SELECT patient_problems.id,
               patient_problems.patient_id,
               patient_problems.label,
               patient_problems.status,
               patient_problems.onset_date,
               patient_problems.created_at
        FROM problem_artifact_links
        JOIN patient_problems
          ON patient_problems.id = problem_artifact_links.problem_id
         AND patient_problems.facility_id = problem_artifact_links.facility_id
         AND patient_problems.patient_id = problem_artifact_links.patient_id
        WHERE problem_artifact_links.facility_id = $1
          AND problem_artifact_links.artifact_kind = $2
          AND problem_artifact_links.artifact_id = $3
        ORDER BY problem_artifact_links.created_at DESC, problem_artifact_links.id DESC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .bind(codec::encode(artifact_kind)?)
    .bind(artifact_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(problem_from_row).collect()
}

fn template_from_row(row: TemplateRow) -> anyhow::Result<ClinicalNoteTemplate> {
    Ok(ClinicalNoteTemplate {
        id: row.id,
        title: row.title,
        note_type: codec::decode(&row.note_type)?,
        body_template: row.body_template,
        is_active: row.is_active,
    })
}

fn note_from_row(row: NoteRow) -> anyhow::Result<ClinicalNoteListItem> {
    Ok(ClinicalNoteListItem {
        id: row.id,
        patient_id: row.patient_id,
        encounter_id: row.encounter_id,
        note_type: codec::decode(&row.note_type)?,
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
        encounter_id: row.encounter_id,
        note_type: codec::decode(&row.note_type)?,
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

fn problem_artifact_link_from_row(
    row: ProblemArtifactLinkRow,
) -> anyhow::Result<ProblemArtifactLinkItem> {
    Ok(ProblemArtifactLinkItem {
        id: row.id,
        patient_id: row.patient_id,
        problem_id: row.problem_id,
        artifact_kind: codec::decode(&row.artifact_kind)?,
        artifact_id: row.artifact_id,
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
        encounter_id: row.encounter_id,
        visit_id: row.visit_id,
        discharge_case_id: row.discharge_case_id,
        medication_name: row.medication_name,
        dose: row.dose,
        route: row.route,
        frequency: row.frequency,
        inventory_item_id: row.inventory_item_id,
        start_date: row.start_date,
        duration_days: row.duration_days,
        first_dose_at: row.first_dose_at,
        status: codec::decode(&row.status)?,
        prescribed_at: row.prescribed_at,
    })
}

fn chart_entry_from_row(row: ChartEntryRow) -> anyhow::Result<ChartEntryListItem> {
    Ok(ChartEntryListItem {
        id: row.id,
        patient_id: row.patient_id,
        encounter_id: row.encounter_id,
        visit_id: row.visit_id,
        entry_type: codec::decode(&row.entry_type)?,
        measured_at: row.measured_at,
        value: row.value,
        unit: row.unit,
    })
}
