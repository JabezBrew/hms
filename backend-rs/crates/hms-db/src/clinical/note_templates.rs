//! Facility-shared templates with immutable ordinary effective revisions.
use super::note_records::{
    check_deadline, digest, summary, template_body, title, verify_actor, NoteActor, NoteError,
};
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::clinical_notes::*;
use serde::Serialize;
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

#[derive(FromRow)]
struct Row {
    id: Uuid,
    title: String,
    note_type: String,
    is_active: bool,
    version: i64,
    current_revision_id: Uuid,
    owner_user_id: Option<Uuid>,
    owner_display_name: Option<String>,
    updated_at: DateTime<Utc>,
    body_template: Option<String>,
}
const SELECT: &str = "SELECT t.id,t.title,t.note_type,t.is_active,t.current_revision AS version,t.current_revision_id,u.id AS owner_user_id,u.display_name AS owner_display_name,t.updated_at";
fn item(row: &Row, actor: &NoteActor) -> anyhow::Result<GovernedNoteTemplateItem> {
    Ok(GovernedNoteTemplateItem {
        id: row.id,
        title: row.title.clone(),
        note_type: codec::decode(&row.note_type)?,
        is_active: row.is_active,
        version: row.version,
        current_revision_id: row.current_revision_id,
        owner_user_id: row.owner_user_id,
        owner_display_name: row.owner_display_name.clone(),
        can_manage: actor.can_manage
            && (row.owner_user_id == Some(actor.user_id) || actor.override_ownership),
        updated_at: row.updated_at,
    })
}
async fn detail(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
    id: Uuid,
) -> anyhow::Result<GovernedNoteTemplateDetail> {
    let row=sqlx::query_as::<_,Row>(&format!("{SELECT},t.body_template FROM clinical_note_templates t LEFT JOIN users u ON u.id=t.owner_user_id AND u.facility_id=t.facility_id WHERE t.facility_id=$1 AND t.id=$2")).bind(actor.facility_id).bind(id).fetch_optional(&mut **tx).await?.ok_or(NoteError::NotFound)?;
    Ok(GovernedNoteTemplateDetail {
        template: item(&row, actor)?,
        body_template: row.body_template.unwrap_or_default(),
    })
}
pub async fn get(
    pool: &PgPool,
    mut actor: NoteActor,
    id: Uuid,
) -> anyhow::Result<GovernedNoteTemplateDetail> {
    let mut tx = pool.begin().await?;
    verify_actor(&mut tx, &mut actor).await?;
    let exists: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM clinical_note_templates WHERE facility_id=$1 AND id=$2 FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    exists.ok_or(NoteError::NotFound)?;
    let result = detail(&mut tx, &actor, id).await?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
#[derive(FromRow)]
struct RevisionRow {
    id: Uuid,
    template_id: Uuid,
    version: i64,
    title: String,
    note_type: String,
    is_active: bool,
    change_summary: Option<String>,
    created_by_user_id: Option<Uuid>,
    created_by_display_name: Option<String>,
    created_at: DateTime<Utc>,
    imported_legacy: bool,
}
#[derive(FromRow)]
struct RevisionDetailRow {
    #[sqlx(flatten)]
    revision: RevisionRow,
    body_template: String,
}
// Project the scoped user join's ID as well as its name. Historical imports may
// contain a foreign creator reference; neither part of that identity may escape.
const REVISION_SELECT: &str = "SELECT r.id,r.template_id,r.version,r.title,r.note_type,r.is_active,r.change_summary,u.id AS created_by_user_id,u.display_name AS created_by_display_name,r.created_at,r.imported_legacy";
fn revision_item(row: RevisionRow) -> anyhow::Result<NoteTemplateHistoryItem> {
    Ok(NoteTemplateHistoryItem {
        id: row.id,
        template_id: row.template_id,
        version: row.version,
        title: row.title,
        note_type: codec::decode(&row.note_type)?,
        is_active: row.is_active,
        change_summary: row.change_summary,
        created_by_user_id: row.created_by_user_id,
        created_by_display_name: row.created_by_display_name,
        created_at: row.created_at,
        imported_legacy: row.imported_legacy,
    })
}
async fn history_root(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut NoteActor,
    id: Uuid,
) -> anyhow::Result<()> {
    // Keep the existing template protocol: current facility/user/session and
    // retained network proof precede the root lock, then the final DB clock.
    verify_actor(tx, actor).await?;
    let found: Option<Uuid> = hms_observability::observe_db_query(
        "clinical.note_template.history.root",
        sqlx::query_scalar(
            "SELECT id FROM clinical_note_templates WHERE facility_id=$1 AND id=$2 FOR SHARE",
        )
        .bind(actor.facility_id)
        .bind(id)
        .fetch_optional(&mut **tx),
    )
    .await?;
    found.ok_or(NoteError::NotFound)?;
    Ok(())
}
/// Descending unique version order uses the existing (template_id,version)
/// index. Each page performs one bounded metadata query, with no body or N+1.
pub async fn history(
    pool: &PgPool,
    mut actor: NoteActor,
    id: Uuid,
    before_version: Option<i64>,
    limit: i64,
) -> anyhow::Result<Vec<NoteTemplateHistoryItem>> {
    if before_version.is_some_and(|version| version < 1) {
        return Err(NoteError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    history_root(&mut tx, &mut actor, id).await?;
    let mut query = QueryBuilder::<Postgres>::new(format!(
        "{REVISION_SELECT} FROM clinical_note_template_revisions r LEFT JOIN users u ON u.id=r.created_by_user_id AND u.facility_id=r.facility_id WHERE r.facility_id="
    ));
    query.push_bind(actor.facility_id);
    query.push(" AND r.template_id=").push_bind(id);
    if let Some(version) = before_version {
        query.push(" AND r.version<").push_bind(version);
    }
    query
        .push(" ORDER BY r.version DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = hms_observability::observe_db_query(
        "clinical.note_template.history.page",
        query.build_query_as::<RevisionRow>().fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(revision_item)
        .collect::<anyhow::Result<_>>()?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
/// Reads only the requested immutable revision; never selects a replacement.
/// Inactive roots and malformed historical bodies remain readable evidence.
pub async fn get_version(
    pool: &PgPool,
    mut actor: NoteActor,
    id: Uuid,
    version_id: Uuid,
) -> anyhow::Result<NoteTemplateVersionDetail> {
    let mut tx = pool.begin().await?;
    history_root(&mut tx, &mut actor, id).await?;
    let sql = format!(
        "{REVISION_SELECT},r.body_template FROM clinical_note_template_revisions r LEFT JOIN users u ON u.id=r.created_by_user_id AND u.facility_id=r.facility_id WHERE r.facility_id=$1 AND r.template_id=$2 AND r.id=$3"
    );
    let row = hms_observability::observe_db_query(
        "clinical.note_template.history.version",
        sqlx::query_as::<_, RevisionDetailRow>(&sql)
            .bind(actor.facility_id)
            .bind(id)
            .bind(version_id)
            .fetch_optional(&mut *tx),
    )
    .await?
    .ok_or(NoteError::NotFound)?;
    let sql = format!(
        "{SELECT},NULL::text AS body_template FROM clinical_note_templates t LEFT JOIN users u ON u.id=t.owner_user_id AND u.facility_id=t.facility_id WHERE t.facility_id=$1 AND t.id=$2"
    );
    let current = hms_observability::observe_db_query(
        "clinical.note_template.history.current",
        sqlx::query_as::<_, Row>(&sql)
            .bind(actor.facility_id)
            .bind(id)
            .fetch_one(&mut *tx),
    )
    .await?;
    let result = NoteTemplateVersionDetail {
        history: revision_item(row.revision)?,
        body_template: row.body_template,
        current_template: item(&current, &actor)?,
    };
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn list(
    pool: &PgPool,
    mut actor: NoteActor,
    input: GovernedNoteTemplateQuery,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> anyhow::Result<Vec<GovernedNoteTemplateItem>> {
    let search = input.search.as_deref().unwrap_or("").trim();
    if search.chars().count() > 160 {
        return Err(NoteError::InvalidInput.into());
    }
    let escaped = search
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let mut tx = pool.begin().await?;
    verify_actor(&mut tx, &mut actor).await?;
    let mut q=QueryBuilder::<Postgres>::new(format!("{SELECT},NULL::text AS body_template FROM clinical_note_templates t LEFT JOIN users u ON u.id=t.owner_user_id AND u.facility_id=t.facility_id WHERE t.facility_id="));
    q.push_bind(actor.facility_id);
    match input.activity.unwrap_or(TemplateActivity::Active) {
        TemplateActivity::Active => {
            q.push(" AND t.is_active=TRUE");
        }
        TemplateActivity::Inactive => {
            q.push(" AND t.is_active=FALSE");
        }
        TemplateActivity::All => {}
    }
    if let Some(kind) = input.note_type {
        q.push(" AND t.note_type=").push_bind(codec::encode(kind)?);
    }
    if !escaped.is_empty() {
        q.push(" AND lower(t.title) LIKE lower(")
            .push_bind(format!("%{escaped}%"))
            .push(") ESCAPE '\\'");
    }
    if let Some((at, id)) = cursor {
        q.push(" AND (t.updated_at,t.id)<(")
            .push_bind(at)
            .push(",")
            .push_bind(id)
            .push(")");
    }
    q.push(" ORDER BY t.updated_at DESC,t.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = q.build_query_as::<Row>().fetch_all(&mut *tx).await?;
    let result = rows
        .iter()
        .map(|r| item(r, &actor))
        .collect::<anyhow::Result<_>>()?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
#[derive(FromRow)]
struct Command {
    actor_user_id: Uuid,
    command_kind: String,
    target_id: Option<Uuid>,
    payload_digest: Vec<u8>,
    receipt: Option<serde_json::Value>,
}
async fn reserve(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
    key: Uuid,
    kind: &str,
    target: Option<Uuid>,
    payload: &impl Serialize,
) -> anyhow::Result<Option<NoteTemplateCommandReceipt>> {
    if key.is_nil() {
        return Err(NoteError::InvalidInput.into());
    }
    let hash = digest(key.as_bytes());
    let fingerprint = digest(serde_json::to_vec(payload)?);
    sqlx::query("INSERT INTO clinical_note_template_commands(facility_id,request_key_hash,actor_user_id,command_kind,target_id,payload_digest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING").bind(actor.facility_id).bind(&hash).bind(actor.user_id).bind(kind).bind(target).bind(&fingerprint).execute(&mut **tx).await?;
    let row=sqlx::query_as::<_,Command>("SELECT actor_user_id,command_kind,target_id,payload_digest,receipt FROM clinical_note_template_commands WHERE facility_id=$1 AND request_key_hash=$2 FOR UPDATE").bind(actor.facility_id).bind(hash).fetch_one(&mut **tx).await?;
    if row.actor_user_id != actor.user_id
        || row.command_kind != kind
        || row.target_id != target
        || row.payload_digest != fingerprint
    {
        return Err(NoteError::RequestConflict.into());
    }
    row.receipt
        .map(|v| {
            let mut r: NoteTemplateCommandReceipt = serde_json::from_value(v)?;
            r.replayed = true;
            Ok(r)
        })
        .transpose()
}
async fn snapshot(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
    id: Uuid,
    revision: Uuid,
    version: i64,
    summary: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO clinical_note_template_revisions(id,facility_id,template_id,version,title,note_type,body_template,is_active,change_summary,created_by_user_id) SELECT $3,facility_id,id,$4,title,note_type,body_template,is_active,$5,$6 FROM clinical_note_templates WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(revision).bind(version).bind(summary).bind(actor.user_id).execute(&mut **tx).await?;
    Ok(())
}
async fn finish(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
    key: Uuid,
    id: Uuid,
    action: NoteTemplateCommandAction,
) -> anyhow::Result<NoteTemplateCommandReceipt> {
    let mut template = detail(tx, actor, id).await?;
    template.template.can_manage = false;
    let receipt = NoteTemplateCommandReceipt {
        client_request_id: key,
        action,
        template,
        replayed: false,
    };
    sqlx::query("UPDATE clinical_note_template_commands SET result_id=$3,receipt=$4 WHERE facility_id=$1 AND request_key_hash=$2").bind(actor.facility_id).bind(digest(key.as_bytes())).bind(id).bind(serde_json::to_value(&receipt)?).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'clinical_note_template',$6,$7)").bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(match action{NoteTemplateCommandAction::Created=>"clinical.note_template.created",NoteTemplateCommandAction::Changed=>"clinical.note_template.changed"}).bind(id).bind(serde_json::json!({"version":receipt.template.template.version})).execute(&mut **tx).await?;
    check_deadline(tx, actor).await?;
    Ok(receipt)
}
pub async fn record(
    pool: &PgPool,
    mut actor: NoteActor,
    mut input: RecordNoteTemplateRequest,
) -> anyhow::Result<NoteTemplateCommandReceipt> {
    input.title = title(&input.title)?;
    input.body_template = template_body(&input.body_template)?;
    if !actor.can_manage {
        return Err(NoteError::AuthorRequired.into());
    }
    let mut tx = pool.begin().await?;
    verify_actor(&mut tx, &mut actor).await?;
    if let Some(saved) = reserve(
        &mut tx,
        &actor,
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
    let id = Uuid::new_v4();
    let revision = Uuid::new_v4();
    sqlx::query("INSERT INTO clinical_note_templates(id,facility_id,title,note_type,body_template,is_active,owner_user_id,current_revision,current_revision_id,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,clock_timestamp())").bind(id).bind(actor.facility_id).bind(input.title).bind(codec::encode(input.note_type)?).bind(input.body_template).bind(input.is_active).bind(actor.user_id).bind(revision).execute(&mut *tx).await?;
    snapshot(&mut tx, &actor, id, revision, 1, None).await?;
    let result = finish(
        &mut tx,
        &actor,
        input.client_request_id,
        id,
        NoteTemplateCommandAction::Created,
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn change(
    pool: &PgPool,
    mut actor: NoteActor,
    id: Uuid,
    mut input: ChangeNoteTemplateRequest,
) -> anyhow::Result<NoteTemplateCommandReceipt> {
    input.title = title(&input.title)?;
    input.body_template = super::note_records::body(&input.body_template)?;
    input.change_summary = summary(&input.change_summary, false)?;
    if !actor.can_manage {
        return Err(NoteError::AuthorRequired.into());
    }
    if input.expected_version < 1 {
        return Err(NoteError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    verify_actor(&mut tx, &mut actor).await?;
    let row:Option<(Option<Uuid>,i64,String)>=sqlx::query_as("SELECT owner_user_id,current_revision,body_template FROM clinical_note_templates WHERE facility_id=$1 AND id=$2 FOR UPDATE").bind(actor.facility_id).bind(id).fetch_optional(&mut *tx).await?;
    let (owner, version, previous_body) = row.ok_or(NoteError::NotFound)?;
    if let Some(saved) = reserve(
        &mut tx,
        &actor,
        input.client_request_id,
        "change",
        Some(id),
        &input,
    )
    .await?
    {
        check_deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(saved);
    }
    if owner != Some(actor.user_id) && !actor.override_ownership {
        return Err(NoteError::AuthorRequired.into());
    }
    if version != input.expected_version {
        return Err(NoteError::SourceChanged.into());
    }
    // Retirement must not require inventing a replacement for malformed imported
    // schema. Only the exact old body may pass this narrow inactive exception.
    if template_body(&input.body_template).is_err()
        && (input.is_active || input.body_template != previous_body)
    {
        return Err(NoteError::InvalidInput.into());
    }

    let next = version.checked_add(1).ok_or(NoteError::InvalidInput)?;
    let revision = Uuid::new_v4();
    sqlx::query("UPDATE clinical_note_templates SET title=$3,note_type=$4,body_template=$5,is_active=$6,current_revision=$7,current_revision_id=$8,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(input.title).bind(codec::encode(input.note_type)?).bind(input.body_template).bind(input.is_active).bind(next).bind(revision).execute(&mut *tx).await?;
    snapshot(
        &mut tx,
        &actor,
        id,
        revision,
        next,
        Some(&input.change_summary),
    )
    .await?;
    let result = finish(
        &mut tx,
        &actor,
        input.client_request_id,
        id,
        NoteTemplateCommandAction::Changed,
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: NoteActor,
    key: Uuid,
) -> anyhow::Result<NoteTemplateCommandReceipt> {
    let mut tx = pool.begin().await?;
    verify_actor(&mut tx, &mut actor).await?;
    let value:Option<serde_json::Value>=sqlx::query_scalar("SELECT receipt FROM clinical_note_template_commands WHERE facility_id=$1 AND actor_user_id=$2 AND request_key_hash=$3 AND receipt IS NOT NULL").bind(actor.facility_id).bind(actor.user_id).bind(digest(key.as_bytes())).fetch_optional(&mut *tx).await?;
    let mut result: NoteTemplateCommandReceipt =
        serde_json::from_value(value.ok_or(NoteError::NotFound)?)?;
    result.replayed = true;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
