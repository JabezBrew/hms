use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::config::OpsPrometheusConfig;

use super::OpsDataNote;

const ROUTE_LIMIT: usize = 20;
const WINDOW_5M: &str = "5m";
const WINDOW_15M: &str = "15m";
const WINDOW_1H: &str = "1h";
const WINDOW_6H: &str = "6h";
const WINDOW_24H: &str = "24h";

#[derive(Clone)]
pub struct OpsPrometheusProvider {
    config: OpsPrometheusConfig,
    client: reqwest::Client,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpsPrometheusHistoricalSummary {
    pub available: bool,
    pub window: String,
    pub generated_at: DateTime<Utc>,
    pub routes: Vec<OpsPrometheusRouteSummary>,
    pub clinical_budgets: Vec<OpsPrometheusLatencySummary>,
    pub payloads: Vec<OpsPrometheusPayloadSummary>,
    pub db_pool_waits: Vec<OpsPrometheusLatencySummary>,
    pub request_context: OpsPrometheusRequestContextSummary,
    pub browser_rum: OpsPrometheusBrowserRumSummary,
    pub service_errors: Vec<OpsPrometheusServiceErrorSummary>,
    pub notes: Vec<OpsDataNote>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct OpsPrometheusRouteSummary {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub request_count: u64,
    pub request_rate_per_second: Option<f64>,
    pub error_rate: Option<f64>,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub p99_ms: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct OpsPrometheusLatencySummary {
    pub group: String,
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub p99_ms: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct OpsPrometheusPayloadSummary {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
    pub p95_bytes: Option<u64>,
    pub p99_bytes: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct OpsPrometheusRequestContextSummary {
    pub hits_total: u64,
    pub misses_total: u64,
    pub hit_rate: Option<f64>,
    pub hydration: Vec<OpsPrometheusLatencySummary>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct OpsPrometheusBrowserRumSummary {
    pub all: Vec<OpsPrometheusLatencySummary>,
    pub api: Vec<OpsPrometheusLatencySummary>,
    pub navigation: Vec<OpsPrometheusLatencySummary>,
    pub app_shell: Vec<OpsPrometheusLatencySummary>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct OpsPrometheusServiceErrorSummary {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
    pub rate_per_second: Option<f64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OpsPrometheusWindow {
    FiveMinutes,
    FifteenMinutes,
    OneHour,
    SixHours,
    TwentyFourHours,
}

#[derive(Clone, Copy, Debug)]
enum QueryTemplate {
    RouteP50,
    RouteP95,
    RouteP99,
    RouteRequestCount,
    RouteRequestRate,
    RouteErrorRate,
    ChronicleP50,
    ChronicleP95,
    ChronicleP99,
    ChronicleCount,
    DashboardP50,
    DashboardP95,
    DashboardP99,
    DashboardCount,
    WardBoardP50,
    WardBoardP95,
    WardBoardP99,
    WardBoardCount,
    PayloadP95,
    PayloadP99,
    PayloadCount,
    DbPoolWaitP95,
    DbPoolWaitP99,
    DbPoolWaitCount,
    RequestContextHydrationP95,
    RequestContextHydrationP99,
    RequestContextHydrationCount,
    RequestContextCacheHits,
    RequestContextCacheMisses,
    BrowserRumP95,
    BrowserRumP99,
    BrowserRumCount,
    BrowserApiP95,
    BrowserApiP99,
    BrowserApiCount,
    BrowserNavigationP95,
    BrowserNavigationP99,
    BrowserNavigationCount,
    BrowserAppShellP95,
    BrowserAppShellP99,
    BrowserAppShellCount,
    ServiceErrorCount,
    ServiceErrorRate,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct RouteKey {
    route_pattern: String,
    status_bucket: String,
    facility_safe: String,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct ErrorRateKey {
    route_pattern: String,
    facility_safe: String,
}

#[derive(Clone, Debug, Deserialize)]
struct PrometheusResponse {
    status: String,
    data: Option<PrometheusData>,
}

#[derive(Clone, Debug, Deserialize)]
struct PrometheusData {
    result: Vec<PrometheusResult>,
}

#[derive(Clone, Debug, Deserialize)]
struct PrometheusResult {
    metric: BTreeMap<String, String>,
    value: (f64, String),
}

#[derive(Clone, Debug)]
struct PrometheusSample {
    labels: BTreeMap<String, String>,
    value: f64,
}

impl OpsPrometheusProvider {
    pub fn new(config: OpsPrometheusConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(config.timeout)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self { config, client }
    }

    pub async fn summaries_for_allowed_windows(&self) -> Vec<OpsPrometheusHistoricalSummary> {
        let mut summaries = Vec::new();
        for window in [
            OpsPrometheusWindow::FiveMinutes,
            OpsPrometheusWindow::FifteenMinutes,
            OpsPrometheusWindow::OneHour,
            OpsPrometheusWindow::SixHours,
            OpsPrometheusWindow::TwentyFourHours,
        ] {
            summaries.push(self.summary_for_window(window.as_str()).await);
        }
        summaries
    }

    pub async fn summary_for_window(&self, window: &str) -> OpsPrometheusHistoricalSummary {
        let window = match OpsPrometheusWindow::parse(window) {
            Some(window) => window,
            None => return unavailable(window, "invalid_window", "unsupported_window"),
        };

        if !self.config.enabled {
            return unavailable(window.as_str(), "prometheus_disabled", "disabled");
        }

        let Some(base_url) = self.config.url.as_deref() else {
            return unavailable(window.as_str(), "prometheus_unconfigured", "unconfigured");
        };

        match self.fetch_summary(base_url, window).await {
            Ok(summary) => summary,
            Err(()) => unavailable(window.as_str(), "prometheus_request_failed", "unavailable"),
        }
    }

    async fn fetch_summary(
        &self,
        base_url: &str,
        window: OpsPrometheusWindow,
    ) -> Result<OpsPrometheusHistoricalSummary, ()> {
        let mut routes = BTreeMap::<RouteKey, OpsPrometheusRouteSummary>::new();
        merge_route_quantile(
            &mut routes,
            self.query(base_url, QueryTemplate::RouteP50, window)
                .await?,
            0.50,
        );
        merge_route_quantile(
            &mut routes,
            self.query(base_url, QueryTemplate::RouteP95, window)
                .await?,
            0.95,
        );
        merge_route_quantile(
            &mut routes,
            self.query(base_url, QueryTemplate::RouteP99, window)
                .await?,
            0.99,
        );
        merge_route_count(
            &mut routes,
            self.query(base_url, QueryTemplate::RouteRequestCount, window)
                .await?,
        );
        merge_route_rate(
            &mut routes,
            self.query(base_url, QueryTemplate::RouteRequestRate, window)
                .await?,
        );
        merge_route_error_rates(
            &mut routes,
            self.query(base_url, QueryTemplate::RouteErrorRate, window)
                .await?,
        );

        let mut payloads = BTreeMap::<RouteKey, OpsPrometheusPayloadSummary>::new();
        merge_payload_quantile(
            &mut payloads,
            self.query(base_url, QueryTemplate::PayloadP95, window)
                .await?,
            0.95,
        );
        merge_payload_quantile(
            &mut payloads,
            self.query(base_url, QueryTemplate::PayloadP99, window)
                .await?,
            0.99,
        );
        merge_payload_count(
            &mut payloads,
            self.query(base_url, QueryTemplate::PayloadCount, window)
                .await?,
        );

        let request_context = OpsPrometheusRequestContextSummary {
            hits_total: scalar_sum(
                &self
                    .query(base_url, QueryTemplate::RequestContextCacheHits, window)
                    .await?,
            ),
            misses_total: scalar_sum(
                &self
                    .query(base_url, QueryTemplate::RequestContextCacheMisses, window)
                    .await?,
            ),
            hit_rate: None,
            hydration: latency_group(
                "request_context_hydration",
                self.query(base_url, QueryTemplate::RequestContextHydrationP95, window)
                    .await?,
                self.query(base_url, QueryTemplate::RequestContextHydrationP99, window)
                    .await?,
                self.query(
                    base_url,
                    QueryTemplate::RequestContextHydrationCount,
                    window,
                )
                .await?,
            ),
        }
        .with_hit_rate();

        let browser_rum = OpsPrometheusBrowserRumSummary {
            all: latency_group(
                "all",
                self.query(base_url, QueryTemplate::BrowserRumP95, window)
                    .await?,
                self.query(base_url, QueryTemplate::BrowserRumP99, window)
                    .await?,
                self.query(base_url, QueryTemplate::BrowserRumCount, window)
                    .await?,
            ),
            api: latency_group(
                "api",
                self.query(base_url, QueryTemplate::BrowserApiP95, window)
                    .await?,
                self.query(base_url, QueryTemplate::BrowserApiP99, window)
                    .await?,
                self.query(base_url, QueryTemplate::BrowserApiCount, window)
                    .await?,
            ),
            navigation: latency_group(
                "navigation",
                self.query(base_url, QueryTemplate::BrowserNavigationP95, window)
                    .await?,
                self.query(base_url, QueryTemplate::BrowserNavigationP99, window)
                    .await?,
                self.query(base_url, QueryTemplate::BrowserNavigationCount, window)
                    .await?,
            ),
            app_shell: latency_group(
                "app_shell",
                self.query(base_url, QueryTemplate::BrowserAppShellP95, window)
                    .await?,
                self.query(base_url, QueryTemplate::BrowserAppShellP99, window)
                    .await?,
                self.query(base_url, QueryTemplate::BrowserAppShellCount, window)
                    .await?,
            ),
        };

        let service_errors = service_errors(
            self.query(base_url, QueryTemplate::ServiceErrorCount, window)
                .await?,
            self.query(base_url, QueryTemplate::ServiceErrorRate, window)
                .await?,
        );

        Ok(OpsPrometheusHistoricalSummary {
            available: true,
            window: window.as_str().to_owned(),
            generated_at: Utc::now(),
            routes: sorted_limited(routes),
            clinical_budgets: clinical_budget_groups(self, base_url, window).await?,
            payloads: sorted_limited(payloads),
            db_pool_waits: latency_group(
                "db_pool_wait",
                self.query(base_url, QueryTemplate::DbPoolWaitP95, window)
                    .await?,
                self.query(base_url, QueryTemplate::DbPoolWaitP99, window)
                    .await?,
                self.query(base_url, QueryTemplate::DbPoolWaitCount, window)
                    .await?,
            ),
            request_context,
            browser_rum,
            service_errors,
            notes: vec![OpsDataNote {
                key: "prometheus".to_owned(),
                status: "available".to_owned(),
                note: "Historical summaries were produced from fixed server-side Prometheus query templates.".to_owned(),
            }],
        })
    }

    async fn query(
        &self,
        base_url: &str,
        template: QueryTemplate,
        window: OpsPrometheusWindow,
    ) -> Result<Vec<PrometheusSample>, ()> {
        let endpoint = format!("{}/api/v1/query", base_url.trim_end_matches('/'));
        let response = self
            .client
            .get(endpoint)
            .query(&[("query", template.render(window))])
            .send()
            .await
            .map_err(|_| ())?;
        if !response.status().is_success() {
            return Err(());
        }
        let body = response
            .json::<PrometheusResponse>()
            .await
            .map_err(|_| ())?;
        if body.status != "success" {
            return Err(());
        }
        Ok(body
            .data
            .map(|data| data.result)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|result| {
                let value = result.value.1.parse::<f64>().ok()?;
                value.is_finite().then_some(PrometheusSample {
                    labels: result.metric,
                    value,
                })
            })
            .collect())
    }
}

impl OpsPrometheusRequestContextSummary {
    fn with_hit_rate(mut self) -> Self {
        let total = self.hits_total + self.misses_total;
        self.hit_rate = (total > 0).then(|| self.hits_total as f64 / total as f64);
        self
    }
}

impl OpsPrometheusWindow {
    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            WINDOW_5M => Some(Self::FiveMinutes),
            WINDOW_15M => Some(Self::FifteenMinutes),
            WINDOW_1H => Some(Self::OneHour),
            WINDOW_6H => Some(Self::SixHours),
            WINDOW_24H => Some(Self::TwentyFourHours),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::FiveMinutes => WINDOW_5M,
            Self::FifteenMinutes => WINDOW_15M,
            Self::OneHour => WINDOW_1H,
            Self::SixHours => WINDOW_6H,
            Self::TwentyFourHours => WINDOW_24H,
        }
    }
}

impl QueryTemplate {
    fn render(self, window: OpsPrometheusWindow) -> String {
        let window = window.as_str();
        match self {
            Self::RouteP50 => histogram_quantile("0.50", "hms_api_route_request_duration_seconds", window),
            Self::RouteP95 => histogram_quantile("0.95", "hms_api_route_request_duration_seconds", window),
            Self::RouteP99 => histogram_quantile("0.99", "hms_api_route_request_duration_seconds", window),
            Self::RouteRequestCount => route_counter_increase("hms_api_route_requests_total", window),
            Self::RouteRequestRate => route_counter_rate("hms_api_route_requests_total", window),
            Self::RouteErrorRate => format!(
                "sum by (route_pattern, facility_safe) (increase(hms_api_route_requests_total{{status_bucket=\"5xx\"}}[{window}])) / clamp_min(sum by (route_pattern, facility_safe) (increase(hms_api_route_requests_total[{window}])), 1)"
            ),
            Self::ChronicleP50 => histogram_quantile("0.50", "hms_chronicle_read_seconds", window),
            Self::ChronicleP95 => histogram_quantile("0.95", "hms_chronicle_read_seconds", window),
            Self::ChronicleP99 => histogram_quantile("0.99", "hms_chronicle_read_seconds", window),
            Self::ChronicleCount => route_histogram_count("hms_chronicle_read_seconds", window),
            Self::DashboardP50 => histogram_quantile("0.50", "hms_dashboard_read_seconds", window),
            Self::DashboardP95 => histogram_quantile("0.95", "hms_dashboard_read_seconds", window),
            Self::DashboardP99 => histogram_quantile("0.99", "hms_dashboard_read_seconds", window),
            Self::DashboardCount => route_histogram_count("hms_dashboard_read_seconds", window),
            Self::WardBoardP50 => histogram_quantile("0.50", "hms_ward_board_read_seconds", window),
            Self::WardBoardP95 => histogram_quantile("0.95", "hms_ward_board_read_seconds", window),
            Self::WardBoardP99 => histogram_quantile("0.99", "hms_ward_board_read_seconds", window),
            Self::WardBoardCount => route_histogram_count("hms_ward_board_read_seconds", window),
            Self::PayloadP95 => histogram_quantile("0.95", "hms_api_response_payload_bytes", window),
            Self::PayloadP99 => histogram_quantile("0.99", "hms_api_response_payload_bytes", window),
            Self::PayloadCount => route_histogram_count("hms_api_response_payload_bytes", window),
            Self::DbPoolWaitP95 => histogram_quantile("0.95", "hms_db_pool_wait_seconds", window),
            Self::DbPoolWaitP99 => histogram_quantile("0.99", "hms_db_pool_wait_seconds", window),
            Self::DbPoolWaitCount => route_histogram_count("hms_db_pool_wait_seconds", window),
            Self::RequestContextHydrationP95 => histogram_quantile("0.95", "hms_request_context_hydration_db_seconds", window),
            Self::RequestContextHydrationP99 => histogram_quantile("0.99", "hms_request_context_hydration_db_seconds", window),
            Self::RequestContextHydrationCount => route_histogram_count("hms_request_context_hydration_db_seconds", window),
            Self::RequestContextCacheHits => route_counter_increase("hms_request_context_cache_hits_total", window),
            Self::RequestContextCacheMisses => route_counter_increase("hms_request_context_cache_misses_total", window),
            Self::BrowserRumP95 => histogram_quantile("0.95", "hms_browser_rum_duration_seconds", window),
            Self::BrowserRumP99 => histogram_quantile("0.99", "hms_browser_rum_duration_seconds", window),
            Self::BrowserRumCount => route_histogram_count("hms_browser_rum_duration_seconds", window),
            Self::BrowserApiP95 => histogram_quantile("0.95", "hms_browser_api_request_duration_seconds", window),
            Self::BrowserApiP99 => histogram_quantile("0.99", "hms_browser_api_request_duration_seconds", window),
            Self::BrowserApiCount => route_histogram_count("hms_browser_api_request_duration_seconds", window),
            Self::BrowserNavigationP95 => histogram_quantile("0.95", "hms_browser_navigation_timing_seconds", window),
            Self::BrowserNavigationP99 => histogram_quantile("0.99", "hms_browser_navigation_timing_seconds", window),
            Self::BrowserNavigationCount => route_histogram_count("hms_browser_navigation_timing_seconds", window),
            Self::BrowserAppShellP95 => histogram_quantile("0.95", "hms_browser_app_shell_load_seconds", window),
            Self::BrowserAppShellP99 => histogram_quantile("0.99", "hms_browser_app_shell_load_seconds", window),
            Self::BrowserAppShellCount => route_histogram_count("hms_browser_app_shell_load_seconds", window),
            Self::ServiceErrorCount => format!(
                "sum by (route_pattern, status_bucket, facility_safe) (increase(hms_api_route_requests_total{{status_bucket=~\"4xx|5xx\"}}[{window}]))"
            ),
            Self::ServiceErrorRate => format!(
                "sum by (route_pattern, status_bucket, facility_safe) (rate(hms_api_route_requests_total{{status_bucket=~\"4xx|5xx\"}}[{window}]))"
            ),
        }
    }
}

async fn clinical_budget_groups(
    provider: &OpsPrometheusProvider,
    base_url: &str,
    window: OpsPrometheusWindow,
) -> Result<Vec<OpsPrometheusLatencySummary>, ()> {
    let mut groups = Vec::new();
    let chronicle_p50 = provider
        .query(base_url, QueryTemplate::ChronicleP50, window)
        .await?;
    let chronicle = latency_group_with_p50(
        "chronicle",
        chronicle_p50,
        latency_group(
            "chronicle",
            provider
                .query(base_url, QueryTemplate::ChronicleP95, window)
                .await?,
            provider
                .query(base_url, QueryTemplate::ChronicleP99, window)
                .await?,
            provider
                .query(base_url, QueryTemplate::ChronicleCount, window)
                .await?,
        ),
    );
    groups.extend(chronicle);
    let dashboard_p50 = provider
        .query(base_url, QueryTemplate::DashboardP50, window)
        .await?;
    groups.extend(latency_group_with_p50(
        "dashboards",
        dashboard_p50,
        latency_group(
            "dashboards",
            provider
                .query(base_url, QueryTemplate::DashboardP95, window)
                .await?,
            provider
                .query(base_url, QueryTemplate::DashboardP99, window)
                .await?,
            provider
                .query(base_url, QueryTemplate::DashboardCount, window)
                .await?,
        ),
    ));
    let ward_board_p50 = provider
        .query(base_url, QueryTemplate::WardBoardP50, window)
        .await?;
    groups.extend(latency_group_with_p50(
        "ward_board",
        ward_board_p50,
        latency_group(
            "ward_board",
            provider
                .query(base_url, QueryTemplate::WardBoardP95, window)
                .await?,
            provider
                .query(base_url, QueryTemplate::WardBoardP99, window)
                .await?,
            provider
                .query(base_url, QueryTemplate::WardBoardCount, window)
                .await?,
        ),
    ));
    Ok(groups.into_iter().take(ROUTE_LIMIT).collect())
}

fn latency_group(
    group: &str,
    p95: Vec<PrometheusSample>,
    p99: Vec<PrometheusSample>,
    counts: Vec<PrometheusSample>,
) -> Vec<OpsPrometheusLatencySummary> {
    let mut summaries = BTreeMap::<RouteKey, OpsPrometheusLatencySummary>::new();
    merge_latency_quantile(&mut summaries, group, p95, 0.95);
    merge_latency_quantile(&mut summaries, group, p99, 0.99);
    merge_latency_count(&mut summaries, group, counts);
    sorted_limited(summaries)
}

fn latency_group_with_p50(
    group: &str,
    p50: Vec<PrometheusSample>,
    summaries: Vec<OpsPrometheusLatencySummary>,
) -> Vec<OpsPrometheusLatencySummary> {
    let mut summaries = summaries
        .into_iter()
        .map(|summary| (route_key_from_summary(&summary), summary))
        .collect::<BTreeMap<_, _>>();
    merge_latency_quantile(&mut summaries, group, p50, 0.50);
    sorted_limited(summaries)
}

fn merge_route_quantile(
    summaries: &mut BTreeMap<RouteKey, OpsPrometheusRouteSummary>,
    samples: Vec<PrometheusSample>,
    quantile: f64,
) {
    for sample in samples {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        let summary = summaries
            .entry(key.clone())
            .or_insert_with(|| route_summary(&key));
        let value = Some(seconds_to_ms(sample.value));
        if quantile == 0.50 {
            summary.p50_ms = value;
        } else if quantile == 0.95 {
            summary.p95_ms = value;
        } else {
            summary.p99_ms = value;
        }
    }
}

fn merge_route_count(
    summaries: &mut BTreeMap<RouteKey, OpsPrometheusRouteSummary>,
    samples: Vec<PrometheusSample>,
) {
    for sample in samples {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        summaries
            .entry(key.clone())
            .or_insert_with(|| route_summary(&key))
            .request_count = non_negative_u64(sample.value);
    }
}

fn merge_route_rate(
    summaries: &mut BTreeMap<RouteKey, OpsPrometheusRouteSummary>,
    samples: Vec<PrometheusSample>,
) {
    for sample in samples {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        summaries
            .entry(key.clone())
            .or_insert_with(|| route_summary(&key))
            .request_rate_per_second = Some(sample.value.max(0.0));
    }
}

fn merge_route_error_rates(
    summaries: &mut BTreeMap<RouteKey, OpsPrometheusRouteSummary>,
    samples: Vec<PrometheusSample>,
) {
    let rates = samples
        .into_iter()
        .filter_map(|sample| {
            Some((
                ErrorRateKey {
                    route_pattern: sample.labels.get("route_pattern")?.clone(),
                    facility_safe: sample.labels.get("facility_safe")?.clone(),
                },
                sample.value.clamp(0.0, 1.0),
            ))
        })
        .collect::<BTreeMap<_, _>>();

    for (key, summary) in summaries {
        if let Some(rate) = rates.get(&ErrorRateKey {
            route_pattern: key.route_pattern.clone(),
            facility_safe: key.facility_safe.clone(),
        }) {
            summary.error_rate = Some(*rate);
        }
    }
}

fn merge_latency_quantile(
    summaries: &mut BTreeMap<RouteKey, OpsPrometheusLatencySummary>,
    group: &str,
    samples: Vec<PrometheusSample>,
    quantile: f64,
) {
    for sample in samples {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        let summary = summaries
            .entry(key.clone())
            .or_insert_with(|| latency_summary(group, &key));
        let value = Some(seconds_to_ms(sample.value));
        if quantile == 0.50 {
            summary.p50_ms = value;
        } else if quantile == 0.95 {
            summary.p95_ms = value;
        } else {
            summary.p99_ms = value;
        }
    }
}

fn merge_latency_count(
    summaries: &mut BTreeMap<RouteKey, OpsPrometheusLatencySummary>,
    group: &str,
    samples: Vec<PrometheusSample>,
) {
    for sample in samples {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        summaries
            .entry(key.clone())
            .or_insert_with(|| latency_summary(group, &key))
            .count = non_negative_u64(sample.value);
    }
}

fn merge_payload_quantile(
    summaries: &mut BTreeMap<RouteKey, OpsPrometheusPayloadSummary>,
    samples: Vec<PrometheusSample>,
    quantile: f64,
) {
    for sample in samples {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        let summary = summaries
            .entry(key.clone())
            .or_insert_with(|| payload_summary(&key));
        let value = Some(non_negative_u64(sample.value));
        if quantile == 0.95 {
            summary.p95_bytes = value;
        } else {
            summary.p99_bytes = value;
        }
    }
}

fn merge_payload_count(
    summaries: &mut BTreeMap<RouteKey, OpsPrometheusPayloadSummary>,
    samples: Vec<PrometheusSample>,
) {
    for sample in samples {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        summaries
            .entry(key.clone())
            .or_insert_with(|| payload_summary(&key))
            .count = non_negative_u64(sample.value);
    }
}

fn service_errors(
    counts: Vec<PrometheusSample>,
    rates: Vec<PrometheusSample>,
) -> Vec<OpsPrometheusServiceErrorSummary> {
    let mut summaries = BTreeMap::<RouteKey, OpsPrometheusServiceErrorSummary>::new();
    for sample in counts {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        summaries
            .entry(key.clone())
            .or_insert_with(|| service_error_summary(&key))
            .count = non_negative_u64(sample.value);
    }
    for sample in rates {
        let Some(key) = route_key(&sample.labels) else {
            continue;
        };
        summaries
            .entry(key.clone())
            .or_insert_with(|| service_error_summary(&key))
            .rate_per_second = Some(sample.value.max(0.0));
    }
    sorted_limited(summaries)
}

fn route_key(labels: &BTreeMap<String, String>) -> Option<RouteKey> {
    Some(RouteKey {
        route_pattern: labels.get("route_pattern")?.clone(),
        status_bucket: labels
            .get("status_bucket")
            .cloned()
            .unwrap_or_else(|| "all".to_owned()),
        facility_safe: labels.get("facility_safe")?.clone(),
    })
}

fn route_key_from_summary(summary: &OpsPrometheusLatencySummary) -> RouteKey {
    RouteKey {
        route_pattern: summary.route_pattern.clone(),
        status_bucket: summary.status_bucket.clone(),
        facility_safe: summary.facility_safe.clone(),
    }
}

fn route_summary(key: &RouteKey) -> OpsPrometheusRouteSummary {
    OpsPrometheusRouteSummary {
        route_pattern: key.route_pattern.clone(),
        status_bucket: key.status_bucket.clone(),
        facility_safe: key.facility_safe.clone(),
        ..OpsPrometheusRouteSummary::default()
    }
}

fn latency_summary(group: &str, key: &RouteKey) -> OpsPrometheusLatencySummary {
    OpsPrometheusLatencySummary {
        group: group.to_owned(),
        route_pattern: key.route_pattern.clone(),
        status_bucket: key.status_bucket.clone(),
        facility_safe: key.facility_safe.clone(),
        ..OpsPrometheusLatencySummary::default()
    }
}

fn payload_summary(key: &RouteKey) -> OpsPrometheusPayloadSummary {
    OpsPrometheusPayloadSummary {
        route_pattern: key.route_pattern.clone(),
        status_bucket: key.status_bucket.clone(),
        facility_safe: key.facility_safe.clone(),
        ..OpsPrometheusPayloadSummary::default()
    }
}

fn service_error_summary(key: &RouteKey) -> OpsPrometheusServiceErrorSummary {
    OpsPrometheusServiceErrorSummary {
        route_pattern: key.route_pattern.clone(),
        status_bucket: key.status_bucket.clone(),
        facility_safe: key.facility_safe.clone(),
        ..OpsPrometheusServiceErrorSummary::default()
    }
}

fn sorted_limited<T>(summaries: BTreeMap<RouteKey, T>) -> Vec<T> {
    summaries.into_values().take(ROUTE_LIMIT).collect()
}

fn scalar_sum(samples: &[PrometheusSample]) -> u64 {
    non_negative_u64(samples.iter().map(|sample| sample.value).sum())
}

fn seconds_to_ms(value: f64) -> f64 {
    (value * 1000.0).max(0.0)
}

fn non_negative_u64(value: f64) -> u64 {
    value.max(0.0).round() as u64
}

fn unavailable(window: &str, key: &str, status: &str) -> OpsPrometheusHistoricalSummary {
    OpsPrometheusHistoricalSummary {
        available: false,
        window: window.to_owned(),
        generated_at: Utc::now(),
        routes: Vec::new(),
        clinical_budgets: Vec::new(),
        payloads: Vec::new(),
        db_pool_waits: Vec::new(),
        request_context: OpsPrometheusRequestContextSummary::default(),
        browser_rum: OpsPrometheusBrowserRumSummary::default(),
        service_errors: Vec::new(),
        notes: vec![OpsDataNote {
            key: key.to_owned(),
            status: status.to_owned(),
            note: "Prometheus historical summaries are unavailable; in-process ops dashboard data can still be returned.".to_owned(),
        }],
    }
}

fn histogram_quantile(quantile: &str, metric: &str, window: &str) -> String {
    format!(
        "histogram_quantile({quantile}, sum by (le, route_pattern, status_bucket, facility_safe) (rate({metric}_bucket[{window}])))"
    )
}

fn route_histogram_count(metric: &str, window: &str) -> String {
    format!(
        "sum by (route_pattern, status_bucket, facility_safe) (increase({metric}_count[{window}]))"
    )
}

fn route_counter_increase(metric: &str, window: &str) -> String {
    format!("sum by (route_pattern, status_bucket, facility_safe) (increase({metric}[{window}]))")
}

fn route_counter_rate(metric: &str, window: &str) -> String {
    format!("sum by (route_pattern, status_bucket, facility_safe) (rate({metric}[{window}]))")
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn only_fixed_windows_are_accepted() {
        assert_eq!(
            OpsPrometheusWindow::parse("5m"),
            Some(OpsPrometheusWindow::FiveMinutes)
        );
        assert_eq!(
            OpsPrometheusWindow::parse("24h"),
            Some(OpsPrometheusWindow::TwentyFourHours)
        );
        assert_eq!(OpsPrometheusWindow::parse("30m"), None);
        assert_eq!(OpsPrometheusWindow::parse("5m or vector(1)"), None);
    }

    #[test]
    fn query_templates_render_without_request_supplied_promql() {
        let query = QueryTemplate::RouteP95.render(OpsPrometheusWindow::FifteenMinutes);
        assert_eq!(
            query,
            "histogram_quantile(0.95, sum by (le, route_pattern, status_bucket, facility_safe) (rate(hms_api_route_request_duration_seconds_bucket[15m])))"
        );
        assert!(!query.contains("30m"));
        assert!(!query.contains("or vector"));
    }

    #[tokio::test]
    async fn disabled_provider_returns_unavailable_summary() {
        let provider = OpsPrometheusProvider::new(OpsPrometheusConfig::default());

        let summary = provider.summary_for_window("5m").await;

        assert!(!summary.available);
        assert_eq!(summary.window, "5m");
        assert_eq!(summary.notes[0].key, "prometheus_disabled");
        assert!(summary.routes.is_empty());
    }

    #[tokio::test]
    async fn request_failure_returns_unavailable_summary() {
        let provider = OpsPrometheusProvider::new(OpsPrometheusConfig {
            enabled: true,
            url: Some("http://127.0.0.1:9".to_owned()),
            timeout: Duration::from_millis(50),
        });

        let summary = provider.summary_for_window("15m").await;

        assert!(!summary.available);
        assert_eq!(summary.window, "15m");
        assert_eq!(summary.notes[0].key, "prometheus_request_failed");
    }
}
