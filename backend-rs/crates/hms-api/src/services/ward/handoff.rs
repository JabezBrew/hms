use hms_db::ward::NewHandoff;
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{CreateHandoffRequest, HandoffListItem, HandoffListQuery};
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
        query: HandoffListQuery,
    ) -> Result<ListResponse<HandoffListItem>, ApiError> {
        hms_access::require_feature(ctx, hms_domain::deployment::FeatureKey::Nursing)
            .map_err(ApiError::from)?;
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        common::validate_nursing_list_range(query.created_from, query.created_before)?;
        if let Some(ward_id) = query.ward_id {
            let _ward = common::load_ward(&self.state, ward_id).await?;
        }
        let shift_label = query.shift_label.map(|value| value.trim().to_owned());
        if shift_label
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.chars().count() > 120)
        {
            return Err(ApiError::bad_request(
                "invalid_handoff_filter",
                "Use a nonempty shift label of at most 120 characters.",
            ));
        }
        let filters = hms_db::ward::HandoffFilters {
            ward_id: query.ward_id,
            shift_label,
            status: query.status,
            created_from: query.created_from,
            created_before: query.created_before,
            descending: query.descending.unwrap_or(false),
        };
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_handoffs_scoped(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
            filters,
        )
        .await
        .map_err(|_| ApiError::conflict("handoff_list_failed", "Handoffs could not be loaded."))?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_handoff(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateHandoffRequest,
    ) -> Result<ObjectResponse<HandoffListItem>, ApiError> {
        hms_access::require_feature(ctx, hms_domain::deployment::FeatureKey::Nursing)
            .map_err(ApiError::from)?;
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let shift_label = required_text(payload.shift_label, "shift_label")?;
        let handoff = hms_db::ward::create_handoff(
            self.state.db_pool(),
            NewHandoff {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                ward_id: payload.ward_id,
                from_user_id: ctx.user_id,
                to_user_id: payload.to_user_id,
                shift_label,
                request_id: Some(ctx.request_id.clone()),
            },
        )
        .await
        .map_err(|error| handoff_error(error, "handoff_create_unconfirmed"))?;

        Ok(object(handoff))
    }

    pub async fn complete_handoff(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<HandoffListItem>, ApiError> {
        hms_access::require_feature(ctx, hms_domain::deployment::FeatureKey::Nursing)
            .map_err(ApiError::from)?;
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let handoff = hms_db::ward::complete_handoff(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|error| handoff_error(error, "handoff_finalize_unconfirmed"))?
        .ok_or_else(|| ApiError::not_found("handoff_not_found", "Shift header was not found."))?;

        Ok(object(handoff))
    }
}

fn required_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 120 {
        let mut error = ApiError::bad_request("invalid_request", "Request is invalid.");
        error.details = json!({ field: ["Use one to 120 characters."] });
        return Err(error);
    }
    Ok(value.to_owned())
}

fn handoff_error(error: anyhow::Error, fallback: &'static str) -> ApiError {
    match error.downcast_ref::<hms_db::ward::HandoffError>() {
        Some(hms_db::ward::HandoffError::InvalidReference)=>ApiError::bad_request("invalid_handoff_reference","Select an active ward and active users from this facility."),
        Some(hms_db::ward::HandoffError::NotSender)=>ApiError::forbidden("handoff_sender_required","Only the sender may finalize this shift header."),
        Some(hms_db::ward::HandoffError::InvalidStatus)=>ApiError::conflict("handoff_status_invalid","This shift header cannot be finalized from its current status."),
        None=>ApiError::conflict(fallback,"The shift header change could not be confirmed. Refresh its records before trying again."),
    }
}
