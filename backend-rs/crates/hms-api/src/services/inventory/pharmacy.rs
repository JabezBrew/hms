use hms_domain::deployment::PermissionCode;
use hms_domain::inventory::{
    CreatePharmacyDispenseRequest, InventoryListQuery, PharmacyDispenseListItem,
};

use super::common::{
    encode_cursor, load_patient_for_access, page_request, page_response, require_inventory_access,
    require_pharmacy_dispense_list_access, require_positive,
};
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct PharmacyService {
    state: AppState,
}

impl PharmacyService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_dispenses(
        &self,
        ctx: &hms_access::RequestContext,
        query: InventoryListQuery,
    ) -> Result<ListResponse<PharmacyDispenseListItem>, ApiError> {
        require_pharmacy_dispense_list_access(ctx, self.state.facility_id())?;
        let (cursor, page_size) = page_request(query)?;
        let rows = self
            .state
            .list_pharmacy_dispenses(cursor, i64::from(page_size) + 1)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "pharmacy_dispense_list_failed",
                    "Dispenses could not be loaded.",
                )
            })?;
        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.dispensed_at, item.id)
        }))
    }

    pub async fn create_dispense(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreatePharmacyDispenseRequest,
    ) -> Result<ObjectResponse<PharmacyDispenseListItem>, ApiError> {
        require_inventory_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::PharmacyDispense,
        )?;
        require_positive(payload.quantity, "quantity")?;
        let _patient = load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let dispense = self
            .state
            .create_pharmacy_dispense(
                payload.patient_id,
                payload.item_id,
                payload.location_id,
                payload.quantity,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "pharmacy_dispense_create_failed",
                    "Dispense could not be saved.",
                )
            })?;
        Ok(object(dispense))
    }
}
