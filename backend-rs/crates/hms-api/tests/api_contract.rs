use axum::body::{to_bytes, Body};
use axum::http::header::{AUTHORIZATION, COOKIE, SET_COOKIE};
use axum::http::HeaderMap;
use axum::http::{Method, Request, StatusCode};
use axum::response::Response;
use chrono::{Duration, Utc};
use cookie::Cookie;
use hms_api::app::build_app;
use hms_api::config::Config;
use hms_api::state::AppState;
use hms_domain::deployment::DeploymentProfile;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tower::util::ServiceExt;
use tower::Service;
use uuid::Uuid;

#[derive(Clone)]
struct TestApp {
    router: axum::Router,
    _database: Arc<hms_db::test_support::TestDatabase>,
}

struct TestAppFuture<F> {
    inner: Pin<Box<F>>,
    _database: Arc<hms_db::test_support::TestDatabase>,
}

impl<F> Future for TestAppFuture<F>
where
    F: Future,
{
    type Output = F::Output;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        self.inner.as_mut().poll(cx)
    }
}

impl Service<Request<Body>> for TestApp {
    type Response = Response;
    type Error = Infallible;
    type Future = TestAppFuture<<axum::Router as Service<Request<Body>>>::Future>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        <axum::Router as Service<Request<Body>>>::poll_ready(&mut self.router, cx)
    }

    fn call(&mut self, request: Request<Body>) -> Self::Future {
        TestAppFuture {
            inner: Box::pin(<axum::Router as Service<Request<Body>>>::call(
                &mut self.router,
                request,
            )),
            _database: Arc::clone(&self._database),
        }
    }
}

async fn app() -> TestApp {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    app_with_config(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await
}

async fn app_with_config(
    config: Config,
    database: Arc<hms_db::test_support::TestDatabase>,
) -> TestApp {
    let state = AppState::new(config).await.expect("test state initializes");
    TestApp {
        router: build_app(state),
        _database: database,
    }
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body reads");
    serde_json::from_slice(&bytes).expect("response body is json")
}

async fn login(app: TestApp, email: &str) -> (String, String, String) {
    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": email,
                        "password": "ChangeMe123!",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("login request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let (cookie_header, csrf_token) = auth_cookies(response.headers());
    let body = json_body(response).await;
    let access_token = body["data"]["access_token"]
        .as_str()
        .expect("access token exists")
        .to_owned();

    (access_token, cookie_header, csrf_token)
}

fn auth_cookies(headers: &HeaderMap) -> (String, String) {
    let mut refresh_cookie = None;
    let mut csrf_cookie = None;

    for header in headers.get_all(SET_COOKIE) {
        let header = header.to_str().expect("set-cookie is valid ascii");
        let cookie = Cookie::parse(header).expect("set-cookie parses");
        let pair = format!("{}={}", cookie.name(), cookie.value());
        match cookie.name() {
            "hms_refresh" => refresh_cookie = Some(pair),
            "hms_v2_csrf" => csrf_cookie = Some(pair),
            _ => {}
        }
    }

    let refresh_cookie = refresh_cookie.expect("refresh cookie is set");
    let csrf_cookie = csrf_cookie.expect("csrf cookie is set");
    let csrf_token = csrf_cookie
        .split_once('=')
        .map(|(_, value)| value.to_owned())
        .expect("csrf cookie pair has token");

    (format!("{refresh_cookie}; {csrf_cookie}"), csrf_token)
}

#[tokio::test]
async fn health_endpoints_use_standard_envelope_and_request_id() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/health/alive")
                .header("x-request-id", "test-request-1")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("health request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("x-request-id").unwrap(),
        "test-request-1"
    );
    let body = json_body(response).await;
    assert_eq!(body["data"]["service"], "hms-api");
    assert_eq!(body["data"]["status"], "alive");
    assert!(body["meta"].is_object());
}

#[tokio::test]
async fn openapi_contains_foundation_paths() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/openapi.json")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("openapi request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let paths = body["paths"].as_object().expect("paths object exists");
    for path in [
        "/api/v2/health/alive",
        "/api/v2/health/ready",
        "/api/v2/metrics",
        "/api/v2/auth/login",
        "/api/v2/auth/refresh",
        "/api/v2/auth/logout",
        "/api/v2/auth/me",
        "/api/v2/auth/password-reset/request",
        "/api/v2/auth/password-reset/complete",
        "/api/v2/system/deployment-capabilities",
        "/api/v2/admin/org-units",
        "/api/v2/admin/org-units/{id}",
        "/api/v2/admin/org-units/{id}/ancestors",
        "/api/v2/admin/org-units/{id}/children",
        "/api/v2/admin/org-units/{id}/descendants",
        "/api/v2/admin/position-templates",
        "/api/v2/admin/positions",
        "/api/v2/admin/authority-appointments",
        "/api/v2/admin/permission-assignments",
        "/api/v2/admin/features",
        "/api/v2/admin/features/{key}",
        "/api/v2/admin/staff",
        "/api/v2/admin/staff/{id}",
        "/api/v2/admin/staff/{id}/force-password-reset",
        "/api/v2/admin/staff/{id}/deactivate",
        "/api/v2/admin/staff/{id}/reactivate",
        "/api/v2/admin/staff/{id}/practitioner-profile",
        "/api/v2/admin/practitioners",
        "/api/v2/admin/committees",
        "/api/v2/admin/delegations",
        "/api/v2/admin/audit-events",
        "/api/v2/dashboards/snapshot",
        "/api/v2/notifications",
        "/api/v2/notifications/{id}/read",
        "/api/v2/realtime/subscriptions",
        "/api/v2/patients",
        "/api/v2/patients/context",
        "/api/v2/patients/validation-rules",
        "/api/v2/patients/{id}",
        "/api/v2/patients/{id}/chronicle",
        "/api/v2/patients/{id}/chronicle/print",
        "/api/v2/appointments",
        "/api/v2/appointments/{id}",
        "/api/v2/appointments/{id}/cancel",
        "/api/v2/clinics",
        "/api/v2/visits",
        "/api/v2/visits/{id}",
        "/api/v2/visits/check-in",
        "/api/v2/visits/{id}/call",
        "/api/v2/visits/{id}/start-consultation",
        "/api/v2/visits/{id}/checkout",
        "/api/v2/triage",
        "/api/v2/triage/{id}/assign",
        "/api/v2/encounters",
        "/api/v2/encounters/{id}",
        "/api/v2/encounters/{id}/complete",
        "/api/v2/encounters/{id}/cancel",
        "/api/v2/encounters/{id}/care-team",
        "/api/v2/clinical/note-templates",
        "/api/v2/patients/{patient_id}/clinical/notes",
        "/api/v2/clinical/notes/{note_id}/versions",
        "/api/v2/patients/{patient_id}/clinical/problems",
        "/api/v2/patients/{patient_id}/clinical/allergies",
        "/api/v2/patients/{patient_id}/clinical/prescriptions",
        "/api/v2/patients/{patient_id}/clinical/chart-entries",
        "/api/v2/laboratory/test-catalog",
        "/api/v2/laboratory/test-catalog/{id}",
        "/api/v2/laboratory/panels",
        "/api/v2/laboratory/panels/{id}",
        "/api/v2/laboratory/orders",
        "/api/v2/laboratory/orders/{id}",
        "/api/v2/laboratory/specimens",
        "/api/v2/laboratory/specimens/{id}",
        "/api/v2/laboratory/results",
        "/api/v2/laboratory/results/{id}",
        "/api/v2/laboratory/results/{id}/verify",
        "/api/v2/inventory/categories",
        "/api/v2/inventory/items",
        "/api/v2/inventory/items/{id}",
        "/api/v2/inventory/items/{id}/stock-batches",
        "/api/v2/inventory/items/{id}/stock-movements",
        "/api/v2/inventory/items/{id}/stock-by-location",
        "/api/v2/inventory/storage-locations",
        "/api/v2/inventory/storage-locations/{id}",
        "/api/v2/inventory/storage-locations/{id}/stock",
        "/api/v2/inventory/stock-batches",
        "/api/v2/inventory/stock-movements",
        "/api/v2/inventory/transfers",
        "/api/v2/inventory/transfers/{id}",
        "/api/v2/inventory/requisitions",
        "/api/v2/inventory/requisitions/{id}",
        "/api/v2/inventory/purchase-orders",
        "/api/v2/inventory/purchase-orders/{id}",
        "/api/v2/inventory/goods-received-notes",
        "/api/v2/inventory/goods-received-notes/{id}",
        "/api/v2/pharmacy/controlled-substances/register",
        "/api/v2/pharmacy/controlled-substances/register/{id}",
        "/api/v2/pharmacy/dispenses",
        "/api/v2/billing/service-catalog",
        "/api/v2/billing/service-prices",
        "/api/v2/billing/rules",
        "/api/v2/billing/invoices",
        "/api/v2/billing/payments",
        "/api/v2/billing/receipts",
        "/api/v2/billing/cash-drawers",
        "/api/v2/billing/cash-sessions",
        "/api/v2/billing/cash-sessions/{id}/close",
        "/api/v2/nhis/claims",
        "/api/v2/nhis/batches",
        "/api/v2/nhis/batches/{id}/export",
        "/api/v2/nhis/remittance-imports",
        "/api/v2/wards",
        "/api/v2/wards/{id}",
        "/api/v2/wards/{id}/beds",
        "/api/v2/wards/{id}/sections",
        "/api/v2/wards/board",
        "/api/v2/admissions",
        "/api/v2/admissions/{id}",
        "/api/v2/admissions/cases",
        "/api/v2/admissions/cases/{id}",
        "/api/v2/admissions/cases/{id}/reserve-bed",
        "/api/v2/admissions/cases/{id}/activate",
        "/api/v2/admissions/cases/{id}/cancel",
        "/api/v2/discharges",
        "/api/v2/discharges/{id}",
        "/api/v2/discharges/{id}/cancel",
        "/api/v2/discharges/{id}/complete",
        "/api/v2/nursing/tasks",
        "/api/v2/nursing/tasks/{id}/complete",
        "/api/v2/nursing/medication-administrations",
        "/api/v2/nursing/medication-administrations/{id}/administer",
        "/api/v2/nursing/handoffs",
        "/api/v2/nursing/handoffs/{id}/complete",
        "/api/v2/nursing/treatment-sheets",
        "/api/v2/nursing/vitals",
        "/api/v2/nursing/alerts",
        "/api/v2/nursing/alerts/{id}/acknowledge",
        "/api/v2/nursing/monitoring-events",
        "/api/v2/nursing/fluid-balance",
        "/api/v2/nursing/ward-stock-requests",
        "/api/v2/nursing/ward-stock-requests/{id}/approve",
        "/api/v2/nursing/ward-stock-requests/{id}/fulfill",
        "/api/v2/referrals",
        "/api/v2/referrals/sla-dashboard",
        "/api/v2/referrals/{id}",
        "/api/v2/referrals/{id}/accept",
        "/api/v2/referrals/{id}/complete",
        "/api/v2/referrals/{id}/decline",
        "/api/v2/referrals/{id}/sla-state",
        "/api/v2/referrals/clinic-waitlist",
        "/api/v2/referrals/clinic-waitlist/offer-next",
        "/api/v2/consents",
        "/api/v2/consents/{id}/revoke",
    ] {
        assert!(paths.contains_key(path), "missing OpenAPI path {path}");
    }
    let ward_board_parameters = paths["/api/v2/wards/board"]["get"]["parameters"]
        .as_array()
        .expect("ward board parameters exist");
    assert!(
        ward_board_parameters
            .iter()
            .any(|parameter| parameter["name"] == "ward_id"),
        "ward board exposes ward_id filter for ward-scoped UI routes"
    );
}

#[tokio::test]
async fn metrics_endpoint_is_phi_safe_prometheus_text() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/metrics")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("metrics request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .expect("content-type exists")
        .to_str()
        .expect("content-type is ascii");
    assert!(content_type.starts_with("text/plain"));

    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("metrics response reads");
    let body = String::from_utf8(bytes.to_vec()).expect("metrics text is utf-8");
    assert!(body.contains("hms_api_up 1"));
    assert!(body.contains("hms_api_postgres_pool_size"));
    assert!(!body.contains("Ama"));
    assert!(!body.contains("Mensah"));
    assert!(!body.contains("P-0000000001"));
}

#[tokio::test]
async fn auth_login_refresh_logout_and_me_follow_session_contract() {
    let app = app().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "limited@hms.local").await;

    let me_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("me request succeeds");
    assert_eq!(me_response.status(), StatusCode::OK);
    let me_body = json_body(me_response).await;
    assert_eq!(me_body["data"]["password_change_required"], true);

    let profile_update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "display_name": "Limited Updated"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("profile update request succeeds");
    assert_eq!(profile_update_response.status(), StatusCode::OK);
    let profile_update_body = json_body(profile_update_response).await;
    assert_eq!(
        profile_update_body["data"]["display_name"],
        "Limited Updated"
    );

    let refresh_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie.clone())
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("refresh request succeeds");
    assert_eq!(refresh_response.status(), StatusCode::OK);
    let (rotated_cookie, rotated_csrf_token) = auth_cookies(refresh_response.headers());

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/logout")
                .header(COOKIE, rotated_cookie)
                .header("x-hms-csrf", rotated_csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("logout request succeeds");
    assert_eq!(logout_response.status(), StatusCode::OK);
    assert!(logout_response.headers().contains_key(SET_COOKIE));

    let (_, cookie, _) = login(app.clone(), "limited@hms.local").await;
    let rejected_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("csrf rejection succeeds");
    assert_eq!(rejected_refresh.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn refresh_token_reuse_revokes_the_rotated_session_family() {
    let app = app().await;
    let (_, original_cookie, original_csrf) = login(app.clone(), "owner@hms.local").await;

    let refresh_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, original_cookie.clone())
                .header("x-hms-csrf", original_csrf.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("refresh request succeeds");
    assert_eq!(refresh_response.status(), StatusCode::OK);
    let (rotated_cookie, rotated_csrf) = auth_cookies(refresh_response.headers());

    let reused_old_token = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, original_cookie)
                .header("x-hms-csrf", original_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("reuse request succeeds");
    assert_eq!(reused_old_token.status(), StatusCode::UNAUTHORIZED);

    let family_revoked = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, rotated_cookie)
                .header("x-hms-csrf", rotated_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("family revoked request succeeds");
    assert_eq!(family_revoked.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn password_reset_is_single_use_and_revokes_existing_sessions() {
    let app = app().await;
    let (old_access_token, old_cookie, old_csrf) = login(app.clone(), "limited@hms.local").await;

    let request_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/request")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "limited@hms.local",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset request succeeds");
    assert_eq!(request_response.status(), StatusCode::OK);
    let request_body = json_body(request_response).await;
    let reset_token = request_body["data"]["debug_token"]
        .as_str()
        .expect("debug token is returned in tests")
        .to_owned();

    let weak_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "short"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("weak password request succeeds");
    assert_eq!(weak_password.status(), StatusCode::BAD_REQUEST);

    let request_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/request")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "limited@hms.local",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset request succeeds");
    let request_body = json_body(request_response).await;
    let reset_token = request_body["data"]["debug_token"]
        .as_str()
        .expect("debug token is returned in tests")
        .to_owned();

    let complete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "Replacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset complete succeeds");
    assert_eq!(complete_response.status(), StatusCode::OK);

    let stale_access = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {old_access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale access request succeeds");
    assert_eq!(stale_access.status(), StatusCode::UNAUTHORIZED);

    let stale_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, old_cookie)
                .header("x-hms-csrf", old_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale refresh request succeeds");
    assert_eq!(stale_refresh.status(), StatusCode::UNAUTHORIZED);

    let reused_token = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "AnotherReplacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("token reuse request succeeds");
    assert_eq!(reused_token.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn deployment_capabilities_are_permission_gated() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("capabilities request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"]["deployment_profile"], "hospital");
    assert_eq!(body["data"]["features"]["patients"], true);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("capabilities denial succeeds");

    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let body = json_body(denied).await;
    assert_eq!(body["error"]["code"], "permission_denied");
    assert!(body["request_id"].is_string());

    let clinic_database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut clinic_config =
        Config::for_tests_with_database_url(clinic_database.database_url().to_owned());
    clinic_config.deployment_profile = DeploymentProfile::Clinic;
    let clinic_app = app_with_config(clinic_config, clinic_database).await;
    let (clinic_token, _, _) = login(clinic_app.clone(), "owner@hms.local").await;
    let clinic_response = clinic_app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, format!("Bearer {clinic_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinic capabilities request succeeds");

    let clinic_status = clinic_response.status();
    let clinic_body = json_body(clinic_response).await;
    assert_eq!(clinic_status, StatusCode::OK, "{clinic_body}");
    assert_eq!(clinic_body["data"]["deployment_profile"], "clinic");
    assert_eq!(clinic_body["data"]["features"]["patients"], true);
    assert_eq!(clinic_body["data"]["features"]["wards"], false);
}

#[tokio::test]
async fn feature_entitlements_are_admin_scoped_and_reflected_in_capabilities() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let features_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/features")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("feature list succeeds");
    assert_eq!(features_response.status(), StatusCode::OK);
    let features_body = json_body(features_response).await;
    assert!(features_body["data"]
        .as_array()
        .expect("features are listed")
        .iter()
        .any(|item| item["feature"] == "nursing" && item["enabled"] == true));

    let update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri("/api/v2/admin/features/nursing")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "feature-entitlement-test")
                .body(Body::from(json!({ "enabled": false }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("feature update succeeds");
    assert_eq!(update_response.status(), StatusCode::OK);
    let update_body = json_body(update_response).await;
    assert_eq!(update_body["data"]["feature"], "nursing");
    assert_eq!(update_body["data"]["enabled"], false);
    assert_eq!(update_body["data"]["override_enabled"], false);

    let capabilities_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("capabilities request succeeds");
    assert_eq!(capabilities_response.status(), StatusCode::OK);
    let capabilities_body = json_body(capabilities_response).await;
    assert_eq!(capabilities_body["data"]["features"]["nursing"], false);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/features")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("feature entitlement denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn staff_management_is_admin_scoped_and_practitioner_ready() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let initial_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/staff?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff list succeeds");
    assert_eq!(initial_list.status(), StatusCode::OK);
    let initial_body = json_body(initial_list).await;
    assert_eq!(initial_body["page"]["limit"], 1);

    let directory_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/staff/directory?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff directory succeeds");
    assert_eq!(directory_response.status(), StatusCode::OK);
    let directory_body = json_body(directory_response).await;
    assert_eq!(directory_body["page"]["limit"], 1);

    let weak_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/staff")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "weak.staff@hms.local",
                        "display_name": "Weak Staff",
                        "temporary_password": "short",
                        "employee_id": "EMP-HMS-2026-WEAK",
                        "department": "Clinical",
                        "position": "Nurse",
                        "hire_date": "2026-05-10"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("weak staff create succeeds");
    assert_eq!(weak_password.status(), StatusCode::BAD_REQUEST);

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/staff")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "staff-create-test")
                .body(Body::from(
                    json!({
                        "email": "akosua.clinician@hms.local",
                        "display_name": "Akosua Clinician",
                        "temporary_password": "Temporary123!",
                        "employee_id": "EMP-HMS-2026-0001",
                        "department": "Clinical",
                        "position": "Medical Officer",
                        "hire_date": "2026-05-10",
                        "practitioner_profile": {
                            "license_number": "MDC/RN/0001",
                            "specialization": "Internal Medicine",
                            "qualification": "MBChB",
                            "fhir_practitioner_id": null
                        }
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("staff create succeeds");
    let create_status = create_response.status();
    let create_body = json_body(create_response).await;
    assert_eq!(create_status, StatusCode::OK, "{create_body}");
    assert_eq!(create_body["data"]["email"], "akosua.clinician@hms.local");
    assert_eq!(create_body["data"]["password_change_required"], true);
    assert_eq!(
        create_body["data"]["practitioner_profile"]["license_number"],
        "MDC/RN/0001"
    );
    let staff_id = create_body["data"]["id"]
        .as_str()
        .expect("staff id exists")
        .to_owned();
    let staff_user_id = create_body["data"]["user_id"]
        .as_str()
        .expect("staff user id exists")
        .to_owned();

    let populated_directory = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/staff/directory?limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("populated staff directory succeeds");
    assert_eq!(populated_directory.status(), StatusCode::OK);
    let populated_directory_body = json_body(populated_directory).await;
    let directory_items = populated_directory_body["data"]
        .as_array()
        .expect("directory data is an array");
    let created_directory_item = directory_items
        .iter()
        .find(|item| item["user_id"] == staff_user_id)
        .expect("created staff appears in directory");
    assert_eq!(created_directory_item["display_name"], "Akosua Clinician");
    assert!(created_directory_item["password_change_required"].is_null());

    let detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/staff/{staff_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff detail succeeds");
    assert_eq!(detail_response.status(), StatusCode::OK);

    let update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/admin/staff/{staff_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "staff-update-test")
                .body(Body::from(
                    json!({
                        "display_name": "Akosua Updated",
                        "department": "Emergency",
                        "position": "Emergency Physician"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("staff update succeeds");
    assert_eq!(update_response.status(), StatusCode::OK);
    let update_body = json_body(update_response).await;
    assert_eq!(update_body["data"]["display_name"], "Akosua Updated");
    assert_eq!(update_body["data"]["department"], "Emergency");
    assert_eq!(update_body["data"]["position"], "Emergency Physician");

    let profile_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PUT)
                .uri(format!(
                    "/api/v2/admin/staff/{staff_id}/practitioner-profile"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "license_number": "MDC/RN/0002",
                        "specialization": "Emergency Medicine",
                        "qualification": "MBChB, MWACP",
                        "fhir_practitioner_id": "Practitioner/hms-0002"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("practitioner profile upsert succeeds");
    assert_eq!(profile_response.status(), StatusCode::OK);
    let profile_body = json_body(profile_response).await;
    assert_eq!(
        profile_body["data"]["practitioner_profile"]["specialization"],
        "Emergency Medicine"
    );

    let practitioners_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/practitioners?limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner list succeeds");
    assert_eq!(practitioners_response.status(), StatusCode::OK);
    let practitioners_body = json_body(practitioners_response).await;
    let practitioner = practitioners_body["data"]
        .as_array()
        .expect("practitioners listed")
        .iter()
        .find(|item| item["staff_id"] == staff_id && item["license_number"] == "MDC/RN/0002")
        .expect("created practitioner is listed");
    let practitioner_id = practitioner["id"]
        .as_str()
        .expect("practitioner id exists")
        .to_owned();

    let practitioner_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/practitioners/{practitioner_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner detail succeeds");
    assert_eq!(practitioner_detail_response.status(), StatusCode::OK);
    let practitioner_detail = json_body(practitioner_detail_response).await;
    assert_eq!(practitioner_detail["data"]["id"], practitioner_id);
    assert_eq!(practitioner_detail["data"]["staff_id"], staff_id);
    assert_eq!(practitioner_detail["data"]["license_number"], "MDC/RN/0002");

    let searched_staff_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/staff?search=akosua&is_active=true&practitioners_only=true&limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff search succeeds");
    assert_eq!(searched_staff_response.status(), StatusCode::OK);
    let searched_staff = json_body(searched_staff_response).await;
    let searched_staff_data = searched_staff["data"]
        .as_array()
        .expect("searched staff data is array");
    assert_eq!(searched_staff_data.len(), 1);
    assert_eq!(searched_staff_data[0]["id"], staff_id);
    assert!(searched_staff_data[0]["practitioner_profile"].is_object());

    let searched_practitioners_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/practitioners?search=MDC%2FRN%2F0002&is_active=true&limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner search succeeds");
    assert_eq!(searched_practitioners_response.status(), StatusCode::OK);
    let searched_practitioners = json_body(searched_practitioners_response).await;
    let searched_practitioners_data = searched_practitioners["data"]
        .as_array()
        .expect("searched practitioners data is array");
    assert_eq!(searched_practitioners_data.len(), 1);
    assert_eq!(searched_practitioners_data[0]["id"], practitioner_id);

    let practitioner_by_staff_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/practitioners/{staff_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner by staff detail succeeds");
    assert_eq!(practitioner_by_staff_response.status(), StatusCode::OK);
    let practitioner_by_staff = json_body(practitioner_by_staff_response).await;
    assert_eq!(practitioner_by_staff["data"]["id"], practitioner_id);
    assert_eq!(practitioner_by_staff["data"]["staff_id"], staff_id);

    let reset_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admin/staff/{staff_id}/force-password-reset"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("force reset succeeds");
    assert_eq!(reset_response.status(), StatusCode::OK);
    let reset_body = json_body(reset_response).await;
    assert_eq!(reset_body["data"]["password_change_required"], true);

    let deactivate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/admin/staff/{staff_id}/deactivate"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("deactivate succeeds");
    assert_eq!(deactivate_response.status(), StatusCode::OK);
    let deactivate_body = json_body(deactivate_response).await;
    assert_eq!(deactivate_body["data"]["is_active"], false);

    let reactivate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/admin/staff/{staff_id}/reactivate"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("reactivate succeeds");
    assert_eq!(reactivate_response.status(), StatusCode::OK);
    let reactivate_body = json_body(reactivate_response).await;
    assert_eq!(reactivate_body["data"]["is_active"], true);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/staff?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let directory_denied = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/staff/directory?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff directory denial succeeds");
    assert_eq!(directory_denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_registry_uses_cursor_pagination_and_enforces_access() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["page"]["limit"], 1);
    assert_eq!(body["page"]["has_next"], true);
    assert!(body["page"]["next_cursor"].is_string());
    assert!(body["data"][0]["display_name"].is_string());

    let patient_id = body["data"][0]["id"].as_str().unwrap();
    let detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/patients/{patient_id}"))
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient detail succeeds");
    assert_eq!(detail.status(), StatusCode::OK);

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/patients")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "first_name": "Efua",
                        "last_name": "Owusu",
                        "date_of_birth": "1995-03-10",
                        "sex": "female"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("patient create succeeds");
    assert_eq!(create.status(), StatusCode::OK);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_validation_rules_are_available_from_v2_contract() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/validation-rules")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("validation rules request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let rules = body["data"].as_array().expect("rules are returned as data");
    assert!(
        rules.iter().any(|rule| {
            rule["field_name"] == "first_name"
                && rule["is_required"] == true
                && rule["is_active"] == true
        }),
        "baseline first_name required rule is exposed"
    );
    assert_eq!(body["page"]["has_next"], false);
}

#[tokio::test]
async fn patient_update_and_context_list_are_patient_access_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    let patient_id = list_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/patients/{patient_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "patient-update-test")
                .body(Body::from(
                    json!({
                        "first_name": "Akua",
                        "last_name": "Mensah",
                        "status": "active"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("patient update succeeds");
    let update_status = update_response.status();
    let update_body = json_body(update_response).await;
    assert_eq!(update_status, StatusCode::OK, "{update_body}");
    assert_eq!(update_body["data"]["first_name"], "Akua");
    assert_eq!(update_body["data"]["display_name"], "Akua Mensah");

    let context_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/context?limit=5")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient context list succeeds");
    let context_status = context_response.status();
    let context_body = json_body(context_response).await;
    assert_eq!(context_status, StatusCode::OK, "{context_body}");
    assert_eq!(context_body["data"][0]["id"], patient_id);
    assert!(context_body["data"][0]["context_kind"].is_string());

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/patients/{patient_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "first_name": "Denied" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("patient update denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn clinical_documentation_stays_patient_scoped_and_chronicle_ready() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let templates = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/clinical/note-templates")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("template list succeeds");
    assert_eq!(templates.status(), StatusCode::OK);
    let templates_body = json_body(templates).await;
    assert_eq!(templates_body["data"][0]["title"], "General Clinical Note");

    let template_create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/clinical/note-templates")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Ward Round Note",
                        "note_type": "ward_round",
                        "body_template": "Subjective\\nObjective\\nAssessment\\nPlan"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("template create succeeds");
    assert_eq!(template_create.status(), StatusCode::OK);
    let template_create_body = json_body(template_create).await;
    let template_id = template_create_body["data"]["id"]
        .as_str()
        .expect("template id exists");
    assert_eq!(template_create_body["data"]["title"], "Ward Round Note");
    assert_eq!(template_create_body["data"]["is_active"], true);

    let template_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/note-templates/{template_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("template detail succeeds");
    assert_eq!(template_detail.status(), StatusCode::OK);
    let template_detail_body = json_body(template_detail).await;
    assert_eq!(template_detail_body["data"]["id"], template_id);
    assert_eq!(template_detail_body["data"]["title"], "Ward Round Note");

    let template_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/note-templates/{template_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Updated Ward Round Note",
                        "body_template": "Updated SOAP structure"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("template update succeeds");
    assert_eq!(template_update.status(), StatusCode::OK);
    let template_update_body = json_body(template_update).await;
    assert_eq!(
        template_update_body["data"]["title"],
        "Updated Ward Round Note"
    );
    assert_eq!(
        template_update_body["data"]["body_template"],
        "Updated SOAP structure"
    );

    let template_delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v2/clinical/note-templates/{template_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("template delete succeeds");
    assert_eq!(template_delete.status(), StatusCode::OK);
    let template_delete_body = json_body(template_delete).await;
    assert_eq!(template_delete_body["data"]["is_active"], false);

    let templates_after_delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/clinical/note-templates")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("template list after delete succeeds");
    assert_eq!(templates_after_delete.status(), StatusCode::OK);
    let templates_after_delete_body = json_body(templates_after_delete).await;
    assert!(!templates_after_delete_body["data"]
        .as_array()
        .expect("template list is an array")
        .iter()
        .any(|template| template["id"] == template_id));

    let note_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/patients/{patient_id}/clinical/notes"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "note_type": "general",
                        "title": "Review note",
                        "body": "History recorded. Assessment and plan captured."
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("clinical note create succeeds");
    assert_eq!(note_response.status(), StatusCode::OK);
    let note_body = json_body(note_response).await;
    let note_id = note_body["data"]["id"]
        .as_str()
        .expect("clinical note id exists");
    assert_eq!(note_body["data"]["status"], "draft");

    let note_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/notes/{note_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical note detail succeeds");
    assert_eq!(note_detail.status(), StatusCode::OK);
    let note_detail_body = json_body(note_detail).await;
    assert_eq!(note_detail_body["data"]["id"], note_id);
    assert_eq!(
        note_detail_body["data"]["body"],
        "History recorded. Assessment and plan captured."
    );

    let notes = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/notes?limit=1"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical note list succeeds");
    assert_eq!(notes.status(), StatusCode::OK);
    let notes_body = json_body(notes).await;
    assert_eq!(notes_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(notes_body["page"]["limit"], 1);

    let version_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/clinical/notes/{note_id}/versions"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "body": "Updated assessment and plan." }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("clinical note version create succeeds");
    assert_eq!(version_response.status(), StatusCode::OK);
    let version_body = json_body(version_response).await;
    assert_eq!(version_body["data"]["version"], 2);

    let versions = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/notes/{note_id}/versions"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical note version list succeeds");
    assert_eq!(versions.status(), StatusCode::OK);
    let versions_body = json_body(versions).await;
    assert_eq!(versions_body["data"].as_array().unwrap().len(), 2);

    let problem = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/patients/{patient_id}/clinical/problems"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "label": "Hypertension",
                        "onset_date": "2025-01-10"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("problem create succeeds");
    assert_eq!(problem.status(), StatusCode::OK);
    let problem_body = json_body(problem).await;
    assert_eq!(problem_body["data"]["status"], "active");
    let problem_id = problem_body["data"]["id"]
        .as_str()
        .expect("problem id exists");

    let problem_status = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/clinical/problems/{problem_id}/status"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "status": "resolved" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("problem status update succeeds");
    assert_eq!(problem_status.status(), StatusCode::OK);
    let problem_status_body = json_body(problem_status).await;
    assert_eq!(problem_status_body["data"]["status"], "resolved");

    let problem_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/problems/{problem_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("problem detail succeeds");
    assert_eq!(problem_detail.status(), StatusCode::OK);
    let problem_detail_body = json_body(problem_detail).await;
    assert_eq!(problem_detail_body["data"]["id"], problem_id);

    let problem_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/problems/{problem_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "label": "Essential hypertension",
                        "onset_date": "2026-01-05",
                        "status": "active"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("problem update succeeds");
    assert_eq!(problem_update.status(), StatusCode::OK);
    let problem_update_body = json_body(problem_update).await;
    assert_eq!(
        problem_update_body["data"]["label"],
        "Essential hypertension"
    );
    assert_eq!(problem_update_body["data"]["status"], "active");

    let allergy = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/patients/{patient_id}/clinical/allergies"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "substance": "Penicillin",
                        "reaction": "Rash",
                        "severity": "moderate"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("allergy create succeeds");
    assert_eq!(allergy.status(), StatusCode::OK);
    let allergy_body = json_body(allergy).await;
    let allergy_id = allergy_body["data"]["id"].as_str().expect("allergy id");
    assert_eq!(allergy_body["data"]["status"], "active");

    let allergy_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/allergies/{allergy_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("allergy detail succeeds");
    assert_eq!(allergy_detail.status(), StatusCode::OK);
    let allergy_detail_body = json_body(allergy_detail).await;
    assert_eq!(allergy_detail_body["data"]["substance"], "Penicillin");

    let prescription = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/prescriptions"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "medication_name": "Amlodipine",
                        "dose": "5 mg",
                        "frequency": "daily"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("prescription create succeeds");
    assert_eq!(prescription.status(), StatusCode::OK);
    let prescription_body = json_body(prescription).await;
    let prescription_id = prescription_body["data"]["id"]
        .as_str()
        .expect("prescription id");
    assert_eq!(prescription_body["data"]["status"], "active");

    let prescription_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/prescriptions/{prescription_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("prescription detail succeeds");
    assert_eq!(prescription_detail.status(), StatusCode::OK);
    let prescription_detail_body = json_body(prescription_detail).await;
    assert_eq!(
        prescription_detail_body["data"]["medication_name"],
        "Amlodipine"
    );

    let chart_entry = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/chart-entries"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "entry_type": "blood_pressure",
                        "measured_at": "2026-05-10T14:00:00Z",
                        "value": "130/82",
                        "unit": "mmHg"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("chart entry create succeeds");
    assert_eq!(chart_entry.status(), StatusCode::OK);
    let chart_entry_body = json_body(chart_entry).await;
    assert_eq!(chart_entry_body["data"]["entry_type"], "blood_pressure");

    for path in [
        format!("/api/v2/patients/{patient_id}/clinical/problems?limit=1"),
        format!("/api/v2/patients/{patient_id}/clinical/allergies?limit=1"),
        format!("/api/v2/patients/{patient_id}/clinical/prescriptions?limit=1"),
        format!("/api/v2/patients/{patient_id}/clinical/chart-entries?limit=1"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(path)
                    .header(AUTHORIZATION, auth_header.clone())
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("clinical list succeeds");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"].as_array().unwrap().len(), 1);
        assert_eq!(body["page"]["limit"], 1);
    }

    for path in [
        format!("/api/v2/patients/{patient_id}/chronicle"),
        format!("/api/v2/patients/{patient_id}/chronicle/print"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(path)
                    .header(AUTHORIZATION, auth_header.clone())
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("chronicle summary succeeds");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["patient"]["id"], patient_id);
        assert_eq!(body["data"]["notes"][0]["title"], "Review note");
        assert_eq!(
            body["data"]["problems"][0]["label"],
            "Essential hypertension"
        );
        assert_eq!(body["data"]["allergies"][0]["substance"], "Penicillin");
        assert_eq!(
            body["data"]["prescriptions"][0]["medication_name"],
            "Amlodipine"
        );
        assert_eq!(body["data"]["chart_entries"][0]["value"], "130/82");
    }

    let allergy_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/allergies/{allergy_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "substance": "Latex",
                        "reaction": "Wheezing",
                        "severity": "severe"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("allergy update succeeds");
    assert_eq!(allergy_update.status(), StatusCode::OK);
    let allergy_update_body = json_body(allergy_update).await;
    assert_eq!(allergy_update_body["data"]["substance"], "Latex");
    assert_eq!(allergy_update_body["data"]["severity"], "severe");

    let allergy_deactivate = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v2/clinical/allergies/{allergy_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("allergy deactivate succeeds");
    assert_eq!(allergy_deactivate.status(), StatusCode::OK);
    let allergy_deactivate_body = json_body(allergy_deactivate).await;
    assert_eq!(allergy_deactivate_body["data"]["status"], "inactive");

    let prescription_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/prescriptions/{prescription_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "dose": "10 mg",
                        "frequency": "twice daily",
                        "status": "stopped"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("prescription update succeeds");
    assert_eq!(prescription_update.status(), StatusCode::OK);
    let prescription_update_body = json_body(prescription_update).await;
    assert_eq!(prescription_update_body["data"]["dose"], "10 mg");
    assert_eq!(prescription_update_body["data"]["frequency"], "twice daily");
    assert_eq!(prescription_update_body["data"]["status"], "stopped");

    let prescription_hold = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/prescriptions/{prescription_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "status": "on_hold" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("prescription hold succeeds");
    assert_eq!(prescription_hold.status(), StatusCode::OK);
    let prescription_hold_body = json_body(prescription_hold).await;
    assert_eq!(prescription_hold_body["data"]["status"], "on_hold");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/notes?limit=1"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let denied_summary = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/patients/{patient_id}/chronicle"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("chronicle summary denial succeeds");
    assert_eq!(denied_summary.status(), StatusCode::FORBIDDEN);

    let denied_problem_status = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/clinical/problems/{problem_id}/status"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "status": "active" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("clinical problem status denial succeeds");
    assert_eq!(denied_problem_status.status(), StatusCode::FORBIDDEN);

    let denied_problem_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/problems/{problem_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "label": "Denied" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("clinical problem update denial succeeds");
    assert_eq!(denied_problem_update.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn laboratory_orders_specimens_results_and_verification_are_patient_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let catalog = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/test-catalog")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("catalog list succeeds");
    assert_eq!(catalog.status(), StatusCode::OK);
    let catalog_body = json_body(catalog).await;
    let test_id = catalog_body["data"][0]["id"]
        .as_str()
        .expect("test id exists");

    let test_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/test-catalog/{test_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("catalog detail succeeds");
    assert_eq!(test_detail.status(), StatusCode::OK);
    let test_detail_body = json_body(test_detail).await;
    assert_eq!(test_detail_body["data"]["id"], test_id);

    let panels = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/panels")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("panel list succeeds");
    assert_eq!(panels.status(), StatusCode::OK);
    let panels_body = json_body(panels).await;
    let panel_id = panels_body["data"][0]["id"]
        .as_str()
        .expect("panel id exists");

    let panel_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/panels/{panel_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("panel detail succeeds");
    assert_eq!(panel_detail.status(), StatusCode::OK);
    let panel_detail_body = json_body(panel_detail).await;
    assert_eq!(panel_detail_body["data"]["id"], panel_id);

    let order_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/orders")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "test_ids": [],
                        "panel_ids": [panel_id],
                        "priority": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("lab order create succeeds");
    assert_eq!(order_response.status(), StatusCode::OK);
    let order_body = json_body(order_response).await;
    let order_id = order_body["data"]["id"].as_str().expect("order id exists");
    assert_eq!(order_body["data"]["status"], "ordered");
    assert!(order_body["data"]["test_count"].as_i64().unwrap() >= 1);

    let submit_order = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/laboratory/orders/{order_id}/submit"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("order submit succeeds");
    assert_eq!(submit_order.status(), StatusCode::OK);
    let submit_order_body = json_body(submit_order).await;
    assert_eq!(submit_order_body["data"]["id"], order_id);
    assert_eq!(submit_order_body["data"]["status"], "ordered");

    let order_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/orders/{order_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("lab order detail succeeds");
    assert_eq!(order_detail.status(), StatusCode::OK);
    let order_detail_body = json_body(order_detail).await;
    assert_eq!(order_detail_body["data"]["id"], order_id);
    assert_eq!(order_detail_body["data"]["patient_id"], patient_id);
    let order_tests = order_detail_body["data"]["order_tests"]
        .as_array()
        .expect("order tests are included for result entry");
    assert!(!order_tests.is_empty());
    assert!(order_tests[0]["test"]["name"].is_string());

    let orders = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/orders?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("lab order list succeeds");
    assert_eq!(orders.status(), StatusCode::OK);
    let orders_body = json_body(orders).await;
    assert_eq!(orders_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(orders_body["page"]["limit"], 1);

    let ordered_orders = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/orders?status=ordered&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("status-filtered order list succeeds");
    assert_eq!(ordered_orders.status(), StatusCode::OK);
    let ordered_orders_body = json_body(ordered_orders).await;
    assert!(ordered_orders_body["data"]
        .as_array()
        .expect("orders are an array")
        .iter()
        .all(|order| order["status"] == "ordered"));

    let specimen_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/specimens")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": order_id,
                        "specimen_type": "blood"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("specimen create succeeds");
    assert_eq!(specimen_response.status(), StatusCode::OK);
    let specimen_body = json_body(specimen_response).await;
    let specimen_id = specimen_body["data"]["id"]
        .as_str()
        .expect("specimen id exists");
    assert_eq!(specimen_body["data"]["status"], "collected");

    let collect_order = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/laboratory/orders/{order_id}/collect"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("order collect succeeds");
    assert_eq!(collect_order.status(), StatusCode::OK);
    let collect_order_body = json_body(collect_order).await;
    assert_eq!(collect_order_body["data"]["id"], order_id);
    assert_eq!(collect_order_body["data"]["status"], "specimen_collected");

    let receive_specimen = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/specimens/{specimen_id}/receive"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("specimen receive succeeds");
    assert_eq!(receive_specimen.status(), StatusCode::OK);
    let receive_specimen_body = json_body(receive_specimen).await;
    assert_eq!(receive_specimen_body["data"]["id"], specimen_id);
    assert_eq!(receive_specimen_body["data"]["status"], "received");

    let start_processing_order = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/orders/{order_id}/start-processing"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("order processing start succeeds");
    assert_eq!(start_processing_order.status(), StatusCode::OK);
    let start_processing_order_body = json_body(start_processing_order).await;
    assert_eq!(start_processing_order_body["data"]["id"], order_id);
    assert_eq!(
        start_processing_order_body["data"]["status"],
        "result_entered"
    );

    let specimen_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/specimens/{specimen_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("specimen detail succeeds");
    assert_eq!(specimen_detail.status(), StatusCode::OK);
    let specimen_detail_body = json_body(specimen_detail).await;
    assert_eq!(specimen_detail_body["data"]["id"], specimen_id);
    assert_eq!(specimen_detail_body["data"]["order_id"], order_id);

    let specimens = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/specimens?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("specimen list succeeds");
    assert_eq!(specimens.status(), StatusCode::OK);

    let result_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "specimen_id": specimen_id,
                        "test_id": test_id,
                        "value": "negative",
                        "unit": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("result create succeeds");
    assert_eq!(result_response.status(), StatusCode::OK);
    let result_body = json_body(result_response).await;
    let result_id = result_body["data"]["id"]
        .as_str()
        .expect("result id exists");
    assert_eq!(result_body["data"]["status"], "entered");

    let result_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/results/{result_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("result detail succeeds");
    assert_eq!(result_detail.status(), StatusCode::OK);
    let result_detail_body = json_body(result_detail).await;
    assert_eq!(result_detail_body["data"]["id"], result_id);
    assert_eq!(result_detail_body["data"]["specimen_id"], specimen_id);

    let results = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/results?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("result list succeeds");
    assert_eq!(results.status(), StatusCode::OK);

    let unverified_results = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/results?is_verified=false&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("unverified result list succeeds");
    assert_eq!(unverified_results.status(), StatusCode::OK);
    let unverified_results_body = json_body(unverified_results).await;
    assert!(unverified_results_body["data"]
        .as_array()
        .expect("results are an array")
        .iter()
        .all(|result| result["verified_at"].is_null()));

    let bulk_verify = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results/bulk-verify")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": order_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("bulk result verification succeeds");
    assert_eq!(bulk_verify.status(), StatusCode::OK);
    let bulk_verify_body = json_body(bulk_verify).await;
    assert_eq!(bulk_verify_body["data"]["verified_count"], 1);

    let verify = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/laboratory/results/{result_id}/verify"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("result verification succeeds");
    assert_eq!(verify.status(), StatusCode::OK);
    let verify_body = json_body(verify).await;
    assert_eq!(verify_body["data"]["status"], "verified");
    assert!(verify_body["data"]["verified_at"].is_string());

    let bulk_order_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/orders")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "test_ids": [test_id],
                        "panel_ids": [],
                        "priority": "routine"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("bulk result lab order create succeeds");
    assert_eq!(bulk_order_response.status(), StatusCode::OK);
    let bulk_order_body = json_body(bulk_order_response).await;
    let bulk_order_id = bulk_order_body["data"]["id"]
        .as_str()
        .expect("bulk order id exists");

    let bulk_specimen_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/specimens")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": bulk_order_id,
                        "specimen_type": "blood"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("bulk result specimen create succeeds");
    assert_eq!(bulk_specimen_response.status(), StatusCode::OK);
    let bulk_specimen_body = json_body(bulk_specimen_response).await;
    let bulk_specimen_id = bulk_specimen_body["data"]["id"]
        .as_str()
        .expect("bulk specimen id exists");

    let bulk_result_create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results/bulk")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": bulk_order_id,
                        "specimen_id": bulk_specimen_id,
                        "results": [{
                            "order_test_id": test_id,
                            "value": "positive",
                            "unit": null
                        }]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("bulk result create succeeds");
    assert_eq!(bulk_result_create.status(), StatusCode::OK);
    let bulk_result_create_body = json_body(bulk_result_create).await;
    assert_eq!(bulk_result_create_body["data"]["created_count"], 1);
    assert_eq!(
        bulk_result_create_body["data"]["results"][0]["status"],
        "entered"
    );

    let cancel_order_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/orders")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "test_ids": [test_id],
                        "panel_ids": [],
                        "priority": "routine"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable lab order create succeeds");
    assert_eq!(cancel_order_response.status(), StatusCode::OK);
    let cancel_order_body = json_body(cancel_order_response).await;
    let cancel_order_id = cancel_order_body["data"]["id"]
        .as_str()
        .expect("cancel order id exists");

    let cancel_order = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/orders/{cancel_order_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "cancellation_reason": "Duplicate order"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("order cancel succeeds");
    assert_eq!(cancel_order.status(), StatusCode::OK);
    let cancel_order_body = json_body(cancel_order).await;
    assert_eq!(cancel_order_body["data"]["id"], cancel_order_id);
    assert_eq!(cancel_order_body["data"]["status"], "cancelled");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/laboratory/orders?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("laboratory denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let denied_order_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/laboratory/orders/{order_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("laboratory order detail denial succeeds");
    assert_eq!(denied_order_detail.status(), StatusCode::FORBIDDEN);

    let denied_order_action = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/orders/{order_id}/start-processing"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("laboratory order action denial succeeds");
    assert_eq!(denied_order_action.status(), StatusCode::FORBIDDEN);

    let denied_specimen_action = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/laboratory/specimens/{specimen_id}/receive"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("laboratory specimen action denial succeeds");
    assert_eq!(denied_specimen_action.status(), StatusCode::FORBIDDEN);

    let denied_bulk_verify = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results/bulk-verify")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": order_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("laboratory bulk verification denial succeeds");
    assert_eq!(denied_bulk_verify.status(), StatusCode::FORBIDDEN);

    let denied_bulk_create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/laboratory/results/bulk")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "order_id": bulk_order_id,
                        "specimen_id": bulk_specimen_id,
                        "results": [{
                            "order_test_id": test_id,
                            "value": "positive"
                        }]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("laboratory bulk result create denial succeeds");
    assert_eq!(denied_bulk_create.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn inventory_controlled_substances_and_pharmacy_dispensing_follow_access_rules() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);

    let items_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/items")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory item list succeeds");
    assert_eq!(items_response.status(), StatusCode::OK);
    let items_body = json_body(items_response).await;
    let items = items_body["data"].as_array().expect("items array exists");
    let paracetamol_id = items
        .iter()
        .find(|item| item["controlled"] == false)
        .and_then(|item| item["id"].as_str())
        .expect("normal item exists");
    let morphine_id = items
        .iter()
        .find(|item| item["controlled"] == true)
        .and_then(|item| item["id"].as_str())
        .expect("controlled item exists");

    let invalid_item_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/items/not-a-uuid")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("invalid inventory item detail route succeeds");
    assert_eq!(
        invalid_item_detail_response.status(),
        StatusCode::BAD_REQUEST
    );

    let item_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/items/{paracetamol_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory item detail succeeds");
    let item_detail_status = item_detail_response.status();
    let item_detail_body = json_body(item_detail_response).await;
    assert_eq!(item_detail_status, StatusCode::OK, "{item_detail_body}");
    assert_eq!(item_detail_body["data"]["id"], paracetamol_id);
    assert_eq!(item_detail_body["data"]["controlled"], false);

    let locations_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/storage-locations")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location list succeeds");
    assert_eq!(locations_response.status(), StatusCode::OK);
    let locations_body = json_body(locations_response).await;
    let locations = locations_body["data"]
        .as_array()
        .expect("locations array exists");
    let main_location_id = locations
        .iter()
        .find(|location| location["code"] == "MAIN")
        .and_then(|location| location["id"].as_str())
        .expect("main location exists");
    let pharmacy_location_id = locations
        .iter()
        .find(|location| location["code"] == "PHARM")
        .and_then(|location| location["id"].as_str())
        .expect("pharmacy location exists");

    let location_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/storage-locations/{pharmacy_location_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location detail succeeds");
    assert_eq!(location_detail_response.status(), StatusCode::OK);
    let location_detail_body = json_body(location_detail_response).await;
    assert_eq!(location_detail_body["data"]["id"], pharmacy_location_id);
    assert_eq!(location_detail_body["data"]["code"], "PHARM");
    assert_eq!(location_detail_body["data"]["name"], "Pharmacy Store");

    let batch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/stock-batches")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": paracetamol_id,
                        "location_id": pharmacy_location_id,
                        "batch_number": "B-001",
                        "expires_on": "2027-01-31",
                        "quantity_received": 100
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock batch create succeeds");
    assert_eq!(batch_response.status(), StatusCode::OK);
    let batch_body = json_body(batch_response).await;
    assert_eq!(batch_body["data"]["quantity_on_hand"], 100);

    let today = Utc::now().date_naive();
    for (batch_number, expires_on) in [
        ("EXP-API-001", today - Duration::days(1)),
        ("SOON-API-001", today + Duration::days(7)),
        ("LATER-API-001", today + Duration::days(60)),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/inventory/stock-batches")
                    .header(AUTHORIZATION, auth_header.clone())
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "item_id": paracetamol_id,
                            "location_id": pharmacy_location_id,
                            "batch_number": batch_number,
                            "expires_on": expires_on,
                            "quantity_received": 5
                        })
                        .to_string(),
                    ))
                    .expect("request builds"),
            )
            .await
            .expect("stock batch create succeeds");
        assert_eq!(response.status(), StatusCode::OK);
    }

    let expired_batches = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/stock-batches?expired=true&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("expired stock batches list succeeds");
    assert_eq!(expired_batches.status(), StatusCode::OK);
    let expired_batches_body = json_body(expired_batches).await;
    let expired_rows = expired_batches_body["data"]
        .as_array()
        .expect("expired batches are an array");
    assert!(expired_rows
        .iter()
        .any(|row| row["batch_number"] == "EXP-API-001"));
    assert!(
        !expired_rows
            .iter()
            .any(|row| row["batch_number"] == "SOON-API-001"
                || row["batch_number"] == "LATER-API-001")
    );

    let expiring_batches = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/stock-batches?expiring_within_days=30&limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("expiring stock batches list succeeds");
    assert_eq!(expiring_batches.status(), StatusCode::OK);
    let expiring_batches_body = json_body(expiring_batches).await;
    assert!(expiring_batches_body["data"]
        .as_array()
        .expect("expiring batches are an array")
        .iter()
        .any(|row| row["batch_number"] == "SOON-API-001"));
    assert!(!expiring_batches_body["data"]
        .as_array()
        .expect("expiring batches are an array")
        .iter()
        .any(|row| row["batch_number"] == "EXP-API-001" || row["batch_number"] == "LATER-API-001"));

    let item_batches = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items/{paracetamol_id}/stock-batches?limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("item stock batches list succeeds");
    assert_eq!(item_batches.status(), StatusCode::OK);
    let item_batches_body = json_body(item_batches).await;
    assert!(item_batches_body["data"]
        .as_array()
        .expect("item batches are an array")
        .iter()
        .any(|row| row["item_id"] == paracetamol_id && row["batch_number"] == "B-001"));

    let movements = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/stock-movements?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock movement list succeeds");
    assert_eq!(movements.status(), StatusCode::OK);
    let movements_body = json_body(movements).await;
    assert_eq!(movements_body["data"][0]["movement_type"], "receipt");

    let item_movements = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items/{paracetamol_id}/stock-movements?limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("item stock movements list succeeds");
    assert_eq!(item_movements.status(), StatusCode::OK);
    let item_movements_body = json_body(item_movements).await;
    assert_eq!(item_movements_body["data"][0]["item_id"], paracetamol_id);
    assert_eq!(item_movements_body["data"][0]["movement_type"], "receipt");

    let item_stock_by_location = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items/{paracetamol_id}/stock-by-location"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("item stock by location succeeds");
    assert_eq!(item_stock_by_location.status(), StatusCode::OK);
    let item_stock_by_location_body = json_body(item_stock_by_location).await;
    assert!(item_stock_by_location_body["data"]
        .as_array()
        .expect("stock by location is an array")
        .iter()
        .any(|row| row["item_id"] == paracetamol_id
            && row["location_id"] == pharmacy_location_id
            && row["quantity_on_hand"] == 115));

    let location_filtered_items = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/items?location={pharmacy_location_id}&limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location-filtered item list succeeds");
    assert_eq!(location_filtered_items.status(), StatusCode::OK);
    let location_filtered_items_body = json_body(location_filtered_items).await;
    assert_eq!(location_filtered_items_body["page"]["limit"], 10);
    let location_filtered_rows = location_filtered_items_body["data"]
        .as_array()
        .expect("location-filtered inventory items are an array");
    assert!(location_filtered_rows.iter().any(|row| {
        row["id"] == paracetamol_id && row["total_stock"] == 115 && row["sku"] == "PARA500"
    }));

    let location_stock = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/storage-locations/{pharmacy_location_id}/stock?limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location stock succeeds");
    assert_eq!(location_stock.status(), StatusCode::OK);
    let location_stock_body = json_body(location_stock).await;
    assert_eq!(location_stock_body["page"]["limit"], 10);
    assert!(location_stock_body["data"]
        .as_array()
        .expect("location stock is an array")
        .iter()
        .any(|row| row["item_id"] == paracetamol_id
            && row["location_id"] == pharmacy_location_id
            && row["quantity_on_hand"] == 115
            && row["batch_count"] == 4));

    let transfer_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/transfers")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": paracetamol_id,
                        "from_location_id": main_location_id,
                        "to_location_id": pharmacy_location_id,
                        "quantity": 5
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock transfer create succeeds");
    assert_eq!(transfer_response.status(), StatusCode::OK);
    let transfer_body = json_body(transfer_response).await;
    let transfer_id = transfer_body["data"]["id"]
        .as_str()
        .expect("transfer id exists");
    let transfer_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/transfers/{transfer_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock transfer detail succeeds");
    assert_eq!(transfer_detail_response.status(), StatusCode::OK);
    let transfer_detail_body = json_body(transfer_detail_response).await;
    assert_eq!(transfer_detail_body["data"]["id"], transfer_id);

    let requisition_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/requisitions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "requesting_location_id": pharmacy_location_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock requisition create succeeds");
    assert_eq!(requisition_response.status(), StatusCode::OK);
    let requisition_body = json_body(requisition_response).await;
    let requisition_id = requisition_body["data"]["id"]
        .as_str()
        .expect("requisition id exists");
    let requisition_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/requisitions/{requisition_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition detail succeeds");
    assert_eq!(requisition_detail_response.status(), StatusCode::OK);
    let requisition_detail_body = json_body(requisition_detail_response).await;
    assert_eq!(requisition_detail_body["data"]["id"], requisition_id);
    assert_eq!(requisition_detail_body["data"]["status"], "requested");

    let requisition_submit_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{requisition_id}/submit"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition submit succeeds");
    assert_eq!(requisition_submit_response.status(), StatusCode::OK);
    let requisition_submit_body = json_body(requisition_submit_response).await;
    assert_eq!(requisition_submit_body["data"]["id"], requisition_id);
    assert_eq!(requisition_submit_body["data"]["status"], "pending");

    let requisition_approve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{requisition_id}/approve"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition approve succeeds");
    assert_eq!(requisition_approve_response.status(), StatusCode::OK);
    let requisition_approve_body = json_body(requisition_approve_response).await;
    assert_eq!(requisition_approve_body["data"]["id"], requisition_id);
    assert_eq!(requisition_approve_body["data"]["status"], "approved");

    let requisition_fulfill_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{requisition_id}/fulfill"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition fulfill succeeds");
    assert_eq!(requisition_fulfill_response.status(), StatusCode::OK);
    let requisition_fulfill_body = json_body(requisition_fulfill_response).await;
    assert_eq!(requisition_fulfill_body["data"]["id"], requisition_id);
    assert_eq!(requisition_fulfill_body["data"]["status"], "fulfilled");

    let reject_requisition_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/requisitions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "requesting_location_id": pharmacy_location_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock requisition create for rejection succeeds");
    assert_eq!(reject_requisition_response.status(), StatusCode::OK);
    let reject_requisition_body = json_body(reject_requisition_response).await;
    let reject_requisition_id = reject_requisition_body["data"]["id"]
        .as_str()
        .expect("reject requisition id exists");
    let reject_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{reject_requisition_id}/reject"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "reason": "Duplicate ward stock request" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock requisition reject succeeds");
    assert_eq!(reject_response.status(), StatusCode::OK);
    let reject_body = json_body(reject_response).await;
    assert_eq!(reject_body["data"]["id"], reject_requisition_id);
    assert_eq!(reject_body["data"]["status"], "rejected");
    assert_eq!(
        reject_body["data"]["rejection_reason"],
        "Duplicate ward stock request"
    );
    assert!(reject_body["data"]["rejected_at"].is_string());

    let cancel_requisition_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/requisitions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "requesting_location_id": pharmacy_location_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock requisition create for cancellation succeeds");
    assert_eq!(cancel_requisition_response.status(), StatusCode::OK);
    let cancel_requisition_body = json_body(cancel_requisition_response).await;
    let cancel_requisition_id = cancel_requisition_body["data"]["id"]
        .as_str()
        .expect("cancel requisition id exists");
    let cancel_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{cancel_requisition_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock requisition cancel succeeds");
    assert_eq!(cancel_response.status(), StatusCode::OK);
    let cancel_body = json_body(cancel_response).await;
    assert_eq!(cancel_body["data"]["id"], cancel_requisition_id);
    assert_eq!(cancel_body["data"]["status"], "cancelled");
    assert!(cancel_body["data"]["cancelled_at"].is_string());

    let po_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/purchase-orders")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "supplier_name": "HMS Supplier" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("purchase order create succeeds");
    assert_eq!(po_response.status(), StatusCode::OK);
    let po_body = json_body(po_response).await;
    let purchase_order_id = po_body["data"]["id"]
        .as_str()
        .expect("purchase order id exists");
    let po_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/inventory/purchase-orders/{purchase_order_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("purchase order detail succeeds");
    assert_eq!(po_detail_response.status(), StatusCode::OK);
    let po_detail_body = json_body(po_detail_response).await;
    assert_eq!(po_detail_body["data"]["id"], purchase_order_id);
    assert_eq!(po_detail_body["data"]["status"], "draft");

    let po_approve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/purchase-orders/{purchase_order_id}/approve"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("purchase order approve succeeds");
    assert_eq!(po_approve_response.status(), StatusCode::OK);
    let po_approve_body = json_body(po_approve_response).await;
    assert_eq!(po_approve_body["data"]["id"], purchase_order_id);
    assert_eq!(po_approve_body["data"]["status"], "approved");

    let po_send_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/purchase-orders/{purchase_order_id}/send"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("purchase order send succeeds");
    assert_eq!(po_send_response.status(), StatusCode::OK);
    let po_send_body = json_body(po_send_response).await;
    assert_eq!(po_send_body["data"]["id"], purchase_order_id);
    assert_eq!(po_send_body["data"]["status"], "sent");

    let grn_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/goods-received-notes")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "purchase_order_id": purchase_order_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("GRN create succeeds");
    assert_eq!(grn_response.status(), StatusCode::OK);
    let grn_body = json_body(grn_response).await;
    let grn_id = grn_body["data"]["id"].as_str().expect("GRN id exists");
    assert_eq!(grn_body["data"]["status"], "pending_inspection");
    let grn_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/goods-received-notes/{grn_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("GRN detail succeeds");
    assert_eq!(grn_detail_response.status(), StatusCode::OK);
    let grn_detail_body = json_body(grn_detail_response).await;
    assert_eq!(grn_detail_body["data"]["id"], grn_id);
    assert_eq!(grn_detail_body["data"]["status"], "pending_inspection");

    let inventory_dashboard_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/dashboard-summary?expiring_within_days=30")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory dashboard summary succeeds");
    assert_eq!(inventory_dashboard_response.status(), StatusCode::OK);
    let inventory_dashboard = json_body(inventory_dashboard_response).await;
    assert!(
        inventory_dashboard["data"]["total_items"]
            .as_i64()
            .expect("inventory item count exists")
            >= items.len() as i64
    );
    assert!(
        inventory_dashboard["data"]["expiring_soon_count"]
            .as_i64()
            .expect("expiring count exists")
            >= 1
    );
    assert!(
        inventory_dashboard["data"]["pending_grns"]
            .as_i64()
            .expect("pending GRN count exists")
            >= 1
    );

    let grn_inspect_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/goods-received-notes/{grn_id}/inspect"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("GRN inspect succeeds");
    assert_eq!(grn_inspect_response.status(), StatusCode::OK);
    let grn_inspect_body = json_body(grn_inspect_response).await;
    assert_eq!(grn_inspect_body["data"]["id"], grn_id);
    assert_eq!(grn_inspect_body["data"]["status"], "inspecting");

    let grn_accept_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/goods-received-notes/{grn_id}/accept"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("GRN accept succeeds");
    assert_eq!(grn_accept_response.status(), StatusCode::OK);
    let grn_accept_body = json_body(grn_accept_response).await;
    assert_eq!(grn_accept_body["data"]["id"], grn_id);
    assert_eq!(grn_accept_body["data"]["status"], "accepted");

    let controlled_receipt = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/controlled-substances/register")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": morphine_id,
                        "location_id": pharmacy_location_id,
                        "movement_type": "receipt",
                        "quantity_delta": 10,
                        "witness_user_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled receipt succeeds");
    assert_eq!(controlled_receipt.status(), StatusCode::OK);

    let missing_witness = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/controlled-substances/register")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": morphine_id,
                        "location_id": pharmacy_location_id,
                        "movement_type": "dispense",
                        "quantity_delta": -1,
                        "witness_user_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled witness validation succeeds");
    assert_eq!(missing_witness.status(), StatusCode::BAD_REQUEST);

    let controlled_dispense = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/controlled-substances/register")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": morphine_id,
                        "location_id": pharmacy_location_id,
                        "movement_type": "dispense",
                        "quantity_delta": -1,
                        "witness_user_id": owner_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled dispense succeeds");
    assert_eq!(controlled_dispense.status(), StatusCode::OK);
    let controlled_body = json_body(controlled_dispense).await;
    let controlled_id = controlled_body["data"]["id"]
        .as_str()
        .expect("controlled register id exists");
    assert_eq!(controlled_body["data"]["balance_after"], 9);
    let controlled_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled register detail succeeds");
    assert_eq!(controlled_detail_response.status(), StatusCode::OK);
    let controlled_detail_body = json_body(controlled_detail_response).await;
    assert_eq!(controlled_detail_body["data"]["id"], controlled_id);

    let controlled_entries_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/entries?limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled register entries succeeds");
    assert_eq!(controlled_entries_response.status(), StatusCode::OK);
    let controlled_entries_body = json_body(controlled_entries_response).await;
    let controlled_entries = controlled_entries_body["data"]
        .as_array()
        .expect("controlled entries array exists");
    assert_eq!(controlled_entries.len(), 2);
    assert_eq!(controlled_entries[0]["entry_number"], 1);
    assert_eq!(controlled_entries[0]["entry_type"], "receipt");
    assert_eq!(controlled_entries[0]["balance_before"], 0);
    assert_eq!(controlled_entries[0]["balance_after"], 10);
    assert_eq!(controlled_entries[1]["entry_number"], 2);
    assert_eq!(controlled_entries[1]["entry_type"], "dispense");
    assert_eq!(controlled_entries[1]["quantity"], -1);
    assert_eq!(controlled_entries[1]["balance_before"], 10);
    assert_eq!(controlled_entries[1]["balance_after"], 9);

    let controlled_balance_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/balance-validation"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled register balance validation succeeds");
    assert_eq!(controlled_balance_response.status(), StatusCode::OK);
    let controlled_balance_body = json_body(controlled_balance_response).await;
    assert_eq!(
        controlled_balance_body["data"]["register_id"],
        controlled_id
    );
    assert_eq!(controlled_balance_body["data"]["current_balance"], 9);
    assert_eq!(controlled_balance_body["data"]["computed_balance"], 9);
    assert_eq!(controlled_balance_body["data"]["valid"], true);

    let controlled_count_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/counts"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "actual_count": 8,
                        "witness_user_id": owner_id,
                        "notes": "non-PHI controlled count test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled count succeeds");
    assert_eq!(controlled_count_response.status(), StatusCode::OK);
    let controlled_count_body = json_body(controlled_count_response).await;
    let controlled_count_id = controlled_count_body["data"]["id"]
        .as_str()
        .expect("controlled count entry id exists");
    assert_eq!(controlled_count_body["data"]["movement_type"], "count");
    assert_eq!(controlled_count_body["data"]["quantity_delta"], -1);
    assert_eq!(controlled_count_body["data"]["balance_after"], 8);
    assert_eq!(controlled_count_body["data"]["current_balance"], 8);
    assert_eq!(controlled_count_body["data"]["has_discrepancy"], true);
    assert_eq!(controlled_count_body["data"]["discrepancy_count"], 1);

    let controlled_register_list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/pharmacy/controlled-substances/register?limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("controlled register summary list succeeds");
    assert_eq!(controlled_register_list_response.status(), StatusCode::OK);
    let controlled_register_list_body = json_body(controlled_register_list_response).await;
    let controlled_summary = controlled_register_list_body["data"]
        .as_array()
        .expect("controlled register summary array exists")
        .iter()
        .find(|row| row["id"] == controlled_count_id)
        .expect("latest controlled register summary exists");
    assert_eq!(controlled_summary["location_name"], "Pharmacy Store");
    assert_eq!(controlled_summary["current_balance"], 8);
    assert_eq!(controlled_summary["entry_count"], 3);
    assert_eq!(controlled_summary["total_received"], 10);
    assert_eq!(controlled_summary["total_dispensed"], 1);
    assert_eq!(controlled_summary["has_discrepancy"], true);
    assert_eq!(controlled_summary["discrepancy_count"], 1);

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let dispense_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/pharmacy/dispenses")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "item_id": paracetamol_id,
                        "location_id": pharmacy_location_id,
                        "quantity": 2
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("pharmacy dispense succeeds");
    assert_eq!(dispense_response.status(), StatusCode::OK);
    let dispense_body = json_body(dispense_response).await;
    assert_eq!(dispense_body["data"]["status"], "dispensed");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let detail_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/inventory/items/{paracetamol_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory item detail denial succeeds");
    assert_eq!(detail_denied.status(), StatusCode::FORBIDDEN);

    for denied_path in [
        format!("/api/v2/inventory/items/{paracetamol_id}/stock-batches?limit=1"),
        format!("/api/v2/inventory/items/{paracetamol_id}/stock-movements?limit=1"),
        format!("/api/v2/inventory/items/{paracetamol_id}/stock-by-location"),
        format!("/api/v2/inventory/items?location={pharmacy_location_id}&limit=1"),
        format!("/api/v2/inventory/storage-locations/{pharmacy_location_id}"),
        format!("/api/v2/inventory/storage-locations/{pharmacy_location_id}/stock?limit=1"),
        format!("/api/v2/inventory/transfers/{transfer_id}"),
        format!("/api/v2/inventory/requisitions/{requisition_id}"),
        format!("/api/v2/inventory/purchase-orders/{purchase_order_id}"),
        format!("/api/v2/inventory/goods-received-notes/{grn_id}"),
        format!("/api/v2/pharmacy/controlled-substances/register/{controlled_id}"),
        format!("/api/v2/pharmacy/controlled-substances/register/{controlled_id}/entries?limit=1"),
        format!(
            "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/balance-validation"
        ),
    ] {
        let denied_detail = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(denied_path)
                    .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("inventory detail denial succeeds");
        assert_eq!(denied_detail.status(), StatusCode::FORBIDDEN);
    }

    let count_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/pharmacy/controlled-substances/register/{controlled_id}/counts"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "actual_count": 8,
                        "witness_user_id": owner_id,
                        "notes": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("controlled count denial succeeds");
    assert_eq!(count_denied.status(), StatusCode::FORBIDDEN);

    let reject_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/inventory/requisitions/{requisition_id}/reject"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "reason": "No access" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("requisition reject denial succeeds");
    assert_eq!(reject_denied.status(), StatusCode::FORBIDDEN);

    for denied_path in [
        format!("/api/v2/inventory/requisitions/{requisition_id}/approve"),
        format!("/api/v2/inventory/requisitions/{requisition_id}/fulfill"),
        format!("/api/v2/inventory/requisitions/{requisition_id}/cancel"),
        format!("/api/v2/inventory/purchase-orders/{purchase_order_id}/approve"),
        format!("/api/v2/inventory/purchase-orders/{purchase_order_id}/send"),
        format!("/api/v2/inventory/goods-received-notes/{grn_id}/inspect"),
        format!("/api/v2/inventory/goods-received-notes/{grn_id}/accept"),
    ] {
        let denied_action = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(denied_path)
                    .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("inventory action denial succeeds");
        assert_eq!(denied_action.status(), StatusCode::FORBIDDEN);
    }

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/stock-batches?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn billing_and_nhis_workflows_are_patient_scoped_and_cash_controlled() {
    let app = app().await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;

    let prices_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/service-prices")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("service prices request succeeds");
    assert_eq!(prices_response.status(), StatusCode::OK);
    let prices = json_body(prices_response).await;
    let service_price_id = prices["data"][0]["id"]
        .as_str()
        .expect("seed service price exists")
        .to_owned();

    let drawers_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/cash-drawers")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("cash drawers request succeeds");
    assert_eq!(drawers_response.status(), StatusCode::OK);
    let drawers = json_body(drawers_response).await;
    let drawer_id = drawers["data"][0]["id"]
        .as_str()
        .expect("seed cash drawer exists")
        .to_owned();

    let stale_sessions_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/cash-sessions?limit=100")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("cash session list succeeds");
    assert_eq!(stale_sessions_response.status(), StatusCode::OK);
    let stale_sessions = json_body(stale_sessions_response).await;
    for session in stale_sessions["data"]
        .as_array()
        .expect("sessions are an array")
    {
        if session["drawer_id"].as_str() == Some(drawer_id.as_str())
            && session["status"].as_str() == Some("open")
        {
            let stale_id = session["id"].as_str().expect("stale session id exists");
            let expected = session["expected_cash_minor"]
                .as_i64()
                .expect("expected cash exists");
            let close_stale_response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri(format!("/api/v2/billing/cash-sessions/{stale_id}/close"))
                        .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                        .header("content-type", "application/json")
                        .body(Body::from(
                            json!({ "counted_cash_minor": expected }).to_string(),
                        ))
                        .expect("request builds"),
                )
                .await
                .expect("stale cash session close succeeds");
            assert_eq!(close_stale_response.status(), StatusCode::OK);
        }
    }

    let open_session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/billing/cash-sessions")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "drawer_id": drawer_id,
                        "opening_float_minor": 1_000
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cash session open succeeds");
    let open_session_status = open_session_response.status();
    let open_session = json_body(open_session_response).await;
    assert_eq!(
        open_session_status,
        StatusCode::OK,
        "cash session open response: {open_session}"
    );
    let session_id = open_session["data"]["id"]
        .as_str()
        .expect("cash session id exists")
        .to_owned();

    let open_sessions_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/cash-sessions?status=open&limit=5")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("open cash sessions list succeeds");
    assert_eq!(open_sessions_response.status(), StatusCode::OK);
    let open_sessions = json_body(open_sessions_response).await;
    assert!(open_sessions["data"]
        .as_array()
        .expect("open cash sessions are an array")
        .iter()
        .any(|row| row["id"] == session_id && row["status"] == "open"));

    let session_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/cash-sessions/{session_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("cash session detail succeeds");
    assert_eq!(session_detail_response.status(), StatusCode::OK);
    let session_detail = json_body(session_detail_response).await;
    assert_eq!(session_detail["data"]["id"], session_id);
    assert_eq!(session_detail["data"]["status"], "open");

    let patients_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patients request succeeds");
    assert_eq!(patients_response.status(), StatusCode::OK);
    let patients = json_body(patients_response).await;
    let patient_id = patients["data"][0]["id"]
        .as_str()
        .expect("seed patient exists")
        .to_owned();

    let invoice_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/billing/invoices")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service_price_id": service_price_id,
                        "quantity": 2
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("invoice create succeeds");
    assert_eq!(invoice_response.status(), StatusCode::OK);
    let invoice = json_body(invoice_response).await;
    assert_eq!(invoice["data"]["status"], "issued");
    let invoice_id = invoice["data"]["id"]
        .as_str()
        .expect("invoice id exists")
        .to_owned();
    let gross_amount = invoice["data"]["gross_amount_minor"]
        .as_i64()
        .expect("invoice amount exists");
    assert!(gross_amount > 0);

    let invoice_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/invoices/{invoice_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("invoice detail succeeds");
    assert_eq!(invoice_detail_response.status(), StatusCode::OK);
    let invoice_detail = json_body(invoice_detail_response).await;
    assert_eq!(invoice_detail["data"]["id"], invoice_id);
    assert_eq!(invoice_detail["data"]["patient_id"], patient_id);
    assert_eq!(invoice_detail["data"]["gross_amount_minor"], gross_amount);

    let payment_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/billing/payments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "invoice_id": invoice_id,
                        "amount_minor": gross_amount,
                        "method": "cash",
                        "cash_session_id": session_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("payment create succeeds");
    assert_eq!(payment_response.status(), StatusCode::OK);
    let payment = json_body(payment_response).await;
    assert_eq!(payment["data"]["method"], "cash");
    let payment_id = payment["data"]["id"]
        .as_str()
        .expect("payment id exists")
        .to_owned();
    let receipt_number = payment["data"]["receipt_number"]
        .as_str()
        .expect("receipt number exists")
        .to_owned();

    let receipts_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/receipts?limit=1")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("receipts request succeeds");
    assert_eq!(receipts_response.status(), StatusCode::OK);
    let receipts = json_body(receipts_response).await;
    assert_eq!(receipts["data"][0]["amount_minor"], gross_amount);
    let receipt_id = receipts["data"][0]["id"]
        .as_str()
        .expect("receipt id exists")
        .to_owned();
    assert_eq!(receipts["data"][0]["payment_id"], payment_id);
    assert_eq!(receipts["data"][0]["receipt_number"], receipt_number);

    let receipt_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/receipts/{receipt_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("receipt detail succeeds");
    assert_eq!(receipt_detail_response.status(), StatusCode::OK);
    let receipt_detail = json_body(receipt_detail_response).await;
    assert_eq!(receipt_detail["data"]["id"], receipt_id);
    assert_eq!(receipt_detail["data"]["payment_id"], payment_id);
    assert_eq!(receipt_detail["data"]["invoice_id"], invoice_id);

    let receipt_by_number_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/billing/receipts/by-number/{receipt_number}"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("receipt by number succeeds");
    assert_eq!(receipt_by_number_response.status(), StatusCode::OK);
    let receipt_by_number = json_body(receipt_by_number_response).await;
    assert_eq!(receipt_by_number["data"]["id"], receipt_id);
    assert_eq!(receipt_by_number["data"]["receipt_number"], receipt_number);

    let receipt_by_payment_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/billing/payments/{payment_id}/receipt"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("receipt by payment succeeds");
    assert_eq!(receipt_by_payment_response.status(), StatusCode::OK);
    let receipt_by_payment = json_body(receipt_by_payment_response).await;
    assert_eq!(receipt_by_payment["data"]["id"], receipt_id);
    assert_eq!(receipt_by_payment["data"]["payment_id"], payment_id);

    let patient_invoices_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/billing/invoices?limit=10&patient_id={patient_id}"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient invoice list succeeds");
    assert_eq!(patient_invoices_response.status(), StatusCode::OK);
    let patient_invoices = json_body(patient_invoices_response).await;
    assert_eq!(patient_invoices["data"][0]["patient_id"], patient_id);

    let missing_patient_id = Uuid::new_v4();
    let missing_patient_invoices = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/billing/invoices?limit=10&patient_id={missing_patient_id}"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("missing patient invoice list succeeds");
    assert_eq!(missing_patient_invoices.status(), StatusCode::NOT_FOUND);

    let claim_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nhis/claims")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "invoice_id": invoice_id }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("claim create succeeds");
    assert_eq!(claim_response.status(), StatusCode::OK);
    let claim = json_body(claim_response).await;
    let claim_id = claim["data"]["id"]
        .as_str()
        .expect("claim id exists")
        .to_owned();
    assert_eq!(claim["data"]["amount_minor"], gross_amount);

    let claim_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/nhis/claims/{claim_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("claim detail succeeds");
    assert_eq!(claim_detail_response.status(), StatusCode::OK);
    let claim_detail = json_body(claim_detail_response).await;
    assert_eq!(claim_detail["data"]["id"], claim_id);
    assert_eq!(claim_detail["data"]["invoice_id"], invoice_id);
    assert_eq!(claim_detail["data"]["patient_id"], patient_id);
    assert_eq!(claim_detail["data"]["amount_minor"], gross_amount);

    let dashboard_summary_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/dashboard-summary")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("billing dashboard summary succeeds");
    assert_eq!(dashboard_summary_response.status(), StatusCode::OK);
    let dashboard_summary = json_body(dashboard_summary_response).await;
    assert!(
        dashboard_summary["data"]["revenue_today_minor"]
            .as_i64()
            .expect("revenue today exists")
            >= gross_amount
    );
    assert!(
        dashboard_summary["data"]["revenue_this_week_minor"]
            .as_i64()
            .expect("week revenue exists")
            >= gross_amount
    );
    assert!(
        dashboard_summary["data"]["pending_claims"]
            .as_i64()
            .expect("pending claims count exists")
            >= 1
    );
    assert!(
        dashboard_summary["data"]["pending_claims_amount_minor"]
            .as_i64()
            .expect("pending claims amount exists")
            >= gross_amount
    );
    assert!(
        dashboard_summary["data"]["invoices_created_today"]
            .as_i64()
            .expect("today invoice count exists")
            >= 1
    );
    assert!(
        dashboard_summary["data"]["payments_received_today"]
            .as_i64()
            .expect("today payment count exists")
            >= 1
    );
    assert!(
        dashboard_summary["data"]["unique_patients_billed"]
            .as_i64()
            .expect("unique patients count exists")
            >= 1
    );

    let batch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nhis/batches")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "claim_ids": [claim_id] }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("batch create succeeds");
    assert_eq!(batch_response.status(), StatusCode::OK);
    let batch = json_body(batch_response).await;
    let batch_id = batch["data"]["id"]
        .as_str()
        .expect("batch id exists")
        .to_owned();
    assert_eq!(batch["data"]["claim_count"], 1);

    let export_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/nhis/batches/{batch_id}/export"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("batch export succeeds");
    assert_eq!(export_response.status(), StatusCode::OK);
    let export_body = json_body(export_response).await;
    assert_eq!(export_body["data"]["claim_count"], 1);
    assert!(export_body["data"]["checksum"].as_str().is_some());

    let remittance_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nhis/remittance-imports")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "batch_id": batch_id,
                        "reference": format!("NHIS-REM-{batch_id}"),
                        "total_paid_minor": gross_amount
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("remittance create succeeds");
    assert_eq!(remittance_response.status(), StatusCode::OK);

    let close_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/billing/cash-sessions/{session_id}/close"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "counted_cash_minor": gross_amount + 1_000 }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cash session close succeeds");
    assert_eq!(close_response.status(), StatusCode::OK);
    let close_body = json_body(close_response).await;
    assert_eq!(close_body["data"]["status"], "closed");
    assert_eq!(close_body["data"]["variance_minor"], 0);

    let limited_response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/billing/invoices?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("billing denial succeeds");
    let limited_status = limited_response.status();
    let limited_body = json_body(limited_response).await;
    assert_eq!(limited_status, StatusCode::FORBIDDEN, "{limited_body}");
}

#[tokio::test]
async fn admin_authority_workflows_are_permission_scoped_and_audited() {
    let app = app().await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/org-units?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admin denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let units = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/org-units?limit=5")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org units list succeeds");
    assert_eq!(units.status(), StatusCode::OK);
    let units_body = json_body(units).await;
    assert!(
        units_body["data"]
            .as_array()
            .expect("units are array")
            .len()
            <= 5
    );
    assert!(units_body["page"]["limit"].as_u64().unwrap() <= 5);

    let facility_units = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/org-units?unit_type=facility&is_active=true&limit=10")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("facility org units list succeeds");
    assert_eq!(facility_units.status(), StatusCode::OK);
    let facility_units_body = json_body(facility_units).await;
    let facility_units_data = facility_units_body["data"]
        .as_array()
        .expect("facility units are array");
    assert!(!facility_units_data.is_empty());
    assert!(facility_units_data.iter().all(|unit| {
        unit["unit_type"] == "facility" && unit["is_active"].as_bool() == Some(true)
    }));

    let org_unit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/org-units")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_ADMIN",
                        "name": "Laboratory Administration",
                        "unit_type": "department",
                        "parent_unit_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("org unit create succeeds");
    assert_eq!(org_unit.status(), StatusCode::OK);
    let org_unit_body = json_body(org_unit).await;
    let org_unit_id = org_unit_body["data"]["id"].as_str().expect("org unit id");

    let org_unit_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/org-units/{org_unit_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit detail succeeds");
    assert_eq!(org_unit_detail.status(), StatusCode::OK);
    let org_unit_detail_body = json_body(org_unit_detail).await;
    assert_eq!(org_unit_detail_body["data"]["id"], org_unit_id);

    let child_org_unit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/org-units")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_ADMIN_CHILD",
                        "name": "Laboratory Administration Child",
                        "unit_type": "service",
                        "parent_unit_id": org_unit_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("child org unit create succeeds");
    assert_eq!(child_org_unit.status(), StatusCode::OK);
    let child_org_unit_body = json_body(child_org_unit).await;
    let child_org_unit_id = child_org_unit_body["data"]["id"]
        .as_str()
        .expect("child org unit id");

    let grandchild_org_unit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/org-units")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_ADMIN_GRANDCHILD",
                        "name": "Laboratory Administration Grandchild",
                        "unit_type": "ward",
                        "parent_unit_id": child_org_unit_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("grandchild org unit create succeeds");
    assert_eq!(grandchild_org_unit.status(), StatusCode::OK);
    let grandchild_org_unit_body = json_body(grandchild_org_unit).await;
    let grandchild_org_unit_id = grandchild_org_unit_body["data"]["id"]
        .as_str()
        .expect("grandchild org unit id");

    let org_unit_children = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/admin/org-units/{org_unit_id}/children?limit=5"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit children succeeds");
    assert_eq!(org_unit_children.status(), StatusCode::OK);
    let org_unit_children_body = json_body(org_unit_children).await;
    assert!(org_unit_children_body["data"]
        .as_array()
        .expect("org unit children are an array")
        .iter()
        .any(|child| child["id"] == child_org_unit_id));

    let org_unit_ancestors = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/admin/org-units/{grandchild_org_unit_id}/ancestors?limit=5"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit ancestors succeeds");
    assert_eq!(org_unit_ancestors.status(), StatusCode::OK);
    let org_unit_ancestors_body = json_body(org_unit_ancestors).await;
    let ancestor_ids: Vec<&str> = org_unit_ancestors_body["data"]
        .as_array()
        .expect("org unit ancestors are an array")
        .iter()
        .map(|ancestor| ancestor["id"].as_str().expect("ancestor id"))
        .collect();
    assert_eq!(ancestor_ids, vec![org_unit_id, child_org_unit_id]);

    let org_unit_descendants = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/admin/org-units/{org_unit_id}/descendants?limit=5"
                ))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit descendants succeeds");
    assert_eq!(org_unit_descendants.status(), StatusCode::OK);
    let org_unit_descendants_body = json_body(org_unit_descendants).await;
    let descendant_ids: Vec<&str> = org_unit_descendants_body["data"]
        .as_array()
        .expect("org unit descendants are an array")
        .iter()
        .map(|descendant| descendant["id"].as_str().expect("descendant id"))
        .collect();
    assert_eq!(
        descendant_ids,
        vec![child_org_unit_id, grandchild_org_unit_id]
    );

    let org_unit_detail_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/org-units/{org_unit_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("org unit detail denial succeeds");
    assert_eq!(org_unit_detail_denied.status(), StatusCode::FORBIDDEN);

    let template = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/position-templates")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_MANAGER",
                        "title": "Laboratory Manager",
                        "description": "Manages laboratory workflow authority.",
                        "permission_codes": ["laboratory.order.manage", "laboratory.result.verify"]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("position template create succeeds");
    assert_eq!(template.status(), StatusCode::OK);
    let template_body = json_body(template).await;
    let template_id = template_body["data"]["id"].as_str().expect("template id");

    let position = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/positions")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_MANAGER_01",
                        "title": "Laboratory Manager",
                        "org_unit_id": org_unit_id,
                        "template_id": template_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("position create succeeds");
    assert_eq!(position.status(), StatusCode::OK);
    let position_body = json_body(position).await;
    let position_id = position_body["data"]["id"].as_str().expect("position id");

    let appointment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/authority-appointments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "position_id": position_id,
                        "user_id": limited_id,
                        "appointment_type": "acting",
                        "starts_at": null,
                        "ends_at": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("authority appointment create succeeds");
    assert_eq!(appointment.status(), StatusCode::OK);

    let assignment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "dashboard.view",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "baseline_test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("permission assignment create succeeds");
    assert_eq!(assignment.status(), StatusCode::OK);

    let committee = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/committees")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "LAB_QA",
                        "name": "Laboratory Quality Committee",
                        "mandate": "Reviews laboratory quality incidents and corrective actions."
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("committee create succeeds");
    assert_eq!(committee.status(), StatusCode::OK);

    let delegation = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/delegations")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "delegator_user_id": owner_id,
                        "delegate_user_id": limited_id,
                        "permission_code": "patient.demographics.view",
                        "starts_at": null,
                        "ends_at": null,
                        "reason": "Duty cover"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("delegation create succeeds");
    assert_eq!(delegation.status(), StatusCode::OK);

    let audit_events = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/audit-events?limit=10")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("audit list succeeds");
    assert_eq!(audit_events.status(), StatusCode::OK);
    let audit_body = json_body(audit_events).await;
    let event_types: Vec<_> = audit_body["data"]
        .as_array()
        .expect("audit events are array")
        .iter()
        .filter_map(|event| event["event_type"].as_str())
        .collect();
    assert!(event_types.contains(&"admin.permission_assignment.created"));
    assert!(event_types.contains(&"admin.delegation.created"));
}

#[tokio::test]
async fn dashboards_notifications_and_realtime_are_profile_aware_and_phi_safe() {
    let app = app().await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/dashboards/snapshot")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("dashboard denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let snapshot = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/dashboards/snapshot")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("dashboard snapshot succeeds");
    assert_eq!(snapshot.status(), StatusCode::OK);
    let snapshot_body = json_body(snapshot).await;
    assert_eq!(snapshot_body["data"]["deployment_profile"], "hospital");
    let metric_keys: Vec<_> = snapshot_body["data"]["metrics"]
        .as_array()
        .expect("metrics are array")
        .iter()
        .filter_map(|metric| metric["key"].as_str())
        .collect();
    assert!(metric_keys.contains(&"active_patients"));
    assert!(snapshot_body["data"]["navigation"]["groups"].is_array());

    let notifications = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/notifications?limit=5&unread_only=true")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("notification list succeeds");
    assert_eq!(notifications.status(), StatusCode::OK);
    let notifications_body = json_body(notifications).await;
    let notification_id = notifications_body["data"][0]["id"]
        .as_str()
        .expect("seed notification exists");
    assert_eq!(
        notifications_body["data"][0]["title"],
        "HMS V2 foundation ready"
    );
    assert!(!notifications_body.to_string().contains("P-10001"));

    let read = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/notifications/{notification_id}/read"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "read": true }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("notification read succeeds");
    assert_eq!(read.status(), StatusCode::OK);
    let read_body = json_body(read).await;
    assert!(read_body["data"]["read_at"].is_string());

    let subscriptions = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/realtime/subscriptions")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("subscriptions list succeeds");
    assert_eq!(subscriptions.status(), StatusCode::OK);
    let subscriptions_body = json_body(subscriptions).await;
    let channel_names: Vec<_> = subscriptions_body["data"]
        .as_array()
        .expect("subscriptions are array")
        .iter()
        .filter_map(|subscription| subscription["channel_name"].as_str())
        .collect();
    assert!(channel_names
        .iter()
        .any(|name| name.ends_with(":dashboard")));
    let facility_id = Uuid::from_u128(hms_db::provision::FACILITY_ID).to_string();
    assert!(channel_names
        .iter()
        .all(|name| !name.contains(&facility_id)));
}

#[tokio::test]
async fn ward_admission_and_nursing_workflows_are_patient_access_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);

    let created_ward_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/wards")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "TEST-WARD",
                        "name": "Test Ward"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward create succeeds");
    assert_eq!(created_ward_response.status(), StatusCode::OK);
    let created_ward_body = json_body(created_ward_response).await;
    assert_eq!(created_ward_body["data"]["code"], "TEST-WARD");
    assert_eq!(created_ward_body["data"]["name"], "Test Ward");
    assert_eq!(created_ward_body["data"]["status"], "active");
    assert_eq!(created_ward_body["data"]["active_bed_count"], 0);
    let created_ward_id = created_ward_body["data"]["id"]
        .as_str()
        .expect("created ward id exists");
    let updated_ward_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/wards/{created_ward_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "TEST-WARD-RENAMED",
                        "name": "Renamed Test Ward",
                        "status": "inactive"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward update succeeds");
    assert_eq!(updated_ward_response.status(), StatusCode::OK);
    let updated_ward_body = json_body(updated_ward_response).await;
    assert_eq!(updated_ward_body["data"]["id"], created_ward_id);
    assert_eq!(updated_ward_body["data"]["code"], "TEST-WARD-RENAMED");
    assert_eq!(updated_ward_body["data"]["name"], "Renamed Test Ward");
    assert_eq!(updated_ward_body["data"]["status"], "inactive");

    let ward_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward list succeeds");
    assert_eq!(ward_response.status(), StatusCode::OK);
    let ward_body = json_body(ward_response).await;
    let ward_id = ward_body["data"][0]["id"].as_str().expect("ward id exists");

    let ward_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/{ward_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward detail succeeds");
    assert_eq!(ward_detail.status(), StatusCode::OK);
    let ward_detail_body = json_body(ward_detail).await;
    assert_eq!(ward_detail_body["data"]["id"], ward_id);

    let section_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/wards/{ward_id}/sections"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "EAST",
                        "name": "East Section"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward section create succeeds");
    assert_eq!(section_response.status(), StatusCode::OK);
    let section_body = json_body(section_response).await;
    let section_id = section_body["data"]["id"]
        .as_str()
        .expect("section id exists");

    let bed_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/wards/{ward_id}/beds"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "section_id": section_id,
                        "bed_code": "E-99"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward bed create succeeds");
    assert_eq!(bed_response.status(), StatusCode::OK);
    let bed_body = json_body(bed_response).await;
    let bed_id = bed_body["data"]["id"].as_str().expect("bed id exists");
    assert_eq!(bed_body["data"]["status"], "available");
    let updated_bed_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/wards/beds/{bed_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "section_id": section_id,
                        "bed_code": "E-100",
                        "status": "cleaning"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward bed update succeeds");
    assert_eq!(updated_bed_response.status(), StatusCode::OK);
    let updated_bed_body = json_body(updated_bed_response).await;
    assert_eq!(updated_bed_body["data"]["id"], bed_id);
    assert_eq!(updated_bed_body["data"]["bed_code"], "E-100");
    assert_eq!(updated_bed_body["data"]["status"], "cleaning");
    let updated_section_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/wards/sections/{section_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "EAST-RENAMED",
                        "name": "Renamed East Section",
                        "status": "inactive"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward section update succeeds");
    assert_eq!(updated_section_response.status(), StatusCode::OK);
    let updated_section_body = json_body(updated_section_response).await;
    assert_eq!(updated_section_body["data"]["id"], section_id);
    assert_eq!(updated_section_body["data"]["code"], "EAST-RENAMED");
    assert_eq!(updated_section_body["data"]["name"], "Renamed East Section");
    assert_eq!(updated_section_body["data"]["status"], "inactive");

    let bed_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/{ward_id}/beds?limit=10"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward beds list succeeds");
    assert_eq!(bed_list.status(), StatusCode::OK);
    let bed_list_body = json_body(bed_list).await;
    assert_eq!(bed_list_body["page"]["limit"], 10);

    let bed_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/beds/{bed_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward bed detail succeeds");
    assert_eq!(bed_detail.status(), StatusCode::OK);
    let bed_detail_body = json_body(bed_detail).await;
    assert_eq!(bed_detail_body["data"]["id"], bed_id);
    assert_eq!(bed_detail_body["data"]["section_id"], section_id);

    let section_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/{ward_id}/sections?limit=10"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward sections list succeeds");
    assert_eq!(section_list.status(), StatusCode::OK);
    let section_list_body = json_body(section_list).await;
    assert!(section_list_body["data"]
        .as_array()
        .expect("sections are an array")
        .iter()
        .any(|section| section["id"] == section_id));

    let section_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/sections/{section_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward section detail succeeds");
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_body = json_body(section_detail).await;
    assert_eq!(section_detail_body["data"]["id"], section_id);
    assert_eq!(section_detail_body["data"]["ward_id"], ward_id);

    let section_beds = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/sections/{section_id}/beds?limit=10"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward section beds list succeeds");
    assert_eq!(section_beds.status(), StatusCode::OK);
    let section_beds_body = json_body(section_beds).await;
    assert!(section_beds_body["data"]
        .as_array()
        .expect("section beds are an array")
        .iter()
        .any(|bed| bed["id"] == bed_id));

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=2")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");
    let case_patient_id = patient_body["data"][1]["id"]
        .as_str()
        .expect("case patient id exists");

    let admission_case_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions/cases")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": case_patient_id,
                        "ward_id": ward_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("admission case create succeeds");
    assert_eq!(admission_case_response.status(), StatusCode::OK);
    let admission_case_body = json_body(admission_case_response).await;
    let admission_case_id = admission_case_body["data"]["id"]
        .as_str()
        .expect("admission case id exists");
    assert_eq!(
        admission_case_body["data"]["status"],
        "ready_for_activation"
    );

    let admission_case_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/cases/{admission_case_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission case detail succeeds");
    assert_eq!(admission_case_detail.status(), StatusCode::OK);
    let admission_case_detail_body = json_body(admission_case_detail).await;
    assert_eq!(admission_case_detail_body["data"]["id"], admission_case_id);
    assert_eq!(
        admission_case_detail_body["data"]["patient_id"],
        case_patient_id
    );

    let reserve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{admission_case_id}/reserve-bed"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "bed_id": null }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("admission bed reservation succeeds");
    assert_eq!(reserve_response.status(), StatusCode::OK);
    let reserve_body = json_body(reserve_response).await;
    assert!(reserve_body["data"]["bed_id"].is_string());

    let inactive_admission_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/{admission_case_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inactive admission detail succeeds");
    assert_eq!(inactive_admission_detail.status(), StatusCode::NOT_FOUND);

    let activate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{admission_case_id}/activate"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission case activation succeeds");
    assert_eq!(activate_response.status(), StatusCode::OK);
    let activate_body = json_body(activate_response).await;
    assert_eq!(activate_body["data"]["status"], "admitted");

    let active_admission_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/{admission_case_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("active admission detail succeeds");
    assert_eq!(active_admission_detail.status(), StatusCode::OK);
    let active_admission_detail_body = json_body(active_admission_detail).await;
    assert_eq!(
        active_admission_detail_body["data"]["admission_id"],
        admission_case_id
    );
    assert_eq!(
        active_admission_detail_body["data"]["patient_id"],
        case_patient_id
    );
    assert_eq!(
        active_admission_detail_body["data"]["admission_status"],
        "admitted"
    );

    let cancellable_case = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions/cases")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "ward_id": ward_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable admission case create succeeds");
    assert_eq!(cancellable_case.status(), StatusCode::OK);
    let cancellable_case_body = json_body(cancellable_case).await;
    let cancellable_case_id = cancellable_case_body["data"]["id"]
        .as_str()
        .expect("cancellable admission case id exists");

    let cancel_case = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{cancellable_case_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission case cancel succeeds");
    assert_eq!(cancel_case.status(), StatusCode::OK);
    let cancel_case_body = json_body(cancel_case).await;
    assert_eq!(cancel_case_body["data"]["status"], "cancelled");

    let admission_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "ward_id": ward_id,
                        "bed_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("admission create succeeds");
    assert_eq!(admission_response.status(), StatusCode::OK);
    let admission_body = json_body(admission_response).await;
    let admission_id = admission_body["data"]["admission_id"]
        .as_str()
        .expect("admission id exists");
    assert_eq!(admission_body["data"]["admission_status"], "admitted");

    let board_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards/board?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward board succeeds");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_body = json_body(board_response).await;
    assert_eq!(board_body["data"].as_array().unwrap().len(), 1);

    let task_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/tasks")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id,
                        "task_type": "observation",
                        "due_at": "2026-05-10T11:00:00Z",
                        "assigned_to_user_id": owner_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("nursing task create succeeds");
    assert_eq!(task_response.status(), StatusCode::OK);
    let task_body = json_body(task_response).await;
    let task_id = task_body["data"]["id"].as_str().expect("task id exists");
    assert_eq!(task_body["data"]["status"], "open");

    let complete_task = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/nursing/tasks/{task_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("nursing task complete succeeds");
    assert_eq!(complete_task.status(), StatusCode::OK);
    let complete_task_body = json_body(complete_task).await;
    assert_eq!(complete_task_body["data"]["status"], "completed");

    let cancellable_task_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/tasks")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id,
                        "task_type": "observation",
                        "due_at": "2026-05-10T11:30:00Z",
                        "assigned_to_user_id": owner_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable nursing task create succeeds");
    assert_eq!(cancellable_task_response.status(), StatusCode::OK);
    let cancellable_task_body = json_body(cancellable_task_response).await;
    let cancellable_task_id = cancellable_task_body["data"]["id"]
        .as_str()
        .expect("task id exists");

    let cancel_task = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/nursing/tasks/{cancellable_task_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("nursing task cancel succeeds");
    assert_eq!(cancel_task.status(), StatusCode::OK);
    let cancel_task_body = json_body(cancel_task).await;
    assert_eq!(cancel_task_body["data"]["status"], "cancelled");

    let medication_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/medication-administrations")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id,
                        "medication_name": "Paracetamol",
                        "scheduled_at": "2026-05-10T12:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("medication administration create succeeds");
    assert_eq!(medication_response.status(), StatusCode::OK);
    let medication_body = json_body(medication_response).await;
    let medication_id = medication_body["data"]["id"]
        .as_str()
        .expect("medication administration id exists");
    assert_eq!(medication_body["data"]["status"], "scheduled");

    let administer_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/nursing/medication-administrations/{medication_id}/administer"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "witness_user_id": null }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("medication administration update succeeds");
    assert_eq!(administer_response.status(), StatusCode::OK);
    let administer_body = json_body(administer_response).await;
    assert_eq!(administer_body["data"]["status"], "administered");

    let handoff_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/handoffs")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "ward_id": ward_id,
                        "to_user_id": owner_id,
                        "shift_label": "day"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("handoff create succeeds");
    assert_eq!(handoff_response.status(), StatusCode::OK);
    let handoff_body = json_body(handoff_response).await;
    let handoff_id = handoff_body["data"]["id"]
        .as_str()
        .expect("handoff id exists");

    let complete_handoff = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/nursing/handoffs/{handoff_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("handoff complete succeeds");
    assert_eq!(complete_handoff.status(), StatusCode::OK);
    let handoff_complete_body = json_body(complete_handoff).await;
    assert_eq!(handoff_complete_body["data"]["status"], "completed");

    let sheet_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/treatment-sheets")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id,
                        "sheet_date": "2026-05-10"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("treatment sheet create succeeds");
    assert_eq!(sheet_response.status(), StatusCode::OK);
    let sheet_body = json_body(sheet_response).await;
    assert_eq!(sheet_body["data"]["status"], "active");

    let discharge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/discharges")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("discharge create succeeds");
    assert_eq!(discharge_response.status(), StatusCode::OK);
    let discharge_body = json_body(discharge_response).await;
    let discharge_id = discharge_body["data"]["id"]
        .as_str()
        .expect("discharge id exists");
    assert_eq!(discharge_body["data"]["status"], "requested");

    let discharge_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/discharges/{discharge_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("discharge detail succeeds");
    assert_eq!(discharge_detail.status(), StatusCode::OK);
    let discharge_detail_body = json_body(discharge_detail).await;
    assert_eq!(discharge_detail_body["data"]["id"], discharge_id);
    assert_eq!(
        discharge_detail_body["data"]["admission_case_id"],
        admission_id
    );

    let cancel_discharge = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/discharges/{discharge_id}/cancel"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "reason": "Patient discharge plan changed"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("discharge cancel succeeds");
    assert_eq!(cancel_discharge.status(), StatusCode::OK);
    let cancel_discharge_body = json_body(cancel_discharge).await;
    assert_eq!(cancel_discharge_body["data"]["status"], "cancelled");

    let admission_after_cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/{admission_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("active admission after discharge cancellation succeeds");
    assert_eq!(admission_after_cancel.status(), StatusCode::OK);
    let admission_after_cancel_body = json_body(admission_after_cancel).await;
    assert_eq!(
        admission_after_cancel_body["data"]["admission_status"],
        "admitted"
    );

    let discharge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/discharges")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("discharge recreate succeeds");
    assert_eq!(discharge_response.status(), StatusCode::OK);
    let discharge_body = json_body(discharge_response).await;
    assert_eq!(discharge_body["data"]["id"], discharge_id);
    assert_eq!(discharge_body["data"]["status"], "requested");

    let complete_discharge = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/discharges/{discharge_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("discharge complete succeeds");
    assert_eq!(complete_discharge.status(), StatusCode::OK);
    let complete_discharge_body = json_body(complete_discharge).await;
    assert_eq!(complete_discharge_body["data"]["status"], "completed");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/{ward_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward detail denial succeeds");
    assert_eq!(denied_detail.status(), StatusCode::FORBIDDEN);

    let bed_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/beds/{bed_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward bed detail denial succeeds");
    assert_eq!(bed_denied.status(), StatusCode::FORBIDDEN);

    let section_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/sections/{section_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward section detail denial succeeds");
    assert_eq!(section_denied.status(), StatusCode::FORBIDDEN);

    let admission_case_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/cases/{admission_case_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission case detail denial succeeds");
    assert_eq!(admission_case_denied.status(), StatusCode::FORBIDDEN);

    let active_admission_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/{admission_case_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("active admission detail denial succeeds");
    assert_eq!(active_admission_denied.status(), StatusCode::FORBIDDEN);

    let discharge_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/discharges/{discharge_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("discharge detail denial succeeds");
    assert_eq!(discharge_denied.status(), StatusCode::FORBIDDEN);

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards/board?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward board denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nursing_observations_alerts_fluids_and_stock_requests_are_patient_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists")
        .to_owned();

    let ward_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward list succeeds");
    assert_eq!(ward_response.status(), StatusCode::OK);
    let ward_body = json_body(ward_response).await;
    let ward_id = ward_body["data"][0]["id"]
        .as_str()
        .expect("ward id exists")
        .to_owned();

    let admission_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions/cases")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "ward_id": ward_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("admission case create succeeds");
    assert_eq!(admission_response.status(), StatusCode::OK);
    let admission_body = json_body(admission_response).await;
    let admission_case_id = admission_body["data"]["id"]
        .as_str()
        .expect("admission id exists")
        .to_owned();

    let activate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{admission_case_id}/activate"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission activation succeeds");
    assert_eq!(activate_response.status(), StatusCode::OK);

    let vitals_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/vitals")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "recorded_at": "2026-05-12T09:00:00Z",
                        "temperature_c": 37.5,
                        "systolic_bp": 120,
                        "diastolic_bp": 80,
                        "pulse": 88,
                        "respiratory_rate": 18,
                        "oxygen_saturation": 98
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("vitals create succeeds");
    assert_eq!(vitals_response.status(), StatusCode::OK);
    let vitals_body = json_body(vitals_response).await;
    assert_eq!(vitals_body["data"]["temperature_c"], 37.5);

    let stale_vitals_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/vitals")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "recorded_at": "2026-05-07T10:00:00Z",
                        "temperature_c": 36.8,
                        "systolic_bp": 118,
                        "diastolic_bp": 76,
                        "pulse": 72,
                        "respiratory_rate": 16,
                        "oxygen_saturation": 99
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stale vitals create succeeds");
    assert_eq!(stale_vitals_response.status(), StatusCode::OK);

    let vitals_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/nursing/vitals?limit=10&patient_id={patient_id}&admission_case_id={admission_case_id}&hours=48"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("vitals list succeeds");
    assert_eq!(vitals_list.status(), StatusCode::OK);
    let vitals_list_body = json_body(vitals_list).await;
    assert_eq!(vitals_list_body["page"]["limit"], 10);
    assert_eq!(vitals_list_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        vitals_list_body["data"][0]["patient_id"].as_str().unwrap(),
        patient_id
    );

    let alert_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/alerts")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "severity": "high",
                        "title": "High fever watch"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("alert create succeeds");
    assert_eq!(alert_response.status(), StatusCode::OK);
    let alert_body = json_body(alert_response).await;
    assert_eq!(alert_body["data"]["status"], "open");
    let alert_id = alert_body["data"]["id"].as_str().expect("alert id exists");

    let acknowledge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/nursing/alerts/{alert_id}/acknowledge"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("alert acknowledge succeeds");
    assert_eq!(acknowledge_response.status(), StatusCode::OK);
    let acknowledge_body = json_body(acknowledge_response).await;
    assert_eq!(acknowledge_body["data"]["status"], "acknowledged");

    let monitoring_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/monitoring-events")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "event_kind": "observation",
                        "summary": "Hourly observation completed",
                        "recorded_at": "2026-05-10T09:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("monitoring event create succeeds");
    assert_eq!(monitoring_response.status(), StatusCode::OK);

    let fluid_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/fluid-balance")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "recorded_at": "2026-05-10T10:00:00Z",
                        "intake_ml": 500,
                        "output_ml": 150
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("fluid balance create succeeds");
    assert_eq!(fluid_response.status(), StatusCode::OK);
    let fluid_body = json_body(fluid_response).await;
    assert_eq!(fluid_body["data"]["net_ml"], 350);

    let stock_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/ward-stock-requests")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "ward_id": ward_id,
                        "requested_item": "IV cannula",
                        "quantity_requested": 10
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock request create succeeds");
    assert_eq!(stock_response.status(), StatusCode::OK);
    let stock_body = json_body(stock_response).await;
    let stock_request_id = stock_body["data"]["id"]
        .as_str()
        .expect("stock request id exists");
    assert_eq!(stock_body["data"]["status"], "requested");

    let approve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/nursing/ward-stock-requests/{stock_request_id}/approve"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock approve succeeds");
    assert_eq!(approve_response.status(), StatusCode::OK);
    let approve_body = json_body(approve_response).await;
    assert_eq!(approve_body["data"]["status"], "approved");

    let fulfill_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/nursing/ward-stock-requests/{stock_request_id}/fulfill"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock fulfill succeeds");
    assert_eq!(fulfill_response.status(), StatusCode::OK);
    let fulfill_body = json_body(fulfill_response).await;
    assert_eq!(fulfill_body["data"]["status"], "fulfilled");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/nursing/vitals?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("nursing denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn referrals_sla_and_clinic_waitlist_are_patient_access_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists")
        .to_owned();

    let referral_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/referrals")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "to_service": "Medicine",
                        "priority": "urgent",
                        "reason": "Medical review"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("referral create succeeds");
    assert_eq!(referral_response.status(), StatusCode::OK);
    let referral_body = json_body(referral_response).await;
    assert_eq!(referral_body["data"]["status"], "sent");
    assert_eq!(referral_body["data"]["reason"], "Medical review");
    assert!(referral_body["data"]["sla_due_at"].is_string());
    let referral_id = referral_body["data"]["id"]
        .as_str()
        .expect("referral id exists");

    let accept_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/referrals/{referral_id}/accept"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "acceptance_notes": "Accepted for same-day review" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("referral accept succeeds");
    assert_eq!(accept_response.status(), StatusCode::OK);
    let accept_body = json_body(accept_response).await;
    assert_eq!(accept_body["data"]["status"], "accepted");
    assert_eq!(
        accept_body["data"]["acceptance_notes"],
        "Accepted for same-day review"
    );

    let detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/referrals/{referral_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral detail succeeds");
    assert_eq!(detail_response.status(), StatusCode::OK);
    let detail_body = json_body(detail_response).await;
    assert_eq!(detail_body["data"]["id"], referral_id);

    let sla_state_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/referrals/{referral_id}/sla-state"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral SLA state succeeds");
    assert_eq!(sla_state_response.status(), StatusCode::OK);
    let sla_state_body = json_body(sla_state_response).await;
    assert_eq!(sla_state_body["data"]["referral_id"], referral_id);
    assert_eq!(sla_state_body["data"]["status"], "accepted");

    let complete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/referrals/{referral_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "specialist_notes": "Specialist review completed",
                        "recommendations": "Continue current treatment"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("referral complete succeeds");
    assert_eq!(complete_response.status(), StatusCode::OK);
    let complete_body = json_body(complete_response).await;
    assert_eq!(complete_body["data"]["status"], "completed");
    assert_eq!(
        complete_body["data"]["specialist_notes"],
        "Specialist review completed"
    );

    let decline_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/referrals")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "to_service": "Surgery",
                        "priority": "routine",
                        "reason": "Surgical review"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("decline referral create succeeds");
    assert_eq!(decline_response.status(), StatusCode::OK);
    let decline_body = json_body(decline_response).await;
    let decline_referral_id = decline_body["data"]["id"]
        .as_str()
        .expect("decline referral id exists");
    let declined_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/referrals/{decline_referral_id}/decline"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "decline_reason": "Needs orthopedics instead" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("referral decline succeeds");
    assert_eq!(declined_response.status(), StatusCode::OK);
    let declined_body = json_body(declined_response).await;
    assert_eq!(declined_body["data"]["status"], "declined");
    assert_eq!(
        declined_body["data"]["decline_reason"],
        "Needs orthopedics instead"
    );

    let sla_dashboard_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/referrals/sla-dashboard")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral SLA dashboard succeeds");
    assert_eq!(sla_dashboard_response.status(), StatusCode::OK);
    let sla_dashboard_body = json_body(sla_dashboard_response).await;
    assert!(sla_dashboard_body["data"]["risk_summary"]["total"]
        .as_i64()
        .is_some());

    let waitlist_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/referrals/clinic-waitlist")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service": "Medicine",
                        "priority": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("waitlist create succeeds");
    assert_eq!(waitlist_response.status(), StatusCode::OK);
    let waitlist_body = json_body(waitlist_response).await;
    assert_eq!(waitlist_body["data"]["status"], "waiting");

    let offer_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/referrals/clinic-waitlist/offer-next")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "service": "Medicine" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("offer next succeeds");
    assert_eq!(offer_response.status(), StatusCode::OK);
    let offer_body = json_body(offer_response).await;
    assert_eq!(offer_body["data"]["status"], "offered");

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/referrals?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral list succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    assert_eq!(list_body["page"]["limit"], 1);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/referrals?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn consent_grants_are_patient_access_scoped_and_revocable() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists")
        .to_owned();

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/consents")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "scope": "referral_coordination",
                        "purpose": "Specialist referral coordination",
                        "expires_at": "2026-06-10T00:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("consent create succeeds");
    assert_eq!(create_response.status(), StatusCode::OK);
    let create_body = json_body(create_response).await;
    assert_eq!(create_body["data"]["status"], "active");
    assert_eq!(create_body["data"]["scope"], "referral_coordination");
    let consent_id = create_body["data"]["id"]
        .as_str()
        .expect("consent id exists");

    let revoke_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/consents/{consent_id}/revoke"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("consent revoke succeeds");
    assert_eq!(revoke_response.status(), StatusCode::OK);
    let revoke_body = json_body(revoke_response).await;
    assert_eq!(revoke_body["data"]["status"], "revoked");
    assert!(revoke_body["data"]["revoked_at"].is_string());

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/consents?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("consent list succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    assert_eq!(list_body["page"]["limit"], 1);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/consents?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("consent denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn care_workflows_use_cursor_lists_and_patient_scoped_access() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);

    let clinics = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/clinics?limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinics list succeeds");
    assert_eq!(clinics.status(), StatusCode::OK);
    let clinics_body = json_body(clinics).await;
    assert_eq!(clinics_body["page"]["limit"], 10);
    assert_eq!(clinics_body["data"][0]["code"], "general");
    assert_eq!(clinics_body["data"][0]["name"], "General Clinic");
    assert_eq!(clinics_body["data"][0]["is_active"], true);
    let clinic_id = clinics_body["data"][0]["id"]
        .as_str()
        .expect("clinic id exists");

    let clinic_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinics/{clinic_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinic detail succeeds");
    assert_eq!(clinic_detail.status(), StatusCode::OK);
    let clinic_detail_body = json_body(clinic_detail).await;
    assert_eq!(clinic_detail_body["data"]["id"], clinic_id);
    assert_eq!(clinic_detail_body["data"]["code"], "general");
    assert_eq!(clinic_detail_body["data"]["name"], "General Clinic");

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let appointment_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/appointments")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "starts_at": "2026-05-10T10:00:00Z",
                        "ends_at": "2026-05-10T10:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("appointment create succeeds");
    assert_eq!(appointment_response.status(), StatusCode::OK);
    let appointment_body = json_body(appointment_response).await;
    let appointment_id = appointment_body["data"]["id"]
        .as_str()
        .expect("appointment id exists");
    assert_eq!(appointment_body["data"]["status"], "scheduled");

    let appointment_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/appointments/{appointment_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("appointment detail succeeds");
    assert_eq!(appointment_detail.status(), StatusCode::OK);
    let appointment_detail_body = json_body(appointment_detail).await;
    assert_eq!(appointment_detail_body["data"]["id"], appointment_id);
    assert_eq!(appointment_detail_body["data"]["patient_id"], patient_id);

    let appointment_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/appointments/{appointment_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "starts_at": "2026-05-10T11:00:00Z",
                        "ends_at": "2026-05-10T11:45:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("appointment update succeeds");
    assert_eq!(appointment_update.status(), StatusCode::OK);
    let appointment_update_body = json_body(appointment_update).await;
    assert_eq!(
        appointment_update_body["data"]["starts_at"],
        "2026-05-10T11:00:00Z"
    );

    let appointments = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/appointments?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("appointments list succeeds");
    assert_eq!(appointments.status(), StatusCode::OK);
    let appointments_body = json_body(appointments).await;
    assert_eq!(appointments_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(appointments_body["page"]["limit"], 1);

    let appointment_to_cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/appointments")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "starts_at": "2026-05-10T12:00:00Z",
                        "ends_at": "2026-05-10T12:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancel appointment create succeeds");
    assert_eq!(appointment_to_cancel.status(), StatusCode::OK);
    let appointment_to_cancel_body = json_body(appointment_to_cancel).await;
    let appointment_to_cancel_id = appointment_to_cancel_body["data"]["id"]
        .as_str()
        .expect("cancel appointment id exists");

    let visit_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/visits/check-in")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "appointment_id": appointment_id,
                        "clinic_id": clinic_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("visit check-in succeeds");
    assert_eq!(visit_response.status(), StatusCode::OK);
    let visit_body = json_body(visit_response).await;
    let visit_id = visit_body["data"]["id"].as_str().expect("visit id exists");
    assert_eq!(visit_body["data"]["status"], "waiting");
    assert_eq!(visit_body["data"]["clinic_id"], clinic_id);

    for (path, expected_status) in [
        (format!("/api/v2/visits/{visit_id}/call"), "called"),
        (
            format!("/api/v2/visits/{visit_id}/start-consultation"),
            "in_consultation",
        ),
        (format!("/api/v2/visits/{visit_id}/hold"), "on_hold"),
        (
            format!("/api/v2/visits/{visit_id}/ready-checkout"),
            "ready_checkout",
        ),
        (format!("/api/v2/visits/{visit_id}/checkout"), "checked_out"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(path)
                    .header(AUTHORIZATION, auth_header.clone())
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("visit update succeeds");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["status"], expected_status);
    }

    let visits = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/visits?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("visits list succeeds");
    assert_eq!(visits.status(), StatusCode::OK);
    let visits_body = json_body(visits).await;
    assert_eq!(visits_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(visits_body["data"][0]["clinic_id"], clinic_id);

    let filtered_visits = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/visits?limit=10&clinic_id={clinic_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinic-filtered visits list succeeds");
    assert_eq!(filtered_visits.status(), StatusCode::OK);
    let filtered_visits_body = json_body(filtered_visits).await;
    assert_eq!(filtered_visits_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(filtered_visits_body["data"][0]["id"], visit_id);

    let other_clinic_visits = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/visits?limit=10&clinic_id={}",
                    Uuid::new_v4()
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("other clinic visits list succeeds");
    assert_eq!(other_clinic_visits.status(), StatusCode::OK);
    let other_clinic_visits_body = json_body(other_clinic_visits).await;
    assert_eq!(
        other_clinic_visits_body["data"].as_array().unwrap().len(),
        0
    );

    let no_show_visit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/visits/check-in")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "clinic_id": clinic_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("no-show visit check-in succeeds");
    assert_eq!(no_show_visit.status(), StatusCode::OK);
    let no_show_visit_body = json_body(no_show_visit).await;
    let no_show_visit_id = no_show_visit_body["data"]["id"]
        .as_str()
        .expect("no-show visit id exists");
    let no_show_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/visits/{no_show_visit_id}/no-show"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("visit no-show succeeds");
    assert_eq!(no_show_response.status(), StatusCode::OK);
    let no_show_body = json_body(no_show_response).await;
    assert_eq!(no_show_body["data"]["status"], "no_show");

    let triage_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/triage")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "visit_id": visit_id,
                        "acuity": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("triage create succeeds");
    assert_eq!(triage_response.status(), StatusCode::OK);
    let triage_body = json_body(triage_response).await;
    let triage_id = triage_body["data"]["id"]
        .as_str()
        .expect("triage id exists");
    assert_eq!(triage_body["data"]["status"], "waiting");

    let triage_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/triage/{triage_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("triage detail succeeds");
    assert_eq!(triage_detail.status(), StatusCode::OK);
    let triage_detail_body = json_body(triage_detail).await;
    assert_eq!(triage_detail_body["data"]["id"], triage_id);
    assert_eq!(triage_detail_body["data"]["patient_id"], patient_id);

    let triage_assessment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/triage/{triage_id}/assessment"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "acuity": "emergency",
                        "notes": "Chest pain and diaphoresis."
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("triage assessment succeeds");
    assert_eq!(triage_assessment.status(), StatusCode::OK);
    let triage_assessment_body = json_body(triage_assessment).await;
    assert_eq!(triage_assessment_body["data"]["status"], "completed");
    assert_eq!(triage_assessment_body["data"]["acuity"], "emergency");
    assert_eq!(
        triage_assessment_body["data"]["triage_notes"],
        "Chest pain and diaphoresis."
    );

    let triage_assign = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/triage/{triage_id}/assign"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "assigned_to_user_id": owner_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("triage assignment succeeds");
    assert_eq!(triage_assign.status(), StatusCode::OK);
    let triage_assign_body = json_body(triage_assign).await;
    assert_eq!(triage_assign_body["data"]["status"], "assigned");

    let cancellable_visit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/visits/check-in")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "clinic_id": clinic_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable visit check-in succeeds");
    assert_eq!(cancellable_visit.status(), StatusCode::OK);
    let cancellable_visit_body = json_body(cancellable_visit).await;
    let cancellable_visit_id = cancellable_visit_body["data"]["id"]
        .as_str()
        .expect("visit id exists");

    let cancellable_triage = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/triage")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "visit_id": cancellable_visit_id,
                        "acuity": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable triage create succeeds");
    assert_eq!(cancellable_triage.status(), StatusCode::OK);
    let cancellable_triage_body = json_body(cancellable_triage).await;
    let cancellable_triage_id = cancellable_triage_body["data"]["id"]
        .as_str()
        .expect("triage id exists");

    let triage_cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/triage/{cancellable_triage_id}/cancel"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("triage cancellation succeeds");
    assert_eq!(triage_cancel.status(), StatusCode::OK);
    let triage_cancel_body = json_body(triage_cancel).await;
    assert_eq!(triage_cancel_body["data"]["status"], "cancelled");

    let encounter_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/encounters")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "visit_id": visit_id,
                        "encounter_type": "outpatient"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("encounter create succeeds");
    assert_eq!(encounter_response.status(), StatusCode::OK);
    let encounter_body = json_body(encounter_response).await;
    let encounter_id = encounter_body["data"]["id"]
        .as_str()
        .expect("encounter id exists");
    assert_eq!(encounter_body["data"]["status"], "in_progress");

    let encounter_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/encounters/{encounter_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounter detail succeeds");
    assert_eq!(encounter_detail.status(), StatusCode::OK);
    let encounter_detail_body = json_body(encounter_detail).await;
    assert_eq!(encounter_detail_body["data"]["patient_id"], patient_id);

    let encounter_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/encounters/{encounter_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "encounter_type": "emergency"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("encounter update succeeds");
    assert_eq!(encounter_update.status(), StatusCode::OK);
    let encounter_update_body = json_body(encounter_update).await;
    assert_eq!(encounter_update_body["data"]["encounter_type"], "emergency");

    let care_team = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/encounters/{encounter_id}/care-team"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "user_id": owner_id,
                        "role": "primary_clinician"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("care-team assignment succeeds");
    assert_eq!(care_team.status(), StatusCode::OK);

    let care_team_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/encounters/{encounter_id}/care-team"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("care-team list succeeds");
    assert_eq!(care_team_list.status(), StatusCode::OK);
    let care_team_body = json_body(care_team_list).await;
    assert_eq!(care_team_body["data"].as_array().unwrap().len(), 1);

    let complete = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/encounters/{encounter_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounter complete succeeds");
    assert_eq!(complete.status(), StatusCode::OK);
    let complete_body = json_body(complete).await;
    assert_eq!(complete_body["data"]["status"], "completed");

    let encounters = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/encounters?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounters list succeeds");
    assert_eq!(encounters.status(), StatusCode::OK);

    let patient_encounters = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/encounters?limit=10&patient_id={patient_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient encounters list succeeds");
    assert_eq!(patient_encounters.status(), StatusCode::OK);
    let patient_encounters_body = json_body(patient_encounters).await;
    assert_eq!(patient_encounters_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(patient_encounters_body["data"][0]["patient_id"], patient_id);

    let missing_patient_id = Uuid::new_v4();
    let missing_patient_encounters = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/encounters?limit=10&patient_id={missing_patient_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("missing patient encounter list succeeds");
    assert_eq!(missing_patient_encounters.status(), StatusCode::NOT_FOUND);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied_patient_encounters = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/encounters?limit=10&patient_id={patient_id}"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient encounter list denial succeeds");
    assert_eq!(denied_patient_encounters.status(), StatusCode::FORBIDDEN);

    let denied_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/appointments/{appointment_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("appointment detail denial succeeds");
    assert_eq!(denied_detail.status(), StatusCode::FORBIDDEN);

    let denied_encounter_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/encounters/{encounter_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounter detail denial succeeds");
    assert_eq!(denied_encounter_detail.status(), StatusCode::FORBIDDEN);

    let cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/appointments/{appointment_to_cancel_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("appointment cancel succeeds");
    assert_eq!(cancel.status(), StatusCode::OK);
    let cancel_body = json_body(cancel).await;
    assert_eq!(cancel_body["data"]["status"], "cancelled");

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/appointments?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("care list denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
