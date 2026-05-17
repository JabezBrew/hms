#![allow(dead_code, unused_imports)]

pub use axum::body::{to_bytes, Body};
pub use axum::http::header::{AUTHORIZATION, COOKIE, SET_COOKIE};
pub use axum::http::HeaderMap;
pub use axum::http::{Method, Request, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
pub use chrono::{Duration, Utc};
use cookie::Cookie;
use hms_api::app::build_app;
pub use hms_api::config::Config;
use hms_api::extractors::RequestContext;
use hms_api::middleware::request_id;
use hms_api::state::AppState;
pub use hms_domain::deployment::DeploymentProfile;
pub use jsonwebtoken::{encode, EncodingKey, Header};
pub use serde_json::{json, Value};
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
pub use std::sync::Arc;
use std::task::{Context, Poll};
pub use tower::util::ServiceExt;
use tower::Service;
pub use uuid::Uuid;

const TEST_JWT_SECRET: &str = "test-only-hms-v2-jwt-secret";

#[derive(Clone)]
pub(crate) struct TestApp {
    router: axum::Router,
    _database: Arc<hms_db::test_support::TestDatabase>,
}

pub(crate) struct TestAppFuture<F> {
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

pub(crate) async fn app() -> TestApp {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    app_with_config(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await
}

pub(crate) async fn app_with_config(
    config: Config,
    database: Arc<hms_db::test_support::TestDatabase>,
) -> TestApp {
    let state = AppState::new(config).await.expect("test state initializes");
    TestApp {
        router: build_app(state),
        _database: database,
    }
}

pub(crate) async fn app_with_request_context_probe() -> TestApp {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let state = AppState::new(Config::for_tests_with_database_url(
        database.database_url().to_owned(),
    ))
    .await
    .expect("test state initializes");
    let probe = Router::new()
        .route("/__test/request-context", get(request_context_probe))
        .with_state(state.clone());
    TestApp {
        router: build_app(state.clone())
            .merge(probe)
            .layer(axum::middleware::from_fn_with_state(
                state,
                request_id::layer,
            )),
        _database: database,
    }
}

async fn request_context_probe(RequestContext(ctx): RequestContext) -> axum::Json<Value> {
    let permissions = ctx
        .permissions
        .iter()
        .map(|permission| serde_json::to_value(permission).expect("permission serializes"))
        .collect::<Vec<_>>();
    let enabled_features = ctx
        .enabled_features
        .iter()
        .map(|feature| serde_json::to_value(feature).expect("feature serializes"))
        .collect::<Vec<_>>();
    axum::Json(json!({
        "request_id": ctx.request_id,
        "user_id": ctx.user_id,
        "session_id": ctx.session_id,
        "facility_id": ctx.facility_id,
        "facility_code": ctx.facility_code,
        "active_profile": ctx.active_profile,
        "enabled_features": enabled_features,
        "permissions": permissions,
        "patient_visibility": ctx.patient_visibility,
        "active_authorities": ctx.active_authorities,
        "session_version": ctx.session_version,
        "permission_version": ctx.permission_version,
        "offsite": format!("{:?}", ctx.offsite),
        "reauth_fresh": ctx.reauth.is_fresh_at(Utc::now()),
    }))
}

pub(crate) async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body reads");
    serde_json::from_slice(&bytes).expect("response body is json")
}

pub(crate) async fn login(app: TestApp, email: &str) -> (String, String, String) {
    login_with_password(app, email, "ChangeMe123!").await
}

pub(crate) async fn login_with_password(
    app: TestApp,
    email: &str,
    password: &str,
) -> (String, String, String) {
    login_with_password_and_device(app, email, password, None).await
}

pub(crate) async fn login_with_password_and_device(
    app: TestApp,
    email: &str,
    password: &str,
    device_label: Option<&str>,
) -> (String, String, String) {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/api/v2/auth/login")
        .header("content-type", "application/json");
    if let Some(device_label) = device_label {
        request = request.header("x-device-label", device_label);
    }

    let response = app
        .oneshot(
            request
                .body(Body::from(
                    json!({
                        "email": email,
                        "password": password,
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

pub(crate) fn token_with_stale_reauth(access_token: &str) -> String {
    let mut claims = hms_auth::verify_access_token(TEST_JWT_SECRET, access_token)
        .expect("test access token verifies");
    claims.iat = (Utc::now() - Duration::minutes(16)).timestamp() as usize;
    claims.exp = (Utc::now() + Duration::minutes(5)).timestamp() as usize;
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .expect("stale reauth test token encodes")
}

pub(crate) fn auth_cookies(headers: &HeaderMap) -> (String, String) {
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
