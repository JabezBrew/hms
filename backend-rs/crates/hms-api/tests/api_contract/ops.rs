use super::*;
use std::time::Duration as StdDuration;

const CF_TEST_SECRET: &str = "test-only-cloudflare-access-secret";
const CF_TEST_ISSUER: &str = "https://hms-test.cloudflareaccess.com";
const CF_TEST_AUD: &str = "test-cloudflare-access-audience";

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

    let owner_without_platform_grant = Actor::login(&app, "owner@hms.local").await;
    for endpoint in OPS_ENDPOINTS {
        let response = api_get(app.clone(), &owner_without_platform_grant, endpoint).await;
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

#[tokio::test]
async fn ops_endpoints_accept_cloudflare_access_operator_without_hms_user() {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.ops_auth_mode = hms_api::config::OpsAuthMode::CloudflareAccess;
    config.cloudflare_access.team_domain = Some(CF_TEST_ISSUER.to_owned());
    config.cloudflare_access.audience = Some(CF_TEST_AUD.to_owned());
    config.cloudflare_access.allowed_emails = vec![
        "jabezbrew3@gmail.com".to_owned(),
        "jabezbrew79@gmail.com".to_owned(),
    ];
    config.cloudflare_access.test_secret = Some(CF_TEST_SECRET.to_owned());
    let app = app_with_config(config, database).await;

    let owner = Actor::login(&app, "owner@hms.local").await;
    let hms_response = api_get(app.clone(), &owner, "/api/v2/ops/overview").await;
    assert_eq!(hms_response.status(), StatusCode::UNAUTHORIZED);

    let allowed_token = cloudflare_access_test_token("jabezbrew3@gmail.com");
    for endpoint in OPS_ENDPOINTS {
        let response = cloudflare_access_get(app.clone(), endpoint, &allowed_token).await;
        assert_eq!(response.status(), StatusCode::OK, "{endpoint}");
        let body = text_body(response).await;
        assert!(body.contains("in_process_metrics"), "{body}");
        assert!(!body.contains("jabezbrew3@gmail.com"), "{body}");
    }

    let second_allowed_token = cloudflare_access_test_token("jabezbrew79@gmail.com");
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
