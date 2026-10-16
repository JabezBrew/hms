use hms_db::ward::{
    MedicationAdministrationFilters, MedicationOutcomeError, NewMedicationAdministration,
    NewTreatmentSheet, RecordMedicationOutcome,
};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    AdministerMedicationRequest, CreateTreatmentSheetRequest, MedicationAdministrationListItem,
    MedicationAdministrationListQuery, MedicationAdministrationOutcome,
    RecordMedicationOutcomeRequest, ScheduleMedicationAdministrationRequest,
    TreatmentSheetListItem,
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

    pub async fn list_prn_orders(
        &self,
        ctx: &hms_access::RequestContext,
        query: hms_domain::ward::PrnOrdersQuery,
    ) -> Result<ListResponse<hms_domain::ward::PrnOrderListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_case_for_access(&self.state, ctx, query.admission_case_id)
                .await?;
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let fetch_limit = page.fetch_limit();
        let mut rows = hms_db::ward::list_prn_orders(
            self.state.db_pool(),
            self.state.facility_id(),
            admission.patient_id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("prn_orders_failed", "As-needed orders could not be loaded.")
        })?;
        if !matches!(
            admission.status,
            hms_domain::ward::AdmissionStatus::Admitted
                | hms_domain::ward::AdmissionStatus::DischargePending
        ) {
            for row in &mut rows {
                row.unavailable_reason = Some("admission_inactive".to_owned());
            }
        }
        Ok(common::page_response(rows, page.limit, |item| {
            common::encode_cursor(item.prescribed_at, item.prescription_id)
        }))
    }

    pub async fn request_prn_dose(
        &self,
        ctx: &hms_access::RequestContext,
        payload: hms_domain::ward::RequestPrnDoseRequest,
    ) -> Result<ObjectResponse<hms_domain::ward::PrnDoseRequestResult>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let source = hms_db::clinical::get_prescription(
            self.state.db_pool(),
            self.state.facility_id(),
            payload.prescription_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "prn_order_load_failed",
                "The as-needed order could not be loaded.",
            )
        })?
        .filter(|source| source.patient_id == admission.patient_id)
        .ok_or_else(|| {
            ApiError::not_found(
                "prescription_not_found",
                "Prescription was not found for this admission.",
            )
        })?;
        let _patient = common::load_patient_for_access(&self.state, ctx, source.patient_id).await?;
        let result=hms_db::ward::request_prn_dose(self.state.db_pool(),hms_db::ward::RequestPrnDose{
            facility_id:self.state.facility_id(),prescription_id:source.id,admission_case_id:admission.id,
            client_request_id:payload.client_request_id,indication:payload.indication,actor_user_id:ctx.user_id,request_id:Some(ctx.request_id.clone()),
        }).await.map_err(|error|{
            if let Some(reason)=error.downcast_ref::<hms_db::ward::PrnError>() {
                return if *reason==hms_db::ward::PrnError::InvalidIndication {ApiError::bad_request("invalid_prn_request",reason.message())}
                    else {ApiError::conflict("prn_request_not_actionable",reason.message())};
            }
            ApiError::conflict("prn_request_unconfirmed","The dose request could not be confirmed. Reload the medication schedule before making another request.")
        })?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }

    pub async fn list_medication_administrations(
        &self,
        ctx: &hms_access::RequestContext,
        query: MedicationAdministrationListQuery,
    ) -> Result<ListResponse<MedicationAdministrationListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        if let Some(admission_case_id) = query.admission_case_id {
            let admission =
                common::load_admission_for_access(&self.state, ctx, admission_case_id).await?;
            if query
                .patient_id
                .is_some_and(|id| id != admission.patient_id)
            {
                return Err(ApiError::bad_request(
                    "invalid_mar_query",
                    "Admission does not belong to the requested patient.",
                ));
            }
        } else if let Some(patient_id) = query.patient_id {
            let _patient = common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        if let (Some(from), Some(before)) = (query.scheduled_from, query.scheduled_before) {
            if before <= from {
                return Err(ApiError::bad_request(
                    "invalid_mar_query",
                    "Medication schedule end must be after its start.",
                ));
            }
        }
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_medication_administrations_scoped(
            self.state.db_pool(),
            self.state.facility_id(),
            MedicationAdministrationFilters {
                patient_id: query.patient_id,
                admission_case_id: query.admission_case_id,
                scheduled_from: query.scheduled_from,
                scheduled_before: query.scheduled_before,
                status: query.status,
                descending: query.descending.unwrap_or(false),
            },
            page.cursor,
            fetch_limit,
        )
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
        if payload
            .frequency
            .as_deref()
            .is_some_and(|frequency| frequency.trim().eq_ignore_ascii_case("prn"))
        {
            return Err(ApiError::bad_request("prn_source_required","As-needed doses require a source prescription with explicit limits. Request one dose from the as-needed medication panel."));
        }
        let medication_name = required_text(payload.medication_name, "medication_name")?;
        let medication = hms_db::ward::schedule_medication_administration(
            self.state.db_pool(),
            NewMedicationAdministration {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                medication_name,
                dose: payload.dose,
                route: payload.route,
                frequency: payload.frequency,
                scheduled_at: payload.scheduled_at,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "med_admin_create_failed",
                "Medication administration could not be scheduled.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
        Ok(object(medication))
    }

    pub async fn record_medication_outcome(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: RecordMedicationOutcomeRequest,
    ) -> Result<ObjectResponse<MedicationAdministrationListItem>, ApiError> {
        self.administer_medication(
            ctx,
            id,
            AdministerMedicationRequest {
                status: Some(payload.status),
                witness_user_id: payload.witness_user_id,
                reason_not_given: payload.reason_not_given,
                administration_notes: payload.administration_notes,
            },
        )
        .await
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
        let existing = hms_db::ward::get_medication_administration(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
        )
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
        let medication = hms_db::ward::record_medication_outcome(
            self.state.db_pool(),
            RecordMedicationOutcome {
                facility_id: self.state.facility_id(), medication_id: id,
                actor_user_id: ctx.user_id,
                status: payload.status.unwrap_or(MedicationAdministrationOutcome::Administered),
                witness_user_id: payload.witness_user_id,
                reason_not_given: payload.reason_not_given,
                administration_notes: payload.administration_notes,
                request_id: Some(ctx.request_id.clone()),
            },
        )
        .await
        .map_err(|error| {
            if let Some(reason) = error.downcast_ref::<MedicationOutcomeError>() {
                return match reason {
                    MedicationOutcomeError::InvalidReason | MedicationOutcomeError::NotesTooLong
                        | MedicationOutcomeError::InvalidWitness | MedicationOutcomeError::FutureMissed =>
                        ApiError::bad_request("invalid_medication_outcome", reason.message()),
                    _ => ApiError::conflict("med_admin_not_actionable", reason.message()),
                };
            }
            if let Some(reason)=error.downcast_ref::<hms_db::ward::PrnError>() {
                return ApiError::conflict("med_admin_not_actionable",reason.message());
            }
            ApiError::conflict(
                "medication_outcome_unconfirmed",
                "The dose outcome could not be confirmed. Reload the medication schedule and review the saved record before trying again.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found(
                "med_admin_not_found",
                "Medication administration was not found.",
            )
        })?;

        self.state.invalidate_ward_board_cache();
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
        let rows = hms_db::ward::list_treatment_sheets(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
        )
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
        let sheet = hms_db::ward::create_treatment_sheet(
            self.state.db_pool(),
            NewTreatmentSheet {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                sheet_date: payload.sheet_date,
                actor_user_id: ctx.user_id,
            },
        )
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
