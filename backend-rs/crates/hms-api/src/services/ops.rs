use std::{collections::BTreeSet, env};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::error::ApiError;
use crate::ops_auth::OpsOperator;
use crate::response::{object, ObjectResponse};
use crate::state::{AppState, DependencyReadiness, ReadinessSnapshot};

#[path = "ops/prometheus.rs"]
pub mod prometheus;
pub use prometheus::{
    OpsPrometheusBrowserRumSummary, OpsPrometheusHistoricalSummary, OpsPrometheusLatencySummary,
    OpsPrometheusPayloadSummary, OpsPrometheusProvider, OpsPrometheusRequestContextSummary,
    OpsPrometheusRouteSummary, OpsPrometheusServiceErrorSummary,
};

const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 50;
const SLOW_QUERY_THRESHOLD_MS: f64 = 250.0;

const SAFE_QUERY_PARAMS: &[&str] = &[
    "window",
    "limit",
    "group",
    "status",
    "type",
    "component",
    "environment",
];

const UNSAFE_QUERY_PARAMS: &[&str] = &[
    "body",
    "email",
    "filter",
    "logql",
    "mrn",
    "name",
    "patient",
    "patient_id",
    "payload",
    "promql",
    "q",
    "query",
    "raw",
    "request_body",
    "route",
    "search",
    "sql",
    "text",
    "url",
    "user",
];

#[derive(Clone)]
pub struct OpsService {
    state: AppState,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct OpsDashboardQuery {
    pub window: Option<String>,
    pub limit: Option<u8>,
    pub group: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "type")]
    pub rum_type: Option<String>,
    pub component: Option<String>,
    pub environment: Option<String>,
}

#[derive(Clone, Debug)]
pub struct OpsQueryParams {
    pub window: OpsWindow,
    pub limit: usize,
    pub group: Option<OpsLatencyGroupFilter>,
    pub status: Option<OpsStatusFilter>,
    pub rum_type: Option<OpsRumTypeFilter>,
    pub component: Option<OpsComponentFilter>,
    pub environment: Option<OpsEnvironmentFilter>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpsWindow {
    FiveMinutes,
    FifteenMinutes,
    OneHour,
    SixHours,
    TwentyFourHours,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpsLatencyGroupFilter {
    Chronicle,
    Dashboards,
    WardBoard,
    RequestContextHydration,
    DbQueriesByRoute,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpsStatusFilter {
    Success,
    Redirect,
    ClientError,
    ServerError,
    Network,
    Timeout,
    Cancelled,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpsRumTypeFilter {
    All,
    Api,
    Navigation,
    AppShell,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpsComponentFilter {
    Api,
    Worker,
    Database,
    Redis,
    Frontend,
    Edge,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpsEnvironmentFilter {
    Staging,
    Production,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsOverviewSnapshot {
    pub runtime: OpsRuntimeSummary,
    pub api: OpsApiHealthSummary,
    pub db_pool: OpsDbPoolSnapshot,
    pub route_latency: OpsRouteLatencySnapshot,
    pub request_context_cache: OpsRequestContextCacheSnapshot,
    pub rum: OpsRumSnapshot,
    pub unavailable: Vec<OpsUnavailableSource>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRouteLatencySnapshot {
    pub groups: OpsRouteLatencyGroups,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsClinicalBudgetSnapshot {
    pub budgets: Vec<OpsClinicalBudgetSummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsDbPoolSnapshot {
    pub pools: Vec<OpsPoolSummary>,
    pub pool_waits: Vec<OpsRouteLatencySummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRequestContextCacheSnapshot {
    pub cache: OpsRequestContextCacheSummary,
    pub hydration: Vec<OpsRouteLatencySummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsPayloadSnapshot {
    pub routes: Vec<OpsPayloadRouteSummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRumSnapshot {
    pub rum_enabled: bool,
    pub rum: OpsBrowserRumSummary,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsSlowQueryFingerprintSnapshot {
    pub fingerprints: Vec<OpsQueryFingerprintSummary>,
    pub pg_stat_statements: OpsPgStatStatementsSnapshot,
    pub slow_queries_by_route: Vec<OpsRouteCounterSummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsServiceErrorsSnapshot {
    pub errors: Vec<OpsServiceErrorSummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsDeploysSnapshot {
    pub deploys: Vec<OpsDeploySummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsEdgeStatusSnapshot {
    pub checks: Vec<OpsEdgeStatusSummary>,
    pub source: OpsSnapshotSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsRuntimeSummary {
    pub service: String,
    pub version: String,
    pub build_sha: Option<String>,
    pub image_tag: Option<String>,
    pub started_at: DateTime<Utc>,
    pub deployed_at: Option<DateTime<Utc>>,
    pub cloudflare_access: OpsConfigurationStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsConfigurationStatus {
    pub status: String,
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

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
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
pub struct OpsClinicalBudgetSummary {
    pub key: String,
    pub label: String,
    pub budget_ms: f64,
    pub observed_p99_ms: Option<f64>,
    pub count: u64,
    pub status: String,
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
pub struct OpsPgStatStatementsSnapshot {
    pub availability: String,
    pub statements: Vec<OpsPgStatStatementAggregateSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsPgStatStatementAggregateSummary {
    pub fingerprint_id: String,
    pub calls: i64,
    pub total_exec_ms: f64,
    pub mean_exec_ms: f64,
    pub rows: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct OpsBrowserRumSummary {
    pub all: Vec<OpsRouteLatencySummary>,
    pub api: Vec<OpsRouteLatencySummary>,
    pub navigation: Vec<OpsRouteLatencySummary>,
    pub app_shell: Vec<OpsRouteLatencySummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsServiceErrorSummary {
    pub component: String,
    pub error_class: String,
    pub count: u64,
    pub last_seen_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsDeploySummary {
    pub service: String,
    pub build_sha: Option<String>,
    pub image_tag: Option<String>,
    pub environment: String,
    pub version: String,
    pub started_at: DateTime<Utc>,
    pub deployed_at: Option<DateTime<Utc>>,
    pub cloudflare_access: OpsConfigurationStatus,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsEdgeStatusSummary {
    pub component: String,
    pub status: String,
    pub checked_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsUnavailableSource {
    pub key: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsSnapshotSource {
    pub kind: String,
    pub available: bool,
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

    pub fn parse_query(raw_query: Option<&str>) -> Result<OpsQueryParams, ApiError> {
        parse_ops_query(raw_query)
    }

    pub fn prometheus_provider(&self) -> OpsPrometheusProvider {
        OpsPrometheusProvider::new(self.state.ops_prometheus_config().clone())
    }

    pub async fn overview(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsOverviewSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let readiness = self.state.readiness_snapshot().await;
        let metrics = hms_observability::metrics_snapshot();
        let historical = self
            .prometheus_provider()
            .summary_for_window(query.window.as_str())
            .await;
        let db_pool = self.db_pool_snapshot(&metrics, &historical, &query);
        let route_latency = route_latency_snapshot(&metrics, &historical, &query);
        let request_context_cache = request_context_cache_snapshot(&metrics, &historical, &query);
        let rum = self.rum_snapshot(&metrics, &historical, &query);

        Ok(object(OpsOverviewSnapshot {
            runtime: runtime_summary(&self.state),
            api: api_health_summary(readiness),
            db_pool,
            route_latency,
            request_context_cache,
            rum,
            unavailable: unavailable_ops_sources(),
            source: historical_or_fallback_source(&query, &historical),
        }))
    }

    pub async fn route_latency(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsRouteLatencySnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let metrics = hms_observability::metrics_snapshot();
        let historical = self
            .prometheus_provider()
            .summary_for_window(query.window.as_str())
            .await;
        Ok(object(route_latency_snapshot(
            &metrics,
            &historical,
            &query,
        )))
    }

    pub async fn clinical_budgets(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsClinicalBudgetSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let metrics = hms_observability::metrics_snapshot();
        let historical = self
            .prometheus_provider()
            .summary_for_window(query.window.as_str())
            .await;
        Ok(object(OpsClinicalBudgetSnapshot {
            budgets: clinical_budgets_snapshot(&metrics, &historical, &query),
            source: historical_or_fallback_source(&query, &historical),
        }))
    }

    pub async fn db_pool(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsDbPoolSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let metrics = hms_observability::metrics_snapshot();
        let historical = self
            .prometheus_provider()
            .summary_for_window(query.window.as_str())
            .await;
        Ok(object(self.db_pool_snapshot(&metrics, &historical, &query)))
    }

    pub async fn request_context_cache(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsRequestContextCacheSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let metrics = hms_observability::metrics_snapshot();
        let historical = self
            .prometheus_provider()
            .summary_for_window(query.window.as_str())
            .await;
        Ok(object(request_context_cache_snapshot(
            &metrics,
            &historical,
            &query,
        )))
    }

    pub async fn payload(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsPayloadSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let metrics = hms_observability::metrics_snapshot();
        let historical = self
            .prometheus_provider()
            .summary_for_window(query.window.as_str())
            .await;
        Ok(object(OpsPayloadSnapshot {
            routes: payload_snapshot(&metrics, &historical, &query),
            source: historical_or_fallback_source(&query, &historical),
        }))
    }

    pub async fn rum(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsRumSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let metrics = hms_observability::metrics_snapshot();
        let historical = self
            .prometheus_provider()
            .summary_for_window(query.window.as_str())
            .await;
        Ok(object(self.rum_snapshot(&metrics, &historical, &query)))
    }

    pub async fn slow_query_fingerprints(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsSlowQueryFingerprintSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let metrics = hms_observability::metrics_snapshot();
        let pg_stat_statements =
            hms_db::ops::pg_stat_statement_aggregates(self.state.db_pool()).await;
        Ok(object(OpsSlowQueryFingerprintSnapshot {
            fingerprints: slow_query_fingerprints(&metrics.db_query_fingerprints, &query),
            pg_stat_statements: pg_stat_statements_snapshot(pg_stat_statements, query.limit),
            slow_queries_by_route: route_counters(&metrics.route_slow_queries, &query),
            source: snapshot_source(&query, true, vec![prometheus_fallback_note()]),
        }))
    }

    pub async fn service_errors(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsServiceErrorsSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        let historical = self
            .prometheus_provider()
            .summary_for_window(query.window.as_str())
            .await;
        if historical.available {
            return Ok(object(OpsServiceErrorsSnapshot {
                errors: service_errors_from_prometheus(&historical, &query),
                source: historical_source(&historical),
            }));
        }

        Ok(object(OpsServiceErrorsSnapshot {
            errors: Vec::new(),
            source: unavailable_source(
                &query,
                "service_errors",
                "No service error adapter is registered yet.",
            ),
        }))
    }

    pub async fn deploys(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsDeploysSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        Ok(object(OpsDeploysSnapshot {
            deploys: vec![current_deploy_summary(&self.state)],
            source: snapshot_source(&query, true, vec![runtime_config_note()]),
        }))
    }

    pub async fn edge_status(
        &self,
        operator: &OpsOperator,
        query: OpsQueryParams,
    ) -> Result<ObjectResponse<OpsEdgeStatusSnapshot>, ApiError> {
        self.require_ops_access(operator)?;
        Ok(object(OpsEdgeStatusSnapshot {
            checks: vec![OpsEdgeStatusSummary {
                component: "cloudflare_access".to_owned(),
                status: cloudflare_access_status(&self.state).status,
                checked_at: Some(Utc::now()),
            }],
            source: snapshot_source(&query, true, vec![runtime_config_note()]),
        }))
    }

    fn require_ops_access(&self, operator: &OpsOperator) -> Result<(), ApiError> {
        match operator {
            OpsOperator::Hms(ctx) => {
                hms_access::require_ops_dashboard_access(ctx, self.state.facility_id())?;
                Ok(())
            }
            OpsOperator::CloudflareAccess(_) => Ok(()),
        }
    }

    fn db_pool_snapshot(
        &self,
        metrics: &hms_observability::MetricsSnapshot,
        historical: &OpsPrometheusHistoricalSummary,
        query: &OpsQueryParams,
    ) -> OpsDbPoolSnapshot {
        OpsDbPoolSnapshot {
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
            pool_waits: if historical.available {
                prometheus_latencies(&historical.db_pool_waits, query)
            } else {
                route_latencies(&metrics.db_pool_waits, query)
            },
            source: historical_or_fallback_source(query, historical),
        }
    }

    fn rum_snapshot(
        &self,
        metrics: &hms_observability::MetricsSnapshot,
        historical: &OpsPrometheusHistoricalSummary,
        query: &OpsQueryParams,
    ) -> OpsRumSnapshot {
        OpsRumSnapshot {
            rum_enabled: self.state.rum_enabled(),
            rum: rum_summary(metrics, historical, query),
            source: historical_or_fallback_source(query, historical),
        }
    }
}

impl AppState {
    pub fn ops_service(&self) -> OpsService {
        OpsService::new(self.clone())
    }
}

fn route_latency_snapshot(
    metrics: &hms_observability::MetricsSnapshot,
    historical: &OpsPrometheusHistoricalSummary,
    query: &OpsQueryParams,
) -> OpsRouteLatencySnapshot {
    let mut groups = OpsRouteLatencyGroups::default();

    if historical.available {
        let clinical = prometheus_clinical_groups(&historical.clinical_budgets, query);
        if include_latency_group(query, OpsLatencyGroupFilter::Chronicle) {
            groups.chronicle = clinical.chronicle;
        }
        if include_latency_group(query, OpsLatencyGroupFilter::Dashboards) {
            groups.dashboards = clinical.dashboards;
        }
        if include_latency_group(query, OpsLatencyGroupFilter::WardBoard) {
            groups.ward_board = clinical.ward_board;
        }
        if include_latency_group(query, OpsLatencyGroupFilter::RequestContextHydration) {
            groups.request_context_hydration =
                prometheus_latencies(&historical.request_context.hydration, query);
        }
        if include_latency_group(query, OpsLatencyGroupFilter::DbQueriesByRoute) {
            groups.db_queries_by_route = prometheus_routes(&historical.routes, query);
        }

        return OpsRouteLatencySnapshot {
            groups,
            source: historical_source(historical),
        };
    }

    if include_latency_group(query, OpsLatencyGroupFilter::Chronicle) {
        groups.chronicle = route_latencies(&metrics.chronicle_reads, query);
    }
    if include_latency_group(query, OpsLatencyGroupFilter::Dashboards) {
        groups.dashboards = route_latencies(&metrics.dashboard_reads, query);
    }
    if include_latency_group(query, OpsLatencyGroupFilter::WardBoard) {
        groups.ward_board = route_latencies(&metrics.ward_board_reads, query);
    }
    if include_latency_group(query, OpsLatencyGroupFilter::RequestContextHydration) {
        groups.request_context_hydration =
            route_latencies(&metrics.request_context_hydration, query);
    }
    if include_latency_group(query, OpsLatencyGroupFilter::DbQueriesByRoute) {
        groups.db_queries_by_route = route_latencies(&metrics.route_db_queries, query);
    }

    OpsRouteLatencySnapshot {
        groups,
        source: historical_or_fallback_source(query, historical),
    }
}

fn request_context_cache_snapshot(
    metrics: &hms_observability::MetricsSnapshot,
    historical: &OpsPrometheusHistoricalSummary,
    query: &OpsQueryParams,
) -> OpsRequestContextCacheSnapshot {
    if historical.available {
        return OpsRequestContextCacheSnapshot {
            cache: OpsRequestContextCacheSummary {
                hits_total: historical.request_context.hits_total,
                misses_total: historical.request_context.misses_total,
                hit_rate: historical.request_context.hit_rate,
                hits_by_route: Vec::new(),
                misses_by_route: Vec::new(),
            },
            hydration: prometheus_latencies(&historical.request_context.hydration, query),
            source: historical_source(historical),
        };
    }

    OpsRequestContextCacheSnapshot {
        cache: request_context_cache(&metrics.request_context_cache, query),
        hydration: route_latencies(&metrics.request_context_hydration, query),
        source: historical_or_fallback_source(query, historical),
    }
}

fn rum_summary(
    metrics: &hms_observability::MetricsSnapshot,
    historical: &OpsPrometheusHistoricalSummary,
    query: &OpsQueryParams,
) -> OpsBrowserRumSummary {
    let mut rum = OpsBrowserRumSummary::default();

    if historical.available {
        if include_rum_type(query, OpsRumTypeFilter::All) {
            rum.all = prometheus_latencies(&historical.browser_rum.all, query);
        }
        if include_rum_type(query, OpsRumTypeFilter::Api) {
            rum.api = prometheus_latencies(&historical.browser_rum.api, query);
        }
        if include_rum_type(query, OpsRumTypeFilter::Navigation) {
            rum.navigation = prometheus_latencies(&historical.browser_rum.navigation, query);
        }
        if include_rum_type(query, OpsRumTypeFilter::AppShell) {
            rum.app_shell = prometheus_latencies(&historical.browser_rum.app_shell, query);
        }
        return rum;
    }

    if include_rum_type(query, OpsRumTypeFilter::All) {
        rum.all = route_latencies(&metrics.browser_rum.all, query);
    }
    if include_rum_type(query, OpsRumTypeFilter::Api) {
        rum.api = route_latencies(&metrics.browser_rum.api, query);
    }
    if include_rum_type(query, OpsRumTypeFilter::Navigation) {
        rum.navigation = route_latencies(&metrics.browser_rum.navigation, query);
    }
    if include_rum_type(query, OpsRumTypeFilter::AppShell) {
        rum.app_shell = route_latencies(&metrics.browser_rum.app_shell, query);
    }

    rum
}

fn parse_ops_query(raw_query: Option<&str>) -> Result<OpsQueryParams, ApiError> {
    let mut window = OpsWindow::FifteenMinutes;
    let mut limit = DEFAULT_LIMIT;
    let mut group = None;
    let mut status = None;
    let mut rum_type = None;
    let mut component = None;
    let mut environment = None;
    let mut seen = BTreeSet::new();

    for (key, value) in raw_query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(split_query_pair)
    {
        validate_query_key(key)?;
        if !seen.insert(key.to_owned()) {
            return Err(ApiError::bad_request(
                "ops_duplicate_query_param",
                "Duplicate ops query parameters are not allowed.",
            ));
        }

        match key {
            "window" => window = OpsWindow::parse(value)?,
            "limit" => limit = parse_limit(value)?,
            "group" => group = Some(OpsLatencyGroupFilter::parse(value)?),
            "status" => status = Some(OpsStatusFilter::parse(value)?),
            "type" => rum_type = Some(OpsRumTypeFilter::parse(value)?),
            "component" => component = Some(OpsComponentFilter::parse(value)?),
            "environment" => environment = Some(OpsEnvironmentFilter::parse(value)?),
            _ => unreachable!("query key was allowlisted before dispatch"),
        }
    }

    Ok(OpsQueryParams {
        window,
        limit,
        group,
        status,
        rum_type,
        component,
        environment,
    })
}

fn split_query_pair(pair: &str) -> (&str, &str) {
    pair.split_once('=').unwrap_or((pair, ""))
}

fn validate_query_key(key: &str) -> Result<(), ApiError> {
    let normalized = key.trim().to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.contains('%')
        || normalized.contains('+')
        || UNSAFE_QUERY_PARAMS.contains(&normalized.as_str())
        || normalized.contains("patient")
        || normalized.contains("mrn")
        || normalized.contains("body")
        || normalized.contains("sql")
        || normalized.contains("prom")
        || normalized.contains("log")
        || normalized.contains("url")
        || normalized.contains("raw")
    {
        return Err(ApiError::bad_request(
            "ops_forbidden_query_param",
            "This ops query parameter is not allowed.",
        ));
    }
    if !SAFE_QUERY_PARAMS.contains(&normalized.as_str()) {
        return Err(ApiError::bad_request(
            "ops_query_param_not_allowed",
            "Ops endpoints only accept documented safe enum query parameters.",
        ));
    }
    Ok(())
}

fn parse_limit(value: &str) -> Result<usize, ApiError> {
    let limit = value.parse::<usize>().map_err(|_| {
        ApiError::bad_request("ops_limit_invalid", "Ops limit must be between 1 and 50.")
    })?;
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::bad_request(
            "ops_limit_invalid",
            "Ops limit must be between 1 and 50.",
        ));
    }
    Ok(limit)
}

impl OpsWindow {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "5m" => Ok(Self::FiveMinutes),
            "15m" => Ok(Self::FifteenMinutes),
            "1h" => Ok(Self::OneHour),
            "6h" => Ok(Self::SixHours),
            "24h" => Ok(Self::TwentyFourHours),
            _ => Err(ApiError::bad_request(
                "ops_window_invalid",
                "Ops window must be one of 5m, 15m, 1h, 6h, or 24h.",
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::FiveMinutes => "5m",
            Self::FifteenMinutes => "15m",
            Self::OneHour => "1h",
            Self::SixHours => "6h",
            Self::TwentyFourHours => "24h",
        }
    }
}

impl OpsLatencyGroupFilter {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "chronicle" => Ok(Self::Chronicle),
            "dashboards" => Ok(Self::Dashboards),
            "ward_board" => Ok(Self::WardBoard),
            "request_context_hydration" => Ok(Self::RequestContextHydration),
            "db_queries_by_route" => Ok(Self::DbQueriesByRoute),
            _ => Err(ApiError::bad_request(
                "ops_group_invalid",
                "Ops group filter is invalid.",
            )),
        }
    }
}

impl OpsStatusFilter {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "2xx" => Ok(Self::Success),
            "3xx" => Ok(Self::Redirect),
            "4xx" => Ok(Self::ClientError),
            "5xx" => Ok(Self::ServerError),
            "network" => Ok(Self::Network),
            "timeout" => Ok(Self::Timeout),
            "cancelled" => Ok(Self::Cancelled),
            "unknown" => Ok(Self::Unknown),
            _ => Err(ApiError::bad_request(
                "ops_status_invalid",
                "Ops status filter is invalid.",
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Success => "2xx",
            Self::Redirect => "3xx",
            Self::ClientError => "4xx",
            Self::ServerError => "5xx",
            Self::Network => "network",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::Unknown => "unknown",
        }
    }
}

impl OpsRumTypeFilter {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "all" => Ok(Self::All),
            "api" => Ok(Self::Api),
            "navigation" => Ok(Self::Navigation),
            "app_shell" => Ok(Self::AppShell),
            _ => Err(ApiError::bad_request(
                "ops_type_invalid",
                "Ops RUM type filter is invalid.",
            )),
        }
    }
}

impl OpsComponentFilter {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "api" => Ok(Self::Api),
            "worker" => Ok(Self::Worker),
            "database" => Ok(Self::Database),
            "redis" => Ok(Self::Redis),
            "frontend" => Ok(Self::Frontend),
            "edge" => Ok(Self::Edge),
            _ => Err(ApiError::bad_request(
                "ops_component_invalid",
                "Ops component filter is invalid.",
            )),
        }
    }
}

impl OpsEnvironmentFilter {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "staging" => Ok(Self::Staging),
            "production" => Ok(Self::Production),
            _ => Err(ApiError::bad_request(
                "ops_environment_invalid",
                "Ops environment filter is invalid.",
            )),
        }
    }
}

fn runtime_summary(state: &AppState) -> OpsRuntimeSummary {
    OpsRuntimeSummary {
        service: "hms-api".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        build_sha: build_sha(),
        image_tag: image_tag(),
        started_at: state.started_at(),
        deployed_at: deployed_at(),
        cloudflare_access: cloudflare_access_status(state),
    }
}

fn current_deploy_summary(state: &AppState) -> OpsDeploySummary {
    OpsDeploySummary {
        service: "hms-api".to_owned(),
        build_sha: build_sha(),
        image_tag: image_tag(),
        environment: safe_env_value("HMS_ENV").unwrap_or_else(|| "unknown".to_owned()),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        started_at: state.started_at(),
        deployed_at: deployed_at(),
        cloudflare_access: cloudflare_access_status(state),
        status: "running".to_owned(),
    }
}

fn build_sha() -> Option<String> {
    safe_env_value("HMS_BUILD_SHA")
        .or_else(|| safe_env_value("SOURCE_VERSION"))
        .or_else(|| safe_env_value("GIT_COMMIT"))
}

fn image_tag() -> Option<String> {
    safe_env_value("HMS_IMAGE_TAG")
        .or_else(|| safe_env_value("VERSION"))
        .filter(|value| value != "latest")
}

fn deployed_at() -> Option<DateTime<Utc>> {
    safe_env_value("HMS_DEPLOYED_AT")
        .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
        .map(|value| value.with_timezone(&Utc))
}

fn cloudflare_access_status(state: &AppState) -> OpsConfigurationStatus {
    OpsConfigurationStatus {
        status: if state.ops_auth_mode().allows_cloudflare_access() {
            "configured".to_owned()
        } else {
            "unconfigured".to_owned()
        },
    }
}

fn safe_env_value(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
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
    query: &OpsQueryParams,
) -> Vec<OpsRouteLatencySummary> {
    snapshots
        .iter()
        .filter(|route| status_matches(&route.status_bucket, query.status))
        .take(query.limit)
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

fn payloads(
    snapshots: &[hms_observability::RoutePayloadSnapshot],
    query: &OpsQueryParams,
) -> Vec<OpsPayloadRouteSummary> {
    snapshots
        .iter()
        .filter(|payload| status_matches(&payload.status_bucket, query.status))
        .take(query.limit)
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

fn payload_snapshot(
    metrics: &hms_observability::MetricsSnapshot,
    historical: &OpsPrometheusHistoricalSummary,
    query: &OpsQueryParams,
) -> Vec<OpsPayloadRouteSummary> {
    if historical.available {
        return historical
            .payloads
            .iter()
            .filter(|payload| status_matches(&payload.status_bucket, query.status))
            .take(query.limit)
            .map(|payload| OpsPayloadRouteSummary {
                route_pattern: payload.route_pattern.clone(),
                status_bucket: payload.status_bucket.clone(),
                facility_safe: payload.facility_safe.clone(),
                count: payload.count,
                avg_bytes: None,
                p50_bytes: None,
                p95_bytes: payload.p95_bytes,
                p99_bytes: payload.p99_bytes,
            })
            .collect();
    }

    payloads(&metrics.api_payloads, query)
}

fn prometheus_routes(
    snapshots: &[OpsPrometheusRouteSummary],
    query: &OpsQueryParams,
) -> Vec<OpsRouteLatencySummary> {
    snapshots
        .iter()
        .filter(|route| status_matches(&route.status_bucket, query.status))
        .take(query.limit)
        .map(|route| OpsRouteLatencySummary {
            route_pattern: route.route_pattern.clone(),
            status_bucket: route.status_bucket.clone(),
            facility_safe: route.facility_safe.clone(),
            count: route.request_count,
            avg_ms: None,
            p50_ms: route.p50_ms,
            p95_ms: route.p95_ms,
            p99_ms: route.p99_ms,
        })
        .collect()
}

fn prometheus_latencies(
    snapshots: &[OpsPrometheusLatencySummary],
    query: &OpsQueryParams,
) -> Vec<OpsRouteLatencySummary> {
    snapshots
        .iter()
        .filter(|route| status_matches(&route.status_bucket, query.status))
        .take(query.limit)
        .map(|route| OpsRouteLatencySummary {
            route_pattern: route.route_pattern.clone(),
            status_bucket: route.status_bucket.clone(),
            facility_safe: route.facility_safe.clone(),
            count: route.count,
            avg_ms: None,
            p50_ms: route.p50_ms,
            p95_ms: route.p95_ms,
            p99_ms: route.p99_ms,
        })
        .collect()
}

fn prometheus_clinical_groups(
    snapshots: &[OpsPrometheusLatencySummary],
    query: &OpsQueryParams,
) -> OpsRouteLatencyGroups {
    let mut groups = OpsRouteLatencyGroups::default();
    groups.chronicle = prometheus_latencies_by_group(snapshots, "chronicle", query);
    groups.dashboards = prometheus_latencies_by_group(snapshots, "dashboards", query);
    groups.ward_board = prometheus_latencies_by_group(snapshots, "ward_board", query);
    groups
}

fn prometheus_latencies_by_group(
    snapshots: &[OpsPrometheusLatencySummary],
    group: &str,
    query: &OpsQueryParams,
) -> Vec<OpsRouteLatencySummary> {
    snapshots
        .iter()
        .filter(|snapshot| snapshot.group == group)
        .filter(|snapshot| status_matches(&snapshot.status_bucket, query.status))
        .take(query.limit)
        .map(|snapshot| OpsRouteLatencySummary {
            route_pattern: snapshot.route_pattern.clone(),
            status_bucket: snapshot.status_bucket.clone(),
            facility_safe: snapshot.facility_safe.clone(),
            count: snapshot.count,
            avg_ms: None,
            p50_ms: snapshot.p50_ms,
            p95_ms: snapshot.p95_ms,
            p99_ms: snapshot.p99_ms,
        })
        .collect()
}

fn route_counters(
    snapshots: &[hms_observability::RouteCounterSnapshot],
    query: &OpsQueryParams,
) -> Vec<OpsRouteCounterSummary> {
    snapshots
        .iter()
        .filter(|counter| status_matches(&counter.status_bucket, query.status))
        .take(query.limit)
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
    query: &OpsQueryParams,
) -> OpsRequestContextCacheSummary {
    OpsRequestContextCacheSummary {
        hits_total: snapshot.hits_total,
        misses_total: snapshot.misses_total,
        hit_rate: snapshot.hit_rate,
        hits_by_route: route_counters(&snapshot.hits_by_route, query),
        misses_by_route: route_counters(&snapshot.misses_by_route, query),
    }
}

fn slow_query_fingerprints(
    snapshots: &[hms_observability::DbQueryFingerprintSnapshot],
    query: &OpsQueryParams,
) -> Vec<OpsQueryFingerprintSummary> {
    snapshots
        .iter()
        .filter(|query| {
            query.avg_ms.unwrap_or_default() >= SLOW_QUERY_THRESHOLD_MS
                || query.p95_ms.unwrap_or_default() >= SLOW_QUERY_THRESHOLD_MS
                || query.p99_ms.unwrap_or_default() >= SLOW_QUERY_THRESHOLD_MS
        })
        .take(query.limit)
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

fn pg_stat_statements_snapshot(
    snapshot: hms_db::ops::PgStatStatementsSnapshot,
    limit: usize,
) -> OpsPgStatStatementsSnapshot {
    OpsPgStatStatementsSnapshot {
        availability: snapshot.availability.as_str().to_owned(),
        statements: snapshot
            .statements
            .into_iter()
            .take(limit)
            .map(|statement| OpsPgStatStatementAggregateSummary {
                fingerprint_id: statement.fingerprint_id,
                calls: statement.calls,
                total_exec_ms: statement.total_exec_ms,
                mean_exec_ms: statement.mean_exec_ms,
                rows: statement.rows,
            })
            .collect(),
    }
}

fn service_errors_from_prometheus(
    historical: &OpsPrometheusHistoricalSummary,
    query: &OpsQueryParams,
) -> Vec<OpsServiceErrorSummary> {
    historical
        .service_errors
        .iter()
        .filter(|error| status_matches(&error.status_bucket, query.status))
        .take(query.limit)
        .map(|error| OpsServiceErrorSummary {
            component: error.route_pattern.clone(),
            error_class: error.status_bucket.clone(),
            count: error.count,
            last_seen_at: None,
        })
        .collect()
}

fn clinical_budgets_snapshot(
    metrics: &hms_observability::MetricsSnapshot,
    historical: &OpsPrometheusHistoricalSummary,
    query: &OpsQueryParams,
) -> Vec<OpsClinicalBudgetSummary> {
    if !historical.available {
        return clinical_budgets(metrics, query);
    }

    [
        ("chronicle", "Patient Chronicle", 200.0),
        ("dashboards", "Operational dashboards", 200.0),
        ("ward_board", "Ward board", 200.0),
    ]
    .into_iter()
    .filter(|(key, _, _)| match query.group {
        Some(OpsLatencyGroupFilter::Chronicle) => *key == "chronicle",
        Some(OpsLatencyGroupFilter::Dashboards) => *key == "dashboards",
        Some(OpsLatencyGroupFilter::WardBoard) => *key == "ward_board",
        Some(OpsLatencyGroupFilter::RequestContextHydration)
        | Some(OpsLatencyGroupFilter::DbQueriesByRoute) => false,
        None => true,
    })
    .map(|(key, label, budget_ms)| {
        prometheus_clinical_budget(key, label, budget_ms, &historical.clinical_budgets, query)
    })
    .collect()
}

fn prometheus_clinical_budget(
    key: &str,
    label: &str,
    budget_ms: f64,
    snapshots: &[OpsPrometheusLatencySummary],
    query: &OpsQueryParams,
) -> OpsClinicalBudgetSummary {
    let mut count = 0;
    let mut p99 = None;
    for snapshot in snapshots
        .iter()
        .filter(|snapshot| snapshot.group == key)
        .filter(|snapshot| status_matches(&snapshot.status_bucket, query.status))
    {
        count += snapshot.count;
        if let Some(route_p99) = snapshot.p99_ms {
            p99 = Some(p99.map_or(route_p99, |current: f64| current.max(route_p99)));
        }
    }

    let status = match p99 {
        Some(value) if value > budget_ms => "over_budget",
        Some(_) => "within_budget",
        None => "no_data",
    };

    OpsClinicalBudgetSummary {
        key: key.to_owned(),
        label: label.to_owned(),
        budget_ms,
        observed_p99_ms: p99,
        count,
        status: status.to_owned(),
    }
}

fn clinical_budgets(
    metrics: &hms_observability::MetricsSnapshot,
    query: &OpsQueryParams,
) -> Vec<OpsClinicalBudgetSummary> {
    let budgets = [
        (
            "chronicle",
            "Patient Chronicle",
            200.0,
            metrics.chronicle_reads.as_slice(),
        ),
        (
            "dashboards",
            "Operational dashboards",
            200.0,
            metrics.dashboard_reads.as_slice(),
        ),
        (
            "ward_board",
            "Ward board",
            200.0,
            metrics.ward_board_reads.as_slice(),
        ),
        (
            "request_context_hydration",
            "Request context hydration",
            50.0,
            metrics.request_context_hydration.as_slice(),
        ),
    ];

    budgets
        .into_iter()
        .filter(|(key, _, _, _)| match query.group {
            Some(OpsLatencyGroupFilter::Chronicle) => *key == "chronicle",
            Some(OpsLatencyGroupFilter::Dashboards) => *key == "dashboards",
            Some(OpsLatencyGroupFilter::WardBoard) => *key == "ward_board",
            Some(OpsLatencyGroupFilter::RequestContextHydration) => {
                *key == "request_context_hydration"
            }
            Some(OpsLatencyGroupFilter::DbQueriesByRoute) => false,
            None => true,
        })
        .map(|(key, label, budget_ms, snapshots)| {
            clinical_budget(key, label, budget_ms, snapshots, query)
        })
        .collect()
}

fn clinical_budget(
    key: &str,
    label: &str,
    budget_ms: f64,
    snapshots: &[hms_observability::RouteDurationSnapshot],
    query: &OpsQueryParams,
) -> OpsClinicalBudgetSummary {
    let mut count = 0;
    let mut p99 = None;
    for snapshot in snapshots
        .iter()
        .filter(|snapshot| status_matches(&snapshot.status_bucket, query.status))
    {
        count += snapshot.count;
        if let Some(route_p99) = snapshot.p99_ms {
            p99 = Some(p99.map_or(route_p99, |current: f64| current.max(route_p99)));
        }
    }

    let status = match p99 {
        Some(value) if value > budget_ms => "over_budget",
        Some(_) => "within_budget",
        None => "no_data",
    };

    OpsClinicalBudgetSummary {
        key: key.to_owned(),
        label: label.to_owned(),
        budget_ms,
        observed_p99_ms: p99,
        count,
        status: status.to_owned(),
    }
}

fn status_matches(status_bucket: &str, filter: Option<OpsStatusFilter>) -> bool {
    filter
        .map(|filter| status_bucket == filter.as_str())
        .unwrap_or(true)
}

fn include_latency_group(query: &OpsQueryParams, group: OpsLatencyGroupFilter) -> bool {
    query
        .group
        .map(|selected| selected == group)
        .unwrap_or(true)
}

fn include_rum_type(query: &OpsQueryParams, rum_type: OpsRumTypeFilter) -> bool {
    query
        .rum_type
        .map(|selected| selected == rum_type)
        .unwrap_or(true)
}

fn snapshot_source(
    query: &OpsQueryParams,
    available: bool,
    notes: Vec<OpsDataNote>,
) -> OpsSnapshotSource {
    OpsSnapshotSource {
        kind: if available {
            "in_process_metrics".to_owned()
        } else {
            "unavailable".to_owned()
        },
        available,
        generated_at: Utc::now(),
        window: query.window.as_str().to_owned(),
        notes,
    }
}

fn historical_source(historical: &OpsPrometheusHistoricalSummary) -> OpsSnapshotSource {
    OpsSnapshotSource {
        kind: "prometheus".to_owned(),
        available: true,
        generated_at: historical.generated_at,
        window: historical.window.clone(),
        notes: historical.notes.clone(),
    }
}

fn historical_or_fallback_source(
    query: &OpsQueryParams,
    historical: &OpsPrometheusHistoricalSummary,
) -> OpsSnapshotSource {
    if historical.available {
        return historical_source(historical);
    }

    let mut notes = historical.notes.clone();
    if notes.is_empty() {
        notes.push(prometheus_fallback_note());
    }
    snapshot_source(query, true, notes)
}

fn unavailable_source(query: &OpsQueryParams, key: &str, note: &str) -> OpsSnapshotSource {
    snapshot_source(
        query,
        false,
        vec![OpsDataNote {
            key: key.to_owned(),
            status: "unavailable".to_owned(),
            note: note.to_owned(),
        }],
    )
}

fn prometheus_fallback_note() -> OpsDataNote {
    OpsDataNote {
        key: "prometheus_adapter".to_owned(),
        status: "unavailable".to_owned(),
        note: "Using in-process metrics fallback because a Prometheus summary adapter is not registered.".to_owned(),
    }
}

fn runtime_config_note() -> OpsDataNote {
    OpsDataNote {
        key: "runtime_config".to_owned(),
        status: "available".to_owned(),
        note: "Using safe runtime configuration and process metadata only.".to_owned(),
    }
}

fn unavailable_ops_sources() -> Vec<OpsUnavailableSource> {
    vec![
        OpsUnavailableSource {
            key: "service_errors".to_owned(),
            reason: "No service error adapter is registered yet.".to_owned(),
        },
        OpsUnavailableSource {
            key: "deploys".to_owned(),
            reason: "No deploy history adapter is registered yet.".to_owned(),
        },
        OpsUnavailableSource {
            key: "edge_status".to_owned(),
            reason: "No edge status adapter is registered yet.".to_owned(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_parser_rejects_unsafe_free_form_params() {
        let error = parse_ops_query(Some("window=15m&promql=up")).expect_err("promql rejected");
        assert_eq!(error.code, "ops_forbidden_query_param");

        let error = parse_ops_query(Some("patient_id=00000000-0000-0000-0000-000000000000"))
            .expect_err("patient_id rejected");
        assert_eq!(error.code, "ops_forbidden_query_param");

        let error =
            parse_ops_query(Some("route=/api/v2/patients/123")).expect_err("route rejected");
        assert_eq!(error.code, "ops_forbidden_query_param");
    }

    #[test]
    fn query_parser_accepts_only_bounded_safe_enums() {
        let query = parse_ops_query(Some(
            "window=5m&limit=50&group=chronicle&status=2xx&type=api",
        ))
        .expect("safe query parses");
        assert_eq!(query.window, OpsWindow::FiveMinutes);
        assert_eq!(query.limit, 50);
        assert_eq!(query.group, Some(OpsLatencyGroupFilter::Chronicle));
        assert_eq!(query.status, Some(OpsStatusFilter::Success));
        assert_eq!(query.rum_type, Some(OpsRumTypeFilter::Api));

        let error = parse_ops_query(Some("window=30m")).expect_err("invalid window rejected");
        assert_eq!(error.code, "ops_window_invalid");

        let error = parse_ops_query(Some("limit=51")).expect_err("large limit rejected");
        assert_eq!(error.code, "ops_limit_invalid");
    }
}
