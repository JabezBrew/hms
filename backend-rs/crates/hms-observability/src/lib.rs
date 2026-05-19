use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tracing_subscriber::EnvFilter;

tokio::task_local! {
    static REQUEST_QUERY_COUNT: Arc<AtomicU64>;
}

const HTTP_DURATION_BUCKETS: &[f64] = &[0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0, 2.5, 5.0];
const DB_QUERY_DURATION_BUCKETS: &[f64] = &[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0];
const RUM_DURATION_BUCKETS: &[f64] = &[0.05, 0.1, 0.2, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0];

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct HttpRequestMetricKey {
    method: String,
    route: String,
    status: u16,
}

#[derive(Clone, Debug, Default)]
struct HttpRequestMetricValue {
    count: u64,
    duration_ns_sum: u128,
    duration_bucket_counts: Vec<u64>,
    db_query_count_sum: u64,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct DbQueryMetricKey {
    query: String,
}

#[derive(Clone, Debug, Default)]
struct DbQueryMetricValue {
    count: u64,
    duration_ns_sum: u128,
    duration_bucket_counts: Vec<u64>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct GaugeMetricKey {
    name: String,
    labels: Vec<(String, String)>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct BrowserRumMetricKey {
    event_type: String,
    name: String,
    route: String,
    method: String,
    status: String,
}

#[derive(Clone, Debug, Default)]
struct BrowserRumMetricValue {
    count: u64,
    duration_ns_sum: u128,
    duration_bucket_counts: Vec<u64>,
}

static HTTP_REQUEST_METRICS: OnceLock<
    Mutex<BTreeMap<HttpRequestMetricKey, HttpRequestMetricValue>>,
> = OnceLock::new();
static DB_QUERY_METRICS: OnceLock<Mutex<BTreeMap<DbQueryMetricKey, DbQueryMetricValue>>> =
    OnceLock::new();
static GAUGE_METRICS: OnceLock<Mutex<BTreeMap<GaugeMetricKey, f64>>> = OnceLock::new();
static BROWSER_RUM_METRICS: OnceLock<Mutex<BTreeMap<BrowserRumMetricKey, BrowserRumMetricValue>>> =
    OnceLock::new();

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
    let counter = Arc::new(AtomicU64::new(0));
    let output = REQUEST_QUERY_COUNT
        .scope(Arc::clone(&counter), future)
        .await;
    (output, counter.load(Ordering::Relaxed))
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
    let _ = REQUEST_QUERY_COUNT.try_with(|counter| {
        counter.fetch_add(1, Ordering::Relaxed);
    });

    let mut metrics = db_query_metrics().lock().expect("db metrics lock poisoned");
    let entry = metrics
        .entry(DbQueryMetricKey {
            query: sanitize_query_label(query_name),
        })
        .or_default();
    entry.count += 1;
    entry.duration_ns_sum += duration.as_nanos();
    observe_bucket(
        duration.as_secs_f64(),
        DB_QUERY_DURATION_BUCKETS,
        &mut entry.duration_bucket_counts,
    );
}

pub fn record_http_request(
    method: &str,
    route_pattern: &str,
    status: u16,
    duration: Duration,
    db_query_count: u64,
) {
    let mut metrics = http_request_metrics()
        .lock()
        .expect("http metrics lock poisoned");
    let entry = metrics
        .entry(HttpRequestMetricKey {
            method: sanitize_method_label(method),
            route: sanitize_route_label(route_pattern),
            status,
        })
        .or_default();
    entry.count += 1;
    entry.duration_ns_sum += duration.as_nanos();
    observe_bucket(
        duration.as_secs_f64(),
        HTTP_DURATION_BUCKETS,
        &mut entry.duration_bucket_counts,
    );
    entry.db_query_count_sum += db_query_count;
}

pub fn prometheus_metrics() -> String {
    let http_metrics = http_request_metrics()
        .lock()
        .expect("http metrics lock poisoned");
    let db_metrics = db_query_metrics().lock().expect("db metrics lock poisoned");
    let gauge_metrics = gauge_metrics().lock().expect("gauge metrics lock poisoned");
    let browser_rum_metrics = browser_rum_metrics()
        .lock()
        .expect("browser RUM metrics lock poisoned");
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
                value.count
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
                &value.duration_bucket_counts,
                nanos_to_seconds(value.duration_ns_sum),
                value.count,
            );
        }
    }

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
                value.db_query_count_sum
            ));
        }
    }

    body.push_str(
        "# HELP hms_db_query_duration_seconds Database query duration in seconds by stable query name.\n",
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
                &value.duration_bucket_counts,
                nanos_to_seconds(value.duration_ns_sum),
                value.count,
            );
        }
    }

    append_gauges(&mut body, &gauge_metrics);
    append_browser_rum_metrics(&mut body, &browser_rum_metrics);

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
    route: &str,
    method: Option<&str>,
    status: Option<&str>,
    duration: Duration,
) {
    let mut metrics = browser_rum_metrics()
        .lock()
        .expect("browser RUM metrics lock poisoned");
    let entry = metrics
        .entry(BrowserRumMetricKey {
            event_type: sanitize_rum_label(event_type),
            name: sanitize_rum_label(name),
            route: sanitize_route_label(route),
            method: method
                .map(sanitize_method_label)
                .unwrap_or_else(|| "NA".to_owned()),
            status: status
                .map(sanitize_rum_label)
                .unwrap_or_else(|| "unknown".to_owned()),
        })
        .or_default();
    entry.count += 1;
    entry.duration_ns_sum += duration.as_nanos();
    observe_bucket(
        duration.as_secs_f64(),
        RUM_DURATION_BUCKETS,
        &mut entry.duration_bucket_counts,
    );
}

#[cfg(test)]
pub fn reset_metrics_for_tests() {
    http_request_metrics()
        .lock()
        .expect("http metrics lock poisoned")
        .clear();
    db_query_metrics()
        .lock()
        .expect("db metrics lock poisoned")
        .clear();
    gauge_metrics()
        .lock()
        .expect("gauge metrics lock poisoned")
        .clear();
    browser_rum_metrics()
        .lock()
        .expect("browser RUM metrics lock poisoned")
        .clear();
}

fn http_request_metrics() -> &'static Mutex<BTreeMap<HttpRequestMetricKey, HttpRequestMetricValue>>
{
    HTTP_REQUEST_METRICS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn db_query_metrics() -> &'static Mutex<BTreeMap<DbQueryMetricKey, DbQueryMetricValue>> {
    DB_QUERY_METRICS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn gauge_metrics() -> &'static Mutex<BTreeMap<GaugeMetricKey, f64>> {
    GAUGE_METRICS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn browser_rum_metrics() -> &'static Mutex<BTreeMap<BrowserRumMetricKey, BrowserRumMetricValue>> {
    BROWSER_RUM_METRICS.get_or_init(|| Mutex::new(BTreeMap::new()))
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

fn nanos_to_seconds(nanos: u128) -> f64 {
    nanos as f64 / 1_000_000_000.0
}

fn observe_bucket(value: f64, buckets: &[f64], bucket_counts: &mut Vec<u64>) {
    if bucket_counts.len() < buckets.len() {
        bucket_counts.resize(buckets.len(), 0);
    }
    for (index, upper_bound) in buckets.iter().enumerate() {
        if value <= *upper_bound {
            bucket_counts[index] += 1;
            break;
        }
    }
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

fn append_browser_rum_metrics(
    body: &mut String,
    metrics: &BTreeMap<BrowserRumMetricKey, BrowserRumMetricValue>,
) {
    body.push_str(
        "# HELP hms_browser_rum_events_total Total browser RUM events accepted by the Rust API.\n",
    );
    body.push_str("# TYPE hms_browser_rum_events_total counter\n");
    for (key, value) in metrics.iter() {
        body.push_str(&format!(
            "hms_browser_rum_events_total{} {}\n",
            browser_rum_labels(key),
            value.count
        ));
    }

    body.push_str(
        "# HELP hms_browser_rum_duration_seconds Browser RUM event duration in seconds.\n",
    );
    body.push_str("# TYPE hms_browser_rum_duration_seconds histogram\n");
    for (key, value) in metrics.iter() {
        let labels = [
            ("type", key.event_type.as_str()),
            ("name", key.name.as_str()),
            ("route", key.route.as_str()),
            ("method", key.method.as_str()),
            ("status", key.status.as_str()),
        ];
        append_histogram(
            body,
            "hms_browser_rum_duration_seconds",
            &labels,
            RUM_DURATION_BUCKETS,
            &value.duration_bucket_counts,
            nanos_to_seconds(value.duration_ns_sum),
            value.count,
        );
    }
}

fn browser_rum_labels(key: &BrowserRumMetricKey) -> String {
    labels_to_prometheus(&[
        ("type", key.event_type.as_str()),
        ("name", key.name.as_str()),
        ("route", key.route.as_str()),
        ("method", key.method.as_str()),
        ("status", key.status.as_str()),
    ])
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

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
            "api_request",
            "/patients/Ama Mensah",
            Some("POST"),
            Some("200"),
            Duration::from_millis(125),
        );

        let metrics = prometheus_metrics();

        assert!(metrics.contains("hms_rum_enabled{environment=\"staging\"} 1.000000000"));
        assert!(metrics.contains("hms_browser_rum_events_total"));
        assert!(metrics.contains("hms_browser_rum_duration_seconds_bucket"));
        assert!(metrics.contains("route=\"/patients/Ama_Mensah\""));
        assert!(!metrics.contains("Ama Mensah"));
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
}
