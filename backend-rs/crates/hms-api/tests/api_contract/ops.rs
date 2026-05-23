use super::*;
use std::time::Duration as StdDuration;

const OPS_ENDPOINTS: [&str; 4] = [
    "/api/v2/ops/overview",
    "/api/v2/ops/performance",
    "/api/v2/ops/database",
    "/api/v2/ops/frontend",
];

#[tokio::test]
async fn ops_endpoints_require_ops_access_and_return_phi_safe_snapshots() {
    let app = app().await;

    for endpoint in OPS_ENDPOINTS {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(endpoint)
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("ops request succeeds");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{endpoint}");
    }

    let limited = Actor::login(&app, "limited@hms.local").await;
    for endpoint in OPS_ENDPOINTS {
        let response = api_get(app.clone(), &limited, endpoint).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{endpoint}");
    }

    let owner = Actor::login(&app, "owner@hms.local").await;
    let patient_id = Uuid::new_v4();

    hms_observability::record_db_query(
        "SELECT * FROM patients WHERE patient_code = 'P-0000000001'",
        StdDuration::from_millis(320),
    );
    hms_observability::record_browser_rum_event(
        "api",
        "duration",
        &format!("/patients/Ama-Mensah-{patient_id}/chronicle?body=free-text"),
        "200",
        "hms",
        StdDuration::from_millis(125),
    );

    for endpoint in OPS_ENDPOINTS {
        let response = api_get(app.clone(), &owner, endpoint).await;
        assert_eq!(response.status(), StatusCode::OK, "{endpoint}");
        let body = text_body(response).await;

        assert!(body.contains("in_process_metrics"), "{body}");
        assert!(!body.contains(&patient_id.to_string()), "{body}");
        assert!(!body.contains("Ama"), "{body}");
        assert!(!body.contains("Mensah"), "{body}");
        assert!(!body.contains("P-0000000001"), "{body}");
        assert!(!body.contains("SELECT"), "{body}");
        assert!(!body.contains("FROM patients"), "{body}");
        assert!(!body.contains("free-text"), "{body}");
        assert!(!body.contains("owner@hms.local"), "{body}");
        assert!(!body.contains("ChangeMe123"), "{body}");
        assert!(!body.contains("PromQL"), "{body}");
    }

    let database = text_body(api_get(app.clone(), &owner, "/api/v2/ops/database").await).await;
    assert!(database.contains("_redacted_query_fingerprint"));

    let frontend = text_body(api_get(app, &owner, "/api/v2/ops/frontend").await).await;
    assert!(frontend.contains("/patients/:id/chronicle"));
}
