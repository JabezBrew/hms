use std::collections::BTreeMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tracing_subscriber::EnvFilter;

tokio::task_local! {
    static REQUEST_QUERY_COUNT: Arc<AtomicU64>;
}

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
}

static HTTP_REQUEST_METRICS: OnceLock<
    Mutex<BTreeMap<HttpRequestMetricKey, HttpRequestMetricValue>>,
> = OnceLock::new();
static DB_QUERY_METRICS: OnceLock<Mutex<BTreeMap<DbQueryMetricKey, DbQueryMetricValue>>> =
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
    entry.db_query_count_sum += db_query_count;
}

pub fn prometheus_metrics() -> String {
    let http_metrics = http_request_metrics()
        .lock()
        .expect("http metrics lock poisoned");
    let db_metrics = db_query_metrics().lock().expect("db metrics lock poisoned");
    let mut body = String::new();

    body.push_str(
        "# HELP hms_api_http_requests_total Total HTTP requests by method, route pattern, and status.\n",
    );
    body.push_str("# TYPE hms_api_http_requests_total counter\n");
    for (key, value) in http_metrics.iter() {
        body.push_str(&format!(
            "hms_api_http_requests_total{{method=\"{}\",route=\"{}\",status=\"{}\"}} {}\n",
            escape_label_value(&key.method),
            escape_label_value(&key.route),
            key.status,
            value.count
        ));
    }

    body.push_str(
        "# HELP hms_api_http_request_duration_seconds_sum Total HTTP request duration in seconds by method, route pattern, and status.\n",
    );
    body.push_str("# TYPE hms_api_http_request_duration_seconds_sum counter\n");
    for (key, value) in http_metrics.iter() {
        body.push_str(&format!(
            "hms_api_http_request_duration_seconds_sum{{method=\"{}\",route=\"{}\",status=\"{}\"}} {:.9}\n",
            escape_label_value(&key.method),
            escape_label_value(&key.route),
            key.status,
            nanos_to_seconds(value.duration_ns_sum)
        ));
    }

    body.push_str(
        "# HELP hms_api_http_request_duration_seconds_count HTTP request duration sample count by method, route pattern, and status.\n",
    );
    body.push_str("# TYPE hms_api_http_request_duration_seconds_count counter\n");
    for (key, value) in http_metrics.iter() {
        body.push_str(&format!(
            "hms_api_http_request_duration_seconds_count{{method=\"{}\",route=\"{}\",status=\"{}\"}} {}\n",
            escape_label_value(&key.method),
            escape_label_value(&key.route),
            key.status,
            value.count
        ));
    }

    body.push_str(
        "# HELP hms_api_http_db_query_count_sum Total database queries observed inside HTTP requests by method, route pattern, and status.\n",
    );
    body.push_str("# TYPE hms_api_http_db_query_count_sum counter\n");
    for (key, value) in http_metrics.iter() {
        body.push_str(&format!(
            "hms_api_http_db_query_count_sum{{method=\"{}\",route=\"{}\",status=\"{}\"}} {}\n",
            escape_label_value(&key.method),
            escape_label_value(&key.route),
            key.status,
            value.db_query_count_sum
        ));
    }

    body.push_str(
        "# HELP hms_db_query_duration_seconds_sum Total database query duration in seconds by stable query name.\n",
    );
    body.push_str("# TYPE hms_db_query_duration_seconds_sum counter\n");
    for (key, value) in db_metrics.iter() {
        body.push_str(&format!(
            "hms_db_query_duration_seconds_sum{{query=\"{}\"}} {:.9}\n",
            escape_label_value(&key.query),
            nanos_to_seconds(value.duration_ns_sum)
        ));
    }

    body.push_str(
        "# HELP hms_db_query_duration_seconds_count Database query execution count by stable query name.\n",
    );
    body.push_str("# TYPE hms_db_query_duration_seconds_count counter\n");
    for (key, value) in db_metrics.iter() {
        body.push_str(&format!(
            "hms_db_query_duration_seconds_count{{query=\"{}\"}} {}\n",
            escape_label_value(&key.query),
            value.count
        ));
    }

    body
}

fn http_request_metrics() -> &'static Mutex<BTreeMap<HttpRequestMetricKey, HttpRequestMetricValue>>
{
    HTTP_REQUEST_METRICS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn db_query_metrics() -> &'static Mutex<BTreeMap<DbQueryMetricKey, DbQueryMetricValue>> {
    DB_QUERY_METRICS.get_or_init(|| Mutex::new(BTreeMap::new()))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metric_labels_are_sanitized_before_export() {
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
        assert!(!metrics.contains("?"));
        assert!(!metrics.contains("\nBAD"));
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
