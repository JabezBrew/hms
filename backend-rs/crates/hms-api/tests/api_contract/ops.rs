use super::*;
use axum::http::header::CACHE_CONTROL;
use std::time::Duration as StdDuration;

const CF_TEST_SECRET: &str = "test-only-cloudflare-access-secret";
const CF_TEST_ISSUER: &str = "https://hms-test.cloudflareaccess.com";
const CF_TEST_AUD: &str = "test-cloudflare-access-audience";

const IMPLEMENTED_OPS_ENDPOINTS: [&str; 14] = [
    "/api/v2/ops/overview",
    "/api/v2/ops/performance",
    "/api/v2/ops/database",
    "/api/v2/ops/frontend",
    "/api/v2/ops/route-latency",
    "/api/v2/ops/clinical-budgets",
    "/api/v2/ops/db-pool",
    "/api/v2/ops/request-context-cache",
    "/api/v2/ops/payload",
    "/api/v2/ops/rum",
    "/api/v2/ops/slow-query-fingerprints",
    "/api/v2/ops/service-errors",
    "/api/v2/ops/deploys",
    "/api/v2/ops/edge-status",
];

const FORBIDDEN_OPS_QUERY_PARAMS: [&str; 9] = [
    "promql",
    "query",
    "sql",
    "logql",
    "raw",
    "url",
    "patient_id",
    "mrn",
    "request_body",
];

#[tokio::test]
async fn ops_endpoints_require_ops_access_and_return_phi_safe_snapshots() {
    let app = app().await;

    for endpoint in IMPLEMENTED_OPS_ENDPOINTS {
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
    for endpoint in IMPLEMENTED_OPS_ENDPOINTS {
        let response = api_get(app.clone(), &limited, endpoint).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{endpoint}");
    }

    grant_test_permission(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PermissionCode::SystemOpsView,
    )
    .await;
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
    hms_observability::record_browser_rum_event(
        "navigation",
        "duration",
        &format!(
            "https://browser.example/patients/Ama-Mensah-{patient_id}/chronicle?mrn=P-0000000001"
        ),
        "200",
        "hms",
        StdDuration::from_millis(150),
    );

    for endpoint in IMPLEMENTED_OPS_ENDPOINTS {
        let response = api_get(app.clone(), &owner, endpoint).await;
        assert_eq!(response.status(), StatusCode::OK, "{endpoint}");
        assert_eq!(
            response
                .headers()
                .get(CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store"),
            "{endpoint}"
        );
        let body = text_body(response).await;

        assert!(
            body.contains("in_process_metrics") || body.contains("\"available\":false"),
            "{body}"
        );
        assert_ops_body_is_safe(&body, endpoint, patient_id);
    }

    let database =
        text_body(api_get(app.clone(), &owner, "/api/v2/ops/slow-query-fingerprints").await).await;
    assert!(database.contains("_redacted_query_fingerprint"));
    assert_ops_body_is_safe(&database, "/api/v2/ops/slow-query-fingerprints", patient_id);

    let frontend = text_body(api_get(app.clone(), &owner, "/api/v2/ops/rum").await).await;
    assert!(frontend.contains("/patients/:id/chronicle"));
    assert_ops_body_is_safe(&frontend, "/api/v2/ops/rum", patient_id);

    let unavailable = json_body(api_get(app, &owner, "/api/v2/ops/service-errors").await).await;
    assert_eq!(unavailable["data"]["source"]["available"], json!(false));
    assert_eq!(unavailable["data"]["source"]["kind"], json!("unavailable"));
}

#[tokio::test]
async fn implemented_ops_endpoints_do_not_echo_forbidden_query_values() {
    let app = app().await;
    grant_test_permission(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PermissionCode::SystemOpsView,
    )
    .await;
    let owner = Actor::login(&app, "owner@hms.local").await;
    let patient_id = Uuid::new_v4();

    for endpoint in IMPLEMENTED_OPS_ENDPOINTS {
        for param in FORBIDDEN_OPS_QUERY_PARAMS {
            let uri = format!(
                "{endpoint}?{param}=SELECT%20MRN%20P-0000000001%20FROM%20patients%20WHERE%20url=https://browser.example/patients/Ama-Mensah-{patient_id}"
            );
            let response = api_get(app.clone(), &owner, uri).await;
            assert_eq!(
                response.status(),
                StatusCode::BAD_REQUEST,
                "{endpoint} {param}"
            );
            let body = text_body(response).await;
            assert_ops_body_is_safe(&body, endpoint, patient_id);
        }
    }

    let accepted = api_get(
        app,
        &owner,
        "/api/v2/ops/route-latency?window=5m&limit=1&group=chronicle&status=2xx",
    )
    .await;
    assert_eq!(accepted.status(), StatusCode::OK);
}

#[tokio::test]
async fn ops_endpoints_accept_cloudflare_access_operator_without_hms_user() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.ops_auth_mode = hms_api::config::OpsAuthMode::CloudflareAccess;
    config.cloudflare_access.team_domain = Some(CF_TEST_ISSUER.to_owned());
    config.cloudflare_access.audience = Some(CF_TEST_AUD.to_owned());
    config.cloudflare_access.allowed_emails = vec![
        "ops-operator-1@example.com".to_owned(),
        "ops-operator-2@example.com".to_owned(),
    ];
    config.cloudflare_access.test_secret = Some(CF_TEST_SECRET.to_owned());
    let app = app_with_config(config, database).await;

    let owner = Actor::login(&app, "owner@hms.local").await;
    let hms_response = api_get(app.clone(), &owner, "/api/v2/ops/overview").await;
    assert_eq!(hms_response.status(), StatusCode::UNAUTHORIZED);

    let allowed_token = cloudflare_access_test_token("ops-operator-1@example.com");
    for endpoint in IMPLEMENTED_OPS_ENDPOINTS {
        let response = cloudflare_access_get(app.clone(), endpoint, &allowed_token).await;
        assert_eq!(response.status(), StatusCode::OK, "{endpoint}");
        assert_eq!(
            response
                .headers()
                .get(CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store"),
            "{endpoint}"
        );
        let body = text_body(response).await;
        assert!(
            body.contains("in_process_metrics") || body.contains("\"available\":false"),
            "{body}"
        );
        assert_ops_body_is_safe(&body, endpoint, Uuid::nil());
    }

    let second_allowed_token = cloudflare_access_test_token("ops-operator-2@example.com");
    let second_allowed_response =
        cloudflare_access_get(app.clone(), "/api/v2/ops/overview", &second_allowed_token).await;
    assert_eq!(second_allowed_response.status(), StatusCode::OK);

    let rejected_token = cloudflare_access_test_token("someone-else@example.com");
    let rejected_response =
        cloudflare_access_get(app, "/api/v2/ops/overview", &rejected_token).await;
    let rejected_status = rejected_response.status();
    let rejected_body = json_body(rejected_response).await;
    assert_eq!(rejected_status, StatusCode::FORBIDDEN, "{rejected_body}");
    assert_eq!(
        rejected_body["error"]["code"],
        json!("ops_operator_not_allowed")
    );
}

#[tokio::test]
async fn implemented_ops_endpoints_reject_forbidden_query_params() {
    let app = app().await;
    grant_test_permission(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PermissionCode::SystemOpsView,
    )
    .await;
    let owner = Actor::login(&app, "owner@hms.local").await;

    for endpoint in IMPLEMENTED_OPS_ENDPOINTS {
        for param in FORBIDDEN_OPS_QUERY_PARAMS {
            let uri = format!("{endpoint}?{param}=SELECT%20patient_id%20FROM%20patients");
            let response = api_get(app.clone(), &owner, uri).await;
            assert_eq!(
                response.status(),
                StatusCode::BAD_REQUEST,
                "{endpoint} {param}"
            );
        }
    }
}

async fn cloudflare_access_get(
    app: TestApp,
    uri: impl AsRef<str>,
    token: &str,
) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .method(Method::GET)
            .uri(uri.as_ref())
            .header("Cf-Access-Jwt-Assertion", token)
            .body(Body::empty())
            .expect("request builds"),
    )
    .await
    .expect("request succeeds")
}

fn cloudflare_access_test_token(email: &str) -> String {
    #[derive(serde::Serialize)]
    struct TestClaims<'a> {
        sub: &'a str,
        email: &'a str,
        iss: &'a str,
        aud: &'a str,
        iat: usize,
        exp: usize,
    }

    let now = Utc::now().timestamp() as usize;
    let claims = TestClaims {
        sub: "cloudflare-access-test-user",
        email,
        iss: CF_TEST_ISSUER,
        aud: CF_TEST_AUD,
        iat: now,
        exp: now + 300,
    };

    encode(
        &Header::new(jsonwebtoken::Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(CF_TEST_SECRET.as_bytes()),
    )
    .expect("test Cloudflare Access token encodes")
}

fn assert_ops_body_is_safe(body: &str, endpoint: &str, patient_id: Uuid) {
    let forbidden = [
        patient_id.to_string(),
        "Ama".to_owned(),
        "Mensah".to_owned(),
        "MRN".to_owned(),
        "P-0000000001".to_owned(),
        "SELECT".to_owned(),
        "FROM patients".to_owned(),
        "pg_stat_statements.query".to_owned(),
        "rate(http_requests_total".to_owned(),
        "PromQL".to_owned(),
        "promql".to_owned(),
        "LogQL".to_owned(),
        "logql".to_owned(),
        "free-text".to_owned(),
        "request_body".to_owned(),
        "body=free-text".to_owned(),
        "https://browser.example".to_owned(),
        "?mrn=".to_owned(),
        "owner@hms.local".to_owned(),
        "ops-operator-1@example.com".to_owned(),
        "someone-else@example.com".to_owned(),
        "ChangeMe123".to_owned(),
        "ERROR request_id=".to_owned(),
        "stack backtrace".to_owned(),
    ];

    for token in forbidden {
        if token.is_empty() {
            continue;
        }
        assert!(
            !body.contains(&token),
            "{endpoint} leaked forbidden token {token}: {body}"
        );
    }
}
