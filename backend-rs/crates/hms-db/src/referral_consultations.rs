//! Singleton immutable referral-to-encounter links and original start receipts.
mod access;
pub mod chronicle_access;
mod commands;
mod source;
use crate::clinical::prescription_courses::PrescriptionAuthorization;
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
pub use commands::start;
use hms_domain::referral_consultations::*;
use hms_observability::observe_db_query;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{types::Json, FromRow, Postgres, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
#[derive(Clone)]
pub struct ConsultationActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub authorization: PrescriptionAuthorization,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConsultationError {
    InvalidInput,
    NotFound,
    Unavailable,
    SourceChanged,
    RequestConflict,
    Busy,
}
impl std::fmt::Display for ConsultationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "invalid_referral_consultation",
            Self::NotFound => "referral_consultation_not_found",
            Self::Unavailable => "referral_consultation_unavailable",
            Self::SourceChanged => "referral_consultation_source_changed",
            Self::RequestConflict => "referral_consultation_request_conflict",
            Self::Busy => "referral_consultation_busy",
        })
    }
}
impl std::error::Error for ConsultationError {}
fn lock_error(error: sqlx::Error) -> anyhow::Error {
    if error
        .as_database_error()
        .is_some_and(|e| e.code().as_deref() == Some("55P03"))
    {
        ConsultationError::Busy.into()
    } else {
        error.into()
    }
}
fn hash(bytes: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(bytes.as_ref()).to_vec()
}
fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes.as_ref().iter().map(|v| format!("{v:02x}")).collect()
}
fn digest(value: &impl serde::Serialize) -> anyhow::Result<Vec<u8>> {
    Ok(hash(serde_json::to_vec(&serde_json::to_value(value)?)?))
}
#[derive(FromRow)]
struct Root {
    id: Uuid,
    patient_id: Uuid,
    status: String,
    to_service: String,
    priority: String,
    scheduled_appointment_id: Option<Uuid>,
    created_by_user_id: Option<Uuid>,
    accepted_by_user_id: Option<Uuid>,
    updated_at: DateTime<Utc>,
    response_version: i64,
}
async fn root(
    tx: &mut Tx<'_>,
    actor: &ConsultationActor,
    patient: Uuid,
    id: Uuid,
    write: bool,
) -> anyhow::Result<Root> {
    let sql=format!("SELECT id,patient_id,status,to_service,priority,scheduled_appointment_id,created_by_user_id,accepted_by_user_id,updated_at,response_version FROM referrals WHERE facility_id=$1 AND patient_id=$2 AND id=$3 FOR {} NOWAIT",if write {"UPDATE"} else {"SHARE"});
    observe_db_query(
        "referrals.consultation.root",
        sqlx::query_as(&sql)
            .bind(actor.facility_id)
            .bind(patient)
            .bind(id)
            .fetch_optional(&mut **tx),
    )
    .await
    .map_err(lock_error)?
    .ok_or_else(|| ConsultationError::NotFound.into())
}
async fn link(
    tx: &mut Tx<'_>,
    actor: &ConsultationActor,
    r: &Root,
) -> anyhow::Result<Option<ReferralConsultationStart>> {
    let row:Option<Json<ReferralConsultationStart>>=observe_db_query("referrals.consultation.link",sqlx::query_scalar("SELECT detail FROM referral_consultation_starts WHERE facility_id=$1 AND patient_id=$2 AND referral_id=$3").bind(actor.facility_id).bind(r.patient_id).bind(r.id).fetch_optional(&mut **tx)).await?;
    Ok(row.map(|v| v.0))
}
fn parse_query(
    q: ReferralConsultationContextQuery,
) -> anyhow::Result<Option<ReferralConsultationSource>> {
    let invalid = || ConsultationError::InvalidInput;
    match q.mode.as_deref() {
        None if q.visit_choice.is_none()
            && q.visit_id.is_none()
            && q.admission_case_id.is_none()
            && q.encounter_id.is_none() =>
        {
            Ok(None)
        }
        Some("new_outpatient") if q.admission_case_id.is_none() && q.encounter_id.is_none() => {
            Ok(Some(ReferralConsultationSource::NewOutpatient {
                visit: match (q.visit_choice.as_deref(), q.visit_id) {
                    (Some("no_visit"), None) => ReferralConsultationVisitChoice::NoVisit,
                    (Some("existing_visit"), Some(id)) if !id.is_nil() => {
                        ReferralConsultationVisitChoice::ExistingVisit { visit_id: id }
                    }
                    _ => return Err(invalid().into()),
                },
            }))
        }
        Some("existing_admission_encounter")
            if q.visit_choice.is_none() && q.visit_id.is_none() =>
        {
            Ok(Some(
                ReferralConsultationSource::ExistingAdmissionEncounter {
                    admission_case_id: q
                        .admission_case_id
                        .filter(|v| !v.is_nil())
                        .ok_or_else(invalid)?,
                    encounter_id: q.encounter_id.filter(|v| !v.is_nil()).ok_or_else(invalid)?,
                },
            ))
        }
        _ => Err(invalid().into()),
    }
}
async fn context_tx(
    tx: &mut Tx<'_>,
    actor: &ConsultationActor,
    r: &Root,
    scope: &access::Scope,
    patient: &access::Patient,
    selected: Option<ReferralConsultationSource>,
) -> anyhow::Result<ReferralConsultationContext> {
    let saved = link(tx, actor, r).await?;
    let current = if let Some(v) = saved.as_ref() {
        Some(
            source::encounter(tx, actor, v.encounter_id, r.patient_id)
                .await?
                .ok_or(ConsultationError::SourceChanged)?,
        )
    } else {
        None
    };
    let (selection, reason) = if let Some(s) = selected {
        source::selection(tx, actor, r, scope, patient, s).await?
    } else {
        (None, Some("selection_required".to_owned()))
    };
    let reason = if saved.is_some() {
        Some("already_started".to_owned())
    } else if !scope.can_issue {
        Some(
            if scope.practitioner.is_none() {
                "practitioner_required"
            } else {
                "start_authority_required"
            }
            .to_owned(),
        )
    } else if !matches!(r.status.as_str(), "accepted" | "scheduled") {
        Some("referral_state_unavailable".to_owned())
    } else {
        reason
    };
    let token = hex(digest(
        &json!({"root":[r.id,r.patient_id,&r.status,&r.to_service,&r.priority,r.scheduled_appointment_id,r.updated_at,r.response_version],"patient":[&patient.record_status,&patient.vital_status,&patient.identity,patient.chronicle_reachable],"selection":selection,"link":saved,"current":current,"authority":[scope.can_issue,scope.can_override,scope.can_document,scope.practitioner]}),
    )?);
    Ok(ReferralConsultationContext {
        patient: patient.identity.clone(),
        patient_id: r.patient_id,
        referral_id: r.id,
        referral: ReferralConsultationReferral {
            status: codec::decode(&r.status)?,
            to_service: r.to_service.clone(),
            priority: codec::decode(&r.priority)?,
            scheduled_appointment_id: r.scheduled_appointment_id,
        },
        link_version: if saved.is_some() { 1 } else { 0 },
        context_token: token,
        can_start: reason.is_none(),
        can_resume: scope.can_document
            && patient.chronicle_reachable
            && current
                .as_ref()
                .is_some_and(|v| v.status == hms_domain::care::EncounterStatus::InProgress),
        can_issue_start_command: scope.can_issue,
        can_override_restricted_record: scope.can_override,
        unavailable_reason: reason,
        link: saved,
        current_linked_encounter: current,
        selection,
    })
}
pub async fn context(
    pool: &PgPool,
    mut actor: ConsultationActor,
    patient: Uuid,
    id: Uuid,
    q: ReferralConsultationContextQuery,
) -> anyhow::Result<ReferralConsultationContext> {
    let selected = parse_query(q)?;
    let mut tx = pool.begin().await?;
    let r = root(&mut tx, &actor, patient, id, false).await?;
    let scope = access::authority(&mut tx, &mut actor).await?;
    let patient = access::patient(&mut tx, &actor, &r).await?;
    let result = context_tx(&mut tx, &actor, &r, &scope, &patient, selected).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn receipt(
    pool: &PgPool,
    mut actor: ConsultationActor,
    patient: Uuid,
    id: Uuid,
    key: Uuid,
) -> anyhow::Result<ReferralConsultationStartReceipt> {
    if key.is_nil() {
        return Err(ConsultationError::InvalidInput.into());
    }
    let mut tx = pool.begin().await?;
    let r = root(&mut tx, &actor, patient, id, false).await?;
    access::authority(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &actor, &r).await?;
    let row:Option<Json<ReferralConsultationStartReceipt>>=observe_db_query("referrals.consultation.receipt",sqlx::query_scalar("SELECT receipt FROM referral_consultation_start_commands WHERE facility_id=$1 AND patient_id=$2 AND referral_id=$3 AND actor_user_id=$4 AND request_key_hash=$5 AND receipt IS NOT NULL").bind(actor.facility_id).bind(patient).bind(id).bind(actor.user_id).bind(hash(key.as_bytes())).fetch_optional(&mut *tx)).await?;
    let mut result = row.ok_or(ConsultationError::NotFound)?.0;
    if result.client_request_id != key
        || result.link.recorded_by_user_id != actor.user_id
        || result.link.patient_id != patient
        || result.link.referral_id != id
        || link(&mut tx, &actor, &r)
            .await?
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?
            != Some(serde_json::to_value(&result.link)?)
    {
        return Err(ConsultationError::SourceChanged.into());
    }
    result.replayed = true;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
