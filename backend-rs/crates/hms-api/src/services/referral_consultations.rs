use crate::{
    error::ApiError,
    response::{object, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_db::referral_consultations::{self as db, ConsultationActor, ConsultationError};
use hms_domain::{
    auth::PatientDataVisibility, deployment::PermissionCode, referral_consultations::*,
};
use uuid::Uuid;
#[derive(Clone)]
pub struct ReferralConsultationsService {
    state: AppState,
}
impl ReferralConsultationsService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    fn actor(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
    ) -> Result<ConsultationActor, ApiError> {
        hms_access::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::EncounterView,
        )?;
        if !ctx.has_patient_visibility(PatientDataVisibility::FullClinical) {
            return Err(ApiError::forbidden(
                "referral_consultation_unavailable",
                "Current full clinical access and an ordinary care relationship are required.",
            ));
        }
        Ok(ConsultationActor {
            facility_id: ctx.facility_id,
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
            authorization: crate::services::clinical::prescription_courses::authorization(
                ctx, deadline,
            ),
        })
    }
    pub async fn context(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        referral: Uuid,
        q: ReferralConsultationContextQuery,
    ) -> Result<ObjectResponse<ReferralConsultationContext>, ApiError> {
        Ok(object(
            db::context(
                self.state.db_pool(),
                self.actor(ctx, deadline)?,
                patient,
                referral,
                q,
            )
            .await
            .map_err(|e| map_error(e, false))?,
        ))
    }
    pub async fn start(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        referral: Uuid,
        mut input: ReferralConsultationStartRequest,
    ) -> Result<ObjectResponse<ReferralConsultationStartReceipt>, ApiError> {
        if let Some(reason) = input.restricted_record_override.as_mut() {
            reason.reason_code =
                crate::services::care::normalize_record_override_reason_code(&reason.reason_code)
                    .map_err(|_| invalid())?;
            reason.reason_note = crate::services::care::normalize_record_override_reason_note(
                reason.reason_note.as_deref(),
            )
            .map_err(|_| invalid())?;
        }
        let result = db::start(
            self.state.db_pool(),
            self.actor(ctx, deadline)?,
            patient,
            referral,
            input,
        )
        .await;
        self.state.invalidate_patient_chronicle_cache();
        self.state.invalidate_patient_list_cache();
        Ok(object(result.map_err(|e| map_error(e, true))?))
    }
    pub async fn receipt(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        referral: Uuid,
        key: Uuid,
    ) -> Result<ObjectResponse<ReferralConsultationStartReceipt>, ApiError> {
        Ok(object(
            db::receipt(
                self.state.db_pool(),
                self.actor(ctx, deadline)?,
                patient,
                referral,
                key,
            )
            .await
            .map_err(|e| map_error(e, false))?,
        ))
    }
}
pub fn invalid() -> ApiError {
    ApiError::bad_request("invalid_referral_consultation","Review the supported explicit consultation source, request reference and bounded override fields.")
}
fn map_error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(e) = ApiError::network_publication(&error) {
        return e;
    }
    if error.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
        || error.is::<hms_db::clinical::medication_access::MedicationAccessError>()
    {
        return ApiError::forbidden(
            "referral_consultation_unavailable",
            "Current consultation and full patient authority are required.",
        );
    }
    if let Some(e) = error.downcast_ref::<ConsultationError>() {
        return match e {
 ConsultationError::InvalidInput=>invalid(),ConsultationError::NotFound=>ApiError::not_found("referral_consultation_not_found","The selected consultation evidence was not found."),ConsultationError::Unavailable=>ApiError::forbidden("referral_consultation_unavailable","Current full clinical and consultation authority are required."),ConsultationError::SourceChanged=>ApiError::conflict("referral_consultation_source_changed","The exact selected consultation source changed or is unavailable. Review its current context."),ConsultationError::RequestConflict=>ApiError::conflict("referral_consultation_request_conflict","This request reference belongs to another reviewed consultation start."),ConsultationError::Busy=>ApiError::conflict("referral_consultation_busy","The selected care context is currently in use. Reload its current state before reviewing again.")};
    }
    if let Some(e) = error.downcast_ref::<hms_db::care::lifecycle::CareLifecycleError>() {
        use hms_db::care::lifecycle::CareLifecycleError as E;
        return match e {
            E::Unavailable => ApiError::forbidden(
                "referral_consultation_unavailable",
                "Current consultation authority is required.",
            ),
            E::Busy => ApiError::conflict(
                "referral_consultation_busy",
                "The selected care context is currently in use.",
            ),
            _ => ApiError::conflict(
                "referral_consultation_source_changed",
                "The exact care source changed or is unavailable. Review the current source.",
            ),
        };
    }
    if write {
        ApiError::conflict("referral_consultation_write_unconfirmed","The consultation start outcome could not be confirmed. Keep its unchanged request and review the original receipt before another start.")
    } else {
        ApiError::conflict("referral_consultation_failed","The protected consultation evidence could not be loaded. Reload current access and try again.")
    }
}
