use super::{common, nursing_access};
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
    fn actor(&self, ctx: &hms_access::RequestContext, deadline: DateTime<Utc>) -> FluidActor {
        nursing_access::actor(ctx, deadline)
    }
    async fn scope(
        &self,
        ctx: &hms_access::RequestContext,
        patient: Option<Uuid>,
        admission: Option<Uuid>,
        from: Option<DateTime<Utc>>,
        before: Option<DateTime<Utc>>,
    ) -> Result<(), ApiError> {
        nursing_access::require(ctx, self.state.facility_id(), true)?;
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
        deadline: DateTime<Utc>,
        id: Uuid,
    ) -> Result<FluidObservation, ApiError> {
        nursing_access::require(ctx, self.state.facility_id(), true)?;
        let (_, patient, _) = hms_db::ward::fluid_observation_scope(
            self.state.db_pool(),
            self.state.facility_id(),
            id,
        )
        .await
        .map_err(|_| read_error())?
        .ok_or_else(|| {
            ApiError::not_found(
                "fluid_observation_not_found",
                "Fluid observation was not found.",
            )
        })?;
        common::load_patient_for_access(&self.state, ctx, patient).await?;
        let source = hms_db::ward::get_fluid_observation_for_actor(
            self.state.db_pool(),
            self.actor(ctx, deadline),
            id,
        )
        .await
        .map_err(|e| fluid_error(e, false))?;
        Ok(source)
    }
    pub async fn context(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        q: FluidObservationContextQuery,
    ) -> Result<ObjectResponse<FluidObservationContext>, ApiError> {
        self.scope(
            ctx,
            Some(q.patient_id),
            Some(q.admission_case_id),
            None,
            None,
        )
        .await?;
        let mut result = hms_db::ward::fluid_context_for_actor(
            self.state.db_pool(),
            self.actor(ctx, deadline),
            q.patient_id,
            q.admission_case_id,
        )
        .await
        .map_err(|e| fluid_error(e, false))?;
        result.can_record_observation &= hms_access::require_offsite_write_allowed(ctx).is_ok();
        Ok(object(result))
    }
    pub async fn get(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        id: Uuid,
    ) -> Result<ObjectResponse<FluidObservation>, ApiError> {
        Ok(object(self.source(ctx, deadline, id).await?))
    }
    pub async fn list(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
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
        let rows = hms_db::ward::list_fluid_observations_for_actor(
            self.state.db_pool(),
            self.actor(ctx, deadline),
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
        .map_err(|e| fluid_error(e, false))?;
        Ok(common::page_response(rows, page.limit, |r| {
            common::encode_cursor(r.values.recorded_at, r.id)
        }))
    }
    pub async fn summary(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
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
            hms_db::ward::fluid_effective_summary_for_actor(
                self.state.db_pool(),
                self.actor(ctx, deadline),
                filters(
                    q.patient_id,
                    q.admission_case_id,
                    q.recorded_from,
                    q.recorded_before,
                    q.descending,
                ),
            )
            .await
            .map_err(|e| fluid_error(e, false))?,
        ))
    }
    pub async fn history(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        id: Uuid,
        q: CursorListQuery,
    ) -> Result<ListResponse<FluidObservation>, ApiError> {
        let source = self.source(ctx, deadline, id).await?;
        let page = common::page_request(q)?;
        let limit = page.fetch_limit();
        let rows = hms_db::ward::fluid_history_for_actor(
            self.state.db_pool(),
            self.actor(ctx, deadline),
            source.id,
            page.cursor,
            limit,
        )
        .await
        .map_err(|e| fluid_error(e, false))?;
        Ok(common::page_response(rows, page.limit, |r| {
            common::encode_cursor(r.created_at, r.id)
        }))
    }
    pub async fn create(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        p: CreateFluidObservationRequest,
    ) -> Result<ObjectResponse<FluidWriteResult>, ApiError> {
        nursing_access::require(ctx, self.state.facility_id(), true)?;
        let admission =
            common::load_admission_for_access(&self.state, ctx, p.admission_case_id).await?;
        if p.patient_id.is_some_and(|id| id != admission.patient_id) {
            return Err(ApiError::bad_request(
                "invalid_fluid_scope",
                "The selected patient and admission do not match.",
            ));
        }
        let result = hms_db::ward::create_fluid_observation(
            self.state.db_pool(),
            self.actor(ctx, deadline),
            admission.patient_id,
            p,
        )
        .await
        .map_err(|e| fluid_error(e, true))?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
    pub async fn correct(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        id: Uuid,
        p: CorrectFluidObservationRequest,
    ) -> Result<ObjectResponse<FluidWriteResult>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let source = self.source(ctx, deadline, id).await?;
        let result = hms_db::ward::correct_fluid_observation(
            self.state.db_pool(),
            self.actor(ctx, deadline),
            source,
            p,
        )
        .await
        .map_err(|e| fluid_error(e, true))?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
    pub async fn void(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        id: Uuid,
        p: VoidFluidObservationRequest,
    ) -> Result<ObjectResponse<FluidWriteResult>, ApiError> {
        common::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::NursingTaskManage,
        )?;
        let source = self.source(ctx, deadline, id).await?;
        let result = hms_db::ward::void_fluid_observation(
            self.state.db_pool(),
            self.actor(ctx, deadline),
            source,
            p,
        )
        .await
        .map_err(|e| fluid_error(e, true))?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
    pub async fn rules(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
    ) -> Result<ObjectResponse<FluidRuleSettings>, ApiError> {
        let admin =
            hms_access::require_admin_authority_access(ctx, self.state.facility_id()).is_ok();
        if !admin {
            common::require_patient_workflow_access(
                ctx,
                self.state.facility_id(),
                PermissionCode::NursingTaskManage,
            )?;
        }
        Ok(object(
            hms_db::ward::get_fluid_rules_for_actor(
                self.state.db_pool(),
                self.actor(ctx, deadline),
                admin,
            )
            .await
            .map_err(|e| fluid_error(e, false))?,
        ))
    }
    pub async fn update_rules(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        p: UpdateFluidRuleSettingsRequest,
    ) -> Result<ObjectResponse<FluidRuleSettings>, ApiError> {
        hms_access::require_admin_authority_access(ctx, self.state.facility_id())
            .map_err(ApiError::from)?;
        let result =
            hms_db::ward::update_fluid_rules(self.state.db_pool(), self.actor(ctx, deadline), p)
                .await
                .map_err(|e| fluid_error(e, true))?;
        self.state.invalidate_ward_board_cache();
        Ok(object(result))
    }
    pub async fn assessment(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        q: FluidAssessmentQuery,
    ) -> Result<ObjectResponse<FluidAssessment>, ApiError> {
        nursing_access::require(ctx, self.state.facility_id(), true)?;
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
            hms_db::ward::fluid_assessment_for_actor(
                self.state.db_pool(),
                self.actor(ctx, deadline),
                admission.patient_id,
                admission.id,
                date,
            )
            .await
            .map_err(|e| fluid_error(e, false))?,
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
pub(super) fn fluid_error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(error) = ApiError::network_publication(&error) {
        return error;
    }
    if error.is::<hms_db::ward::nursing_access::NursingError>() {
        return nursing_access::error(error, write);
    }
    if let Some(e) = error.downcast_ref::<FluidError>() {
        return match e {
            FluidError::AuthorizationExpired | FluidError::FeatureDisabled => {
                ApiError::forbidden("fluid_authorization_expired", e.message())
            }
            FluidError::InvalidRequest
            | FluidError::InvalidValues
            | FluidError::InvalidMetadata
            | FluidError::InvalidReason
            | FluidError::FutureObservation
            | FluidError::InvalidRules => {
                ApiError::bad_request("invalid_fluid_observation", e.message())
            }
            _ => ApiError::conflict("fluid_observation_conflict", e.message()),
        };
    }
    if !write {
        return read_error();
    }
    ApiError::conflict("fluid_write_unconfirmed","This change could not be confirmed. Refresh and review its history before recording another change.")
}
