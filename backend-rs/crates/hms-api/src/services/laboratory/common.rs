use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::laboratory::{LabCursor, OrderContext, ResultContext, SpecimenContext};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::ListResponse;
use crate::state::AppState;

pub(super) const DEFAULT_LIMIT: u8 = 25;
pub(super) const MAX_LIMIT: u8 = 100;
pub(super) const MAX_SHORT_TEXT_LEN: usize = 120;
pub(super) const MAX_BULK_CREATE_RESULTS: usize = 50;
pub(super) const MAX_BULK_VERIFY_RESULTS: usize = 50;

#[derive(Clone, Copy, Debug)]
pub(super) struct CareContextIds {
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
}

pub(super) async fn load_order_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    order_id: Uuid,
) -> Result<OrderContext, ApiError> {
    let order =
        hms_db::laboratory::get_order_context(state.db_pool(), state.facility_id(), order_id)
            .await
            .map_err(|_| {
                ApiError::conflict("lab_order_load_failed", "Lab order could not be loaded.")
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_order_not_found", "Lab order was not found.")
            })?;
    let _patient = load_patient_for_access(state, ctx, order.patient_id).await?;
    Ok(order)
}

pub(super) async fn load_specimen_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    specimen_id: Uuid,
) -> Result<SpecimenContext, ApiError> {
    let specimen =
        hms_db::laboratory::get_specimen_context(state.db_pool(), state.facility_id(), specimen_id)
            .await
            .map_err(|_| {
                ApiError::conflict("specimen_load_failed", "Specimen could not be loaded.")
            })?
            .ok_or_else(|| ApiError::not_found("specimen_not_found", "Specimen was not found."))?;
    let _patient = load_patient_for_access(state, ctx, specimen.patient_id).await?;
    Ok(specimen)
}

pub(super) async fn load_result_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    result_id: Uuid,
) -> Result<ResultContext, ApiError> {
    let result =
        hms_db::laboratory::get_result_context(state.db_pool(), state.facility_id(), result_id)
            .await
            .map_err(|_| {
                ApiError::conflict("lab_result_load_failed", "Lab result could not be loaded.")
            })?
            .ok_or_else(|| {
                ApiError::not_found("lab_result_not_found", "Lab result was not found.")
            })?;
    let _patient = load_patient_for_access(state, ctx, result.patient_id).await?;
    Ok(result)
}

pub(super) async fn load_patient_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = hms_db::patients::get_patient(state.db_pool(), state.facility_id(), patient_id)
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

pub(super) async fn validate_care_context(
    state: &AppState,
    patient_id: Uuid,
    encounter_id: Option<Uuid>,
    visit_id: Option<Uuid>,
) -> Result<CareContextIds, ApiError> {
    let encounter = if let Some(encounter_id) = encounter_id {
        let encounter =
            hms_db::care::get_encounter(state.db_pool(), state.facility_id(), encounter_id)
                .await
                .map_err(|_| {
                    ApiError::conflict("encounter_load_failed", "Encounter could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("encounter_not_found", "Encounter was not found.")
                })?;
        if encounter.patient_id != patient_id {
            return Err(validation_error(
                "encounter_id",
                "Encounter does not belong to this patient.",
            ));
        }
        Some(encounter)
    } else {
        None
    };

    if let Some(visit_id) = visit_id {
        let visit = hms_db::care::get_visit(state.db_pool(), state.facility_id(), visit_id)
            .await
            .map_err(|_| ApiError::conflict("visit_load_failed", "Visit could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("visit_not_found", "Visit was not found."))?;
        if visit.patient_id != patient_id {
            return Err(validation_error(
                "visit_id",
                "Visit does not belong to this patient.",
            ));
        }
        if encounter
            .as_ref()
            .and_then(|encounter| encounter.visit_id)
            .is_some_and(|encounter_visit_id| encounter_visit_id != visit_id)
        {
            return Err(validation_error(
                "visit_id",
                "Visit does not belong to the supplied encounter.",
            ));
        }
    }

    Ok(CareContextIds {
        encounter_id,
        visit_id: visit_id.or_else(|| encounter.and_then(|encounter| encounter.visit_id)),
    })
}

pub(super) fn require_laboratory_list_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_lab_list_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to patient laboratory workflows.",
        ),
        hms_access::AccessError::LaboratoryAccessDenied => ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view laboratory workflows.",
        ),
        other => ApiError::from(other),
    })
}

pub(super) fn require_laboratory_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_lab_access(ctx, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this laboratory action.",
        )
    })
}

pub(super) fn page_request(
    cursor: Option<String>,
    limit: Option<u8>,
) -> Result<(Option<LabCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        cursor.as_deref(),
        limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| LabCursor { occurred_at, id },
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

pub(super) fn normalize_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation_error(field, "This field is required."));
    }
    if value.chars().count() > MAX_SHORT_TEXT_LEN {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(value.to_owned())
}

pub(super) fn normalize_optional_text(
    value: Option<String>,
    field: &'static str,
) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > MAX_SHORT_TEXT_LEN {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(Some(value.to_owned()))
}

pub(super) fn unique_result_ids(mut result_ids: Vec<Uuid>) -> Result<Vec<Uuid>, ApiError> {
    result_ids.sort_unstable();
    result_ids.dedup();
    if result_ids.len() > MAX_BULK_VERIFY_RESULTS {
        return Err(validation_error(
            "result_ids",
            "Too many result ids were provided.",
        ));
    }
    Ok(result_ids)
}

pub(super) fn result_item_test_id(
    order_test_id: Option<Uuid>,
    test_id: Option<Uuid>,
) -> Result<Uuid, ApiError> {
    match (order_test_id, test_id) {
        (Some(order_test_id), Some(test_id)) if order_test_id != test_id => Err(validation_error(
            "results",
            "Order test id and test id do not match.",
        )),
        (Some(order_test_id), _) => Ok(order_test_id),
        (_, Some(test_id)) => Ok(test_id),
        (None, None) => Err(validation_error("results", "A test id is required.")),
    }
}

pub(super) fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error = ApiError::bad_request(
        "invalid_laboratory_request",
        "Laboratory request is invalid.",
    );
    error.details = json!({ field: [message] });
    error
}
