use super::*;
use crate::clinical::{
    medication_access,
    prescription_courses::{self, PrescriptionActor},
};
use hms_domain::deployment::{FeatureKey, PermissionCode};
pub(super) async fn deadline(tx: &mut Tx<'_>, actor: &ReferralResponseActor) -> anyhow::Result<()> {
    let valid: bool = hms_observability::observe_db_query(
        "referrals.response.proof.deadline",
        sqlx::query_scalar("SELECT clock_timestamp()<$1")
            .bind(actor.authorization.valid_until)
            .fetch_one(&mut **tx),
    )
    .await?;
    if !valid {
        return Err(ResponseError::Unavailable.into());
    }
    Ok(())
}
pub(super) async fn authority(
    tx: &mut Tx<'_>,
    actor: &mut ReferralResponseActor,
    full: bool,
    booking: bool,
) -> anyhow::Result<()> {
    let mut proof = PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: actor.request_id.clone(),
        authorization: Some(actor.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut proof).await?;
    actor.authorization = proof.authorization.ok_or(ResponseError::Unavailable)?;
    let mut features = vec![FeatureKey::Patients, FeatureKey::Referrals];
    if booking {
        features.push(FeatureKey::Appointments)
    }
    medication_access::require_current_features_tx(
        tx,
        actor.facility_id,
        actor.authorization.active_profile,
        &features,
    )
    .await?;
    let mut permissions = vec![
        PermissionCode::PatientDemographicsView,
        PermissionCode::ReferralManage,
    ];
    if booking {
        permissions.push(PermissionCode::AppointmentManage)
    }
    let permissions = permissions
        .into_iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let feature_names = features
        .into_iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    let (allowed,boundary):(bool,Option<DateTime<Utc>>)=hms_observability::observe_db_query("referrals.response.proof.permissions", sqlx::query_as(r#"
 WITH point AS MATERIALIZED(SELECT clock_timestamp() AS at)
 SELECT NOT EXISTS(SELECT 1 FROM unnest($3::text[]) required(permission_code) CROSS JOIN point n WHERE NOT(
 EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=$2 AND p.permission_code=required.permission_code)
 OR EXISTS(SELECT 1 FROM permission_assignments p WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.permission_code=required.permission_code AND p.scope_type='facility' AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at AND (p.ends_at IS NULL OR p.ends_at>n.at))
 OR EXISTS(SELECT 1 FROM delegations d WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.permission_code=required.permission_code AND d.status='active' AND d.starts_at<=n.at AND (d.ends_at IS NULL OR d.ends_at>n.at))))
 AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
 AND (NOT $5 OR EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='full_clinical'))
 AND (SELECT count(*) FROM user_features WHERE user_id=$2 AND feature_key=ANY($4))=cardinality($4),
 (SELECT min(boundary) FROM user_authority_boundaries b CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
 "#).bind(actor.facility_id).bind(actor.user_id).bind(permissions).bind(feature_names).bind(full).fetch_one(&mut **tx)).await?;
    if !allowed {
        return Err(ResponseError::Unavailable.into());
    }
    if let Some(at) = boundary {
        actor.authorization.valid_until = actor.authorization.valid_until.min(at)
    }
    deadline(tx, actor).await
}
pub(super) async fn patient(
    tx: &mut Tx<'_>,
    actor: &ReferralResponseActor,
    r: &Root,
    ordinary: bool,
) -> anyhow::Result<()> {
    let found: Option<Uuid> = hms_observability::observe_db_query(
        "referrals.response.proof.patient",
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE")
            .bind(actor.facility_id)
            .bind(r.patient_id)
            .fetch_optional(&mut **tx),
    )
    .await?;
    if found.is_none() {
        return Err(ResponseError::NotFound.into());
    }
    // Historical documentation does not require a current encounter, registration
    // state or vital status. Actual care/actor edges supply this purpose's scope.
    if ordinary
        && r.created_by_user_id != Some(actor.user_id)
        && r.accepted_by_user_id != Some(actor.user_id)
    {
        let context:Option<Uuid>=hms_observability::observe_db_query("referrals.response.proof.context", sqlx::query_scalar("SELECT id FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE").bind(actor.facility_id).bind(actor.user_id).bind(r.patient_id).fetch_optional(&mut **tx)).await?;
        if context.is_none() {
            let authored:Option<Uuid>=hms_observability::observe_db_query("referrals.response.proof.authored_note", sqlx::query_scalar("SELECT id FROM clinical_notes WHERE facility_id=$1 AND created_by_user_id=$2 AND patient_id=$3 ORDER BY id LIMIT 1 FOR SHARE").bind(actor.facility_id).bind(actor.user_id).bind(r.patient_id).fetch_optional(&mut **tx)).await?;
            if authored.is_none() {
                return Err(ResponseError::Unavailable.into());
            }
        }
    }
    deadline(tx, actor).await
}
