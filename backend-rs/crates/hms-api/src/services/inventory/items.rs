use super::common::{decode_page, encode_cursor, page_response, require_inventory_access};
use crate::{
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use hms_access::RequestContext;
use hms_db::inventory::items::{
    self as db, InventoryItemActor, InventoryItemError as E, InventoryItemHistoryCursor,
};
use hms_domain::{
    deployment::PermissionCode, inventory::InventoryCategoryListItem, inventory_items::*,
};
use uuid::Uuid;
#[derive(Clone)]
pub struct InventoryItemService {
    state: AppState,
}
impl InventoryItemService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    fn actor(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
    ) -> Result<InventoryItemActor, ApiError> {
        require_inventory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::InventoryManage,
        )?;
        if !ctx.reauth_is_fresh_at(Utc::now()) {
            return Err(ApiError::forbidden(
                "reauth_required",
                "Confirm your current credentials before maintaining the item catalog.",
            ));
        }
        Ok(InventoryItemActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: ctx.request_id.clone(),
            authorization: crate::services::clinical::prescription_courses::ordinary_authorization(
                ctx,
                deadline.min(ctx.reauth.required_after),
            )?,
        })
    }
    pub async fn command(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        input: InventoryItemReviewedInput,
    ) -> Result<ObjectResponse<InventoryItemCommandReceipt>, ApiError> {
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
    ) -> Result<ObjectResponse<InventoryItemCommandReceipt>, ApiError> {
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
    ) -> Result<ObjectResponse<InventoryItemAdministration>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        Ok(object(
            db::detail(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|e| error(e, false))?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "inventory_item_not_found",
                        "The exact inventory item was not found.",
                    )
                })?,
        ))
    }
    pub async fn list(
        &self,
        ctx: &RequestContext,
        input: InventoryItemAdministrationQuery,
    ) -> Result<ListResponse<GovernedInventoryItem>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        bounded_search(input.search.as_deref())?;
        let (cursor, limit) = decode_page(input.cursor.as_deref(), input.limit)?;
        let rows = db::list(
            self.state.db_pool(),
            self.state.facility_id(),
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
        input: InventoryItemHistoryQuery,
    ) -> Result<ListResponse<InventoryItemHistoryRow>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        let (_, limit) = decode_page(None, input.limit)?;
        let cursor = decode_history(input.cursor.as_deref())?;
        let rows = db::history(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            cursor,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|e| error(e, false))?;
        Ok(page_response(rows, limit, |v| {
            encode_history(v.cursor_facts())
        }))
    }
    pub async fn categories(
        &self,
        ctx: &RequestContext,
        input: InventoryCategoriesQuery,
    ) -> Result<ListResponse<InventoryCategoryListItem>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        bounded_search(input.search.as_deref())?;
        let limit = input.limit.unwrap_or(100).clamp(1, 100);
        let anchor = match input.cursor {
            None => None,
            Some(value) => {
                if value.len() > 80 {
                    return Err(invalid_cursor());
                }
                let id = value
                    .strip_prefix("category.v1.")
                    .and_then(|v| Uuid::parse_str(v).ok())
                    .filter(|v| !v.is_nil())
                    .ok_or_else(invalid_cursor)?;
                Some(id)
            }
        };
        let rows = db::categories(
            self.state.db_pool(),
            self.state.facility_id(),
            anchor,
            i64::from(limit) + 1,
            input.search.as_deref(),
        )
        .await
        .map_err(|e| error(e, false))?;
        Ok(page_response(rows, limit, |v| {
            format!("category.v1.{}", v.id)
        }))
    }
}
fn bounded_search(v: Option<&str>) -> Result<(), ApiError> {
    if v.is_some_and(|v| v.len() > 160) {
        Err(ApiError::bad_request(
            "invalid_inventory_item_filter",
            "Use a bounded supported inventory filter.",
        ))
    } else {
        Ok(())
    }
}
fn invalid_cursor() -> ApiError {
    ApiError::bad_request(
        "invalid_inventory_item_cursor",
        "Use the current supported page cursor.",
    )
}
fn encode_history((at, rank, id): (DateTime<Utc>, u8, Uuid)) -> String {
    URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&(1u8, at, rank, id)).expect("typed history cursor serializes"))
}
fn decode_history(value: Option<&str>) -> Result<Option<InventoryItemHistoryCursor>, ApiError> {
    let Some(value) = value else { return Ok(None) };
    if value.len() > 512 {
        return Err(invalid_cursor());
    }
    let data = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid_cursor())?;
    let (v, recorded_at, source_rank, id): (u8, DateTime<Utc>, u8, Uuid) =
        serde_json::from_slice(&data).map_err(|_| invalid_cursor())?;
    if v != 1 || source_rank > 1 || id.is_nil() {
        return Err(invalid_cursor());
    }
    Ok(Some(InventoryItemHistoryCursor {
        recorded_at,
        source_rank,
        id,
    }))
}
pub(super) fn error(e: anyhow::Error, write: bool) -> ApiError {
    if let Some(v) = e.downcast_ref::<E>() {
        return match v{
 E::Invalid=>ApiError::bad_request("invalid_inventory_item_command","Review the supported fields, date, request reference and current version."),
 E::InvalidSource=>ApiError::conflict("inventory_item_source_unavailable","Review current item and category configuration before continuing."),
 E::NotFound=>ApiError::not_found("inventory_item_not_found","The exact item or original command was not found."),
 E::VersionConflict=>ApiError::conflict("inventory_item_version_conflict","The catalog changed. Refresh and review its current version."),
 E::RequestConflict=>ApiError::conflict("inventory_item_request_conflict","This request reference belongs to another reviewed item command."),
 E::CodeConflict=>ApiError::conflict("inventory_item_code_conflict","This item code is already recorded in the facility."),
 E::OperationalHistory=>ApiError::conflict("inventory_item_has_operational_history","Recorded stock or clinical links prevent this unit or active-state change."),
 E::ControlledOrUnsupported=>ApiError::conflict("inventory_item_controlled_or_unsupported","This item classification does not support a unit or active-state change here."),
 E::Authority=>ApiError::forbidden("inventory_item_authority_required","Current inventory authority, demographics and feature access are required."),
 E::Busy=>ApiError::conflict("inventory_item_busy","This item or request is in use. Keep the same request and review its original result."),};
    }
    if e.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
        || e.is::<hms_db::clinical::medication_access::MedicationAccessError>()
        || e.is::<hms_db::network::NetworkPublicationError>()
    {
        return ApiError::forbidden(
            "inventory_item_authority_required",
            "Current inventory authority, session and network proof are required.",
        );
    }
    if let Some(sql) = e.downcast_ref::<sqlx::Error>() {
        if let Some(v) = db::database_error(sql) {
            return error(v.into(), write);
        }
    }
    if write {
        ApiError::conflict("inventory_item_write_unconfirmed","The change could not be confirmed. Keep the unchanged request and review its original receipt before another change.")
    } else {
        ApiError::conflict(
            "inventory_item_read_failed",
            "The item or original result could not be loaded.",
        )
    }
}
