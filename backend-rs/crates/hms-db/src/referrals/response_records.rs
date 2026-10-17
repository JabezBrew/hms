//! Protected ordinary-care response evidence, separate from referral routing DTOs.
mod access;
mod commands;
mod schedule;
use crate::clinical::prescription_courses::PrescriptionAuthorization;
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
pub use commands::command;
use hms_domain::referrals::*;
pub use schedule::{route_transition, schedule, RoutingTransition};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
#[derive(Clone)]
pub struct ReferralResponseActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub authorization: PrescriptionAuthorization,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResponseError {
    InvalidInput,
    NotFound,
    Unavailable,
    SourceChanged,
    RequestConflict,
}
impl std::fmt::Display for ResponseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "invalid_referral_response",
            Self::NotFound => "referral_response_not_found",
            Self::Unavailable => "referral_response_unavailable",
            Self::SourceChanged => "referral_response_source_changed",
            Self::RequestConflict => "referral_response_request_conflict",
        })
    }
}
impl std::error::Error for ResponseError {}
fn hash(value: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(value.as_ref()).to_vec()
}
#[derive(FromRow)]
struct Root {
    id: Uuid,
    patient_id: Uuid,
    to_service: String,
    priority: String,
    status: String,
    scheduled_appointment_id: Option<Uuid>,
    completed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    created_by_user_id: Option<Uuid>,
    accepted_by_user_id: Option<Uuid>,
    response_version: i64,
}
impl Root {
    fn token(&self) -> anyhow::Result<String> {
        Ok(hash(serde_json::to_vec(&json!([
            self.id,
            self.patient_id,
            self.to_service,
            self.priority,
            self.status,
            self.scheduled_appointment_id,
            self.completed_at,
            self.created_at,
            self.updated_at,
            self.created_by_user_id,
            self.accepted_by_user_id,
            self.response_version
        ]))?)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
    }
    fn can_draft(&self) -> bool {
        matches!(self.status.as_str(), "accepted" | "scheduled")
    }
    fn can_complete(&self) -> bool {
        self.can_draft() && self.completed_at.is_none()
    }
}
async fn root(
    tx: &mut Tx<'_>,
    actor: &ReferralResponseActor,
    patient: Option<Uuid>,
    id: Uuid,
    write: bool,
) -> anyhow::Result<Root> {
    let sql=format!("SELECT id,patient_id,to_service,priority,status,scheduled_appointment_id,completed_at,created_at,updated_at,created_by_user_id,accepted_by_user_id,response_version FROM referrals WHERE facility_id=$1 AND id=$2 AND ($3::uuid IS NULL OR patient_id=$3) FOR {}",if write{"UPDATE"}else{"SHARE"});
    hms_observability::observe_db_query(
        "referrals.response.root",
        sqlx::query_as(&sql)
            .bind(actor.facility_id)
            .bind(id)
            .bind(patient)
            .fetch_optional(&mut **tx),
    )
    .await?
    .ok_or_else(|| ResponseError::NotFound.into())
}
#[derive(FromRow)]
struct Version {
    id: Uuid,
    patient_id: Uuid,
    referral_id: Uuid,
    version: i64,
    operation: String,
    status: String,
    to_service: String,
    priority: String,
    specialist_notes: Option<String>,
    recommendations: Option<String>,
    amendment_reason: Option<String>,
    completed_at: Option<DateTime<Utc>>,
    recorded_by_user_id: Option<Uuid>,
    recorded_by_display_name: Option<String>,
    recorded_at: DateTime<Utc>,
    imported_legacy: bool,
}
const VERSION:&str="SELECT id,patient_id,referral_id,version,operation,status,to_service,priority,specialist_notes,recommendations,amendment_reason,completed_at,recorded_by_user_id,recorded_by_display_name,recorded_at,imported_legacy FROM referral_response_revisions";
fn revision(v: Version) -> anyhow::Result<ReferralResponseRevision> {
    Ok(ReferralResponseRevision {
        history: ReferralResponseHistoryItem {
            id: v.id,
            patient_id: v.patient_id,
            referral_id: v.referral_id,
            version: v.version,
            operation: codec::decode(&v.operation)?,
            status: codec::decode(&v.status)?,
            to_service: v.to_service,
            priority: codec::decode(&v.priority)?,
            completed_at: v.completed_at,
            recorded_by_user_id: v.recorded_by_user_id,
            recorded_by_display_name: v.recorded_by_display_name,
            recorded_at: v.recorded_at,
            imported_legacy: v.imported_legacy,
        },
        specialist_notes: v.specialist_notes,
        recommendations: v.recommendations,
        amendment_reason: v.amendment_reason,
    })
}
async fn version_tx(
    tx: &mut Tx<'_>,
    actor: &ReferralResponseActor,
    r: &Root,
    id: Option<Uuid>,
) -> anyhow::Result<ReferralResponseRevision> {
    let sql=format!("{VERSION} WHERE facility_id=$1 AND referral_id=$2 AND patient_id=$3 AND (($4::uuid IS NOT NULL AND id=$4) OR ($4::uuid IS NULL AND version=$5))");
    let v = hms_observability::observe_db_query(
        "referrals.response.version",
        sqlx::query_as::<_, Version>(&sql)
            .bind(actor.facility_id)
            .bind(r.id)
            .bind(r.patient_id)
            .bind(id)
            .bind(r.response_version)
            .fetch_optional(&mut **tx),
    )
    .await?
    .ok_or(ResponseError::NotFound)?;
    revision(v)
}
async fn protected<'a>(
    pool: &'a PgPool,
    actor: &mut ReferralResponseActor,
    patient: Uuid,
    id: Uuid,
) -> anyhow::Result<(Tx<'a>, Root)> {
    let mut tx = pool.begin().await?;
    let r = root(&mut tx, actor, Some(patient), id, false).await?;
    access::authority(&mut tx, actor, true, false).await?;
    access::patient(&mut tx, actor, &r, true).await?;
    Ok((tx, r))
}
pub async fn context(
    pool: &PgPool,
    mut actor: ReferralResponseActor,
    patient: Uuid,
    id: Uuid,
) -> anyhow::Result<ReferralResponseContext> {
    let (mut tx, r) = protected(pool, &mut actor, patient, id).await?;
    let response = if r.response_version == 0 {
        None
    } else {
        Some(version_tx(&mut tx, &actor, &r, None).await?)
    };
    let result = ReferralResponseContext {
        patient_id: patient,
        referral_id: id,
        to_service: r.to_service.clone(),
        priority: codec::decode(&r.priority)?,
        created_at: r.created_at,
        status: codec::decode(&r.status)?,
        version: r.response_version,
        context_token: r.token()?,
        scheduled_appointment_id: r.scheduled_appointment_id,
        completed_at: r.completed_at,
        response,
        can_save_draft: r.can_draft(),
        can_complete: r.can_complete(),
        can_amend: r.status == "completed",
    };
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn get_version(
    pool: &PgPool,
    mut actor: ReferralResponseActor,
    patient: Uuid,
    id: Uuid,
    version_id: Uuid,
) -> anyhow::Result<ReferralResponseRevision> {
    let (mut tx, r) = protected(pool, &mut actor, patient, id).await?;
    let result = version_tx(&mut tx, &actor, &r, Some(version_id)).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn history(
    pool: &PgPool,
    mut actor: ReferralResponseActor,
    patient: Uuid,
    id: Uuid,
    before: Option<i64>,
    limit: i64,
) -> anyhow::Result<Vec<ReferralResponseHistoryItem>> {
    let (mut tx, _) = protected(pool, &mut actor, patient, id).await?;
    let sql="SELECT id,patient_id,referral_id,version,operation,status,to_service,priority,NULL::text AS specialist_notes,NULL::text AS recommendations,NULL::text AS amendment_reason,completed_at,recorded_by_user_id,recorded_by_display_name,recorded_at,imported_legacy FROM referral_response_revisions WHERE facility_id=$1 AND referral_id=$2 AND patient_id=$3 AND ($4::bigint IS NULL OR version<$4) ORDER BY version DESC LIMIT $5";
    let rows = hms_observability::observe_db_query(
        "referrals.response.history",
        sqlx::query_as::<_, Version>(sql)
            .bind(actor.facility_id)
            .bind(id)
            .bind(patient)
            .bind(before)
            .bind(limit.clamp(1, 101))
            .fetch_all(&mut *tx),
    )
    .await?;
    let result = rows
        .into_iter()
        .map(|v| revision(v).map(|r| r.history))
        .collect::<anyhow::Result<Vec<_>>>()?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: ReferralResponseActor,
    patient: Uuid,
    id: Uuid,
    key: Uuid,
) -> anyhow::Result<ReferralResponseReceipt> {
    let (mut tx, r) = protected(pool, &mut actor, patient, id).await?;
    let value:Option<(String,Option<Uuid>,sqlx::types::Json<ReferralResponseReceipt>)>=hms_observability::observe_db_query("referrals.response.receipt", sqlx::query_as("SELECT operation,result_id,receipt FROM referral_response_commands WHERE facility_id=$1 AND referral_id=$2 AND patient_id=$3 AND actor_user_id=$4 AND request_key_hash=$5").bind(actor.facility_id).bind(id).bind(patient).bind(actor.user_id).bind(hash(key.as_bytes())).fetch_optional(&mut *tx)).await?;
    let (operation, result_id, result) = value.ok_or(ResponseError::NotFound)?;
    let result = checked_receipt(&mut tx, &actor, &r, key, &operation, result_id, result.0).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
// Validate bounded typed evidence against its exact immutable revision even if
// a trusted import bypassed SQL guards. Never interpret arbitrary clinical JSON.
async fn checked_receipt(
    tx: &mut Tx<'_>,
    actor: &ReferralResponseActor,
    r: &Root,
    key: Uuid,
    operation: &str,
    result_id: Option<Uuid>,
    mut result: ReferralResponseReceipt,
) -> anyhow::Result<ReferralResponseReceipt> {
    let invalid = || anyhow::anyhow!("invalid_referral_response_receipt_evidence");
    let expected = match operation {
        "save_draft" => ReferralResponseVersionKind::DraftSaved,
        "complete" => ReferralResponseVersionKind::Completed,
        "amend" => ReferralResponseVersionKind::Amended,
        _ => return Err(invalid()),
    };
    let id = result_id.ok_or_else(invalid)?;
    if result.client_request_id != key
        || result.operation != expected
        || result.response.history.operation != expected
        || result.response.history.id != id
        || result.response.history.patient_id != r.patient_id
        || result.response.history.referral_id != r.id
        || result.response.history.recorded_by_user_id != Some(actor.user_id)
        || result.response.history.imported_legacy
        || result.response.history.version < 1
    {
        return Err(invalid());
    }
    let canonical = version_tx(tx, actor, r, Some(id))
        .await
        .map_err(|_| invalid())?;
    if result.response != canonical || result.recorded_at != canonical.history.recorded_at {
        return Err(invalid());
    }
    result.replayed = true;
    Ok(result)
}
