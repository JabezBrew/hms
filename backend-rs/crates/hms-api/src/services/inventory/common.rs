use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::inventory::InventoryCursor;
use hms_domain::deployment::PermissionCode;
use hms_domain::inventory::InventoryListQuery;
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::ListResponse;
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;

pub(super) async fn load_patient_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = state
        .get_patient(patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;
    require_patient_demographics_access(ctx, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;
    Ok(patient)
}

pub(super) fn require_inventory_list_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_inventory_list_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have patient workflow access.",
        ),
        hms_access::AccessError::InventoryAccessDenied => {
            ApiError::forbidden("permission_denied", "You do not have inventory access.")
        }
        other => ApiError::from(other),
    })
}

pub(super) fn require_inventory_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_inventory_access(ctx, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission for this action.",
        )
    })
}

pub(super) fn require_pharmacy_dispense_list_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    require_inventory_list_access(ctx, facility_id)?;
    hms_access::require_inventory_access(ctx, facility_id, PermissionCode::PharmacyDispense)
        .map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission to view pharmacy dispenses.",
            )
        })
}

pub(super) fn page_request(
    query: InventoryListQuery,
) -> Result<(Option<InventoryCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| InventoryCursor { occurred_at, id },
    )?;
    Ok((page.cursor, page.limit))
}

pub(super) fn page_response<T, F>(rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    cursor_list::page_response(rows, page_size, cursor_for)
}

pub(super) fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
}

pub(super) fn require_positive(value: i64, field: &'static str) -> Result<(), ApiError> {
    if value <= 0 {
        return Err(validation_error(
            field,
            "This value must be greater than zero.",
        ));
    }
    Ok(())
}

pub(super) fn require_non_negative(value: i64, field: &'static str) -> Result<(), ApiError> {
    if value < 0 {
        return Err(validation_error(
            field,
            "This value must be zero or greater.",
        ));
    }
    Ok(())
}

pub(super) fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error =
        ApiError::bad_request("invalid_inventory_request", "Inventory request is invalid.");
    error.details = json!({ field: [message] });
    error
}
