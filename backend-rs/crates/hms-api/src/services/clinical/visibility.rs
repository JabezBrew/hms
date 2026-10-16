//! Data-class visibility supplements workflow permission and patient scoping.
use crate::error::ApiError;
use hms_access::RequestContext;
use hms_domain::auth::PatientDataVisibility;

fn require_any(ctx: &RequestContext, allowed: &[PatientDataVisibility]) -> Result<(), ApiError> {
    if allowed
        .iter()
        .any(|value| ctx.has_patient_visibility(*value))
    {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "patient_access_denied",
            "Your current data visibility does not allow this clinical information or action.",
        ))
    }
}

pub(super) fn summary(ctx: &RequestContext) -> Result<(), ApiError> {
    require_any(
        ctx,
        &[
            PatientDataVisibility::ClinicalSummary,
            PatientDataVisibility::FullClinical,
        ],
    )
}

pub(super) fn full(ctx: &RequestContext) -> Result<(), ApiError> {
    require_any(ctx, &[PatientDataVisibility::FullClinical])
}

pub(super) fn prescription_context(ctx: &RequestContext) -> Result<(), ApiError> {
    require_any(
        ctx,
        &[
            PatientDataVisibility::Prescription,
            PatientDataVisibility::FullClinical,
        ],
    )
}

pub(super) fn laboratory_context(ctx: &RequestContext) -> Result<(), ApiError> {
    require_any(
        ctx,
        &[
            PatientDataVisibility::Laboratory,
            PatientDataVisibility::FullClinical,
        ],
    )
}
