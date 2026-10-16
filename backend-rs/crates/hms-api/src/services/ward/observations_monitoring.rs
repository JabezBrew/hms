use chrono::{DateTime, Utc};
use hms_db::ward::{
    FluidBalanceFilters, NewFluidBalanceEntry, NewMonitoringEvent, NewNursingAlert,
    NewPatientVitals,
};
use hms_domain::care::CursorListQuery;
use hms_domain::ward::{
    CreateFluidBalanceEntryRequest, CreateMonitoringEventRequest, CreateNursingAlertRequest,
    CreatePatientVitalsRequest, FluidBalanceListItem, FluidBalanceListQuery, FluidBalanceSummary,
    FluidBalanceSummaryQuery, FluidBalanceTrendPoint, MonitoringEventListItem,
    MonitoringEventListQuery, NursingAlertListItem, NursingAlertListQuery, PatientVitalsListItem,
    PatientVitalsListQuery,
};
use uuid::Uuid;

use super::{common, nursing_access as access};
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
        q: PatientVitalsListQuery,
        deadline: DateTime<Utc>,
    ) -> Result<ListResponse<PatientVitalsListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), false)?;
        access::scope(
            &self.state,
            ctx,
            q.patient_id,
            q.admission_case_id,
            q.ward_id,
            false,
        )
        .await?;
        let hours_from = q
            .hours
            .map(|h| Utc::now() - chrono::Duration::hours(i64::from(h)));
        let from = match (q.recorded_from, hours_from) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        common::validate_nursing_list_range(from, q.recorded_before)?;
        let p = common::page_request(CursorListQuery {
            cursor: q.cursor.clone(),
            limit: q.limit,
        })?;
        let size = p.limit;
        let limit = p.fetch_limit();
        let rows = hms_db::ward::list_patient_vitals_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
            &q,
            from,
            p.cursor,
            limit,
        )
        .await
        .map_err(|e| access::error(e, false))?;
        Ok(common::page_response(rows, size, |r| {
            common::encode_cursor(r.recorded_at, r.id)
        }))
    }

    pub async fn create_patient_vitals(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreatePatientVitalsRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<PatientVitalsListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        validate_vitals_payload(&payload)?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        if payload
            .patient_id
            .is_some_and(|id| id != admission.patient_id)
        {
            return Err(ApiError::bad_request(
                "invalid_nursing_patient_context",
                "The selected admission does not belong to the reviewed patient.",
            ));
        }
        let vitals = hms_db::ward::create_patient_vitals_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
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
        .map_err(|e| access::error(e, true))?;

        self.state.invalidate_ward_board_cache();
        Ok(object(vitals))
    }

    pub async fn list_nursing_alerts(
        &self,
        ctx: &hms_access::RequestContext,
        q: NursingAlertListQuery,
        deadline: DateTime<Utc>,
    ) -> Result<ListResponse<NursingAlertListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        common::validate_nursing_list_range(q.created_from, q.created_before)?;
        access::scope(
            &self.state,
            ctx,
            q.patient_id,
            q.admission_case_id,
            q.ward_id,
            false,
        )
        .await?;
        let p = common::page_request(CursorListQuery {
            cursor: q.cursor.clone(),
            limit: q.limit,
        })?;
        let size = p.limit;
        let limit = p.fetch_limit();
        let rows = hms_db::ward::list_nursing_alerts_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
            &q,
            p.cursor,
            limit,
        )
        .await
        .map_err(|e| access::error(e, false))?;
        Ok(common::page_response(rows, size, |r| {
            common::encode_cursor(r.created_at, r.id)
        }))
    }

    pub async fn create_nursing_alert(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateNursingAlertRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NursingAlertListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let title = access::text(Some(payload.title), 240)?.ok_or_else(|| {
            ApiError::bad_request("invalid_nursing_text", "Provide a nursing alert title.")
        })?;
        let alert = hms_db::ward::create_nursing_alert_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
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
        .map_err(|e| access::error(e, true))?;

        self.state.invalidate_ward_board_cache();
        Ok(object(alert))
    }

    pub async fn acknowledge_nursing_alert(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<NursingAlertListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        let existing =
            hms_db::ward::get_nursing_alert(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| ApiError::conflict("alert_load_failed", "Alert could not be loaded."))?
                .ok_or_else(|| ApiError::not_found("alert_not_found", "Alert was not found."))?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, existing.patient_id).await?;
        let alert = hms_db::ward::acknowledge_nursing_alert_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
            id,
        )
        .await
        .map_err(|e| access::error(e, true))?;

        self.state.invalidate_ward_board_cache();
        Ok(object(alert))
    }

    pub async fn list_monitoring_events(
        &self,
        ctx: &hms_access::RequestContext,
        q: MonitoringEventListQuery,
        deadline: DateTime<Utc>,
    ) -> Result<ListResponse<MonitoringEventListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        common::validate_nursing_list_range(q.recorded_from, q.recorded_before)?;
        access::scope(
            &self.state,
            ctx,
            q.patient_id,
            q.admission_case_id,
            q.ward_id,
            false,
        )
        .await?;
        let p = common::page_request(CursorListQuery {
            cursor: q.cursor.clone(),
            limit: q.limit,
        })?;
        let size = p.limit;
        let limit = p.fetch_limit();
        let rows = hms_db::ward::list_monitoring_events_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
            &q,
            p.cursor,
            limit,
        )
        .await
        .map_err(|e| access::error(e, false))?;
        Ok(common::page_response(rows, size, |r| {
            common::encode_cursor(r.recorded_at, r.id)
        }))
    }

    pub async fn create_monitoring_event(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateMonitoringEventRequest,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<MonitoringEventListItem>, ApiError> {
        access::require(ctx, self.state.facility_id(), true)?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, payload.admission_case_id).await?;
        let summary = access::text(Some(payload.summary), 4000)?.ok_or_else(|| {
            ApiError::bad_request(
                "invalid_nursing_text",
                "Provide a monitoring event summary.",
            )
        })?;
        let event = hms_db::ward::create_monitoring_event_for_actor(
            self.state.db_pool(),
            access::actor(ctx, deadline),
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
        .map_err(|e| access::error(e, true))?;

        self.state.invalidate_ward_board_cache();
        Ok(object(event))
    }

    pub async fn list_fluid_balance_entries(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: chrono::DateTime<Utc>,
        query: FluidBalanceListQuery,
    ) -> Result<ListResponse<FluidBalanceListItem>, ApiError> {
        self.validate_fluid_scope(
            ctx,
            true,
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
        let rows = hms_db::ward::list_fluid_balance_for_actor(
            self.state.db_pool(),
            super::nursing_access::actor(ctx, deadline),
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
        .map_err(|e| super::fluid::fluid_error(e, false))?;

        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.recorded_at, item.id)
        }))
    }

    pub async fn get_fluid_balance_summary(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: chrono::DateTime<Utc>,
        query: FluidBalanceSummaryQuery,
    ) -> Result<ObjectResponse<FluidBalanceSummary>, ApiError> {
        self.validate_fluid_scope(
            ctx,
            false,
            query.patient_id,
            query.admission_case_id,
            query.recorded_from,
            query.recorded_before,
        )
        .await?;
        require_fluid_aggregate_scope(query.patient_id, query.admission_case_id)?;
        let summary = hms_db::ward::fluid_scalar_summary_for_actor(
            self.state.db_pool(),
            super::nursing_access::actor(ctx, deadline),
            FluidBalanceFilters {
                patient_id: query.patient_id,
                admission_case_id: query.admission_case_id,
                recorded_from: query.recorded_from,
                recorded_before: query.recorded_before,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| super::fluid::fluid_error(e, false))?;
        Ok(object(summary))
    }

    pub async fn get_fluid_balance_trends(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: chrono::DateTime<Utc>,
        query: FluidBalanceListQuery,
    ) -> Result<ListResponse<FluidBalanceTrendPoint>, ApiError> {
        self.validate_fluid_scope(
            ctx,
            false,
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
        let rows = hms_db::ward::fluid_scalar_trends_for_actor(
            self.state.db_pool(),
            super::nursing_access::actor(ctx, deadline),
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
        .map_err(|e| super::fluid::fluid_error(e, false))?;
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
        full: bool,
        patient_id: Option<Uuid>,
        admission_case_id: Option<Uuid>,
        from: Option<chrono::DateTime<Utc>>,
        before: Option<chrono::DateTime<Utc>>,
    ) -> Result<(), ApiError> {
        super::nursing_access::require(ctx, self.state.facility_id(), full).map_err(|e| {
            if !full && e.code == "nursing_visibility_denied" {
                ApiError::forbidden(
                    "nursing_visibility_denied",
                    "Clinical summary access is required to review fluid measurements.",
                )
            } else {
                e
            }
        })?;
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
        deadline: chrono::DateTime<Utc>,
        payload: CreateFluidBalanceEntryRequest,
    ) -> Result<ObjectResponse<FluidBalanceListItem>, ApiError> {
        super::nursing_access::require(ctx, self.state.facility_id(), true)?;
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
        if payload
            .patient_id
            .is_some_and(|id| id != admission.patient_id)
        {
            return Err(ApiError::bad_request(
                "invalid_fluid_scope",
                "The selected patient and admission do not match.",
            ));
        }
        let entry = hms_db::ward::create_fluid_balance_for_actor(
            self.state.db_pool(),
            super::nursing_access::actor(ctx, deadline),
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
        .map_err(|e| super::fluid::fluid_error(e, true))?;
        self.state.invalidate_ward_board_cache();

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

fn validate_vitals_payload(payload: &CreatePatientVitalsRequest) -> Result<(), ApiError> {
    if payload.temperature_c.is_none()
        && [
            payload.systolic_bp,
            payload.diastolic_bp,
            payload.pulse,
            payload.respiratory_rate,
            payload.oxygen_saturation,
        ]
        .iter()
        .all(Option::is_none)
    {
        return Err(ApiError::bad_request(
            "invalid_vitals",
            "Record at least one measured vital value.",
        ));
    }
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
