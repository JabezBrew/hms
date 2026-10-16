//! Locked clinical note commands. Content is never sent to logs or audit metadata.
use super::prescription_courses::{
    PrescriptionActor, PrescriptionAuthorization, PrescriptionCourseError,
};
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::clinical_notes::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone)]
pub struct NoteActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub authorization: PrescriptionAuthorization,
    pub can_manage: bool,
    pub override_ownership: bool,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NoteError {
    NotFound,
    InvalidInput,
    SourceChanged,
    AuthorRequired,
    TemplateUnavailable,
    ContextChanged,
    RequestConflict,
    AuthorizationExpired,
}
impl std::fmt::Display for NoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::NotFound => "clinical_note_not_found",
            Self::InvalidInput => "invalid_clinical_note_command",
            Self::SourceChanged => "clinical_note_source_changed",
            Self::AuthorRequired => "clinical_note_author_required",
            Self::TemplateUnavailable => "clinical_note_template_unavailable",
            Self::ContextChanged => "clinical_note_context_changed",
            Self::RequestConflict => "clinical_note_request_conflict",
            Self::AuthorizationExpired => "clinical_note_authorization_expired",
        })
    }
}
impl std::error::Error for NoteError {}
pub(crate) async fn verify_actor(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut NoteActor,
) -> anyhow::Result<()> {
    let mut proof = PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: actor.request_id.clone(),
        authorization: Some(actor.authorization.clone()),
    };
    super::prescription_courses::verify_actor(tx, &mut proof)
        .await
        .map_err(|error| {
            if error.is::<PrescriptionCourseError>() {
                NoteError::AuthorizationExpired.into()
            } else {
                error
            }
        })?;
    actor.authorization = proof.authorization.ok_or(NoteError::AuthorizationExpired)?;
    // Feature writers hold the same facility parent lock. An entitlement change
    // committed while this workflow waited is observed before evidence access.
    let overrides: Vec<(String,bool)> = sqlx::query_as("SELECT feature_key,enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key IN ('encounters','admin')")
        .bind(actor.facility_id).fetch_all(&mut **tx).await?;
    let defaults =
        hms_domain::capabilities::feature_flags_for_profile(actor.authorization.active_profile);
    for (name, key, required) in [
        (
            "encounters",
            hms_domain::deployment::FeatureKey::Encounters,
            true,
        ),
        (
            "admin",
            hms_domain::deployment::FeatureKey::Admin,
            actor.override_ownership,
        ),
    ] {
        if required
            && !overrides
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, on)| *on)
                .unwrap_or_else(|| defaults.get(&key).copied().unwrap_or(false))
        {
            return Err(NoteError::AuthorizationExpired.into());
        }
    }

    Ok(())
}
pub(crate) async fn check_deadline(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
) -> anyhow::Result<()> {
    let valid: bool = sqlx::query_scalar("SELECT clock_timestamp()<$1")
        .bind(actor.authorization.valid_until)
        .fetch_one(&mut **tx)
        .await?;
    if !valid {
        return Err(NoteError::AuthorizationExpired.into());
    }
    Ok(())
}
pub(crate) fn digest(value: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(value.as_ref()).to_vec()
}
pub(crate) fn title(value: &str) -> anyhow::Result<String> {
    let v = value.trim();
    if v.is_empty() || v.chars().count() > 160 {
        return Err(NoteError::InvalidInput.into());
    }
    Ok(v.to_owned())
}
pub(crate) fn body(value: &str) -> anyhow::Result<String> {
    if value.trim().is_empty() || value.chars().count() > 20_000 {
        return Err(NoteError::InvalidInput.into());
    }
    Ok(value.to_owned())
}
pub(crate) fn summary(value: &str, required: bool) -> anyhow::Result<String> {
    let v = value.trim();
    if (required && v.is_empty()) || v.chars().count() > 500 {
        return Err(NoteError::InvalidInput.into());
    }
    Ok(v.to_owned())
}
#[derive(FromRow)]
struct NoteRow {
    id: Uuid,
    patient_id: Uuid,
    encounter_id: Option<Uuid>,
    note_type: String,
    title: String,
    body: String,
    status: String,
    version: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    author_user_id: Option<Uuid>,
    author_display_name: Option<String>,
    template_revision: Option<serde_json::Value>,
}
const NOTE:&str="SELECT n.id,n.patient_id,n.encounter_id,n.note_type,n.title,n.body,n.status,n.version,n.created_at,n.updated_at,n.created_by_user_id AS author_user_id,u.display_name AS author_display_name,CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('template_id',r.template_id,'id',r.id,'version',r.version,'title',r.title,'note_type',r.note_type,'body_template',r.body_template) END AS template_revision FROM clinical_notes n LEFT JOIN users u ON u.id=n.created_by_user_id AND u.facility_id=n.facility_id LEFT JOIN clinical_note_template_revisions r ON r.id=n.template_revision_id AND r.facility_id=n.facility_id";
fn detail(row: NoteRow, actor: &NoteActor) -> anyhow::Result<ClinicalNoteRecordDetail> {
    Ok(ClinicalNoteRecordDetail {
        id: row.id,
        patient_id: row.patient_id,
        encounter_id: row.encounter_id,
        note_type: codec::decode(&row.note_type)?,
        title: row.title,
        body: row.body,
        status: codec::decode(&row.status)?,
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at,
        can_amend: actor.can_manage
            && (row.author_user_id == Some(actor.user_id) || actor.override_ownership),
        author_user_id: row.author_user_id,
        author_display_name: row.author_display_name,
        template_revision: row
            .template_revision
            .map(serde_json::from_value)
            .transpose()?,
    })
}
async fn detail_tx(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
    id: Uuid,
) -> anyhow::Result<ClinicalNoteRecordDetail> {
    let row = sqlx::query_as::<_, NoteRow>(&format!("{NOTE} WHERE n.facility_id=$1 AND n.id=$2"))
        .bind(actor.facility_id)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(NoteError::NotFound)?;
    detail(row, actor)
}
pub async fn context(pool: &PgPool, facility: Uuid, id: Uuid) -> anyhow::Result<Option<Uuid>> {
    Ok(
        sqlx::query_scalar("SELECT patient_id FROM clinical_notes WHERE facility_id=$1 AND id=$2")
            .bind(facility)
            .bind(id)
            .fetch_optional(pool)
            .await?,
    )
}
async fn protected<'a>(
    pool: &'a PgPool,
    actor: &mut NoteActor,
    id: Uuid,
) -> anyhow::Result<Transaction<'a, Postgres>> {
    let mut tx = pool.begin().await?;
    let found: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM clinical_notes WHERE facility_id=$1 AND id=$2 FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    if found.is_none() {
        return Err(NoteError::NotFound.into());
    }
    verify_actor(&mut tx, actor).await?;
    Ok(tx)
}
pub async fn get(
    pool: &PgPool,
    mut actor: NoteActor,
    id: Uuid,
) -> anyhow::Result<ClinicalNoteRecordDetail> {
    let mut tx = protected(pool, &mut actor, id).await?;
    let result = detail_tx(&mut tx, &actor, id).await?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
#[derive(FromRow)]
struct VersionRow {
    id: Uuid,
    note_id: Uuid,
    version: i64,
    created_at: DateTime<Utc>,
    recorded_by_user_id: Option<Uuid>,
    recorded_by_display_name: Option<String>,
    edit_reason: Option<String>,
    body: Option<String>,
}
fn version(row: VersionRow) -> ClinicalNoteVersionDetail {
    ClinicalNoteVersionDetail {
        history: ClinicalNoteHistoryItem {
            id: row.id,
            note_id: row.note_id,
            version: row.version,
            created_at: row.created_at,
            recorded_by_user_id: row.recorded_by_user_id,
            recorded_by_display_name: row.recorded_by_display_name,
            edit_reason: row.edit_reason,
        },
        body: row.body.unwrap_or_default(),
    }
}
const HISTORY:&str="SELECT v.id,v.note_id,v.version,v.created_at,v.created_by_user_id AS recorded_by_user_id,u.display_name AS recorded_by_display_name,v.edit_reason";
pub async fn history(
    pool: &PgPool,
    mut actor: NoteActor,
    id: Uuid,
    before: Option<i64>,
    limit: i64,
) -> anyhow::Result<Vec<ClinicalNoteHistoryItem>> {
    let mut tx = protected(pool, &mut actor, id).await?;
    let rows=sqlx::query_as::<_,VersionRow>(&format!("{HISTORY},NULL::text AS body FROM clinical_note_versions v LEFT JOIN users u ON u.id=v.created_by_user_id AND u.facility_id=v.facility_id WHERE v.facility_id=$1 AND v.note_id=$2 AND ($3::bigint IS NULL OR v.version<$3) ORDER BY v.version DESC LIMIT $4")).bind(actor.facility_id).bind(id).bind(before).bind(limit.clamp(1,101)).fetch_all(&mut *tx).await?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows.into_iter().map(|r| version(r).history).collect())
}
pub async fn get_version(
    pool: &PgPool,
    mut actor: NoteActor,
    id: Uuid,
    version_id: Uuid,
) -> anyhow::Result<ClinicalNoteVersionDetail> {
    let mut tx = protected(pool, &mut actor, id).await?;
    let row=sqlx::query_as::<_,VersionRow>(&format!("{HISTORY},v.body FROM clinical_note_versions v LEFT JOIN users u ON u.id=v.created_by_user_id AND u.facility_id=v.facility_id WHERE v.facility_id=$1 AND v.note_id=$2 AND v.id=$3")).bind(actor.facility_id).bind(id).bind(version_id).fetch_optional(&mut *tx).await?.ok_or(NoteError::NotFound)?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(version(row))
}
#[derive(FromRow)]
struct CommandRow {
    patient_id: Uuid,
    actor_user_id: Uuid,
    command_kind: String,
    target_id: Option<Uuid>,
    payload_digest: Vec<u8>,
    receipt: Option<serde_json::Value>,
}
async fn reserve(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
    patient: Uuid,
    key: Uuid,
    kind: &str,
    target: Option<Uuid>,
    payload: &impl Serialize,
) -> anyhow::Result<Option<ClinicalNoteCommandReceipt>> {
    if key.is_nil() {
        return Err(NoteError::InvalidInput.into());
    }
    let hash = digest(key.as_bytes());
    let fingerprint = digest(serde_json::to_vec(payload)?);
    sqlx::query("INSERT INTO clinical_note_commands(facility_id,request_key_hash,patient_id,actor_user_id,command_kind,target_id,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING").bind(actor.facility_id).bind(&hash).bind(patient).bind(actor.user_id).bind(kind).bind(target).bind(&fingerprint).execute(&mut **tx).await?;
    let row=sqlx::query_as::<_,CommandRow>("SELECT patient_id,actor_user_id,command_kind,target_id,payload_digest,receipt FROM clinical_note_commands WHERE facility_id=$1 AND request_key_hash=$2 FOR UPDATE").bind(actor.facility_id).bind(hash).fetch_one(&mut **tx).await?;
    if row.patient_id != patient
        || row.actor_user_id != actor.user_id
        || row.command_kind != kind
        || row.target_id != target
        || row.payload_digest != fingerprint
    {
        return Err(NoteError::RequestConflict.into());
    }
    row.receipt
        .map(|v| {
            let mut r: ClinicalNoteCommandReceipt = serde_json::from_value(v)?;
            r.replayed = true;
            Ok(r)
        })
        .transpose()
}
async fn finish(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
    patient: Uuid,
    key: Uuid,
    id: Uuid,
    action: ClinicalNoteCommandAction,
    reason: Option<String>,
) -> anyhow::Result<ClinicalNoteCommandReceipt> {
    let mut note = detail_tx(tx, actor, id).await?;
    note.can_amend = false; // A receipt never authorizes a later edit; current detail is a separate read.
    let receipt = ClinicalNoteCommandReceipt {
        client_request_id: key,
        action,
        reason,
        note,
        replayed: false,
    };
    sqlx::query("UPDATE clinical_note_commands SET result_id=$3,receipt=$4 WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(digest(key.as_bytes())).bind(id).bind(serde_json::to_value(&receipt)?).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'clinical_note',$6,$7)").bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(match receipt.action{ClinicalNoteCommandAction::Recorded=>"clinical.note.recorded",ClinicalNoteCommandAction::Amended=>"clinical.note.amended"}).bind(id).bind(serde_json::json!({"version":receipt.note.version})).execute(&mut **tx).await?;
    let _ = patient;
    check_deadline(tx, actor).await?;
    Ok(receipt)
}

pub(crate) fn key(value: &str) -> String {
    // Python str.isalnum and the browser's Unicode Letter/Number contract
    // exclude Other_Alphabetic combining marks that std::is_alphanumeric keeps.
    static NON_ALPHANUMERIC: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    NON_ALPHANUMERIC
        .get_or_init(|| {
            regex::Regex::new(r"[^\p{L}\p{N}]").expect("constant Unicode note key expression")
        })
        .replace_all(&value.trim().to_lowercase(), "")
        .into_owned()
}
fn has_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::String(s) => !s.trim().is_empty(),
        serde_json::Value::Array(a) => !a.is_empty(),
        serde_json::Value::Object(o) => !o.is_empty(),
        _ => true,
    }
}
pub(crate) fn template_body(value: &str) -> anyhow::Result<String> {
    let content = body(value)?;
    if let Ok(document) = serde_json::from_str::<serde_json::Value>(&content) {
        if document.is_array() || document.get("sections").is_some() {
            let sections = document
                .as_array()
                .or_else(|| document.get("sections").and_then(|v| v.as_array()))
                .ok_or(NoteError::InvalidInput)?;
            if sections.is_empty() || sections.len() > 100 {
                return Err(NoteError::InvalidInput.into());
            }
            let mut seen = std::collections::HashSet::new();
            for section in sections {
                let name = section
                    .get("name")
                    .and_then(|v| v.as_str())
                    .filter(|v| !v.trim().is_empty())
                    .or_else(|| section.get("section").and_then(|v| v.as_str()))
                    .ok_or(NoteError::InvalidInput)?;
                let name = key(name);
                if name.is_empty()
                    || !seen.insert(name)
                    || section.get("required").is_some_and(|v| !v.is_boolean())
                {
                    return Err(NoteError::InvalidInput.into());
                }
            }
        }
    }
    Ok(content)
}
fn validate_structure(content: &str, schema: &str) -> anyhow::Result<()> {
    let Ok(document) = serde_json::from_str::<serde_json::Value>(schema) else {
        return Ok(());
    };
    let sections = document
        .as_array()
        .or_else(|| document.get("sections").and_then(|s| s.as_array()));
    let Some(sections) = sections.filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|_| NoteError::InvalidInput)?;
    let values = value.as_object().ok_or(NoteError::InvalidInput)?;
    let fields: Vec<_> = sections
        .iter()
        .filter_map(|s| {
            s.get("name")
                .and_then(|s| s.as_str())
                .filter(|name| !name.trim().is_empty())
                .or_else(|| s.get("section").and_then(|s| s.as_str()))
                .map(|name| {
                    (
                        key(name),
                        s.get("required").and_then(|v| v.as_bool()).unwrap_or(false),
                    )
                })
        })
        .collect();
    // Normalize each incoming key once. Large allowed metadata objects must not
    // trigger repeated Unicode regex work for every required clinical section.
    let known: std::collections::HashSet<_> =
        fields.iter().map(|(name, _)| name.as_str()).collect();
    let mut present = std::collections::HashMap::<String, bool>::new();
    for (name, value) in values {
        let normalized = key(name);
        if !name.starts_with('_') && !known.contains(normalized.as_str()) {
            return Err(NoteError::InvalidInput.into());
        }
        *present.entry(normalized).or_default() |= has_value(value);
    }
    if fields
        .iter()
        .any(|(name, required)| *required && !present.get(name).copied().unwrap_or(false))
    {
        return Err(NoteError::InvalidInput.into());
    }
    Ok(())
}
async fn pinned(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<PinnedNoteTemplateRevision> {
    let row:Option<(Uuid,Uuid,i64,String,String,String)>=sqlx::query_as("SELECT template_id,id,version,title,note_type,body_template FROM clinical_note_template_revisions WHERE facility_id=$1 AND id=$2").bind(facility).bind(id).fetch_optional(&mut **tx).await?;
    let (template_id, id, version, title, note_type, body_template) =
        row.ok_or(NoteError::TemplateUnavailable)?;
    Ok(PinnedNoteTemplateRevision {
        template_id,
        id,
        version,
        title,
        note_type: codec::decode(&note_type)?,
        body_template,
    })
}
pub async fn record(
    pool: &PgPool,
    mut actor: NoteActor,
    patient: Uuid,
    mut input: RecordClinicalNoteRequest,
) -> anyhow::Result<ClinicalNoteCommandReceipt> {
    input.title = title(&input.title)?;
    input.body = body(&input.body)?;
    if !actor.can_manage {
        return Err(NoteError::AuthorRequired.into());
    }
    let mut tx = pool.begin().await?;
    verify_actor(&mut tx, &mut actor).await?;
    if let Some(saved) = reserve(
        &mut tx,
        &actor,
        patient,
        input.client_request_id,
        "record",
        None,
        &input,
    )
    .await?
    {
        check_deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(saved);
    }
    let patient_exists: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE")
            .bind(actor.facility_id)
            .bind(patient)
            .fetch_optional(&mut *tx)
            .await?;
    if patient_exists.is_none() {
        return Err(NoteError::NotFound.into());
    }
    if let Some(id) = input.template_revision_id {
        let active:Option<bool>=sqlx::query_scalar("SELECT t.is_active FROM clinical_note_template_revisions r JOIN clinical_note_templates t ON t.id=r.template_id AND t.facility_id=r.facility_id WHERE r.facility_id=$1 AND r.id=$2 FOR SHARE OF t").bind(actor.facility_id).bind(id).fetch_optional(&mut *tx).await?;
        if active != Some(true) {
            return Err(NoteError::TemplateUnavailable.into());
        }
        let revision = pinned(&mut tx, actor.facility_id, id).await?;
        template_body(&revision.body_template)?;
        if revision.note_type != input.note_type {
            return Err(NoteError::InvalidInput.into());
        }
        validate_structure(&input.body, &revision.body_template)?;
    }
    super::prescription_courses::validate_care_context_tx(
        &mut tx,
        actor.facility_id,
        patient,
        input.encounter_id,
        None,
    )
    .await
    .map_err(|e| {
        if e.is::<PrescriptionCourseError>() {
            NoteError::ContextChanged.into()
        } else {
            e
        }
    })?;
    check_deadline(&mut tx, &actor).await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO clinical_notes(id,facility_id,patient_id,encounter_id,note_type,title,body,status,created_by_user_id,template_revision_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,clock_timestamp(),clock_timestamp())").bind(id).bind(actor.facility_id).bind(patient).bind(input.encounter_id).bind(codec::encode(input.note_type)?).bind(&input.title).bind(&input.body).bind(actor.user_id).bind(input.template_revision_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO clinical_note_versions(id,facility_id,note_id,version,body,created_by_user_id,created_at) VALUES($1,$2,$3,1,$4,$5,clock_timestamp())").bind(Uuid::new_v4()).bind(actor.facility_id).bind(id).bind(input.body).bind(actor.user_id).execute(&mut *tx).await?;
    let result = finish(
        &mut tx,
        &actor,
        patient,
        input.client_request_id,
        id,
        ClinicalNoteCommandAction::Recorded,
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn amend(
    pool: &PgPool,
    mut actor: NoteActor,
    id: Uuid,
    mut input: AmendClinicalNoteRequest,
) -> anyhow::Result<ClinicalNoteCommandReceipt> {
    input.body = body(&input.body)?;
    input.reason = summary(&input.reason, true)?;
    if input.expected_version < 1 {
        return Err(NoteError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    let row:Option<(Uuid,Option<Uuid>,i64,Option<Uuid>)>=sqlx::query_as("SELECT patient_id,created_by_user_id,version,template_revision_id FROM clinical_notes WHERE facility_id=$1 AND id=$2 FOR UPDATE").bind(actor.facility_id).bind(id).fetch_optional(&mut *tx).await?;
    let (patient, author, version, template) = row.ok_or(NoteError::NotFound)?;
    verify_actor(&mut tx, &mut actor).await?;
    if let Some(saved) = reserve(
        &mut tx,
        &actor,
        patient,
        input.client_request_id,
        "amend",
        Some(id),
        &input,
    )
    .await?
    {
        check_deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(saved);
    }
    if !actor.can_manage || (author != Some(actor.user_id) && !actor.override_ownership) {
        return Err(NoteError::AuthorRequired.into());
    }
    if version != input.expected_version {
        return Err(NoteError::SourceChanged.into());
    }
    if let Some(template) = template {
        let revision = pinned(&mut tx, actor.facility_id, template).await?;
        validate_structure(&input.body, &revision.body_template)?;
    }
    let next = version.checked_add(1).ok_or(NoteError::InvalidInput)?;
    sqlx::query("UPDATE clinical_notes SET body=$3,version=$4,status='amended',updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2 AND version=$5").bind(actor.facility_id).bind(id).bind(&input.body).bind(next).bind(version).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO clinical_note_versions(id,facility_id,note_id,version,body,created_by_user_id,edit_reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())").bind(Uuid::new_v4()).bind(actor.facility_id).bind(id).bind(next).bind(input.body).bind(actor.user_id).bind(&input.reason).execute(&mut *tx).await?;
    let result = finish(
        &mut tx,
        &actor,
        patient,
        input.client_request_id,
        id,
        ClinicalNoteCommandAction::Amended,
        Some(input.reason),
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn receipt_context(
    pool: &PgPool,
    facility: Uuid,
    patient: Uuid,
    user: Uuid,
    key: Uuid,
) -> anyhow::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar("SELECT result_id FROM clinical_note_commands WHERE facility_id=$1 AND patient_id=$2 AND actor_user_id=$3 AND request_key_hash=$4 AND receipt IS NOT NULL").bind(facility).bind(patient).bind(user).bind(digest(key.as_bytes())).fetch_optional(pool).await?)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: NoteActor,
    patient: Uuid,
    key: Uuid,
) -> anyhow::Result<ClinicalNoteCommandReceipt> {
    let id = receipt_context(pool, actor.facility_id, patient, actor.user_id, key)
        .await?
        .ok_or(NoteError::NotFound)?;
    let mut tx = protected(pool, &mut actor, id).await?;
    let value:serde_json::Value=sqlx::query_scalar("SELECT receipt FROM clinical_note_commands WHERE facility_id=$1 AND patient_id=$2 AND actor_user_id=$3 AND request_key_hash=$4 AND receipt IS NOT NULL").bind(actor.facility_id).bind(patient).bind(actor.user_id).bind(digest(key.as_bytes())).fetch_one(&mut *tx).await?;
    let mut result: ClinicalNoteCommandReceipt = serde_json::from_value(value)?;
    result.replayed = true;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_section_keys_match_legacy_python_and_browser_letters_numbers() {
        assert_eq!(key(" Care- Plan "), "careplan");
        assert_eq!(key("A\u{93f}\u{345}Ⅻ²"), "aⅻ²");
        assert_eq!(key("İ Assessment"), "iassessment");
        assert!(validate_structure(
            r#"{"aⅻ²":false}"#,
            r#"[{"name":"A\u093f\u0345Ⅻ²","required":true}]"#
        )
        .is_ok());
    }
}
