use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    AdmissionCaseListItem, AdmitPatientRequest, CreateAdmissionCaseRequest,
    ReserveAdmissionBedRequest, WardBoardItem, WardBoardQuery,
};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct AdmissionCasesService {
    state: AppState,
}

impl AdmissionCasesService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn ward_board(
        &self,
        ctx: &hms_access::RequestContext,
        query: WardBoardQuery,
    ) -> Result<ListResponse<WardBoardItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::WardView,
        )?;
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = self
            .state
            .list_ward_board(query.ward_id, query.patient_id, page.cursor, fetch_limit)
            .await
            .map_err(|_| {
                ApiError::conflict("ward_board_failed", "Ward board could not be loaded.")
            })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.admitted_at, item.admission_id)
        }))
    }

    pub async fn get_admission(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<WardBoardItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let admission = self
            .state
            .get_ward_board_admission(id)
            .await
            .map_err(|_| {
                ApiError::conflict("admission_load_failed", "Admission could not be loaded.")
            })?
            .ok_or_else(|| {
                ApiError::not_found("admission_not_found", "Admission was not found.")
            })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, admission.patient_id).await?;
        Ok(object(admission))
    }

    pub async fn list_admission_cases(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<AdmissionCaseListItem>, ApiError> {
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
            .list_admission_cases(page.cursor, fetch_limit)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "admission_case_list_failed",
                    "Admission cases could not be loaded.",
                )
            })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_admission_case(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let admission_case = common::load_admission_case_for_access(&self.state, ctx, id).await?;
        Ok(object(admission_case))
    }

    pub async fn create_admission_case(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateAdmissionCaseRequest,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let _ward = common::load_ward(&self.state, payload.ward_id).await?;
        let admission_case = self
            .state
            .create_admission_case(payload.patient_id, payload.ward_id, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "admission_case_create_failed",
                    "Admission case could not be created.",
                )
            })?;

        Ok(object(admission_case))
    }

    pub async fn reserve_admission_bed(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: ReserveAdmissionBedRequest,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _existing = common::load_admission_case_for_access(&self.state, ctx, id).await?;
        let admission_case = self
            .state
            .reserve_admission_bed(id, payload.bed_id, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "admission_case_reserve_failed",
                    "Admission bed could not be reserved.",
                )
            })?
            .ok_or_else(|| {
                ApiError::conflict(
                    "admission_case_reserve_failed",
                    "Admission bed could not be reserved.",
                )
            })?;

        Ok(object(admission_case))
    }

    pub async fn activate_admission_case(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _existing = common::load_admission_case_for_access(&self.state, ctx, id).await?;
        let admission_case = self
            .state
            .activate_admission_case(id, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "admission_case_activate_failed",
                    "Admission case could not be activated.",
                )
            })?
            .ok_or_else(|| {
                ApiError::conflict(
                    "admission_case_activate_failed",
                    "Admission case could not be activated.",
                )
            })?;

        Ok(object(admission_case))
    }

    pub async fn cancel_admission_case(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<AdmissionCaseListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _existing = common::load_admission_case_for_access(&self.state, ctx, id).await?;
        let admission_case = self
            .state
            .cancel_admission_case(id, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "admission_case_cancel_failed",
                    "Admission case could not be cancelled.",
                )
            })?
            .ok_or_else(|| {
                ApiError::conflict(
                    "admission_case_cancel_failed",
                    "Admission case could not be cancelled.",
                )
            })?;

        Ok(object(admission_case))
    }

    pub async fn admit_patient(
        &self,
        ctx: &hms_access::RequestContext,
        payload: AdmitPatientRequest,
    ) -> Result<ObjectResponse<WardBoardItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let admission = self
            .state
            .admit_patient(
                payload.patient_id,
                payload.ward_id,
                payload.bed_id,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict("admission_create_failed", "Admission could not be created.")
            })?;

        Ok(object(admission))
    }
}
