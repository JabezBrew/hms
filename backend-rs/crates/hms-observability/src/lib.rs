use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

use tracing_subscriber::EnvFilter;

tokio::task_local! {
    static REQUEST_RECORDER: Arc<RequestMetricRecorder>;
}

const HTTP_DURATION_BUCKETS: &[f64] = &[0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0, 2.5, 5.0];
const DB_QUERY_DURATION_BUCKETS: &[f64] = &[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0];
const RUM_DURATION_BUCKETS: &[f64] = &[0.05, 0.1, 0.2, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0];
const API_PAYLOAD_SIZE_BUCKETS: &[f64] = &[
    1_024.0,
    4_096.0,
    8_192.0,
    16_384.0,
    32_768.0,
    65_536.0,
    131_072.0,
    262_144.0,
    524_288.0,
    1_048_576.0,
];
const DB_POOL_WAIT_BUCKETS: &[f64] = &[0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5];
const SLOW_QUERY_THRESHOLD: Duration = Duration::from_millis(250);

#[derive(Debug, Default)]
struct RequestMetricRecorder {
    db_query_count: AtomicU64,
    db_query_durations: Mutex<Vec<Duration>>,
    db_pool_wait_durations: Mutex<Vec<Duration>>,
}

#[derive(Clone, Debug, Default)]
pub struct RequestMetricsSnapshot {
    pub db_query_count: u64,
    db_query_durations: Vec<Duration>,
    db_pool_wait_durations: Vec<Duration>,
}

#[derive(Clone, Debug, Default)]
pub struct MetricsSnapshot {
    pub dashboard_reads: Vec<RouteDurationSnapshot>,
    pub chronicle_reads: Vec<RouteDurationSnapshot>,
    pub ward_board_reads: Vec<RouteDurationSnapshot>,
    pub api_payloads: Vec<RoutePayloadSnapshot>,
    pub request_context_cache: RequestContextCacheSnapshot,
    pub request_context_hydration: Vec<RouteDurationSnapshot>,
    pub db_pool_waits: Vec<RouteDurationSnapshot>,
    pub route_db_queries: Vec<RouteDurationSnapshot>,
    pub route_slow_queries: Vec<RouteCounterSnapshot>,
    pub db_query_fingerprints: Vec<DbQueryFingerprintSnapshot>,
    pub browser_rum: BrowserMetricsSnapshot,
}

#[derive(Clone, Debug, Default)]
pub struct RouteDurationSnapshot {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
    pub avg_ms: Option<f64>,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub p99_ms: Option<f64>,
}

#[derive(Clone, Debug, Default)]
pub struct RoutePayloadSnapshot {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
    pub avg_bytes: Option<f64>,
    pub p50_bytes: Option<u64>,
    pub p95_bytes: Option<u64>,
    pub p99_bytes: Option<u64>,
}

#[derive(Clone, Debug, Default)]
pub struct RouteCounterSnapshot {
    pub route_pattern: String,
    pub status_bucket: String,
    pub facility_safe: String,
    pub count: u64,
}

#[derive(Clone, Debug, Default)]
pub struct RequestContextCacheSnapshot {
    pub hits_total: u64,
    pub misses_total: u64,
    pub hit_rate: Option<f64>,
    pub hits_by_route: Vec<RouteCounterSnapshot>,
    pub misses_by_route: Vec<RouteCounterSnapshot>,
}

#[derive(Clone, Debug, Default)]
pub struct DbQueryFingerprintSnapshot {
    pub fingerprint: String,
    pub count: u64,
    pub total_ms: f64,
    pub avg_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub p99_ms: Option<f64>,
}

#[derive(Clone, Debug, Default)]
pub struct BrowserMetricsSnapshot {
    pub all: Vec<RouteDurationSnapshot>,
    pub api: Vec<RouteDurationSnapshot>,
    pub navigation: Vec<RouteDurationSnapshot>,
    pub app_shell: Vec<RouteDurationSnapshot>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct HttpRequestMetricKey {
    method: String,
    route: String,
    status: u16,
}

struct HttpRequestMetricValue {
    count: AtomicU64,
    duration_ns_sum: AtomicU64,
    duration_bucket_counts: Vec<AtomicU64>,
    db_query_count_sum: AtomicU64,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct RouteMetricKey {
    route_pattern: String,
    status_bucket: String,
    facility_safe: String,
}

struct RouteDurationMetricValue {
    count: AtomicU64,
    duration_ns_sum: AtomicU64,
    duration_bucket_counts: Vec<AtomicU64>,
}

struct RoutePayloadMetricValue {
    count: AtomicU64,
    bytes_sum: AtomicU64,
    bytes_bucket_counts: Vec<AtomicU64>,
}

struct RouteCounterMetricValue {
    count: AtomicU64,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct DbQueryMetricKey {
    query: String,
}

struct DbQueryMetricValue {
    count: AtomicU64,
    duration_ns_sum: AtomicU64,
    duration_bucket_counts: Vec<AtomicU64>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct GaugeMetricKey {
    name: String,
    labels: Vec<(String, String)>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct BrowserRumMetricKey {
    route_pattern: String,
    status_bucket: String,
    facility_safe: String,
}

struct BrowserRumMetricValue {
    count: AtomicU64,
    duration_ns_sum: AtomicU64,
    duration_bucket_counts: Vec<AtomicU64>,
}

impl HttpRequestMetricValue {
    fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            duration_ns_sum: AtomicU64::new(0),
            duration_bucket_counts: atomic_buckets(HTTP_DURATION_BUCKETS.len()),
            db_query_count_sum: AtomicU64::new(0),
        }
    }

    fn observe(&self, duration: Duration, db_query_count: u64) {
        observe_duration_histogram(
            duration,
            HTTP_DURATION_BUCKETS,
            &self.duration_bucket_counts,
            &self.duration_ns_sum,
            &self.count,
        );
        self.db_query_count_sum
            .fetch_add(db_query_count, Ordering::Relaxed);
    }

    fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }

    fn duration_ns_sum(&self) -> u64 {
        self.duration_ns_sum.load(Ordering::Relaxed)
    }

    fn duration_bucket_counts(&self) -> Vec<u64> {
        load_buckets(&self.duration_bucket_counts)
    }

    fn db_query_count_sum(&self) -> u64 {
        self.db_query_count_sum.load(Ordering::Relaxed)
    }
}

impl RouteDurationMetricValue {
    fn new(bucket_count: usize) -> Self {
        Self {
            count: AtomicU64::new(0),
            duration_ns_sum: AtomicU64::new(0),
            duration_bucket_counts: atomic_buckets(bucket_count),
        }
    }

    fn observe(&self, duration: Duration, buckets: &[f64]) {
        observe_duration_histogram(
            duration,
            buckets,
            &self.duration_bucket_counts,
            &self.duration_ns_sum,
            &self.count,
        );
    }

    fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }

    fn duration_ns_sum(&self) -> u64 {
        self.duration_ns_sum.load(Ordering::Relaxed)
    }

    fn duration_bucket_counts(&self) -> Vec<u64> {
        load_buckets(&self.duration_bucket_counts)
    }
}

impl RoutePayloadMetricValue {
    fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            bytes_sum: AtomicU64::new(0),
            bytes_bucket_counts: atomic_buckets(API_PAYLOAD_SIZE_BUCKETS.len()),
        }
    }

    fn observe(&self, bytes: u64) {
        observe_u64_histogram(
            bytes,
            API_PAYLOAD_SIZE_BUCKETS,
            &self.bytes_bucket_counts,
            &self.bytes_sum,
            &self.count,
        );
    }

    fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }

    fn bytes_sum(&self) -> u64 {
        self.bytes_sum.load(Ordering::Relaxed)
    }

    fn bytes_bucket_counts(&self) -> Vec<u64> {
        load_buckets(&self.bytes_bucket_counts)
    }
}

impl RouteCounterMetricValue {
    fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
        }
    }

    fn increment_by(&self, value: u64) {
        self.count.fetch_add(value, Ordering::Relaxed);
    }

    fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }
}

impl DbQueryMetricValue {
    fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            duration_ns_sum: AtomicU64::new(0),
            duration_bucket_counts: atomic_buckets(DB_QUERY_DURATION_BUCKETS.len()),
        }
    }

    fn observe(&self, duration: Duration) {
        observe_duration_histogram(
            duration,
            DB_QUERY_DURATION_BUCKETS,
            &self.duration_bucket_counts,
            &self.duration_ns_sum,
            &self.count,
        );
    }

    fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }

    fn duration_ns_sum(&self) -> u64 {
        self.duration_ns_sum.load(Ordering::Relaxed)
    }

    fn duration_bucket_counts(&self) -> Vec<u64> {
        load_buckets(&self.duration_bucket_counts)
    }
}

impl BrowserRumMetricValue {
    fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            duration_ns_sum: AtomicU64::new(0),
            duration_bucket_counts: atomic_buckets(RUM_DURATION_BUCKETS.len()),
        }
    }

    fn observe(&self, duration: Duration) {
        observe_duration_histogram(
            duration,
            RUM_DURATION_BUCKETS,
            &self.duration_bucket_counts,
            &self.duration_ns_sum,
            &self.count,
        );
    }

    fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }

    fn duration_ns_sum(&self) -> u64 {
        self.duration_ns_sum.load(Ordering::Relaxed)
    }

    fn duration_bucket_counts(&self) -> Vec<u64> {
        load_buckets(&self.duration_bucket_counts)
    }
}

impl RequestMetricRecorder {
    fn record_db_query(&self, duration: Duration) {
        self.db_query_count.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut durations) = self.db_query_durations.lock() {
            durations.push(duration);
        }
    }

    fn record_db_pool_wait(&self, duration: Duration) {
        if let Ok(mut durations) = self.db_pool_wait_durations.lock() {
            durations.push(duration);
        }
    }

    fn snapshot(&self) -> RequestMetricsSnapshot {
        RequestMetricsSnapshot {
            db_query_count: self.db_query_count.load(Ordering::Relaxed),
            db_query_durations: self
                .db_query_durations
                .lock()
                .map(|durations| durations.clone())
                .unwrap_or_default(),
            db_pool_wait_durations: self
                .db_pool_wait_durations
                .lock()
                .map(|durations| durations.clone())
                .unwrap_or_default(),
        }
    }
}

static HTTP_REQUEST_METRICS: OnceLock<
    RwLock<BTreeMap<HttpRequestMetricKey, Arc<HttpRequestMetricValue>>>,
> = OnceLock::new();
static API_ROUTE_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>,
> = OnceLock::new();
static DASHBOARD_READ_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>,
> = OnceLock::new();
static CHRONICLE_READ_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>,
> = OnceLock::new();
static WARD_BOARD_READ_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>,
> = OnceLock::new();
static API_RESPONSE_PAYLOAD_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RoutePayloadMetricValue>>>,
> = OnceLock::new();
static ROUTE_DB_QUERY_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>,
> = OnceLock::new();
static ROUTE_DB_SLOW_QUERY_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>>,
> = OnceLock::new();
static DB_POOL_WAIT_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>,
> = OnceLock::new();
static REQUEST_CONTEXT_CACHE_HIT_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>>,
> = OnceLock::new();
static REQUEST_CONTEXT_CACHE_MISS_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>>,
> = OnceLock::new();
static REQUEST_CONTEXT_HYDRATION_DB_METRICS: OnceLock<
    RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>,
> = OnceLock::new();
static DB_QUERY_METRICS: OnceLock<RwLock<BTreeMap<DbQueryMetricKey, Arc<DbQueryMetricValue>>>> =
    OnceLock::new();
static GAUGE_METRICS: OnceLock<Mutex<BTreeMap<GaugeMetricKey, f64>>> = OnceLock::new();
static BROWSER_RUM_METRICS: OnceLock<
    RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>>,
> = OnceLock::new();
static BROWSER_API_METRICS: OnceLock<
    RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>>,
> = OnceLock::new();
static BROWSER_NAVIGATION_METRICS: OnceLock<
    RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>>,
> = OnceLock::new();
static BROWSER_APP_SHELL_METRICS: OnceLock<
    RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>>,
> = OnceLock::new();

pub fn init_json_tracing(default_filter: &'static str) {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter));
    let _ = tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(false)
        .with_span_list(false)
        .try_init();
}

pub async fn with_request_query_counter<F, T>(future: F) -> (T, u64)
where
    F: Future<Output = T>,
{
    let (output, snapshot) = with_request_metrics_recorder(future).await;
    (output, snapshot.db_query_count)
}

pub async fn with_request_metrics_recorder<F, T>(future: F) -> (T, RequestMetricsSnapshot)
where
    F: Future<Output = T>,
{
    let recorder = Arc::new(RequestMetricRecorder::default());
    let output = REQUEST_RECORDER.scope(Arc::clone(&recorder), future).await;
    (output, recorder.snapshot())
}

pub async fn observe_db_query<F, T, E>(query_name: &'static str, future: F) -> Result<T, E>
where
    F: Future<Output = Result<T, E>>,
{
    let started_at = std::time::Instant::now();
    let output = future.await;
    record_db_query(query_name, started_at.elapsed());
    output
}

pub fn record_db_query(query_name: &'static str, duration: Duration) {
    let _ = REQUEST_RECORDER.try_with(|recorder| {
        recorder.record_db_query(duration);
    });

    let entry = db_query_metric(DbQueryMetricKey {
        query: sanitize_query_label(query_name),
    });
    entry.observe(duration);
}

pub fn record_db_pool_wait(duration: Duration) {
    let _ = REQUEST_RECORDER.try_with(|recorder| {
        recorder.record_db_pool_wait(duration);
    });
}

pub fn record_http_request(
    method: &str,
    route_pattern: &str,
    status: u16,
    duration: Duration,
    db_query_count: u64,
) {
    let entry = http_request_metric(HttpRequestMetricKey {
        method: sanitize_method_label(method),
        route: sanitize_route_label(route_pattern),
        status,
    });
    entry.observe(duration, db_query_count);
}

pub fn record_http_route_metrics(
    route_pattern: &str,
    status_bucket: &str,
    facility_safe: &str,
    duration: Duration,
    payload_bytes: Option<u64>,
    request_metrics: &RequestMetricsSnapshot,
) {
    let key = route_metric_key(route_pattern, status_bucket, facility_safe);
    route_duration_metric(
        api_route_metrics(),
        key.clone(),
        HTTP_DURATION_BUCKETS.len(),
    )
    .observe(duration, HTTP_DURATION_BUCKETS);

    if let Some(payload_bytes) = payload_bytes {
        route_payload_metric(api_response_payload_metrics(), key.clone()).observe(payload_bytes);
    }

    if is_dashboard_read(route_pattern) {
        route_duration_metric(
            dashboard_read_metrics(),
            key.clone(),
            HTTP_DURATION_BUCKETS.len(),
        )
        .observe(duration, HTTP_DURATION_BUCKETS);
    }
    if is_chronicle_read(route_pattern) {
        route_duration_metric(
            chronicle_read_metrics(),
            key.clone(),
            HTTP_DURATION_BUCKETS.len(),
        )
        .observe(duration, HTTP_DURATION_BUCKETS);
    }
    if is_ward_board_read(route_pattern) {
        route_duration_metric(
            ward_board_read_metrics(),
            key.clone(),
            HTTP_DURATION_BUCKETS.len(),
        )
        .observe(duration, HTTP_DURATION_BUCKETS);
    }

    if !request_metrics.db_query_durations.is_empty() {
        let route_db_metric = route_duration_metric(
            route_db_query_metrics(),
            key.clone(),
            DB_QUERY_DURATION_BUCKETS.len(),
        );
        let mut slow_queries = 0;
        for db_duration in &request_metrics.db_query_durations {
            route_db_metric.observe(*db_duration, DB_QUERY_DURATION_BUCKETS);
            if *db_duration > SLOW_QUERY_THRESHOLD {
                slow_queries += 1;
            }
        }
        if slow_queries > 0 {
            route_counter_metric(route_db_slow_query_metrics(), key.clone())
                .increment_by(slow_queries);
        }
    }

    if !request_metrics.db_pool_wait_durations.is_empty() {
        let pool_wait_metric =
            route_duration_metric(db_pool_wait_metrics(), key, DB_POOL_WAIT_BUCKETS.len());
        for pool_wait in &request_metrics.db_pool_wait_durations {
            pool_wait_metric.observe(*pool_wait, DB_POOL_WAIT_BUCKETS);
        }
    }
}

pub fn record_request_context_cache_hit(route_pattern: &str, facility_safe: &str) {
    let key = route_metric_key(route_pattern, "unknown", facility_safe);
    route_counter_metric(request_context_cache_hit_metrics(), key).increment_by(1);
}

pub fn record_request_context_cache_miss(route_pattern: &str, facility_safe: &str) {
    let key = route_metric_key(route_pattern, "unknown", facility_safe);
    route_counter_metric(request_context_cache_miss_metrics(), key).increment_by(1);
}

pub fn record_request_context_hydration_db_time(
    route_pattern: &str,
    facility_safe: &str,
    duration: Duration,
) {
    let key = route_metric_key(route_pattern, "unknown", facility_safe);
    route_duration_metric(
        request_context_hydration_db_metrics(),
        key,
        DB_QUERY_DURATION_BUCKETS.len(),
    )
    .observe(duration, DB_QUERY_DURATION_BUCKETS);
}

pub fn prometheus_metrics() -> String {
    let http_metrics = http_request_metrics()
        .read()
        .expect("http metrics lock poisoned");
    let api_route_metrics = api_route_metrics()
        .read()
        .expect("api route metrics lock poisoned");
    let dashboard_read_metrics = dashboard_read_metrics()
        .read()
        .expect("dashboard metrics lock poisoned");
    let chronicle_read_metrics = chronicle_read_metrics()
        .read()
        .expect("chronicle metrics lock poisoned");
    let ward_board_read_metrics = ward_board_read_metrics()
        .read()
        .expect("ward board metrics lock poisoned");
    let payload_metrics = api_response_payload_metrics()
        .read()
        .expect("payload metrics lock poisoned");
    let route_db_query_metrics = route_db_query_metrics()
        .read()
        .expect("route db metrics lock poisoned");
    let route_db_slow_query_metrics = route_db_slow_query_metrics()
        .read()
        .expect("slow query metrics lock poisoned");
    let db_pool_wait_metrics = db_pool_wait_metrics()
        .read()
        .expect("pool wait metrics lock poisoned");
    let request_context_cache_hit_metrics = request_context_cache_hit_metrics()
        .read()
        .expect("request context cache hit metrics lock poisoned");
    let request_context_cache_miss_metrics = request_context_cache_miss_metrics()
        .read()
        .expect("request context cache miss metrics lock poisoned");
    let request_context_hydration_db_metrics = request_context_hydration_db_metrics()
        .read()
        .expect("request context hydration metrics lock poisoned");
    let db_metrics = db_query_metrics().read().expect("db metrics lock poisoned");
    let gauge_metrics = gauge_metrics().lock().expect("gauge metrics lock poisoned");
    let browser_rum_metrics = browser_rum_metrics()
        .read()
        .expect("browser RUM metrics lock poisoned");
    let browser_api_metrics = browser_api_metrics()
        .read()
        .expect("browser API metrics lock poisoned");
    let browser_navigation_metrics = browser_navigation_metrics()
        .read()
        .expect("browser navigation metrics lock poisoned");
    let browser_app_shell_metrics = browser_app_shell_metrics()
        .read()
        .expect("browser app shell metrics lock poisoned");
    let mut body = String::new();

    body.push_str(
        "# HELP hms_api_http_requests_total Total HTTP requests by method, route pattern, and status.\n",
    );
    body.push_str("# TYPE hms_api_http_requests_total counter\n");
    if http_metrics.is_empty() {
        body.push_str(
            "hms_api_http_requests_total{method=\"NONE\",route=\"_none\",status=\"0\"} 0\n",
        );
    } else {
        for (key, value) in http_metrics.iter() {
            body.push_str(&format!(
                "hms_api_http_requests_total{{method=\"{}\",route=\"{}\",status=\"{}\"}} {}\n",
                escape_label_value(&key.method),
                escape_label_value(&key.route),
                key.status,
                value.count()
            ));
        }
    }

    body.push_str(
        "# HELP hms_api_http_request_duration_seconds HTTP request duration in seconds by method, route pattern, and status.\n",
    );
    body.push_str("# TYPE hms_api_http_request_duration_seconds histogram\n");
    if http_metrics.is_empty() {
        append_histogram(
            &mut body,
            "hms_api_http_request_duration_seconds",
            &[("method", "NONE"), ("route", "_none"), ("status", "0")],
            HTTP_DURATION_BUCKETS,
            &[],
            0.0,
            0,
        );
    } else {
        for (key, value) in http_metrics.iter() {
            append_histogram(
                &mut body,
                "hms_api_http_request_duration_seconds",
                &[
                    ("method", &key.method),
                    ("route", &key.route),
                    ("status", &key.status.to_string()),
                ],
                HTTP_DURATION_BUCKETS,
                &value.duration_bucket_counts(),
                nanos_to_seconds(value.duration_ns_sum()),
                value.count(),
            );
        }
    }

    append_route_duration_counter(
        &mut body,
        "hms_api_route_requests_total",
        "Total HTTP requests by route pattern, status bucket, and safe facility.",
        &api_route_metrics,
    );
    append_route_duration_histogram(
        &mut body,
        "hms_api_route_request_duration_seconds",
        "HTTP request duration in seconds by route pattern, status bucket, and safe facility.",
        HTTP_DURATION_BUCKETS,
        &api_route_metrics,
    );
    append_route_duration_histogram(
        &mut body,
        "hms_dashboard_read_seconds",
        "Dashboard read duration in seconds by route pattern, status bucket, and safe facility.",
        HTTP_DURATION_BUCKETS,
        &dashboard_read_metrics,
    );
    append_route_duration_histogram(
        &mut body,
        "hms_chronicle_read_seconds",
        "Chronicle read duration in seconds by route pattern, status bucket, and safe facility.",
        HTTP_DURATION_BUCKETS,
        &chronicle_read_metrics,
    );
    append_route_duration_histogram(
        &mut body,
        "hms_ward_board_read_seconds",
        "Ward board read duration in seconds by route pattern, status bucket, and safe facility.",
        HTTP_DURATION_BUCKETS,
        &ward_board_read_metrics,
    );
    append_route_payload_histogram(&mut body, &payload_metrics);

    body.push_str(
        "# HELP hms_api_http_db_query_count_sum Total database queries observed inside HTTP requests by method, route pattern, and status.\n",
    );
    body.push_str("# TYPE hms_api_http_db_query_count_sum counter\n");
    if http_metrics.is_empty() {
        body.push_str(
            "hms_api_http_db_query_count_sum{method=\"NONE\",route=\"_none\",status=\"0\"} 0\n",
        );
    } else {
        for (key, value) in http_metrics.iter() {
            body.push_str(&format!(
                "hms_api_http_db_query_count_sum{{method=\"{}\",route=\"{}\",status=\"{}\"}} {}\n",
                escape_label_value(&key.method),
                escape_label_value(&key.route),
                key.status,
                value.db_query_count_sum()
            ));
        }
    }

    body.push_str(
        "# HELP hms_db_query_duration_seconds Database query duration in seconds by stable query name or safe request route labels.\n",
    );
    body.push_str("# TYPE hms_db_query_duration_seconds histogram\n");
    if db_metrics.is_empty() {
        append_histogram(
            &mut body,
            "hms_db_query_duration_seconds",
            &[("query", "_none")],
            DB_QUERY_DURATION_BUCKETS,
            &[],
            0.0,
            0,
        );
    } else {
        for (key, value) in db_metrics.iter() {
            append_histogram(
                &mut body,
                "hms_db_query_duration_seconds",
                &[("query", &key.query)],
                DB_QUERY_DURATION_BUCKETS,
                &value.duration_bucket_counts(),
                nanos_to_seconds(value.duration_ns_sum()),
                value.count(),
            );
        }
    }
    append_route_duration_histogram_samples(
        &mut body,
        "hms_db_query_duration_seconds",
        DB_QUERY_DURATION_BUCKETS,
        &route_db_query_metrics,
    );
    append_route_counter(
        &mut body,
        "hms_db_slow_query_total",
        "Total slow database queries by route pattern, status bucket, and safe facility.",
        &route_db_slow_query_metrics,
    );
    append_route_duration_histogram(
        &mut body,
        "hms_db_pool_wait_seconds",
        "Database pool wait duration in seconds by route pattern, status bucket, and safe facility.",
        DB_POOL_WAIT_BUCKETS,
        &db_pool_wait_metrics,
    );
    append_route_counter(
        &mut body,
        "hms_request_context_cache_hits_total",
        "Total request context cache hits by route pattern, status bucket, and safe facility.",
        &request_context_cache_hit_metrics,
    );
    append_route_counter(
        &mut body,
        "hms_request_context_cache_misses_total",
        "Total request context cache misses by route pattern, status bucket, and safe facility.",
        &request_context_cache_miss_metrics,
    );
    append_route_duration_histogram(
        &mut body,
        "hms_request_context_hydration_db_seconds",
        "Request context auth hydration database duration in seconds by route pattern, status bucket, and safe facility.",
        DB_QUERY_DURATION_BUCKETS,
        &request_context_hydration_db_metrics,
    );

    append_gauges(&mut body, &gauge_metrics);
    append_browser_rum_metrics(
        &mut body,
        &browser_rum_metrics,
        &browser_api_metrics,
        &browser_navigation_metrics,
        &browser_app_shell_metrics,
    );

    body
}

pub fn set_gauge(name: &str, value: f64, labels: &[(&str, &str)]) {
    let mut metrics = gauge_metrics().lock().expect("gauge metrics lock poisoned");
    metrics.insert(
        GaugeMetricKey {
            name: sanitize_metric_name(name),
            labels: labels
                .iter()
                .map(|(label_name, label_value)| {
                    (
                        sanitize_label_name(label_name),
                        sanitize_generic_label_value(label_value),
                    )
                })
                .collect(),
        },
        value,
    );
}

pub fn record_browser_rum_event(
    event_type: &str,
    name: &str,
    route_pattern: &str,
    status_bucket: &str,
    facility_safe: &str,
    duration: Duration,
) {
    let key = BrowserRumMetricKey {
        route_pattern: normalize_browser_route_pattern(route_pattern),
        status_bucket: normalize_status_bucket(status_bucket),
        facility_safe: sanitize_facility_safe(facility_safe),
    };
    let entry = browser_rum_metric(key.clone());
    entry.observe(duration);

    let event_type = sanitize_rum_label(event_type);
    let name = sanitize_rum_label(name);
    if event_type == "api" {
        browser_rum_metric_in(browser_api_metrics(), key.clone()).observe(duration);
    }
    if event_type == "navigation" {
        browser_rum_metric_in(browser_navigation_metrics(), key.clone()).observe(duration);
    }
    if event_type == "app_shell" || name == "app_shell:ready" || name == "app_shell_ready" {
        browser_rum_metric_in(browser_app_shell_metrics(), key).observe(duration);
    }
}

pub fn metrics_snapshot() -> MetricsSnapshot {
    let dashboard_reads = route_duration_snapshots(
        &dashboard_read_metrics()
            .read()
            .expect("dashboard metrics lock poisoned"),
        HTTP_DURATION_BUCKETS,
    );
    let chronicle_reads = route_duration_snapshots(
        &chronicle_read_metrics()
            .read()
            .expect("chronicle metrics lock poisoned"),
        HTTP_DURATION_BUCKETS,
    );
    let ward_board_reads = route_duration_snapshots(
        &ward_board_read_metrics()
            .read()
            .expect("ward board metrics lock poisoned"),
        HTTP_DURATION_BUCKETS,
    );
    let api_payloads = route_payload_snapshots(
        &api_response_payload_metrics()
            .read()
            .expect("payload metrics lock poisoned"),
    );
    let hits_by_route = route_counter_snapshots(
        &request_context_cache_hit_metrics()
            .read()
            .expect("request context cache hit metrics lock poisoned"),
    );
    let misses_by_route = route_counter_snapshots(
        &request_context_cache_miss_metrics()
            .read()
            .expect("request context cache miss metrics lock poisoned"),
    );
    let request_context_hydration = route_duration_snapshots(
        &request_context_hydration_db_metrics()
            .read()
            .expect("request context hydration metrics lock poisoned"),
        DB_QUERY_DURATION_BUCKETS,
    );
    let db_pool_waits = route_duration_snapshots(
        &db_pool_wait_metrics()
            .read()
            .expect("pool wait metrics lock poisoned"),
        DB_POOL_WAIT_BUCKETS,
    );
    let route_db_queries = route_duration_snapshots(
        &route_db_query_metrics()
            .read()
            .expect("route db metrics lock poisoned"),
        DB_QUERY_DURATION_BUCKETS,
    );
    let route_slow_queries = route_counter_snapshots(
        &route_db_slow_query_metrics()
            .read()
            .expect("slow query metrics lock poisoned"),
    );
    let db_query_fingerprints = db_query_fingerprint_snapshots(
        &db_query_metrics().read().expect("db metrics lock poisoned"),
    );
    let browser_rum = BrowserMetricsSnapshot {
        all: browser_duration_snapshots(
            &browser_rum_metrics()
                .read()
                .expect("browser RUM metrics lock poisoned"),
        ),
        api: browser_duration_snapshots(
            &browser_api_metrics()
                .read()
                .expect("browser API metrics lock poisoned"),
        ),
        navigation: browser_duration_snapshots(
            &browser_navigation_metrics()
                .read()
                .expect("browser navigation metrics lock poisoned"),
        ),
        app_shell: browser_duration_snapshots(
            &browser_app_shell_metrics()
                .read()
                .expect("browser app shell metrics lock poisoned"),
        ),
    };
    let hits_total = hits_by_route.iter().map(|route| route.count).sum();
    let misses_total = misses_by_route.iter().map(|route| route.count).sum();
    let cache_total = hits_total + misses_total;

    MetricsSnapshot {
        dashboard_reads,
        chronicle_reads,
        ward_board_reads,
        api_payloads,
        request_context_cache: RequestContextCacheSnapshot {
            hits_total,
            misses_total,
            hit_rate: (cache_total > 0).then(|| hits_total as f64 / cache_total as f64),
            hits_by_route,
            misses_by_route,
        },
        request_context_hydration,
        db_pool_waits,
        route_db_queries,
        route_slow_queries,
        db_query_fingerprints,
        browser_rum,
    }
}

#[cfg(test)]
pub fn reset_metrics_for_tests() {
    http_request_metrics()
        .write()
        .expect("http metrics lock poisoned")
        .clear();
    db_query_metrics()
        .write()
        .expect("db metrics lock poisoned")
        .clear();
    api_route_metrics()
        .write()
        .expect("api route metrics lock poisoned")
        .clear();
    dashboard_read_metrics()
        .write()
        .expect("dashboard metrics lock poisoned")
        .clear();
    chronicle_read_metrics()
        .write()
        .expect("chronicle metrics lock poisoned")
        .clear();
    ward_board_read_metrics()
        .write()
        .expect("ward board metrics lock poisoned")
        .clear();
    api_response_payload_metrics()
        .write()
        .expect("payload metrics lock poisoned")
        .clear();
    route_db_query_metrics()
        .write()
        .expect("route db metrics lock poisoned")
        .clear();
    route_db_slow_query_metrics()
        .write()
        .expect("slow query metrics lock poisoned")
        .clear();
    db_pool_wait_metrics()
        .write()
        .expect("pool wait metrics lock poisoned")
        .clear();
    request_context_cache_hit_metrics()
        .write()
        .expect("request context cache hit metrics lock poisoned")
        .clear();
    request_context_cache_miss_metrics()
        .write()
        .expect("request context cache miss metrics lock poisoned")
        .clear();
    request_context_hydration_db_metrics()
        .write()
        .expect("request context hydration metrics lock poisoned")
        .clear();
    gauge_metrics()
        .lock()
        .expect("gauge metrics lock poisoned")
        .clear();
    browser_rum_metrics()
        .write()
        .expect("browser RUM metrics lock poisoned")
        .clear();
    browser_api_metrics()
        .write()
        .expect("browser API metrics lock poisoned")
        .clear();
    browser_navigation_metrics()
        .write()
        .expect("browser navigation metrics lock poisoned")
        .clear();
    browser_app_shell_metrics()
        .write()
        .expect("browser app shell metrics lock poisoned")
        .clear();
}

fn http_request_metrics(
) -> &'static RwLock<BTreeMap<HttpRequestMetricKey, Arc<HttpRequestMetricValue>>> {
    HTTP_REQUEST_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn api_route_metrics() -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>> {
    API_ROUTE_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn dashboard_read_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>> {
    DASHBOARD_READ_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn chronicle_read_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>> {
    CHRONICLE_READ_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn ward_board_read_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>> {
    WARD_BOARD_READ_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn api_response_payload_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RoutePayloadMetricValue>>> {
    API_RESPONSE_PAYLOAD_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn route_db_query_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>> {
    ROUTE_DB_QUERY_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn route_db_slow_query_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>> {
    ROUTE_DB_SLOW_QUERY_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn db_pool_wait_metrics() -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>
{
    DB_POOL_WAIT_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn request_context_cache_hit_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>> {
    REQUEST_CONTEXT_CACHE_HIT_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn request_context_cache_miss_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>> {
    REQUEST_CONTEXT_CACHE_MISS_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn request_context_hydration_db_metrics(
) -> &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>> {
    REQUEST_CONTEXT_HYDRATION_DB_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn db_query_metrics() -> &'static RwLock<BTreeMap<DbQueryMetricKey, Arc<DbQueryMetricValue>>> {
    DB_QUERY_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn gauge_metrics() -> &'static Mutex<BTreeMap<GaugeMetricKey, f64>> {
    GAUGE_METRICS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn browser_rum_metrics(
) -> &'static RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>> {
    BROWSER_RUM_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn browser_api_metrics(
) -> &'static RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>> {
    BROWSER_API_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn browser_navigation_metrics(
) -> &'static RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>> {
    BROWSER_NAVIGATION_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn browser_app_shell_metrics(
) -> &'static RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>> {
    BROWSER_APP_SHELL_METRICS.get_or_init(|| RwLock::new(BTreeMap::new()))
}

fn http_request_metric(key: HttpRequestMetricKey) -> Arc<HttpRequestMetricValue> {
    {
        let metrics = http_request_metrics()
            .read()
            .expect("http metrics lock poisoned");
        if let Some(entry) = metrics.get(&key) {
            return Arc::clone(entry);
        }
    }

    let mut metrics = http_request_metrics()
        .write()
        .expect("http metrics lock poisoned");
    Arc::clone(
        metrics
            .entry(key)
            .or_insert_with(|| Arc::new(HttpRequestMetricValue::new())),
    )
}

fn route_metric_key(
    route_pattern: &str,
    status_bucket: &str,
    facility_safe: &str,
) -> RouteMetricKey {
    RouteMetricKey {
        route_pattern: sanitize_route_label(route_pattern),
        status_bucket: normalize_status_bucket(status_bucket),
        facility_safe: sanitize_facility_safe(facility_safe),
    }
}

fn route_duration_metric(
    metrics: &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>>,
    key: RouteMetricKey,
    bucket_count: usize,
) -> Arc<RouteDurationMetricValue> {
    {
        let metrics = metrics.read().expect("route metrics lock poisoned");
        if let Some(entry) = metrics.get(&key) {
            return Arc::clone(entry);
        }
    }

    let mut metrics = metrics.write().expect("route metrics lock poisoned");
    Arc::clone(
        metrics
            .entry(key)
            .or_insert_with(|| Arc::new(RouteDurationMetricValue::new(bucket_count))),
    )
}

fn route_payload_metric(
    metrics: &'static RwLock<BTreeMap<RouteMetricKey, Arc<RoutePayloadMetricValue>>>,
    key: RouteMetricKey,
) -> Arc<RoutePayloadMetricValue> {
    {
        let metrics = metrics.read().expect("payload metrics lock poisoned");
        if let Some(entry) = metrics.get(&key) {
            return Arc::clone(entry);
        }
    }

    let mut metrics = metrics.write().expect("payload metrics lock poisoned");
    Arc::clone(
        metrics
            .entry(key)
            .or_insert_with(|| Arc::new(RoutePayloadMetricValue::new())),
    )
}

fn route_counter_metric(
    metrics: &'static RwLock<BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>>,
    key: RouteMetricKey,
) -> Arc<RouteCounterMetricValue> {
    {
        let metrics = metrics.read().expect("counter metrics lock poisoned");
        if let Some(entry) = metrics.get(&key) {
            return Arc::clone(entry);
        }
    }

    let mut metrics = metrics.write().expect("counter metrics lock poisoned");
    Arc::clone(
        metrics
            .entry(key)
            .or_insert_with(|| Arc::new(RouteCounterMetricValue::new())),
    )
}

fn db_query_metric(key: DbQueryMetricKey) -> Arc<DbQueryMetricValue> {
    {
        let metrics = db_query_metrics().read().expect("db metrics lock poisoned");
        if let Some(entry) = metrics.get(&key) {
            return Arc::clone(entry);
        }
    }

    let mut metrics = db_query_metrics()
        .write()
        .expect("db metrics lock poisoned");
    Arc::clone(
        metrics
            .entry(key)
            .or_insert_with(|| Arc::new(DbQueryMetricValue::new())),
    )
}

fn browser_rum_metric(key: BrowserRumMetricKey) -> Arc<BrowserRumMetricValue> {
    {
        let metrics = browser_rum_metrics()
            .read()
            .expect("browser RUM metrics lock poisoned");
        if let Some(entry) = metrics.get(&key) {
            return Arc::clone(entry);
        }
    }

    let mut metrics = browser_rum_metrics()
        .write()
        .expect("browser RUM metrics lock poisoned");
    Arc::clone(
        metrics
            .entry(key)
            .or_insert_with(|| Arc::new(BrowserRumMetricValue::new())),
    )
}

fn browser_rum_metric_in(
    metrics: &'static RwLock<BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>>,
    key: BrowserRumMetricKey,
) -> Arc<BrowserRumMetricValue> {
    {
        let metrics = metrics.read().expect("browser RUM metric lock poisoned");
        if let Some(entry) = metrics.get(&key) {
            return Arc::clone(entry);
        }
    }

    let mut metrics = metrics.write().expect("browser RUM metric lock poisoned");
    Arc::clone(
        metrics
            .entry(key)
            .or_insert_with(|| Arc::new(BrowserRumMetricValue::new())),
    )
}

fn is_dashboard_read(route_pattern: &str) -> bool {
    let route = route_pattern.trim();
    route == "/api/v2/dashboards/snapshot" || route.starts_with("/api/v2/dashboards/")
}

fn is_chronicle_read(route_pattern: &str) -> bool {
    route_pattern.trim() == "/api/v2/patients/:id/chronicle"
}

fn is_ward_board_read(route_pattern: &str) -> bool {
    route_pattern.trim() == "/api/v2/wards/board" || route_pattern.trim() == "/api/v2/ward-board"
}

pub fn status_bucket_from_code(status: u16) -> &'static str {
    match status {
        200..=299 => "2xx",
        300..=399 => "3xx",
        400..=499 => "4xx",
        500..=599 => "5xx",
        _ => "unknown",
    }
}

pub fn normalize_status_bucket(value: &str) -> String {
    let trimmed = value.trim().to_ascii_lowercase();
    match trimmed.as_str() {
        "2xx" | "3xx" | "4xx" | "5xx" | "network" | "timeout" | "cancelled" | "unknown" => trimmed,
        _ => trimmed
            .parse::<u16>()
            .map(status_bucket_from_code)
            .unwrap_or("unknown")
            .to_owned(),
    }
}

pub fn sanitize_facility_safe(value: &str) -> String {
    let normalized = value.trim().to_ascii_uppercase();
    sanitize_label(&normalized, "_unknown", 32, |byte| {
        byte.is_ascii_uppercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
    })
}

pub fn normalize_browser_route_pattern(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "_unknown".to_owned();
    }

    let path = trimmed
        .split('?')
        .next()
        .unwrap_or(trimmed)
        .split('#')
        .next()
        .unwrap_or(trimmed);
    if !path.starts_with('/') {
        return "_unknown".to_owned();
    }

    let segments = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .take(10)
        .map(normalize_browser_route_segment)
        .collect::<Vec<_>>();
    if segments.is_empty() {
        "/".to_owned()
    } else {
        format!("/{}", segments.join("/"))
    }
}

fn normalize_browser_route_segment(segment: &str) -> String {
    let segment = segment.trim();
    if segment.is_empty() || segment == ":id" || segment.starts_with(':') {
        return ":id".to_owned();
    }
    let lower = segment.to_ascii_lowercase();
    if lower.starts_with('{') && lower.ends_with('}') {
        return ":id".to_owned();
    }
    if is_dynamic_browser_segment(&lower) {
        return ":id".to_owned();
    }
    if is_allowed_static_route_segment(&lower) {
        return lower;
    }
    ":id".to_owned()
}

fn is_dynamic_browser_segment(segment: &str) -> bool {
    if segment.chars().all(|ch| ch.is_ascii_digit()) {
        return true;
    }
    if is_uuid_like(segment) {
        return true;
    }
    if matches_dynamic_prefix(segment) {
        return true;
    }
    segment.len() >= 10
        && segment.bytes().any(|byte| byte.is_ascii_digit())
        && segment.bytes().any(|byte| byte.is_ascii_alphabetic())
}

fn is_uuid_like(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 8 | 13 | 18 | 23) && *byte == b'-'
                || (!matches!(index, 8 | 13 | 18 | 23) && byte.is_ascii_hexdigit())
        })
}

fn matches_dynamic_prefix(segment: &str) -> bool {
    ["pat", "mrn", "enc", "adm", "ord", "inv", "rx", "lab", "pay"]
        .iter()
        .any(|prefix| {
            segment
                .strip_prefix(prefix)
                .and_then(|rest| rest.strip_prefix('-').or_else(|| rest.strip_prefix('_')))
                .map(|rest| {
                    rest.len() >= 4
                        && rest
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
                .unwrap_or(false)
        })
}

fn is_allowed_static_route_segment(segment: &str) -> bool {
    matches!(
        segment,
        "api"
            | "v2"
            | "health"
            | "alive"
            | "ready"
            | "metrics"
            | "openapi.json"
            | "ops"
            | "overview"
            | "performance"
            | "route-latency"
            | "clinical-budgets"
            | "database"
            | "db-pool"
            | "request-context-cache"
            | "payload"
            | "slow-query-fingerprints"
            | "service-errors"
            | "deploys"
            | "edge-status"
            | "frontend"
            | "auth"
            | "me"
            | "login"
            | "logout"
            | "refresh"
            | "sessions"
            | "password"
            | "password-reset"
            | "reset"
            | "mfa"
            | "webauthn"
            | "challenge"
            | "credentials"
            | "setup"
            | "verify"
            | "recovery"
            | "codes"
            | "start"
            | "finish"
            | "system"
            | "deployment-capabilities"
            | "patients"
            | "chronicle"
            | "contexts"
            | "validate"
            | "search"
            | "omni"
            | "wards"
            | "ward"
            | "board"
            | "admissions"
            | "sections"
            | "beds"
            | "handoff"
            | "mar"
            | "nursing"
            | "tasks"
            | "stock"
            | "requests"
            | "laboratory"
            | "lab"
            | "orders"
            | "results"
            | "catalog"
            | "specimens"
            | "inventory"
            | "items"
            | "locations"
            | "requisitions"
            | "purchase-orders"
            | "grns"
            | "standing-orders"
            | "transfers"
            | "controlled"
            | "analytics"
            | "billing"
            | "invoices"
            | "payments"
            | "receipts"
            | "claims"
            | "nhis"
            | "cash-sessions"
            | "drawers"
            | "insurance"
            | "discharges"
            | "appointments"
            | "clinics"
            | "waiting-room"
            | "encounters"
            | "clinical-notes"
            | "templates"
            | "charts"
            | "builder"
            | "consent"
            | "grants"
            | "referrals"
            | "inbox"
            | "sent"
            | "dashboards"
            | "dashboard"
            | "admin-v2"
            | "capacity"
            | "nurse"
            | "inpatient"
            | "reception"
            | "admin"
            | "doctor"
            | "provider"
            | "settings"
            | "profile"
            | "security"
            | "preferences"
            | "feature-entitlements"
            | "organization"
            | "unit-types"
            | "leadership-roles"
            | "duty-roster"
            | "roster-setup"
            | "roster-builder"
            | "staff"
            | "create"
            | "problems"
            | "visits"
            | "pharmacy"
            | "dispensing"
            | "triage"
            | "workflows"
            | "ward-round"
            | "observability"
            | "rum"
            | "notifications"
            | "audit-logs"
            | "facilities"
            | "capabilities"
            | "foundation"
    )
}

fn sanitize_method_label(value: &str) -> String {
    sanitize_label(value, "_unknown", 16, |byte| byte.is_ascii_uppercase())
}

fn sanitize_route_label(value: &str) -> String {
    sanitize_label(value, "_unknown", 160, |byte| {
        byte.is_ascii_alphanumeric()
            || matches!(byte, b'/' | b':' | b'{' | b'}' | b'_' | b'-' | b'.')
    })
}

fn sanitize_query_label(value: &str) -> String {
    sanitize_label(value, "_unknown", 96, |byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.')
    })
}

fn sanitize_rum_label(value: &str) -> String {
    sanitize_label(value, "_unknown", 64, |byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.')
    })
}

fn sanitize_metric_name(value: &str) -> String {
    sanitize_label(value, "hms_invalid_metric", 128, |byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b':')
    })
}

fn sanitize_label_name(value: &str) -> String {
    sanitize_label(value, "label", 64, |byte| {
        byte.is_ascii_alphanumeric() || byte == b'_'
    })
}

fn sanitize_generic_label_value(value: &str) -> String {
    sanitize_label(value, "_unknown", 96, |byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':' | b'/')
    })
}

fn sanitize_label(
    value: &str,
    fallback: &str,
    max_len: usize,
    allow: impl Fn(u8) -> bool,
) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return fallback.to_owned();
    }

    let mut output = String::with_capacity(trimmed.len().min(max_len));
    for byte in trimmed.bytes().take(max_len) {
        if allow(byte) {
            output.push(byte as char);
        } else {
            output.push('_');
        }
    }
    if output.is_empty() {
        fallback.to_owned()
    } else {
        output
    }
}

fn escape_label_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn nanos_to_seconds(nanos: u64) -> f64 {
    nanos as f64 / 1_000_000_000.0
}

fn atomic_buckets(count: usize) -> Vec<AtomicU64> {
    (0..count).map(|_| AtomicU64::new(0)).collect()
}

fn load_buckets(bucket_counts: &[AtomicU64]) -> Vec<u64> {
    bucket_counts
        .iter()
        .map(|bucket| bucket.load(Ordering::Relaxed))
        .collect()
}

fn observe_duration_histogram(
    duration: Duration,
    buckets: &[f64],
    bucket_counts: &[AtomicU64],
    duration_ns_sum: &AtomicU64,
    count: &AtomicU64,
) {
    let duration_seconds = duration.as_secs_f64();
    if let Some(index) = bucket_index(duration_seconds, buckets) {
        if let Some(bucket) = bucket_counts.get(index) {
            bucket.fetch_add(1, Ordering::Relaxed);
        }
    }
    let duration_nanos = u64::try_from(duration.as_nanos()).unwrap_or(u64::MAX);
    duration_ns_sum.fetch_add(duration_nanos, Ordering::Relaxed);
    count.fetch_add(1, Ordering::Relaxed);
}

fn observe_u64_histogram(
    value: u64,
    buckets: &[f64],
    bucket_counts: &[AtomicU64],
    sum: &AtomicU64,
    count: &AtomicU64,
) {
    if let Some(index) = bucket_index(value as f64, buckets) {
        if let Some(bucket) = bucket_counts.get(index) {
            bucket.fetch_add(1, Ordering::Relaxed);
        }
    }
    sum.fetch_add(value, Ordering::Relaxed);
    count.fetch_add(1, Ordering::Relaxed);
}

fn bucket_index(value: f64, buckets: &[f64]) -> Option<usize> {
    for (index, upper_bound) in buckets.iter().enumerate() {
        if value <= *upper_bound {
            return Some(index);
        }
    }
    None
}

fn append_histogram(
    body: &mut String,
    metric_name: &str,
    labels: &[(&str, &str)],
    buckets: &[f64],
    bucket_counts: &[u64],
    sum: f64,
    count: u64,
) {
    let mut cumulative = 0;
    for (index, upper_bound) in buckets.iter().enumerate() {
        cumulative += bucket_counts.get(index).copied().unwrap_or_default();
        let mut bucket_labels = labels.to_vec();
        let le = upper_bound.to_string();
        bucket_labels.push(("le", &le));
        body.push_str(&format!(
            "{}_bucket{} {}\n",
            metric_name,
            labels_to_prometheus(&bucket_labels),
            cumulative
        ));
    }
    let mut bucket_labels = labels.to_vec();
    bucket_labels.push(("le", "+Inf"));
    body.push_str(&format!(
        "{}_bucket{} {}\n",
        metric_name,
        labels_to_prometheus(&bucket_labels),
        count
    ));
    body.push_str(&format!(
        "{}_sum{} {:.9}\n",
        metric_name,
        labels_to_prometheus(labels),
        sum
    ));
    body.push_str(&format!(
        "{}_count{} {}\n",
        metric_name,
        labels_to_prometheus(labels),
        count
    ));
}

fn append_gauges(body: &mut String, metrics: &BTreeMap<GaugeMetricKey, f64>) {
    let mut emitted_types = BTreeSet::new();
    for (key, value) in metrics.iter() {
        if emitted_types.insert(key.name.clone()) {
            body.push_str(&format!("# TYPE {} gauge\n", key.name));
        }
        let labels = key
            .labels
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
            .collect::<Vec<_>>();
        body.push_str(&format!(
            "{}{} {:.9}\n",
            key.name,
            labels_to_prometheus(&labels),
            value
        ));
    }
}

fn append_route_duration_counter(
    body: &mut String,
    metric_name: &str,
    help: &str,
    metrics: &BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>,
) {
    body.push_str(&format!("# HELP {metric_name} {help}\n"));
    body.push_str(&format!("# TYPE {metric_name} counter\n"));
    for (key, value) in metrics.iter() {
        body.push_str(&format!(
            "{metric_name}{} {}\n",
            route_labels(key),
            value.count()
        ));
    }
}

fn append_route_duration_histogram(
    body: &mut String,
    metric_name: &str,
    help: &str,
    buckets: &[f64],
    metrics: &BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>,
) {
    body.push_str(&format!("# HELP {metric_name} {help}\n"));
    body.push_str(&format!("# TYPE {metric_name} histogram\n"));
    append_route_duration_histogram_samples(body, metric_name, buckets, metrics);
}

fn append_route_duration_histogram_samples(
    body: &mut String,
    metric_name: &str,
    buckets: &[f64],
    metrics: &BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>,
) {
    for (key, value) in metrics.iter() {
        let labels = route_label_pairs(key);
        append_histogram(
            body,
            metric_name,
            &labels,
            buckets,
            &value.duration_bucket_counts(),
            nanos_to_seconds(value.duration_ns_sum()),
            value.count(),
        );
    }
}

fn append_route_payload_histogram(
    body: &mut String,
    metrics: &BTreeMap<RouteMetricKey, Arc<RoutePayloadMetricValue>>,
) {
    body.push_str(
        "# HELP hms_api_response_payload_bytes HTTP response payload size in bytes by route pattern, status bucket, and safe facility.\n",
    );
    body.push_str("# TYPE hms_api_response_payload_bytes histogram\n");
    for (key, value) in metrics.iter() {
        let labels = route_label_pairs(key);
        append_histogram(
            body,
            "hms_api_response_payload_bytes",
            &labels,
            API_PAYLOAD_SIZE_BUCKETS,
            &value.bytes_bucket_counts(),
            value.bytes_sum() as f64,
            value.count(),
        );
    }
}

fn append_route_counter(
    body: &mut String,
    metric_name: &str,
    help: &str,
    metrics: &BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>,
) {
    body.push_str(&format!("# HELP {metric_name} {help}\n"));
    body.push_str(&format!("# TYPE {metric_name} counter\n"));
    for (key, value) in metrics.iter() {
        body.push_str(&format!(
            "{metric_name}{} {}\n",
            route_labels(key),
            value.count()
        ));
    }
}

fn append_browser_rum_metrics(
    body: &mut String,
    metrics: &BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>,
    api_metrics: &BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>,
    navigation_metrics: &BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>,
    app_shell_metrics: &BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>,
) {
    body.push_str(
        "# HELP hms_browser_rum_events_total Total browser RUM events accepted by the Rust API.\n",
    );
    body.push_str("# TYPE hms_browser_rum_events_total counter\n");
    for (key, value) in metrics.iter() {
        body.push_str(&format!(
            "hms_browser_rum_events_total{} {}\n",
            browser_rum_labels(key),
            value.count()
        ));
    }

    body.push_str(
        "# HELP hms_browser_rum_duration_seconds Browser RUM event duration in seconds.\n",
    );
    body.push_str("# TYPE hms_browser_rum_duration_seconds histogram\n");
    for (key, value) in metrics.iter() {
        append_histogram(
            body,
            "hms_browser_rum_duration_seconds",
            &browser_rum_label_pairs(key),
            RUM_DURATION_BUCKETS,
            &value.duration_bucket_counts(),
            nanos_to_seconds(value.duration_ns_sum()),
            value.count(),
        );
    }
    append_browser_metric_histogram(
        body,
        "hms_browser_api_request_duration_seconds",
        "Browser-observed API request duration in seconds.",
        api_metrics,
    );
    append_browser_metric_histogram(
        body,
        "hms_browser_navigation_timing_seconds",
        "Browser navigation timing duration in seconds.",
        navigation_metrics,
    );
    append_browser_metric_histogram(
        body,
        "hms_browser_app_shell_load_seconds",
        "Browser app shell load duration in seconds.",
        app_shell_metrics,
    );
}

fn browser_rum_labels(key: &BrowserRumMetricKey) -> String {
    labels_to_prometheus(&browser_rum_label_pairs(key))
}

fn append_browser_metric_histogram(
    body: &mut String,
    metric_name: &str,
    help: &str,
    metrics: &BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>,
) {
    body.push_str(&format!("# HELP {metric_name} {help}\n"));
    body.push_str(&format!("# TYPE {metric_name} histogram\n"));
    for (key, value) in metrics.iter() {
        append_histogram(
            body,
            metric_name,
            &browser_rum_label_pairs(key),
            RUM_DURATION_BUCKETS,
            &value.duration_bucket_counts(),
            nanos_to_seconds(value.duration_ns_sum()),
            value.count(),
        );
    }
}

fn route_labels(key: &RouteMetricKey) -> String {
    labels_to_prometheus(&route_label_pairs(key))
}

fn route_label_pairs(key: &RouteMetricKey) -> [(&str, &str); 3] {
    [
        ("route_pattern", key.route_pattern.as_str()),
        ("status_bucket", key.status_bucket.as_str()),
        ("facility_safe", key.facility_safe.as_str()),
    ]
}

fn browser_rum_label_pairs(key: &BrowserRumMetricKey) -> [(&str, &str); 3] {
    [
        ("route_pattern", key.route_pattern.as_str()),
        ("status_bucket", key.status_bucket.as_str()),
        ("facility_safe", key.facility_safe.as_str()),
    ]
}

fn labels_to_prometheus(labels: &[(&str, &str)]) -> String {
    if labels.is_empty() {
        return String::new();
    }
    let labels = labels
        .iter()
        .map(|(name, value)| format!("{name}=\"{}\"", escape_label_value(value)))
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{labels}}}")
}

fn route_duration_snapshots(
    metrics: &BTreeMap<RouteMetricKey, Arc<RouteDurationMetricValue>>,
    buckets: &[f64],
) -> Vec<RouteDurationSnapshot> {
    let mut snapshots = metrics
        .iter()
        .map(|(key, value)| {
            let count = value.count();
            let bucket_counts = value.duration_bucket_counts();
            RouteDurationSnapshot {
                route_pattern: snapshot_route_pattern(&key.route_pattern),
                status_bucket: key.status_bucket.clone(),
                facility_safe: sanitize_facility_safe(&key.facility_safe),
                count,
                avg_ms: average_ms(value.duration_ns_sum(), count),
                p50_ms: duration_percentile_ms(&bucket_counts, buckets, count, 0.50),
                p95_ms: duration_percentile_ms(&bucket_counts, buckets, count, 0.95),
                p99_ms: duration_percentile_ms(&bucket_counts, buckets, count, 0.99),
            }
        })
        .collect::<Vec<_>>();
    snapshots.sort_by(|left, right| {
        right.count.cmp(&left.count).then_with(|| {
            left.route_pattern
                .cmp(&right.route_pattern)
                .then(left.status_bucket.cmp(&right.status_bucket))
        })
    });
    snapshots
}

fn browser_duration_snapshots(
    metrics: &BTreeMap<BrowserRumMetricKey, Arc<BrowserRumMetricValue>>,
) -> Vec<RouteDurationSnapshot> {
    let mut snapshots = metrics
        .iter()
        .map(|(key, value)| {
            let count = value.count();
            let bucket_counts = value.duration_bucket_counts();
            RouteDurationSnapshot {
                route_pattern: snapshot_route_pattern(&key.route_pattern),
                status_bucket: key.status_bucket.clone(),
                facility_safe: sanitize_facility_safe(&key.facility_safe),
                count,
                avg_ms: average_ms(value.duration_ns_sum(), count),
                p50_ms: duration_percentile_ms(&bucket_counts, RUM_DURATION_BUCKETS, count, 0.50),
                p95_ms: duration_percentile_ms(&bucket_counts, RUM_DURATION_BUCKETS, count, 0.95),
                p99_ms: duration_percentile_ms(&bucket_counts, RUM_DURATION_BUCKETS, count, 0.99),
            }
        })
        .collect::<Vec<_>>();
    snapshots.sort_by(|left, right| {
        right.count.cmp(&left.count).then_with(|| {
            left.route_pattern
                .cmp(&right.route_pattern)
                .then(left.status_bucket.cmp(&right.status_bucket))
        })
    });
    snapshots
}

fn route_payload_snapshots(
    metrics: &BTreeMap<RouteMetricKey, Arc<RoutePayloadMetricValue>>,
) -> Vec<RoutePayloadSnapshot> {
    let mut snapshots = metrics
        .iter()
        .map(|(key, value)| {
            let count = value.count();
            let bucket_counts = value.bytes_bucket_counts();
            RoutePayloadSnapshot {
                route_pattern: snapshot_route_pattern(&key.route_pattern),
                status_bucket: key.status_bucket.clone(),
                facility_safe: sanitize_facility_safe(&key.facility_safe),
                count,
                avg_bytes: (count > 0).then(|| value.bytes_sum() as f64 / count as f64),
                p50_bytes: bytes_percentile(&bucket_counts, count, 0.50),
                p95_bytes: bytes_percentile(&bucket_counts, count, 0.95),
                p99_bytes: bytes_percentile(&bucket_counts, count, 0.99),
            }
        })
        .collect::<Vec<_>>();
    snapshots.sort_by(|left, right| {
        right.count.cmp(&left.count).then_with(|| {
            left.route_pattern
                .cmp(&right.route_pattern)
                .then(left.status_bucket.cmp(&right.status_bucket))
        })
    });
    snapshots
}

fn route_counter_snapshots(
    metrics: &BTreeMap<RouteMetricKey, Arc<RouteCounterMetricValue>>,
) -> Vec<RouteCounterSnapshot> {
    let mut snapshots = metrics
        .iter()
        .map(|(key, value)| RouteCounterSnapshot {
            route_pattern: snapshot_route_pattern(&key.route_pattern),
            status_bucket: key.status_bucket.clone(),
            facility_safe: sanitize_facility_safe(&key.facility_safe),
            count: value.count(),
        })
        .collect::<Vec<_>>();
    snapshots.sort_by(|left, right| {
        right.count.cmp(&left.count).then_with(|| {
            left.route_pattern
                .cmp(&right.route_pattern)
                .then(left.status_bucket.cmp(&right.status_bucket))
        })
    });
    snapshots
}

fn db_query_fingerprint_snapshots(
    metrics: &BTreeMap<DbQueryMetricKey, Arc<DbQueryMetricValue>>,
) -> Vec<DbQueryFingerprintSnapshot> {
    let mut snapshots = metrics
        .iter()
        .map(|(key, value)| {
            let count = value.count();
            let total_ms = nanos_to_seconds(value.duration_ns_sum()) * 1000.0;
            let bucket_counts = value.duration_bucket_counts();
            DbQueryFingerprintSnapshot {
                fingerprint: snapshot_query_fingerprint(&key.query),
                count,
                total_ms,
                avg_ms: average_ms(value.duration_ns_sum(), count),
                p95_ms: duration_percentile_ms(
                    &bucket_counts,
                    DB_QUERY_DURATION_BUCKETS,
                    count,
                    0.95,
                ),
                p99_ms: duration_percentile_ms(
                    &bucket_counts,
                    DB_QUERY_DURATION_BUCKETS,
                    count,
                    0.99,
                ),
            }
        })
        .collect::<Vec<_>>();
    snapshots.sort_by(|left, right| {
        right
            .total_ms
            .partial_cmp(&left.total_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.fingerprint.cmp(&right.fingerprint))
    });
    snapshots
}

fn average_ms(duration_ns_sum: u64, count: u64) -> Option<f64> {
    (count > 0).then(|| nanos_to_seconds(duration_ns_sum) * 1000.0 / count as f64)
}

fn duration_percentile_ms(
    bucket_counts: &[u64],
    buckets: &[f64],
    count: u64,
    quantile: f64,
) -> Option<f64> {
    histogram_percentile_upper_bound(bucket_counts, buckets, count, quantile)
        .map(|seconds| seconds * 1000.0)
}

fn bytes_percentile(bucket_counts: &[u64], count: u64, quantile: f64) -> Option<u64> {
    histogram_percentile_upper_bound(bucket_counts, API_PAYLOAD_SIZE_BUCKETS, count, quantile)
        .map(|bytes| bytes as u64)
}

fn histogram_percentile_upper_bound(
    bucket_counts: &[u64],
    buckets: &[f64],
    count: u64,
    quantile: f64,
) -> Option<f64> {
    if count == 0 {
        return None;
    }

    let target = ((count as f64) * quantile).ceil().max(1.0) as u64;
    let mut cumulative = 0_u64;
    for (index, upper_bound) in buckets.iter().enumerate() {
        cumulative += bucket_counts.get(index).copied().unwrap_or_default();
        if cumulative >= target {
            return Some(*upper_bound);
        }
    }
    None
}

fn snapshot_route_pattern(value: &str) -> String {
    normalize_browser_route_pattern(value)
}

fn snapshot_query_fingerprint(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let raw_sql_marker = lower.contains("select")
        || lower.contains("insert")
        || lower.contains("update")
        || lower.contains("delete")
        || lower.contains(" where ")
        || lower.contains(" from ")
        || lower.contains(" join ")
        || lower.contains("patient_code")
        || lower.contains("mrn");
    let unsafe_punctuation = value.bytes().any(|byte| {
        byte.is_ascii_whitespace()
            || matches!(
                byte,
                b'\'' | b'"' | b';' | b',' | b'(' | b')' | b'*' | b'=' | b'<' | b'>'
            )
    });
    if raw_sql_marker || unsafe_punctuation {
        "_redacted_query_fingerprint".to_owned()
    } else {
        sanitize_query_label(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::thread;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn prometheus_metrics_exports_core_series_before_traffic() {
        let _guard = TEST_LOCK.lock().expect("test lock is available");
        reset_metrics_for_tests();

        let metrics = prometheus_metrics();

        assert!(metrics.contains(
            "hms_api_http_requests_total{method=\"NONE\",route=\"_none\",status=\"0\"} 0"
        ));
        assert!(metrics.contains("hms_api_http_request_duration_seconds_bucket"));
        assert!(metrics.contains(
            "hms_api_http_db_query_count_sum{method=\"NONE\",route=\"_none\",status=\"0\"} 0"
        ));
        assert!(
            metrics.contains("hms_db_query_duration_seconds_bucket{query=\"_none\",le=\"+Inf\"} 0")
        );
    }

    #[test]
    fn metric_labels_are_sanitized_before_export() {
        let _guard = TEST_LOCK.lock().expect("test lock is available");
        reset_metrics_for_tests();
        record_http_request(
            "GET\nBAD",
            "/api/v2/patients/{id}?raw=value",
            200,
            Duration::from_millis(25),
            3,
        );
        record_db_query("inventory.list_dispenses\nraw", Duration::from_millis(5));

        let metrics = prometheus_metrics();

        assert!(metrics.contains("method=\"GET_BAD\""));
        assert!(metrics.contains("route=\"/api/v2/patients/{id}_raw_value\""));
        assert!(metrics.contains("query=\"inventory.list_dispenses_raw\""));
        assert!(metrics.contains("hms_api_http_request_duration_seconds_bucket"));
        assert!(!metrics.contains("?"));
        assert!(!metrics.contains("\nBAD"));
    }

    #[test]
    fn browser_rum_metrics_are_sanitized_and_histogrammed() {
        let _guard = TEST_LOCK.lock().expect("test lock is available");
        reset_metrics_for_tests();
        set_gauge("hms_rum_enabled", 1.0, &[("environment", "staging")]);
        record_browser_rum_event(
            "api",
            "duration",
            "/patients/Ama Mensah/chronicle",
            "200",
            "main",
            Duration::from_millis(125),
        );

        let metrics = prometheus_metrics();

        assert!(metrics.contains("hms_rum_enabled{environment=\"staging\"} 1.000000000"));
        assert!(metrics.contains("hms_browser_rum_events_total"));
        assert!(metrics.contains("hms_browser_rum_duration_seconds_bucket"));
        assert!(metrics.contains("hms_browser_api_request_duration_seconds_bucket"));
        assert!(metrics.contains("route_pattern=\"/patients/:id/chronicle\""));
        assert!(metrics.contains("status_bucket=\"2xx\""));
        assert!(metrics.contains("facility_safe=\"MAIN\""));
        assert!(!metrics.contains("type=\"api\""));
        assert!(!metrics.contains("Ama"));
        assert!(!metrics.contains("Ama Mensah"));
    }

    #[test]
    fn route_budget_metrics_use_safe_labels_and_payload_histograms() {
        let _guard = TEST_LOCK.lock().expect("test lock is available");
        reset_metrics_for_tests();
        let snapshot = RequestMetricsSnapshot {
            db_query_count: 2,
            db_query_durations: vec![Duration::from_millis(5), Duration::from_millis(300)],
            db_pool_wait_durations: vec![Duration::from_millis(3)],
        };

        record_http_route_metrics(
            "/api/v2/patients/:id/chronicle",
            "200",
            "main",
            Duration::from_millis(125),
            Some(2_048),
            &snapshot,
        );

        let metrics = prometheus_metrics();

        assert!(metrics.contains("hms_api_route_requests_total{route_pattern=\"/api/v2/patients/:id/chronicle\",status_bucket=\"2xx\",facility_safe=\"MAIN\"} 1"));
        assert!(metrics.contains("hms_chronicle_read_seconds_bucket{route_pattern=\"/api/v2/patients/:id/chronicle\",status_bucket=\"2xx\",facility_safe=\"MAIN\""));
        assert!(metrics.contains("hms_api_response_payload_bytes_count{route_pattern=\"/api/v2/patients/:id/chronicle\",status_bucket=\"2xx\",facility_safe=\"MAIN\"} 1"));
        assert!(metrics.contains("hms_db_query_duration_seconds_count{route_pattern=\"/api/v2/patients/:id/chronicle\",status_bucket=\"2xx\",facility_safe=\"MAIN\"} 2"));
        assert!(metrics.contains("hms_db_slow_query_total{route_pattern=\"/api/v2/patients/:id/chronicle\",status_bucket=\"2xx\",facility_safe=\"MAIN\"} 1"));
        assert!(metrics.contains("hms_db_pool_wait_seconds_count{route_pattern=\"/api/v2/patients/:id/chronicle\",status_bucket=\"2xx\",facility_safe=\"MAIN\"} 1"));
    }

    #[test]
    fn metrics_snapshot_redacts_unsafe_routes_and_query_fingerprints() {
        let _guard = TEST_LOCK.lock().expect("test lock is available");
        reset_metrics_for_tests();
        let patient_id = "018f4d5f-8469-7ae0-8b42-7b2a3f790c91";
        let request_metrics = RequestMetricsSnapshot {
            db_query_count: 1,
            db_query_durations: vec![Duration::from_millis(300)],
            db_pool_wait_durations: vec![Duration::from_millis(2)],
        };

        record_http_route_metrics(
            &format!("/api/v2/patients/{patient_id}/chronicle"),
            "200",
            "main",
            Duration::from_millis(125),
            Some(8_192),
            &request_metrics,
        );
        record_db_query(
            "SELECT * FROM patients WHERE patient_code = 'P-0000000001'",
            Duration::from_millis(300),
        );
        record_browser_rum_event(
            "api",
            "duration",
            "/patients/Ama Mensah/chronicle",
            "200",
            "main",
            Duration::from_millis(125),
        );

        let snapshot = metrics_snapshot();
        let debug = format!("{snapshot:?}");

        assert!(snapshot
            .api_payloads
            .iter()
            .any(|route| route.route_pattern == "/api/v2/patients/:id/chronicle"));
        assert!(snapshot
            .db_query_fingerprints
            .iter()
            .any(|query| query.fingerprint == "_redacted_query_fingerprint"));
        assert!(snapshot
            .browser_rum
            .all
            .iter()
            .any(|route| route.route_pattern == "/patients/:id/chronicle"));
        assert!(!debug.contains(patient_id));
        assert!(!debug.contains("Ama"));
        assert!(!debug.contains("Mensah"));
        assert!(!debug.contains("P-0000000001"));
        assert!(!debug.contains("SELECT"));
    }

    #[tokio::test]
    async fn request_query_counter_counts_observed_queries() {
        let (_, query_count) = with_request_query_counter(async {
            observe_db_query("test.one", async { Ok::<_, ()>(()) })
                .await
                .expect("query succeeds");
            observe_db_query("test.two", async { Ok::<_, ()>(()) })
                .await
                .expect("query succeeds");
        })
        .await;

        assert_eq!(query_count, 2);
    }

    #[test]
    fn metrics_recording_preserves_counts_under_concurrency() {
        let _guard = TEST_LOCK.lock().expect("test lock is available");
        reset_metrics_for_tests();

        let workers = 8;
        let records_per_worker = 250;
        thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(|| {
                    for _ in 0..records_per_worker {
                        record_http_request(
                            "GET",
                            "/api/v2/auth/me",
                            200,
                            Duration::from_millis(2),
                            1,
                        );
                        record_db_query("auth.request_context_facts", Duration::from_millis(2));
                    }
                });
            }
        });

        let expected = workers * records_per_worker;
        let metrics = prometheus_metrics();

        assert!(metrics.contains(&format!(
            "hms_api_http_requests_total{{method=\"GET\",route=\"/api/v2/auth/me\",status=\"200\"}} {expected}"
        )));
        assert!(metrics.contains(&format!(
            "hms_api_http_db_query_count_sum{{method=\"GET\",route=\"/api/v2/auth/me\",status=\"200\"}} {expected}"
        )));
        assert!(metrics.contains(&format!(
            "hms_db_query_duration_seconds_count{{query=\"auth.request_context_facts\"}} {expected}"
        )));
    }
}
