use super::scheduling::{encode_cursor, page_request, page_response};
use crate::{
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_access::RequestContext;
use hms_db::appointment_types::{self as db, AppointmentTypeActor, AppointmentTypeError as E};
use hms_domain::scheduling::SchedulingListQuery;
use hms_domain::{appointment_types::*, deployment::PermissionCode};
use uuid::Uuid;
#[derive(Clone)]
pub struct AppointmentTypeService {
    state: AppState,
}
impl AppointmentTypeService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    fn actor(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
    ) -> Result<AppointmentTypeActor, ApiError> {
        require_scheduling_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentManage,
        )?;
        if !ctx.reauth_is_fresh_at(Utc::now()) {
            return Err(ApiError::forbidden(
                "reauth_required",
                "Confirm your current credentials before maintaining appointment types.",
            ));
        }
        Ok(AppointmentTypeActor {
            facility_id: self.state.facility_id(),
            user_id: ctx.user_id,
            request_id: ctx.request_id.clone(),
            authorization: crate::services::clinical::prescription_courses::ordinary_authorization(
                ctx,
                deadline.min(ctx.reauth.required_after),
            )?,
        })
    }
    pub async fn command(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        input: AppointmentTypeReviewedInput,
    ) -> Result<ObjectResponse<AppointmentTypeCommandReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline)?;
        Ok(object(
            db::execute(self.state.db_pool(), actor, input)
                .await
                .map_err(|e| error(e, true))?,
        ))
    }
    pub async fn receipt(
        &self,
        ctx: &RequestContext,
        deadline: DateTime<Utc>,
        key: Uuid,
    ) -> Result<ObjectResponse<AppointmentTypeCommandReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline)?;
        Ok(object(
            db::receipt(self.state.db_pool(), actor, key)
                .await
                .map_err(|e| error(e, false))?,
        ))
    }
    pub async fn detail(
        &self,
        ctx: &RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<GovernedAppointmentType>, ApiError> {
        require_scheduling_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentView,
        )?;
        Ok(object(
            db::detail(self.state.db_pool(), self.state.facility_id(), id)
                .await
                .map_err(|e| error(e, false))?
                .ok_or_else(|| {
                    ApiError::not_found(
                        "appointment_type_not_found",
                        "The appointment type was not found.",
                    )
                })?,
        ))
    }
    pub async fn list(
        &self,
        ctx: &RequestContext,
        input: AppointmentTypeAdministrationQuery,
    ) -> Result<ListResponse<GovernedAppointmentType>, ApiError> {
        require_scheduling_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::AppointmentView,
        )?;
        let (cursor, limit) = page_request(SchedulingListQuery {
            cursor: input.cursor.clone(),
            limit: input.limit,
        })?;
        if input.search.as_ref().is_some_and(|v| v.len() > 160) {
            return Err(ApiError::bad_request(
                "invalid_appointment_type_filter",
                "Use a bounded supported service filter.",
            ));
        }
        let rows = db::list(
            self.state.db_pool(),
            self.state.facility_id(),
            cursor,
            i64::from(limit) + 1,
            input,
        )
        .await
        .map_err(|e| error(e, false))?;
        Ok(page_response(rows, limit, |v| {
            encode_cursor(v.created_at, v.id)
        }))
    }
}
fn error(e: anyhow::Error, write: bool) -> ApiError {
    if let Some(v) = e.downcast_ref::<E>() {
        return match v{
 E::Invalid=>ApiError::bad_request("invalid_appointment_type_command","Review the supported fields, non-empty request reference and current version."),
 E::NotFound=>ApiError::not_found("appointment_type_not_found","The exact appointment type or original command was not found."),
 E::VersionConflict=>ApiError::conflict("appointment_type_version_conflict","The service changed. Refresh and review its current version."),
 E::RequestConflict=>ApiError::conflict("appointment_type_request_conflict","This request reference belongs to another reviewed service command."),
 E::FutureGenerator=>ApiError::conflict("appointment_type_future_generator","This workflow changes active state only for types without an active future session-template generator. Review that template before retiring this service."),
 E::Authority=>ApiError::forbidden("appointment_type_authority_required","Current scheduling management, demographics and Appointments feature access are required."),
 E::Busy=>ApiError::conflict("appointment_type_busy","This service or request is in use. Keep the same request and review its original result."),};
    }
    if e.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
        || e.is::<hms_db::clinical::medication_access::MedicationAccessError>()
        || e.is::<hms_db::network::NetworkPublicationError>()
    {
        return ApiError::forbidden(
            "appointment_type_authority_required",
            "Current scheduling authority, session and network proof are required.",
        );
    }
    if e.downcast_ref::<sqlx::Error>()
        .and_then(sqlx::Error::as_database_error)
        .is_some_and(|d| d.is_unique_violation())
    {
        return ApiError::conflict(
            "appointment_type_code_conflict",
            "This service code is already recorded in the facility.",
        );
    }
    if write {
        ApiError::conflict("appointment_type_write_unconfirmed","The change could not be confirmed. Keep the unchanged request and review its original receipt before another change.")
    } else {
        ApiError::conflict(
            "appointment_type_read_failed",
            "The appointment type or original result could not be loaded.",
        )
    }
}

fn require_scheduling_access(
    ctx: &RequestContext,
    facility: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility, permission).map_err(|_| {
        ApiError::forbidden(
            "appointment_type_authority_required",
            "Current scheduling, demographics and Appointments feature access are required.",
        )
    })
}
impl AppState {
    pub fn appointment_type_service(&self) -> AppointmentTypeService {
        AppointmentTypeService::new(self.clone())
    }
}
