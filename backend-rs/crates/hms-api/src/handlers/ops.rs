use axum::extract::{RawQuery, State};
use axum::http::header::CACHE_CONTROL;
use axum::Json;

use crate::error::{ApiError, ApiErrorResponse};
use crate::ops_auth::OpsOperator;
use crate::response::ObjectResponse;
use crate::services::ops::{
    OpsClinicalBudgetSnapshot, OpsDashboardQuery, OpsDbPoolSnapshot, OpsDeploysSnapshot,
    OpsEdgeStatusSnapshot, OpsOverviewSnapshot, OpsPayloadSnapshot, OpsRequestContextCacheSnapshot,
    OpsRouteLatencySnapshot, OpsRumSnapshot, OpsService, OpsServiceErrorsSnapshot,
    OpsSlowQueryFingerprintSnapshot,
};
use crate::state::AppState;

type OpsResponse<T> = (
    [(axum::http::HeaderName, &'static str); 1],
    Json<ObjectResponse<T>>,
);

#[utoipa::path(
    get,
    path = "/api/v2/ops/overview",
    operation_id = "getOpsOverview",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Engineer dashboard overview snapshot", body = ObjectResponse<OpsOverviewSnapshot>),
        (status = 400, description = "Invalid ops query", body = ApiErrorResponse),
        (status = 401, description = "Ops operator authentication is required", body = ApiErrorResponse),
        (status = 403, description = "Ops operator access is required", body = ApiErrorResponse)
    )
)]
pub async fn overview(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsOverviewSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state.ops_service().overview(&operator, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/route-latency",
    operation_id = "getOpsRouteLatency",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "PHI-safe route latency snapshot", body = ObjectResponse<OpsRouteLatencySnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn route_latency(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsRouteLatencySnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state.ops_service().route_latency(&operator, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/clinical-budgets",
    operation_id = "getOpsClinicalBudgets",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Clinical performance budget snapshot", body = ObjectResponse<OpsClinicalBudgetSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn clinical_budgets(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsClinicalBudgetSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state
            .ops_service()
            .clinical_budgets(&operator, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/db-pool",
    operation_id = "getOpsDbPool",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Database pool pressure snapshot", body = ObjectResponse<OpsDbPoolSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn db_pool(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsDbPoolSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state.ops_service().db_pool(&operator, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/request-context-cache",
    operation_id = "getOpsRequestContextCache",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "RequestContext cache and hydration snapshot", body = ObjectResponse<OpsRequestContextCacheSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn request_context_cache(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsRequestContextCacheSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state
            .ops_service()
            .request_context_cache(&operator, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/payload",
    operation_id = "getOpsPayload",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "API payload size snapshot", body = ObjectResponse<OpsPayloadSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn payload(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsPayloadSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state.ops_service().payload(&operator, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/rum",
    operation_id = "getOpsRum",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Browser RUM snapshot", body = ObjectResponse<OpsRumSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn rum(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsRumSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(state.ops_service().rum(&operator, query).await?))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/slow-query-fingerprints",
    operation_id = "getOpsSlowQueryFingerprints",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Redacted slow query fingerprint snapshot", body = ObjectResponse<OpsSlowQueryFingerprintSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn slow_query_fingerprints(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsSlowQueryFingerprintSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state
            .ops_service()
            .slow_query_fingerprints(&operator, query)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/service-errors",
    operation_id = "getOpsServiceErrors",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Service error snapshot or unavailable source note", body = ObjectResponse<OpsServiceErrorsSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn service_errors(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsServiceErrorsSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state.ops_service().service_errors(&operator, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/deploys",
    operation_id = "getOpsDeploys",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Deploy history snapshot or unavailable source note", body = ObjectResponse<OpsDeploysSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn deploys(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsDeploysSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state.ops_service().deploys(&operator, query).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v2/ops/edge-status",
    operation_id = "getOpsEdgeStatus",
    tag = "ops",
    params(OpsDashboardQuery),
    security(("cloudflareAccess" = []), ("bearerAuth" = [])),
    responses(
        (status = 200, description = "Edge status snapshot or unavailable source note", body = ObjectResponse<OpsEdgeStatusSnapshot>),
        (status = 400, body = ApiErrorResponse),
        (status = 401, body = ApiErrorResponse),
        (status = 403, body = ApiErrorResponse)
    )
)]
pub async fn edge_status(
    State(state): State<AppState>,
    operator: OpsOperator,
    RawQuery(raw_query): RawQuery,
) -> Result<OpsResponse<OpsEdgeStatusSnapshot>, ApiError> {
    let query = OpsService::parse_query(raw_query.as_deref())?;
    Ok(no_store(
        state.ops_service().edge_status(&operator, query).await?,
    ))
}

fn no_store<T>(body: ObjectResponse<T>) -> OpsResponse<T> {
    ([(CACHE_CONTROL, "no-store")], Json(body))
}
