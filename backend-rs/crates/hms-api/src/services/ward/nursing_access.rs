use super::common;
use crate::{error::ApiError, state::AppState};
use chrono::{DateTime, Utc};
use hms_db::ward::nursing_access::{NursingActor, NursingError};
use hms_domain::{auth::PatientDataVisibility, deployment::PermissionCode};
use uuid::Uuid;

pub(super) fn require(
    ctx: &hms_access::RequestContext,
    facility: Uuid,
    full: bool,
) -> Result<(), ApiError> {
    common::require_patient_workflow_access(ctx, facility, PermissionCode::NursingTaskManage)?;
    let allowed = ctx.has_patient_visibility(PatientDataVisibility::FullClinical)
        || (!full && ctx.has_patient_visibility(PatientDataVisibility::ClinicalSummary));
    if !allowed {
        return Err(ApiError::forbidden(
            "nursing_visibility_denied",
            if full {
                "Full clinical access is required for nursing narrative and changes."
            } else {
                "Clinical summary access is required to review vital measurements."
            },
        ));
    }
    Ok(())
}
pub(super) fn actor(ctx: &hms_access::RequestContext, deadline: DateTime<Utc>) -> NursingActor {
    NursingActor {
        facility_id: ctx.facility_id,
        user_id: ctx.user_id,
        session_id: ctx.session_id,
        session_version: ctx.session_version,
        permission_version: ctx.permission_version,
        active_profile: ctx.active_profile,
        valid_until: if ctx.offsite == hms_access::OffsiteState::OffsiteFreshReauth {
            deadline.min(ctx.reauth.required_after)
        } else {
            deadline
        },
        can_view_all_wards: super::staff_assignments::can_view_all_ward_board(ctx, ctx.facility_id),
        request_id: Some(ctx.request_id.clone()),
    }
}
pub(super) async fn scope(
    s: &AppState,
    ctx: &hms_access::RequestContext,
    patient: Option<Uuid>,
    admission: Option<Uuid>,
    ward: Option<Uuid>,
    captured_task: bool,
) -> Result<(), ApiError> {
    if let Some(id) = ward {
        common::load_ward(s, id).await?;
    }
    if let Some(id) = admission {
        let a = common::load_admission_for_access(s, ctx, id).await?;
        if patient.is_some_and(|p| p != a.patient_id)
            || (!captured_task && ward.is_some_and(|w| w != a.ward_id))
        {
            return Err(ApiError::bad_request(
                "invalid_nursing_list_scope",
                "The selected patient, admission and ward do not describe the same nursing scope.",
            ));
        }
    } else if let Some(id) = patient {
        common::load_patient_for_access(s, ctx, id).await?;
    }
    Ok(())
}
pub(super) fn error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(e) = error.downcast_ref::<NursingError>() {
        return match e {
            NursingError::AuthorizationExpired => ApiError::forbidden(
                "nursing_authorization_expired",
                "Current nursing access is required. Sign in and review your access.",
            ),
            NursingError::FeatureDisabled => ApiError::forbidden(
                "feature_disabled",
                "The Nursing feature is not enabled for this facility.",
            ),
            NursingError::WardDenied => ApiError::forbidden(
                "nursing_ward_access_denied",
                "An active assignment to this ward or explicit all-ward authority is required.",
            ),
            NursingError::InvalidScope => ApiError::bad_request(
                "invalid_nursing_list_scope",
                "The selected nursing scope is inconsistent.",
            ),
            NursingError::InvalidContext => ApiError::conflict(
                "nursing_context_changed",
                "Review the patient's current active admission and ward before recording care.",
            ),
            NursingError::InvalidAssignee => ApiError::conflict(
                "nursing_assignee_changed",
                "Select an active local practitioner assigned to the current ward.",
            ),
            NursingError::TerminalConflict => ApiError::conflict(
                "nursing_decision_conflict",
                "This record already has a different terminal decision. Review the saved result.",
            ),
            NursingError::NotFound => ApiError::not_found(
                "nursing_record_not_found",
                "The nursing record was not found.",
            ),
        };
    }
    if write {
        ApiError::conflict("nursing_write_unconfirmed","The change may already be saved. Refresh and review the nursing record before making another change.")
    } else {
        ApiError::conflict(
            "nursing_read_failed",
            "Nursing records could not be loaded.",
        )
    }
}
pub(super) fn text(value: Option<String>, max: usize) -> Result<Option<String>, ApiError> {
    value
        .map(|v| {
            let v = v.trim().to_owned();
            if v.chars().count() > max {
                Err(ApiError::bad_request(
                    "invalid_nursing_text",
                    "Review the supported length of the nursing text.",
                ))
            } else {
                Ok(v)
            }
        })
        .transpose()
        .map(|v| v.filter(|s| !s.is_empty()))
}
