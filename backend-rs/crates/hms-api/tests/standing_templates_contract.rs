mod support;
use support::*;

async fn send(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    body: Value,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn config(app: &TestApp) -> Value {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let (item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
    let locations: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 2",
    )
    .bind(facility)
    .fetch_all(&pool)
    .await
    .unwrap();
    json!({"name":"Synthetic standing supplies","requesting_location_id":locations[0],"fulfilling_location_id":locations[1],"frequency":"weekly","next_run_on":Utc::now().date_naive()-chrono::Duration::days(7),"monthly_day":null,"notes":"Synthetic note","items":[{"item_id":item,"quantity":3,"expected_unit":unit}]})
}

#[tokio::test]
async fn governed_template_http_preserves_real_lines_and_idempotent_due_request_snapshots() {
    let app = app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let body = config(&app).await;
    let created = send(
        &app,
        &owner,
        Method::POST,
        "/api/v2/inventory/standing-order-templates",
        body.clone(),
    )
    .await;
    assert_eq!(created.status(), StatusCode::OK);
    let created = json_body(created).await;
    assert_eq!(created["data"]["line_count"], 1);
    assert_eq!(created["data"]["items"][0]["quantity"], 3);
    assert_eq!(
        created["data"]["items"][0]["current_unit"],
        body["items"][0]["expected_unit"]
    );
    let id = created["data"]["id"].as_str().unwrap();
    let path = format!("/api/v2/inventory/standing-order-templates/{id}");
    let run = format!("{path}/runs");
    let command = json!({"expected_version":1,"scheduled_for":body["next_run_on"]});
    let (left, right) = tokio::join!(
        send(&app, &owner, Method::POST, &run, command.clone()),
        send(&app, &owner, Method::POST, &run, command)
    );
    assert_eq!(left.status(), StatusCode::OK);
    assert_eq!(right.status(), StatusCode::OK);
    let left = json_body(left).await;
    let right = json_body(right).await;
    assert_eq!(left["data"], right["data"]);
    assert_eq!(left["data"]["status"], "requested");
    assert_eq!(left["data"]["items"][0]["quantity_requested"], 3);
    assert_eq!(left["data"]["items"][0]["quantity_issued"], 0);
    let saved = json_body(send(&app, &owner, Method::GET, &path, Value::Null).await).await;
    assert_ne!(saved["data"]["next_run_on"], body["next_run_on"]);
    assert_eq!(saved["data"]["last_requisition_id"], left["data"]["id"]);
    let mut changed = body.clone();
    changed["items"][0]["quantity"] = json!(8);
    changed["next_run_on"] = saved["data"]["next_run_on"].clone();
    let updated = send(
        &app,
        &owner,
        Method::PATCH,
        &path,
        json!({"expected_version":1,"template":changed}),
    )
    .await;
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(json_body(updated).await["data"]["version"], 2);
    let request_id = left["data"]["id"].as_str().unwrap();
    let review = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v2/inventory/requisitions/{request_id}/review"),
        Value::Null,
    )
    .await;
    assert_eq!(review.status(), StatusCode::OK);
    let review = json_body(review).await;
    assert_eq!(review["data"]["items"][0]["quantity_requested"], 3);
    assert_eq!(review["data"]["template_version"], 1);
    let bypass = send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v2/inventory/requisitions/{request_id}/fulfill"),
        json!({}),
    )
    .await;
    assert_eq!(bypass.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn governed_templates_reject_missing_lines_unknown_fields_foreign_scope_and_lack_of_permission(
) {
    let app = app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    let body = config(&app).await;
    assert_eq!(
        send(
            &app,
            &limited,
            Method::POST,
            "/api/v2/inventory/standing-order-templates",
            body.clone()
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    for invalid in [
        json!({"requesting_location_id":body["requesting_location_id"],"frequency":"weekly","next_run_on":body["next_run_on"]}),
        json!({"name":"Synthetic","typo":true}),
        {
            let mut v = body.clone();
            v["items"] = json!([]);
            v
        },
        {
            let mut v = body.clone();
            v["typo"] = json!(true);
            v
        },
    ] {
        assert!(send(
            &app,
            &owner,
            Method::POST,
            "/api/v2/inventory/standing-order-templates",
            invalid
        )
        .await
        .status()
        .is_client_error());
    }
    let pool = app.db_pool().await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_standing_order_templates")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let foreign = Uuid::new_v4();
    let location = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'STANDING-FOREIGN','Synthetic facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name) VALUES($1,$2,'STANDING-FOREIGN','Synthetic location')").bind(location).bind(foreign).execute(&pool).await.unwrap();
    let mut invalid = body;
    invalid["fulfilling_location_id"] = json!(location);
    let rejected = send(
        &app,
        &owner,
        Method::POST,
        "/api/v2/inventory/standing-order-templates",
        invalid,
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(rejected).await["error"]["code"],
        "standing_template_references_unavailable"
    );
    assert_eq!(
        send(
            &app,
            &owner,
            Method::GET,
            &format!(
                "/api/v2/inventory/standing-order-templates/{}",
                Uuid::new_v4()
            ),
            Value::Null
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn template_list_is_cursor_bounded_and_status_actions_require_current_versions() {
    let app = app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let body = config(&app).await;
    let created = json_body(
        send(
            &app,
            &owner,
            Method::POST,
            "/api/v2/inventory/standing-order-templates",
            body.clone(),
        )
        .await,
    )
    .await;
    send(
        &app,
        &owner,
        Method::POST,
        "/api/v2/inventory/standing-order-templates",
        body,
    )
    .await;
    let list = send(
        &app,
        &owner,
        Method::GET,
        "/api/v2/inventory/standing-order-templates?limit=1&due_only=true",
        Value::Null,
    )
    .await;
    assert_eq!(list.status(), StatusCode::OK);
    let list = json_body(list).await;
    assert_eq!(list["data"].as_array().unwrap().len(), 1);
    assert_eq!(list["page"]["has_next"], true);
    assert!(list["data"][0].get("items").is_none());
    let cursor = list["page"]["next_cursor"].as_str().unwrap();
    let next = json_body(
        send(
            &app,
            &owner,
            Method::GET,
            &format!(
                "/api/v2/inventory/standing-order-templates?limit=1&due_only=true&cursor={cursor}"
            ),
            Value::Null,
        )
        .await,
    )
    .await;
    assert_ne!(next["data"][0]["id"], list["data"][0]["id"]);
    let id = created["data"]["id"].as_str().unwrap();
    let status = format!("/api/v2/inventory/standing-order-templates/{id}/status");
    let paused = send(
        &app,
        &owner,
        Method::POST,
        &status,
        json!({"expected_version":1,"status":"paused"}),
    )
    .await;
    assert_eq!(paused.status(), StatusCode::OK);
    assert_eq!(json_body(paused).await["data"]["status"], "paused");
    let stale = send(
        &app,
        &owner,
        Method::POST,
        &status,
        json!({"expected_version":1,"status":"active"}),
    )
    .await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(stale).await["error"]["code"],
        "standing_template_version_conflict"
    );
}

#[tokio::test]
async fn governed_request_approval_and_issue_move_real_stock_once_and_require_reviewed_scope() {
    let app = app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    let body = config(&app).await;
    let created = json_body(
        send(
            &app,
            &owner,
            Method::POST,
            "/api/v2/inventory/standing-order-templates",
            body.clone(),
        )
        .await,
    )
    .await;
    let id = created["data"]["id"].as_str().unwrap();
    let generated = json_body(
        send(
            &app,
            &owner,
            Method::POST,
            &format!("/api/v2/inventory/standing-order-templates/{id}/runs"),
            json!({"expected_version":1,"scheduled_for":body["next_run_on"]}),
        )
        .await,
    )
    .await;
    let request = generated["data"]["id"].as_str().unwrap();
    let approve = format!("/api/v2/inventory/requisitions/{request}/review/approve");
    let issue = format!("/api/v2/inventory/requisitions/{request}/issue");
    let action = json!({"expected_source_version":1});
    let before = send(&app, &owner, Method::POST, &issue, action.clone()).await;
    assert_eq!(before.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(before).await["error"]["code"],
        "standing_request_not_approved"
    );
    assert_eq!(
        send(&app, &limited, Method::POST, &approve, action.clone())
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            &app,
            &owner,
            Method::POST,
            &approve,
            json!({"expected_source_version":2})
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    let approved = send(&app, &owner, Method::POST, &approve, action.clone()).await;
    assert_eq!(approved.status(), StatusCode::OK);
    let approved = json_body(approved).await;
    assert_eq!(approved["data"]["status"], "approved");
    assert!(approved["data"]["approved_at"].is_string());
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let item = Uuid::parse_str(body["items"][0]["item_id"].as_str().unwrap()).unwrap();
    let source = Uuid::parse_str(body["fulfilling_location_id"].as_str().unwrap()).unwrap();
    sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand,expires_on) VALUES($1,$2,$3,$4,'SYNTHETIC-HTTP-ISSUE',5,$5)")
        .bind(Uuid::new_v4()).bind(facility).bind(item).bind(source).bind(Utc::now().date_naive()+chrono::Duration::days(3)).execute(&pool).await.unwrap();
    let issued = send(&app, &owner, Method::POST, &issue, action.clone()).await;
    assert_eq!(issued.status(), StatusCode::OK);
    let issued = json_body(issued).await;
    assert_eq!(issued["data"]["status"], "fulfilled");
    assert_eq!(issued["data"]["items"][0]["quantity_issued"], 3);
    assert!(issued["data"]["fulfilled_at"].is_string());
    let replay = send(&app, &owner, Method::POST, &issue, action).await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(json_body(replay).await["data"], issued["data"]);
    let total:i64=sqlx::query_scalar("SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE facility_id=$1 AND item_id=$2").bind(facility).bind(item).fetch_one(&pool).await.unwrap();
    assert_eq!(total, 5);
    let moves:(i64,i64)=sqlx::query_as("SELECT count(*),sum(quantity)::bigint FROM stock_movements WHERE reason='standing_requisition_issue'").fetch_one(&pool).await.unwrap();
    assert_eq!(moves, (2, 0));
    let cancel = send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v2/inventory/requisitions/{request}/review/cancel"),
        json!({"expected_source_version":1}),
    )
    .await;
    assert_eq!(cancel.status(), StatusCode::CONFLICT);
}
