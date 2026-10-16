use super::*;
use hms_db::clinical::prescription_courses as repository;
use hms_domain::clinical::{
    NewPrescriptionCourseReceipt, NewPrescriptionCourseRequest, PrescriptionDocumentationReceipt,
    UpdatePrescriptionDocumentationRequest,
};

pub(super) fn authorization(
    ctx: &hms_access::RequestContext,
    deadline: DateTime<Utc>,
) -> repository::PrescriptionAuthorization {
    repository::PrescriptionAuthorization {
        session_id: ctx.session_id,
        session_version: ctx.session_version,
        permission_version: ctx.permission_version,
        active_profile: ctx.active_profile,
        valid_until: if ctx.offsite == hms_access::OffsiteState::OffsiteFreshReauth {
            deadline.min(ctx.reauth.required_after)
        } else {
            deadline
        },
    }
}
fn actor(
    ctx: &hms_access::RequestContext,
    deadline: Option<DateTime<Utc>>,
) -> repository::PrescriptionActor {
    repository::PrescriptionActor {
        facility_id: ctx.facility_id,
        user_id: ctx.user_id,
        request_id: Some(ctx.request_id.clone()),
        authorization: deadline.map(|at| authorization(ctx, at)),
    }
}

pub(super) fn require_full_clinical_detail(
    ctx: &hms_access::RequestContext,
) -> Result<(), ApiError> {
    if !ctx.has_patient_visibility(hms_domain::auth::PatientDataVisibility::FullClinical) {
        return Err(ApiError::forbidden(
            "patient_access_denied",
            "Full clinical access is required to review prescribing details.",
        ));
    }
    Ok(())
}

impl ClinicalService {
    pub async fn update_prescription_documentation(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: UpdatePrescriptionDocumentationRequest,
        authorization_deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<PrescriptionDocumentationReceipt>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        require_full_clinical_detail(ctx)?;
        let _source = load_prescription_for_access(&self.state, ctx, id).await?;
        let result = repository::update_documentation(
            self.pool(),
            actor(ctx, Some(authorization_deadline)),
            id,
            payload,
        )
        .await
        .map_err(write_error)?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result))
    }
    pub async fn create_prescription_course(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: NewPrescriptionCourseRequest,
        authorization_deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NewPrescriptionCourseReceipt>, ApiError> {
        require_clinical_write_access(ctx, self.facility_id())?;
        require_full_clinical_detail(ctx)?;
        let _source = load_prescription_for_access(&self.state, ctx, id).await?;
        let result = repository::create_new_course(
            self.pool(),
            actor(ctx, Some(authorization_deadline)),
            id,
            payload,
        )
        .await
        .map_err(write_error)?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result))
    }
    pub async fn get_prescription_documentation_receipt(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        key: Uuid,
    ) -> Result<ObjectResponse<PrescriptionDocumentationReceipt>, ApiError> {
        require_action_permission(
            ctx,
            self.facility_id(),
            PermissionCode::ClinicalDocumentationView,
        )?;
        require_full_clinical_detail(ctx)?;
        let _source = load_prescription_for_access(&self.state, ctx, id).await?;
        let result = repository::get_documentation_receipt(self.pool(), &actor(ctx, None), id, key)
            .await
            .map_err(write_error)?
            .ok_or_else(|| {
                ApiError::not_found(
                    "prescription_receipt_not_found",
                    "A confirmed prescription action was not found for this account and reference.",
                )
            })?;
        Ok(object(result))
    }
    pub async fn get_prescription_course_receipt(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        key: Uuid,
    ) -> Result<ObjectResponse<NewPrescriptionCourseReceipt>, ApiError> {
        require_action_permission(
            ctx,
            self.facility_id(),
            PermissionCode::ClinicalDocumentationView,
        )?;
        require_full_clinical_detail(ctx)?;
        let _source = load_prescription_for_access(&self.state, ctx, id).await?;
        let result = repository::get_new_course_receipt(self.pool(), &actor(ctx, None), id, key)
            .await
            .map_err(write_error)?
            .ok_or_else(|| {
                ApiError::not_found(
                    "prescription_receipt_not_found",
                    "A confirmed prescription action was not found for this account and reference.",
                )
            })?;
        Ok(object(result))
    }
}
pub(super) fn write_error(error: anyhow::Error) -> ApiError {
    use repository::PrescriptionCourseError as E;
    if let Some(value) = error.downcast_ref::<E>() {
        return match value {
            E::NotFound => ApiError::not_found("prescription_not_found", value.message()),
            E::InvalidDocumentation | E::InvalidRequest => {
                ApiError::bad_request("invalid_prescription_course", value.message())
            }
            E::AuthorizationExpired => {
                ApiError::forbidden("prescription_authorization_expired", value.message())
            }
            E::InvalidActor => ApiError::forbidden("prescription_actor_invalid", value.message()),
            E::SourceChanged => ApiError::conflict("prescription_source_changed", value.message()),
            E::DocumentationLocked => {
                ApiError::conflict("prescription_documentation_locked", value.message())
            }
            E::InvalidSourceStatus => {
                ApiError::conflict("prescription_source_status_invalid", value.message())
            }
            E::SuccessorExists => {
                ApiError::conflict("prescription_successor_exists", value.message())
            }
            E::RequestConflict => {
                ApiError::conflict("prescription_request_conflict", value.message())
            }
            E::StockChanged => ApiError::conflict("prescription_stock_changed", value.message()),
            E::MixedRegimen => {
                ApiError::conflict("prescription_mixed_regimen_unsupported", value.message())
            }
            E::InvalidContext => {
                ApiError::bad_request("prescription_context_invalid", value.message())
            }
        };
    }
    if matches!(
        error.to_string().as_str(),
        "prescription_inventory_item_invalid" | "prn_stock_unit_changed" | "invalid_prn_policy"
    ) {
        return ApiError::conflict(
            "prescription_stock_changed",
            "Reload the medication stock basis and prescribing limits before saving.",
        );
    }
    ApiError::conflict("prescription_action_unconfirmed","This prescription action may already be saved. Review the original request reference before making another change, or retry the exact original request.")
}
