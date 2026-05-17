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
            "/api/v2/patients/:id",
            get(|| async { StatusCode::NO_CONTENT }),
        )
        .route_layer(axum::middleware::from_fn(telemetry::layer));

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/patients/{patient_id}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("request succeeds");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let metrics = hms_observability::prometheus_metrics();
    assert!(
        metrics.contains("route=\"/api/v2/patients/:id\""),
        "{metrics}"
    );
    assert!(!metrics.contains(&patient_id.to_string()));
}
