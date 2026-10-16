use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::RequestContext,
    response::{ListResponse, ObjectResponse},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use hms_domain::{care::CursorListQuery, fluid::*};
use uuid::Uuid;

#[utoipa::path(get,path="/api/v2/nursing/fluid-observations",operation_id="getFluidObservations",tag="nursing",security(("bearerAuth"=[])),
params(FluidObservationQuery),
responses((status=200,description="Fluid workflow response",body=ListResponse<FluidObservation>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn list(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Query(q): Query<FluidObservationQuery>,
) -> Result<Json<ListResponse<FluidObservation>>, ApiError> {
    Ok(Json(state.ward_services().fluid().list(&ctx, q).await?))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-observations/summary",operation_id="getFluidObservationSummary",tag="nursing",security(("bearerAuth"=[])),
params(FluidObservationQuery),
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidEffectiveSummary>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn summary(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Query(q): Query<FluidObservationQuery>,
) -> Result<Json<ObjectResponse<FluidEffectiveSummary>>, ApiError> {
    Ok(Json(state.ward_services().fluid().summary(&ctx, q).await?))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-observations/{id}",operation_id="getFluidObservationById",tag="nursing",security(("bearerAuth"=[])),
params(("id"=Uuid,Path,description="Fluid observation id")),
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidObservation>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn get(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<FluidObservation>>, ApiError> {
    Ok(Json(state.ward_services().fluid().get(&ctx, id).await?))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-observations/{id}/history",operation_id="getFluidObservationHistory",tag="nursing",security(("bearerAuth"=[])),
params(("id"=Uuid,Path,description="Fluid observation id"),CursorListQuery),
responses((status=200,description="Fluid workflow response",body=ListResponse<FluidObservation>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn history(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Query(q): Query<CursorListQuery>,
) -> Result<Json<ListResponse<FluidObservation>>, ApiError> {
    Ok(Json(
        state.ward_services().fluid().history(&ctx, id, q).await?,
    ))
}

#[utoipa::path(post,path="/api/v2/nursing/fluid-observations",operation_id="postFluidObservation",tag="nursing",security(("bearerAuth"=[])),
request_body=CreateFluidObservationRequest,
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidWriteResult>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn create(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Json(p): Json<CreateFluidObservationRequest>,
) -> Result<Json<ObjectResponse<FluidWriteResult>>, ApiError> {
    Ok(Json(state.ward_services().fluid().create(&ctx, p).await?))
}

#[utoipa::path(post,path="/api/v2/nursing/fluid-observations/{id}/corrections",operation_id="postFluidObservationCorrection",tag="nursing",security(("bearerAuth"=[])),
params(("id"=Uuid,Path,description="Fluid observation id")),
request_body=CorrectFluidObservationRequest,
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidWriteResult>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn correct(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(p): Json<CorrectFluidObservationRequest>,
) -> Result<Json<ObjectResponse<FluidWriteResult>>, ApiError> {
    Ok(Json(
        state.ward_services().fluid().correct(&ctx, id, p).await?,
    ))
}

#[utoipa::path(post,path="/api/v2/nursing/fluid-observations/{id}/void",operation_id="postFluidObservationVoid",tag="nursing",security(("bearerAuth"=[])),
params(("id"=Uuid,Path,description="Fluid observation id")),
request_body=VoidFluidObservationRequest,
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidWriteResult>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn void(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Path(id): Path<Uuid>,
    Json(p): Json<VoidFluidObservationRequest>,
) -> Result<Json<ObjectResponse<FluidWriteResult>>, ApiError> {
    Ok(Json(state.ward_services().fluid().void(&ctx, id, p).await?))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-monitoring/rules",operation_id="getFluidMonitoringRules",tag="nursing",security(("bearerAuth"=[])),
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidRuleSettings>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn rules(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
) -> Result<Json<ObjectResponse<FluidRuleSettings>>, ApiError> {
    Ok(Json(state.ward_services().fluid().rules(&ctx).await?))
}

#[utoipa::path(post,path="/api/v2/nursing/fluid-monitoring/rules",operation_id="postFluidMonitoringRules",tag="nursing",security(("bearerAuth"=[])),
request_body=UpdateFluidRuleSettingsRequest,
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidRuleSettings>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn update_rules(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Json(p): Json<UpdateFluidRuleSettingsRequest>,
) -> Result<Json<ObjectResponse<FluidRuleSettings>>, ApiError> {
    Ok(Json(
        state.ward_services().fluid().update_rules(&ctx, p).await?,
    ))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-monitoring/assessment",operation_id="getFluidMonitoringAssessment",tag="nursing",security(("bearerAuth"=[])),
params(FluidAssessmentQuery),
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidAssessment>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn assessment(
    State(state): State<AppState>,
    RequestContext(ctx): RequestContext,
    Query(q): Query<FluidAssessmentQuery>,
) -> Result<Json<ObjectResponse<FluidAssessment>>, ApiError> {
    Ok(Json(
        state.ward_services().fluid().assessment(&ctx, q).await?,
    ))
}
