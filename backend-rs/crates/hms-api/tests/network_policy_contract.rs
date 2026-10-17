//! Production-route regressions: client headers cannot grant network write access.
mod support;
use axum::extract::ConnectInfo;
use hms_domain::network::*;
use std::net::SocketAddr;
use support::*;

async fn write_from_unconfigured_external_peer(
    app: &TestApp,
    token: &str,
    path: &str,
    body: Value,
    headers: &[(&str, &str)],
) -> StatusCode {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header("content-type", "application/json");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let mut request = request.body(Body::from(body.to_string())).unwrap();
    request.extensions_mut().insert(ConnectInfo(
        "192.0.2.23:44000".parse::<SocketAddr>().unwrap(),
    ));
    app.clone().oneshot(request).await.unwrap().status()
}

const SPOOFED_ONSITE_HEADERS: &[&[(&str, &str)]] = &[
    &[("x-hms-offsite", "true")],
    &[],
    &[("x-hms-offsite", "false")],
    &[
        ("x-forwarded-for", "127.0.0.1"),
        ("x-real-ip", "127.0.0.1"),
        ("cf-connecting-ip", "127.0.0.1"),
    ],
];

#[tokio::test]
async fn external_client_cannot_create_clinical_templates_by_removing_or_spoofing_headers() {
    let app = app_without_network_policy().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let mut observed = Vec::new();
    for (index, headers) in SPOOFED_ONSITE_HEADERS.iter().enumerate() {
        observed.push(
            write_from_unconfigured_external_peer(
                &app,
                &token,
                "/api/v2/clinical/note-templates",
                json!({"title":format!("Synthetic network audit {index}"),"note_type":"doctor_note","body_template":"Synthetic template"}),
                headers,
            )
            .await
            .as_u16(),
        );
    }
    assert_eq!(observed, vec![403; SPOOFED_ONSITE_HEADERS.len()]);
}

#[tokio::test]
async fn fresh_credentials_do_not_bypass_unconfigured_network_policy_on_admin_writes() {
    let app = app_without_network_policy().await;
    enroll_owner_test_passkey(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let mut observed = Vec::new();
    for (index, headers) in SPOOFED_ONSITE_HEADERS.iter().enumerate() {
        observed.push(
            write_from_unconfigured_external_peer(
                &app,
                &token,
                "/api/v2/admin/position-templates",
                json!({"code":format!("NET-AUDIT-{index}"),"title":"Synthetic network audit","description":"Synthetic template","permission_codes":[]}),
                headers,
            )
            .await
            .as_u16(),
        );
    }
    assert_eq!(observed, vec![403; SPOOFED_ONSITE_HEADERS.len()]);
}

async fn call(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    body: Value,
    peer: &str,
    headers: &[(&str, &str)],
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if !token.is_empty() {
        builder = builder.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let mut req = builder.body(Body::from(body.to_string())).unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
    app.clone().oneshot(req).await.unwrap()
}
async fn policy(app: &TestApp, mode: NetworkOffsiteMode) {
    let pool = app.db_pool().await;
    let current = hms_db::network::get_policy(&pool, app.state().facility_id())
        .await
        .unwrap();
    hms_db::network::update_policy(
        &pool,
        hms_db::network::NetworkPolicyActor {
            facility_id: app.state().facility_id(),
            user_id: None,
            request_id: None,
            reauth_deadline: None,
            auth_versions: None,
            session_id: None,
            active_profile: None,
            resolved_policy_version: None,
        },
        UpdateNetworkPolicyRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: current.version,
            onsite_cidrs: vec!["127.0.0.1/32".into(), "::1/128".into()],
            offsite_mode: mode,
            reason: "Synthetic reviewed mode".into(),
        },
        None,
    )
    .await
    .unwrap();
}
async fn trusted_app() -> TestApp {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.trusted_proxy_cidrs =
        NetworkRanges::parse(&["10.20.0.2/32".into(), "10.20.0.3/32".into()], true).unwrap();
    app_with_config(config, database).await
}
fn template() -> Value {
    json!({"client_request_id":Uuid::new_v4(),"title":"Synthetic network workflow","note_type":"doctor_note","body_template":"Synthetic clinical template","is_active":true})
}

#[tokio::test]
async fn readonly_preserves_exact_post_reads_but_blocks_ordinary_workflows_and_profile_patch() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    for path in [
        "/api/v2/patients/search",
        "/api/v2/patients/context/search",
        "/api/v2/appointments/search",
        "/api/v2/encounters/search",
        "/api/v2/admin/audit-events/search",
        "/api/v2/laboratory/orders/search",
        "/api/v2/billing/invoices/search",
    ] {
        let response = call(
            &app,
            &token,
            Method::POST,
            path,
            json!({"limit":1}),
            "192.0.2.23:44000",
            &[],
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "read-only POST contract {path}"
        );
    }
    for path in [
        "/api/v2/patients",
        "/api/v2/appointments",
        "/api/v2/nursing/fluid-observations",
        "/api/v2/pharmacy/dispensing-queue/00000000-0000-4000-8000-000000000001/dispense",
        "/api/v2/inventory/items",
        "/api/v2/patients/identity/lookup",
    ] {
        assert_eq!(
            call(
                &app,
                &token,
                Method::POST,
                path,
                json!({}),
                "192.0.2.23:44000",
                &[]
            )
            .await
            .status(),
            StatusCode::FORBIDDEN,
            "write contract {path}"
        );
    }
    assert_eq!(
        call(
            &app,
            &token,
            Method::PATCH,
            "/api/v2/auth/me",
            json!({"display_name":"Synthetic changed"}),
            "192.0.2.23:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            &token,
            Method::GET,
            "/api/v2/auth/me",
            Value::Null,
            "192.0.2.23:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn configured_deny_blocks_gets_and_post_reads_even_when_proxy_provenance_is_invalid() {
    let app = trusted_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    policy(&app, NetworkOffsiteMode::Deny).await;
    let long = "192.0.2.23,".repeat(250);
    for headers in [
        vec![("x-forwarded-for", "192.0.2.23,10.20.0.3")],
        vec![("x-forwarded-for", "bad,192.0.2.23")],
        vec![
            ("x-forwarded-for", "192.0.2.23"),
            ("x-forwarded-for", "127.0.0.1"),
        ],
        vec![("x-forwarded-for", long.as_str())],
        vec![],
    ] {
        for (method, path, body) in [
            (Method::GET, "/api/v2/clinical/note-templates", Value::Null),
            (Method::POST, "/api/v2/patients/search", json!({"limit":1})),
        ] {
            assert_eq!(
                call(
                    &app,
                    &token,
                    method,
                    path,
                    body,
                    "10.20.0.2:44000",
                    &headers
                )
                .await
                .status(),
                StatusCode::FORBIDDEN
            );
        }
        let status = json_body(
            call(
                &app,
                &token,
                Method::GET,
                "/api/v2/auth/network-access",
                Value::Null,
                "10.20.0.2:44000",
                &headers,
            )
            .await,
        )
        .await;
        assert_eq!(status["data"]["access_allowed"], false);
        assert_eq!(status["data"]["read_only"], true);
    }
    assert_eq!(
        call(
            &app,
            &token,
            Method::GET,
            "/api/v2/auth/me",
            Value::Null,
            "192.0.2.23:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "",
            Method::GET,
            "/api/v2/health/ready",
            Value::Null,
            "192.0.2.23:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn fresh_reauth_only_allows_known_clients_and_stale_or_missing_proof_stays_readonly() {
    let app = trusted_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    policy(&app, NetworkOffsiteMode::FreshReauth).await;
    assert_eq!(
        call(
            &app,
            &token,
            Method::POST,
            "/api/v2/clinical/note-templates/record",
            template(),
            "192.0.2.23:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::OK
    );
    let stale = token_with_stale_reauth(&token);
    let mut missing = access_claims(&token);
    missing.auth_time = None;
    let missing = encode(
        &Header::default(),
        &missing,
        &EncodingKey::from_secret(b"test-only-hms-v2-jwt-secret"),
    )
    .unwrap();
    for proof in [&stale, &missing] {
        let response = call(
            &app,
            proof,
            Method::POST,
            "/api/v2/clinical/note-templates/record",
            template(),
            "192.0.2.23:44000",
            &[],
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            json_body(response).await["error"]["code"],
            "network_reauth_required"
        );
    }
    for headers in [
        vec![],
        vec![("x-forwarded-for", "unknown")],
        vec![("x-forwarded-for", "10.20.0.3")],
    ] {
        assert_eq!(
            call(
                &app,
                &token,
                Method::POST,
                "/api/v2/clinical/note-templates/record",
                template(),
                "10.20.0.2:44000",
                &headers
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
    }
    let status = json_body(
        call(
            &app,
            &token,
            Method::GET,
            "/api/v2/auth/network-access",
            Value::Null,
            "192.0.2.23:44000",
            &[],
        )
        .await,
    )
    .await;
    assert_eq!(status["data"]["classification"], "offsite");
    assert_eq!(status["data"]["reason"], "offsite_fresh_reauth");
    assert!(status["data"].get("onsite_cidrs").is_none());
    assert!(!status["data"].to_string().contains("192.0.2.23"));
}

#[tokio::test]
async fn preview_publish_receipt_replay_and_lockout_use_actual_facility_proof() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let preview = call(
        &app,
        &token,
        Method::POST,
        "/api/v2/admin/network-policy/preview",
        json!({"onsite_cidrs":["127.0.0.23/8","127.0.0.0/8"],"offsite_mode":"fresh_reauth"}),
        "127.0.0.1:44000",
        &[],
    )
    .await;
    assert_eq!(preview.status(), StatusCode::OK);
    let preview = json_body(preview).await;
    assert_eq!(
        preview["data"]["candidate"]["onsite_cidrs"],
        json!(["127.0.0.0/8"])
    );
    assert_eq!(preview["data"]["current_connection_retained_onsite"], true);
    let request = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"onsite_cidrs":["127.0.0.0/8"],"offsite_mode":"fresh_reauth","reason":"Synthetic reviewed candidate"});
    let saved = call(
        &app,
        &token,
        Method::PUT,
        "/api/v2/admin/network-policy",
        request.clone(),
        "127.0.0.1:44000",
        &[],
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = json_body(saved).await;
    assert_eq!(saved["data"]["policy"]["version"], 2);
    policy(&app, NetworkOffsiteMode::Readonly).await;
    let replay = call(
        &app,
        &token,
        Method::PUT,
        "/api/v2/admin/network-policy",
        request,
        "127.0.0.1:44000",
        &[],
    )
    .await;
    assert_eq!(replay.status(), StatusCode::OK);
    let replay = json_body(replay).await;
    assert_eq!(replay["data"]["replayed"], true);
    assert_eq!(replay["data"]["policy"], saved["data"]["policy"]);
    let denied=call(&app,&token,Method::PUT,"/api/v2/admin/network-policy",json!({"client_request_id":Uuid::new_v4(),"expected_version":3,"onsite_cidrs":["198.51.100.0/24"],"offsite_mode":"deny","reason":"Synthetic lockout attempt"}),"127.0.0.1:44000",&[]).await;
    assert_eq!(denied.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "network_policy_would_lock_out"
    );
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        call(
            &app,
            &limited,
            Method::GET,
            "/api/v2/admin/network-policy",
            Value::Null,
            "127.0.0.1:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn policy_changes_take_effect_across_app_states_without_token_or_permission_changes() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let config = Config::for_tests_with_database_url(database.database_url().to_owned());
    let first = app_with_config(config.clone(), database.clone()).await;
    let second = app_with_config(config, database).await;
    let (token, _, _) = login(first.clone(), "owner@hms.local").await;
    assert_eq!(
        call(
            &second,
            &token,
            Method::GET,
            "/api/v2/clinical/note-templates",
            Value::Null,
            "192.0.2.23:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::OK
    );
    policy(&first, NetworkOffsiteMode::Deny).await;
    assert_eq!(
        call(
            &second,
            &token,
            Method::GET,
            "/api/v2/clinical/note-templates",
            Value::Null,
            "192.0.2.23:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn warm_protected_request_reuses_context_instead_of_resolving_auth_twice() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    assert_eq!(
        call(
            &app,
            &token,
            Method::GET,
            "/api/v2/clinical/note-templates",
            Value::Null,
            "127.0.0.1:44000",
            &[]
        )
        .await
        .status(),
        StatusCode::OK
    );
    let response = call(
        &app,
        &token,
        Method::GET,
        "/api/v2/clinical/note-templates",
        Value::Null,
        "127.0.0.1:44000",
        &[],
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let metrics = response
        .extensions()
        .get::<hms_observability::RequestMetricsSnapshot>()
        .expect("production telemetry records this request");
    // The existing clinical proof queries are now instrumented as well. They
    // must not be mistaken for a second request-context hydration/resolution.
    let auth_and_connection_reads = 2;
    let clinical_identity_and_deadline_reads = 4;
    let retained_business_policy_read = 1;
    assert_eq!(
        metrics.db_query_count,
        auth_and_connection_reads + clinical_identity_and_deadline_reads + retained_business_policy_read,
        "one auth-version read, one connection decision, four clinical-proof reads and one retained policy proof; handler must reuse context"
    );
}

#[tokio::test]
async fn missing_socket_identity_never_inherits_loopback_or_fresh_credential_writes() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let raw = hms_api::app::build_app(app.state());
    let request = || {
        Request::builder()
            .method(Method::GET)
            .uri("/api/v2/auth/network-access")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("x-hms-offsite", "false")
            .header("x-forwarded-for", "127.0.0.1")
            .body(Body::empty())
            .unwrap()
    };
    let response = raw.clone().oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let status = json_body(response).await;
    assert_eq!(status["data"]["reason"], "client_unknown");
    assert_eq!(status["data"]["classification"], "unknown");
    assert_eq!(status["data"]["read_only"], true);
    let response = raw
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/clinical/note-templates/record")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(template().to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn invalid_utf8_forwarding_header_is_unknown_and_cannot_downgrade_deny() {
    let app = trusted_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    policy(&app, NetworkOffsiteMode::Deny).await;
    let mut request = Request::builder()
        .uri("/api/v2/clinical/note-templates")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(
            "x-forwarded-for",
            axum::http::HeaderValue::from_bytes(b"\xff").unwrap(),
        )
        .body(Body::empty())
        .unwrap();
    request.extensions_mut().insert(ConnectInfo(
        "10.20.0.2:44000".parse::<SocketAddr>().unwrap(),
    ));
    assert_eq!(
        app.oneshot(request).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn generic_write_failure_is_unconfirmed_and_exact_retry_preserves_command_identity() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION reject_network_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='network.policy.updated' THEN RAISE EXCEPTION 'synthetic audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_network_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_network_audit();").execute(&pool).await.unwrap();
    let request = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"onsite_cidrs":["127.0.0.1/32","::1/128"],"offsite_mode":"fresh_reauth","reason":"Synthetic exact retry"});
    let response = call(
        &app,
        &token,
        Method::PUT,
        "/api/v2/admin/network-policy",
        request.clone(),
        "127.0.0.1:44000",
        &[],
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "network_policy_write_unconfirmed"
    );
    assert_eq!(
        hms_db::network::get_policy(&pool, app.state().facility_id())
            .await
            .unwrap()
            .version,
        1
    );
    sqlx::query("DROP TRIGGER reject_network_audit ON audit_events")
        .execute(&pool)
        .await
        .unwrap();
    let response = call(
        &app,
        &token,
        Method::PUT,
        "/api/v2/admin/network-policy",
        request.clone(),
        "127.0.0.1:44000",
        &[],
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let receipt = json_body(response).await;
    assert_eq!(
        receipt["data"]["client_request_id"],
        request["client_request_id"]
    );
    assert_eq!(receipt["data"]["policy"]["version"], 2);
    assert_eq!(receipt["data"]["replayed"], false);
}
