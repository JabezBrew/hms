use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{CreateHandoffRequest, HandoffListItem};
use serde_json::json;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct HandoffService {
    state: AppState,
}

impl HandoffService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_handoffs(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<HandoffListItem>, ApiError> {
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
            .list_handoffs(page.cursor, fetch_limit)
            .await
            .map_err(|_| {
                ApiError::conflict("handoff_list_failed", "Handoffs could not be loaded.")
            })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_handoff(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateHandoffRequest,
    ) -> Result<ObjectResponse<HandoffListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let shift_label = required_text(payload.shift_label, "shift_label")?;
        let handoff = self
            .state
            .create_handoff(
                payload.ward_id,
                payload.to_user_id,
                shift_label,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict("handoff_create_failed", "Handoff could not be created.")
            })?;

        Ok(object(handoff))
    }

    pub async fn complete_handoff(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<HandoffListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        self.state
            .get_handoff(id)
            .await
            .map_err(|_| ApiError::conflict("handoff_load_failed", "Handoff could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("handoff_not_found", "Handoff was not found."))?;
        let handoff = self
            .state
            .complete_handoff(id)
            .await
            .map_err(|_| {
                ApiError::conflict("handoff_complete_failed", "Handoff could not be completed.")
            })?
            .ok_or_else(|| ApiError::not_found("handoff_not_found", "Handoff was not found."))?;

        Ok(object(handoff))
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
