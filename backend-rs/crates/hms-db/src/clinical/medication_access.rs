//! Live authority for bedside medication records and central pharmacy purpose.
//! Data-class and workflow decisions are made by hms-access; their exact
//! session/version/deadline proof is mandatory here and held through publication.
use super::prescription_courses::{self, PrescriptionActor, PrescriptionCourseError};
use crate::codec;
use hms_domain::deployment::FeatureKey;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone)]
pub struct MedicationActor {
    pub identity: PrescriptionActor,
    pub can_view_all_wards: bool,
    /// Policy version resolved from the actual server-side connection decision.
    /// No client address or caller-supplied assertion is retained here.
    pub resolved_network_policy_version: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MedicationAccessError {
    AuthorityExpired,
    FeatureDisabled,
    PatientDenied,
    WardDenied,
    ContextChanged,
}
impl std::fmt::Display for MedicationAccessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::AuthorityExpired => "Current medication authority is required.",
            Self::FeatureDisabled => "The medication workflow feature is not enabled.",
            Self::PatientDenied => "Current access to this patient is required.",
            Self::WardDenied => "Current ward authority is required.",
            Self::ContextChanged => "The medication care context changed.",
        })
    }
}
impl std::error::Error for MedicationAccessError {}
pub(crate) fn bound(actor: &MedicationActor, facility: Uuid, user: Uuid) -> anyhow::Result<()> {
    if actor.identity.facility_id != facility || actor.identity.user_id != user {
        return Err(MedicationAccessError::AuthorityExpired.into());
    }
    Ok(())
}

/// Source-bearing writers lock the prescription before this shared proof.
/// Read-only identity locks remain compatible with other clinical read proofs.
pub(crate) async fn verify(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut MedicationActor,
    features: &[FeatureKey],
) -> anyhow::Result<()> {
    if actor.identity.authorization.is_none() {
        return Err(MedicationAccessError::AuthorityExpired.into());
    }
    prescription_courses::verify_identity_actor(tx, &mut actor.identity)
        .await
        .map_err(|error| {
            if error.is::<PrescriptionCourseError>() {
                MedicationAccessError::AuthorityExpired.into()
            } else {
                error
            }
        })?;
    network_policy(tx, actor).await?;
    let profile = actor
        .identity
        .authorization
        .as_ref()
        .ok_or(MedicationAccessError::AuthorityExpired)?
        .active_profile;
    require_current_features_tx(tx, actor.identity.facility_id, profile, features).await?;
    deadline(tx, actor).await
}

/// The caller retains its facility/identity proof while checking the exact
/// workflow's features. No Nursing or other purpose is inferred here.
pub(crate) async fn require_current_features_tx(
    tx: &mut Transaction<'_, Postgres>,
    facility: Uuid,
    profile: hms_domain::deployment::DeploymentProfile,
    features: &[FeatureKey],
) -> anyhow::Result<()> {
    let keys = features
        .iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let overrides: Vec<(String, bool)> = hms_observability::observe_db_query("clinical.medication.proof", sqlx::query_as("SELECT feature_key,enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key=ANY($2)")
        .bind(facility).bind(keys).fetch_all(&mut **tx)).await?;
    let defaults = hms_domain::capabilities::feature_flags_for_profile(profile);
    for feature in features {
        let key = codec::encode(*feature)?;
        if !overrides
            .iter()
            .find(|(name, _)| name == &key)
            .map(|(_, on)| *on)
            .unwrap_or_else(|| defaults.get(feature).copied().unwrap_or(false))
        {
            return Err(MedicationAccessError::FeatureDisabled.into());
        }
    }
    Ok(())
}

/// Lock the exact policy used by request resolution through final publication.
/// Version zero may be absent, so create only its unchanged readonly sentinel.
/// Configured requests never write policy metadata during their proof.
async fn network_policy(
    tx: &mut Transaction<'_, Postgres>,
    actor: &MedicationActor,
) -> anyhow::Result<()> {
    let expected = actor
        .resolved_network_policy_version
        .filter(|value| *value >= 0)
        .ok_or(crate::network::NetworkPublicationError::MissingProof)?;
    crate::network::require_publication_tx(tx, actor.identity.facility_id, expected).await
}
pub(crate) async fn deadline(
    tx: &mut Transaction<'_, Postgres>,
    actor: &MedicationActor,
) -> anyhow::Result<()> {
    if actor.identity.authorization.is_none() {
        return Err(MedicationAccessError::AuthorityExpired.into());
    }
    prescription_courses::check_authorization(tx, &actor.identity)
        .await
        .map_err(|e| {
            if e.is::<PrescriptionCourseError>() {
                MedicationAccessError::AuthorityExpired.into()
            } else {
                e
            }
        })
}

/// Central pharmacy purpose requires a real local patient tuple, but does not
/// invent a bedside assignment or an authored-note relationship for pharmacists.
pub(crate) async fn local_patient(
    tx: &mut Transaction<'_, Postgres>,
    actor: &MedicationActor,
    patient: Uuid,
) -> anyhow::Result<()> {
    let found: Option<Uuid> = hms_observability::observe_db_query(
        "clinical.medication.proof",
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE")
            .bind(actor.identity.facility_id)
            .bind(patient)
            .fetch_optional(&mut **tx),
    )
    .await?;
    if found.is_none() {
        return Err(MedicationAccessError::PatientDenied.into());
    }
    deadline(tx, actor).await
}

/// Ordinary Chronicle relationship. Break-glass Summary alone cannot grant rich MAR.
pub(crate) async fn patient(
    tx: &mut Transaction<'_, Postgres>,
    actor: &MedicationActor,
    patient: Uuid,
) -> anyhow::Result<()> {
    let state: Option<(String,String)> = hms_observability::observe_db_query("clinical.medication.proof", sqlx::query_as("SELECT record_status,vital_status FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE")
        .bind(actor.identity.facility_id).bind(patient).fetch_optional(&mut **tx)).await?;
    if !matches!(state, Some((ref record, ref vital)) if record == "registered" && vital != "deceased")
    {
        return Err(MedicationAccessError::PatientDenied.into());
    }
    let context: Option<Uuid> = hms_observability::observe_db_query("clinical.medication.proof", sqlx::query_scalar("SELECT id FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE")
        .bind(actor.identity.facility_id).bind(actor.identity.user_id).bind(patient).fetch_optional(&mut **tx)).await?;
    if context.is_none() {
        let note: Option<Uuid> = hms_observability::observe_db_query("clinical.medication.proof", sqlx::query_scalar("SELECT id FROM clinical_notes WHERE facility_id=$1 AND created_by_user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE")
            .bind(actor.identity.facility_id).bind(actor.identity.user_id).bind(patient).fetch_optional(&mut **tx)).await?;
        if note.is_none() {
            return Err(MedicationAccessError::PatientDenied.into());
        }
    }
    deadline(tx, actor).await
}
pub(crate) async fn wards(
    tx: &mut Transaction<'_, Postgres>,
    actor: &MedicationActor,
) -> anyhow::Result<Option<Vec<Uuid>>> {
    if actor.can_view_all_wards {
        return Ok(None);
    }
    let rows = hms_observability::observe_db_query("clinical.medication.proof", sqlx::query_scalar("SELECT a.ward_id FROM ward_staff_assignments a JOIN practitioner_profiles pp ON pp.id=a.practitioner_profile_id AND pp.facility_id=a.facility_id JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND u.id=$2 AND a.is_active AND u.is_active ORDER BY a.id FOR SHARE OF a,pp,s")
        .bind(actor.identity.facility_id).bind(actor.identity.user_id).fetch_all(&mut **tx)).await?;
    deadline(tx, actor).await?;
    Ok(Some(rows))
}
pub(crate) async fn admission(
    tx: &mut Transaction<'_, Postgres>,
    actor: &MedicationActor,
    wards: &Option<Vec<Uuid>>,
    admission: Uuid,
    patient: Uuid,
    active: bool,
) -> anyhow::Result<Uuid> {
    let row: Option<(Uuid,String)> = hms_observability::observe_db_query("clinical.medication.proof", sqlx::query_as("SELECT a.ward_id,a.status FROM admission_cases a JOIN patients p ON p.id=a.patient_id AND p.facility_id=a.facility_id JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.id=$2 AND a.patient_id=$3 AND (NOT $4 OR w.status='active') FOR SHARE OF a,p,w")
        .bind(actor.identity.facility_id).bind(admission).bind(patient).bind(active).fetch_optional(&mut **tx)).await?;
    let (ward, status) = row.ok_or(MedicationAccessError::ContextChanged)?;
    if active && !matches!(status.as_str(), "admitted" | "discharge_pending") {
        return Err(MedicationAccessError::ContextChanged.into());
    }
    if wards.as_ref().is_some_and(|ids| !ids.contains(&ward)) {
        return Err(MedicationAccessError::WardDenied.into());
    }
    deadline(tx, actor).await?;
    Ok(ward)
}

/// Caller supplies a static SQL column, never request text. Every candidate is
/// scoped before LIMIT; no per-row authorization follow-up can truncate a page.
pub(crate) fn ordinary_patient_predicate(
    q: &mut sqlx::QueryBuilder<'_, Postgres>,
    actor: &MedicationActor,
    patient_column: &'static str,
) {
    q.push(" AND EXISTS(SELECT 1 FROM patients access_patient WHERE access_patient.id=").push(patient_column)
        .push(" AND access_patient.facility_id=").push_bind(actor.identity.facility_id)
        .push(" AND access_patient.record_status='registered' AND access_patient.vital_status<>'deceased') AND (EXISTS(SELECT 1 FROM patient_contexts pc WHERE pc.facility_id=")
        .push_bind(actor.identity.facility_id).push(" AND pc.user_id=").push_bind(actor.identity.user_id)
        .push(" AND pc.patient_id=").push(patient_column)
        .push(") OR EXISTS(SELECT 1 FROM clinical_notes access_note WHERE access_note.facility_id=").push_bind(actor.identity.facility_id)
        .push(" AND access_note.created_by_user_id=").push_bind(actor.identity.user_id)
        .push(" AND access_note.patient_id=").push(patient_column).push("))");
}
