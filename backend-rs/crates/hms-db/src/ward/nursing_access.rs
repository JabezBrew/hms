//! Constant-cost authority and actual ward-relationship proofs for nursing work.
use chrono::{DateTime, Utc};
use hms_domain::deployment::DeploymentProfile;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone)]
pub struct NursingActor {
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub session_version: i64,
    pub permission_version: i64,
    pub active_profile: DeploymentProfile,
    pub valid_until: DateTime<Utc>,
    pub resolved_network_policy_version: Option<i64>,
    pub can_view_all_wards: bool,
    pub request_id: Option<String>,
}
impl std::fmt::Debug for NursingActor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NursingActor").finish_non_exhaustive()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NursingError {
    AuthorizationExpired,
    WardDenied,
    FeatureDisabled,
    InvalidScope,
    InvalidContext,
    InvalidAssignee,
    TerminalConflict,
    NotFound,
}
impl std::fmt::Display for NursingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::AuthorizationExpired => "Current nursing authority is required.",
            Self::FeatureDisabled => "The nursing feature is not enabled.",
            Self::WardDenied => "Current ward authority is required.",
            Self::InvalidScope => "The selected nursing scope is inconsistent.",
            Self::InvalidContext => "Current active admission context is required.",
            Self::InvalidAssignee => "A current eligible local assignee is required.",
            Self::TerminalConflict => "The task already has a different terminal decision.",
            Self::NotFound => "The nursing record was not found.",
        })
    }
}
impl std::error::Error for NursingError {}

pub(crate) async fn deadline(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NursingActor,
) -> anyhow::Result<()> {
    let valid: bool = hms_observability::observe_db_query(
        "ward.nursing.proof.deadline",
        sqlx::query_scalar("SELECT clock_timestamp()<$1")
            .bind(actor.valid_until)
            .fetch_one(&mut **tx),
    )
    .await?;
    if !valid {
        return Err(NursingError::AuthorizationExpired.into());
    }
    Ok(())
}

/// Facility -> user -> exact refresh session -> assignment rows, held through commit.
/// Source-bearing commands acquire their source row before this proof.
pub(crate) async fn verify(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut NursingActor,
) -> anyhow::Result<Option<Vec<Uuid>>> {
    let profile: Option<String> = hms_observability::observe_db_query(
        "ward.nursing.proof.facility",
        sqlx::query_scalar(
            "SELECT deployment_profile FROM facilities WHERE id=$1 AND is_active FOR SHARE",
        )
        .bind(actor.facility_id)
        .fetch_optional(&mut **tx),
    )
    .await?;
    let versions: Option<(i64,i64)> = hms_observability::observe_db_query("ward.nursing.proof.user", sqlx::query_as("SELECT session_version,permission_version FROM users WHERE facility_id=$1 AND id=$2 AND is_active AND NOT password_change_required FOR SHARE")
        .bind(actor.facility_id).bind(actor.user_id).fetch_optional(&mut **tx)).await?;
    if profile != Some(crate::codec::encode(actor.active_profile)?)
        || versions != Some((actor.session_version, actor.permission_version))
    {
        return Err(NursingError::AuthorizationExpired.into());
    }
    let nursing_override:Option<bool>=hms_observability::observe_db_query("ward.nursing.proof.feature", sqlx::query_scalar("SELECT enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key='nursing'")
        .bind(actor.facility_id).fetch_optional(&mut **tx)).await?;
    let defaults = hms_domain::capabilities::feature_flags_for_profile(actor.active_profile);
    if !nursing_override.unwrap_or_else(|| {
        defaults
            .get(&hms_domain::deployment::FeatureKey::Nursing)
            .copied()
            .unwrap_or(false)
    }) {
        return Err(NursingError::FeatureDisabled.into());
    }
    let session: Option<DateTime<Utc>> = hms_observability::observe_db_query("ward.nursing.proof.session", sqlx::query_scalar("SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at) FROM refresh_sessions WHERE facility_id=$1 AND user_id=$2 AND session_id=$3 AND session_version=$4 AND permission_version_at_issue=$5 AND revoked_at IS NULL AND LEAST(expires_at,idle_expires_at,absolute_expires_at)>clock_timestamp() FOR SHARE")
        .bind(actor.facility_id).bind(actor.user_id).bind(actor.session_id).bind(actor.session_version).bind(actor.permission_version).fetch_optional(&mut **tx)).await?;
    actor.valid_until = actor
        .valid_until
        .min(session.ok_or(NursingError::AuthorizationExpired)?);
    crate::network::require_publication_tx(
        tx,
        actor.facility_id,
        actor
            .resolved_network_policy_version
            .ok_or(crate::network::NetworkPublicationError::MissingProof)?,
    )
    .await?;
    deadline(tx, actor).await?;
    if actor.can_view_all_wards {
        return Ok(None);
    }
    let wards:Vec<Uuid> = hms_observability::observe_db_query("ward.nursing.proof.assignments", sqlx::query_scalar("SELECT a.ward_id FROM ward_staff_assignments a JOIN practitioner_profiles pp ON pp.id=a.practitioner_profile_id AND pp.facility_id=a.facility_id JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND u.id=$2 AND a.is_active AND u.is_active ORDER BY a.id FOR SHARE OF a,pp,s")
        .bind(actor.facility_id).bind(actor.user_id).fetch_all(&mut **tx)).await?;
    deadline(tx, actor).await?;
    Ok(Some(wards))
}
pub(crate) fn ward(wards: &Option<Vec<Uuid>>, id: Uuid) -> anyhow::Result<()> {
    if wards.as_ref().is_some_and(|ids| !ids.contains(&id)) {
        return Err(NursingError::WardDenied.into());
    }
    Ok(())
}

pub(crate) async fn admission(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NursingActor,
    wards: &Option<Vec<Uuid>>,
    admission: Uuid,
    patient: Uuid,
    expected_ward: Option<Uuid>,
    active: bool,
) -> anyhow::Result<Uuid> {
    let row: Option<(Uuid,String)> = hms_observability::observe_db_query("ward.nursing.proof.admission", sqlx::query_as("SELECT c.ward_id,c.status FROM admission_cases c JOIN patients p ON p.id=c.patient_id AND p.facility_id=c.facility_id JOIN wards w ON w.id=c.ward_id AND w.facility_id=c.facility_id WHERE c.facility_id=$1 AND c.id=$2 AND c.patient_id=$3 AND (NOT $4 OR w.status='active') FOR SHARE OF c,p,w")
        .bind(actor.facility_id).bind(admission).bind(patient).bind(active).fetch_optional(&mut **tx)).await?;
    let (id, status) = row.ok_or(NursingError::InvalidContext)?;
    if (active && !matches!(status.as_str(), "admitted" | "discharge_pending"))
        || expected_ward.is_some_and(|w| w != id)
    {
        return Err(NursingError::InvalidContext.into());
    }
    ward(wards, id)?;
    deadline(tx, actor).await?;
    Ok(id)
}

pub(crate) async fn assignee(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    ward: Uuid,
    user: Uuid,
) -> anyhow::Result<()> {
    // Existing task assignment is a user FK. Require actual active local ward membership,
    // without inventing a nurse-role default or granting authority to the recipient.
    let found:Option<Uuid>=hms_observability::observe_db_query("ward.nursing.proof.assignee", sqlx::query_scalar("SELECT u.id FROM ward_staff_assignments a JOIN practitioner_profiles pp ON pp.id=a.practitioner_profile_id AND pp.facility_id=a.facility_id JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.ward_id=$2 AND u.id=$3 AND a.is_active AND u.is_active FOR SHARE OF a,pp,s,u")
        .bind(facility).bind(ward).bind(user).fetch_optional(&mut **tx)).await?;
    if found.is_none() {
        return Err(NursingError::InvalidAssignee.into());
    }
    Ok(())
}
pub(crate) async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NursingActor,
    id: Uuid,
    event: &str,
    resource: &str,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(event).bind(resource).bind(id).execute(&mut **tx).await?;
    deadline(tx, actor).await
}
