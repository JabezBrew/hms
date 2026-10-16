use crate::{
    cursor_list,
    error::ApiError,
    response::{object, ListResponse, ObjectResponse},
    state::AppState,
};
use hms_domain::{appointment_series::*, deployment::PermissionCode};
use uuid::Uuid;

fn actor(
    state: &AppState,
    ctx: &hms_access::RequestContext,
) -> hms_db::appointment_series::SeriesActor {
    hms_db::appointment_series::SeriesActor {
        facility_id: state.facility_id(),
        user_id: ctx.user_id,
        request_id: Some(ctx.request_id.clone()),
    }
}
fn permission(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    code: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, state.facility_id(), code)
        .map_err(ApiError::from)
}
async fn patient(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
) -> Result<(), ApiError> {
    let value = hms_db::patients::get_patient(state.db_pool(), state.facility_id(), id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "The patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "The patient was not found."))?;
    hms_access::require_patient_demographics_access(ctx, &value).map_err(ApiError::from)?;
    Ok(())
}
async fn authorize_series(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
    code: PermissionCode,
) -> Result<(), ApiError> {
    permission(state, ctx, code)?;
    let id = hms_db::appointment_series::series_patient(state.db_pool(), state.facility_id(), id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_series_read_failed",
                "The appointment series could not be loaded.",
            )
        })?
        .ok_or_else(not_found)?;
    patient(state, ctx, id).await
}
fn not_found() -> ApiError {
    ApiError::not_found(
        "appointment_series_not_found",
        "The appointment series was not found.",
    )
}
fn write_error(error: anyhow::Error, operation: &str) -> ApiError {
    use hms_db::appointment_series::SeriesError as E;
    if let Some(reason) = error.downcast_ref::<E>() {
        return match reason {
            E::Invalid => ApiError::bad_request("invalid_appointment_series", reason.message()),
            E::References => ApiError::conflict(
                "appointment_series_references_unavailable",
                reason.message(),
            ),
            E::SlotChanged => {
                ApiError::conflict("appointment_series_slot_changed", reason.message())
            }
            E::RequestConflict => {
                ApiError::conflict("appointment_series_request_conflict", reason.message())
            }
            E::SnapshotChanged => {
                ApiError::conflict("appointment_series_snapshot_changed", reason.message())
            }
            E::Incomplete => ApiError::conflict("appointment_series_unconfirmed", reason.message()),
        };
    }
    // These are explicit booking-policy rejections before the transaction commits.
    if matches!(
        error.to_string().as_str(),
        "appointment must be inside clinic session time"
            | "appointment practitioner does not match session practitioner"
            | "appointment type is required for this session"
            | "appointment type is not allowed in this session"
            | "appointment overlaps blocked time"
            | "clinic session capacity is full"
            | "overbooking reason is required"
            | "clinic session overbook limit is full"
            | "session practitioner is not active in facility"
    ) {
        return ApiError::conflict("appointment_series_slot_unavailable","A selected slot no longer satisfies capacity, service or blocked-time rules. Refresh the selected dates before booking.");
    }
    ApiError::conflict(if operation=="create"{"appointment_series_create_unconfirmed"}else{"appointment_series_cancel_unconfirmed"},"This change may already be saved. Review the appointment series before making another change.")
}
pub async fn create(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    data: CreateAppointmentSeriesRequest,
) -> Result<ObjectResponse<AppointmentSeriesDetail>, ApiError> {
    permission(state, ctx, PermissionCode::AppointmentManage)?;
    patient(state, ctx, data.patient_id).await?;
    let saved = hms_db::appointment_series::create_series(state.db_pool(), actor(state, ctx), data)
        .await
        .map_err(|e| write_error(e, "create"))?;
    Ok(object(saved))
}
pub async fn get(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
) -> Result<ObjectResponse<AppointmentSeriesDetail>, ApiError> {
    authorize_series(state, ctx, id, PermissionCode::AppointmentView).await?;
    let saved = hms_db::appointment_series::get_series(state.db_pool(), state.facility_id(), id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "appointment_series_read_failed",
                "The complete appointment series could not be loaded.",
            )
        })?
        .ok_or_else(not_found)?;
    Ok(object(saved))
}
pub async fn by_request(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
) -> Result<ObjectResponse<AppointmentSeriesDetail>, ApiError> {
    permission(state, ctx, PermissionCode::AppointmentView)?;
    let series =
        hms_db::appointment_series::series_by_request(state.db_pool(), &actor(state, ctx), id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "appointment_series_read_failed",
                    "The booking result could not be checked.",
                )
            })?
            .ok_or_else(not_found)?;
    get(state, ctx, series).await
}
pub async fn list(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    query: AppointmentSeriesListQuery,
) -> Result<ListResponse<AppointmentSeriesListItem>, ApiError> {
    permission(state, ctx, PermissionCode::AppointmentView)?;
    patient(state, ctx, query.patient_id).await?;
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        25,
        100,
        |occurred_at, id| hms_db::care::CareCursor { occurred_at, id },
    )
    .map_err(|_| ApiError::bad_request("invalid_cursor", "The series cursor is invalid."))?;
    let fetch_limit = page.fetch_limit();
    let rows = hms_db::appointment_series::list_series(
        state.db_pool(),
        state.facility_id(),
        query.patient_id,
        page.cursor,
        fetch_limit,
    )
    .await
    .map_err(|_| {
        ApiError::conflict(
            "appointment_series_read_failed",
            "Appointment series could not be loaded.",
        )
    })?;
    Ok(cursor_list::page_response(rows, page.limit, |r| {
        cursor_list::encode_cursor(r.created_at, r.id)
    }))
}
pub async fn cancel_future(
    state: &AppState,
    ctx: &hms_access::RequestContext,
    id: Uuid,
    data: CancelFutureAppointmentsRequest,
) -> Result<ObjectResponse<AppointmentSeriesCancellationReceipt>, ApiError> {
    authorize_series(state, ctx, id, PermissionCode::AppointmentManage).await?;
    let saved =
        hms_db::appointment_series::cancel_future(state.db_pool(), actor(state, ctx), id, data)
            .await
            .map_err(|e| write_error(e, "cancel"))?
            .ok_or_else(not_found)?;
    Ok(object(saved))
}
