use axum::extract::State;
use axum::http::header::CONTENT_TYPE;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::response::{object, ObjectResponse};
use crate::state::AppState;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct HealthDependencyStatus {
    pub name: String,
    pub ready: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct HealthStatus {
    pub service: String,
    pub status: String,
    pub version: String,
    pub started_at: DateTime<Utc>,
    pub dependencies: Vec<HealthDependencyStatus>,
}

#[utoipa::path(
    get,
    path = "/api/v2/health/alive",
    operation_id = "getHealthAlive",
    tag = "health",
    responses(
        (status = 200, description = "API process is alive", body = ObjectResponse<HealthStatus>)
    )
)]
pub async fn alive(State(state): State<AppState>) -> Json<ObjectResponse<HealthStatus>> {
    Json(object(health_status(state, "alive", Vec::new())))
}

#[utoipa::path(
    get,
    path = "/api/v2/health/ready",
    operation_id = "getHealthReady",
    tag = "health",
    responses(
        (status = 200, description = "API process is ready to serve traffic", body = ObjectResponse<HealthStatus>),
        (status = 503, description = "API process is not ready to serve traffic", body = ObjectResponse<HealthStatus>)
    )
)]
pub async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    let snapshot = state.readiness_snapshot().await;
    let http_status = if snapshot.ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let status = if snapshot.ready { "ready" } else { "not_ready" };
    let dependencies = snapshot
        .dependencies
        .into_iter()
        .map(|dependency| HealthDependencyStatus {
            name: dependency.name,
            ready: dependency.ready,
        })
        .collect();

    (
        http_status,
        Json(object(health_status(state, status, dependencies))),
    )
}

#[utoipa::path(
    get,
    path = "/api/v2/metrics",
    operation_id = "getMetrics",
    tag = "health",
    responses(
        (status = 200, description = "PHI-safe Prometheus metrics", body = String, content_type = "text/plain")
    )
)]
pub async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let _ = state.readiness_snapshot().await;
    hms_observability::set_gauge(
        "hms_rum_enabled",
        if state.rum_enabled() { 1.0 } else { 0.0 },
        &[],
    );

    let started_at = state.started_at().timestamp();
    let pool_size = state.postgres_pool_size();
    let pool_idle = state.postgres_pool_idle();
    let auth_pool_size = state.auth_postgres_pool_size();
    let auth_pool_idle = state.auth_postgres_pool_idle();
    let mut body = format!(
        "# HELP hms_api_up API process availability.\n\
         # TYPE hms_api_up gauge\n\
         hms_api_up 1\n\
         # HELP hms_api_started_at Unix timestamp when the API process started.\n\
         # TYPE hms_api_started_at gauge\n\
         hms_api_started_at {started_at}\n\
         # HELP hms_api_postgres_pool_size Current sqlx Postgres pool size.\n\
         # TYPE hms_api_postgres_pool_size gauge\n\
         hms_api_postgres_pool_size {pool_size}\n\
         # HELP hms_api_postgres_pool_idle Current idle sqlx Postgres connections.\n\
         # TYPE hms_api_postgres_pool_idle gauge\n\
         hms_api_postgres_pool_idle {pool_idle}\n\
         # HELP hms_api_auth_postgres_pool_size Current auth sqlx Postgres pool size.\n\
         # TYPE hms_api_auth_postgres_pool_size gauge\n\
         hms_api_auth_postgres_pool_size {auth_pool_size}\n\
         # HELP hms_api_auth_postgres_pool_idle Current idle auth sqlx Postgres connections.\n\
         # TYPE hms_api_auth_postgres_pool_idle gauge\n\
         hms_api_auth_postgres_pool_idle {auth_pool_idle}\n"
    );
    body.push_str(&hms_observability::prometheus_metrics());

    ([(CONTENT_TYPE, "text/plain; version=0.0.4")], body)
}

fn health_status(
    state: AppState,
    status: &str,
    dependencies: Vec<HealthDependencyStatus>,
) -> HealthStatus {
    HealthStatus {
        service: "hms-api".to_owned(),
        status: status.to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        started_at: state.started_at(),
        dependencies,
    }
}
