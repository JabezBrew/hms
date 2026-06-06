use chrono::Utc;
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    CancelDischargeRequest, CreateDischargeRequest, DischargeBlockerKind, DischargeCaseListItem,
    DischargeStatus,
};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct DischargeCasesService {
    state: AppState,
}

const MAX_BLOCKER_REASON_LEN: usize = 500;
const MAX_NURSING_RELEASE_TEXT_LEN: usize = 2_000;

impl DischargeCasesService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_discharges(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<DischargeCaseListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_discharge_cases(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("discharge_list_failed", "Discharges could not be loaded.")
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.requested_at, item.id)
        }))
    }

    pub async fn get_discharge(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<DischargeCaseListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let discharge =
            hms_db::ward::get_discharge_case(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict("discharge_load_failed", "Discharge could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("discharge_not_found", "Discharge was not found.")
                })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, discharge.patient_id).await?;
        Ok(object(discharge))
    }

    pub async fn request_discharge(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateDischargeRequest,
    ) -> Result<ObjectResponse<DischargeCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let care_context = common::validate_care_context(
            &self.state,
            admission.patient_id,
            payload.encounter_id,
            payload.visit_id,
        )
        .await?;
        if let (Some(existing), Some(supplied)) =
            (admission.encounter_id, care_context.encounter_id)
        {
            if existing != supplied {
                return Err(ApiError::bad_request(
                    "invalid_encounter",
                    "Encounter does not belong to the supplied admission.",
                ));
            }
        }
        if let (Some(existing), Some(supplied)) = (admission.visit_id, care_context.visit_id) {
            if existing != supplied {
                return Err(ApiError::bad_request(
                    "invalid_visit",
                    "Visit does not belong to the supplied admission.",
                ));
            }
        }
        let discharge = hms_db::ward::request_discharge(
            self.state.db_pool(),
            Uuid::new_v4(),
            self.state.facility_id(),
            &admission,
            care_context.encounter_id,
            care_context.visit_id,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "discharge_create_failed",
                "Discharge could not be requested.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(discharge))
    }

    pub async fn cancel_discharge(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CancelDischargeRequest,
    ) -> Result<ObjectResponse<DischargeCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        common::validate_optional_text(
            payload.reason.as_deref(),
            common::MAX_DISCHARGE_REASON_LEN,
        )?;
        let existing =
            hms_db::ward::get_discharge_case(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict("discharge_load_failed", "Discharge could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("discharge_not_found", "Discharge was not found.")
                })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        if existing.status == DischargeStatus::Completed {
            return Err(ApiError::conflict(
                "discharge_cancel_invalid_status",
                "Completed discharges cannot be cancelled.",
            ));
        }
        let discharge =
            hms_db::ward::cancel_discharge(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "discharge_cancel_failed",
                        "Discharge could not be cancelled.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::conflict(
                        "discharge_cancel_invalid_status",
                        "Discharge could not be cancelled in its current state.",
                    )
                })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(discharge))
    }

    pub async fn record_nursing_release(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        education: String,
        instructions: String,
    ) -> Result<ObjectResponse<DischargeCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let education = common::normalize_required_text(
            Some(education),
            "education",
            MAX_NURSING_RELEASE_TEXT_LEN,
        )?;
        let instructions = common::normalize_required_text(
            Some(instructions),
            "instructions",
            MAX_NURSING_RELEASE_TEXT_LEN,
        )?;
        let existing =
            hms_db::ward::get_discharge_case(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict("discharge_load_failed", "Discharge could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("discharge_not_found", "Discharge was not found.")
                })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let discharge = hms_db::ward::record_nursing_release(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            education,
            instructions,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "discharge_nursing_release_failed",
                "Nursing release could not be recorded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "discharge_nursing_release_invalid_status",
                "Nursing release could not be recorded for this discharge.",
            )
        })?;

        Ok(object(discharge))
    }

    pub async fn hold_blocker(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        blocker_type: DischargeBlockerKind,
        reason: String,
    ) -> Result<ObjectResponse<DischargeCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        if !matches!(
            blocker_type,
            DischargeBlockerKind::BillingClearance | DischargeBlockerKind::PharmacyClearance
        ) {
            return Err(ApiError::bad_request(
                "invalid_discharge_blocker_hold",
                "Only billing and pharmacy blockers can be held.",
            ));
        }
        let reason =
            common::normalize_required_text(Some(reason), "reason", MAX_BLOCKER_REASON_LEN)?;
        let existing =
            hms_db::ward::get_discharge_case(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict("discharge_load_failed", "Discharge could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("discharge_not_found", "Discharge was not found.")
                })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let discharge = hms_db::ward::hold_discharge_blocker(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            blocker_type,
            reason,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "discharge_blocker_hold_failed",
                "Blocker could not be held.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "discharge_blocker_hold_invalid_status",
                "Blocker could not be held for this discharge.",
            )
        })?;

        Ok(object(discharge))
    }

    pub async fn override_blocker(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        blocker_type: DischargeBlockerKind,
        reason: String,
    ) -> Result<ObjectResponse<DischargeCaseListItem>, ApiError> {
        hms_access::require_high_risk_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
            Utc::now(),
        )?;
        let reason =
            common::normalize_required_text(Some(reason), "reason", MAX_BLOCKER_REASON_LEN)?;
        let existing =
            hms_db::ward::get_discharge_case(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict("discharge_load_failed", "Discharge could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("discharge_not_found", "Discharge was not found.")
                })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let discharge = hms_db::ward::override_discharge_blocker(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            blocker_type,
            reason,
            ctx.user_id,
            ctx.reauth.verified_at.unwrap_or_else(Utc::now),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "discharge_blocker_override_failed",
                "Blocker could not be overridden.",
            )
        })?
        .ok_or_else(|| {
            ApiError::conflict(
                "discharge_blocker_override_invalid_status",
                "Blocker could not be overridden for this discharge.",
            )
        })?;

        Ok(object(discharge))
    }

    pub async fn complete_discharge(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<DischargeCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let existing =
            hms_db::ward::get_discharge_case(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict("discharge_load_failed", "Discharge could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("discharge_not_found", "Discharge was not found.")
                })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let discharge =
            hms_db::ward::complete_discharge(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "discharge_complete_failed",
                        "Discharge could not be completed.",
                    )
                })?
                .ok_or_else(|| {
                    ApiError::not_found("discharge_not_found", "Discharge was not found.")
                })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        self.state.invalidate_patient_chronicle_cache();
        Ok(object(discharge))
    }
}
