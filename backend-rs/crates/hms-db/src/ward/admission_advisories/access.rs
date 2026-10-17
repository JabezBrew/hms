use super::*;
use crate::clinical::prescription_courses::{self, PrescriptionActor};
use hms_domain::deployment::{DeploymentProfile, FeatureKey};
use std::collections::HashMap;

pub(super) async fn features(
    tx: &mut Tx<'_>,
    facility: Uuid,
    profile: DeploymentProfile,
    required: &[FeatureKey],
) -> anyhow::Result<()> {
    let keys = required
        .iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let overrides:HashMap<String,bool>=sqlx::query_as::<_,(String,bool)>("SELECT feature_key,enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key=ANY($2)").bind(facility).bind(keys).fetch_all(&mut **tx).await?.into_iter().collect();
    let defaults = hms_domain::capabilities::feature_flags_for_profile(profile);
    if required.iter().any(|key| {
        !overrides
            .get(&codec::encode(key).unwrap_or_default())
            .copied()
            .unwrap_or_else(|| defaults.get(key).copied().unwrap_or(false))
    }) {
        return Err(AdvisoryError::FeatureDisabled.into());
    }
    Ok(())
}
pub(super) async fn verify(tx: &mut Tx<'_>, actor: &mut AdvisoryActor) -> anyhow::Result<()> {
    let mut proof = PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: actor.request_id.clone(),
        authorization: Some(actor.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut proof).await?;
    actor.authorization = proof.authorization.ok_or(AdvisoryError::AuthorityExpired)?;
    features(
        tx,
        actor.facility_id,
        actor.authorization.active_profile,
        &[
            FeatureKey::Patients,
            FeatureKey::Encounters,
            FeatureKey::Admissions,
        ],
    )
    .await?;
    deadline(tx, actor).await
}
pub(super) async fn deadline(tx: &mut Tx<'_>, actor: &AdvisoryActor) -> anyhow::Result<()> {
    deadline_at(tx, actor.authorization.valid_until).await
}
pub(super) async fn deadline_at(tx: &mut Tx<'_>, at: DateTime<Utc>) -> anyhow::Result<()> {
    let current: bool = sqlx::query_scalar("SELECT clock_timestamp()<$1")
        .bind(at)
        .fetch_one(&mut **tx)
        .await?;
    if !current {
        return Err(AdvisoryError::AuthorityExpired.into());
    }
    Ok(())
}
/// Normal Chronicle relationship only. Emergency Summary access cannot grant this rich workflow.
pub(super) async fn patient(
    tx: &mut Tx<'_>,
    actor: &AdvisoryActor,
    patient: Uuid,
) -> anyhow::Result<()> {
    let state: Option<(String, String)> = sqlx::query_as(
        "SELECT record_status,vital_status FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(patient)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((record, vital)) = state else {
        return Err(AdvisoryError::NotFound.into());
    };
    if record != "registered" || vital == "deceased" {
        return Err(AdvisoryError::PatientDenied.into());
    }
    let context:Option<Uuid>=sqlx::query_scalar("SELECT id FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE").bind(actor.facility_id).bind(actor.user_id).bind(patient).fetch_optional(&mut **tx).await?;
    if context.is_none() {
        let authored:Option<Uuid>=sqlx::query_scalar("SELECT id FROM clinical_notes WHERE facility_id=$1 AND created_by_user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE").bind(actor.facility_id).bind(actor.user_id).bind(patient).fetch_optional(&mut **tx).await?;
        if authored.is_none() {
            return Err(AdvisoryError::PatientDenied.into());
        }
    }
    deadline(tx, actor).await
}
pub(super) async fn wards(
    tx: &mut Tx<'_>,
    actor: &AdvisoryActor,
) -> anyhow::Result<Option<Vec<Uuid>>> {
    if actor.can_view_all_wards {
        return Ok(None);
    }
    let rows=sqlx::query_scalar("SELECT a.ward_id FROM ward_staff_assignments a JOIN practitioner_profiles pp ON pp.id=a.practitioner_profile_id AND pp.facility_id=a.facility_id JOIN staff_profiles s ON s.id=pp.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND u.id=$2 AND a.is_active AND u.is_active ORDER BY a.id FOR SHARE OF a,pp,s")
        .bind(actor.facility_id).bind(actor.user_id).fetch_all(&mut **tx).await?;
    deadline(tx, actor).await?;
    Ok(Some(rows))
}
pub(super) async fn ward(tx: &mut Tx<'_>, actor: &AdvisoryActor, id: Uuid) -> anyhow::Result<()> {
    if wards(tx, actor)
        .await?
        .is_some_and(|wards| !wards.contains(&id))
    {
        return Err(AdvisoryError::WardDenied.into());
    }
    Ok(())
}

pub(crate) async fn verify_closure(
    tx: &mut Tx<'_>,
    actor: &mut AdmissionClosureActor,
) -> anyhow::Result<()> {
    let mut proof = PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: actor.request_id.clone(),
        authorization: Some(actor.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut proof).await?;
    actor.authorization = proof.authorization.ok_or(AdvisoryError::AuthorityExpired)?;
    features(
        tx,
        actor.facility_id,
        actor.authorization.active_profile,
        &[FeatureKey::Patients, FeatureKey::Admissions],
    )
    .await?;
    deadline_at(tx, actor.authorization.valid_until).await
}
