use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{CreateWardStockRequestRequest, WardStockRequestListItem};
use serde_json::json;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct WardStockService {
    state: AppState,
}

impl WardStockService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_ward_stock_requests(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<WardStockRequestListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = self
            .state
            .list_ward_stock_requests(page.cursor, fetch_limit)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "ward_stock_request_list_failed",
                    "Ward stock requests could not be loaded.",
                )
            })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.requested_at, item.id)
        }))
    }

    pub async fn create_ward_stock_request(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateWardStockRequestRequest,
    ) -> Result<ObjectResponse<WardStockRequestListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let _ward = common::load_ward(&self.state, payload.ward_id).await?;
        let requested_item = required_text(payload.requested_item, "requested_item")?;
        if payload.quantity_requested <= 0 {
            return Err(ApiError::bad_request(
                "invalid_ward_stock_request",
                "Quantity requested must be greater than zero.",
            ));
        }
        let request = self
            .state
            .create_ward_stock_request(
                payload.ward_id,
                requested_item,
                payload.quantity_requested,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "ward_stock_request_create_failed",
                    "Ward stock request could not be created.",
                )
            })?;

        Ok(object(request))
    }

    pub async fn approve_ward_stock_request(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<WardStockRequestListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let request = self
            .state
            .approve_ward_stock_request(id, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "ward_stock_request_approve_failed",
                    "Ward stock request could not be approved.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found(
                    "ward_stock_request_not_found",
                    "Ward stock request was not found.",
                )
            })?;

        Ok(object(request))
    }

    pub async fn fulfill_ward_stock_request(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<WardStockRequestListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let request = self
            .state
            .fulfill_ward_stock_request(id, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "ward_stock_request_fulfill_failed",
                    "Ward stock request could not be fulfilled.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found(
                    "ward_stock_request_not_found",
                    "Ward stock request was not found.",
                )
            })?;

        Ok(object(request))
    }
}

fn required_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        let mut error = ApiError::bad_request("invalid_request", "Request is invalid.");
        error.details = json!({ field: ["This field is required."] });
        return Err(error);
    }
    Ok(value.to_owned())
}
