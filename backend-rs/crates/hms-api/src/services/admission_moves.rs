use crate::{
    cursor_list,
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use chrono::{DateTime, Utc};
use hms_db::ward::admission_moves::{self as db, AdmissionMoveActor, MoveError};
use hms_domain::{auth::PatientDataVisibility, deployment::PermissionCode, ward_moves::*};
use uuid::Uuid;
#[derive(Clone)]
pub struct AdmissionMovesService {
    state: AppState,
}
impl AdmissionMovesService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
    fn actor(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
    ) -> Result<AdmissionMoveActor, ApiError> {
        hms_access::require_facility_permission(
            ctx,
            self.state.facility_id(),
            PermissionCode::AdmissionManage,
        )?;
        if !ctx.has_patient_visibility(PatientDataVisibility::FullClinical) {
            return Err(ApiError::forbidden(
                "admission_move_unavailable",
                "Current full clinical and admission authority is required.",
            ));
        }
        Ok(AdmissionMoveActor {
            facility_id: ctx.facility_id,
            user_id: ctx.user_id,
            request_id: Some(ctx.request_id.clone()),
            authorization: crate::services::clinical::prescription_courses::authorization(
                ctx, deadline,
            ),
        })
    }
    pub async fn context(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case: Uuid,
    ) -> Result<ObjectResponse<AdmissionPlacementContext>, ApiError> {
        Ok(object(
            db::context(
                self.state.db_pool(),
                self.actor(ctx, deadline)?,
                patient,
                case,
            )
            .await
            .map_err(|e| map_error(e, false))?,
        ))
    }
    pub async fn destinations(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case: Uuid,
        q: AdmissionMoveDestinationQuery,
    ) -> Result<ListResponse<AdmissionMoveDestination>, ApiError> {
        let page =
            cursor_list::page_request(q.cursor.as_deref(), q.limit, 25, 100, |at, id| (at, id))
                .map_err(|_| invalid())?;
        let rows = db::destinations(
            self.state.db_pool(),
            self.actor(ctx, deadline)?,
            patient,
            case,
            q.ward_id,
            q.search,
            page.cursor,
            page.fetch_limit(),
        )
        .await
        .map_err(|e| map_error(e, false))?;
        let page = cursor_list::page_response(rows, page.limit, |row| {
            cursor_list::encode_cursor(row.1, row.0.labels.bed_id)
        });
        Ok(ListResponse {
            data: page.data.into_iter().map(|v| v.0).collect(),
            page: page.page,
            meta: page.meta,
        })
    }
    pub async fn command(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case: Uuid,
        input: AdmissionMoveRequest,
    ) -> Result<ObjectResponse<AdmissionMoveReceipt>, ApiError> {
        let actor = self.actor(ctx, deadline)?;
        let result = db::move_admission(self.state.db_pool(), actor, patient, case, input).await;
        self.state.invalidate_patient_chronicle_cache();
        self.state.invalidate_ward_board_cache();
        self.state.invalidate_patient_list_cache();
        Ok(object(result.map_err(|e| map_error(e, true))?))
    }
    pub async fn history(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case: Uuid,
        q: AdmissionMoveHistoryQuery,
    ) -> Result<ListResponse<AdmissionMoveHistoryItem>, ApiError> {
        let before = q
            .cursor
            .as_deref()
            .map(|c| {
                c.strip_prefix("v:")
                    .filter(|v| {
                        !v.is_empty() && v.len() <= 19 && v.bytes().all(|b| b.is_ascii_digit())
                    })
                    .and_then(|v| v.parse::<i64>().ok())
                    .filter(|v| *v > 0)
                    .ok_or_else(invalid)
            })
            .transpose()?;
        let limit = q.limit.unwrap_or(25).clamp(1, 100);
        let rows = db::history(
            self.state.db_pool(),
            self.actor(ctx, deadline)?,
            patient,
            case,
            before,
            i64::from(limit) + 1,
        )
        .await
        .map_err(|e| map_error(e, false))?;
        Ok(cursor_list::page_response(rows, limit, |v| {
            format!("v:{}", v.placement_revision)
        }))
    }
    pub async fn detail(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case: Uuid,
        id: Uuid,
    ) -> Result<ObjectResponse<AdmissionMoveDetail>, ApiError> {
        Ok(object(
            db::detail(
                self.state.db_pool(),
                self.actor(ctx, deadline)?,
                patient,
                case,
                id,
            )
            .await
            .map_err(|e| map_error(e, false))?,
        ))
    }
    pub async fn receipt(
        &self,
        ctx: &hms_access::RequestContext,
        deadline: DateTime<Utc>,
        patient: Uuid,
        case: Uuid,
        key: Uuid,
    ) -> Result<ObjectResponse<AdmissionMoveReceipt>, ApiError> {
        Ok(object(
            db::receipt(
                self.state.db_pool(),
                self.actor(ctx, deadline)?,
                patient,
                case,
                key,
            )
            .await
            .map_err(|e| map_error(e, false))?,
        ))
    }
}
pub fn invalid() -> ApiError {
    ApiError::bad_request("invalid_admission_move","Review the supported move fields, explicit destination, source review and request reference.")
}
fn map_error(error: anyhow::Error, write: bool) -> ApiError {
    if let Some(error) = ApiError::network_publication(&error) {
        return error;
    }
    if error.is::<hms_db::clinical::prescription_courses::PrescriptionCourseError>()
        || error.is::<hms_db::clinical::medication_access::MedicationAccessError>()
    {
        return ApiError::forbidden(
            "admission_move_unavailable",
            "Current patient, admission and ward authorization is required.",
        );
    }
    if let Some(e) = error.downcast_ref::<MoveError>() {
        return match e{
  MoveError::InvalidInput=>invalid(),MoveError::Unavailable=>ApiError::forbidden("admission_move_unavailable","Current full clinical care, admission and ward authority is required."),MoveError::NotFound=>ApiError::not_found("admission_move_not_found","The selected placement evidence was not found."),
  MoveError::SourceChanged=>ApiError::conflict("admission_move_source_changed","The source placement changed. Review its current context."),MoveError::DestinationChanged=>ApiError::conflict("admission_move_destination_changed","The selected destination changed or is unavailable. Select and review a current bed."),MoveError::TasksChanged=>ApiError::conflict("admission_move_tasks_changed","Open nursing work changed. Review the complete current task counts."),MoveError::RequestConflict=>ApiError::conflict("admission_move_request_conflict","This request reference belongs to another reviewed move."),MoveError::Busy=>ApiError::conflict("admission_move_busy","Placement or nursing work is currently in use. Reload current context before reviewing again."),MoveError::TaskLimit=>ApiError::conflict("admission_move_task_limit","This admission exceeds the supported open-task limit. Resolve work before moving.")};
    }
    if write {
        ApiError::conflict("admission_move_write_unconfirmed","The move outcome could not be confirmed. Keep the exact request reference and review its saved receipt before another change.")
    } else {
        ApiError::conflict(
            "admission_move_failed",
            "The complete protected placement could not be loaded.",
        )
    }
}
