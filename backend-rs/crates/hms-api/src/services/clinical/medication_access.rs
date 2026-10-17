use crate::error::ApiError;
use chrono::{DateTime, Utc};
use hms_db::clinical::{medication_access::*, prescription_courses::PrescriptionActor};
use hms_domain::{auth::PatientDataVisibility, deployment::PermissionCode};

pub(crate) fn actor(ctx: &hms_access::RequestContext, deadline: DateTime<Utc>) -> MedicationActor {
    MedicationActor {
        identity: PrescriptionActor {
            facility_id: ctx.facility_id,
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
            authorization: Some(super::prescription_courses::authorization(ctx, deadline)),
        },
        can_view_all_wards: crate::services::ward::can_view_all_ward_board(ctx, ctx.facility_id),
        resolved_network_policy_version: ctx.resolved_network_policy_version,
    }
}
pub(crate) fn require_nursing(ctx: &hms_access::RequestContext) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(
        ctx,
        ctx.facility_id,
        PermissionCode::NursingTaskManage,
    )
    .map_err(ApiError::from)?;
    if !ctx.has_patient_visibility(PatientDataVisibility::FullClinical) {
        return Err(ApiError::forbidden(
            "medication_visibility_denied",
            "Full clinical access is required for bedside medication records and changes.",
        ));
    }
    Ok(())
}
pub(crate) fn require_pharmacy_purpose(ctx: &hms_access::RequestContext) -> Result<(), ApiError> {
    if !ctx.has_patient_visibility(PatientDataVisibility::Prescription)
        && !ctx.has_patient_visibility(PatientDataVisibility::FullClinical)
    {
        return Err(ApiError::forbidden(
            "medication_visibility_denied",
            "Prescription access is required for central pharmacy medication records.",
        ));
    }
    Ok(())
}
pub(crate) fn error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(error) = ApiError::network_publication(&error) {
        return error;
    }
    if let Some(reason) = error.downcast_ref::<MedicationAccessError>() {
        return match reason {
            MedicationAccessError::AuthorityExpired=>ApiError::forbidden("medication_authorization_expired","Current medication access is required. Sign in and review your access."),
            MedicationAccessError::FeatureDisabled=>ApiError::forbidden("feature_disabled","The medication workflow feature is not enabled."),
            MedicationAccessError::PatientDenied=>ApiError::forbidden("patient_access_denied","Current access to this patient is required."),
            MedicationAccessError::WardDenied=>ApiError::forbidden("medication_ward_access_denied","An active assignment to the current ward or explicit all-ward authority is required."),
            MedicationAccessError::ContextChanged=>ApiError::conflict("medication_context_changed","The patient, admission or ward changed. Reload the current care context."),
        };
    }
    ApiError::conflict(
        if write {
            "medication_write_unconfirmed"
        } else {
            "medication_read_failed"
        },
        if write {
            "The change could not be confirmed. Refresh and review the medication record before making another change."
        } else {
            "Medication records could not be loaded."
        },
    )
}
