//! Actual governed inventory router contracts; all data is synthetic.
#[path = "inventory_category_governance_contract/read_publication.rs"]
mod read_publication;
mod support;
use sha2::{Digest, Sha256};
use support::*;
const PASSWORD: &str = "Synthetic24!CurrentCredential";
async fn ordinary() -> (TestApp, String) {
    ordinary_in(app().await).await
}
async fn ordinary_in(app: TestApp) -> (TestApp, String) {
    let options = app.db_pool().await.connect_options();
    assert!(
        options.get_host() == "127.0.0.1" && options.get_port() == 5432,
        "actual test factory uses the Docker5432 server"
    );
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for p in [
        PermissionCode::InventoryView,
        PermissionCode::InventoryManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&app, user, p).await;
    }
    grant_test_feature(&app, user, FeatureKey::Inventory).await;
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    let first = raw_password_login(&app, "limited@hms.local", "ChangeMe123!", None).await;
    assert_eq!(
        first.status(),
        StatusCode::OK,
        "actual initial password login succeeds"
    );
    let first = json_body(first).await;
    let changed = fixture_json_post(
        &app,
        first["data"]["access_token"].as_str(),
        "/api/v2/auth/password",
        json!({"current_password":"ChangeMe123!","new_password":PASSWORD}),
    )
    .await;
    assert_eq!(
        changed.status(),
        StatusCode::OK,
        "actual mandatory password change succeeds"
    );
    let (token, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    let before = access_claims(&token);
    let confirmed = fixture_json_post(
        &app,
        Some(&token),
        "/api/v2/auth/reauthenticate",
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(
        confirmed.status(),
        StatusCode::OK,
        "ordinary same-session confirmation succeeds"
    );
    assert!(
        !confirmed.headers().contains_key(SET_COOKIE),
        "confirmation adds no cookie"
    );
    let data = json_body(confirmed).await;
    assert_eq!(
        data["data"]["user"]["auth_security"]["passkey_required"],
        false
    );
    assert_eq!(
        data["data"]["user"]["auth_security"]["passkey_enrolled"],
        false
    );
    let token = data["data"]["access_token"].as_str().unwrap().to_owned();
    let after = access_claims(&token);
    assert!(
        before.sub == after.sub && before.session_id == after.session_id,
        "confirmation retains actual actor/session"
    );
    let pool = app.db_pool().await;
    let privilege:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM effective_user_permissions WHERE user_id=$1 AND(permission_code LIKE 'admin.%' OR permission_code='system.ops.manage'))").bind(user).fetch_one(&pool).await.unwrap();
    assert!(!privilege, "baseline actor has no administrative authority");
    (app, token)
}
async fn request(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .extension(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                    [127, 0, 0, 1],
                    46125,
                ))))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_048_576).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn input(code: &str) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"code":code,"name":"Synthetic category","description":null,"parent":null})
}
async fn create_category(app: &TestApp, t: &str, body: Value) -> Value {
    let (s, b) = request(
        app,
        t,
        Method::POST,
        "/api/v2/inventory/category-administration",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "static error {}", b["error"]["code"]);
    let r = b["data"].clone();
    let digest = Sha256::digest(serde_json::to_vec(&r["reviewed_input"]).unwrap());
    assert_eq!(
        r["input_digest"],
        digest
            .iter()
            .map(|v| format!("{v:02x}"))
            .collect::<String>()
    );
    r
}
#[tokio::test]
async fn category_actual_routes_closed_wire_cas_noop_history_and_original_replay() {
    let (a, t) = ordinary().await;
    let mut i = input("  S25_CATEGORY  ");
    i["name"] = json!("  Synthetic category  ");
    let r = create_category(&a, &t, i.clone()).await;
    let id = r["category"]["id"].as_str().unwrap();
    assert_eq!(r["category"]["code"], "S25_CATEGORY");
    assert_eq!(r["category"]["version"], 1);
    assert!(r["before"].is_null());
    let (s, b) = request(
        &a,
        &t,
        Method::GET,
        "/api/v2/inventory/category-administration?limit=1",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(b["data"].is_array() && b["page"].is_object() && b["meta"].is_object());
    let c = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic revised category","description":"plain <b>text</b>\r\nline","parent_change":{"action":"retain"},"reason":"Synthetic reviewed correction"});
    let (s, b) = request(
        &a,
        &t,
        Method::POST,
        &format!("/api/v2/inventory/categories/{id}/corrections"),
        Some(c.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{}", b["error"]["code"]);
    assert_eq!(b["data"]["category"]["version"], 2);
    let original = b["data"].clone();
    let (s, b) = request(
        &a,
        &t,
        Method::POST,
        &format!("/api/v2/inventory/categories/{id}/corrections"),
        Some(c.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], original);
    let mut noop = c.clone();
    noop["client_request_id"] = json!(Uuid::new_v4());
    noop["expected_version"] = json!(2);
    let (s, b) = request(
        &a,
        &t,
        Method::POST,
        &format!("/api/v2/inventory/categories/{id}/corrections"),
        Some(noop),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["changed"], false);
    assert_eq!(b["data"]["category"], original["category"]);
    let (s, b) = request(
        &a,
        &t,
        Method::GET,
        &format!("/api/v2/inventory/categories/{id}/history?limit=2"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"].as_array().unwrap().len(), 2);
    assert!(b["data"][0].get("recorded_by_user_id").is_none());
    assert!(b["data"][0]["after"].get("created_by_user_id").is_none());
    assert!(b["data"][0].get("reason").is_none());
    let (s, b) = request(
        &a,
        &t,
        Method::GET,
        &format!(
            "/api/v2/inventory/category-commands/{}",
            c["client_request_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], original);
    let (s, b) = request(
        &a,
        &t,
        Method::POST,
        "/api/v2/inventory/category-administration",
        Some(i),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], r, "create replay before current state");
    let (s, b) = request(
        &a,
        &t,
        Method::GET,
        "/api/v2/inventory/categories?limit=100",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    for row in b["data"].as_array().unwrap() {
        assert_eq!(row.as_object().unwrap().len(), 3)
    }
}
#[tokio::test]
async fn category_closed_input_explicit_nullable_parent_and_source_versions() {
    let (a, t) = ordinary().await;
    for bad in [
        json!({"client_request_id":Uuid::new_v4(),"code":"S25_MISSING","name":"Synthetic","parent":null}),
        json!({"client_request_id":Uuid::new_v4(),"code":"S25_BAD","name":"Synthetic","description":null,"parent":null,"facility_id":a.state().facility_id()}),
        json!({"client_request_id":Uuid::nil(),"code":"S25_NIL","name":"Synthetic","description":null,"parent":null}),
    ] {
        let (s, _) = request(
            &a,
            &t,
            Method::POST,
            "/api/v2/inventory/category-administration",
            Some(bad),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST)
    }
    let p = create_category(&a, &t, input("S25_PARENT")).await;
    let mut child = input("S25_CHILD");
    child["parent"] = json!({"parent_id":p["category"]["id"],"expected_parent_version":99});
    let (s, b) = request(
        &a,
        &t,
        Method::POST,
        "/api/v2/inventory/category-administration",
        Some(child.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_category_source_unavailable");
    child["parent"]["expected_parent_version"] = json!(1);
    let c = create_category(&a, &t, child).await;
    assert_eq!(c["category"]["parent"]["version"], 1);
    let id = p["category"]["id"].as_str().unwrap();
    let (s, b) = request(
        &a,
        &t,
        Method::POST,
        &format!("/api/v2/inventory/categories/{id}/retire"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_category_referenced");
}
#[tokio::test]
async fn category_authority_view_does_not_create_or_read_original_receipts() {
    let (a, t) = ordinary().await;
    let mut initial = input("S25_READ_ONLY");
    initial["description"] = json!("S25_PRIVATE_OLD_DESCRIPTION");
    let r = create_category(&a, &t, initial).await;
    let id = r["category"]["id"].as_str().unwrap();
    let correction = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic current category","description":"S25_PRIVATE_CURRENT_DESCRIPTION","parent_change":{"action":"retain"},"reason":"S25_PRIVATE_REASON"});
    let (status, result) = request(
        &a,
        &t,
        Method::POST,
        &format!("/api/v2/inventory/categories/{id}/corrections"),
        Some(correction),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, original) = request(
        &a,
        &t,
        Method::GET,
        &format!(
            "/api/v2/inventory/category-commands/{}",
            r["client_request_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        original["data"]["category"]["description"],
        "S25_PRIVATE_OLD_DESCRIPTION"
    );
    assert_eq!(
        result["data"]["category"]["description"],
        "S25_PRIVATE_CURRENT_DESCRIPTION"
    );

    let (status, current_before_clear) = request(
        &a,
        &t,
        Method::GET,
        &format!("/api/v2/inventory/categories/{id}/administration"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        current_before_clear["data"]["category"]["description"],
        "S25_PRIVATE_CURRENT_DESCRIPTION"
    );
    let clear = json!({"client_request_id":Uuid::new_v4(),"expected_version":2,"name":"Synthetic current category","description":null,"parent_change":{"action":"retain"},"reason":"S25_PRIVATE_CLEAR_REASON"});
    let (status, cleared) = request(
        &a,
        &t,
        Method::POST,
        &format!("/api/v2/inventory/categories/{id}/corrections"),
        Some(clear),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(cleared["data"]["category"]["description"].is_null());
    let pool = a.db_pool().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    sqlx::query(
        "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='inventory.manage'",
    )
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    let (fresh, _, _) = login_with_password(a.clone(), "limited@hms.local", PASSWORD).await;
    let response = fixture_json_post(
        &a,
        Some(&fresh),
        "/api/v2/auth/reauthenticate",
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let confirmed = json_body(response).await;
    let view_token = confirmed["data"]["access_token"].as_str().unwrap();
    let (s, _) = request(
        &a,
        view_token,
        Method::GET,
        "/api/v2/inventory/category-administration",
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::OK,
        "current view-only actor keeps ordinary category reads"
    );
    for path in [
        "/api/v2/inventory/category-administration".to_owned(),
        format!("/api/v2/inventory/categories/{id}/history"),
    ] {
        let (status, body) = request(&a, view_token, Method::GET, &path, None).await;
        assert_eq!(status, StatusCode::OK);
        let text = body.to_string();
        for forbidden in [
            "S25_PRIVATE_OLD_DESCRIPTION",
            "S25_PRIVATE_CURRENT_DESCRIPTION",
            "S25_PRIVATE_REASON",
            "S25_PRIVATE_CLEAR_REASON",
            "recorded_by_user_id",
            "created_by_user_id",
            "updated_by_user_id",
            "reviewed_input",
        ] {
            assert!(
                !text.contains(forbidden),
                "general metadata reads exclude private description, actor and reason observations"
            );
        }
        for row in body["data"].as_array().unwrap() {
            assert!(row.get("description").is_none());
            assert!(row.get("before").is_none());
            assert!(row.get("after").is_none());
        }
    }
    let (status, current) = request(
        &a,
        view_token,
        Method::GET,
        &format!("/api/v2/inventory/categories/{id}/administration"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        current["data"]["category"]["description"].is_null(),
        "current detail preserves explicit clear; history does not expose former description"
    );

    let (s, _) = request(
        &a,
        view_token,
        Method::POST,
        "/api/v2/inventory/category-administration",
        Some(input("S25_DENIED")),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = request(
        &a,
        view_token,
        Method::GET,
        &format!(
            "/api/v2/inventory/category-commands/{}",
            r["client_request_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}
