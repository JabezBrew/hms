use hms_domain::deployment::PermissionCode;
use hms_domain::pharmacy::{
    DispensePharmacyFulfillmentRequest, PharmacyFulfillmentDispenseResult, PharmacyQueueItem,
    PharmacyQueueQuery,
};
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;

#[derive(Clone)]
pub struct PharmacyService {
    state: AppState,
}

impl PharmacyService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_queue(
        &self,
        ctx: &hms_access::RequestContext,
        query: PharmacyQueueQuery,
    ) -> Result<ListResponse<PharmacyQueueItem>, ApiError> {
        require_pharmacy_access(ctx, self.state.facility_id())?;
        let page = cursor_list::page_request(
            query.cursor.as_deref(),
            query.limit,
            DEFAULT_LIMIT,
            MAX_LIMIT,
            |occurred_at, id| hms_db::pharmacy::PharmacyCursor { occurred_at, id },
        )
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
        if let Some(patient_id) = query.patient_id {
            let _patient = load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::pharmacy::list_fulfillment_queue(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
            query.patient_id,
            query.status,
        )
        .await
        .map_err(|_| ApiError::conflict("pharmacy_queue_failed", "Queue could not be loaded."))?;
        Ok(cursor_list::page_response(rows, page.limit, |item| {
            cursor_list::encode_cursor(item.coverage_start, item.id)
        }))
    }

    pub async fn get_queue_item(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<PharmacyQueueItem>, ApiError> {
        require_pharmacy_access(ctx, self.state.facility_id())?;
        let item =
            hms_db::pharmacy::get_fulfillment(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict("pharmacy_queue_failed", "Queue item could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "pharmacy_fulfillment_not_found",
                        "Queue item was not found.",
                    )
                })?;
        let _patient = load_patient_for_access(&self.state, ctx, item.patient_id).await?;
        Ok(object(item))
    }

    pub async fn dispense(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: DispensePharmacyFulfillmentRequest,
    ) -> Result<ObjectResponse<PharmacyFulfillmentDispenseResult>, ApiError> {
        require_pharmacy_access(ctx, self.state.facility_id())?;
        if payload.quantity <= 0 {
            return Err(validation_error("quantity", "Quantity must be positive."));
        }
        let item =
            hms_db::pharmacy::get_fulfillment(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| {
                    ApiError::conflict("pharmacy_queue_failed", "Queue item could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "pharmacy_fulfillment_not_found",
                        "Queue item was not found.",
                    )
                })?;
        let _patient = load_patient_for_access(&self.state, ctx, item.patient_id).await?;
        let result = hms_db::pharmacy::dispense_fulfillment(
            self.state.db_pool(),
            hms_db::pharmacy::DispenseFulfillmentCommand {
                facility_id: self.state.facility_id(),
                fulfillment_id: id,
                item_id: payload.item_id,
                location_id: payload.location_id,
                quantity: payload.quantity,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|error| {
            let message = error.to_string();
            if message.contains("controlled_item_requires_controlled_workflow") {
                ApiError::conflict(
                    "controlled_item_requires_controlled_workflow",
                    "Controlled medications require the controlled-substance workflow.",
                )
            } else if message.contains("inventory_item_not_bound") {
                ApiError::conflict(
                    "inventory_item_not_bound",
                    "This fulfillment is not linked to an inventory item.",
                )
            } else if message.contains("inventory_item_mismatch") {
                validation_error(
                    "item_id",
                    "Selected inventory item does not match this fulfillment.",
                )
            } else if message.contains("insufficient_stock") {
                ApiError::conflict(
                    "insufficient_stock",
                    "Stock is insufficient for this dispense.",
                )
            } else if message.contains("quantity_exceeds_pending_doses") {
                validation_error("quantity", "Quantity exceeds pending doses.")
            } else {
                ApiError::conflict(
                    "pharmacy_dispense_failed",
                    "Medication could not be dispensed.",
                )
            }
        })?;
        self.state.invalidate_pharmacy_dispense_cache();
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
}

impl AppState {
    pub fn pharmacy_service(&self) -> PharmacyService {
        PharmacyService::new(self.clone())
    }
}

fn require_pharmacy_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_inventory_access(ctx, facility_id, PermissionCode::PharmacyDispense)
        .map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission to use pharmacy dispensing.",
            )
        })
}

async fn load_patient_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<(), ApiError> {
    let patient = hms_db::patients::get_patient(state.db_pool(), state.facility_id(), patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;
    hms_access::require_patient_demographics_access(ctx, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;
    Ok(())
}

fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error = ApiError::bad_request("invalid_request", "Request is invalid.");
    error.details = serde_json::json!({ field: [message] });
    error
}
