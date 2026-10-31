//! Actual governed inventory router contracts; all data is synthetic.
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

fn today() -> chrono::NaiveDate {
    Utc::now().date_naive()
}
async fn create_input(app: &TestApp, code: &str) -> Value {
    let category:Uuid=sqlx::query_scalar("SELECT id FROM inventory_categories WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1").bind(app.state().facility_id()).fetch_one(&app.db_pool().await).await.unwrap();
    json!({"client_request_id":Uuid::new_v4(),"category_id":category,"code":code,"name":"Synthetic governed item","unit":"tablet","item_type":"medication"})
}
async fn create(app: &TestApp, t: &str, code: &str) -> Value {
    let input = create_input(app, code).await;
    let (s, b) = request(app, t, Method::POST, "/api/v2/inventory/items", Some(input)).await;
    assert_eq!(s, StatusCode::OK, "static error {}", b["error"]["code"]);
    verify_receipt(&b["data"]);
    b["data"].clone()
}
fn item_id(r: &Value) -> Uuid {
    r["item"]["id"].as_str().unwrap().parse().unwrap()
}
fn verify_receipt(r: &Value) {
    let digest = Sha256::digest(serde_json::to_vec(&r["reviewed_input"]).unwrap());
    let hex: String = digest.iter().map(|v| format!("{v:02x}")).collect();
    assert!(
        r["input_digest"] == hex,
        "canonical digest binds exact reviewed input"
    );
    if r["reviewed_input"]["action"] == "correct" {
        let revision = &r["correction_revision"];
        assert!(revision.is_object());
        assert!(revision["recorded_at"] == r["recorded_at"]);
        assert!(revision["projection_changed"] == r["changed"]);
        assert!(revision["before"]["version"] == r["reviewed_input"]["expected_version"]);
        assert!(revision["after"]["version"] == r["item"]["version"]);
    } else {
        assert!(r["correction_revision"].is_null())
    }
}
async fn detail(app: &TestApp, t: &str, id: Uuid) -> Value {
    let (s, b) = request(
        app,
        t,
        Method::GET,
        &format!("/api/v2/inventory/items/{id}/administration"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "static error {}", b["error"]["code"]);
    b["data"].clone()
}
async fn correction(
    app: &TestApp,
    t: &str,
    id: Uuid,
    version: i64,
    date: chrono::NaiveDate,
    unit: &str,
    name: &str,
) -> (StatusCode, Value) {
    let item = detail(app, t, id).await;
    request(app,t,Method::POST,"/api/v2/inventory/catalog-edits",Some(json!({"client_request_id":Uuid::new_v4(),"item_id":id,"expected_version":version,"effective_from":date,"code":item["item"]["code"],"name":name,"unit":unit,"reason":"Synthetic reviewed current correction"}))).await
}
async fn lifecycle(
    app: &TestApp,
    t: &str,
    id: Uuid,
    action: &str,
    version: i64,
) -> (StatusCode, Value) {
    request(
        app,
        t,
        Method::POST,
        &format!("/api/v2/inventory/items/{id}/{action}"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":version})),
    )
    .await
}
async fn effects(app: &TestApp) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('items',(SELECT count(*) FROM inventory_items),'commands',(SELECT count(*) FROM inventory_item_commands),'revisions',(SELECT count(*) FROM inventory_item_catalog_revisions),'legacy',(SELECT count(*) FROM inventory_item_catalog_versions),'audit',(SELECT count(*) FROM audit_events WHERE event_type LIKE 'inventory.item.%' OR event_type='inventory.stock_transfer.requested'),'transfers',(SELECT count(*) FROM stock_transfers),'batches',(SELECT count(*) FROM stock_batches),'movements',(SELECT count(*) FROM stock_movements))").fetch_one(&app.db_pool().await).await.unwrap()
}
#[tokio::test]
async fn actual_governed_wire_preserves_original_receipts_dates_and_noops() {
    let (app, t) = ordinary().await;
    let original_input = create_input(&app, "SYNTH24_WIRE").await;
    let (s, b) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(original_input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
    let original = b["data"].clone();
    verify_receipt(&original);
    let id = item_id(&original);
    assert_eq!(original["item"]["version"], 1);
    for (version, date, name) in [
        (1, today(), "Synthetic first correction"),
        (2, today(), "Synthetic same-day correction"),
        (
            3,
            today() - Duration::days(3),
            "Synthetic older reviewed correction",
        ),
    ] {
        let (s, b) = correction(&app, &t, id, version, date, "tablet", name).await;
        assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
        verify_receipt(&b["data"]);
        assert_eq!(b["data"]["item"]["version"], version + 1);
    }
    let before = detail(&app, &t, id).await;
    let (s, b) = correction(
        &app,
        &t,
        id,
        4,
        today() - Duration::days(4),
        "tablet",
        "Synthetic older reviewed correction",
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    verify_receipt(&b["data"]);
    assert_eq!(b["data"]["changed"], false);
    assert!(b["data"]["item"] == before["item"]);
    let (s, _) = lifecycle(&app, &t, id, "retire", 4).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        request(
            &app,
            &t,
            Method::GET,
            &format!("/api/v2/inventory/items/{id}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(detail(&app, &t, id).await["item"]["version"], 5);
    let (s, _) = lifecycle(&app, &t, id, "reactivate", 5).await;
    assert_eq!(s, StatusCode::OK);
    let before = detail(&app, &t, id).await;
    let (s, b) = lifecycle(&app, &t, id, "reactivate", 6).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["changed"], false);
    assert!(b["data"]["item"] == before["item"]);
    let before = effects(&app).await;
    let (s, replayed) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(original_input.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(replayed["data"] == original);
    assert_eq!(effects(&app).await, before);
    let key = original["client_request_id"].as_str().unwrap();
    let (s, b) = request(
        &app,
        &t,
        Method::GET,
        &format!("/api/v2/inventory/item-commands/{key}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(b["data"] == original);
    let (s, b) = request(
        &app,
        &t,
        Method::GET,
        &format!("/api/v2/inventory/items/{id}/catalog-history?limit=25"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let rows = b["data"].as_array().unwrap();
    assert_eq!(rows.len(), 4);
    assert!(rows.iter().all(|r| r["source"] == "governed_correction"
        && r.get("reason").is_none()
        && r.get("recorded_by_user_id").is_none()));
    let unknown = Uuid::new_v4();
    assert_eq!(
        request(
            &app,
            &t,
            Method::GET,
            &format!("/api/v2/inventory/item-commands/{unknown}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    println!("ITEM24 actual ordinary workflow, same-day/older date, stateful lifecycle/CAS, no-op history and immutable original replay passed");
}
#[tokio::test]
async fn strict_requests_reject_extra_fields_changed_intent_and_future_dates_without_effects() {
    let (app, t) = ordinary().await;
    let original = create_input(&app, "SYNTH24_STRICT").await;
    let (s, b) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(original.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let id = item_id(&b["data"]);
    let baseline = effects(&app).await;
    let mut changed = original.clone();
    changed["name"] = json!("Synthetic different intent");
    assert_eq!(
        request(
            &app,
            &t,
            Method::POST,
            "/api/v2/inventory/items",
            Some(changed)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(effects(&app).await, baseline);
    for patch in [
        json!({"controlled":false}),
        json!({"item_type":"controlled_substance"}),
        json!({"client_request_id":Uuid::nil()}),
        json!({"name":"   "}),
        json!({"unit":"x".repeat(121)}),
        json!({"code":"SYNTH_PRIVATE_INPUT\nMARKER"}),
    ] {
        let mut input = create_input(&app, "SYNTH24_BAD").await;
        for (k, v) in patch.as_object().unwrap() {
            input[k] = v.clone();
        }
        let (s, b) = request(
            &app,
            &t,
            Method::POST,
            "/api/v2/inventory/items",
            Some(input),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        assert!(!b.to_string().contains("SYNTH_PRIVATE_INPUT"));
        assert_eq!(effects(&app).await, baseline);
    }
    let (s, _) = correction(
        &app,
        &t,
        id,
        1,
        today() + Duration::days(1),
        "tablet",
        "Synthetic future refusal",
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(effects(&app).await, baseline);
    let (s, _) = lifecycle(&app, &t, id, "retire", 2).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(effects(&app).await, baseline);
    println!("ITEM24 strict DTO, unknown fields, changed UUID intent, future date and stale CAS refusal preserve effects");
}
#[tokio::test]
async fn category_selector_traverses_bounded_pages_and_literal_search() {
    let (app, t) = ordinary().await;
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    for n in 0..101 {
        sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name)VALUES($1,$2,$3,'Synthetic category choice')").bind(Uuid::new_v4()).bind(f).bind(format!("SYNTH24_CAT_{n:03}")).execute(&pool).await.unwrap();
    }
    let mut cursor: Option<String> = None;
    let mut ids = std::collections::BTreeSet::new();
    let mut pages = 0;
    loop {
        let mut path = "/api/v2/inventory/categories?limit=25&search=SYNTH24_CAT_".to_owned();
        if let Some(ref c) = cursor {
            path.push_str("&cursor=");
            path.push_str(c);
        }
        let (s, b) = request(&app, &t, Method::GET, &path, None).await;
        assert_eq!(s, StatusCode::OK);
        let rows = b["data"].as_array().unwrap();
        assert!(rows.len() <= 25);
        for r in rows {
            assert!(
                ids.insert(r["id"].as_str().unwrap().to_owned()),
                "category pages contain each exact identity once"
            );
        }
        pages += 1;
        cursor = b["page"]["next_cursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            break;
        }
        assert!(pages < 10);
    }
    assert_eq!(ids.len(), 101);
    assert_eq!(pages, 5);
    let (s, _) = request(
        &app,
        &t,
        Method::GET,
        "/api/v2/inventory/categories?cursor=invalid",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    println!(
        "ITEM24 category traversal101choices5boundedpages with exact unique identities passed"
    );
}
#[path = "inventory_item_governance_contract/references.rs"]
mod references;

#[test]
fn actual_exported_governance_enums_are_closed_and_serde_refuses_extra_fields() {
    use hms_domain::inventory_items::{InventoryItemHistoryRow, InventoryItemReviewedInput};
    let doc = hms_api::openapi::openapi_value();
    for name in ["InventoryItemReviewedInput", "InventoryItemHistoryRow"] {
        let variants = doc["components"]["schemas"][name]["oneOf"]
            .as_array()
            .expect("actual exported tagged enum has variants");
        assert!(!variants.is_empty());
        for variant in variants {
            assert_eq!(
                variant["additionalProperties"], false,
                "actual exported variant closes unknown fields"
            );
            assert_eq!(variant["type"], "object");
        }
    }
    let key = Uuid::new_v4();
    let item = Uuid::new_v4();
    let inputs = vec![
        json!({"action":"create","client_request_id":key,"category_id":Uuid::new_v4(),"code":"S24","name":"Synthetic item","unit":"tablet","item_type":"medication"}),
        json!({"action":"correct","client_request_id":key,"item_id":item,"expected_version":1,"effective_from":today(),"code":"S24","name":"Synthetic item","unit":"tablet","reason":"Synthetic reviewed reason"}),
        json!({"action":"retire","client_request_id":key,"item_id":item,"expected_version":1}),
        json!({"action":"reactivate","client_request_id":key,"item_id":item,"expected_version":1}),
    ];
    for valid in inputs {
        assert!(serde_json::from_value::<InventoryItemReviewedInput>(valid.clone()).is_ok());
        let mut invalid = valid;
        invalid["unexpected"] = json!(true);
        assert!(serde_json::from_value::<InventoryItemReviewedInput>(invalid).is_err());
    }
    let point = Utc::now();
    let projection = json!({"code":"S24","name":"Synthetic item","unit":"tablet","version":1});
    for valid in [
        json!({"source":"legacy_dated_version","id":item,"effective_from":today(),"effective_to":null,"code":"S24","name":"Synthetic item","unit":"tablet","recorded_at":point,"reason_present":true}),
        json!({"source":"governed_correction","id":item,"reviewed_effective_from":today(),"recorded_at":point,"before":projection,"after":projection,"projection_changed":false,"reason_present":true}),
    ] {
        assert!(serde_json::from_value::<InventoryItemHistoryRow>(valid.clone()).is_ok());
        let mut invalid = valid;
        invalid["unexpected"] = json!(true);
        assert!(serde_json::from_value::<InventoryItemHistoryRow>(invalid).is_err());
    }
    for name in [
        "CreateInventoryItemRequest",
        "CreateInventoryCatalogEditRequest",
        "InventoryItemLifecycleRequest",
        "CreateStockTransferRequest",
    ] {
        assert_eq!(
            doc["components"]["schemas"][name]["additionalProperties"],
            false
        );
    }
    let required = doc["components"]["schemas"]["CreateStockTransferRequest"]["required"]
        .as_array()
        .unwrap();
    assert!(required.iter().any(|v| v == "expected_unit"));
}

#[path = "inventory_item_governance_contract/transfers.rs"]
mod transfers;

#[path = "inventory_item_governance_contract/legacy.rs"]
mod legacy;

#[path = "inventory_item_governance_contract/authority.rs"]
mod authority;
