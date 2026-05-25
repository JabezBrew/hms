use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::routing::get;
use axum::Router;
use hms_api::middleware::telemetry;
use tower::util::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn telemetry_uses_matched_route_patterns_not_raw_paths() {
    let patient_id = Uuid::new_v4();
    let app = Router::new()
        .route(
            "/api/v2/telemetry-test/:id",
            get(|| async { (StatusCode::OK, "ok") }),
        )
        .route_layer(axum::middleware::from_fn(telemetry::layer));

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/telemetry-test/{patient_id}"))
                .header("X-Facility-Code", "MAIN")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let metrics = hms_observability::prometheus_metrics();
    assert!(
        metrics.contains("route=\"/api/v2/telemetry-test/:id\""),
        "{metrics}"
    );
    assert!(
        metrics.contains("hms_api_route_requests_total{route_pattern=\"/api/v2/telemetry-test/:id\",status_bucket=\"2xx\",facility_safe=\"MAIN\"} 1"),
        "{metrics}"
    );
    assert!(
        metrics.contains("hms_api_response_payload_bytes_count{route_pattern=\"/api/v2/telemetry-test/:id\",status_bucket=\"2xx\",facility_safe=\"MAIN\"} 1"),
        "{metrics}"
    );
    assert!(!metrics.contains(&patient_id.to_string()));
}
