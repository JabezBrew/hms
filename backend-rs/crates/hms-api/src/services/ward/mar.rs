use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    AdministerMedicationRequest, CreateTreatmentSheetRequest, MedicationAdministrationListItem,
    ScheduleMedicationAdministrationRequest, TreatmentSheetListItem,
};
use serde_json::json;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct MarService {
    state: AppState,
}

impl MarService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_medication_administrations(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<MedicationAdministrationListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = self
            .state
            .list_medication_administrations(page.cursor, fetch_limit)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "med_admin_list_failed",
                    "Medication administrations could not be loaded.",
                )
            })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.scheduled_at, item.id)
        }))
    }

    pub async fn schedule_medication_administration(
        &self,
        ctx: &hms_access::RequestContext,
        payload: ScheduleMedicationAdministrationRequest,
    ) -> Result<ObjectResponse<MedicationAdministrationListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let medication_name = required_text(payload.medication_name, "medication_name")?;
        let medication = self
            .state
            .schedule_medication_administration(
                &admission,
                medication_name,
                payload.scheduled_at,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "med_admin_create_failed",
                    "Medication administration could not be scheduled.",
                )
            })?;

        Ok(object(medication))
    }

    pub async fn administer_medication(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: AdministerMedicationRequest,
    ) -> Result<ObjectResponse<MedicationAdministrationListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let existing = self
            .state
            .get_medication_administration(id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "med_admin_load_failed",
                    "Medication administration could not be loaded.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found(
                    "med_admin_not_found",
                    "Medication administration was not found.",
                )
            })?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let medication = self
            .state
            .administer_medication(id, ctx.user_id, payload.witness_user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "med_admin_update_failed",
                    "Medication administration could not be updated.",
                )
            })?
            .ok_or_else(|| {
                ApiError::not_found(
                    "med_admin_not_found",
                    "Medication administration was not found.",
                )
            })?;

        Ok(object(medication))
    }

    pub async fn list_treatment_sheets(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<TreatmentSheetListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = self
            .state
            .list_treatment_sheets(page.cursor, fetch_limit)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "treatment_sheet_list_failed",
                    "Treatment sheets could not be loaded.",
                )
            })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.updated_at, item.id)
        }))
    }

    pub async fn create_treatment_sheet(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateTreatmentSheetRequest,
    ) -> Result<ObjectResponse<TreatmentSheetListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let sheet = self
            .state
            .create_treatment_sheet(&admission, payload.sheet_date, ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "treatment_sheet_create_failed",
                    "Treatment sheet could not be created.",
                )
            })?;

        Ok(object(sheet))
    }
}

fn required_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        let mut error = ApiError::bad_request("invalid_request", "Request is invalid.");
        error.details = json!({ field: ["This field is required."] });
        return Err(error);
    }
    Ok(value.to_owned())
}
