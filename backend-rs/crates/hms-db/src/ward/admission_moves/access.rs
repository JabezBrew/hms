use super::*;
use crate::clinical::{
    medication_access,
    prescription_courses::{self, PrescriptionActor},
};
use hms_domain::deployment::{FeatureKey, PermissionCode};
pub(super) struct Scope {
    pub wards: Option<Vec<Uuid>>,
    pub can_route_tasks: bool,
}
pub(super) async fn deadline(tx: &mut Tx<'_>, actor: &AdmissionMoveActor) -> anyhow::Result<()> {
    let valid: bool = observe_db_query(
        "ward.moves.proof.deadline",
        sqlx::query_scalar("SELECT clock_timestamp()<$1")
            .bind(actor.authorization.valid_until)
            .fetch_one(&mut **tx),
    )
    .await?;
    if !valid {
        return Err(MoveError::Unavailable.into());
    }
    Ok(())
}
// No source child lock precedes this retained facility/actor/session/network proof.
pub(super) async fn authority(
    tx: &mut Tx<'_>,
    actor: &mut AdmissionMoveActor,
) -> anyhow::Result<Scope> {
    let mut identity = PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: actor.request_id.clone(),
        authorization: Some(actor.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut identity).await?;
    actor.authorization = identity.authorization.ok_or(MoveError::Unavailable)?;
    medication_access::require_current_features_tx(
        tx,
        actor.facility_id,
        actor.authorization.active_profile,
        &[FeatureKey::Patients, FeatureKey::Admissions],
    )
    .await?;
    let required = [
        PermissionCode::AdmissionManage,
        PermissionCode::PatientDemographicsView,
    ]
    .into_iter()
    .map(codec::encode)
    .collect::<anyhow::Result<Vec<_>>>()?;
    let (allowed,all_wards,nursing_permission,boundary):(bool,bool,bool,Option<DateTime<Utc>>)=observe_db_query("ward.moves.proof.permissions",sqlx::query_as(r#"
 WITH point AS MATERIALIZED(SELECT clock_timestamp() at), effective AS(
 SELECT p.permission_code FROM user_permissions p WHERE p.user_id=$2
 UNION SELECT p.permission_code FROM permission_assignments p CROSS JOIN point n WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility' AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at AND (p.ends_at IS NULL OR p.ends_at>n.at)
 UNION SELECT d.permission_code FROM delegations d CROSS JOIN point n WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active' AND d.starts_at<=n.at AND (d.ends_at IS NULL OR d.ends_at>n.at))
 SELECT NOT EXISTS(SELECT 1 FROM unnest($3::text[]) r(code) WHERE NOT EXISTS(SELECT 1 FROM effective e WHERE e.permission_code=r.code))
 AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics') AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='full_clinical')
 AND (SELECT count(*) FROM user_features WHERE user_id=$2 AND feature_key IN('patients','admissions'))=2,
 EXISTS(SELECT 1 FROM effective WHERE permission_code='ward_board.view_all'),EXISTS(SELECT 1 FROM effective WHERE permission_code='nursing.task.manage'),
 (SELECT min(boundary) FROM user_authority_boundaries b CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
 "#).bind(actor.facility_id).bind(actor.user_id).bind(required).fetch_one(&mut **tx)).await?;
    if !allowed {
        return Err(MoveError::Unavailable.into());
    }
    if let Some(at) = boundary {
        actor.authorization.valid_until = actor.authorization.valid_until.min(at);
    }
    let default =
        hms_domain::capabilities::feature_flags_for_profile(actor.authorization.active_profile)
            .get(&FeatureKey::Nursing)
            .copied()
            .unwrap_or(false);
    let nursing:bool=observe_db_query("ward.moves.proof.nursing",sqlx::query_scalar("SELECT COALESCE((SELECT enabled FROM facility_feature_entitlements WHERE facility_id=$1 AND feature_key='nursing'),$3) AND EXISTS(SELECT 1 FROM user_features WHERE user_id=$2 AND feature_key='nursing')").bind(actor.facility_id).bind(actor.user_id).bind(default).fetch_one(&mut **tx)).await?;
    let wards = if all_wards {
        None
    } else {
        Some(observe_db_query("ward.moves.proof.wards",sqlx::query_scalar("SELECT a.ward_id FROM ward_staff_assignments a JOIN practitioner_profiles p ON p.id=a.practitioner_profile_id AND p.facility_id=a.facility_id JOIN staff_profiles s ON s.id=p.staff_id AND s.facility_id=a.facility_id JOIN users u ON u.id=s.user_id AND u.facility_id=a.facility_id WHERE a.facility_id=$1 AND u.id=$2 AND a.is_active AND u.is_active ORDER BY a.id FOR SHARE OF a,p,s").bind(actor.facility_id).bind(actor.user_id).fetch_all(&mut **tx)).await?)
    };
    deadline(tx, actor).await?;
    Ok(Scope {
        wards,
        can_route_tasks: nursing && nursing_permission,
    })
}
pub(super) fn ward(scope: &Scope, ward: Uuid) -> anyhow::Result<()> {
    if scope.wards.as_ref().is_some_and(|ids| !ids.contains(&ward)) {
        return Err(MoveError::Unavailable.into());
    }
    Ok(())
}
pub(super) async fn patient(
    tx: &mut Tx<'_>,
    actor: &AdmissionMoveActor,
    patient: Uuid,
) -> anyhow::Result<()> {
    let local: Option<Uuid> = observe_db_query(
        "ward.moves.proof.patient",
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE")
            .bind(actor.facility_id)
            .bind(patient)
            .fetch_optional(&mut **tx),
    )
    .await?;
    if local.is_none() {
        return Err(MoveError::NotFound.into());
    }
    let context:Option<Uuid>=observe_db_query("ward.moves.proof.context",sqlx::query_scalar("SELECT id FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE").bind(actor.facility_id).bind(actor.user_id).bind(patient).fetch_optional(&mut **tx)).await?;
    if context.is_none() {
        let note:Option<Uuid>=observe_db_query("ward.moves.proof.authored",sqlx::query_scalar("SELECT id FROM clinical_notes WHERE facility_id=$1 AND created_by_user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE").bind(actor.facility_id).bind(actor.user_id).bind(patient).fetch_optional(&mut **tx)).await?;
        if note.is_none() {
            return Err(MoveError::Unavailable.into());
        }
    }
    deadline(tx, actor).await
}

pub(super) async fn task_scope(
    tx: &mut Tx<'_>,
    actor: &AdmissionMoveActor,
    r: &Root,
) -> anyhow::Result<()> {
    let valid:bool=observe_db_query("ward.moves.tasks.scope",sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM nursing_tasks t LEFT JOIN wards origin ON origin.id=t.ward_id AND origin.facility_id=t.facility_id WHERE t.facility_id=$1 AND t.admission_case_id=$2 AND t.status='open' AND (t.patient_id<>$3 OR t.service_ward_id<>$4 OR origin.id IS NULL))").bind(actor.facility_id).bind(r.id).bind(r.patient_id).bind(r.ward_id).fetch_one(&mut **tx)).await?;
    if !valid {
        return Err(MoveError::SourceChanged.into());
    }
    Ok(())
}
