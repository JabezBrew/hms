use super::common::{
    decode_page, encode_cursor, page_response, require_inventory_access,
    require_inventory_list_access,
};
use crate::{
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use hms_access::RequestContext;
use hms_db::inventory::{StandingTemplateError, TemplateActor};
use hms_domain::{deployment::PermissionCode, inventory_standing::*};
use uuid::Uuid;

#[derive(Clone)]
pub struct StandingOrderTemplateService {
    state: AppState,
}
impl StandingOrderTemplateService {
    pub async fn cancel_request(
        &self,
        ctx: &RequestContext,
        id: Uuid,
        data: StandingRequestAction,
    ) -> Result<ObjectResponse<RequisitionReview>, ApiError> {
        self.write_access(ctx)?;
        let saved = hms_db::inventory::cancel_standing_request(
            self.state.db_pool(),
            self.actor(ctx),
            id,
            data,
        )
        .await
        .map_err(|e| write_error(e, "standing_request_cancel_unconfirmed"))?
        .ok_or_else(|| {
            ApiError::not_found(
                "requisition_review_not_found",
                "No governed line-backed requisition was found.",
            )
        })?;
        Ok(object(saved))
    }
    pub async fn approve_request(
        &self,
        ctx: &RequestContext,
        id: Uuid,
        data: StandingRequestAction,
    ) -> Result<ObjectResponse<RequisitionReview>, ApiError> {
        self.write_access(ctx)?;
        let saved = hms_db::inventory::approve_standing_request(
            self.state.db_pool(),
            self.actor(ctx),
            id,
            data,
        )
        .await
        .map_err(|e| write_error(e, "standing_request_approve_unconfirmed"))?
        .ok_or_else(|| {
            ApiError::not_found(
                "requisition_review_not_found",
                "No governed line-backed requisition was found.",
            )
        })?;
        Ok(object(saved))
    }
    pub async fn issue_request(
        &self,
        ctx: &RequestContext,
        id: Uuid,
        data: StandingRequestAction,
    ) -> Result<ObjectResponse<RequisitionReview>, ApiError> {
        self.write_access(ctx)?;
        let saved = hms_db::inventory::issue_standing_request(
            self.state.db_pool(),
            self.actor(ctx),
            id,
            data,
        )
        .await
        .map_err(|e| write_error(e, "standing_request_issue_unconfirmed"))?
        .ok_or_else(|| {
            ApiError::not_found(
                "requisition_review_not_found",
                "No governed line-backed requisition was found.",
            )
        })?;
        Ok(object(saved))
    }
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    fn actor(&self, ctx: &RequestContext) -> TemplateActor {
        TemplateActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
        }
    }
    fn write_access(&self, ctx: &RequestContext) -> Result<(), ApiError> {
        require_inventory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::InventoryManage,
        )
    }
    pub async fn list(
        &self,
        ctx: &RequestContext,
        query: StandingTemplateListQuery,
    ) -> Result<ListResponse<StandingTemplateListItem>, ApiError> {
        require_inventory_list_access(ctx, self.state.facility_id())?;
        if query.search.as_deref().is_some_and(|s| s.len() > 200) {
            return Err(ApiError::bad_request(
                "standing_template_search_invalid",
                "Use a search of at most 200 bytes.",
            ));
        }
        let (cursor, size) = decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::inventory::list_standing_templates(
            self.state.db_pool(),
            self.state.facility_id(),
            cursor,
            i64::from(size) + 1,
            query,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "standing_templates_unavailable",
                "Standing templates could not be loaded.",
            )
        })?;
        Ok(page_response(rows, size, |row| {
            encode_cursor(row.created_at, row.id)
        }))
    }
    pub async fn detail(
        &self,
        ctx: &RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<StandingTemplateDetail>, ApiError> {
        require_inventory_list_access(ctx, self.state.facility_id())?;
        let saved = hms_db::inventory::get_standing_template(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "standing_template_unavailable",
                "The standing template could not be loaded.",
            )
        })?
        .ok_or_else(not_found)?;
        Ok(object(saved))
    }
    pub async fn create(
        &self,
        ctx: &RequestContext,
        data: CreateStandingTemplateRequest,
    ) -> Result<ObjectResponse<StandingTemplateDetail>, ApiError> {
        self.write_access(ctx)?;
        let saved = hms_db::inventory::create_standing_template(
            self.state.db_pool(),
            self.actor(ctx),
            data,
        )
        .await
        .map_err(|e| write_error(e, "standing_template_create_unconfirmed"))?;
        Ok(object(saved))
    }
    pub async fn update(
        &self,
        ctx: &RequestContext,
        id: Uuid,
        data: UpdateStandingTemplateRequest,
    ) -> Result<ObjectResponse<StandingTemplateDetail>, ApiError> {
        self.write_access(ctx)?;
        let saved = hms_db::inventory::update_standing_template(
            self.state.db_pool(),
            self.actor(ctx),
            id,
            data,
        )
        .await
        .map_err(|e| write_error(e, "standing_template_update_unconfirmed"))?
        .ok_or_else(not_found)?;
        Ok(object(saved))
    }
    pub async fn status(
        &self,
        ctx: &RequestContext,
        id: Uuid,
        data: StandingTemplateStatusRequest,
    ) -> Result<ObjectResponse<StandingTemplateDetail>, ApiError> {
        self.write_access(ctx)?;
        let saved = hms_db::inventory::change_standing_template_status(
            self.state.db_pool(),
            self.actor(ctx),
            id,
            data,
        )
        .await
        .map_err(|e| write_error(e, "standing_template_status_unconfirmed"))?
        .ok_or_else(not_found)?;
        Ok(object(saved))
    }
    pub async fn generate(
        &self,
        ctx: &RequestContext,
        id: Uuid,
        data: GenerateStandingTemplateRequest,
    ) -> Result<ObjectResponse<RequisitionReview>, ApiError> {
        self.write_access(ctx)?;
        let saved = hms_db::inventory::generate_standing_template_run(
            self.state.db_pool(),
            self.actor(ctx),
            id,
            data,
        )
        .await
        .map_err(|e| write_error(e, "standing_template_run_unconfirmed"))?
        .ok_or_else(not_found)?;
        Ok(object(saved))
    }
    pub async fn review(
        &self,
        ctx: &RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<RequisitionReview>, ApiError> {
        require_inventory_list_access(ctx, self.state.facility_id())?;
        let saved = hms_db::inventory::get_requisition_review(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "requisition_review_unavailable",
                "The saved requisition could not be reviewed.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "requisition_review_not_found",
                "No governed line-backed requisition was found.",
            )
        })?;
        Ok(object(saved))
    }
}
fn not_found() -> ApiError {
    ApiError::not_found(
        "standing_template_not_found",
        "Standing template was not found.",
    )
}
fn write_error(error: anyhow::Error, fallback: &'static str) -> ApiError {
    if let Some(reason) = error.downcast_ref::<hms_db::inventory::StandingRequestError>() {
        use hms_db::inventory::StandingRequestError as E;
        let code = match reason {
            E::VersionConflict => "standing_request_version_conflict",
            E::NotActionable => "standing_request_not_actionable",
            E::NotApproved => "standing_request_not_approved",
            E::ReferencesUnavailable => "standing_request_references_unavailable",
            E::UnitChanged => "standing_request_unit_changed",
            E::InsufficientStock => "standing_request_stock_unavailable",
            E::TooFragmented => "standing_request_batch_limit",
            E::IncompleteEvidence => "standing_request_incomplete",
        };
        return ApiError::conflict(code, reason.message());
    }
    if let Some(reason) = error.downcast_ref::<StandingTemplateError>() {
        let code = match reason {
            StandingTemplateError::InvalidInput => {
                return ApiError::bad_request("standing_template_invalid", reason.message());
            }
            StandingTemplateError::ReferencesUnavailable => {
                "standing_template_references_unavailable"
            }
            StandingTemplateError::VersionConflict => "standing_template_version_conflict",
            StandingTemplateError::Terminal => "standing_template_cancelled",
            StandingTemplateError::NotDue => "standing_template_not_due",
            StandingTemplateError::OccurrenceChanged => "standing_template_occurrence_changed",
            StandingTemplateError::UnitChanged => "standing_template_unit_changed",
            StandingTemplateError::IncompleteSnapshot => "standing_template_incomplete",
        };
        return ApiError::conflict(code, reason.message());
    }
    ApiError::conflict(
        fallback,
        "The save could not be confirmed. Refresh the saved template and requisition records before continuing.",
    )
}
