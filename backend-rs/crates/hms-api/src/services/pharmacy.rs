use hms_domain::deployment::PermissionCode;
use hms_domain::pharmacy::{
    DispensePharmacyFulfillmentRequest, PharmacyDispensingLocation,
    PharmacyDispensingLocationsQuery, PharmacyFulfillmentDispenseResult, PharmacyQueueItem,
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

    pub async fn list_locations(
        &self,
        ctx: &hms_access::RequestContext,
        query: PharmacyDispensingLocationsQuery,
    ) -> Result<ListResponse<PharmacyDispensingLocation>, ApiError> {
        require_pharmacy_access(ctx, self.state.facility_id())?;
        if query
            .search
            .as_ref()
            .is_some_and(|value| value.chars().count() > 160)
        {
            return Err(ApiError::bad_request(
                "invalid_location_search",
                "Shorten the dispensing location search.",
            ));
        }
        let page = cursor_list::page_request(
            query.cursor.as_deref(),
            query.limit,
            DEFAULT_LIMIT,
            MAX_LIMIT,
            |occurred_at, id| hms_db::pharmacy::PharmacyCursor { occurred_at, id },
        )
        .map_err(|_| {
            ApiError::bad_request(
                "invalid_cursor",
                "The dispensing location cursor is invalid.",
            )
        })?;
        let limit = page.fetch_limit();
        let rows = hms_db::pharmacy::list_dispensing_locations(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            limit,
            query.search.as_deref(),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "pharmacy_locations_unavailable",
                "Dispensing locations could not be loaded.",
            )
        })?;
        let response = cursor_list::page_response(rows, page.limit, |row| {
            cursor_list::encode_cursor(row.created_at, row.id)
        });
        Ok(ListResponse {
            data: response
                .data
                .into_iter()
                .map(|row| PharmacyDispensingLocation {
                    id: row.id,
                    code: row.code,
                    name: row.name,
                })
                .collect(),
            page: response.page,
            meta: response.meta,
        })
    }

    pub async fn list_queue(
        &self,
        ctx: &hms_access::RequestContext,
        query: PharmacyQueueQuery,
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ListResponse<PharmacyQueueItem>, ApiError> {
        require_pharmacy_access(ctx, self.state.facility_id())?;
        crate::services::clinical::medication_access::require_pharmacy_purpose(ctx)?;
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
        let rows = hms_db::pharmacy::list_fulfillment_queue_authorized(
            self.state.db_pool(),
            crate::services::clinical::medication_access::actor(ctx, authorization_deadline),
            page.cursor,
            fetch_limit,
            query.patient_id,
            query.status,
        )
        .await
        .map_err(|error| crate::services::clinical::medication_access::error(error, false))?;
        Ok(cursor_list::page_response(rows, page.limit, |item| {
            cursor_list::encode_cursor(item.coverage_start, item.id)
        }))
    }

    pub async fn get_queue_item(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ObjectResponse<PharmacyQueueItem>, ApiError> {
        require_pharmacy_access(ctx, self.state.facility_id())?;
        crate::services::clinical::medication_access::require_pharmacy_purpose(ctx)?;
        let item = hms_db::pharmacy::get_fulfillment_authorized(
            self.state.db_pool(),
            crate::services::clinical::medication_access::actor(ctx, authorization_deadline),
            id,
        )
        .await
        .map_err(|error| crate::services::clinical::medication_access::error(error, false))?
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
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ObjectResponse<PharmacyFulfillmentDispenseResult>, ApiError> {
        require_pharmacy_access(ctx, self.state.facility_id())?;
        crate::services::clinical::medication_access::require_pharmacy_purpose(ctx)?;
        if payload.quantity <= 0 {
            return Err(validation_error("quantity", "Quantity must be positive."));
        }
        let item = hms_db::pharmacy::get_fulfillment_authorized(
            self.state.db_pool(),
            crate::services::clinical::medication_access::actor(ctx, authorization_deadline),
            id,
        )
        .await
        .map_err(|error| crate::services::clinical::medication_access::error(error, false))?
        .ok_or_else(|| {
            ApiError::not_found(
                "pharmacy_fulfillment_not_found",
                "Queue item was not found.",
            )
        })?;
        let _patient = load_patient_for_access(&self.state, ctx, item.patient_id).await?;
        let result = hms_db::pharmacy::dispense_fulfillment_authorized(
            self.state.db_pool(),
            hms_db::pharmacy::DispenseFulfillmentCommand {
 authorization: Some(crate::services::clinical::prescription_courses::authorization(ctx, authorization_deadline)),
                facility_id: self.state.facility_id(),
                fulfillment_id: id,
                item_id: payload.item_id,
                location_id: payload.location_id,
                quantity: payload.quantity,
                actor_user_id: ctx.user_id,
            },
            crate::services::clinical::medication_access::actor(ctx,authorization_deadline),
        )
        .await
        .map_err(|error| {
            if let Some(error) = ApiError::network_publication(&error) { return error; }
            if error.is::<hms_db::clinical::medication_access::MedicationAccessError>() {return crate::services::clinical::medication_access::error(error,true);}
            if error.is::<hms_db::clinical::stock_basis::StockBasisError>() || error.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>() {return crate::services::clinical::prescription_courses::write_error(error);}

            if let Some(reason)=error.downcast_ref::<hms_db::ward::PrnError>() {
                return ApiError::conflict("prescription_not_actionable",reason.message());
            }
            let message = error.to_string();
            if matches!(message.as_str(), "prescription_not_active" | "prescription_regimen_stale") {
                ApiError::conflict("prescription_not_actionable", "This prescription can no longer be dispensed. Reload the queue and check the current medication plan.")
            } else if message.contains("controlled_item_requires_controlled_workflow") {
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
                    "pharmacy_dispense_unconfirmed",
                    "The stock issue could not be confirmed. Reload the queue and review the saved supply before issuing more stock.",
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
