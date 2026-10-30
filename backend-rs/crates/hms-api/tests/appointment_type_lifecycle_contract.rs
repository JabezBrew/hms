mod support;
use support::*;

#[path = "appointment_type_lifecycle_contract/authority.rs"]
mod authority;
#[path = "appointment_type_lifecycle_contract/booked_care.rs"]
mod booked_care;
#[path = "appointment_type_lifecycle_contract/commands.rs"]
mod commands;
#[path = "appointment_type_lifecycle_contract/input.rs"]
mod input;

async fn setup() -> (TestApp, String) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    (app, token)
}
fn create_input(code: &str) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"code":code,"name":"Synthetic governed service","default_duration_minutes":37})
}
async fn create(app: &TestApp, token: &str, code: &str) -> Value {
    let (s, b) = request(
        app,
        token,
        Method::POST,
        "/api/v2/scheduling/services",
        Some(create_input(code)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
    b["data"].clone()
}
fn service_id(receipt: &Value) -> Uuid {
    receipt["service"]["id"].as_str().unwrap().parse().unwrap()
}
async fn effects(app: &TestApp) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM appointment_types WHERE facility_id=$1),(SELECT count(*) FROM appointment_type_commands WHERE facility_id=$1),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type LIKE 'scheduling.appointment_type.%'))")
        .bind(app.state().facility_id()).fetch_one(&app.db_pool().await).await.unwrap()
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
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn governed_type_management_wire_has_authenticated_booking_controls() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let old_read = request(
        &app,
        &token,
        Method::GET,
        "/api/v2/scheduling/services?limit=1",
        None,
    )
    .await
    .0;
    let key = Uuid::new_v4();
    let input = json!({"client_request_id":key,"code":"SYNTH23WIRE","name":"Synthetic governed service","default_duration_minutes":37});
    let (created_status, created) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/scheduling/services",
        Some(input.clone()),
    )
    .await;
    assert_eq!([old_read.as_u16(), created_status.as_u16()], [200, 200]);
    let id = created["data"]["service"]["id"]
        .as_str()
        .or_else(|| created["data"]["id"].as_str())
        .unwrap();
    let mut statuses = Vec::new();
    statuses.push(
        request(
            &app,
            &token,
            Method::GET,
            "/api/v2/scheduling/services/administration?limit=1",
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
            &format!("/api/v2/scheduling/services/{id}/administration"),
            None,
        )
        .await
        .0
        .as_u16(),
    );
    statuses.push(request(&app,&token,Method::POST,&format!("/api/v2/scheduling/services/{id}/metadata"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic reviewed service","default_duration_minutes":41}))).await.0.as_u16());
    statuses.push(
        request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/scheduling/services/{id}/retire"),
            Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":2})),
        )
        .await
        .0
        .as_u16(),
    );
    statuses.push(
        request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/scheduling/services/{id}/reactivate"),
            Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":3})),
        )
        .await
        .0
        .as_u16(),
    );
    let (s, receipt) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/scheduling/services/commands/{key}"),
        None,
    )
    .await;
    statuses.push(s.as_u16());
    println!("type23 actual protected booking read/create positive200; management/detail/metadata/retire/reactivate/original receipt statuses={statuses:?}");
    assert_eq!(statuses, [200; 6]);
    assert_eq!(receipt["data"], created["data"]);
    let (s, replay) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/scheduling/services",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(replay["data"], created["data"]);
}

#[path = "appointment_type_lifecycle_contract/concurrency.rs"]
mod concurrency;

#[path = "appointment_type_lifecycle_contract/list.rs"]
mod list;

#[path = "appointment_type_lifecycle_contract/series.rs"]
mod series;

#[path = "appointment_type_lifecycle_contract/batching.rs"]
mod batching;

#[path = "appointment_type_lifecycle_contract/legacy.rs"]
mod legacy;
