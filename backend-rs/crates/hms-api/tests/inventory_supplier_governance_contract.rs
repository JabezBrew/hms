//! Actual supplier router and fresh synthetic credential contracts; no body logging.
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

const PRIVATE: &str = "S32_API_PRIVATE_ADDRESS";
fn input(code: &str) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"code":code,"name":"Synthetic supplier","contact_name":"","phone":null,"email":"synthetic@example.test","address":PRIVATE})
}
async fn create(app: &TestApp, token: &str, code: &str) -> Value {
    let (status, body) = request(
        app,
        token,
        Method::POST,
        "/api/v2/inventory/supplier-administration",
        Some(input(code)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "supplier creation succeeds");
    let receipt = body["data"].clone();
    let digest = Sha256::digest(serde_json::to_vec(&receipt["reviewed_input"]).unwrap());
    assert_eq!(
        receipt["input_digest"].as_str().unwrap(),
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    receipt
}
#[tokio::test]
async fn supplier32_actual_eight_routes_nullable_metadata_history_and_original_replay() {
    let (app, token) = ordinary().await;
    let created = create(&app, &token, "S32_API%_ROUTES").await;
    let id = created["supplier"]["id"].as_str().unwrap();
    let (status, detail) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/suppliers/{id}/administration"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["data"]["supplier"].as_object().unwrap().len(), 14);
    let correction = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Reviewed supplier","contact_name":null,"phone":"","email":"","address":"","reason":"Synthetic supplier review"});
    let (status, changed) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/inventory/suppliers/{id}/corrections"),
        Some(correction.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let changed = changed["data"].clone();
    assert_eq!(changed["supplier"]["version"], 2);
    assert!(changed["supplier"]["contact_name"].is_null());
    assert_eq!(changed["supplier"]["phone"], "");
    assert_eq!(changed["supplier"]["address"], "");
    let mut noop = correction.clone();
    noop["client_request_id"] = json!(Uuid::new_v4());
    noop["expected_version"] = json!(2);
    let (status, unchanged) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/inventory/suppliers/{id}/corrections"),
        Some(noop),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unchanged["data"]["changed"], false);
    assert_eq!(unchanged["data"]["supplier"]["version"], 2);
    assert!(
        unchanged["data"]["supplier"]["updated_at"] == changed["supplier"]["updated_at"],
        "noop retains current row time"
    );
    for (action, version, next) in [("retire", 2, 3), ("reactivate", 3, 4)] {
        let (status, body) = request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/inventory/suppliers/{id}/{action}"),
            Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":version})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["data"]["supplier"]["version"], next);
    }
    let (status, replayed) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/inventory/suppliers/{id}/corrections"),
        Some(correction),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        replayed["data"] == changed,
        "later lifecycle does not reinterpret original command result"
    );
    let key = changed["client_request_id"].as_str().unwrap();
    let (status, recovered) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/supplier-commands/{key}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        recovered["data"] == changed,
        "own original receipt remains exact"
    );
    let (status, history) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/suppliers/{id}/history"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let rows = history["data"].as_array().unwrap();
    assert_eq!(rows.len(), 5);
    for row in rows {
        assert_eq!(row.as_object().unwrap().len(), 11);
    }
    assert!(!history.to_string().contains(PRIVATE));
    assert!(!history.to_string().contains("recorded_by_user_id"));
    let (status, directory) = request(
        &app,
        &token,
        Method::GET,
        "/api/v2/inventory/supplier-administration?search=%25_",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let rows = directory["data"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].as_object().unwrap().len(), 7);
    assert!(!directory.to_string().contains(PRIVATE));
    let (status, legacy) = request(
        &app,
        &token,
        Method::GET,
        "/api/v2/inventory/suppliers?search=S32_API",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(legacy["data"][0].as_object().unwrap().len(), 8);
    assert!(legacy["data"][0].get("address").is_none());
    let counts:(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM inventory_supplier_commands WHERE supplier_id=$1),(SELECT count(*) FROM audit_events WHERE resource_type='inventory_supplier' AND resource_id=$1)").bind(Uuid::parse_str(id).unwrap()).fetch_one(&app.db_pool().await).await.unwrap();
    assert_eq!(counts, (5, 5));
}

#[tokio::test]
async fn supplier32_actual_closed_required_nullable_and_new_publication_bounds() {
    let (app, token) = ordinary().await;
    for missing in ["contact_name", "phone", "email", "address"] {
        let mut body = input("S32_REQUIRED");
        body.as_object_mut().unwrap().remove(missing);
        let (status, _) = request(
            &app,
            &token,
            Method::POST,
            "/api/v2/inventory/supplier-administration",
            Some(body),
        )
        .await;
        assert!(
            matches!(
                status,
                StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
            ),
            "nullable intent must be explicit"
        );
    }
    let mut extra = input("S32_CLOSED");
    extra["is_active"] = json!(false);
    let (status, _) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/supplier-administration",
        Some(extra),
    )
    .await;
    assert!(matches!(
        status,
        StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
    ));
    for (field, value) in [
        ("phone", json!("1".repeat(21))),
        ("email", json!("not an email")),
        ("address", json!("x".repeat(8001))),
        ("contact_name", json!("\u{0001}")),
        ("name", json!(" ")),
    ] {
        let mut body = input("S32_INVALID");
        body[field] = value;
        let (status, _) = request(
            &app,
            &token,
            Method::POST,
            "/api/v2/inventory/supplier-administration",
            Some(body),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "new invalid publication is rejected"
        );
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_supplier_commands")
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn supplier32_actual_view_only_onsite_stale_credentials_do_not_grant_manage_or_receipts() {
    let (app, token) = ordinary().await;
    let receipt = create(&app, &token, "S32_VIEW_ONLY").await;
    let id = receipt["supplier"]["id"].as_str().unwrap();
    let pool = app.db_pool().await;
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
    let (viewer, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1").bind(access_claims(&viewer).session_id).execute(&pool).await.unwrap();
    sqlx::query("UPDATE facility_network_policies SET version=version+1,onsite_cidrs=ARRAY['127.0.0.0/8']::cidr[],offsite_mode='deny' WHERE facility_id=$1").bind(app.state().facility_id()).execute(&pool).await.unwrap();
    for path in [
        "/api/v2/inventory/supplier-administration".to_owned(),
        format!("/api/v2/inventory/suppliers/{id}/administration"),
        format!("/api/v2/inventory/suppliers/{id}/history"),
        "/api/v2/inventory/suppliers".to_owned(),
    ] {
        let (status, _) = request(&app, &viewer, Method::GET, &path, None).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "ordinary onsite view remains independent of fresh management"
        );
    }
    let key = receipt["client_request_id"].as_str().unwrap();
    let (status, _) = request(
        &app,
        &viewer,
        Method::GET,
        &format!("/api/v2/inventory/supplier-commands/{key}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = request(
        &app,
        &viewer,
        Method::POST,
        "/api/v2/inventory/supplier-administration",
        Some(input("S32_VIEWER_WRITE")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[path = "inventory_supplier_governance_contract/read_publication.rs"]
mod read_publication;
#[path = "inventory_supplier_governance_contract/receipt_actor.rs"]
mod receipt_actor;
