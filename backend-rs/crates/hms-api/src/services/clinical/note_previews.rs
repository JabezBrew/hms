use super::*;
use hms_db::clinical::{
    medication_access::MedicationAccessError,
    note_previews::{self, PreviewError},
    note_records::{NoteActor, NoteError},
    template_render::RenderError,
};
use hms_domain::{
    auth::PatientDataVisibility,
    clinical_notes::{ClinicalNoteTemplatePreview, PreviewClinicalNoteTemplateRequest},
};

fn unavailable() -> ApiError {
    ApiError::forbidden("clinical_note_template_preview_unavailable","Preview requires current full clinical access, an ordinary care relationship and the selected active care context.")
}
fn error(error: anyhow::Error) -> ApiError {
    if let Some(error) = ApiError::network_publication(&error) {
        return error;
    }
    if error.is::<NoteError>()
        || error.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
    {
        return ApiError::forbidden(
            "clinical_note_template_preview_authorization_expired",
            "Current clinical authorization is required. Reload current access before previewing.",
        );
    }
    if let Some(reason) = error.downcast_ref::<MedicationAccessError>() {
        return match reason {
            MedicationAccessError::AuthorityExpired=>ApiError::forbidden("clinical_note_template_preview_authorization_expired","Current clinical authorization is required. Reload current access before previewing."),
            _=>unavailable(),
        };
    }
    if let Some(reason) = error.downcast_ref::<PreviewError>() {
        return match reason {
            PreviewError::InvalidInput=>ApiError::bad_request("invalid_clinical_note_template_preview","Review the exact selected template, supported preview fields and bounded draft content."),
            PreviewError::Unavailable=>unavailable(),
            PreviewError::SourceUnavailable=>ApiError::conflict("clinical_note_template_preview_source_unavailable","Choose an active facility template and one exact saved revision before previewing."),
            PreviewError::AuthorityExpired=>ApiError::forbidden("clinical_note_template_preview_authorization_expired","Current clinical authorization is required. Reload current access before previewing."),
        };
    }
    if let Some(reason) = error.downcast_ref::<RenderError>() {
        return match reason {
            RenderError::InvalidInput|RenderError::LimitExceeded=>ApiError::bad_request("invalid_clinical_note_template_preview","Review the supported preview fields, selected sections and bounded draft content."),
            RenderError::UnsupportedSchema=>ApiError::bad_request("clinical_note_template_preview_unsupported","This saved template cannot be previewed safely. Review its original configuration."),
        };
    }
    ApiError::conflict(
        "clinical_note_template_preview_failed",
        "Preview could not be loaded. Review current access and try again.",
    )
}
impl ClinicalService {
    pub async fn preview_note_template(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        input: PreviewClinicalNoteTemplateRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<ClinicalNoteTemplatePreview>, ApiError> {
        hms_access::require_chronicle_read_access(ctx, self.facility_id())
            .map_err(|_| unavailable())?;
        if !ctx.has_patient_visibility(PatientDataVisibility::FullClinical) {
            return Err(unavailable());
        }
        // The repository separately proves current data class, ordinary care
        // relationship, selected active context and exact revision in one TX.
        let actor = NoteActor {
            facility_id: ctx.facility_id,
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
            authorization: super::prescription_courses::authorization(ctx, deadline),
            can_manage: false,
            override_ownership: false,
        };
        Ok(object(
            note_previews::preview(self.pool(), actor, patient, input)
                .await
                .map_err(error)?,
        ))
    }
}
