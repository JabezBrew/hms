//! Additional ordinary evidence for the Patient Chronicle read loader only.
//! This does not change global patient-access facts or any clinical writer.
use super::{access, lock_error, ConsultationActor, ConsultationError};
use crate::clinical::{medication_access, prescription_courses};
use crate::{codec, PgPool};
use chrono::{DateTime, Utc};
use hms_domain::deployment::{FeatureKey, PermissionCode};
use hms_observability::observe_db_query;
use uuid::Uuid;

/// A registered living patient may be reviewed by the actual creating or
/// accepting actor of a current accepted/scheduled referral. An immutable
/// original consultation-start actor retains historical read evidence after a
/// later referral outcome or patient vital/status change. Both purposes require
/// current Full, demographics and actual documentation/encounter read authority.
pub async fn ordinary_evidence(
    pool: &PgPool,
    mut actor: ConsultationActor,
    patient_id: Uuid,
) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;
    let mut identity = prescription_courses::PrescriptionActor {
        facility_id: actor.facility_id,
        user_id: actor.user_id,
        request_id: actor.request_id.clone(),
        authorization: Some(actor.authorization.clone()),
    };
    prescription_courses::verify_actor(&mut tx, &mut identity).await?;
    actor.authorization = identity
        .authorization
        .ok_or(ConsultationError::Unavailable)?;
    medication_access::require_current_features_tx(
        &mut tx,
        actor.facility_id,
        actor.authorization.active_profile,
        &[
            FeatureKey::Patients,
            FeatureKey::Referrals,
            FeatureKey::Encounters,
        ],
    )
    .await?;
    let required = [
        PermissionCode::PatientDemographicsView,
        PermissionCode::EncounterView,
        PermissionCode::ClinicalDocumentationView,
    ]
    .into_iter()
    .map(codec::encode)
    .collect::<anyhow::Result<Vec<_>>>()?;
    let (allowed,boundary):(bool,Option<DateTime<Utc>>)=observe_db_query("referrals.consultation.chronicle.authority",sqlx::query_as(r#"
        WITH point AS MATERIALIZED(SELECT clock_timestamp() AS at), effective AS(
          SELECT permission_code FROM user_permissions WHERE user_id=$2
          UNION SELECT p.permission_code FROM permission_assignments p CROSS JOIN point n
            WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility'
              AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at
              AND(p.ends_at IS NULL OR p.ends_at>n.at)
          UNION SELECT d.permission_code FROM delegations d CROSS JOIN point n
            WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active'
              AND d.starts_at<=n.at AND(d.ends_at IS NULL OR d.ends_at>n.at))
        SELECT NOT EXISTS(SELECT 1 FROM unnest($3::text[]) required(code)
            WHERE NOT EXISTS(SELECT 1 FROM effective e WHERE e.permission_code=required.code))
          AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='full_clinical')
          AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
          AND(SELECT count(*) FROM user_features WHERE user_id=$2 AND feature_key IN('patients','referrals','encounters'))=3,
          (SELECT min(boundary) FROM user_authority_boundaries b
            CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n
            WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
        "#).bind(actor.facility_id).bind(actor.user_id).bind(required).fetch_one(&mut *tx)).await?;
    if !allowed {
        return Err(ConsultationError::Unavailable.into());
    }
    if let Some(boundary) = boundary {
        actor.authorization.valid_until = actor.authorization.valid_until.min(boundary);
    }
    access::deadline(&mut tx, &actor).await?;
    let patient:Option<(String,String)>=observe_db_query("referrals.consultation.chronicle.patient",sqlx::query_as(
        "SELECT record_status,vital_status FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE NOWAIT",
    ).bind(actor.facility_id).bind(patient_id).fetch_optional(&mut *tx)).await.map_err(lock_error)?;
    let Some((record_status, vital_status)) = patient else {
        return Ok(false);
    };
    let prior:Option<Uuid>=observe_db_query("referrals.consultation.chronicle.original_actor",sqlx::query_scalar(
        "SELECT id FROM referral_consultation_starts WHERE facility_id=$1 AND patient_id=$2 AND actor_user_id=$3 ORDER BY id LIMIT 1 FOR SHARE NOWAIT",
    ).bind(actor.facility_id).bind(patient_id).bind(actor.user_id).fetch_optional(&mut *tx)).await.map_err(lock_error)?;
    let eligible = if prior.is_some() {
        true
    } else if record_status == "registered" && vital_status != "deceased" {
        let referral:Option<Uuid>=observe_db_query("referrals.consultation.chronicle.current_actor",sqlx::query_scalar(
            "SELECT id FROM referrals WHERE facility_id=$1 AND patient_id=$2 AND status IN('accepted','scheduled') AND (created_by_user_id=$3 OR accepted_by_user_id=$3) ORDER BY id LIMIT 1 FOR SHARE NOWAIT",
        ).bind(actor.facility_id).bind(patient_id).bind(actor.user_id).fetch_optional(&mut *tx)).await.map_err(lock_error)?;
        referral.is_some()
    } else {
        false
    };
    access::deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(eligible)
}
