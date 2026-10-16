use crate::{
    error::{ApiError, ApiErrorResponse},
    extractors::NetworkContext,
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
    n: NetworkContext,
    q: Result<Query<FluidObservationQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ListResponse<FluidObservation>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .list(&n.context, n.authorization_deadline, query(q)?)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-observations/summary",operation_id="getFluidObservationSummary",tag="nursing",security(("bearerAuth"=[])),
params(FluidObservationQuery),
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidEffectiveSummary>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn summary(
    State(state): State<AppState>,
    n: NetworkContext,
    q: Result<Query<FluidObservationQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ObjectResponse<FluidEffectiveSummary>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .summary(&n.context, n.authorization_deadline, query(q)?)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-observations/{id}",operation_id="getFluidObservationById",tag="nursing",security(("bearerAuth"=[])),
params(("id"=Uuid,Path,description="Fluid observation id")),
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidObservation>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn get(
    State(state): State<AppState>,
    n: NetworkContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<FluidObservation>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .get(&n.context, n.authorization_deadline, id)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-observations/{id}/history",operation_id="getFluidObservationHistory",tag="nursing",security(("bearerAuth"=[])),
params(("id"=Uuid,Path,description="Fluid observation id"),CursorListQuery),
responses((status=200,description="Fluid workflow response",body=ListResponse<FluidObservation>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn history(
    State(state): State<AppState>,
    n: NetworkContext,
    Path(id): Path<Uuid>,
    q: Result<Query<CursorListQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ListResponse<FluidObservation>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .history(&n.context, n.authorization_deadline, id, query(q)?)
            .await?,
    ))
}

#[utoipa::path(post,path="/api/v2/nursing/fluid-observations",operation_id="postFluidObservation",tag="nursing",security(("bearerAuth"=[])),
request_body=CreateFluidObservationRequest,
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidWriteResult>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn create(
    State(state): State<AppState>,
    n: NetworkContext,
    p: Result<Json<CreateFluidObservationRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<FluidWriteResult>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .create(&n.context, n.authorization_deadline, body(p)?)
            .await?,
    ))
}

#[utoipa::path(post,path="/api/v2/nursing/fluid-observations/{id}/corrections",operation_id="postFluidObservationCorrection",tag="nursing",security(("bearerAuth"=[])),
params(("id"=Uuid,Path,description="Fluid observation id")),
request_body=CorrectFluidObservationRequest,
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidWriteResult>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn correct(
    State(state): State<AppState>,
    n: NetworkContext,
    Path(id): Path<Uuid>,
    p: Result<Json<CorrectFluidObservationRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<FluidWriteResult>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .correct(&n.context, n.authorization_deadline, id, body(p)?)
            .await?,
    ))
}

#[utoipa::path(post,path="/api/v2/nursing/fluid-observations/{id}/void",operation_id="postFluidObservationVoid",tag="nursing",security(("bearerAuth"=[])),
params(("id"=Uuid,Path,description="Fluid observation id")),
request_body=VoidFluidObservationRequest,
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidWriteResult>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn void(
    State(state): State<AppState>,
    n: NetworkContext,
    Path(id): Path<Uuid>,
    p: Result<Json<VoidFluidObservationRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<FluidWriteResult>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .void(&n.context, n.authorization_deadline, id, body(p)?)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-monitoring/rules",operation_id="getFluidMonitoringRules",tag="nursing",security(("bearerAuth"=[])),
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidRuleSettings>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn rules(
    State(state): State<AppState>,
    n: NetworkContext,
) -> Result<Json<ObjectResponse<FluidRuleSettings>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .rules(&n.context, n.authorization_deadline)
            .await?,
    ))
}

#[utoipa::path(post,path="/api/v2/nursing/fluid-monitoring/rules",operation_id="postFluidMonitoringRules",tag="nursing",security(("bearerAuth"=[])),
request_body=UpdateFluidRuleSettingsRequest,
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidRuleSettings>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn update_rules(
    State(state): State<AppState>,
    n: NetworkContext,
    p: Result<Json<UpdateFluidRuleSettingsRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ObjectResponse<FluidRuleSettings>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .update_rules(&n.context, n.authorization_deadline, body(p)?)
            .await?,
    ))
}

#[utoipa::path(get,path="/api/v2/nursing/fluid-monitoring/assessment",operation_id="getFluidMonitoringAssessment",tag="nursing",security(("bearerAuth"=[])),
params(FluidAssessmentQuery),
responses((status=200,description="Fluid workflow response",body=ObjectResponse<FluidAssessment>),(status=400,description="Invalid request",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse),(status=409,description="Conflict or unconfirmed write; inspect error code",body=ApiErrorResponse)))]
pub async fn assessment(
    State(state): State<AppState>,
    n: NetworkContext,
    q: Result<Query<FluidAssessmentQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ObjectResponse<FluidAssessment>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .assessment(&n.context, n.authorization_deadline, query(q)?)
            .await?,
    ))
}

fn query<T>(
    value: Result<Query<T>, axum::extract::rejection::QueryRejection>,
) -> Result<T, ApiError> {
    value.map(|v| v.0).map_err(|_| {
        ApiError::bad_request(
            "invalid_fluid_query",
            "Review the supported fluid scope, timestamps and pagination fields.",
        )
    })
}
fn body<T>(value: Result<Json<T>, axum::extract::rejection::JsonRejection>) -> Result<T, ApiError> {
    value.map(|v| v.0).map_err(|_| {
        ApiError::bad_request(
            "invalid_fluid_request",
            "Review the supported fluid fields and value types.",
        )
    })
}
#[utoipa::path(get,path="/api/v2/nursing/fluid-observations/context",operation_id="getFluidObservationContext",tag="nursing",security(("bearerAuth"=[])),params(FluidObservationContextQuery),responses((status=200,description="Current authorized admission context",body=ObjectResponse<FluidObservationContext>),(status=400,description="Invalid scope",body=ApiErrorResponse),(status=403,description="Access denied",body=ApiErrorResponse)))]
pub async fn context(
    State(state): State<AppState>,
    n: NetworkContext,
    q: Result<Query<FluidObservationContextQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<ObjectResponse<FluidObservationContext>>, ApiError> {
    Ok(Json(
        state
            .ward_services()
            .fluid()
            .context(&n.context, n.authorization_deadline, query(q)?)
            .await?,
    ))
}
