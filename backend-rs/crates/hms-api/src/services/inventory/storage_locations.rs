use super::common::{decode_page, encode_cursor, page_response, require_inventory_access};
use crate::{
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_access::RequestContext;
use hms_db::inventory::storage_locations::{
    self as db, StorageLocationActor, StorageLocationError as E,
};
use hms_domain::{deployment::PermissionCode, storage_locations::*};
use uuid::Uuid;
#[derive(Clone)]
pub struct StorageLocationService {
    state: AppState,
}
impl StorageLocationService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    fn actor(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
    ) -> Result<StorageLocationActor, ApiError> {
        require_inventory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::InventoryManage,
        )?;
        if !ctx.reauth.is_fresh_at(Utc::now()) {
            return Err(ApiError::forbidden(
                "reauth_required",
                "Confirm your current credentials before maintaining storage locations.",
            ));
        }
        Ok(StorageLocationActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: ctx.request_id.clone(),
            authorization: crate::services::clinical::prescription_courses::authorization(
                ctx,
                deadline.min(ctx.reauth.required_after),
            ),
        })
    }
    pub async fn command(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        input: StorageLocationReviewedInput,
    ) -> Result<ObjectResponse<StorageLocationCommandReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline)?;
        Ok(object(
            db::execute(self.state.db_pool(), actor, input)
                .await
                .map_err(|e| error(e, true))?,
        ))
    }
    pub async fn receipt(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        key: Uuid,
    ) -> Result<ObjectResponse<StorageLocationCommandReceipt>, ApiError> {
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
    ) -> Result<ObjectResponse<GovernedStorageLocation>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        Ok(object(
            db::detail(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|e| error(e, false))?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "storage_location_not_found",
                        "The storage location was not found.",
                    )
                })?,
        ))
    }
    pub async fn list(
        &self,
        ctx: &RequestContext,
        input: StorageLocationAdministrationQuery,
    ) -> Result<ListResponse<GovernedStorageLocation>, ApiError> {
        require_inventory_access(ctx, self.state.facility_id(), PermissionCode::InventoryView)?;
        let (cursor, limit) = decode_page(input.cursor.as_deref(), input.limit)?;
        if input.search.as_ref().is_some_and(|v| v.len() > 160)
            || input.location_type.as_ref().is_some_and(|v| v.len() > 48)
            || input
                .temperature_zone
                .as_ref()
                .is_some_and(|v| v.len() > 48)
        {
            return Err(ApiError::bad_request(
                "invalid_storage_location_filter",
                "Use a bounded supported location filter.",
            ));
        }
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
}
fn error(e: anyhow::Error, write: bool) -> ApiError {
    if let Some(v) = e.downcast_ref::<E>() {
        return match v{
 E::Invalid=>ApiError::bad_request("invalid_storage_location_command","Review the supported fields, non-empty request reference and current version."),
 E::NotFound=>ApiError::not_found("storage_location_not_found","The exact storage location or original command was not found."),
 E::VersionConflict=>ApiError::conflict("storage_location_version_conflict","The location changed. Refresh and review its current version."),
 E::RequestConflict=>ApiError::conflict("storage_location_request_conflict","This request reference belongs to another reviewed location command."),
 E::OperationalHistory=>ApiError::conflict("storage_location_has_operational_history","This workflow changes active state only for unused locations. Recorded stock or operational history requires a separate closeout workflow."),
 E::Authority=>ApiError::forbidden("storage_location_authority_required","Current inventory management, demographics and Inventory feature access are required."),
 E::Busy=>ApiError::conflict("storage_location_busy","This location or request is in use. Keep the same request and review its original result."),};
    }
    if e.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
        || e.is::<hms_db::clinical::medication_access::MedicationAccessError>()
        || e.is::<hms_db::network::NetworkPublicationError>()
    {
        return ApiError::forbidden(
            "storage_location_authority_required",
            "Current inventory authority, session and network proof are required.",
        );
    }
    if e.downcast_ref::<sqlx::Error>()
        .and_then(sqlx::Error::as_database_error)
        .is_some_and(|d| d.is_unique_violation())
    {
        return ApiError::conflict(
            "storage_location_code_conflict",
            "This location code is already recorded in the facility.",
        );
    }
    if write {
        ApiError::conflict("storage_location_write_unconfirmed","The change could not be confirmed. Keep the unchanged request and review its original receipt before another change.")
    } else {
        ApiError::conflict(
            "storage_location_read_failed",
            "The storage location or original result could not be loaded.",
        )
    }
}
