//! Protected patient narratives with immutable versions and exact command receipts.
use super::WardCursor;
use crate::{codec, PgPool};
use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::{deployment::DeploymentProfile, patient_handover::*};
use hms_observability::observe_db_query;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

#[derive(Clone)]
pub struct HandoverActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub session_id: Uuid,
    pub session_version: i64,
    pub permission_version: i64,
    pub active_profile: DeploymentProfile,
    pub valid_until: DateTime<Utc>,
    pub can_view_all_wards: bool,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandoverError {
    WardAccessDenied,
    NotFound,
    InvalidRequest,
    InvalidContext,
    InvalidRecipient,
    NotAuthor,
    RevisionChanged,
    Voided,
    RequestConflict,
    AuthorizationExpired,
}
impl std::fmt::Display for HandoverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("patient handover command denied")
    }
}
impl std::error::Error for HandoverError {}
#[derive(FromRow)]
struct HeaderRow {
    id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    ward_id: Uuid,
    ward_name: String,
    author_user_id: Uuid,
    author_display_name: String,
    shift_date: NaiveDate,
    shift_type: String,
    intended_recipient_user_id: Option<Uuid>,
    intended_recipient_display_name: Option<String>,
    status: String,
    revision: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}
#[derive(FromRow)]
struct RevisionRow {
    id: Uuid,
    handover_id: Uuid,
    revision: i64,
    kind: String,
    shift_date: NaiveDate,
    shift_type: String,
    intended_recipient_user_id: Option<Uuid>,
    intended_recipient_display_name: Option<String>,
    patient_condition: String,
    ongoing_issues: String,
    pending_tasks: String,
    medication_changes: String,
    key_events: String,
    care_plan_updates: String,
    family_updates: String,
    reason: String,
    recorded_by_user_id: Uuid,
    recorded_by_display_name: String,
    recorded_at: DateTime<Utc>,
}
const HEADER:&str="SELECT h.id,h.patient_id,h.admission_case_id,h.ward_id,w.name AS ward_name,h.author_user_id,author.display_name AS author_display_name,r.shift_date,r.shift_type,r.intended_recipient_user_id,recipient.display_name AS intended_recipient_display_name,h.status,h.current_revision AS revision,h.created_at,h.updated_at FROM patient_handovers h JOIN admission_cases a ON a.id=h.admission_case_id AND a.facility_id=h.facility_id AND a.patient_id=h.patient_id JOIN patients p ON p.id=h.patient_id AND p.facility_id=h.facility_id JOIN wards w ON w.id=h.ward_id AND w.facility_id=h.facility_id JOIN users author ON author.id=h.author_user_id AND author.facility_id=h.facility_id JOIN patient_handover_revisions r ON r.handover_id=h.id AND r.facility_id=h.facility_id AND r.revision=h.current_revision LEFT JOIN users recipient ON recipient.id=r.intended_recipient_user_id AND recipient.facility_id=h.facility_id";
const REVISION:&str="SELECT r.id,r.handover_id,r.revision,r.kind,r.shift_date,r.shift_type,r.intended_recipient_user_id,recipient.display_name AS intended_recipient_display_name,r.patient_condition,r.ongoing_issues,r.pending_tasks,r.medication_changes,r.key_events,r.care_plan_updates,r.family_updates,r.reason,r.recorded_by_user_id,actor.display_name AS recorded_by_display_name,r.recorded_at FROM patient_handover_revisions r JOIN users actor ON actor.id=r.recorded_by_user_id AND actor.facility_id=r.facility_id LEFT JOIN users recipient ON recipient.id=r.intended_recipient_user_id AND recipient.facility_id=r.facility_id";
fn header(r: HeaderRow) -> anyhow::Result<PatientHandoverListItem> {
    Ok(PatientHandoverListItem {
        id: r.id,
        patient_id: r.patient_id,
        admission_case_id: r.admission_case_id,
        ward_id: r.ward_id,
        ward_name: r.ward_name,
        author_user_id: r.author_user_id,
        author_display_name: r.author_display_name,
        shift_date: r.shift_date,
        shift_type: codec::decode(&r.shift_type)?,
        intended_recipient_user_id: r.intended_recipient_user_id,
        intended_recipient_display_name: r.intended_recipient_display_name,
        status: codec::decode(&r.status)?,
        revision: r.revision,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}
fn revision(r: RevisionRow) -> anyhow::Result<PatientHandoverRevision> {
    Ok(PatientHandoverRevision {
        id: r.id,
        handover_id: r.handover_id,
        revision: r.revision,
        kind: codec::decode(&r.kind)?,
        shift_date: r.shift_date,
        shift_type: codec::decode(&r.shift_type)?,
        intended_recipient_user_id: r.intended_recipient_user_id,
        intended_recipient_display_name: r.intended_recipient_display_name,
        narrative: HandoverNarrative {
            patient_condition: r.patient_condition,
            ongoing_issues: r.ongoing_issues,
            pending_tasks: r.pending_tasks,
            medication_changes: r.medication_changes,
            key_events: r.key_events,
            care_plan_updates: r.care_plan_updates,
            family_updates: r.family_updates,
        },
        reason: r.reason,
        recorded_by_user_id: r.recorded_by_user_id,
        recorded_by_display_name: r.recorded_by_display_name,
        recorded_at: r.recorded_at,
    })
}
pub async fn context(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<(Uuid, Uuid, Uuid)>> {
    Ok(sqlx::query_as(
        "SELECT patient_id,admission_case_id,ward_id FROM patient_handovers WHERE facility_id=$1 AND id=$2",
    )
    .bind(facility)
    .bind(id)
    .fetch_optional(pool)
    .await?)
}
pub async fn list(
    pool: &PgPool,
    facility: Uuid,
    query: &PatientHandoverListQuery,
    viewer: Option<Uuid>,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PatientHandoverListItem>> {
    let mut connection = pool.acquire().await?;
    list_connection(&mut connection, facility, query, viewer, cursor, limit).await
}
async fn list_connection(
    connection: &mut sqlx::PgConnection,
    facility: Uuid,
    query: &PatientHandoverListQuery,
    viewer: Option<Uuid>,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PatientHandoverListItem>> {
    let mut q = QueryBuilder::<Postgres>::new(HEADER);
    q.push(" WHERE h.facility_id=")
        .push_bind(facility)
        .push(" AND h.patient_id=")
        .push_bind(query.patient_id);
    if let Some(user) = viewer {
        q.push(" AND EXISTS(SELECT 1 FROM ward_staff_assignments va JOIN practitioner_profiles vp ON vp.id=va.practitioner_profile_id AND vp.facility_id=va.facility_id JOIN staff_profiles vs ON vs.id=vp.staff_id AND vs.facility_id=va.facility_id JOIN users vu ON vu.id=vs.user_id AND vu.facility_id=va.facility_id WHERE va.facility_id=h.facility_id AND va.ward_id=h.ward_id AND va.is_active AND vu.is_active AND vu.id=").push_bind(user).push(")");
    }
    if let Some(id) = query.admission_case_id {
        q.push(" AND h.admission_case_id=").push_bind(id);
    }
    if let Some(date) = query.shift_date {
        q.push(" AND r.shift_date=").push_bind(date);
    }
    if !query.include_voided.unwrap_or(false) {
        q.push(" AND h.status='recorded'");
    }
    if let Some(c) = cursor {
        q.push(" AND (h.created_at,h.id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY h.created_at DESC,h.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = observe_db_query(
        "ward.patient_handover.list",
        q.build_query_as::<HeaderRow>().fetch_all(connection),
    )
    .await?;
    rows.into_iter().map(header).collect()
}
#[derive(FromRow)]
struct HistoryRow {
    id: Uuid,
    handover_id: Uuid,
    revision: i64,
    kind: String,
    recorded_by_user_id: Uuid,
    recorded_by_display_name: String,
    recorded_at: DateTime<Utc>,
}
pub async fn history(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PatientHandoverHistoryItem>> {
    let mut q=QueryBuilder::<Postgres>::new("SELECT r.id,r.handover_id,r.revision,r.kind,r.recorded_by_user_id,u.display_name AS recorded_by_display_name,r.recorded_at FROM patient_handover_revisions r JOIN users u ON u.id=r.recorded_by_user_id AND u.facility_id=r.facility_id");
    q.push(" WHERE r.facility_id=")
        .push_bind(facility)
        .push(" AND r.handover_id=")
        .push_bind(id);
    if let Some(c) = cursor {
        q.push(" AND (r.recorded_at,r.id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY r.recorded_at DESC,r.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = observe_db_query(
        "ward.patient_handover.history",
        q.build_query_as::<HistoryRow>().fetch_all(pool),
    )
    .await?;
    rows.into_iter()
        .map(|r| {
            Ok(PatientHandoverHistoryItem {
                id: r.id,
                handover_id: r.handover_id,
                revision: r.revision,
                kind: codec::decode(&r.kind)?,
                recorded_by_user_id: r.recorded_by_user_id,
                recorded_by_display_name: r.recorded_by_display_name,
                recorded_at: r.recorded_at,
            })
        })
        .collect()
}
pub async fn get_revision(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
    revision_id: Uuid,
) -> anyhow::Result<PatientHandoverRevision> {
    revision(
        sqlx::query_as::<_, RevisionRow>(&format!(
            "{REVISION} WHERE r.facility_id=$1 AND r.handover_id=$2 AND r.id=$3"
        ))
        .bind(facility)
        .bind(id)
        .bind(revision_id)
        .fetch_optional(pool)
        .await?
        .ok_or(HandoverError::NotFound)?,
    )
}
async fn detail_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<PatientHandoverDetail> {
    let h = header(
        sqlx::query_as::<_, HeaderRow>(&format!("{HEADER} WHERE h.facility_id=$1 AND h.id=$2"))
            .bind(facility)
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(HandoverError::NotFound)?,
    )?;
    let r = revision(
        sqlx::query_as::<_, RevisionRow>(&format!(
            "{REVISION} WHERE r.facility_id=$1 AND r.handover_id=$2 AND r.revision=$3"
        ))
        .bind(facility)
        .bind(id)
        .bind(h.revision)
        .fetch_one(&mut **tx)
        .await?,
    )?;
    Ok(PatientHandoverDetail {
        header: h,
        current: r,
    })
}
pub async fn detail(
    pool: &PgPool,
    facility: Uuid,
    id: Uuid,
) -> anyhow::Result<PatientHandoverDetail> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT id FROM patient_handovers WHERE facility_id=$1 AND id=$2 FOR SHARE")
        .bind(facility)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    let result = detail_tx(&mut tx, facility, id).await?;
    tx.commit().await?;
    Ok(result)
}
async fn check_deadline(
    tx: &mut Transaction<'_, Postgres>,
    actor: &HandoverActor,
) -> anyhow::Result<()> {
    let valid: bool = sqlx::query_scalar("SELECT clock_timestamp()<$1")
        .bind(actor.valid_until)
        .fetch_one(&mut **tx)
        .await?;
    if !valid {
        return Err(HandoverError::AuthorizationExpired.into());
    }
    Ok(())
}
async fn require_ward(
    tx: &mut Transaction<'_, Postgres>,
    actor: &HandoverActor,
    ward: Uuid,
) -> anyhow::Result<()> {
    if actor.can_view_all_wards {
        return Ok(());
    }
    require_ward_user(tx, actor.facility_id, actor.user_id, ward).await
}
async fn require_ward_user(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    user: Uuid,
    ward: Uuid,
) -> anyhow::Result<()> {
    let proof:Option<Uuid>=sqlx::query_scalar("SELECT a.id FROM ward_staff_assignments a JOIN practitioner_profiles p ON p.id=a.practitioner_profile_id AND p.facility_id=a.facility_id JOIN staff_profiles s ON s.id=p.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.ward_id=$2 AND u.id=$3 AND a.is_active AND u.is_active FOR SHARE OF a,p,s,u")
        .bind(facility).bind(ward).bind(user).fetch_optional(&mut **tx).await?;
    if proof.is_none() {
        return Err(HandoverError::WardAccessDenied.into());
    }
    Ok(())
}
async fn read_transaction<'a>(
    pool: &'a PgPool,
    actor: &mut HandoverActor,
    id: Uuid,
) -> anyhow::Result<Transaction<'a, Postgres>> {
    let mut tx = pool.begin().await?;
    let ward: Uuid = sqlx::query_scalar(
        "SELECT ward_id FROM patient_handovers WHERE facility_id=$1 AND id=$2 FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(HandoverError::NotFound)?;
    verify_actor(&mut tx, actor).await?;
    require_ward(&mut tx, actor, ward).await?;
    check_deadline(&mut tx, actor).await?;
    Ok(tx)
}
pub async fn detail_for_user(
    pool: &PgPool,
    mut actor: HandoverActor,
    id: Uuid,
) -> anyhow::Result<PatientHandoverDetail> {
    let facility = actor.facility_id;
    let mut tx = read_transaction(pool, &mut actor, id).await?;
    let value = detail_tx(&mut tx, facility, id).await?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(value)
}
pub async fn history_for_user(
    pool: &PgPool,
    mut actor: HandoverActor,
    id: Uuid,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PatientHandoverHistoryItem>> {
    let facility = actor.facility_id;
    let mut tx = read_transaction(pool, &mut actor, id).await?;
    let mut q=QueryBuilder::<Postgres>::new("SELECT r.id,r.handover_id,r.revision,r.kind,r.recorded_by_user_id,u.display_name AS recorded_by_display_name,r.recorded_at FROM patient_handover_revisions r JOIN users u ON u.id=r.recorded_by_user_id AND u.facility_id=r.facility_id");
    q.push(" WHERE r.facility_id=")
        .push_bind(facility)
        .push(" AND r.handover_id=")
        .push_bind(id);
    if let Some(c) = cursor {
        q.push(" AND (r.recorded_at,r.id)<(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY r.recorded_at DESC,r.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = q.build_query_as::<HistoryRow>().fetch_all(&mut *tx).await?;
    let values = rows
        .into_iter()
        .map(|r| {
            Ok(PatientHandoverHistoryItem {
                id: r.id,
                handover_id: r.handover_id,
                revision: r.revision,
                kind: codec::decode(&r.kind)?,
                recorded_by_user_id: r.recorded_by_user_id,
                recorded_by_display_name: r.recorded_by_display_name,
                recorded_at: r.recorded_at,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(values)
}
pub async fn revision_for_user(
    pool: &PgPool,
    mut actor: HandoverActor,
    id: Uuid,
    version: Uuid,
) -> anyhow::Result<PatientHandoverRevision> {
    let facility = actor.facility_id;
    let mut tx = read_transaction(pool, &mut actor, id).await?;
    let value = revision(
        sqlx::query_as::<_, RevisionRow>(&format!(
            "{REVISION} WHERE r.facility_id=$1 AND r.handover_id=$2 AND r.id=$3"
        ))
        .bind(facility)
        .bind(id)
        .bind(version)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(HandoverError::NotFound)?,
    )?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(value)
}
pub async fn receipt_for_user(
    pool: &PgPool,
    mut actor: HandoverActor,
    patient: Uuid,
    key: Uuid,
) -> anyhow::Result<Option<PatientHandoverReceipt>> {
    let facility = actor.facility_id;
    let user = actor.user_id;
    let id:Option<Uuid>=sqlx::query_scalar("SELECT result_id FROM patient_handover_commands WHERE facility_id=$1 AND patient_id=$2 AND actor_user_id=$3 AND request_key_hash=$4 AND receipt IS NOT NULL").bind(facility).bind(patient).bind(user).bind(digest(key.as_bytes())).fetch_optional(pool).await?;
    let Some(id) = id else { return Ok(None) };
    let mut tx = read_transaction(pool, &mut actor, id).await?;
    let saved:serde_json::Value=sqlx::query_scalar("SELECT receipt FROM patient_handover_commands WHERE facility_id=$1 AND patient_id=$2 AND actor_user_id=$3 AND request_key_hash=$4 AND receipt IS NOT NULL").bind(facility).bind(patient).bind(user).bind(digest(key.as_bytes())).fetch_one(&mut *tx).await?;
    let mut value: PatientHandoverReceipt = serde_json::from_value(saved)?;
    value.replayed = true;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(Some(value))
}
pub async fn has_patient_scope(
    pool: &PgPool,
    facility: Uuid,
    user: Uuid,
    patient: Uuid,
    admission: Option<Uuid>,
) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ward_staff_assignments a JOIN practitioner_profiles pp ON pp.id=a.practitioner_profile_id AND pp.facility_id=a.facility_id JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND u.id=$2 AND a.is_active AND u.is_active AND (EXISTS(SELECT 1 FROM admission_cases c WHERE c.facility_id=a.facility_id AND c.ward_id=a.ward_id AND c.patient_id=$3 AND ($4::uuid IS NULL OR c.id=$4)) OR EXISTS(SELECT 1 FROM patient_handovers h WHERE h.facility_id=a.facility_id AND h.ward_id=a.ward_id AND h.patient_id=$3 AND ($4::uuid IS NULL OR h.admission_case_id=$4))))")
        .bind(facility).bind(user).bind(patient).bind(admission).fetch_one(pool).await?)
}
pub async fn receipt_context(
    pool: &PgPool,
    facility: Uuid,
    patient: Uuid,
    user: Uuid,
    key: Uuid,
) -> anyhow::Result<Option<(Uuid, Uuid, Uuid)>> {
    Ok(sqlx::query_as("SELECT h.patient_id,h.admission_case_id,h.ward_id FROM patient_handover_commands c JOIN patient_handovers h ON h.facility_id=c.facility_id AND h.id=c.result_id WHERE c.facility_id=$1 AND c.patient_id=$2 AND c.actor_user_id=$3 AND c.request_key_hash=$4 AND c.receipt IS NOT NULL")
        .bind(facility).bind(patient).bind(user).bind(digest(key.as_bytes())).fetch_optional(pool).await?)
}
async fn verify_actor(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut HandoverActor,
) -> anyhow::Result<()> {
    let profile: Option<String> = sqlx::query_scalar(
        "SELECT deployment_profile FROM facilities WHERE id=$1 AND is_active FOR SHARE",
    )
    .bind(actor.facility_id)
    .fetch_optional(&mut **tx)
    .await?;
    let user:Option<(i64,i64)>=sqlx::query_as("SELECT session_version,permission_version FROM users WHERE facility_id=$1 AND id=$2 AND is_active FOR SHARE").bind(actor.facility_id).bind(actor.user_id).fetch_optional(&mut **tx).await?;
    if profile != Some(codec::encode(actor.active_profile)?)
        || user != Some((actor.session_version, actor.permission_version))
    {
        return Err(HandoverError::AuthorizationExpired.into());
    }
    let session:Option<DateTime<Utc>>=sqlx::query_scalar("SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at) FROM refresh_sessions WHERE facility_id=$1 AND user_id=$2 AND session_id=$3 AND session_version=$4 AND permission_version_at_issue=$5 AND revoked_at IS NULL AND LEAST(expires_at,idle_expires_at,absolute_expires_at)>clock_timestamp() FOR SHARE")
 .bind(actor.facility_id).bind(actor.user_id).bind(actor.session_id).bind(actor.session_version).bind(actor.permission_version).fetch_optional(&mut **tx).await?;
    actor.valid_until = actor
        .valid_until
        .min(session.ok_or(HandoverError::AuthorizationExpired)?);
    check_deadline(tx, actor).await
}
fn digest(value: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(value.as_ref()).to_vec()
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
    actor: &HandoverActor,
    patient: Uuid,
    key: Uuid,
    kind: &str,
    target: Option<Uuid>,
    payload: &impl Serialize,
) -> anyhow::Result<Option<PatientHandoverReceipt>> {
    if key.is_nil() {
        return Err(HandoverError::InvalidRequest.into());
    }
    let payload_digest = digest(serde_json::to_vec(payload)?);
    let key_hash = digest(key.as_bytes());
    sqlx::query("INSERT INTO patient_handover_commands(facility_id,request_key_hash,patient_id,actor_user_id,command_kind,target_id,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING").bind(actor.facility_id).bind(&key_hash).bind(patient).bind(actor.user_id).bind(kind).bind(target).bind(&payload_digest).execute(&mut **tx).await?;
    let row=sqlx::query_as::<_,CommandRow>("SELECT patient_id,actor_user_id,command_kind,target_id,payload_digest,receipt FROM patient_handover_commands WHERE facility_id=$1 AND request_key_hash=$2 FOR UPDATE").bind(actor.facility_id).bind(key_hash).fetch_one(&mut **tx).await?;
    if row.patient_id != patient
        || row.actor_user_id != actor.user_id
        || row.command_kind != kind
        || row.target_id != target
        || row.payload_digest != payload_digest
    {
        return Err(HandoverError::RequestConflict.into());
    }
    row.receipt
        .map(|v| {
            let mut r: PatientHandoverReceipt = serde_json::from_value(v)?;
            r.replayed = true;
            Ok(r)
        })
        .transpose()
}
async fn finish(
    tx: &mut Transaction<'_, Postgres>,
    actor: &HandoverActor,
    key: Uuid,
    id: Uuid,
    kind: &str,
) -> anyhow::Result<PatientHandoverReceipt> {
    let result = PatientHandoverReceipt {
        client_request_id: key,
        handover: detail_tx(tx, actor.facility_id, id).await?,
        replayed: false,
    };
    sqlx::query("UPDATE patient_handover_commands SET receipt=$3,result_id=$4 WHERE facility_id=$1 AND request_key_hash=$2 AND receipt IS NULL").bind(actor.facility_id).bind(digest(key.as_bytes())).bind(serde_json::to_value(&result)?).bind(id).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'patient_handover',$6,$7)").bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(format!("nursing.patient_handover.{kind}")).bind(id).bind(serde_json::json!({"revision":result.handover.header.revision})).execute(&mut **tx).await?;
    check_deadline(tx, actor).await?;
    Ok(result)
}
async fn admission(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    patient: Uuid,
    id: Uuid,
) -> anyhow::Result<Uuid> {
    let ward:Option<Uuid>=sqlx::query_scalar("SELECT a.ward_id FROM admission_cases a JOIN patients p ON p.id=a.patient_id AND p.facility_id=a.facility_id JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.patient_id=$2 AND a.id=$3 AND a.status IN ('admitted','discharge_pending') AND w.status='active' FOR SHARE OF a,w,p").bind(facility).bind(patient).bind(id).fetch_optional(&mut **tx).await?;
    ward.ok_or_else(|| HandoverError::InvalidContext.into())
}
async fn recipient(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    ward: Uuid,
    user: Option<Uuid>,
) -> anyhow::Result<()> {
    if let Some(user) = user {
        let found:Option<Uuid>=sqlx::query_scalar("SELECT u.id FROM ward_staff_assignments a JOIN practitioner_profiles pp ON pp.id=a.practitioner_profile_id AND pp.facility_id=a.facility_id JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.ward_id=$2 AND u.id=$3 AND a.is_active AND a.role_category='nursing' AND u.is_active FOR SHARE OF a,pp,s,u").bind(facility).bind(ward).bind(user).fetch_optional(&mut **tx).await?;
        if found.is_none() {
            return Err(HandoverError::InvalidRecipient.into());
        }
    }
    Ok(())
}
async fn append(
    tx: &mut Transaction<'_, Postgres>,
    actor: &HandoverActor,
    id: Uuid,
    version: i64,
    kind: HandoverRevisionKind,
    date: NaiveDate,
    shift: HandoverShift,
    to: Option<Uuid>,
    n: &HandoverNarrative,
    reason: &str,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO patient_handover_revisions(id,facility_id,handover_id,revision,kind,shift_date,shift_type,intended_recipient_user_id,patient_condition,ongoing_issues,pending_tasks,medication_changes,key_events,care_plan_updates,family_updates,reason,recorded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)")
 .bind(Uuid::new_v4()).bind(actor.facility_id).bind(id).bind(version).bind(codec::encode(kind)?).bind(date).bind(codec::encode(shift)?).bind(to).bind(&n.patient_condition).bind(&n.ongoing_issues).bind(&n.pending_tasks).bind(&n.medication_changes).bind(&n.key_events).bind(&n.care_plan_updates).bind(&n.family_updates).bind(reason).bind(actor.user_id).execute(&mut **tx).await?;
    Ok(())
}
fn reason(value: &str) -> anyhow::Result<String> {
    let r = value.trim();
    if r.is_empty() || r.chars().count() > 2000 {
        return Err(HandoverError::InvalidRequest.into());
    }
    Ok(r.to_owned())
}
pub async fn create(
    pool: &PgPool,
    mut actor: HandoverActor,
    mut input: CreatePatientHandoverRequest,
) -> anyhow::Result<PatientHandoverReceipt> {
    input.narrative = input
        .narrative
        .normalized()
        .map_err(|_| HandoverError::InvalidRequest)?;
    let mut tx = pool.begin().await?;
    verify_actor(&mut tx, &mut actor).await?;
    if let Some(r) = reserve(
        &mut tx,
        &actor,
        input.patient_id,
        input.client_request_id,
        "record",
        None,
        &input,
    )
    .await?
    {
        require_ward(&mut tx, &actor, r.handover.header.ward_id).await?;
        check_deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(r);
    }
    let ward = admission(
        &mut tx,
        actor.facility_id,
        input.patient_id,
        input.admission_case_id,
    )
    .await?;
    recipient(
        &mut tx,
        actor.facility_id,
        ward,
        input.intended_recipient_user_id,
    )
    .await?;
    require_ward(&mut tx, &actor, ward).await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO patient_handovers(id,facility_id,patient_id,admission_case_id,ward_id,author_user_id,current_revision,status) VALUES($1,$2,$3,$4,$5,$6,1,'recorded')").bind(id).bind(actor.facility_id).bind(input.patient_id).bind(input.admission_case_id).bind(ward).bind(actor.user_id).execute(&mut *tx).await?;
    append(
        &mut tx,
        &actor,
        id,
        1,
        HandoverRevisionKind::Recorded,
        input.shift_date,
        input.shift_type,
        input.intended_recipient_user_id,
        &input.narrative,
        "",
    )
    .await?;
    let result = finish(&mut tx, &actor, input.client_request_id, id, "recorded").await?;
    tx.commit().await?;
    Ok(result)
}
async fn lock_root(
    tx: &mut Transaction<'_, Postgres>,
    actor: &HandoverActor,
    id: Uuid,
) -> anyhow::Result<(Uuid, Uuid, i64, String, Uuid)> {
    sqlx::query_as("SELECT patient_id,ward_id,current_revision,status,author_user_id FROM patient_handovers WHERE facility_id=$1 AND id=$2 FOR UPDATE").bind(actor.facility_id).bind(id).fetch_optional(&mut **tx).await?.ok_or_else(||HandoverError::NotFound.into())
}
pub async fn amend(
    pool: &PgPool,
    mut actor: HandoverActor,
    id: Uuid,
    mut input: AmendPatientHandoverRequest,
) -> anyhow::Result<PatientHandoverReceipt> {
    input.narrative = input
        .narrative
        .normalized()
        .map_err(|_| HandoverError::InvalidRequest)?;
    input.reason = reason(&input.reason)?;
    let mut tx = pool.begin().await?;
    let (patient, ward, version, status, author) = lock_root(&mut tx, &actor, id).await?;
    verify_actor(&mut tx, &mut actor).await?;
    if let Some(r) = reserve(
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
        require_ward(&mut tx, &actor, r.handover.header.ward_id).await?;
        check_deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(r);
    }
    require_ward(&mut tx, &actor, ward).await?;
    if author != actor.user_id {
        return Err(HandoverError::NotAuthor.into());
    }
    if status == "voided" {
        return Err(HandoverError::Voided.into());
    }
    if version != input.expected_revision {
        return Err(HandoverError::RevisionChanged.into());
    }
    let previous = detail_tx(&mut tx, actor.facility_id, id).await?;
    if previous.current.intended_recipient_user_id != input.intended_recipient_user_id {
        recipient(
            &mut tx,
            actor.facility_id,
            ward,
            input.intended_recipient_user_id,
        )
        .await?;
    }
    let next = version
        .checked_add(1)
        .ok_or(HandoverError::InvalidRequest)?;
    append(
        &mut tx,
        &actor,
        id,
        next,
        HandoverRevisionKind::Amended,
        input.shift_date,
        input.shift_type,
        input.intended_recipient_user_id,
        &input.narrative,
        &input.reason,
    )
    .await?;
    sqlx::query("UPDATE patient_handovers SET current_revision=$3,updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(next).execute(&mut *tx).await?;
    let result = finish(&mut tx, &actor, input.client_request_id, id, "amended").await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn void(
    pool: &PgPool,
    mut actor: HandoverActor,
    id: Uuid,
    mut input: VoidPatientHandoverRequest,
) -> anyhow::Result<PatientHandoverReceipt> {
    input.reason = reason(&input.reason)?;
    let mut tx = pool.begin().await?;
    let (patient, ward, version, status, author) = lock_root(&mut tx, &actor, id).await?;
    verify_actor(&mut tx, &mut actor).await?;
    if let Some(r) = reserve(
        &mut tx,
        &actor,
        patient,
        input.client_request_id,
        "void",
        Some(id),
        &input,
    )
    .await?
    {
        require_ward(&mut tx, &actor, r.handover.header.ward_id).await?;
        check_deadline(&mut tx, &actor).await?;
        tx.commit().await?;
        return Ok(r);
    }
    require_ward(&mut tx, &actor, ward).await?;
    if author != actor.user_id {
        return Err(HandoverError::NotAuthor.into());
    }
    if status == "voided" {
        return Err(HandoverError::Voided.into());
    }
    if version != input.expected_revision {
        return Err(HandoverError::RevisionChanged.into());
    }
    let old = detail_tx(&mut tx, actor.facility_id, id).await?.current;
    let next = version
        .checked_add(1)
        .ok_or(HandoverError::InvalidRequest)?;
    append(
        &mut tx,
        &actor,
        id,
        next,
        HandoverRevisionKind::Voided,
        old.shift_date,
        old.shift_type,
        old.intended_recipient_user_id,
        &old.narrative,
        &input.reason,
    )
    .await?;
    sqlx::query("UPDATE patient_handovers SET current_revision=$3,status='voided',updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(actor.facility_id).bind(id).bind(next).execute(&mut *tx).await?;
    let result = finish(&mut tx, &actor, input.client_request_id, id, "voided").await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn receipt(
    pool: &PgPool,
    facility: Uuid,
    patient: Uuid,
    actor: Uuid,
    key: Uuid,
) -> anyhow::Result<Option<PatientHandoverReceipt>> {
    let value:Option<serde_json::Value>=sqlx::query_scalar("SELECT receipt FROM patient_handover_commands WHERE facility_id=$1 AND patient_id=$2 AND actor_user_id=$3 AND request_key_hash=$4 AND receipt IS NOT NULL").bind(facility).bind(patient).bind(actor).bind(digest(key.as_bytes())).fetch_optional(pool).await?;
    value
        .map(|v| {
            let mut r: PatientHandoverReceipt = serde_json::from_value(v)?;
            r.replayed = true;
            Ok(r)
        })
        .transpose()
}
#[derive(FromRow)]
struct RecipientRow {
    id: Uuid,
    user_id: Uuid,
    display_name: String,
    role_name: String,
    assigned_at: DateTime<Utc>,
}
pub async fn recipients(
    pool: &PgPool,
    facility: Uuid,
    patient: Uuid,
    admission: Uuid,
    handover: Option<Uuid>,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<HandoverRecipient>> {
    let mut connection = pool.acquire().await?;
    recipients_connection(
        &mut connection,
        facility,
        patient,
        admission,
        handover,
        cursor,
        limit,
    )
    .await
}
async fn recipients_connection(
    connection: &mut sqlx::PgConnection,
    facility: Uuid,
    patient: Uuid,
    admission: Uuid,
    handover: Option<Uuid>,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<HandoverRecipient>> {
    let mut q=QueryBuilder::<Postgres>::new("SELECT a.id,u.id AS user_id,u.display_name,a.role_name,a.assigned_at FROM admission_cases c ");
    if let Some(id) = handover {
        q.push(" JOIN patient_handovers h ON h.facility_id=c.facility_id AND h.patient_id=c.patient_id AND h.admission_case_id=c.id AND h.id=").push_bind(id);
    }
    q.push(if handover.is_some() {
        " JOIN wards w ON w.id=h.ward_id AND w.facility_id=c.facility_id"
    } else {
        " JOIN wards w ON w.id=c.ward_id AND w.facility_id=c.facility_id"
    });
    q.push(" JOIN ward_staff_assignments a ON a.ward_id=w.id AND a.facility_id=c.facility_id JOIN practitioner_profiles pp ON pp.id=a.practitioner_profile_id AND pp.facility_id=a.facility_id JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.is_active AND a.role_category='nursing' AND u.is_active");
    if handover.is_none() {
        q.push(" AND w.status='active' AND c.status IN ('admitted','discharge_pending')");
    }
    q.push(" AND c.facility_id=");
    q.push_bind(facility)
        .push(" AND c.patient_id=")
        .push_bind(patient)
        .push(" AND c.id=")
        .push_bind(admission);
    if let Some(c) = cursor {
        q.push(" AND (a.assigned_at,a.id)>(")
            .push_bind(c.occurred_at)
            .push(",")
            .push_bind(c.id)
            .push(")");
    }
    q.push(" ORDER BY a.assigned_at,a.id LIMIT ")
        .push_bind(limit.clamp(1, 101));
    let rows = observe_db_query(
        "ward.patient_handover.recipients",
        q.build_query_as::<RecipientRow>().fetch_all(connection),
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| HandoverRecipient {
            id: r.id,
            user_id: r.user_id,
            display_name: r.display_name,
            role_name: r.role_name,
            assigned_at: r.assigned_at,
        })
        .collect())
}

/// Bounded metadata pages have the same live actor deadline as full evidence reads.
pub async fn list_authorized(
    pool: &PgPool,
    mut actor: HandoverActor,
    query: &PatientHandoverListQuery,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PatientHandoverListItem>> {
    let mut tx = pool.begin().await?;
    verify_actor(&mut tx, &mut actor).await?;
    let viewer = if actor.can_view_all_wards {
        None
    } else {
        Some(actor.user_id)
    };
    let rows = list_connection(&mut tx, actor.facility_id, query, viewer, cursor, limit).await?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows)
}
pub async fn recipients_authorized(
    pool: &PgPool,
    mut actor: HandoverActor,
    patient: Uuid,
    admission: Uuid,
    handover: Option<Uuid>,
    cursor: Option<WardCursor>,
    limit: i64,
) -> anyhow::Result<Vec<HandoverRecipient>> {
    let mut tx = if let Some(id) = handover {
        read_transaction(pool, &mut actor, id).await?
    } else {
        let mut tx = pool.begin().await?;
        verify_actor(&mut tx, &mut actor).await?;
        let ward:Uuid=sqlx::query_scalar("SELECT c.ward_id FROM admission_cases c JOIN wards w ON w.facility_id=c.facility_id AND w.id=c.ward_id WHERE c.facility_id=$1 AND c.id=$2 AND c.patient_id=$3 FOR SHARE OF c,w").bind(actor.facility_id).bind(admission).bind(patient).fetch_optional(&mut *tx).await?.ok_or(HandoverError::InvalidContext)?;
        require_ward(&mut tx, &actor, ward).await?;
        tx
    };
    let rows = recipients_connection(
        &mut tx,
        actor.facility_id,
        patient,
        admission,
        handover,
        cursor,
        limit,
    )
    .await?;
    check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(rows)
}
