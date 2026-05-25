use std::time::Instant;

use axum::body::{Body, HttpBody};
use axum::extract::{MatchedPath, Request};
use axum::http::header::CONTENT_LENGTH;
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::Response;
use tracing::info;

use crate::middleware::request_id::{current_request_id, RequestId};

pub async fn layer(
    matched_path: Option<MatchedPath>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let method = request.method().as_str().to_owned();
    let route_pattern = matched_path
        .as_ref()
        .map(|path| path.as_str().to_owned())
        .unwrap_or_else(|| "_unmatched".to_owned());
    let request_id = request
        .extensions()
        .get::<RequestId>()
        .map(|request_id| request_id.0.clone())
        .unwrap_or_else(current_request_id);
    let facility_safe = facility_safe_from_headers(request.headers());
    let started_at = Instant::now();

    let (response, request_metrics) =
        hms_observability::with_request_metrics_recorder(next.run(request)).await;
    let status = response.status().as_u16();
    let status_bucket = hms_observability::status_bucket_from_code(status);
    let payload_bytes = response_payload_bytes(&response);
    let elapsed = started_at.elapsed();

    hms_observability::record_http_request(
        &method,
        &route_pattern,
        status,
        elapsed,
        request_metrics.db_query_count,
    );
    hms_observability::record_http_route_metrics(
        &route_pattern,
        status_bucket,
        &facility_safe,
        elapsed,
        payload_bytes,
        &request_metrics,
    );
    info!(
        request_id = %request_id,
        method = %method,
        route = %route_pattern,
        status = status,
        duration_ms = elapsed.as_millis(),
        db_query_count = request_metrics.db_query_count,
        "request completed"
    );

    response
}

fn facility_safe_from_headers(headers: &HeaderMap) -> String {
    headers
        .get("x-facility-code")
        .and_then(|value| value.to_str().ok())
        .map(hms_observability::sanitize_facility_safe)
        .unwrap_or_else(|| "_unknown".to_owned())
}

fn response_payload_bytes(response: &Response) -> Option<u64> {
    response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| response.body().size_hint().exact())
}
