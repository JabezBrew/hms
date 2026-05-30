use chrono::Utc;
use hms_domain::auth::{ClinicalPatientAccessDecision, ClinicalPatientAccessEvidence};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use hms_domain::ward_rounds::{
    CommitWardRoundRequest, CommitWardRoundResponse, CreateWardRoundActionRequest,
    CreateWardRoundRequest, UpdateWardRoundActionRequest, UpdateWardRoundRequest,
    WardRoundActionStatus, WardRoundActionType, WardRoundDetail, WardRoundPermissions,
    WardRoundStatus,
};
use uuid::Uuid;

use crate::error::ApiError;
use crate::response::{object, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct WardRoundsService {
    state: AppState,
}

impl WardRoundsService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn current(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        let (_patient, decision) = self.load_patient_for_chronicle(ctx, patient_id).await?;
        let round = hms_db::ward_rounds::get_current_ward_round(
            self.pool(),
            self.facility_id(),
            patient_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("ward_round_load_failed", "Ward Round could not be loaded.")
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_round_not_found",
                "No current Ward Round exists for this admission.",
            )
        })?;
        Ok(object(self.with_permissions(round, &decision, ctx)))
    }

    pub async fn create(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        payload: CreateWardRoundRequest,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        let (_patient, decision) = self.load_patient_for_chronicle(ctx, patient_id).await?;
        self.require_write(ctx, &decision)?;
        let round = hms_db::ward_rounds::create_ward_round(
            self.pool(),
            hms_db::ward_rounds::NewWardRound {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                admission_case_id: payload.admission_case_id,
                note_sections: payload.note_sections.unwrap_or_default(),
                rendered_note: payload.rendered_note,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_round_create_failed",
                "Ward Round could not be created.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "active_admission_required",
                "Ward Round requires an active admission for this patient.",
            )
        })?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(self.with_permissions(round, &decision, ctx)))
    }

    pub async fn get(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        round_id: Uuid,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        let (_patient, decision) = self.load_patient_for_chronicle(ctx, patient_id).await?;
        let round = hms_db::ward_rounds::get_ward_round(
            self.pool(),
            self.facility_id(),
            patient_id,
            round_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("ward_round_load_failed", "Ward Round could not be loaded.")
        })?
        .ok_or_else(|| ApiError::not_found("ward_round_not_found", "Ward Round was not found."))?;
        Ok(object(self.with_permissions(round, &decision, ctx)))
    }

    pub async fn update(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        round_id: Uuid,
        payload: UpdateWardRoundRequest,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        let (_patient, decision) = self.load_patient_for_chronicle(ctx, patient_id).await?;
        self.require_write(ctx, &decision)?;
        let round = hms_db::ward_rounds::update_ward_round(
            self.pool(),
            self.facility_id(),
            patient_id,
            round_id,
            payload.expected_version,
            hms_db::ward_rounds::WardRoundUpdate {
                note_sections: payload.note_sections,
                rendered_note: payload.rendered_note,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_round_update_failed",
                "Ward Round could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "ward_round_stale_or_closed",
                "Ward Round draft version is stale or closed.",
            )
        })?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(self.with_permissions(round, &decision, ctx)))
    }

    pub async fn create_action(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        round_id: Uuid,
        payload: CreateWardRoundActionRequest,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        let (_patient, decision) = self.load_patient_for_chronicle(ctx, patient_id).await?;
        self.require_write(ctx, &decision)?;
        self.require_action_permission(ctx, payload.action_type)?;
        let round = hms_db::ward_rounds::create_ward_round_action(
            self.pool(),
            hms_db::ward_rounds::NewWardRoundAction {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id,
                ward_round_id: round_id,
                action_type: payload.action_type,
                title: payload.title,
                instruction: payload.instruction,
                payload: payload.payload,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_round_action_create_failed",
                "Ward Round action could not be created.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("ward_round_not_found", "Ward Round draft was not found.")
        })?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(self.with_permissions(round, &decision, ctx)))
    }

    pub async fn update_action(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        round_id: Uuid,
        action_id: Uuid,
        payload: UpdateWardRoundActionRequest,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        let (_patient, decision) = self.load_patient_for_chronicle(ctx, patient_id).await?;
        self.require_write(ctx, &decision)?;
        let existing = hms_db::ward_rounds::get_ward_round(
            self.pool(),
            self.facility_id(),
            patient_id,
            round_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("ward_round_load_failed", "Ward Round could not be loaded.")
        })?
        .ok_or_else(|| ApiError::not_found("ward_round_not_found", "Ward Round was not found."))?;
        let action = existing
            .actions
            .iter()
            .find(|action| action.id == action_id)
            .ok_or_else(|| {
                ApiError::not_found(
                    "ward_round_action_not_found",
                    "Ward Round action was not found.",
                )
            })?;
        self.require_action_permission(ctx, action.action_type)?;
        if matches!(payload.status, Some(WardRoundActionStatus::Committed)) {
            return Err(ApiError::bad_request(
                "invalid_ward_round_action_status",
                "Ward Round actions are committed by committing the parent round.",
            ));
        }
        let round = hms_db::ward_rounds::update_ward_round_action(
            self.pool(),
            self.facility_id(),
            patient_id,
            round_id,
            action_id,
            hms_db::ward_rounds::WardRoundActionUpdate {
                title: payload.title,
                instruction: payload.instruction,
                payload: payload.payload,
                status: payload.status,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_round_action_update_failed",
                "Ward Round action could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_round_action_not_found",
                "Ward Round action was not found.",
            )
        })?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(self.with_permissions(round, &decision, ctx)))
    }

    pub async fn delete_action(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        round_id: Uuid,
        action_id: Uuid,
    ) -> Result<ObjectResponse<WardRoundDetail>, ApiError> {
        let (_patient, decision) = self.load_patient_for_chronicle(ctx, patient_id).await?;
        self.require_write(ctx, &decision)?;
        let round = hms_db::ward_rounds::delete_ward_round_action(
            self.pool(),
            self.facility_id(),
            patient_id,
            round_id,
            action_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_round_action_delete_failed",
                "Ward Round action could not be deleted.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "ward_round_action_not_found",
                "Ward Round action was not found.",
            )
        })?;
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(self.with_permissions(round, &decision, ctx)))
    }

    pub async fn commit(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
        round_id: Uuid,
        payload: CommitWardRoundRequest,
    ) -> Result<ObjectResponse<CommitWardRoundResponse>, ApiError> {
        let (_patient, decision) = self.load_patient_for_chronicle(ctx, patient_id).await?;
        self.require_write(ctx, &decision)?;
        let existing = hms_db::ward_rounds::get_ward_round(
            self.pool(),
            self.facility_id(),
            patient_id,
            round_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("ward_round_load_failed", "Ward Round could not be loaded.")
        })?
        .ok_or_else(|| ApiError::not_found("ward_round_not_found", "Ward Round was not found."))?;
        if existing.status != WardRoundStatus::Draft {
            return Err(ApiError::conflict(
                "ward_round_not_draft",
                "Only draft Ward Rounds can be committed.",
            ));
        }
        if existing.version != payload.expected_version {
            return Err(ApiError::conflict(
                "ward_round_stale_version",
                "Ward Round draft version is stale.",
            ));
        }
        for action in existing
            .actions
            .iter()
            .filter(|action| action.status == WardRoundActionStatus::Draft)
        {
            self.require_action_permission(ctx, action.action_type)?;
        }
        let round = hms_db::ward_rounds::commit_ward_round(
            self.pool(),
            self.facility_id(),
            patient_id,
            round_id,
            payload.expected_version,
            ctx.user_id,
        )
        .await
        .map_err(map_commit_error)?
        .ok_or_else(|| ApiError::not_found("ward_round_not_found", "Ward Round was not found."))?;
        let round = self.with_permissions(round, &decision, ctx);
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(CommitWardRoundResponse {
            created_artifacts: round.artifacts.clone(),
            ward_round: round,
        }))
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    async fn load_patient_for_chronicle(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
    ) -> Result<(PatientRecord, ClinicalPatientAccessDecision), ApiError> {
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

    fn with_permissions(
        &self,
        mut round: WardRoundDetail,
        decision: &ClinicalPatientAccessDecision,
        ctx: &hms_access::RequestContext,
    ) -> WardRoundDetail {
        let can_write = !decision.read_only
            && hms_access::require_clinical_write_access(ctx, self.facility_id()).is_ok();
        let is_draft = round.status == WardRoundStatus::Draft;
        round.permissions = WardRoundPermissions {
            can_view: true,
            can_edit_draft: can_write && is_draft,
            can_commit: can_write && is_draft,
            can_add_prescription: can_write && is_draft,
            can_order_labs: is_draft
                && !decision.read_only
                && hms_access::require_lab_access(
                    ctx,
                    self.facility_id(),
                    PermissionCode::LaboratoryOrderManage,
                )
                .is_ok(),
            can_create_nursing_task: is_draft
                && !decision.read_only
                && hms_access::require_patient_workflow_access(
                    ctx,
                    self.facility_id(),
                    PermissionCode::NursingTaskManage,
                )
                .is_ok(),
            can_request_discharge: is_draft
                && !decision.read_only
                && hms_access::require_patient_workflow_access(
                    ctx,
                    self.facility_id(),
                    PermissionCode::AdmissionManage,
                )
                .is_ok(),
            read_only: decision.read_only,
        };
        round
    }
}

impl AppState {
    pub fn ward_rounds_service(&self) -> WardRoundsService {
        WardRoundsService::new(self.clone())
    }
}

fn map_commit_error(error: anyhow::Error) -> ApiError {
    let message = error.to_string();
    if message.contains("ward_round_stale_version") {
        return ApiError::conflict(
            "ward_round_stale_version",
            "Ward Round draft version is stale.",
        );
    }
    if message.contains("ward_round_inactive_admission") {
        return ApiError::conflict(
            "active_admission_required",
            "Ward Round requires an active admission for this patient.",
        );
    }
    if message.contains("ward_round_not_draft") {
        return ApiError::conflict(
            "ward_round_not_draft",
            "Only draft Ward Rounds can be committed.",
        );
    }
    ApiError::conflict(
        "ward_round_commit_failed",
        "Ward Round could not be committed.",
    )
}
