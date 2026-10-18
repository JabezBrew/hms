mod support;
use support::*;
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
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn setup() -> (TestApp, String) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    (app, token)
}
#[tokio::test]
async fn governed_storage_location_wire_has_authenticated_read_controls() {
    let (app, token) = setup().await;
    let existing = Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID);
    let input = create_input("SYNTH21WIRE");
    let key = input["client_request_id"].as_str().unwrap().to_owned();
    let mut statuses = vec![];
    statuses.push(
        request(
            &app,
            &token,
            Method::GET,
            "/api/v2/inventory/storage-locations",
            None,
        )
        .await
        .0
        .as_u16(),
    );
    statuses.push(
        request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/inventory/storage-locations/{existing}"),
            None,
        )
        .await
        .0
        .as_u16(),
    );
    let (s, created) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/inventory/storage-locations",
        Some(input),
    )
    .await;
    statuses.push(s.as_u16());
    assert_eq!(s, StatusCode::OK);
    let id = location_id(&created["data"]);
    statuses.push(request(&app,&token,Method::POST,&format!("/api/v2/inventory/storage-locations/{id}/rename"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic renamed location"}))).await.0.as_u16());
    statuses.push(command(&app, &token, id, "retire", 2).await.0.as_u16());
    statuses.push(command(&app, &token, id, "reactivate", 3).await.0.as_u16());
    let (s, receipt) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/storage-locations/commands/{key}"),
        None,
    )
    .await;
    statuses.push(s.as_u16());
    println!("storage21 actual governed wire/read status controls: {statuses:?}");
    assert_eq!(statuses, [200; 7]);
    assert_eq!(receipt["data"], created["data"]);
}
#[tokio::test]
async fn metadata_reference_producers_reject_inactive_and_foreign_locations() {
    let (app, token) = setup().await;
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    let item:Uuid=sqlx::query_scalar("SELECT id FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled LIMIT 1").bind(f).fetch_one(&pool).await.unwrap();
    let local: Uuid = sqlx::query_scalar(
        "SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active LIMIT 1",
    )
    .bind(f)
    .fetch_one(&pool)
    .await
    .unwrap();
    let inactive = Uuid::new_v4();
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,is_active)VALUES($1,$2,'SYNTH21_INACTIVE','Synthetic inactive location',false)").bind(inactive).bind(f).execute(&pool).await.unwrap();
    let foreign_f = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'SYNTH21_FOREIGN','Synthetic foreign facility','hospital')").bind(foreign_f).execute(&pool).await.unwrap();
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name)VALUES($1,$2,'SYNTH21_FOREIGN','Synthetic foreign location')").bind(foreign).bind(foreign_f).execute(&pool).await.unwrap();
    let mut statuses = vec![];
    for location in [local, inactive, foreign] {
        statuses.push(request(&app,&token,Method::POST,"/api/v2/inventory/transfers",Some(json!({"item_id":item,"from_location_id":local,"to_location_id":location,"quantity":1}))).await.0.as_u16());
        statuses.push(
            request(
                &app,
                &token,
                Method::POST,
                "/api/v2/inventory/requisitions",
                Some(json!({"requesting_location_id":location})),
            )
            .await
            .0
            .as_u16(),
        );
    }
    let unsafe_rows:i64=sqlx::query_scalar("SELECT (SELECT count(*) FROM stock_transfers WHERE facility_id=$1 AND to_location_id=ANY($2))+(SELECT count(*) FROM stock_requisitions WHERE facility_id=$1 AND requesting_location_id=ANY($2))").bind(f).bind(vec![inactive,foreign]).fetch_one(&pool).await.unwrap();
    println!("storage21 actual local/inactive/foreign publication status controls: {statuses:?}; unsafe_rows={unsafe_rows}");
    assert_eq!(statuses, [200, 200, 409, 409, 409, 409]);
    assert_eq!(unsafe_rows, 0);
}
fn create_input(code: &str) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"code":code,"name":"Synthetic governed location","location_type":"store","temperature_zone":"ambient"})
}
async fn create(app: &TestApp, token: &str, code: &str) -> Value {
    let (s, b) = request(
        app,
        token,
        Method::POST,
        "/api/v2/inventory/storage-locations",
        Some(create_input(code)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
    b["data"].clone()
}
fn location_id(r: &Value) -> Uuid {
    r["location"]["id"].as_str().unwrap().parse().unwrap()
}
async fn command(
    app: &TestApp,
    token: &str,
    id: Uuid,
    action: &str,
    version: i64,
) -> (StatusCode, Value) {
    request(
        app,
        token,
        Method::POST,
        &format!("/api/v2/inventory/storage-locations/{id}/{action}"),
        Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":version})),
    )
    .await
}
async fn effects(app: &TestApp) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM storage_locations WHERE facility_id=$1),(SELECT count(*) FROM storage_location_commands WHERE facility_id=$1),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type LIKE 'inventory.storage_location.%'))").bind(app.state().facility_id()).fetch_one(&app.db_pool().await).await.unwrap()
}
#[tokio::test]
async fn repeat_provisioning_preserves_actual_governed_location_rename_and_original_receipt() {
    let (app, token) = setup().await;
    let id = Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID);
    let key = Uuid::new_v4();
    let(s,b)=request(&app,&token,Method::POST,&format!("/api/v2/inventory/storage-locations/{id}/rename"),Some(json!({"client_request_id":key,"expected_version":1,"name":"Synthetic maintained main store"}))).await;
    assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
    let original = b["data"].clone();
    let pool = app.db_pool().await;
    let seeded = hms_db::provision::provision_baseline(
        &pool,
        &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await;
    println!(
        "storage21 actual canonical rename={}, repeat_seed_success={}",
        s.as_u16(),
        seeded.is_ok()
    );
    assert!(
        seeded.is_ok(),
        "repeat seed must preserve governed location metadata"
    );
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/storage-locations/{id}/administration"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], original["location"]);
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/storage-locations/commands/{key}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"], original);
}

#[path = "storage_location_lifecycle_contract/advanced.rs"]
mod advanced;
#[path = "storage_location_lifecycle_contract/concurrency.rs"]
mod concurrency;
#[path = "storage_location_lifecycle_contract/references.rs"]
mod references;

#[path = "storage_location_lifecycle_contract/history.rs"]
mod history;

#[path = "storage_location_lifecycle_contract/authority.rs"]
mod authority;
#[path = "storage_location_lifecycle_contract/performance.rs"]
mod performance;

#[path = "storage_location_lifecycle_contract/input.rs"]
mod input;

#[test]
fn storage_location_directory_contract_declares_optional_query_filters() {
    let document = hms_api::openapi::openapi_value();
    let parameters = document["paths"]["/api/v2/inventory/storage-locations/administration"]["get"]
        ["parameters"]
        .as_array()
        .unwrap();
    let mut names = parameters
        .iter()
        .map(|parameter| {
            assert_eq!(parameter["in"], "query");
            assert_ne!(parameter["required"], true);
            parameter["name"].as_str().unwrap()
        })
        .collect::<Vec<_>>();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "cursor",
            "is_active",
            "limit",
            "location_type",
            "search",
            "temperature_zone"
        ]
    );
}
