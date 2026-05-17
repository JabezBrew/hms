use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    CancelDischargeRequest, CreateDischargeRequest, DischargeCaseListItem, DischargeStatus,
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
        let rows = self
            .state
            .list_discharge_cases(page.cursor, fetch_limit)
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
        let discharge = self
            .state
            .get_discharge_case(id)
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
        let discharge = self
            .state
            .request_discharge(&admission, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "discharge_create_failed",
                    "Discharge could not be requested.",
                )
            })?;

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
        let existing = self
            .state
            .get_discharge_case(id)
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
        let discharge = self
            .state
            .cancel_discharge(id)
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
        let existing = self
            .state
            .get_discharge_case(id)
            .await
            .map_err(|_| {
                ApiError::conflict("discharge_load_failed", "Discharge could not be loaded.")
            })?
            .ok_or_else(|| {
                ApiError::not_found("discharge_not_found", "Discharge was not found.")
            })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let discharge = self
            .state
            .complete_discharge(id)
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

        Ok(object(discharge))
    }
}
