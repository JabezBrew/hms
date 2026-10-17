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
pub use hms_api::state::AccountSetupDeliveryPurpose;
use hms_api::state::AppState;
pub use hms_domain::auth::PatientDataVisibility;
pub use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
pub use jsonwebtoken::{encode, EncodingKey, Header};
pub use serde_json::{json, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
pub use std::sync::Arc;
use std::sync::{Mutex, OnceLock, Weak};
use std::task::{Context, Poll};
pub use tower::util::ServiceExt;
use tower::Service;
pub use uuid::Uuid;

const TEST_JWT_SECRET: &str = "test-only-hms-v2-jwt-secret";
pub(crate) mod webauthn_signing;
use webauthn_signing::SoftwareAuthenticator;

/// Keys live only while their actual isolated test database is retained. A
/// second AppState for that database shares real signers, not fabricated keys.
#[derive(Default)]
struct TestAuthenticators {
    signers: Mutex<HashMap<(Uuid, Uuid, String), Arc<SoftwareAuthenticator>>>,
    users: Mutex<HashMap<(Uuid, Uuid), Arc<tokio::sync::Mutex<()>>>>,
    passwords: Mutex<HashMap<(Uuid, Uuid), (String, String)>>,
}
type AuthenticatorRegistries = HashMap<
    usize,
    (
        Weak<hms_db::test_support::TestDatabase>,
        Arc<TestAuthenticators>,
    ),
>;
fn test_authenticators(
    database: &Arc<hms_db::test_support::TestDatabase>,
) -> Arc<TestAuthenticators> {
    static REGISTRIES: OnceLock<Mutex<AuthenticatorRegistries>> = OnceLock::new();
    let mut registries = REGISTRIES
        .get_or_init(Default::default)
        .lock()
        .expect("test authenticator registry lock succeeds");
    registries.retain(|_, (database, _)| database.strong_count() > 0);
    registries
        .entry(Arc::as_ptr(database) as usize)
        .or_insert_with(|| {
            (
                Arc::downgrade(database),
                Arc::new(TestAuthenticators::default()),
            )
        })
        .1
        .clone()
}

#[derive(Clone)]
pub(crate) struct TestApp {
    router: axum::Router,
    state: AppState,
    authenticators: Arc<TestAuthenticators>,
    _database: Arc<hms_db::test_support::TestDatabase>,
}

pub(crate) struct TestAppFuture<F> {
    inner: Pin<Box<F>>,
    _database: Arc<hms_db::test_support::TestDatabase>,
}

#[derive(Clone, Debug)]
pub(crate) struct Actor {
    access_token: String,
    cookie_header: String,
    csrf_token: String,
}

impl Actor {
    pub(crate) async fn login(app: &TestApp, email: &str) -> Self {
        let (access_token, cookie_header, csrf_token) = login(app.clone(), email).await;
        Self {
            access_token,
            cookie_header,
            csrf_token,
        }
    }

    pub(crate) fn bearer(&self) -> String {
        format!("Bearer {}", self.access_token)
    }

    pub(crate) fn cookie_header(&self) -> &str {
        &self.cookie_header
    }

    pub(crate) fn csrf_token(&self) -> &str {
        &self.csrf_token
    }
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

    fn call(&mut self, mut request: Request<Body>) -> Self::Future {
        // Explicit synthetic transport fixture; production obtains this only
        // from into_make_service_with_connect_info, never a request header.
        if request
            .extensions()
            .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
            .is_none()
        {
            request.extensions_mut().insert(axum::extract::ConnectInfo(
                "127.0.0.1:44000".parse::<std::net::SocketAddr>().unwrap(),
            ));
        }
        TestAppFuture {
            inner: Box::pin(<axum::Router as Service<Request<Body>>>::call(
                &mut self.router,
                request,
            )),
            _database: Arc::clone(&self._database),
        }
    }
}

impl TestApp {
    fn authenticator_lock(&self, user: Uuid) -> Arc<tokio::sync::Mutex<()>> {
        self.authenticators
            .users
            .lock()
            .expect("test identity lock succeeds")
            .entry((self.state.facility_id(), user))
            .or_default()
            .clone()
    }
    fn retain_authenticator(&self, user: Uuid, authenticator: Arc<SoftwareAuthenticator>) {
        self.authenticators
            .signers
            .lock()
            .expect("test signer lock succeeds")
            .insert(
                (
                    self.state.facility_id(),
                    user,
                    authenticator.credential_id(),
                ),
                authenticator,
            );
    }

    fn authenticator(&self, user: Uuid, allowed: &[String]) -> Option<Arc<SoftwareAuthenticator>> {
        let signers = self
            .authenticators
            .signers
            .lock()
            .expect("test signer lock succeeds");
        allowed.iter().find_map(|id| {
            signers
                .get(&(self.state.facility_id(), user, id.clone()))
                .cloned()
        })
    }

    pub(crate) fn state(&self) -> AppState {
        self.state.clone()
    }

    pub(crate) async fn db_pool(&self) -> hms_db::PgPool {
        hms_db::connect(self._database.database_url())
            .await
            .expect("test database pool connects")
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

/// Fresh migrated/provisioned instance with no facility network policy at all.
pub(crate) async fn app_without_network_policy() -> TestApp {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    let state = AppState::new(config).await.unwrap();
    TestApp {
        router: build_app(state.clone()),
        state,
        authenticators: test_authenticators(&database),
        _database: database,
    }
}

pub(crate) async fn app_with_config(
    config: Config,
    database: Arc<hms_db::test_support::TestDatabase>,
) -> TestApp {
    let state = AppState::new(config).await.expect("test state initializes");
    setup_test_network_policy(&state, database.database_url()).await;
    TestApp {
        router: build_app(state.clone()),
        state,
        authenticators: test_authenticators(&database),
        _database: database,
    }
}

pub(crate) async fn app_with_request_context_probe() -> TestApp {
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    app_with_config_and_request_context_probe(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await
}

pub(crate) async fn app_with_config_and_request_context_probe(
    config: Config,
    database: Arc<hms_db::test_support::TestDatabase>,
) -> TestApp {
    let state = AppState::new(config).await.expect("test state initializes");
    setup_test_network_policy(&state, database.database_url()).await;
    let probe = Router::new()
        .route("/__test/request-context", get(request_context_probe))
        .with_state(state.clone());
    TestApp {
        router: build_app(state.clone())
            .merge(probe)
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                request_id::layer,
            )),
        state: state.clone(),
        authenticators: test_authenticators(&database),
        _database: database,
    }
}

async fn setup_test_network_policy(state: &AppState, database_url: &str) {
    let pool = hms_db::connect(database_url).await.unwrap();
    if hms_db::network::get_policy(&pool, state.facility_id())
        .await
        .unwrap()
        .configured
    {
        return;
    }
    let result = hms_db::network::update_policy(
        &pool,
        hms_db::network::NetworkPolicyActor {
            facility_id: state.facility_id(),
            user_id: None,
            request_id: None,
            reauth_deadline: None,
            auth_versions: None,
            session_id: None,
            active_profile: None,
            resolved_policy_version: None,
        },
        hms_domain::network::UpdateNetworkPolicyRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: 0,
            onsite_cidrs: vec!["127.0.0.1/32".into(), "::1/128".into()],
            offsite_mode: hms_domain::network::NetworkOffsiteMode::Readonly,
            reason: "Explicit synthetic loopback transport fixture".into(),
        },
        None,
    )
    .await;
    if let Err(error) = result {
        assert_eq!(
            error.downcast_ref::<hms_db::network::NetworkPolicyError>(),
            Some(&hms_db::network::NetworkPolicyError::VersionChanged)
        );
    }
}

pub(crate) fn access_claims(token: &str) -> hms_api::auth::AccessClaims {
    hms_api::auth::verify_access_token(TEST_JWT_SECRET, token).expect("test access token verifies")
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

pub(crate) async fn text_body(response: axum::response::Response) -> String {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body reads");
    String::from_utf8(bytes.to_vec()).expect("response body is utf-8")
}

pub(crate) async fn api_get(
    app: TestApp,
    actor: &Actor,
    uri: impl AsRef<str>,
) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .method(Method::GET)
            .uri(uri.as_ref())
            .header(AUTHORIZATION, actor.bearer())
            .body(Body::empty())
            .expect("request builds"),
    )
    .await
    .expect("request succeeds")
}

pub(crate) async fn api_post_json(
    app: TestApp,
    actor: &Actor,
    uri: impl AsRef<str>,
    payload: Value,
) -> axum::response::Response {
    api_json(Method::POST, app, actor, uri, payload).await
}

pub(crate) async fn api_patch_json(
    app: TestApp,
    actor: &Actor,
    uri: impl AsRef<str>,
    payload: Value,
) -> axum::response::Response {
    api_json(Method::PATCH, app, actor, uri, payload).await
}

async fn api_json(
    method: Method,
    app: TestApp,
    actor: &Actor,
    uri: impl AsRef<str>,
    payload: Value,
) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .method(method)
            .uri(uri.as_ref())
            .header(AUTHORIZATION, actor.bearer())
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .expect("request builds"),
    )
    .await
    .expect("request succeeds")
}

pub(crate) async fn assert_json_status(
    response: axum::response::Response,
    expected: StatusCode,
) -> Value {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, expected, "{body}");
    body
}

pub(crate) async fn assert_forbidden(response: axum::response::Response) -> Value {
    assert_json_status(response, StatusCode::FORBIDDEN).await
}

pub(crate) async fn assert_unauthorized(response: axum::response::Response) -> Value {
    assert_json_status(response, StatusCode::UNAUTHORIZED).await
}

pub(crate) async fn assert_bad_request(response: axum::response::Response) -> Value {
    assert_json_status(response, StatusCode::BAD_REQUEST).await
}

pub(crate) fn assert_cursor_page(body: &Value, expected_limit: u8) {
    assert!(body["data"].is_array(), "{body}");
    assert_eq!(body["page"]["limit"], expected_limit, "{body}");
    assert!(body["page"]["has_next"].is_boolean(), "{body}");
    assert!(
        body["page"]["next_cursor"].is_null() || body["page"]["next_cursor"].is_string(),
        "{body}"
    );
}

pub(crate) fn assert_phi_absent(haystack: &str, phi_values: &[&str]) {
    for value in phi_values {
        assert!(
            !haystack.contains(value),
            "PHI value `{value}` leaked into text: {haystack}"
        );
    }
}

pub(crate) async fn login(app: TestApp, email: &str) -> (String, String, String) {
    login_with_password(app, email, "ChangeMe123!").await
}

pub(crate) async fn enroll_test_passkey(app: &TestApp, user_id: Uuid) {
    let lock = app.authenticator_lock(user_id);
    let _guard = lock.lock().await;
    let pool = hms_db::connect(app._database.database_url())
        .await
        .expect("test database connects for passkey enrollment");
    let (email, display_name): (String, String) = sqlx::query_as(
        "SELECT email,display_name FROM users WHERE facility_id=$1 AND id=$2 AND is_active",
    )
    .bind(app.state.facility_id())
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("explicit test enrollment names an active local user");
    let existing = hms_db::auth::list_webauthn_credentials(&pool, app.state.facility_id(), user_id)
        .await
        .expect("test enrolled credentials read");
    if !existing.is_empty() {
        let ids = existing
            .iter()
            .map(|row| row.credential_id.clone())
            .collect::<Vec<_>>();
        assert!(
            app.authenticator(user_id, &ids).is_some(),
            "a fixture must retain the real signer of its existing credential"
        );
        return;
    }
    // Explicit trusted fixture bootstrap only. Production start/finish verifies
    // actual COSE registration bytes; this never fabricates session assurance.
    // Ordinary login below still performs a real HTTP assertion with this key.
    let authenticator = Arc::new(SoftwareAuthenticator::new());
    let config = hms_auth::WebAuthnConfig::localhost_for_tests();
    let start = hms_auth::start_passkey_registration(&config, user_id, &email, &display_name, &[])
        .expect("production registration options generate");
    let credential = authenticator.registration(&webauthn_signing::Ceremony::from_options(
        &start.public_key,
        &config.rp_origin,
        0,
    ));
    let registered = hms_auth::finish_passkey_registration(&config, credential, start.state)
        .expect("production verifier accepts the actual runtime registration");
    hms_db::auth::insert_webauthn_credential(
        &pool,
        &hms_db::auth::NewWebAuthnCredential {
            id: Uuid::new_v4(),
            user_id,
            facility_id: app.state.facility_id(),
            credential_id: registered.credential_id,
            passkey: registered.passkey,
            label: Some("Contract test passkey".to_owned()),
        },
    )
    .await
    .expect("trusted isolated test bootstrap stores a cryptographically real credential");
    app.retain_authenticator(user_id, authenticator);
}

pub(crate) async fn enroll_owner_test_passkey(app: &TestApp) {
    enroll_test_passkey(app, Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).await;
}

pub(crate) async fn grant_test_permission(
    app: &TestApp,
    user_id: Uuid,
    permission: PermissionCode,
) {
    let pool = hms_db::connect(app._database.database_url())
        .await
        .expect("test database connects for permission grant");
    let permission_code = hms_db::codec::encode(permission).expect("permission encodes");
    sqlx::query(
        r#"
        INSERT INTO user_permissions (user_id, permission_code)
        VALUES ($1, $2)
        ON CONFLICT (user_id, permission_code) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(&permission_code)
    .execute(&pool)
    .await
    .expect("test permission grant inserts");
    sqlx::query(
        "UPDATE users SET permission_version = permission_version + 1, updated_at = now() WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
        .expect("test permission version updates");
}

pub(crate) async fn grant_test_patient_visibility(
    app: &TestApp,
    user_id: Uuid,
    visibility: PatientDataVisibility,
) {
    let pool = hms_db::connect(app._database.database_url())
        .await
        .expect("test database connects for patient visibility grant");
    let visibility_code = hms_db::codec::encode(visibility).expect("visibility encodes");
    sqlx::query(
        r#"
        INSERT INTO user_patient_visibility (user_id, visibility)
        VALUES ($1, $2)
        ON CONFLICT (user_id, visibility) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(&visibility_code)
    .execute(&pool)
    .await
    .expect("test patient visibility grant inserts");
    sqlx::query(
        "UPDATE users SET permission_version = permission_version + 1, updated_at = now() WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
        .expect("test permission version updates");
}

pub(crate) async fn grant_test_feature(app: &TestApp, user_id: Uuid, feature: FeatureKey) {
    let pool = hms_db::connect(app._database.database_url())
        .await
        .expect("test database connects for feature grant");
    let feature_key = hms_db::codec::encode(feature).expect("feature encodes");
    sqlx::query(
        r#"
        INSERT INTO user_features (user_id, feature_key)
        VALUES ($1, $2)
        ON CONFLICT (user_id, feature_key) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(&feature_key)
    .execute(&pool)
    .await
    .expect("test feature grant inserts");
    sqlx::query(
        "UPDATE users SET permission_version = permission_version + 1, updated_at = now() WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("test permission version updates");
}

pub(crate) async fn create_test_practitioner_for_user(
    app: &TestApp,
    user_id: Uuid,
    employee_id: &str,
    license_number: &str,
) -> Uuid {
    let pool = hms_db::connect(app._database.database_url())
        .await
        .expect("test database connects for practitioner profile");
    let facility_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT facility_id FROM users WHERE id = $1 AND is_active = TRUE",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("test user facility loads");
    let staff_id = Uuid::new_v4();
    let practitioner_id = Uuid::new_v4();
    let staff_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO staff_profiles (
            id,
            facility_id,
            user_id,
            employee_id,
            department,
            position,
            hire_date
        )
        VALUES ($1, $2, $3, $4, 'Clinical', 'Ward Practitioner', DATE '2026-05-10')
        ON CONFLICT (user_id) DO UPDATE
        SET employee_id = EXCLUDED.employee_id,
            updated_at = now()
        RETURNING id
        "#,
    )
    .bind(staff_id)
    .bind(facility_id)
    .bind(user_id)
    .bind(employee_id)
    .fetch_one(&pool)
    .await
    .expect("test staff profile upserts");
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO practitioner_profiles (
            id,
            facility_id,
            staff_id,
            license_number,
            specialization,
            qualification
        )
        VALUES ($1, $2, $3, $4, 'Inpatient Medicine', 'MBChB')
        ON CONFLICT (staff_id) DO UPDATE
        SET license_number = EXCLUDED.license_number,
            updated_at = now()
        RETURNING id
        "#,
    )
    .bind(practitioner_id)
    .bind(facility_id)
    .bind(staff_id)
    .bind(license_number)
    .fetch_one(&pool)
    .await
    .expect("test practitioner profile upserts")
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
    let pool = app.db_pool().await;
    let user: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND lower(email)=lower($2)")
            .bind(app.state.facility_id())
            .bind(email)
            .fetch_one(&pool)
            .await
            .expect("successful test login names an actual local account");
    let lock = app.authenticator_lock(user);
    let _guard = lock.lock().await;
    let actual_password = app
        .authenticators
        .passwords
        .lock()
        .expect("fixture password lock succeeds")
        .get(&(app.state.facility_id(), user))
        .filter(|(original, _)| original == password)
        .map(|(_, current)| current.clone())
        .unwrap_or_else(|| password.to_owned());
    let result = complete_test_login(&app, user, email, &actual_password, device_label).await;
    let forced: bool = sqlx::query_scalar(
        "SELECT password_change_required FROM users WHERE facility_id=$1 AND id=$2",
    )
    .bind(app.state.facility_id())
    .bind(user)
    .fetch_one(&pool)
    .await
    .expect("fixture account state reads");
    if !forced {
        return result;
    }
    let replacement = format!("Fixture2!{}", Uuid::new_v4().simple());
    let changed = fixture_json_post(
        &app,
        Some(&result.0),
        "/api/v2/auth/password",
        json!({"current_password":actual_password,"new_password":replacement}),
    )
    .await;
    assert_eq!(
        changed.status(),
        StatusCode::OK,
        "ordinary fixture completes mandatory password change through HTTP"
    );
    assert_eq!(json_body(changed).await["data"]["changed"], true);
    app.authenticators
        .passwords
        .lock()
        .expect("fixture password lock succeeds")
        .insert(
            (app.state.facility_id(), user),
            (password.to_owned(), replacement.clone()),
        );
    complete_test_login(&app, user, email, &replacement, device_label).await
}

async fn complete_test_login(
    app: &TestApp,
    user: Uuid,
    email: &str,
    password: &str,
    device_label: Option<&str>,
) -> (String, String, String) {
    let pool = app.db_pool().await;
    let response = raw_password_login(app, email, password, device_label).await;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let error = json_body(response).await;
        panic!(
            "fixture password login status {status}, error code {}",
            error["error"]["code"].as_str().unwrap_or("none")
        );
    }
    let has_session = response.headers().contains_key(SET_COOKIE);
    if has_session {
        let cookies = auth_cookies(response.headers());
        let body = json_body(response).await;
        return (session_access_token(&body), cookies.0, cookies.1);
    }
    let mut body = json_body(response).await;
    assert!(
        body["data"]["access_token"].is_null(),
        "pending factor login must not expose an access token"
    );
    let grant = body["data"]["login_grant"]
        .as_str()
        .expect("pending login carries its restricted grant")
        .to_owned();
    if body["data"]["status"] == "setup_required" {
        let bootstrap = hms_db::provision::generate_secret_token();
        hms_db::auth::assurance::issue_bootstrap_grant(
            &pool,
            app.state.facility_id(),
            user,
            &hms_db::provision::hash_refresh_token(&bootstrap),
        )
        .await
        .expect("explicit named isolated fixture bootstrap is issued");
        let options = fixture_json_post(
            &app,
            None,
            "/api/v2/auth/login/setup/options",
            json!({"login_grant":grant,"bootstrap_token":bootstrap}),
        )
        .await;
        assert_eq!(options.status(), StatusCode::OK);
        assert!(!options.headers().contains_key(SET_COOKIE));
        let options = json_body(options).await;
        let authenticator = Arc::new(SoftwareAuthenticator::new());
        let credential = authenticator.registration(&webauthn_signing::Ceremony::from_options(
            &options["data"],
            TEST_WEBAUTHN_ORIGIN,
            0,
        ));
        let response = fixture_json_post(&app, None, "/api/v2/auth/login/setup/verify", json!({"login_grant":grant,"challenge_id":options["data"]["challenge_id"],"credential":credential})).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!response.headers().contains_key(SET_COOKIE));
        body = json_body(response).await;
        assert!(
            body["data"]["access_token"].is_null(),
            "registration does not establish login assurance"
        );
        assert!(
            body["data"]["login_grant"].as_str() == Some(grant.as_str()),
            "setup preserves the original restricted grant"
        );
        app.retain_authenticator(user, authenticator);
    }
    assert_eq!(body["data"]["status"], "factor_required");
    let options = fixture_json_post(
        &app,
        None,
        "/api/v2/auth/login/passkey/options",
        json!({"login_grant":grant}),
    )
    .await;
    assert_eq!(options.status(), StatusCode::OK);
    assert!(!options.headers().contains_key(SET_COOKIE));
    let options = json_body(options).await;
    let credential = fixture_assertion(&app, user, &options["data"]);
    let response = fixture_json_post(&app, None, "/api/v2/auth/login/passkey/verify", json!({"login_grant":grant,"challenge_id":options["data"]["challenge_id"],"credential":credential})).await;
    assert_eq!(response.status(), StatusCode::OK);
    let cookies = auth_cookies(response.headers());
    let body = json_body(response).await;
    assert_eq!(body["data"]["status"], "authenticated");
    (session_access_token(&body), cookies.0, cookies.1)
}

const TEST_WEBAUTHN_ORIGIN: &str = "http://localhost:8080";
fn session_access_token(body: &Value) -> String {
    body["data"]["access_token"]
        .as_str()
        .expect("access token exists")
        .to_owned()
}

pub(crate) fn fixture_assertion(app: &TestApp, user: Uuid, options: &Value) -> Value {
    let allowed = options["allowCredentials"]
        .as_array()
        .expect("factor options name actual allowed credentials")
        .iter()
        .map(|value| {
            value["id"]
                .as_str()
                .expect("credential ID exists")
                .to_owned()
        })
        .collect::<Vec<_>>();
    app.authenticator(user, &allowed)
        .expect("this isolated fixture retains the actual allowed private signer")
        .next_assertion(options, TEST_WEBAUTHN_ORIGIN)
}

pub(crate) async fn fixture_json_post(
    app: &TestApp,
    token: Option<&str>,
    path: &str,
    body: Value,
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    app.clone()
        .oneshot(
            builder
                .body(Body::from(body.to_string()))
                .expect("synthetic ceremony request builds"),
        )
        .await
        .expect("synthetic ceremony HTTP request completes")
}

pub(crate) async fn step_up_test_session(
    app: &TestApp,
    token: &str,
    current_password: Option<&str>,
) -> String {
    let claims = access_claims(token);
    let lock = app.authenticator_lock(claims.sub);
    let _guard = lock.lock().await;
    let options = fixture_json_post(
        app,
        Some(token),
        "/api/v2/auth/assurance/options",
        json!({"current_password":current_password}),
    )
    .await;
    assert_eq!(options.status(), StatusCode::OK);
    let options = json_body(options).await;
    let response = fixture_json_post(app, Some(token), "/api/v2/auth/assurance/verify", json!({"challenge_id":options["data"]["challenge_id"],"credential":fixture_assertion(app, claims.sub, &options["data"])})).await;
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await["data"]["access_token"]
        .as_str()
        .expect("verified same-session assurance returns the actual access token")
        .to_owned()
}

/// Explicitly raw password response for unenrolled/setup/negative assertions.
/// It never enrolls a credential or completes a factor behind the caller's back.
pub(crate) async fn raw_password_login(
    app: &TestApp,
    email: &str,
    password: &str,
    device_label: Option<&str>,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/api/v2/auth/login")
        .header("content-type", "application/json");
    if let Some(device_label) = device_label {
        request = request.header("x-device-label", device_label);
    }

    app.clone()
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
        .expect("login request succeeds")
}

pub(crate) fn token_with_stale_reauth(access_token: &str) -> String {
    let mut claims = hms_auth::verify_access_token(TEST_JWT_SECRET, access_token)
        .expect("test access token verifies");
    claims.iat = (Utc::now() - Duration::minutes(16)).timestamp() as usize;
    claims.auth_time = Some(claims.iat);
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
