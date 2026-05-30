use hms_db::ward::{NewAdmission, NewAdmissionCase};
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
        let cacheable_hot_page = page.cursor.is_none() && query.patient_id.is_none();
        if cacheable_hot_page {
            if let Some(response) = self.state.cached_ward_board(ctx, query.ward_id, page_size) {
                return Ok(response);
            }
        }
        let rows = hms_db::ward::list_ward_board(
            self.state.db_pool(),
            self.state.facility_id(),
            query.ward_id,
            query.patient_id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| ApiError::conflict("ward_board_failed", "Ward board could not be loaded."))?;

        let response = common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.admitted_at, item.admission_id)
        });
        if cacheable_hot_page {
            self.state
                .put_cached_ward_board(ctx, query.ward_id, page_size, response.clone());
        }
        Ok(response)
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
        let admission = hms_db::ward::get_ward_board_admission(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
        )
        .await
        .map_err(|_| ApiError::conflict("admission_load_failed", "Admission could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("admission_not_found", "Admission was not found."))?;
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
        let rows = hms_db::ward::list_admission_cases(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
        )
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
        let admission_case = hms_db::ward::create_admission_case(
            self.state.db_pool(),
            NewAdmissionCase {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                patient_id: payload.patient_id,
                ward_id: payload.ward_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "admission_case_create_failed",
                "Admission case could not be created.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
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
        let admission_case = hms_db::ward::reserve_admission_bed(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            payload.bed_id,
            ctx.user_id,
        )
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

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
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
        let admission_case = hms_db::ward::activate_admission_case(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            ctx.user_id,
        )
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

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
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
        let admission_case = hms_db::ward::cancel_admission_case(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            ctx.user_id,
        )
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

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
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
        let admission = hms_db::ward::admit_patient(
            self.state.db_pool(),
            NewAdmission {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                patient_id: payload.patient_id,
                ward_id: payload.ward_id,
                bed_id: payload.bed_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("admission_create_failed", "Admission could not be created.")
        })?;

        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        Ok(object(admission))
    }
}
