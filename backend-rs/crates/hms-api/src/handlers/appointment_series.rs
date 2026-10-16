use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::RequestContext,
    response::{ListResponse, ObjectResponse},
    services::appointment_series as service,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use hms_domain::appointment_series::*;
use uuid::Uuid;

#[utoipa::path(post,path="/api/v2/scheduling/appointment-series",operation_id="postSchedulingAppointmentSeries",tag="scheduling",security(("bearerAuth"=[])),request_body=CreateAppointmentSeriesRequest,responses((status=200,body=ObjectResponse<AppointmentSeriesDetail>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn create(
    State(s): State<AppState>,
    RequestContext(ctx): RequestContext,
    Json(data): Json<CreateAppointmentSeriesRequest>,
) -> Result<Json<ObjectResponse<AppointmentSeriesDetail>>, ApiError> {
    Ok(Json(service::create(&s, &ctx, data).await?))
}
#[utoipa::path(get,path="/api/v2/scheduling/appointment-series",operation_id="getSchedulingAppointmentSeries",tag="scheduling",security(("bearerAuth"=[])),params(AppointmentSeriesListQuery),responses((status=200,body=ListResponse<AppointmentSeriesListItem>),(status=403,body=ApiErrorResponse)))]
pub async fn list(
    State(s): State<AppState>,
    RequestContext(ctx): RequestContext,
    Query(data): Query<AppointmentSeriesListQuery>,
) -> Result<Json<ListResponse<AppointmentSeriesListItem>>, ApiError> {
    Ok(Json(service::list(&s, &ctx, data).await?))
}
#[utoipa::path(get,path="/api/v2/scheduling/appointment-series/{id}",operation_id="getSchedulingAppointmentSeriesById",tag="scheduling",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=ObjectResponse<AppointmentSeriesDetail>),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn get(
    State(s): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AppointmentSeriesDetail>>, ApiError> {
    Ok(Json(service::get(&s, &ctx, id).await?))
}
#[utoipa::path(get,path="/api/v2/scheduling/appointment-series/requests/{client_request_id}",operation_id="getSchedulingAppointmentSeriesByRequest",tag="scheduling",security(("bearerAuth"=[])),params(("client_request_id"=Uuid,Path)),responses((status=200,body=ObjectResponse<AppointmentSeriesDetail>),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse)))]
pub async fn by_request(
    State(s): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<AppointmentSeriesDetail>>, ApiError> {
    Ok(Json(service::by_request(&s, &ctx, id).await?))
}
#[utoipa::path(post,path="/api/v2/scheduling/appointment-series/{id}/cancel-future",operation_id="postSchedulingAppointmentSeriesCancelFuture",tag="scheduling",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),request_body=CancelFutureAppointmentsRequest,responses((status=200,body=ObjectResponse<AppointmentSeriesCancellationReceipt>),(status=400,body=ApiErrorResponse),(status=403,body=ApiErrorResponse),(status=404,body=ApiErrorResponse),(status=409,body=ApiErrorResponse)))]
pub async fn cancel_future(
    State(s): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(data): Json<CancelFutureAppointmentsRequest>,
) -> Result<Json<ObjectResponse<AppointmentSeriesCancellationReceipt>>, ApiError> {
    Ok(Json(service::cancel_future(&s, &ctx, id, data).await?))
}
