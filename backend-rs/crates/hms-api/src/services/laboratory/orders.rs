use hms_db::laboratory::LabOrderListFilters;
use hms_domain::deployment::PermissionCode;
use hms_domain::laboratory::{
    CancelLabOrderRequest, CreateLabOrderRequest, LabOrderListItem, LaboratoryOrderListQuery,
};
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct LabOrdersService {
    state: AppState,
}

impl LabOrdersService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_orders(
        &self,
        ctx: &hms_access::RequestContext,
        query: LaboratoryOrderListQuery,
    ) -> Result<ListResponse<LabOrderListItem>, ApiError> {
        common::require_laboratory_list_access(ctx, self.state.facility_id())?;
        let (cursor, page_size) = common::page_request(query.cursor, query.limit)?;
        let rows = self
            .state
            .list_lab_orders(
                cursor,
                page_size as i64 + 1,
                LabOrderListFilters {
                    status: query.status,
                },
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_order_list_failed",
                    "Laboratory orders could not be loaded.",
                )
            })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.ordered_at, item.id)
        }))
    }

    pub async fn get_order(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<LabOrderListItem>, ApiError> {
        common::require_laboratory_list_access(ctx, self.state.facility_id())?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let order = self
            .state
            .get_lab_order(id)
            .await
            .map_err(|_| {
                ApiError::conflict("lab_order_load_failed", "Lab order could not be loaded.")
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_order_not_found", "Lab order was not found.")
            })?;

        Ok(object(order))
    }

    pub async fn create_order(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateLabOrderRequest,
    ) -> Result<ObjectResponse<LabOrderListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        if payload.test_ids.is_empty() && payload.panel_ids.is_empty() {
            return Err(common::validation_error(
                "tests",
                "At least one test or panel is required.",
            ));
        }
        let _patient =
            common::load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let order = self
            .state
            .create_lab_order(
                payload.patient_id,
                payload.test_ids,
                payload.panel_ids,
                payload.priority,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_order_create_failed",
                    "Laboratory order could not be created.",
                )
            })?;

        Ok(object(order))
    }

    pub async fn submit_order(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<LabOrderListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let order = self
            .state
            .submit_lab_order(id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_order_submit_failed",
                    "Lab order could not be submitted.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_order_not_found", "Lab order was not found.")
            })?;

        Ok(object(order))
    }

    pub async fn collect_order(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<LabOrderListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let order = self
            .state
            .collect_lab_order(id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_order_collect_failed",
                    "Lab order could not be marked as collected.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_order_not_found", "Lab order was not found.")
            })?;

        Ok(object(order))
    }

    pub async fn start_order_processing(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<LabOrderListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let order = self
            .state
            .start_lab_order_processing(id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_order_processing_start_failed",
                    "Lab order processing could not be started.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_order_not_found", "Lab order was not found.")
            })?;

        Ok(object(order))
    }

    pub async fn cancel_order(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CancelLabOrderRequest,
    ) -> Result<ObjectResponse<LabOrderListItem>, ApiError> {
        common::require_laboratory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let cancellation_reason =
            common::normalize_optional_text(payload.cancellation_reason, "cancellation_reason")?;
        let order = self
            .state
            .cancel_lab_order(id, ctx.user_id, cancellation_reason)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "lab_order_cancel_failed",
                    "Lab order could not be cancelled.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_order_not_found", "Lab order was not found.")
            })?;

        Ok(object(order))
    }
}
