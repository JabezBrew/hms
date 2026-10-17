//! Nonblocking case follow-up with immutable decisions and actor-bound command recovery.
mod access;
mod commands;
use crate::{codec, PgPool};
pub(crate) use access::verify_closure;
use chrono::{DateTime, Utc};
pub use commands::{create, decide, receipt};
use hms_domain::admission_advisories::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;

#[derive(Clone)]
pub struct AdvisoryActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub authorization: crate::clinical::prescription_courses::PrescriptionAuthorization,
    pub can_write: bool,
    pub can_view_all_wards: bool,
}
#[derive(Clone)]
pub struct AdmissionClosureActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub request_id: Option<String>,
    pub authorization: crate::clinical::prescription_courses::PrescriptionAuthorization,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdvisoryError {
    NotFound,
    InvalidInput,
    AuthorityExpired,
    FeatureDisabled,
    PatientDenied,
    WardDenied,
    ContextChanged,
    VersionChanged,
    TypeExists,
    Terminal,
    RequestConflict,
}
impl std::fmt::Display for AdvisoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("admission advisory request denied")
    }
}
impl std::error::Error for AdvisoryError {}
#[derive(Clone, Debug)]
pub struct AdvisoryCaseCursor {
    pub created_at: DateTime<Utc>,
    pub id: Uuid,
}
#[derive(FromRow)]
struct CaseRow {
    id: Uuid,
    patient_id: Uuid,
    ward_id: Uuid,
    bed_id: Option<Uuid>,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    ward_name: String,
    ward_status: String,
    status: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}
impl CaseRow {
    fn open(&self) -> bool {
        matches!(
            self.status.as_str(),
            "ready_for_activation" | "admitted" | "discharge_pending"
        ) && self.ward_status == "active"
    }
    fn token(&self, facility: Uuid) -> anyhow::Result<String> {
        Ok(hex(hash(serde_json::to_vec(&(
            facility,
            self.id,
            self.patient_id,
            self.ward_id,
            self.bed_id,
            self.encounter_id,
            self.visit_id,
            &self.ward_name,
            &self.ward_status,
            &self.status,
            self.updated_at,
        ))?)))
    }
    fn list(&self) -> anyhow::Result<AdmissionAdvisoryCase> {
        Ok(AdmissionAdvisoryCase {
            admission_case_id: self.id,
            patient_id: self.patient_id,
            current_ward_id: self.ward_id,
            current_ward_name: self.ward_name.clone(),
            admission_status: codec::decode(&self.status)?,
            created_at: self.created_at,
        })
    }
}
const CASE_SELECT:&str="SELECT a.id,a.patient_id,a.ward_id,a.bed_id,a.encounter_id,a.visit_id,w.name AS ward_name,w.status AS ward_status,a.status,a.created_at,a.updated_at FROM admission_cases a JOIN patients p ON p.id=a.patient_id AND p.facility_id=a.facility_id JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id";
async fn case(
    tx: &mut Tx<'_>,
    actor: &AdvisoryActor,
    patient: Uuid,
    id: Uuid,
    write: bool,
) -> anyhow::Result<CaseRow> {
    let lock = if write {
        "FOR UPDATE OF a FOR SHARE OF w"
    } else {
        "FOR SHARE OF a,w"
    };
    sqlx::query_as(&format!(
        "{CASE_SELECT} WHERE a.facility_id=$1 AND a.patient_id=$2 AND a.id=$3 {lock}"
    ))
    .bind(actor.facility_id)
    .bind(patient)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AdvisoryError::NotFound.into())
}
#[derive(FromRow)]
struct Row {
    id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    captured_ward_id: Uuid,
    captured_ward_name: String,
    task_type: String,
    phase: String,
    notes: String,
    status: String,
    version: i64,
    created_by_user_id: Uuid,
    created_by_display_name: String,
    created_at: DateTime<Utc>,
    decision_source: Option<String>,
    decision_reason: Option<String>,
    system_reason_code: Option<String>,
    decided_by_user_id: Option<Uuid>,
    decided_by_display_name: Option<String>,
    decided_at: Option<DateTime<Utc>>,
    decision_ward_id: Option<Uuid>,
    decision_ward_name: Option<String>,
}
const DETAIL:&str="SELECT id,patient_id,admission_case_id,captured_ward_id,captured_ward_name,task_type,phase,notes,status,version,created_by_user_id,created_by_display_name,created_at,decision_source,decision_reason,system_reason_code,decided_by_user_id,decided_by_display_name,decided_at,decision_ward_id,decision_ward_name FROM admission_advisories";
const HEADER:&str="SELECT id,patient_id,admission_case_id,captured_ward_id,task_type,phase,status,version,created_at,decided_at FROM admission_advisories";
#[derive(FromRow)]
struct Header {
    id: Uuid,
    patient_id: Uuid,
    admission_case_id: Uuid,
    captured_ward_id: Uuid,
    task_type: String,
    phase: String,
    status: String,
    version: i64,
    created_at: DateTime<Utc>,
    decided_at: Option<DateTime<Utc>>,
}
impl Header {
    fn dto(self, actor: &AdvisoryActor, c: &CaseRow) -> anyhow::Result<AdmissionAdvisoryListItem> {
        let pending = self.status == "pending";
        Ok(AdmissionAdvisoryListItem {
            id: self.id,
            patient_id: self.patient_id,
            admission_case_id: self.admission_case_id,
            captured_ward_id: self.captured_ward_id,
            task_type: codec::decode(&self.task_type)?,
            phase: codec::decode(&self.phase)?,
            status: codec::decode(&self.status)?,
            version: self.version,
            created_at: self.created_at,
            decided_at: self.decided_at,
            can_complete: pending && actor.can_write && c.open(),
            can_acknowledge_unresolved: pending && actor.can_write && c.open(),
            can_cancel: pending && actor.can_write,
        })
    }
}
fn detail(row: Row, actor: &AdvisoryActor, c: &CaseRow) -> anyhow::Result<AdmissionAdvisoryDetail> {
    let decision = if row.status == "pending" {
        None
    } else {
        Some(AdmissionAdvisoryDecisionRecord {
            status: codec::decode(&row.status)?,
            reason: row.decision_reason,
            source: codec::decode(&row.decision_source.ok_or(AdvisoryError::ContextChanged)?)?,
            system_reason_code: row
                .system_reason_code
                .map(|v| codec::decode(&v))
                .transpose()?,
            recorded_by_user_id: row
                .decided_by_user_id
                .ok_or(AdvisoryError::ContextChanged)?,
            recorded_by_display_name: row
                .decided_by_display_name
                .ok_or(AdvisoryError::ContextChanged)?,
            recorded_at: row.decided_at.ok_or(AdvisoryError::ContextChanged)?,
            ward_id: row.decision_ward_id.ok_or(AdvisoryError::ContextChanged)?,
            ward_name: row
                .decision_ward_name
                .ok_or(AdvisoryError::ContextChanged)?,
        })
    };
    let summary = Header {
        id: row.id,
        patient_id: row.patient_id,
        admission_case_id: row.admission_case_id,
        captured_ward_id: row.captured_ward_id,
        task_type: row.task_type,
        phase: row.phase,
        status: row.status,
        version: row.version,
        created_at: row.created_at,
        decided_at: row.decided_at,
    }
    .dto(actor, c)?;
    Ok(AdmissionAdvisoryDetail {
        summary,
        captured_ward_name: row.captured_ward_name,
        notes: row.notes,
        created_by_user_id: row.created_by_user_id,
        created_by_display_name: row.created_by_display_name,
        decision,
    })
}
async fn detail_tx(
    tx: &mut Tx<'_>,
    actor: &AdvisoryActor,
    c: &CaseRow,
    id: Uuid,
    write: bool,
) -> anyhow::Result<AdmissionAdvisoryDetail> {
    let lock = if write { "FOR UPDATE" } else { "FOR SHARE" };
    let row = sqlx::query_as(&format!(
        "{DETAIL} WHERE facility_id=$1 AND patient_id=$2 AND admission_case_id=$3 AND id=$4 {lock}"
    ))
    .bind(actor.facility_id)
    .bind(c.patient_id)
    .bind(c.id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AdvisoryError::NotFound)?;
    detail(row, actor, c)
}
pub async fn list_cases(
    pool: &PgPool,
    mut actor: AdvisoryActor,
    patient: Uuid,
    q: AdmissionAdvisoryCaseQuery,
    cursor: Option<AdvisoryCaseCursor>,
    limit: i64,
) -> anyhow::Result<Vec<AdmissionAdvisoryCase>> {
    let mut tx = pool.begin().await?;
    let mut sql = QueryBuilder::<Postgres>::new(format!("{CASE_SELECT} WHERE a.facility_id="));
    sql.push_bind(actor.facility_id)
        .push(" AND a.patient_id=")
        .push_bind(patient);
    // Acquire the bounded source parents before facility/actor proof, matching
    // detail and command ordering. This first nonlocking eligibility predicate
    // is rechecked under retained assignment/actor locks before returning data.
    if !actor.can_view_all_wards {
        sql.push(" AND EXISTS(SELECT 1 FROM ward_staff_assignments wa JOIN practitioner_profiles pp ON pp.id=wa.practitioner_profile_id AND pp.facility_id=wa.facility_id JOIN staff_profiles sp ON sp.id=pp.staff_id AND sp.facility_id=wa.facility_id JOIN users u ON u.id=sp.user_id AND u.facility_id=wa.facility_id WHERE wa.facility_id=a.facility_id AND wa.ward_id=a.ward_id AND wa.is_active AND u.is_active AND u.id=")
            .push_bind(actor.user_id).push(")");
    }
    if let Some(status) = q.status {
        sql.push(" AND a.status=").push_bind(codec::encode(status)?);
    } else if !q.include_closed.unwrap_or(false) {
        sql.push(" AND a.status IN ('ready_for_activation','admitted','discharge_pending')");
    }
    if let Some(cursor) = cursor {
        sql.push(" AND (a.created_at,a.id)<(")
            .push_bind(cursor.created_at)
            .push(",")
            .push_bind(cursor.id)
            .push(")");
    }
    sql.push(" ORDER BY a.created_at DESC,a.id DESC LIMIT ")
        .push_bind(limit.clamp(1, 101))
        .push(" FOR SHARE OF a,w");
    let rows: Vec<CaseRow> = hms_observability::observe_db_query(
        "ward.admission_advisories.case_list",
        sql.build_query_as().fetch_all(&mut *tx),
    )
    .await?;
    access::verify(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &actor, patient).await?;
    if access::wards(&mut tx, &actor)
        .await?
        .is_some_and(|wards| rows.iter().any(|row| !wards.contains(&row.ward_id)))
    {
        // A concurrent assignment change invalidates the whole reviewed page.
        // Do not silently filter an already-limited page into a false result.
        return Err(AdvisoryError::WardDenied.into());
    }
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    rows.iter().map(CaseRow::list).collect()
}
pub async fn context(
    pool: &PgPool,
    mut actor: AdvisoryActor,
    patient: Uuid,
    id: Uuid,
) -> anyhow::Result<AdmissionAdvisoryContext> {
    let mut tx = pool.begin().await?;
    let c = case(&mut tx, &actor, patient, id, false).await?;
    access::verify(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &actor, patient).await?;
    access::ward(&mut tx, &actor, c.ward_id).await?;
    let rows:Vec<Header>=sqlx::query_as(&format!("{HEADER} WHERE facility_id=$1 AND patient_id=$2 AND admission_case_id=$3 ORDER BY created_at,id LIMIT 9 FOR SHARE"))
        .bind(actor.facility_id).bind(patient).bind(id).fetch_all(&mut *tx).await?;
    if rows.len() > 8 {
        return Err(AdvisoryError::ContextChanged.into());
    }
    let advisories = rows
        .into_iter()
        .map(|r| r.dto(&actor, &c))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let available_types = AdmissionAdvisoryType::ALL
        .into_iter()
        .filter(|kind| !advisories.iter().any(|t| t.task_type == *kind))
        .collect::<Vec<_>>();
    let mut counts = AdmissionAdvisoryCounts::default();
    for a in &advisories {
        match a.status {
            AdmissionAdvisoryStatus::Pending => counts.pending += 1,
            AdmissionAdvisoryStatus::Completed => counts.completed += 1,
            AdmissionAdvisoryStatus::AcknowledgedUnresolved => counts.acknowledged_unresolved += 1,
            AdmissionAdvisoryStatus::Cancelled => counts.cancelled += 1,
        }
    }
    let result = AdmissionAdvisoryContext {
        patient_id: patient,
        admission_case_id: id,
        admission_status: codec::decode(&c.status)?,
        current_ward_id: c.ward_id,
        current_ward_name: c.ward_name.clone(),
        context_token: c.token(actor.facility_id)?,
        can_create: actor.can_write && c.open() && !available_types.is_empty(),
        can_complete: actor.can_write && c.open(),
        can_acknowledge_unresolved: actor.can_write && c.open(),
        can_cancel: actor.can_write,
        available_types,
        advisories,
        counts_by_status: counts,
        complete: true,
    };
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn get(
    pool: &PgPool,
    mut actor: AdvisoryActor,
    patient: Uuid,
    case_id: Uuid,
    id: Uuid,
) -> anyhow::Result<AdmissionAdvisoryDetail> {
    let mut tx = pool.begin().await?;
    let c = case(&mut tx, &actor, patient, case_id, false).await?;
    access::verify(&mut tx, &mut actor).await?;
    access::patient(&mut tx, &actor, patient).await?;
    access::ward(&mut tx, &actor, c.ward_id).await?;
    let result = detail_tx(&mut tx, &actor, &c, id, false).await?;
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
fn hash(value: impl AsRef<[u8]>) -> Vec<u8> {
    Sha256::digest(value).to_vec()
}
fn hex(value: Vec<u8>) -> String {
    value.iter().map(|v| format!("{v:02x}")).collect()
}

pub(crate) async fn closure_deadline(
    tx: &mut Tx<'_>,
    actor: &AdmissionClosureActor,
) -> anyhow::Result<()> {
    access::deadline_at(tx, actor.authorization.valid_until).await
}
/// Called only inside a canonical closure transaction after its case parent lock.
/// A trusted old actorless completion cannot invent provenance for pending follow-up.
pub(crate) async fn retire_pending(
    tx: &mut Tx<'_>,
    facility: Uuid,
    case_id: Uuid,
    actor: Option<&AdmissionClosureActor>,
    source: AdmissionAdvisorySystemReason,
) -> anyhow::Result<u64> {
    let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM admission_advisories WHERE facility_id=$1 AND admission_case_id=$2 AND status='pending')").bind(facility).bind(case_id).fetch_one(&mut **tx).await?;
    if !pending {
        return Ok(0);
    }
    let actor = actor.ok_or(AdvisoryError::AuthorityExpired)?;
    if actor.facility_id != facility {
        return Err(AdvisoryError::AuthorityExpired.into());
    }
    closure_deadline(tx, actor).await?;
    let status = match source {
        AdmissionAdvisorySystemReason::AdmissionCaseCancelled => "cancelled",
        AdmissionAdvisorySystemReason::AdmissionDischarged => "discharged",
    };
    let code = codec::encode(source)?;
    let at: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut **tx)
        .await?;
    let changed=sqlx::query(r#"WITH retired AS(
        UPDATE admission_advisories t SET status='cancelled',version=version+1,
            decision_source=$4,system_reason_code=$4,decision_reason=NULL,
            decided_by_user_id=u.id,decided_by_display_name=u.display_name,decided_at=$5,
            decision_ward_id=a.ward_id,decision_ward_name=w.name
        FROM admission_cases a JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id,users u
        WHERE t.facility_id=$1 AND t.admission_case_id=$2 AND t.status='pending'
          AND a.facility_id=t.facility_id AND a.id=t.admission_case_id AND a.patient_id=t.patient_id
          AND a.status=$3 AND u.facility_id=t.facility_id AND u.id=$6
        RETURNING t.id
    ) INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata)
        SELECT gen_random_uuid(),$1,$6,$7,'admission_advisory.retired','admission_advisory',id,
            jsonb_build_object('source',$4::text,'status','cancelled','version',2) FROM retired"#)
        .bind(facility).bind(case_id).bind(status).bind(code).bind(at).bind(actor.user_id).bind(&actor.request_id).execute(&mut **tx).await?.rows_affected();
    closure_deadline(tx, actor).await?;
    Ok(changed)
}
