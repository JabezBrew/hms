use super::*;
use crate::clinical::prescription_courses::{self as clinical_access, PrescriptionActor};
use hms_domain::deployment::FeatureKey;
use std::collections::HashMap;

pub(super) async fn prelock_targets(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    inputs: &[WardRoundDraftActionInput],
) -> anyhow::Result<()> {
    // Normalized aggregate commands contain at most 100 reviewed actions.
    let targets = inputs
        .iter()
        .filter_map(|input| match input {
            WardRoundDraftActionInput::NursingTask(task) => task.assigned_to_user_id,
            _ => None,
        })
        .collect::<Vec<_>>();
    crate::network::prelock_publication_users_tx(tx, actor.facility_id, actor.user_id, &targets)
        .await
}

pub(super) async fn verify(tx: &mut Tx<'_>, actor: &mut WardRoundActor) -> anyhow::Result<()> {
    let mut proof = PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: actor.request_id.clone(),
        authorization: Some(actor.authorization.clone()),
    };
    clinical_access::verify_actor(tx, &mut proof).await?;
    actor.authorization = proof
        .authorization
        .ok_or(WardRoundError::AuthorityExpired)?;
    features(tx, actor, &[FeatureKey::Patients, FeatureKey::Encounters]).await?;
    deadline(tx, actor).await
}

pub(super) async fn features(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    required: &[FeatureKey],
) -> anyhow::Result<()> {
    let keys = required
        .iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let overrides: HashMap<String, bool> = sqlx::query_as::<_, (String,bool)>(
        "SELECT feature_key,enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key=ANY($2)")
        .bind(actor.facility_id).bind(keys).fetch_all(&mut **tx).await?.into_iter().collect();
    let defaults =
        hms_domain::capabilities::feature_flags_for_profile(actor.authorization.active_profile);
    for feature in required {
        if !overrides
            .get(&codec::encode(feature)?)
            .copied()
            .unwrap_or(defaults.get(feature).copied().unwrap_or(false))
        {
            return Err(WardRoundError::FeatureDisabled.into());
        }
    }
    Ok(())
}

pub(super) async fn deadline(tx: &mut Tx<'_>, actor: &WardRoundActor) -> anyhow::Result<()> {
    let valid: bool = sqlx::query_scalar("SELECT clock_timestamp()<$1")
        .bind(actor.authorization.valid_until)
        .fetch_one(&mut **tx)
        .await?;
    if !valid {
        return Err(WardRoundError::AuthorityExpired.into());
    }
    Ok(())
}

/// Mirrors the existing Chronicle relationship sources, under the protected transaction.
/// A locked source cannot be removed while the protected result is being committed.
pub(super) async fn patient(
    tx: &mut Tx<'_>,
    actor: &mut WardRoundActor,
    patient: Uuid,
) -> anyhow::Result<()> {
    let state: Option<(String, String)> = sqlx::query_as(
        "SELECT record_status,vital_status FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE",
    )
    .bind(actor.facility_id)
    .bind(patient)
    .fetch_optional(&mut **tx)
    .await?;
    let state = state.ok_or(WardRoundError::NotFound)?;
    if state.0 == "registered" && state.1 != "deceased" {
        let context: Option<Uuid> = sqlx::query_scalar("SELECT id FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE")
            .bind(actor.facility_id).bind(actor.user_id).bind(patient).fetch_optional(&mut **tx).await?;
        if context.is_some() {
            return deadline(tx, actor).await;
        }
        let note: Option<Uuid> = sqlx::query_scalar("SELECT id FROM clinical_notes WHERE facility_id=$1 AND created_by_user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE")
            .bind(actor.facility_id).bind(actor.user_id).bind(patient).fetch_optional(&mut **tx).await?;
        if note.is_some() {
            return deadline(tx, actor).await;
        }
    }
    let grant: Option<DateTime<Utc>> = sqlx::query_scalar("SELECT expires_at FROM patient_break_glass_grants WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3 AND ended_at IS NULL AND started_at<=clock_timestamp() AND expires_at>clock_timestamp() ORDER BY expires_at DESC,id DESC LIMIT 1 FOR SHARE")
        .bind(actor.facility_id).bind(actor.user_id).bind(patient).fetch_optional(&mut **tx).await?;
    actor.authorization.valid_until = actor
        .authorization
        .valid_until
        .min(grant.ok_or(WardRoundError::PatientDenied)?);
    deadline(tx, actor).await
}

pub(super) fn nursing_actor(actor: &WardRoundActor) -> crate::ward::nursing_access::NursingActor {
    crate::ward::nursing_access::NursingActor {
        resolved_network_policy_version: actor.authorization.resolved_network_policy_version,
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        session_id: actor.authorization.session_id,
        session_version: actor.authorization.session_version,
        permission_version: actor.authorization.permission_version,
        active_profile: actor.authorization.active_profile,
        valid_until: actor.authorization.valid_until,
        can_view_all_wards: actor.can_view_all_wards,
        request_id: actor.request_id.clone(),
    }
}

pub(super) async fn actions(
    tx: &mut Tx<'_>,
    actor: &mut WardRoundActor,
    patient: Uuid,
    admission: &super::super::AdmissionScopeRow,
    inputs: &[WardRoundDraftActionInput],
) -> anyhow::Result<()> {
    if !actor.can_write {
        return Err(WardRoundError::PermissionDenied.into());
    }
    let mut required = Vec::new();
    let mut nursing = false;
    for input in inputs {
        let allowed = match input {
            WardRoundDraftActionInput::Prescription(_) => actor.can_prescribe,
            WardRoundDraftActionInput::LabOrder(_) => {
                required.push(FeatureKey::Laboratory);
                actor.can_order_labs
            }
            WardRoundDraftActionInput::NursingTask(_) => {
                required.push(FeatureKey::Nursing);
                nursing = true;
                actor.can_create_nursing_task
            }
            WardRoundDraftActionInput::DischargeRequest(_) => {
                required.push(FeatureKey::Admissions);
                actor.can_request_discharge
            }
        };
        if !allowed {
            return Err(WardRoundError::PermissionDenied.into());
        }
    }
    required.sort_by_key(|key| codec::encode(key).unwrap_or_default());
    required.dedup();
    features(tx, actor, &required).await?;
    if nursing {
        let mut nurse = nursing_actor(actor);
        let wards = crate::ward::nursing_access::verify(tx, &mut nurse).await?;
        crate::ward::nursing_access::ward(&wards, admission.ward_id)?;
        // Admission itself is already locked and revalidated by this command.
        for input in inputs {
            if let WardRoundDraftActionInput::NursingTask(task) = input {
                if let Some(id) = task.assigned_to_user_id {
                    crate::ward::nursing_access::assignee(
                        tx,
                        actor.facility_id,
                        admission.ward_id,
                        id,
                    )
                    .await?;
                }
            }
        }
        actor.authorization.valid_until = actor.authorization.valid_until.min(nurse.valid_until);
    }
    let _ = patient;
    deadline(tx, actor).await
}

pub(super) async fn audit(
    tx: &mut Tx<'_>,
    actor: &WardRoundActor,
    id: Uuid,
    event: &str,
    version: i64,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,request_id,event_type,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,'ward_round',$6,jsonb_build_object('version',$7::bigint))")
        .bind(Uuid::new_v4()).bind(actor.facility_id).bind(actor.user_id).bind(&actor.request_id).bind(event).bind(id).bind(version).execute(&mut **tx).await?;
    deadline(tx, actor).await
}
