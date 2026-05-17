use chrono::{DateTime, Utc};
use hms_access::require_patient_demographics_access;
use hms_db::ward::{AdmissionContext, WardCursor};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use hms_domain::ward::{AdmissionCaseListItem, BedListItem, WardListItem, WardSectionListItem};
use uuid::Uuid;

use crate::cursor_list::{self, CursorPage};
use crate::error::ApiError;
use crate::response::ListResponse;
use crate::state::AppState;

pub(super) const DEFAULT_LIMIT: u8 = 25;
pub(super) const MAX_LIMIT: u8 = 100;
pub(super) const MAX_DISCHARGE_REASON_LEN: usize = 240;
pub(super) const MAX_WARD_CODE_LEN: usize = 64;
pub(super) const MAX_WARD_NAME_LEN: usize = 160;
pub(super) const MAX_BED_CODE_LEN: usize = 64;

pub(super) fn require_patient_workflow_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, permission).map_err(|error| {
        match error {
            hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to patient workflow lists.",
            ),
            other => ApiError::from(other),
        }
    })
}

pub(super) fn require_facility_permission(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_facility_permission(ctx, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to perform this action.",
        )
    })
}

pub(super) async fn load_admission_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    admission_case_id: Uuid,
) -> Result<AdmissionContext, ApiError> {
    let admission = state
        .get_admission_context(admission_case_id)
        .await
        .map_err(|_| ApiError::conflict("admission_load_failed", "Admission could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("admission_not_found", "Admission was not found."))?;
    let _patient = load_patient_for_access(state, ctx, admission.patient_id).await?;
    Ok(admission)
}

pub(super) async fn load_admission_case_for_access(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    admission_case_id: Uuid,
) -> Result<AdmissionCaseListItem, ApiError> {
    let admission_case = state
        .get_admission_case(admission_case_id)
        .await
        .map_err(|_| ApiError::conflict("admission_load_failed", "Admission could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("admission_not_found", "Admission was not found."))?;
    let _patient = load_patient_for_access(state, ctx, admission_case.patient_id).await?;
    Ok(admission_case)
}

pub(super) async fn load_ward(state: &AppState, ward_id: Uuid) -> Result<WardListItem, ApiError> {
    hms_db::ward::get_ward(state.db_pool(), state.facility_id(), ward_id)
        .await
        .map_err(|_| ApiError::conflict("ward_load_failed", "Ward could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("ward_not_found", "Ward was not found."))
}

pub(super) async fn load_ward_section(
    state: &AppState,
    section_id: Uuid,
) -> Result<WardSectionListItem, ApiError> {
    hms_db::ward::get_ward_section_by_id(state.db_pool(), state.facility_id(), section_id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "ward_section_load_failed",
                "Ward section could not be loaded.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("ward_section_not_found", "Ward section was not found."))
}

pub(super) async fn load_bed(state: &AppState, bed_id: Uuid) -> Result<BedListItem, ApiError> {
    hms_db::ward::get_bed_by_id(state.db_pool(), state.facility_id(), bed_id)
        .await
        .map_err(|_| ApiError::conflict("bed_load_failed", "Bed could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("bed_not_found", "Bed was not found."))
}

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

pub(super) fn page_request(query: CursorListQuery) -> Result<CursorPage<WardCursor>, ApiError> {
    Ok(cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| WardCursor { occurred_at, id },
    )?)
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

pub(super) fn normalize_ward_text(
    value: Option<String>,
    max_len: usize,
) -> Result<Option<String>, ApiError> {
    value
        .map(|raw| {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(ApiError::bad_request(
                    "invalid_ward",
                    "Ward code and name cannot be empty.",
                ));
            }
            if trimmed.len() > max_len {
                return Err(ApiError::bad_request(
                    "invalid_ward",
                    "Ward code or name is too long.",
                ));
            }
            Ok(trimmed.to_owned())
        })
        .transpose()
}

pub(super) fn normalize_bed_code(value: Option<String>) -> Result<Option<String>, ApiError> {
    value
        .map(|raw| {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(ApiError::bad_request(
                    "invalid_bed",
                    "Bed code is required.",
                ));
            }
            if trimmed.len() > MAX_BED_CODE_LEN {
                return Err(ApiError::bad_request(
                    "invalid_bed",
                    "Bed code is too long.",
                ));
            }
            Ok(trimmed.to_owned())
        })
        .transpose()
}

pub(super) fn validate_optional_text(value: Option<&str>, max_len: usize) -> Result<(), ApiError> {
    if let Some(value) = value {
        if value.chars().count() > max_len {
            return Err(ApiError::bad_request(
                "invalid_text",
                "Text value is too long.",
            ));
        }
    }
    Ok(())
}
