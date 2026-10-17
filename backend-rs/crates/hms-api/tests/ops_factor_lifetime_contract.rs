mod support;
use std::sync::atomic::{AtomicBool, Ordering};
use support::*;
use tokio::sync::Notify;

#[derive(Default)]
struct Gate {
    entered: Notify,
    release: Notify,
    first: AtomicBool,
}
async fn prometheus(
    axum::extract::State(gate): axum::extract::State<Arc<Gate>>,
) -> axum::Json<Value> {
    if gate.first.swap(false, Ordering::AcqRel) {
        gate.entered.notify_one();
        gate.release.notified().await;
    }
    axum::Json(json!({"status":"success","data":{"resultType":"vector","result":[]}}))
}
async fn fixture() -> (TestApp, Actor, Arc<Gate>, tokio::task::JoinHandle<()>) {
    let gate = Arc::new(Gate {
        first: AtomicBool::new(true),
        ..Default::default()
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = axum::Router::new()
        .route("/api/v1/query", axum::routing::get(prometheus))
        .with_state(gate.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.ops_prometheus.enabled = true;
    config.ops_prometheus.url = Some(format!("http://{address}"));
    config.ops_prometheus.timeout = std::time::Duration::from_secs(10);
    let app = app_with_config(config, database).await;
    grant_test_permission(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PermissionCode::SystemOpsView,
    )
    .await;
    let actor = Actor::login(&app, "owner@hms.local").await;
    (app, actor, gate, server)
}
async fn begin_read(
    app: &TestApp,
    actor: &Actor,
    gate: &Gate,
) -> tokio::task::JoinHandle<axum::response::Response> {
    let app = app.clone();
    let actor = actor.clone();
    let pending = tokio::spawn(async move { api_get(app, &actor, "/api/v2/ops/overview").await });
    tokio::time::timeout(std::time::Duration::from_secs(4), gate.entered.notified())
        .await
        .expect("actual protected HTTP read reaches external metrics collection");
    pending
}
async fn finish_read(
    pending: tokio::task::JoinHandle<axum::response::Response>,
    gate: &Gate,
    server: tokio::task::JoinHandle<()>,
    code: &str,
) {
    gate.release.notify_one();
    let response = tokio::time::timeout(std::time::Duration::from_secs(6), pending)
        .await
        .unwrap()
        .unwrap();
    let status = response.status();
    let body = json_body(response).await;
    server.abort();
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "safe error code {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    assert_eq!(body["error"]["code"], code);
    assert!(
        body.get("data").is_none(),
        "expired proof must not publish a metrics snapshot"
    );
}
#[tokio::test]
async fn ops_read_publishes_collected_snapshot_with_unchanged_live_proof() {
    let (app, actor, gate, server) = fixture().await;
    let pending = begin_read(&app, &actor, &gate).await;
    gate.release.notify_one();
    let response = tokio::time::timeout(std::time::Duration::from_secs(6), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert!(body["data"]["runtime"].is_object());
    server.abort();
}
#[tokio::test]
async fn ops_read_rechecks_natural_factor_expiry_after_external_collection() {
    let (app, actor, gate, server) = fixture().await;
    let pool = app.db_pool().await;
    let claims = access_claims(actor.bearer().strip_prefix("Bearer ").unwrap());
    sqlx::query("UPDATE auth_session_assurance SET expires_at=clock_timestamp()+interval '3 seconds' WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
    let pending = begin_read(&app, &actor, &gate).await;
    tokio::time::timeout(std::time::Duration::from_secs(5),async{loop{
        let expired:bool=sqlx::query_scalar("SELECT clock_timestamp()>=expires_at FROM auth_session_assurance WHERE session_id=$1").bind(claims.session_id).fetch_one(&pool).await.unwrap();
        if expired{break;}tokio::time::sleep(std::time::Duration::from_millis(15)).await;
    }}).await.unwrap();
    finish_read(pending, &gate, server, "passkey_verification_required").await;
}
#[tokio::test]
async fn ops_read_rechecks_actual_public_session_revocation_after_external_collection() {
    let (app, actor, gate, server) = fixture().await;
    let claims = access_claims(actor.bearer().strip_prefix("Bearer ").unwrap());
    let pending = begin_read(&app, &actor, &gate).await;
    let revoked = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        api_post_json(
            app.clone(),
            &actor,
            &format!("/api/v2/auth/sessions/{}/revoke", claims.session_id),
            json!({}),
        ),
    )
    .await
    .expect("metrics collection must not retain identity DB locks");
    assert_eq!(revoked.status(), StatusCode::OK);
    finish_read(pending, &gate, server, "factor_authorization_expired").await;
}
#[tokio::test]
async fn ops_read_rechecks_current_password_proof_after_external_collection() {
    let (app, actor, gate, server) = fixture().await;
    let pool = app.db_pool().await;
    let claims = access_claims(actor.bearer().strip_prefix("Bearer ").unwrap());
    let pending = begin_read(&app, &actor, &gate).await;
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
    finish_read(pending, &gate, server, "password_confirmation_required").await;
}
#[tokio::test]
async fn ops_read_rechecks_current_admin_feature_after_external_collection() {
    let (app, actor, gate, server) = fixture().await;
    let pool = app.db_pool().await;
    let pending = begin_read(&app, &actor, &gate).await;
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'admin',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(app.state().facility_id()).execute(&pool).await.unwrap();
    finish_read(pending, &gate, server, "factor_authorization_expired").await;
}

#[tokio::test]
async fn ops_read_rechecks_published_network_policy_after_external_collection() {
    let (app, actor, gate, server) = fixture().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let pending = begin_read(&app, &actor, &gate).await;
    let current = hms_db::network::get_policy(&pool, facility).await.unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        hms_db::network::update_policy(
            &pool,
            hms_db::network::NetworkPolicyActor {
                facility_id: facility,
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
                expected_version: current.version,
                onsite_cidrs: vec!["192.0.2.254/32".into()],
                offsite_mode: hms_domain::network::NetworkOffsiteMode::Deny,
                reason: "Synthetic network publication during external collection".into(),
            },
            None,
        ),
    )
    .await
    .expect("external collection must not retain a database policy lock")
    .expect("canonical operator publication succeeds");
    finish_read(pending, &gate, server, "network_policy_changed").await;
    assert_eq!(
        api_get(app.clone(), &actor, "/api/v2/auth/me")
            .await
            .status(),
        StatusCode::OK,
        "own authenticated identity remains reachable under a clinical Deny policy"
    );
    let token = actor.bearer();
    let proved = step_up_test_session(&app, token.strip_prefix("Bearer ").unwrap(), None).await;
    assert!(!proved.is_empty(), "own signed step-up remains available");
}
