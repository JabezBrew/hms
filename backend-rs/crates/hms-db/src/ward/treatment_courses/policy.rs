use super::*;
use hms_domain::deployment::{FeatureKey, PermissionCode};

#[derive(Clone, Debug, FromRow)]
pub(super) struct ContextRow {
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub admission_status: String,
    pub current_ward_id: Uuid,
    pub current_ward_name: String,
    pub ward_active: bool,
    pub snapshot: sqlx::types::Json<Value>,
}
#[derive(Clone, Copy)]
pub(super) struct Authority {
    pub manage: bool,
}

pub(super) async fn identity(
    tx: &mut Tx<'_>,
    actor: &mut TreatmentActor,
) -> anyhow::Result<Authority> {
    access::verify(
        tx,
        actor,
        &[
            FeatureKey::Patients,
            FeatureKey::Encounters,
            FeatureKey::Nursing,
        ],
    )
    .await?;
    let (permissions,full): (Vec<String>, bool) = hms_observability::observe_db_query(
        "treatment_courses.proof.permissions",
        sqlx::query_as("SELECT ARRAY(SELECT permission_code FROM effective_user_permissions WHERE user_id=$1),EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$1 AND visibility='full_clinical')")
            .bind(actor.identity.user_id).fetch_one(&mut **tx)
    ).await?;
    let has = |permission| -> anyhow::Result<bool> {
        Ok(permissions.contains(&codec::encode(permission)?))
    };
    if !full || !has(PermissionCode::ClinicalDocumentationView)? {
        return Err(access::MedicationAccessError::PatientDenied.into());
    }
    actor.can_view_all_wards = has(PermissionCode::WardBoardViewAll)?
        || has(PermissionCode::AdminStaffManage)?
        || has(PermissionCode::AdminAuthorityManage)?;
    let manage = has(PermissionCode::ClinicalDocumentationManage)?;
    access::deadline(tx, actor).await?;
    Ok(Authority { manage })
}
pub(super) async fn context(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    patient: Uuid,
    admission: Uuid,
) -> anyhow::Result<ContextRow> {
    hms_observability::observe_db_query("treatment_courses.context.parent",sqlx::query_as(
        "SELECT a.patient_id,a.id AS admission_case_id,a.status AS admission_status,a.ward_id AS current_ward_id,w.name AS current_ward_name,w.status='active' AS ward_active,jsonb_build_object('id',a.id,'patient_id',a.patient_id,'ward_id',a.ward_id,'bed_id',a.bed_id,'encounter_id',a.encounter_id,'visit_id',a.visit_id,'status',a.status,'updated_at',a.updated_at,'ward_status',w.status) AS snapshot FROM admission_cases a JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.id=$2 AND a.patient_id=$3 FOR SHARE OF a,w")
        .bind(actor.identity.facility_id).bind(admission).bind(patient).fetch_optional(&mut **tx)
    ).await?.ok_or_else(|| TreatmentCourseError::NotFound.into())
}
pub(super) async fn relationship(
    tx: &mut Tx<'_>,
    actor: &TreatmentActor,
    context: &ContextRow,
) -> anyhow::Result<()> {
    access::patient(tx, actor, context.patient_id).await?;
    let wards = access::wards(tx, actor).await?;
    if wards
        .as_ref()
        .is_some_and(|ids| !ids.contains(&context.current_ward_id))
    {
        return Err(access::MedicationAccessError::WardDenied.into());
    }
    access::deadline(tx, actor).await
}
pub(super) fn active(context: &ContextRow) -> bool {
    context.ward_active
        && matches!(
            context.admission_status.as_str(),
            "admitted" | "discharge_pending"
        )
}
pub(super) async fn now(tx: &mut Tx<'_>) -> anyhow::Result<DateTime<Utc>> {
    Ok(hms_observability::observe_db_query(
        "treatment_courses.clock",
        sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut **tx),
    )
    .await?)
}
