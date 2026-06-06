use hms_db::laboratory::{LabOrderListFilters, NewLabOrder};
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

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_orders(
        &self,
        ctx: &hms_access::RequestContext,
        query: LaboratoryOrderListQuery,
    ) -> Result<ListResponse<LabOrderListItem>, ApiError> {
        common::require_laboratory_list_access(ctx, self.facility_id())?;
        let (cursor, page_size) = common::page_request(query.cursor, query.limit)?;
        let rows = hms_db::laboratory::list_orders(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
            LabOrderListFilters {
                status: query.status,
                search: query.search,
                priority: query.priority,
                ordering_provider: query.ordering_provider,
                ordered_by_user_id: query.my_orders.unwrap_or(false).then_some(ctx.user_id),
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
        common::require_laboratory_list_access(ctx, self.facility_id())?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let order = hms_db::laboratory::get_order_by_id(self.pool(), self.facility_id(), id)
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
            self.facility_id(),
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
        let care_context = common::validate_care_context(
            &self.state,
            payload.patient_id,
            payload.encounter_id,
            payload.visit_id,
        )
        .await?;
        let order = hms_db::laboratory::create_order(
            self.pool(),
            NewLabOrder {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                patient_id: payload.patient_id,
                encounter_id: care_context.encounter_id,
                visit_id: care_context.visit_id,
                test_ids: payload.test_ids,
                panel_ids: payload.panel_ids,
                priority: payload.priority,
                actor_user_id: ctx.user_id,
            },
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
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let order = hms_db::laboratory::submit_order(self.pool(), self.facility_id(), id)
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
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let order = hms_db::laboratory::collect_order(self.pool(), self.facility_id(), id)
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
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let order = hms_db::laboratory::start_order_processing(self.pool(), self.facility_id(), id)
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
            self.facility_id(),
            PermissionCode::LaboratoryOrderManage,
        )?;
        let _context = common::load_order_for_access(&self.state, ctx, id).await?;
        let cancellation_reason =
            common::normalize_optional_text(payload.cancellation_reason, "cancellation_reason")?;
        let order = hms_db::laboratory::cancel_order(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            cancellation_reason,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "lab_order_cancel_failed",
                "Lab order could not be cancelled.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("lab_order_not_found", "Lab order was not found."))?;

        Ok(object(order))
    }
}
