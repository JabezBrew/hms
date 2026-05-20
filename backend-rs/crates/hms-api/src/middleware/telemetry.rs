use std::time::Instant;

use axum::body::Body;
use axum::extract::{MatchedPath, Request};
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
    let started_at = Instant::now();

    let (response, db_query_count) =
        hms_observability::with_request_query_counter(next.run(request)).await;
    let status = response.status().as_u16();
    let elapsed = started_at.elapsed();

    hms_observability::record_http_request(
        &method,
        &route_pattern,
        status,
        elapsed,
        db_query_count,
    );
    info!(
        request_id = %request_id,
        method = %method,
        route = %route_pattern,
        status = status,
        duration_ms = elapsed.as_millis(),
        db_query_count = db_query_count,
        "request completed"
    );

    response
}
