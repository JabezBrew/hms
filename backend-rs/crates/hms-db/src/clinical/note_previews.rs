//! Ephemeral ordinary-care previews under one retained clinical read proof.
//! No generated note, audit body, preview row, or request receipt is persisted.
use super::{
    medication_access,
    note_records::{self, NoteActor},
    prescription_courses::{self, PrescriptionActor, PrescriptionCourseError},
    template_render::{self, PatientTokens, RenderInput, RenderKind, RenderMode},
};
use crate::{codec, PgPool};
use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::{
    clinical_notes::*,
    deployment::{FeatureKey, PermissionCode},
};
use hms_observability::observe_db_query;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreviewError {
    InvalidInput,
    Unavailable,
    SourceUnavailable,
    AuthorityExpired,
}
impl std::fmt::Display for PreviewError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidInput => "invalid_clinical_note_template_preview",
            Self::Unavailable => "clinical_note_template_preview_unavailable",
            Self::SourceUnavailable => "clinical_note_template_preview_source_unavailable",
            Self::AuthorityExpired => "clinical_note_template_preview_authorization_expired",
        })
    }
}
impl std::error::Error for PreviewError {}

async fn authority(
    tx: &mut Transaction<'_, Postgres>,
    actor: &mut NoteActor,
) -> anyhow::Result<()> {
    // Preview never exercises management or ownership override. Holding those
    // labels must not introduce an unrelated Admin feature or factor gate.
    actor.can_manage = false;
    actor.override_ownership = false;
    note_records::verify_actor(tx, actor).await?;
    medication_access::require_current_features_tx(
        tx,
        actor.facility_id,
        actor.authorization.active_profile,
        &[FeatureKey::Patients, FeatureKey::Encounters],
    )
    .await?;
    let permissions = [
        PermissionCode::PatientDemographicsView,
        PermissionCode::ClinicalDocumentationView,
    ]
    .into_iter()
    .map(codec::encode)
    .collect::<anyhow::Result<Vec<_>>>()?;
    let features = [FeatureKey::Patients, FeatureKey::Encounters]
        .into_iter()
        .map(codec::encode)
        .collect::<anyhow::Result<Vec<_>>>()?;
    // Evaluate live permission sources at one post-wait database instant. The
    // general effective view intentionally uses transaction-start now().
    let (allowed,boundary):(bool,Option<DateTime<Utc>>)=observe_db_query("clinical.note_preview.permissions",sqlx::query_as(
        r#"
        WITH point AS MATERIALIZED (SELECT clock_timestamp() AS at)
        SELECT NOT EXISTS (
          SELECT 1 FROM unnest($3::text[]) required(permission_code) CROSS JOIN point n
          WHERE NOT (
            EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=$2 AND p.permission_code=required.permission_code)
            OR EXISTS(SELECT 1 FROM permission_assignments p WHERE p.facility_id=$1 AND p.grantee_user_id=$2
              AND p.permission_code=required.permission_code AND p.scope_type='facility' AND p.scope_id IS NULL
              AND p.status='active' AND p.starts_at<=n.at AND (p.ends_at IS NULL OR p.ends_at>n.at))
            OR EXISTS(SELECT 1 FROM delegations d WHERE d.facility_id=$1 AND d.delegate_user_id=$2
              AND d.permission_code=required.permission_code AND d.status='active'
              AND d.starts_at<=n.at AND (d.ends_at IS NULL OR d.ends_at>n.at))
          )
        )
        AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='full_clinical')
        AND EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$2 AND visibility='demographics')
        AND (SELECT count(*) FROM user_features WHERE user_id=$2 AND feature_key=ANY($4))=2,
        (SELECT min(boundary) FROM user_authority_boundaries b
          CROSS JOIN LATERAL(VALUES(b.starts_at),(b.ends_at)) boundaries(boundary) CROSS JOIN point n
          WHERE b.facility_id=$1 AND b.user_id=$2 AND boundary>n.at)
        "#,
    ).bind(actor.facility_id).bind(actor.user_id).bind(permissions).bind(features).fetch_one(&mut **tx)).await?;
    if !allowed {
        return Err(PreviewError::Unavailable.into());
    }
    if let Some(boundary) = boundary {
        actor.authorization.valid_until = actor.authorization.valid_until.min(boundary);
    }
    note_records::check_deadline(tx, actor).await
}

#[derive(FromRow)]
struct PatientRow {
    first_name: String,
    last_name: String,
    date_of_birth: NaiveDate,
    sex: String,
    patient_code: String,
    record_status: String,
    vital_status: String,
}
async fn patient(
    tx: &mut Transaction<'_, Postgres>,
    actor: &NoteActor,
    id: Uuid,
) -> anyhow::Result<PatientRow> {
    let row:PatientRow=observe_db_query("clinical.note_preview.patient",sqlx::query_as(
        "SELECT first_name,last_name,date_of_birth,sex,patient_code,record_status,vital_status FROM patients WHERE facility_id=$1 AND id=$2 FOR SHARE",
    ).bind(actor.facility_id).bind(id).fetch_optional(&mut **tx)).await?.ok_or(PreviewError::Unavailable)?;
    if row.record_status != "registered" || row.vital_status == "deceased" {
        return Err(PreviewError::Unavailable.into());
    }
    // Reuse the ordinary Chronicle context/authored-note source protocol. This
    // purpose has no emergency fallback: Summary or a grant cannot escalate it.
    let medication = medication_access::MedicationActor {
        identity: PrescriptionActor {
            facility_id: actor.facility_id,
            user_id: actor.user_id,
            request_id: actor.request_id.clone(),
            authorization: Some(actor.authorization.clone()),
        },
        can_view_all_wards: false,
        resolved_network_policy_version: actor.authorization.resolved_network_policy_version,
    };
    medication_access::patient(tx, &medication, id).await?;
    Ok(row)
}
fn validate(input: &PreviewClinicalNoteTemplateRequest) -> anyhow::Result<()> {
    if input.template_id.is_nil()
        || input.template_revision_id.is_nil()
        || input.encounter_id.is_some_and(|id| id.is_nil())
        || input.sections.len() > 100
        || input.base_body.chars().take(20_001).count() > 20_000
        || input
            .chief_complaint
            .as_ref()
            .is_some_and(|value| value.chars().take(501).count() > 500)
    {
        return Err(PreviewError::InvalidInput.into());
    }
    Ok(())
}
pub async fn preview(
    pool: &PgPool,
    mut actor: NoteActor,
    patient_id: Uuid,
    input: PreviewClinicalNoteTemplateRequest,
) -> anyhow::Result<ClinicalNoteTemplatePreview> {
    validate(&input)?;
    let mut tx = pool.begin().await?;
    authority(&mut tx, &mut actor).await?;
    let patient = patient(&mut tx, &actor, patient_id).await?;
    prescription_courses::validate_care_context_tx(
        &mut tx,
        actor.facility_id,
        patient_id,
        input.encounter_id,
        None,
    )
    .await
    .map_err(|error| {
        if error.is::<PrescriptionCourseError>() {
            PreviewError::Unavailable.into()
        } else {
            error
        }
    })?;
    let active:Option<bool>=observe_db_query("clinical.note_preview.template",sqlx::query_scalar(
        "SELECT is_active FROM clinical_note_templates WHERE facility_id=$1 AND id=$2 FOR SHARE",
    ).bind(actor.facility_id).bind(input.template_id).fetch_optional(&mut *tx)).await?;
    if active != Some(true) {
        return Err(PreviewError::SourceUnavailable.into());
    }
    let revision:Option<(i64,String)>=observe_db_query("clinical.note_preview.revision",sqlx::query_as(
        "SELECT version,body_template FROM clinical_note_template_revisions WHERE facility_id=$1 AND template_id=$2 AND id=$3",
    ).bind(actor.facility_id).bind(input.template_id).bind(input.template_revision_id).fetch_optional(&mut *tx)).await?;
    let (version, source) = revision.ok_or(PreviewError::SourceUnavailable)?;
    let now: DateTime<Utc> = observe_db_query(
        "clinical.note_preview.clock",
        sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut *tx),
    )
    .await?;
    let rendered = template_render::render(RenderInput {
        source: &source,
        base_body: &input.base_body,
        mode: match input.apply_mode {
            NoteTemplatePreviewMode::All => RenderMode::All,
            NoteTemplatePreviewMode::EmptyOnly => RenderMode::EmptyOnly,
            NoteTemplatePreviewMode::Selected => RenderMode::Selected,
        },
        sections: &input.sections,
        patient: PatientTokens {
            first_name: &patient.first_name,
            last_name: &patient.last_name,
            date_of_birth: Some(patient.date_of_birth),
            sex: &patient.sex,
            mrn: &patient.patient_code,
        },
        chief_complaint: input.chief_complaint.as_deref(),
        now,
    })?;
    let result = ClinicalNoteTemplatePreview {
        patient_id,
        encounter_id: input.encounter_id,
        template_id: input.template_id,
        template_revision_id: input.template_revision_id,
        template_revision_version: version,
        rendered_on: now.date_naive(),
        date_basis: NoteTemplatePreviewDateBasis::Utc,
        kind: match rendered.kind {
            RenderKind::Plain => NoteTemplatePreviewKind::Plain,
            RenderKind::Structured => NoteTemplatePreviewKind::Structured,
        },
        patch: rendered.patch,
        applied_sections: rendered.applied_sections,
        unresolved: rendered
            .unresolved
            .into_iter()
            .map(|token| NoteTemplatePreviewUnresolvedToken {
                name: token.name,
                count: token.count,
            })
            .collect(),
        unresolved_truncated: rendered.unresolved_truncated,
    };
    note_records::check_deadline(&mut tx, &actor).await?;
    tx.commit().await?;
    Ok(result)
}
