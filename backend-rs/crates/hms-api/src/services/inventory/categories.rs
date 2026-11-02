use super::common::{decode_page, encode_cursor, page_response, require_inventory_access};
use crate::{
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_access::RequestContext;
use hms_db::inventory::category_governance::{
    self as db, InventoryCategoryActor, InventoryCategoryError as E,
};
use hms_domain::{deployment::PermissionCode, inventory_categories::*};
use uuid::Uuid;
#[derive(Clone)]
pub struct InventoryCategoryService {
    state: AppState,
}
impl InventoryCategoryService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    fn actor(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
    ) -> Result<InventoryCategoryActor, ApiError> {
        require_inventory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::InventoryManage,
        )?;
        if !ctx.reauth_is_fresh_at(Utc::now()) {
            return Err(ApiError::forbidden(
                "reauth_required",
                "Confirm your current credentials before maintaining categories.",
            ));
        }
        Ok(InventoryCategoryActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: ctx.request_id.clone(),
            authorization: crate::services::clinical::prescription_courses::ordinary_authorization(
                ctx,
                deadline.min(ctx.reauth.required_after),
            )?,
        })
    }
    fn read_actor(&self, ctx: &RequestContext) -> Result<db::InventoryCategoryReadActor, ApiError> {
        let deadline = ctx.authorization_deadline.ok_or_else(|| {
            ApiError::forbidden(
                "inventory_category_authority_required",
                "Current inventory read authority is required.",
            )
        })?;
        Ok(db::InventoryCategoryReadActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: ctx.request_id.clone(),
            authorization: crate::services::clinical::prescription_courses::authorization(
                ctx, deadline,
            ),
        })
    }
    pub async fn command(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        input: InventoryCategoryReviewedInput,
    ) -> Result<ObjectResponse<InventoryCategoryCommandReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline)?;
        Ok(object(
            db::command(self.state.db_pool(), actor, input)
                .await
                .map_err(|e| error(e, true))?,
        ))
    }
    pub async fn receipt(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        key: Uuid,
    ) -> Result<ObjectResponse<InventoryCategoryCommandReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline)?;
        Ok(object(
            db::receipt(self.state.db_pool(), actor, key)
                .await
                .map_err(|e| error(e, false))?,
        ))
    }
    pub async fn detail(
        &self,
        ctx: &RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<InventoryCategoryAdministration>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        Ok(object(
            db::detail(self.state.db_pool(), self.read_actor(ctx)?, id)
                .await
                .map_err(|e| error(e, false))?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "inventory_category_not_found",
                        "The exact inventory category was not found.",
                    )
                })?,
        ))
    }
    pub async fn list(
        &self,
        ctx: &RequestContext,
        input: InventoryCategoryAdministrationQuery,
    ) -> Result<ListResponse<InventoryCategoryAdministrationListItem>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        bounded_search(input.search.as_deref())?;
        let (cursor, limit) = decode_page(input.cursor.as_deref(), input.limit)?;
        let rows = db::list(
            self.state.db_pool(),
            self.read_actor(ctx)?,
            cursor,
            i64::from(limit) + 1,
            input,
        )
        .await
        .map_err(|e| error(e, false))?;
        Ok(page_response(rows, limit, |v| {
            encode_cursor(v.created_at, v.id)
        }))
    }
    pub async fn history(
        &self,
        ctx: &RequestContext,
        id: Uuid,
        input: InventoryCategoryHistoryQuery,
    ) -> Result<ListResponse<InventoryCategoryHistoryRow>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        let (_, limit) = decode_page(None, input.limit)?;
        let (cursor, _) = decode_page(input.cursor.as_deref(), input.limit)?;
        let rows = db::history(
            self.state.db_pool(),
            self.read_actor(ctx)?,
            id,
            cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|e| error(e, false))?;
        Ok(page_response(rows, limit, |v| {
            encode_cursor(v.recorded_at, v.id)
        }))
    }
}
fn bounded_search(v: Option<&str>) -> Result<(), ApiError> {
    if v.is_some_and(|v| v.len() > 160) {
        Err(ApiError::bad_request(
            "invalid_inventory_category_filter",
            "Use a bounded supported inventory filter.",
        ))
    } else {
        Ok(())
    }
}
pub(super) fn error(e: anyhow::Error, write: bool) -> ApiError {
    if let Some(v) = e.downcast_ref::<E>() {
        return match v {
            E::Invalid => ApiError::bad_request("invalid_inventory_category_command", "Review the supported category fields, request reference and current version."),
            E::InvalidSource => ApiError::conflict("inventory_category_source_unavailable", "Review the current local parent and complete category chain."),
            E::NotFound => ApiError::not_found("inventory_category_not_found", "The exact category or original command was not found."),
            E::VersionConflict => ApiError::conflict("inventory_category_version_conflict", "The category changed. Refresh and review its current version."),
            E::RequestConflict => ApiError::conflict("inventory_category_request_conflict", "This request reference belongs to another reviewed category command."),
            E::CodeConflict => ApiError::conflict("inventory_category_code_conflict", "This category code is already recorded in the facility."),
            E::ItemReference | E::ChildReference => ApiError::conflict("inventory_category_referenced", "A retained item or current child category prevents this active-state change."),
            E::Authority => ApiError::forbidden("inventory_category_authority_required", "Current inventory authority, demographics and feature access are required."),
            E::Busy => ApiError::conflict("inventory_category_busy", "This category graph or request is in use. Keep the same request and review its original result."),
        };
    }
    if e.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
        || e.is::<hms_db::clinical::medication_access::MedicationAccessError>()
        || e.is::<hms_db::network::NetworkPublicationError>()
    {
        return ApiError::forbidden(
            "inventory_category_authority_required",
            "Current inventory authority, session and network proof are required.",
        );
    }
    if let Some(sql) = e.downcast_ref::<sqlx::Error>() {
        if let Some(v) = db::database_error(sql) {
            return error(v.into(), write);
        }
    }
    if write {
        ApiError::conflict("inventory_category_write_unconfirmed","The change could not be confirmed. Keep the unchanged request and review its original receipt before another change.")
    } else {
        ApiError::conflict(
            "inventory_category_read_failed",
            "The category or original result could not be loaded.",
        )
    }
}
