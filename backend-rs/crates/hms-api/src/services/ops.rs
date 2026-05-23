use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::error::ApiError;
use crate::response::{object, ObjectResponse};
use crate::state::{AppState, DependencyReadiness, ReadinessSnapshot};

const ROUTE_LIMIT: usize = 20;
const QUERY_LIMIT: usize = 20;

#[derive(Clone)]
pub struct OpsService {
    state: AppState,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsOverviewSnapshot {
    pub runtime: OpsRuntimeSummary,
    pub api: OpsApiHealthSummary,
    pub database: OpsDatabaseSnapshot,
    pub performance: OpsPerformanceSnapshot,
    pub frontend: OpsFrontendSnapshot,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsPerformanceSnapshot {
    pub routes: OpsRouteLatencyGroups,
    pub request_context_cache: OpsRequestContextCacheSummary,
    pub payloads: Vec<OpsPayloadRouteSummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsDatabaseSnapshot {
    pub pools: Vec<OpsPoolSummary>,
    pub pool_waits: Vec<OpsRouteLatencySummary>,
    pub slow_query_fingerprints: Vec<OpsQueryFingerprintSummary>,
    pub slow_queries_by_route: Vec<OpsRouteCounterSummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsFrontendSnapshot {
    pub rum_enabled: bool,
    pub rum: OpsBrowserRumSummary,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRuntimeSummary {
    pub service: String,
    pub version: String,
    pub started_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsApiHealthSummary {
    pub status: String,
    pub ready: bool,
    pub dependencies: Vec<OpsDependencyStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsDependencyStatus {
    pub name: String,
    pub ready: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsPoolSummary {
    pub name: String,
    pub size: u32,
    pub idle: u32,
    pub in_use: u32,
    pub max_connections: u32,
    pub pressure: f64,
    pub pressure_state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRouteLatencyGroups {
    pub chronicle: Vec<OpsRouteLatencySummary>,
    pub dashboards: Vec<OpsRouteLatencySummary>,
    pub ward_board: Vec<OpsRouteLatencySummary>,
    pub request_context_hydration: Vec<OpsRouteLatencySummary>,
    pub db_queries_by_route: Vec<OpsRouteLatencySummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRouteLatencySummary {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
    pub avg_ms: Option<f64>,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub p99_ms: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsPayloadRouteSummary {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
    pub avg_bytes: Option<f64>,
    pub p50_bytes: Option<u64>,
    pub p95_bytes: Option<u64>,
    pub p99_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRouteCounterSummary {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRequestContextCacheSummary {
    pub hits_total: u64,
    pub misses_total: u64,
    pub hit_rate: Option<f64>,
    pub hits_by_route: Vec<OpsRouteCounterSummary>,
    pub misses_by_route: Vec<OpsRouteCounterSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsQueryFingerprintSummary {
    pub fingerprint: String,
    pub count: u64,
    pub total_ms: f64,
    pub avg_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub p99_ms: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsBrowserRumSummary {
    pub all: Vec<OpsRouteLatencySummary>,
    pub api: Vec<OpsRouteLatencySummary>,
    pub navigation: Vec<OpsRouteLatencySummary>,
    pub app_shell: Vec<OpsRouteLatencySummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsSnapshotSource {
    pub kind: String,
    pub generated_at: DateTime<Utc>,
    pub window: String,
    pub notes: Vec<OpsDataNote>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsDataNote {
    pub key: String,
    pub status: String,
    pub note: String,
}

impl OpsService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn overview(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<OpsOverviewSnapshot>, ApiError> {
        self.require_ops_access(ctx)?;
        let readiness = self.state.readiness_snapshot().await;
        let metrics = hms_observability::metrics_snapshot();
        let database = self.database_from_metrics(&metrics);
        let performance = self.performance_from_metrics(&metrics);
        let frontend = self.frontend_from_metrics(&metrics);

        Ok(object(OpsOverviewSnapshot {
            runtime: runtime_summary(&self.state),
            api: api_health_summary(readiness),
            database,
            performance,
            frontend,
            source: snapshot_source(),
        }))
    }

    pub async fn performance(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<OpsPerformanceSnapshot>, ApiError> {
        self.require_ops_access(ctx)?;
        Ok(object(self.performance_from_metrics(
            &hms_observability::metrics_snapshot(),
        )))
    }

    pub async fn database(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<OpsDatabaseSnapshot>, ApiError> {
        self.require_ops_access(ctx)?;
        Ok(object(self.database_from_metrics(
            &hms_observability::metrics_snapshot(),
        )))
    }

    pub async fn frontend(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<OpsFrontendSnapshot>, ApiError> {
        self.require_ops_access(ctx)?;
        Ok(object(self.frontend_from_metrics(
            &hms_observability::metrics_snapshot(),
        )))
    }

    fn require_ops_access(&self, ctx: &hms_access::RequestContext) -> Result<(), ApiError> {
        hms_access::require_ops_dashboard_access(ctx, self.state.facility_id())?;
        Ok(())
    }

    fn performance_from_metrics(
        &self,
        metrics: &hms_observability::MetricsSnapshot,
    ) -> OpsPerformanceSnapshot {
        OpsPerformanceSnapshot {
            routes: OpsRouteLatencyGroups {
                chronicle: route_latencies(&metrics.chronicle_reads),
                dashboards: route_latencies(&metrics.dashboard_reads),
                ward_board: route_latencies(&metrics.ward_board_reads),
                request_context_hydration: route_latencies(&metrics.request_context_hydration),
                db_queries_by_route: route_latencies(&metrics.route_db_queries),
            },
            request_context_cache: request_context_cache(&metrics.request_context_cache),
            payloads: payloads(&metrics.api_payloads),
            source: snapshot_source(),
        }
    }

    fn database_from_metrics(
        &self,
        metrics: &hms_observability::MetricsSnapshot,
    ) -> OpsDatabaseSnapshot {
        OpsDatabaseSnapshot {
            pools: vec![
                pool_summary(
                    "primary",
                    self.state.postgres_pool_size(),
                    self.state.postgres_pool_idle(),
                    self.state.postgres_pool_max_connections(),
                ),
                pool_summary(
                    "auth",
                    self.state.auth_postgres_pool_size(),
                    self.state.auth_postgres_pool_idle(),
                    self.state.auth_postgres_pool_max_connections(),
                ),
            ],
            pool_waits: route_latencies(&metrics.db_pool_waits),
            slow_query_fingerprints: slow_query_fingerprints(&metrics.db_query_fingerprints),
            slow_queries_by_route: route_counters(&metrics.route_slow_queries),
            source: snapshot_source(),
        }
    }

    fn frontend_from_metrics(
        &self,
        metrics: &hms_observability::MetricsSnapshot,
    ) -> OpsFrontendSnapshot {
        OpsFrontendSnapshot {
            rum_enabled: self.state.rum_enabled(),
            rum: OpsBrowserRumSummary {
                all: route_latencies(&metrics.browser_rum.all),
                api: route_latencies(&metrics.browser_rum.api),
                navigation: route_latencies(&metrics.browser_rum.navigation),
                app_shell: route_latencies(&metrics.browser_rum.app_shell),
            },
            source: snapshot_source(),
        }
    }
}

impl AppState {
    pub fn ops_service(&self) -> OpsService {
        OpsService::new(self.clone())
    }
}

fn runtime_summary(state: &AppState) -> OpsRuntimeSummary {
    OpsRuntimeSummary {
        service: "hms-api".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        started_at: state.started_at(),
    }
}

fn api_health_summary(readiness: ReadinessSnapshot) -> OpsApiHealthSummary {
    OpsApiHealthSummary {
        status: if readiness.ready {
            "ready".to_owned()
        } else {
            "not_ready".to_owned()
        },
        ready: readiness.ready,
        dependencies: readiness
            .dependencies
            .into_iter()
            .map(dependency_status)
            .collect(),
    }
}

fn dependency_status(dependency: DependencyReadiness) -> OpsDependencyStatus {
    OpsDependencyStatus {
        name: dependency.name,
        ready: dependency.ready,
    }
}

fn pool_summary(name: &str, size: u32, idle: usize, max_connections: u32) -> OpsPoolSummary {
    let idle = u32::try_from(idle).unwrap_or(u32::MAX).min(size);
    let in_use = size.saturating_sub(idle);
    let max_connections = max_connections.max(1);
    let pressure = in_use as f64 / max_connections as f64;
    OpsPoolSummary {
        name: name.to_owned(),
        size,
        idle,
        in_use,
        max_connections,
        pressure,
        pressure_state: pool_pressure_state(pressure).to_owned(),
    }
}

fn pool_pressure_state(pressure: f64) -> &'static str {
    if pressure >= 0.90 {
        "saturated"
    } else if pressure >= 0.70 {
        "elevated"
    } else {
        "normal"
    }
}

fn route_latencies(
    snapshots: &[hms_observability::RouteDurationSnapshot],
) -> Vec<OpsRouteLatencySummary> {
    snapshots
        .iter()
        .take(ROUTE_LIMIT)
        .map(|route| OpsRouteLatencySummary {
            route_pattern: route.route_pattern.clone(),
            status_bucket: route.status_bucket.clone(),
            facility_safe: route.facility_safe.clone(),
            count: route.count,
            avg_ms: route.avg_ms,
            p50_ms: route.p50_ms,
            p95_ms: route.p95_ms,
            p99_ms: route.p99_ms,
        })
        .collect()
}

fn payloads(snapshots: &[hms_observability::RoutePayloadSnapshot]) -> Vec<OpsPayloadRouteSummary> {
    snapshots
        .iter()
        .take(ROUTE_LIMIT)
        .map(|payload| OpsPayloadRouteSummary {
            route_pattern: payload.route_pattern.clone(),
            status_bucket: payload.status_bucket.clone(),
            facility_safe: payload.facility_safe.clone(),
            count: payload.count,
            avg_bytes: payload.avg_bytes,
            p50_bytes: payload.p50_bytes,
            p95_bytes: payload.p95_bytes,
            p99_bytes: payload.p99_bytes,
        })
        .collect()
}

fn route_counters(
    snapshots: &[hms_observability::RouteCounterSnapshot],
) -> Vec<OpsRouteCounterSummary> {
    snapshots
        .iter()
        .take(ROUTE_LIMIT)
        .map(|counter| OpsRouteCounterSummary {
            route_pattern: counter.route_pattern.clone(),
            status_bucket: counter.status_bucket.clone(),
            facility_safe: counter.facility_safe.clone(),
            count: counter.count,
        })
        .collect()
}

fn request_context_cache(
    snapshot: &hms_observability::RequestContextCacheSnapshot,
) -> OpsRequestContextCacheSummary {
    OpsRequestContextCacheSummary {
        hits_total: snapshot.hits_total,
        misses_total: snapshot.misses_total,
        hit_rate: snapshot.hit_rate,
        hits_by_route: route_counters(&snapshot.hits_by_route),
        misses_by_route: route_counters(&snapshot.misses_by_route),
    }
}

fn slow_query_fingerprints(
    snapshots: &[hms_observability::DbQueryFingerprintSnapshot],
) -> Vec<OpsQueryFingerprintSummary> {
    snapshots
        .iter()
        .filter(|query| {
            query.avg_ms.unwrap_or_default() >= 250.0
                || query.p95_ms.unwrap_or_default() >= 250.0
                || query.p99_ms.unwrap_or_default() >= 250.0
        })
        .take(QUERY_LIMIT)
        .map(|query| OpsQueryFingerprintSummary {
            fingerprint: query.fingerprint.clone(),
            count: query.count,
            total_ms: query.total_ms,
            avg_ms: query.avg_ms,
            p95_ms: query.p95_ms,
            p99_ms: query.p99_ms,
        })
        .collect()
}

fn snapshot_source() -> OpsSnapshotSource {
    OpsSnapshotSource {
        kind: "in_process_metrics".to_owned(),
        generated_at: Utc::now(),
        window: "current_process_lifetime".to_owned(),
        notes: vec![OpsDataNote {
            key: "historical_windows".to_owned(),
            status: "todo".to_owned(),
            note: "TODO: add allowlisted Prometheus-backed summaries for fixed windows after the summary client exists.".to_owned(),
        }],
    }
}
