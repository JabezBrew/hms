use super::*;
use crate::clinical::{
    medication_access,
    prescription_courses::{self, PrescriptionActor},
};
use hms_domain::deployment::FeatureKey;
pub(super) struct Scope {
    pub can_issue: bool,
    pub can_document: bool,
    pub can_override: bool,
    pub practitioner: Option<Uuid>,
}
pub(super) struct Patient {
    pub record_status: String,
    pub vital_status: String,
    pub identity: ReferralConsultationPatient,
    pub chronicle_reachable: bool,
}
pub(super) async fn deadline(tx: &mut Tx<'_>, a: &ConsultationActor) -> anyhow::Result<()> {
    let valid: bool = observe_db_query(
        "referrals.consultation.proof.deadline",
        sqlx::query_scalar("SELECT clock_timestamp()<$1")
            .bind(a.authorization.valid_until)
            .fetch_one(&mut **tx),
    )
    .await?;
    if !valid {
        return Err(ConsultationError::Unavailable.into());
    }
    Ok(())
}
pub(super) async fn authority(tx: &mut Tx<'_>, a: &mut ConsultationActor) -> anyhow::Result<Scope> {
    let mut identity = PrescriptionActor {
        facility_id: a.facility_id,
        user_id: a.user_id,
        request_id: a.request_id.clone(),
        authorization: Some(a.authorization.clone()),
    };
    prescription_courses::verify_actor(tx, &mut identity).await?;
    a.authorization = identity
        .authorization
        .ok_or(ConsultationError::Unavailable)?;
    medication_access::require_current_features_tx(
        tx,
        a.facility_id,
        a.authorization.active_profile,
        &[
            FeatureKey::Patients,
            FeatureKey::Referrals,
            FeatureKey::Encounters,
        ],
    )
    .await?;
    let (read,manage,update,document,boundary):(bool,bool,bool,bool,Option<DateTime<Utc>>)=observe_db_query("referrals.consultation.proof.permissions",sqlx::query_as(r#"
 WITH point AS MATERIALIZED(SELECT clock_timestamp() at), effective AS(
 SELECT permission_code FROM user_permissions WHERE user_id=$2
 UNION SELECT permission_code FROM permission_assignments p CROSS JOIN point n WHERE p.facility_id=$1 AND p.grantee_user_id=$2 AND p.scope_type='facility' AND p.scope_id IS NULL AND p.status='active' AND p.starts_at<=n.at AND(p.ends_at IS NULL OR p.ends_at>n.at)
 UNION SELECT permission_code FROM delegations d CROSS JOIN point n WHERE d.facility_id=$1 AND d.delegate_user_id=$2 AND d.status='active' AND d.starts_at<=n.at AND(d.ends_at IS NULL OR d.ends_at>n.at))
 SELECT (SELECT count(*) FROM effective WHERE permission_code IN('encounter.view','patient.demographics.view'))=2
 AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
 AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='full_clinical')
 AND (SELECT count(*) FROM user_features WHERE user_id=$2 AND feature_key IN('patients','referrals','encounters'))=3,
 (SELECT count(*) FROM effective WHERE permission_code IN('encounter.manage','referral.manage'))=2,
 EXISTS(SELECT 1 FROM effective WHERE permission_code='patient.update'),
 EXISTS(SELECT 1 FROM effective WHERE permission_code='clinical_documentation.view'),
 (SELECT min(boundary) FROM user_authority_boundaries b CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
 "#).bind(a.facility_id).bind(a.user_id).fetch_one(&mut **tx)).await?;
    if !read {
        return Err(ConsultationError::Unavailable.into());
    }
    if let Some(at) = boundary {
        a.authorization.valid_until = a.authorization.valid_until.min(at)
    }
    let practitioner:Option<Uuid>=observe_db_query("referrals.consultation.proof.practitioner",sqlx::query_scalar("SELECT p.id FROM practitioner_profiles p JOIN staff_profiles s ON s.id=p.staff_id AND s.facility_id=p.facility_id WHERE p.facility_id=$1 AND s.user_id=$2 ORDER BY p.id LIMIT 1 FOR SHARE OF p,s NOWAIT").bind(a.facility_id).bind(a.user_id).fetch_optional(&mut **tx)).await.map_err(lock_error)?;
    deadline(tx, a).await?;
    Ok(Scope {
        can_issue: manage && practitioner.is_some(),
        can_document: document,
        can_override: update,
        practitioner,
    })
}
pub(super) async fn patient(
    tx: &mut Tx<'_>,
    a: &ConsultationActor,
    r: &Root,
) -> anyhow::Result<Patient> {
    let p:Option<(String,String,String,String,String)>=observe_db_query("referrals.consultation.proof.patient",sqlx::query_as("SELECT record_status,vital_status,first_name,last_name,patient_code FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE NOWAIT").bind(a.facility_id).bind(r.patient_id).fetch_optional(&mut **tx)).await.map_err(lock_error)?;
    let (record_status, vital_status, first_name, last_name, patient_code) =
        p.ok_or(ConsultationError::NotFound)?;
    let root_actor =
        r.created_by_user_id == Some(a.user_id) || r.accepted_by_user_id == Some(a.user_id);
    let current_root_purpose = root_actor && matches!(r.status.as_str(), "accepted" | "scheduled");
    // Retain mutable ordinary evidence until this read or command commits.
    // Immutable original authorship also supports historical Chronicle access.
    let (context, note, original, current_referral): (Option<Uuid>,Option<Uuid>,Option<Uuid>,Option<Uuid>) = observe_db_query(
        "referrals.consultation.proof.relationship",
        sqlx::query_as(r#"
        WITH evidence AS MATERIALIZED (SELECT
          (SELECT id FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2 AND user_id=$3 ORDER BY id LIMIT 1 FOR SHARE NOWAIT) AS context_id,
          (SELECT id FROM clinical_notes WHERE facility_id=$1 AND patient_id=$2 AND created_by_user_id=$3 ORDER BY id LIMIT 1 FOR SHARE NOWAIT) AS note_id,
          (SELECT id FROM referral_consultation_starts WHERE facility_id=$1 AND patient_id=$2 AND actor_user_id=$3 ORDER BY id LIMIT 1 FOR SHARE NOWAIT) AS original_id)
        SELECT context_id,note_id,original_id,
          CASE WHEN $4 AND context_id IS NULL AND note_id IS NULL AND original_id IS NULL THEN (SELECT id FROM referrals WHERE facility_id=$1 AND patient_id=$2 AND status IN('accepted','scheduled') AND (created_by_user_id=$3 OR accepted_by_user_id=$3) ORDER BY id LIMIT 1 FOR SHARE NOWAIT) END FROM evidence
        "#).bind(a.facility_id).bind(r.patient_id).bind(a.user_id)
            .bind(record_status == "registered" && vital_status != "deceased" && !current_root_purpose).fetch_one(&mut **tx),
    ).await.map_err(lock_error)?;
    let ordinary = context.is_some() || note.is_some();
    if !root_actor && !ordinary && original.is_none() {
        return Err(ConsultationError::Unavailable.into());
    }
    let chronicle_reachable = original.is_some()
        || (record_status == "registered"
            && vital_status != "deceased"
            && (ordinary || current_root_purpose || current_referral.is_some()));
    deadline(tx, a).await?;
    Ok(Patient {
        record_status,
        vital_status,
        identity: ReferralConsultationPatient {
            id: r.patient_id,
            display_name: format!("{first_name} {last_name}"),
            patient_code,
        },
        chronicle_reachable,
    })
}
