use chrono::Utc;
use hms_db::ward::{
    FluidBalanceFilters, NewFluidBalanceEntry, NewMonitoringEvent, NewNursingAlert,
    NewPatientVitals,
};
use hms_domain::care::CursorListQuery;
use hms_domain::deployment::PermissionCode;
use hms_domain::ward::{
    CreateFluidBalanceEntryRequest, CreateMonitoringEventRequest, CreateNursingAlertRequest,
    CreatePatientVitalsRequest, FluidBalanceListItem, FluidBalanceListQuery, FluidBalanceSummary,
    FluidBalanceSummaryQuery, FluidBalanceTrendPoint, MonitoringEventListItem,
    NursingAlertListItem, NursingAlertListQuery, PatientVitalsListItem, PatientVitalsListQuery,
};
use serde_json::json;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct ObservationsMonitoringService {
    state: AppState,
}

impl ObservationsMonitoringService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn list_patient_vitals(
        &self,
        ctx: &hms_access::RequestContext,
        query: PatientVitalsListQuery,
    ) -> Result<ListResponse<PatientVitalsListItem>, ApiError> {
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
                .is_some_and(|patient_id| patient_id != admission.patient_id)
            {
                return Err(ApiError::bad_request(
                    "invalid_vitals_query",
                    "Admission does not belong to the requested patient.",
                ));
            }
        } else if let Some(patient_id) = query.patient_id {
            let _patient = common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let recorded_since = match query.hours {
            Some(0) => Some(Utc::now()),
            Some(hours) => Some(Utc::now() - chrono::Duration::hours(i64::from(hours))),
            None => None,
        };
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_patient_vitals(
            self.state.db_pool(),
            self.state.facility_id(),
            query.patient_id,
            query.admission_case_id,
            recorded_since,
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| ApiError::conflict("vitals_list_failed", "Vitals could not be loaded."))?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.recorded_at, item.id)
        }))
    }

    pub async fn create_patient_vitals(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreatePatientVitalsRequest,
    ) -> Result<ObjectResponse<PatientVitalsListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        validate_vitals_payload(&payload)?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let vitals = hms_db::ward::create_patient_vitals(
            self.state.db_pool(),
            NewPatientVitals {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                recorded_at: payload.recorded_at,
                temperature_c: payload.temperature_c,
                systolic_bp: payload.systolic_bp,
                diastolic_bp: payload.diastolic_bp,
                pulse: payload.pulse,
                respiratory_rate: payload.respiratory_rate,
                oxygen_saturation: payload.oxygen_saturation,
                recorded_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("vitals_create_failed", "Vitals could not be recorded."))?;

        Ok(object(vitals))
    }

    pub async fn list_nursing_alerts(
        &self,
        ctx: &hms_access::RequestContext,
        query: NursingAlertListQuery,
    ) -> Result<ListResponse<NursingAlertListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        common::validate_nursing_list_range(query.created_from, query.created_before)?;
        common::authorize_nursing_list_scope(
            &self.state,
            ctx,
            query.patient_id,
            query.admission_case_id,
            query.ward_id,
        )
        .await?;
        let filters = hms_db::ward::NursingAlertFilters {
            patient_id: query.patient_id,
            admission_case_id: query.admission_case_id,
            ward_id: query.ward_id,
            status: query.status,
            severity: query.severity,
            critical_only: query.critical_only.unwrap_or(false),
            created_from: query.created_from,
            created_before: query.created_before,
            descending: query.descending.unwrap_or(false),
        };
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_nursing_alerts_scoped(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
            filters,
        )
        .await
        .map_err(|_| ApiError::conflict("alert_list_failed", "Alerts could not be loaded."))?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_nursing_alert(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateNursingAlertRequest,
    ) -> Result<ObjectResponse<NursingAlertListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let title = required_text(payload.title, "title")?;
        let alert = hms_db::ward::create_nursing_alert(
            self.state.db_pool(),
            NewNursingAlert {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                severity: payload.severity,
                title,
                created_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict("alert_create_unconfirmed", "Alert could not be created.")
        })?;

        Ok(object(alert))
    }

    pub async fn acknowledge_nursing_alert(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<NursingAlertListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let existing =
            hms_db::ward::get_nursing_alert(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| ApiError::conflict("alert_load_failed", "Alert could not be loaded."))?
                .ok_or_else(|| ApiError::not_found("alert_not_found", "Alert was not found."))?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let alert = hms_db::ward::acknowledge_nursing_alert_with_request(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
            ctx.user_id,
            Some(ctx.request_id.clone()),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "alert_acknowledge_unconfirmed",
                "Alert could not be acknowledged.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("alert_not_found", "Alert was not found."))?;

        Ok(object(alert))
    }

    pub async fn list_monitoring_events(
        &self,
        ctx: &hms_access::RequestContext,
        query: CursorListQuery,
    ) -> Result<ListResponse<MonitoringEventListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let page = common::page_request(query)?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_monitoring_events(
            self.state.db_pool(),
            self.state.facility_id(),
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "monitoring_event_list_failed",
                "Monitoring events could not be loaded.",
            )
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.recorded_at, item.id)
        }))
    }

    pub async fn create_monitoring_event(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateMonitoringEventRequest,
    ) -> Result<ObjectResponse<MonitoringEventListItem>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let summary = required_text(payload.summary, "summary")?;
        let event = hms_db::ward::create_monitoring_event(
            self.state.db_pool(),
            NewMonitoringEvent {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                event_kind: payload.event_kind,
                summary,
                recorded_at: payload.recorded_at,
                recorded_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "monitoring_event_create_failed",
                "Monitoring event could not be created.",
            )
        })?;

        Ok(object(event))
    }

    pub async fn list_fluid_balance_entries(
        &self,
        ctx: &hms_access::RequestContext,
        query: FluidBalanceListQuery,
    ) -> Result<ListResponse<FluidBalanceListItem>, ApiError> {
        self.validate_fluid_scope(
            ctx,
            query.patient_id,
            query.admission_case_id,
            query.recorded_from,
            query.recorded_before,
        )
        .await?;
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let page_size = page.limit;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::list_fluid_balance_entries_scoped(
            self.state.db_pool(),
            self.state.facility_id(),
            FluidBalanceFilters {
                patient_id: query.patient_id,
                admission_case_id: query.admission_case_id,
                recorded_from: query.recorded_from,
                recorded_before: query.recorded_before,
                descending: query.descending.unwrap_or(false),
            },
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "fluid_balance_list_failed",
                "Fluid balance entries could not be loaded.",
            )
        })?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.recorded_at, item.id)
        }))
    }

    pub async fn get_fluid_balance_summary(
        &self,
        ctx: &hms_access::RequestContext,
        query: FluidBalanceSummaryQuery,
    ) -> Result<ObjectResponse<FluidBalanceSummary>, ApiError> {
        self.validate_fluid_scope(
            ctx,
            query.patient_id,
            query.admission_case_id,
            query.recorded_from,
            query.recorded_before,
        )
        .await?;
        require_fluid_aggregate_scope(query.patient_id, query.admission_case_id)?;
        let summary = hms_db::ward::fluid_balance_summary(
            self.state.db_pool(),
            self.state.facility_id(),
            FluidBalanceFilters {
                patient_id: query.patient_id,
                admission_case_id: query.admission_case_id,
                recorded_from: query.recorded_from,
                recorded_before: query.recorded_before,
                ..Default::default()
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "fluid_balance_summary_failed",
                "Fluid balance totals could not be loaded.",
            )
        })?;
        Ok(object(summary))
    }

    pub async fn get_fluid_balance_trends(
        &self,
        ctx: &hms_access::RequestContext,
        query: FluidBalanceListQuery,
    ) -> Result<ListResponse<FluidBalanceTrendPoint>, ApiError> {
        self.validate_fluid_scope(
            ctx,
            query.patient_id,
            query.admission_case_id,
            query.recorded_from,
            query.recorded_before,
        )
        .await?;
        require_fluid_aggregate_scope(query.patient_id, query.admission_case_id)?;
        let page = common::page_request(CursorListQuery {
            cursor: query.cursor,
            limit: query.limit,
        })?;
        let fetch_limit = page.fetch_limit();
        let rows = hms_db::ward::fluid_balance_trends(
            self.state.db_pool(),
            self.state.facility_id(),
            FluidBalanceFilters {
                patient_id: query.patient_id,
                admission_case_id: query.admission_case_id,
                recorded_from: query.recorded_from,
                recorded_before: query.recorded_before,
                descending: query.descending.unwrap_or(false),
            },
            page.cursor,
            fetch_limit,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "fluid_balance_trends_failed",
                "Fluid balance trends could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page.limit, |item| {
            common::encode_cursor(
                item.date.and_time(chrono::NaiveTime::MIN).and_utc(),
                Uuid::nil(),
            )
        }))
    }

    async fn validate_fluid_scope(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Option<Uuid>,
        admission_case_id: Option<Uuid>,
        from: Option<chrono::DateTime<Utc>>,
        before: Option<chrono::DateTime<Utc>>,
    ) -> Result<(), ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        if let Some(admission_id) = admission_case_id {
            let admission =
                common::load_admission_for_access(&self.state, ctx, admission_id).await?;
            if patient_id.is_some_and(|id| id != admission.patient_id) {
                return Err(ApiError::bad_request(
                    "invalid_fluid_query",
                    "Admission does not belong to the requested patient.",
                ));
            }
        } else if let Some(id) = patient_id {
            let _patient = common::load_patient_for_access(&self.state, ctx, id).await?;
        }
        if from
            .zip(before)
            .is_some_and(|(from, before)| before <= from)
        {
            return Err(ApiError::bad_request(
                "invalid_fluid_query",
                "Fluid balance end must be after its start.",
            ));
        }
        Ok(())
    }

    pub async fn create_fluid_balance_entry(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateFluidBalanceEntryRequest,
    ) -> Result<ObjectResponse<FluidBalanceListItem>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        if payload.intake_ml < 0
            || payload.output_ml < 0
            || payload.intake_ml > 10000
            || payload.output_ml > 10000
            || (payload.intake_ml == 0 && payload.output_ml == 0)
            || payload.recorded_at > Utc::now()
        {
            return Err(ApiError::bad_request(
                "invalid_fluid_balance",
                "Record positive whole measured volumes up to 10000 ml per direction at or before now.",
            ));
        }
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let entry = hms_db::ward::create_fluid_balance_entry(
            self.state.db_pool(),
            NewFluidBalanceEntry {
                id: Uuid::new_v4(),
                facility_id: self.state.facility_id(),
                admission_case_id: admission.id,
                patient_id: admission.patient_id,
                recorded_at: payload.recorded_at,
                intake_ml: payload.intake_ml,
                output_ml: payload.output_ml,
                recorded_by_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "fluid_write_unconfirmed",
                "This entry could not be confirmed. Refresh and review recent entries before recording another.",
            )
        })?;

        Ok(object(entry))
    }
}

fn require_fluid_aggregate_scope(
    patient_id: Option<Uuid>,
    admission_id: Option<Uuid>,
) -> Result<(), ApiError> {
    if patient_id.is_none() && admission_id.is_none() {
        return Err(ApiError::bad_request(
            "invalid_fluid_query",
            "Patient or admission scope is required for fluid balance totals and trends.",
        ));
    }
    Ok(())
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

fn validate_vitals_payload(payload: &CreatePatientVitalsRequest) -> Result<(), ApiError> {
    if let Some(temperature_c) = payload.temperature_c {
        if !(25.0..=45.0).contains(&temperature_c) {
            return Err(ApiError::bad_request(
                "invalid_vitals",
                "Temperature must be between 25.0 and 45.0 Celsius.",
            ));
        }
    }
    validate_optional_range(payload.systolic_bp, 40, 260)?;
    validate_optional_range(payload.diastolic_bp, 20, 160)?;
    validate_optional_range(payload.pulse, 20, 250)?;
    validate_optional_range(payload.respiratory_rate, 4, 80)?;
    validate_optional_range(payload.oxygen_saturation, 0, 100)?;
    Ok(())
}

fn validate_optional_range(value: Option<i32>, min: i32, max: i32) -> Result<(), ApiError> {
    if let Some(value) = value {
        if !(min..=max).contains(&value) {
            return Err(ApiError::bad_request(
                "invalid_vitals",
                "One or more vitals values are outside the accepted range.",
            ));
        }
    }
    Ok(())
}
