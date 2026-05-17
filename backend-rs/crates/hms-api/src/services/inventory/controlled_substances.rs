use chrono::Utc;
use hms_db::inventory::{NewControlledCount, NewControlledMovement};
use hms_domain::deployment::PermissionCode;
use hms_domain::inventory::{
    ControlledSubstanceBalanceValidation, ControlledSubstanceRegisterEntryItem,
    ControlledSubstanceRegisterItem, CreateControlledSubstanceCountRequest,
    CreateControlledSubstanceMovementRequest, InventoryListQuery,
};
use uuid::Uuid;

use super::common::{
    encode_cursor, page_request, page_response, require_inventory_access, require_non_negative,
    validation_error,
};
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct ControlledSubstancesService {
    state: AppState,
}

impl ControlledSubstancesService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_register(
        &self,
        ctx: &hms_access::RequestContext,
        query: InventoryListQuery,
    ) -> Result<ListResponse<ControlledSubstanceRegisterItem>, ApiError> {
        require_controlled_access(ctx, self.facility_id())?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::inventory::list_controlled_register(
            self.pool(),
            self.facility_id(),
            cursor,
            i64::from(page_size) + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "controlled_register_list_failed",
                "Controlled register could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn get_register_entry(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ControlledSubstanceRegisterItem>, ApiError> {
        require_controlled_access(ctx, self.facility_id())?;
        Ok(object(
            load_controlled_entry(self.pool(), self.facility_id(), id).await?,
        ))
    }

    pub async fn list_register_entries(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        query: InventoryListQuery,
    ) -> Result<ListResponse<ControlledSubstanceRegisterEntryItem>, ApiError> {
        require_controlled_access(ctx, self.facility_id())?;
        let _entry = load_controlled_entry(self.pool(), self.facility_id(), id).await?;
        let (cursor, page_size) = page_request(query)?;
        let rows = hms_db::inventory::list_controlled_register_entries(
            self.pool(),
            self.facility_id(),
            id,
            cursor,
            i64::from(page_size) + 1,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "controlled_register_entries_failed",
                "Controlled register entries could not be loaded.",
            )
        })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn validate_register_balance(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ControlledSubstanceBalanceValidation>, ApiError> {
        require_controlled_access(ctx, self.facility_id())?;
        let validation = hms_db::inventory::validate_controlled_register_balance(
            self.pool(),
            self.facility_id(),
            id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "controlled_balance_validation_failed",
                "Controlled register balance could not be validated.",
            )
        })?
        .ok_or_else(controlled_not_found)?;
        Ok(object(validation))
    }

    pub async fn create_count(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: CreateControlledSubstanceCountRequest,
    ) -> Result<ObjectResponse<ControlledSubstanceRegisterItem>, ApiError> {
        require_controlled_write_access(ctx, self.facility_id())?;
        require_non_negative(payload.actual_count, "actual_count")?;
        let witness_user_id = payload
            .witness_user_id
            .ok_or_else(|| validation_error("witness_user_id", "Witness is required."))?;
        let _entry = load_controlled_entry(self.pool(), self.facility_id(), id).await?;
        let entry = hms_db::inventory::create_controlled_count(
            self.pool(),
            NewControlledCount {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                register_entry_id: id,
                actual_count: payload.actual_count,
                witness_user_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "controlled_count_create_failed",
                "Controlled count could not be saved.",
            )
        })?;
        Ok(object(entry))
    }

    pub async fn create_movement(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateControlledSubstanceMovementRequest,
    ) -> Result<ObjectResponse<ControlledSubstanceRegisterItem>, ApiError> {
        require_controlled_write_access(ctx, self.facility_id())?;
        if payload.quantity_delta == 0 {
            return Err(validation_error(
                "quantity_delta",
                "This value cannot be zero.",
            ));
        }
        if payload.quantity_delta < 0 && payload.witness_user_id.is_none() {
            return Err(validation_error("witness_user_id", "Witness is required."));
        }
        let entry = hms_db::inventory::create_controlled_movement(
            self.pool(),
            NewControlledMovement {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                item_id: payload.item_id,
                location_id: payload.location_id,
                movement_type: payload.movement_type,
                quantity_delta: payload.quantity_delta,
                witness_user_id: payload.witness_user_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "controlled_register_create_failed",
                "Controlled register entry could not be saved.",
            )
        })?;
        Ok(object(entry))
    }
}

fn require_controlled_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    require_inventory_access(ctx, facility_id, PermissionCode::ControlledSubstanceManage)
}

fn require_controlled_write_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    require_controlled_access(ctx, facility_id)?;
    hms_access::require_high_risk_facility_permission(
        ctx,
        facility_id,
        PermissionCode::ControlledSubstanceManage,
        Utc::now(),
    )
    .map_err(ApiError::from)
}

async fn load_controlled_entry(
    pool: &hms_db::PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> Result<ControlledSubstanceRegisterItem, ApiError> {
    hms_db::inventory::get_controlled_register_entry(pool, facility_id, id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "controlled_register_load_failed",
                "Controlled register entry could not be loaded.",
            )
        })?
        .ok_or_else(controlled_not_found)
}

fn controlled_not_found() -> ApiError {
    ApiError::not_found(
        "controlled_register_not_found",
        "Controlled register entry could not be found.",
    )
}
