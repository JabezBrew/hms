use super::common;
use crate::{
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_db::ward::{FluidActor, FluidBalanceFilters, FluidError};
use hms_domain::{care::CursorListQuery, deployment::PermissionCode, fluid::*};
use uuid::Uuid;

#[derive(Clone)]
pub struct FluidService {
    state: AppState,
}
impl FluidService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }
    fn actor(&self, ctx: &hms_access::RequestContext) -> FluidActor {
        FluidActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
        }
    }
    async fn scope(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Option<Uuid>,
        admission: Option<Uuid>,
        from: Option<DateTime<Utc>>,
        before: Option<DateTime<Utc>>,
    ) -> Result<(), ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        if let Some(id) = admission {
            let a = common::load_admission_for_access(&self.state, ctx, id).await?;
            if patient.is_some_and(|p| p != a.patient_id) {
                return Err(ApiError::bad_request(
                    "invalid_fluid_scope",
                    "Admission does not belong to the requested patient.",
                ));
            }
        } else if let Some(id) = patient {
            common::load_patient_for_access(&self.state, ctx, id).await?;
        } else {
            return Err(ApiError::bad_request(
                "invalid_fluid_scope",
                "A patient or admission is required.",
            ));
        }
        if from.zip(before).is_some_and(|(a, b)| a >= b) {
            return Err(ApiError::bad_request(
                "invalid_fluid_range",
                "The end must be after the start.",
            ));
        }
        Ok(())
    }
    async fn source(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<FluidObservation, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let source =
            hms_db::ward::get_fluid_observation(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|_| read_error())?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "fluid_observation_not_found",
                        "Fluid observation was not found.",
                    )
                })?;
        common::load_patient_for_access(&self.state, ctx, source.patient_id).await?;
        Ok(source)
    }
    pub async fn get(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<FluidObservation>, ApiError> {
        Ok(object(self.source(ctx, id).await?))
    }
    pub async fn list(
        &self,
        ctx: &hms_access::RequestContext,
        q: FluidObservationQuery,
    ) -> Result<ListResponse<FluidObservation>, ApiError> {
        self.scope(
            ctx,
            q.patient_id,
            q.admission_case_id,
            q.recorded_from,
            q.recorded_before,
        )
        .await?;
        let page = common::page_request(CursorListQuery {
            cursor: q.cursor,
            limit: q.limit,
        })?;
        let limit = page.fetch_limit();
        let rows = hms_db::ward::list_fluid_observations(
            self.state.db_pool(),
            self.state.facility_id(),
            filters(
                q.patient_id,
                q.admission_case_id,
                q.recorded_from,
                q.recorded_before,
                q.descending,
            ),
            q.include_closed.unwrap_or(false),
            page.cursor,
            limit,
        )
        .await
        .map_err(|_| read_error())?;
        Ok(common::page_response(rows, page.limit, |r| {
            common::encode_cursor(r.values.recorded_at, r.id)
        }))
    }
    pub async fn summary(
        &self,
        ctx: &hms_access::RequestContext,
        q: FluidObservationQuery,
    ) -> Result<ObjectResponse<FluidEffectiveSummary>, ApiError> {
        self.scope(
            ctx,
            q.patient_id,
            q.admission_case_id,
            q.recorded_from,
            q.recorded_before,
        )
        .await?;
        if q.cursor.is_some() {
            return Err(ApiError::bad_request(
                "invalid_fluid_scope",
                "Totals apply to the complete scope; a cursor is not supported.",
            ));
        }
        Ok(object(
            hms_db::ward::fluid_effective_summary(
                self.state.db_pool(),
                self.state.facility_id(),
                filters(
                    q.patient_id,
                    q.admission_case_id,
                    q.recorded_from,
                    q.recorded_before,
                    q.descending,
                ),
            )
            .await
            .map_err(|_| read_error())?,
        ))
    }
    pub async fn history(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        q: CursorListQuery,
    ) -> Result<ListResponse<FluidObservation>, ApiError> {
        let source = self.source(ctx, id).await?;
        let page = common::page_request(q)?;
        let limit = page.fetch_limit();
        let rows = hms_db::ward::fluid_observation_history(
            self.state.db_pool(),
            self.state.facility_id(),
            source.root_entry_id,
            page.cursor,
            limit,
        )
        .await
        .map_err(|_| read_error())?;
        Ok(common::page_response(rows, page.limit, |r| {
            common::encode_cursor(r.created_at, r.id)
        }))
    }
    pub async fn create(
        &self,
        ctx: &hms_access::RequestContext,
        p: CreateFluidObservationRequest,
    ) -> Result<ObjectResponse<FluidWriteResult>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, p.admission_case_id).await?;
        let result = hms_db::ward::create_fluid_observation(
            self.state.db_pool(),
            self.actor(ctx),
            admission.patient_id,
            p,
        )
        .await
        .map_err(write_error)?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
    pub async fn correct(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        p: CorrectFluidObservationRequest,
    ) -> Result<ObjectResponse<FluidWriteResult>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let source = self.source(ctx, id).await?;
        let result = hms_db::ward::correct_fluid_observation(
            self.state.db_pool(),
            self.actor(ctx),
            source,
            p,
        )
        .await
        .map_err(write_error)?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
    pub async fn void(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        p: VoidFluidObservationRequest,
    ) -> Result<ObjectResponse<FluidWriteResult>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let source = self.source(ctx, id).await?;
        let result =
            hms_db::ward::void_fluid_observation(self.state.db_pool(), self.actor(ctx), source, p)
                .await
                .map_err(write_error)?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
    pub async fn rules(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<FluidRuleSettings>, ApiError> {
        if common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )
        .is_err()
        {
            common::require_facility_permission(
                ctx,
                self.state.facility_id(),
                PermissionCode::AdminAuthorityManage,
            )?;
        }
        Ok(object(
            hms_db::ward::get_fluid_rules(self.state.db_pool(), self.state.facility_id())
                .await
                .map_err(|_| read_error())?,
        ))
    }
    pub async fn update_rules(
        &self,
        ctx: &hms_access::RequestContext,
        p: UpdateFluidRuleSettingsRequest,
    ) -> Result<ObjectResponse<FluidRuleSettings>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdminAuthorityManage,
        )?;
        let result = hms_db::ward::update_fluid_rules(self.state.db_pool(), self.actor(ctx), p)
            .await
            .map_err(write_error)?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
    pub async fn assessment(
        &self,
        ctx: &hms_access::RequestContext,
        q: FluidAssessmentQuery,
    ) -> Result<ObjectResponse<FluidAssessment>, ApiError> {
        common::require_patient_workflow_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, q.admission_case_id).await?;
        let today = Utc::now().date_naive();
        let date = q.date.unwrap_or(today);
        if date > today {
            return Err(ApiError::bad_request(
                "invalid_fluid_date",
                "An assessment date cannot be in the future.",
            ));
        }
        Ok(object(
            hms_db::ward::fluid_assessment(
                self.state.db_pool(),
                self.state.facility_id(),
                admission.patient_id,
                admission.id,
                date,
            )
            .await
            .map_err(|_| read_error())?,
        ))
    }
}
fn filters(
    patient_id: Option<Uuid>,
    admission_case_id: Option<Uuid>,
    recorded_from: Option<DateTime<Utc>>,
    recorded_before: Option<DateTime<Utc>>,
    descending: Option<bool>,
) -> FluidBalanceFilters {
    FluidBalanceFilters {
        patient_id,
        admission_case_id,
        recorded_from,
        recorded_before,
        descending: descending.unwrap_or(false),
    }
}
fn read_error() -> ApiError {
    ApiError::conflict(
        "fluid_observation_read_failed",
        "Fluid observations could not be loaded. Refresh before continuing.",
    )
}
fn write_error(error: anyhow::Error) -> ApiError {
    if let Some(e) = error.downcast_ref::<FluidError>() {
        return match e {
            FluidError::InvalidValues
            | FluidError::InvalidMetadata
            | FluidError::InvalidReason
            | FluidError::FutureObservation
            | FluidError::InvalidRules => {
                ApiError::bad_request("invalid_fluid_observation", e.message())
            }
            _ => ApiError::conflict("fluid_observation_conflict", e.message()),
        };
    }
    ApiError::conflict("fluid_write_unconfirmed","This change could not be confirmed. Refresh and review its history before recording another change.")
}
