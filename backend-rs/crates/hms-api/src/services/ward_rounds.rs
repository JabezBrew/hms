use crate::{
    error::ApiError,
    response::{object, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_db::ward_rounds::governed::{self, WardRoundActor, WardRoundError};
use hms_domain::auth::{ClinicalPatientAccessDecision, ClinicalPatientAccessEvidence};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use hms_domain::ward_rounds::*;
use uuid::Uuid;

#[derive(Clone)]
pub struct WardRoundsService {
    state: AppState,
}
impl WardRoundsService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }
    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }
    fn actor(&self, ctx: &hms_access::RequestContext, deadline: DateTime<Utc>) -> WardRoundActor {
        WardRoundActor {
            facility_id: self.facility_id(),
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
            authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
                session_id: ctx.session_id,
                session_version: ctx.session_version,
                permission_version: ctx.permission_version,
                active_profile: ctx.active_profile,
                valid_until: if ctx.offsite == hms_access::OffsiteState::OffsiteFreshReauth {
                    deadline.min(ctx.reauth.required_after)
                } else {
                    deadline
                },
            },
            can_write: hms_access::require_clinical_write_access(ctx, self.facility_id()).is_ok(),
            can_prescribe: self
                .require_action_permission(ctx, WardRoundActionType::Prescription)
                .is_ok(),
            can_order_labs: self
                .require_action_permission(ctx, WardRoundActionType::LabOrder)
                .is_ok(),
            can_create_nursing_task: self
                .require_action_permission(ctx, WardRoundActionType::NursingTask)
                .is_ok(),
            can_request_discharge: self
                .require_action_permission(ctx, WardRoundActionType::DischargeRequest)
                .is_ok(),
            can_view_all_wards: super::ward::can_view_all_ward_board(ctx, self.facility_id()),
        }
    }
    pub async fn current(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        query: WardRoundCurrentQuery,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<WardRoundWorkspace>, ApiError> {
        self.load_patient_for_chronicle(ctx, patient).await?;
        Ok(object(
            governed::current(
                self.pool(),
                self.actor(ctx, deadline),
                patient,
                query.admission_case_id,
            )
            .await
            .map_err(|e| map_error(e, false))?,
        ))
    }
    pub async fn get(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        id: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        self.load_patient_for_chronicle(ctx, patient).await?;
        Ok(object(
            governed::get(self.pool(), self.actor(ctx, deadline), patient, id)
                .await
                .map_err(|e| map_error(e, false))?,
        ))
    }
    pub async fn save(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        input: SaveWardRoundDraftRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<WardRoundCommandReceipt>, ApiError> {
        let (_, decision) = self.load_patient_for_chronicle(ctx, patient).await?;
        self.require_write(ctx, &decision)?;
        let result = governed::save(self.pool(), self.actor(ctx, deadline), patient, input).await;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(result.map_err(|e| map_error(e, true))?))
    }
    pub async fn commit(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        id: Uuid,
        input: CommitWardRoundRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<WardRoundCommandReceipt>, ApiError> {
        let (_, decision) = self.load_patient_for_chronicle(ctx, patient).await?;
        self.require_write(ctx, &decision)?;
        let result =
            governed::commit(self.pool(), self.actor(ctx, deadline), patient, id, input).await;
        self.state.invalidate_patient_chronicle_cache();
        self.state.invalidate_ward_board_cache();
        self.state.invalidate_pharmacy_dispense_cache();
        Ok(object(result.map_err(|e| map_error(e, true))?))
    }
    pub async fn receipt(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        key: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<WardRoundCommandReceipt>, ApiError> {
        self.load_patient_for_chronicle(ctx, patient).await?;
        Ok(object(
            governed::receipt(self.pool(), self.actor(ctx, deadline), patient, key)
                .await
                .map_err(|e| map_error(e, false))?,
        ))
    }
    async fn retired<T>(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
    ) -> Result<ObjectResponse<T>, ApiError> {
        let (_, decision) = self.load_patient_for_chronicle(ctx, patient).await?;
        self.require_write(ctx, &decision)?;
        Err(ApiError::conflict("ward_round_atomic_draft_required","Reload the Ward Round and save its complete reviewed draft. Individual draft/action writes are no longer supported."))
    }
    pub async fn create(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        _input: CreateWardRoundRequest,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        self.retired(ctx, patient).await
    }
    pub async fn update(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        _id: Uuid,
        _input: UpdateWardRoundRequest,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        self.retired(ctx, patient).await
    }
    pub async fn create_action(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        _id: Uuid,
        _input: CreateWardRoundActionRequest,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        self.retired(ctx, patient).await
    }
    pub async fn update_action(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        _id: Uuid,
        _action: Uuid,
        _input: UpdateWardRoundActionRequest,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        self.retired(ctx, patient).await
    }
    pub async fn delete_action(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Uuid,
        _id: Uuid,
        _action: Uuid,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        self.retired(ctx, patient).await
    }
    async fn load_patient_for_chronicle(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
    ) -> Result<(PatientRecord, ClinicalPatientAccessDecision), ApiError> {
        if !ctx.has_patient_visibility(hms_domain::auth::PatientDataVisibility::FullClinical) {
            return Err(ApiError::forbidden(
                "patient_access_denied",
                "Full clinical visibility is required to review a Ward Round narrative.",
            ));
        }
        let patient = hms_db::patients::get_patient(self.pool(), self.facility_id(), patient_id)
            .await
            .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;
        hms_access::require_patient_demographics_access(ctx, &patient).map_err(|_| {
            ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to this patient Chronicle.",
            )
        })?;
        let now = Utc::now();
        let evidence: ClinicalPatientAccessEvidence =
            hms_db::auth::clinical_patient_access_evidence(
                self.pool(),
                self.facility_id(),
                ctx.user_id,
                patient.id,
                now,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "patient_access_check_failed",
                    "Patient access could not be checked.",
                )
            })?;
        let decision = hms_access::evaluate_clinical_patient_access(ctx, &patient, &evidence, now)
            .map_err(|_| {
                ApiError::forbidden(
                    "patient_access_denied",
                    "You do not have access to this patient Chronicle.",
                )
            })?;
        Ok((patient, decision))
    }

    fn require_write(
        &self,
        ctx: &hms_access::RequestContext,
        decision: &ClinicalPatientAccessDecision,
    ) -> Result<(), ApiError> {
        if decision.read_only {
            return Err(ApiError::forbidden(
                "chronicle_read_only",
                "Patient Chronicle is read-only for this request.",
            ));
        }
        hms_access::require_clinical_write_access(ctx, self.facility_id()).map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission to write Patient Chronicle records.",
            )
        })
    }

    fn require_action_permission(
        &self,
        ctx: &hms_access::RequestContext,
        action_type: WardRoundActionType,
    ) -> Result<(), ApiError> {
        let facility_id = self.facility_id();
        match action_type {
            WardRoundActionType::Prescription => {
                hms_access::require_clinical_write_access(ctx, facility_id).map_err(|_| {
                    ApiError::forbidden(
                        "permission_denied",
                        "You do not have permission to prescribe from Ward Round.",
                    )
                })
            }
            WardRoundActionType::LabOrder => hms_access::require_lab_access(
                ctx,
                facility_id,
                PermissionCode::LaboratoryOrderManage,
            )
            .map_err(|_| {
                ApiError::forbidden(
                    "permission_denied",
                    "You do not have permission to order labs from Ward Round.",
                )
            }),
            WardRoundActionType::NursingTask => hms_access::require_patient_workflow_access(
                ctx,
                facility_id,
                PermissionCode::NursingTaskManage,
            )
            .map_err(|_| {
                ApiError::forbidden(
                    "permission_denied",
                    "You do not have permission to create nursing tasks from Ward Round.",
                )
            }),
            WardRoundActionType::DischargeRequest => hms_access::require_patient_workflow_access(
                ctx,
                facility_id,
                PermissionCode::AdmissionManage,
            )
            .map_err(|_| {
                ApiError::forbidden(
                    "permission_denied",
                    "You do not have permission to request discharge from Ward Round.",
                )
            }),
        }
    }
}
impl AppState {
    pub fn ward_rounds_service(&self) -> WardRoundsService {
        WardRoundsService::new(self.clone())
    }
}
fn map_error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(e) = error.downcast_ref::<WardRoundError>() {
        return match e {
        WardRoundError::NotFound=>ApiError::not_found("ward_round_not_found","The Ward Round, admission or original request was not found."),
        WardRoundError::InvalidInput=>ApiError::bad_request("invalid_ward_round","Review all supported fields, exact versions and the bounded list of actions."),
        WardRoundError::PermissionDenied|WardRoundError::PatientDenied=>ApiError::forbidden("ward_round_access_denied","Current full clinical and action permissions are required."),
        WardRoundError::FeatureDisabled=>ApiError::forbidden("feature_disabled","A required Ward Round feature is not enabled."),
        WardRoundError::AuthorityExpired=>ApiError::forbidden("ward_round_authorization_expired","Current authorization is required. Refresh your access before continuing."),
        WardRoundError::ContextChanged=>ApiError::conflict("ward_round_context_changed","Review the selected patient's active admission and ward before recording care."),
        WardRoundError::SourceChanged=>ApiError::conflict("ward_round_source_changed","The reviewed draft or prescription changed. Reload its current details."),
        WardRoundError::NotDraft=>ApiError::conflict("ward_round_not_draft","This Ward Round is already committed. Review its saved result."),
        WardRoundError::DraftExists=>ApiError::conflict("ward_round_draft_exists","This admission already has a draft. Load and review it before editing."),
        WardRoundError::RequestConflict=>ApiError::conflict("ward_round_request_conflict","This request reference belongs to another command. Review the original result."),
        WardRoundError::CatalogChanged=>ApiError::conflict("ward_round_catalog_changed","Every selected test and panel must still be active in this facility. Review the catalog selection."),
        WardRoundError::PrescribingPanelRequired=>ApiError::conflict("ward_round_prescribing_panel_required","Use the prescription panel for as-needed or stock-linked treatment and its explicit reviewed safety policy."),
        WardRoundError::PrescriptionClosed=>ApiError::conflict("prescription_course_closed","A stopped or completed course cannot be resumed. Review a new course in the prescription panel."),
        WardRoundError::DischargeReviewRequired=>ApiError::conflict("ward_round_discharge_review_required","Review the existing discharge case in the discharge panel before requesting another transition."),
        WardRoundError::DraftReviewRequired=>ApiError::conflict("ward_round_draft_review_required","This earlier Ward Round needs review of its preserved action evidence before it can be used in this workflow."),
    };
    }
    if let Some(e) = error.downcast_ref::<hms_db::ward::nursing_access::NursingError>() {
        return match e {
        hms_db::ward::nursing_access::NursingError::WardDenied=>ApiError::forbidden("nursing_ward_access_denied","An active assignment to the current ward or explicit all-ward authority is required."),
        hms_db::ward::nursing_access::NursingError::InvalidAssignee=>ApiError::conflict("nursing_assignee_changed","Choose an active local practitioner assigned to the selected ward."),
        hms_db::ward::nursing_access::NursingError::FeatureDisabled=>ApiError::forbidden("feature_disabled","The Nursing feature is not enabled."),
        _=>ApiError::forbidden("ward_round_authorization_expired","Current nursing authority is required."),
    };
    }
    if let Some(error) =
        error.downcast_ref::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
    {
        use hms_db::clinical::prescription_courses::PrescriptionCourseError;
        return match error {
            PrescriptionCourseError::InvalidContext => ApiError::conflict("ward_round_context_changed", "The selected care context changed. Review the active admission before recording care."),
            PrescriptionCourseError::InvalidActor | PrescriptionCourseError::AuthorizationExpired => ApiError::forbidden("ward_round_authorization_expired", "Current authorization is required. Refresh your access before continuing."),
            _ => ApiError::conflict("ward_round_source_changed", "The reviewed prescription changed. Reload its current details."),
        };
    }
    match error.root_cause().to_string().as_str() {
        "prescription_regimen_locked" => {
            return ApiError::conflict(
                "prescription_regimen_locked",
                "Use the prescription panel to review a replacement course.",
            )
        }
        "prescription_course_closed" => {
            return ApiError::conflict(
                "prescription_course_closed",
                "A stopped or completed course cannot be resumed.",
            )
        }
        _ => {}
    }
    if write {
        ApiError::conflict("ward_round_write_unconfirmed","This change may already be saved. Retain the exact request reference and review or retry that same command.")
    } else {
        ApiError::conflict(
            "ward_round_read_failed",
            "The complete protected Ward Round could not be loaded.",
        )
    }
}
