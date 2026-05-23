use axum::extract::State;
use axum::Json;

use crate::error::{ApiError, ApiErrorResponse};
use crate::ops_auth::OpsOperator;
use crate::response::ObjectResponse;
use crate::services::ops::{
    OpsDatabaseSnapshot, OpsFrontendSnapshot, OpsOverviewSnapshot, OpsPerformanceSnapshot,
};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/v2/ops/overview",
    operation_id = "getOpsOverview",
    tag = "ops",
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Engineer dashboard overview snapshot", body = ObjectResponse<OpsOverviewSnapshot>),
        (status = 401, description = "Ops operator authentication is required", body = ApiErrorResponse),
        (status = 403, description = "Ops operator access is required", body = ApiErrorResponse)
    )
)]
pub async fn overview(
    State(state): State<AppState>,
    operator: OpsOperator,
) -> Result<Json<ObjectResponse<OpsOverviewSnapshot>>, ApiError> {
    Ok(Json(state.ops_service().overview(&operator).await?))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/performance",
    operation_id = "getOpsPerformance",
    tag = "ops",
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "PHI-safe API performance snapshot", body = ObjectResponse<OpsPerformanceSnapshot>),
        (status = 401, description = "Ops operator authentication is required", body = ApiErrorResponse),
        (status = 403, description = "Ops operator access is required", body = ApiErrorResponse)
    )
)]
pub async fn performance(
    State(state): State<AppState>,
    operator: OpsOperator,
) -> Result<Json<ObjectResponse<OpsPerformanceSnapshot>>, ApiError> {
    Ok(Json(state.ops_service().performance(&operator).await?))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/database",
    operation_id = "getOpsDatabase",
    tag = "ops",
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "PHI-safe database and pool snapshot", body = ObjectResponse<OpsDatabaseSnapshot>),
        (status = 401, description = "Ops operator authentication is required", body = ApiErrorResponse),
        (status = 403, description = "Ops operator access is required", body = ApiErrorResponse)
    )
)]
pub async fn database(
    State(state): State<AppState>,
    operator: OpsOperator,
) -> Result<Json<ObjectResponse<OpsDatabaseSnapshot>>, ApiError> {
    Ok(Json(state.ops_service().database(&operator).await?))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/frontend",
    operation_id = "getOpsFrontend",
    tag = "ops",
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "PHI-safe frontend RUM snapshot", body = ObjectResponse<OpsFrontendSnapshot>),
        (status = 401, description = "Ops operator authentication is required", body = ApiErrorResponse),
        (status = 403, description = "Ops operator access is required", body = ApiErrorResponse)
    )
)]
pub async fn frontend(
    State(state): State<AppState>,
    operator: OpsOperator,
) -> Result<Json<ObjectResponse<OpsFrontendSnapshot>>, ApiError> {
    Ok(Json(state.ops_service().frontend(&operator).await?))
}
