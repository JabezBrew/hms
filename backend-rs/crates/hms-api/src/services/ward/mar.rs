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
    TreatmentSheetListItem, TreatmentSheetListQuery,
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
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ListResponse<hms_domain::ward::PrnOrderListItem>, ApiError> {
        crate::services::clinical::medication_access::require_nursing(ctx)?;
        let admission =
            common::load_admission_case_for_access(&self.state, ctx, query.admission_case_id)
                .await?;
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let fetch_limit = page.fetch_limit();
        let mut rows = hms_db::ward::list_prn_orders_authorized(
            self.state.db_pool(),
            crate::services::clinical::medication_access::actor(ctx, authorization_deadline),
            admission.patient_id,
            admission.id,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|error| crate::services::clinical::medication_access::error(error, false))?;
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
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ObjectResponse<hms_domain::ward::PrnDoseRequestResult>, ApiError> {
        crate::services::clinical::medication_access::require_nursing(ctx)?;
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
        let result=hms_db::ward::request_prn_dose_authorized(self.state.db_pool(),hms_db::ward::RequestPrnDose{
            facility_id:self.state.facility_id(),prescription_id:source.id,admission_case_id:admission.id,
            client_request_id:payload.client_request_id,indication:payload.indication,actor_user_id:ctx.user_id,request_id:Some(ctx.request_id.clone()),
        },crate::services::clinical::medication_access::actor(ctx,authorization_deadline)).await.map_err(|error|{
            if let Some(error) = ApiError::network_publication(&error) { return error; }
            if error.is::<hms_db::clinical::medication_access::MedicationAccessError>() {return crate::services::clinical::medication_access::error(error,true);}
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
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ListResponse<MedicationAdministrationListItem>, ApiError> {
        crate::services::clinical::medication_access::require_nursing(ctx)?;
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
        let rows = hms_db::ward::list_medication_administrations_authorized(
            self.state.db_pool(),
            crate::services::clinical::medication_access::actor(ctx, authorization_deadline),
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
        .map_err(|error| crate::services::clinical::medication_access::error(error, false))?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.scheduled_at, item.id)
        }))
    }

    pub async fn schedule_medication_administration(
        &self,
        ctx: &hms_access::RequestContext,
        payload: ScheduleMedicationAdministrationRequest,
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ObjectResponse<MedicationAdministrationListItem>, ApiError> {
        crate::services::clinical::medication_access::require_nursing(ctx)?;
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
        let medication = hms_db::ward::schedule_medication_administration_authorized(
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
            crate::services::clinical::medication_access::actor(ctx, authorization_deadline),
        )
        .await
        .map_err(|error| crate::services::clinical::medication_access::error(error, true))?;

        self.state.invalidate_ward_board_cache();
        Ok(object(medication))
    }

    pub async fn record_medication_outcome(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: RecordMedicationOutcomeRequest,
        authorization_deadline: chrono::DateTime<chrono::Utc>,
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
            authorization_deadline,
        )
        .await
    }

    pub async fn administer_medication(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: AdministerMedicationRequest,
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ObjectResponse<MedicationAdministrationListItem>, ApiError> {
        crate::services::clinical::medication_access::require_nursing(ctx)?;
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
        let medication = hms_db::ward::record_medication_outcome_authorized(
            self.state.db_pool(),
            RecordMedicationOutcome {
 authorization: Some(crate::services::clinical::prescription_courses::authorization(ctx, authorization_deadline)),
                facility_id: self.state.facility_id(), medication_id: id,
                actor_user_id: ctx.user_id,
                status: payload.status.unwrap_or(MedicationAdministrationOutcome::Administered),
                witness_user_id: payload.witness_user_id,
                reason_not_given: payload.reason_not_given,
                administration_notes: payload.administration_notes,
                request_id: Some(ctx.request_id.clone()),
            },
            crate::services::clinical::medication_access::actor(ctx,authorization_deadline),
        )
        .await
        .map_err(|error| {
            if let Some(error) = ApiError::network_publication(&error) { return error; }
            if error.is::<hms_db::clinical::medication_access::MedicationAccessError>() {return crate::services::clinical::medication_access::error(error,true);}
            if error.is::<hms_db::clinical::stock_basis::StockBasisError>() || error.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>() {return crate::services::clinical::prescription_courses::write_error(error);}

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
        query: TreatmentSheetListQuery,
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ListResponse<TreatmentSheetListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        common::authorize_nursing_list_scope(
            &self.state,
            ctx,
            query.patient_id,
            query.admission_case_id,
            query.ward_id,
        )
        .await?;
        if let Some(id) = query.id {
            if let Some((patient_id, admission_case_id)) =
                hms_db::ward::treatment_sheet_access_context(
                    self.state.db_pool(),
                    self.state.facility_id(),
                    id,
                )
                .await
                .map_err(|_| {
                    ApiError::conflict(
                        "treatment_sheet_load_failed",
                        "Treatment sheet could not be loaded.",
                    )
                })?
            {
                if query.patient_id.is_some_and(|id| id != patient_id)
                    || query
                        .admission_case_id
                        .is_some_and(|id| id != admission_case_id)
                {
                    return Err(ApiError::bad_request(
                        "invalid_nursing_list_scope",
                        "Treatment sheet does not belong to the requested patient or admission.",
                    ));
                }
                common::authorize_nursing_list_scope(
                    &self.state,
                    ctx,
                    Some(patient_id),
                    Some(admission_case_id),
                    query.ward_id,
                )
                .await?;
            }
        }
        let filters = hms_db::ward::TreatmentSheetFilters {
            id: query.id,
            patient_id: query.patient_id,
            admission_case_id: query.admission_case_id,
            ward_id: query.ward_id,
            sheet_date: query.sheet_date,
            status: query.status,
            descending: query.descending.unwrap_or(false),
        };
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_treatment_sheets_authorized(
            self.state.db_pool(),
            crate::services::clinical::medication_access::actor(ctx, authorization_deadline),
            page.cursor,
            fetch_limit,
            filters,
        )
        .await
        .map_err(|error| crate::services::clinical::medication_access::error(error, false))?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.updated_at, item.id)
        }))
    }

    pub async fn create_treatment_sheet(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateTreatmentSheetRequest,
        authorization_deadline: chrono::DateTime<chrono::Utc>,
    ) -> Result<ObjectResponse<TreatmentSheetListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let sheet = hms_db::ward::create_treatment_sheet_authorized(
            self.state.db_pool(),
            NewTreatmentSheet {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                sheet_date: payload.sheet_date,
                actor_user_id: ctx.user_id,
            },
            crate::services::clinical::medication_access::actor(ctx, authorization_deadline),
        )
        .await
        .map_err(|error| crate::services::clinical::medication_access::error(error, true))?;

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
