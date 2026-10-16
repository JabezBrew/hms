mod support;
use support::*;
const BASE: &str = "/api/v2/scheduling/appointment-series";
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
async fn config(app: &TestApp, count: usize) -> Value {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' AND vital_status<>'deceased' LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
    let clinic: Uuid =
        sqlx::query_scalar("SELECT id FROM clinics WHERE facility_id=$1 AND is_active LIMIT 1")
            .bind(facility)
            .fetch_one(&pool)
            .await
            .unwrap();
    let actor: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND email='owner@hms.local'")
            .bind(facility)
            .fetch_one(&pool)
            .await
            .unwrap();
    let service = Uuid::new_v4();
    sqlx::query("INSERT INTO appointment_types(id,facility_id,code,name,default_duration_minutes) VALUES($1,$2,'SYN-HTTP-SERIES','Synthetic review',20)").bind(service).bind(facility).execute(&pool).await.unwrap();
    let mut occurrences = vec![];
    for day in 1..=count {
        let id = Uuid::new_v4();
        let start = Utc::now()
            .date_naive()
            .and_hms_opt(9, 0, 0)
            .unwrap()
            .and_utc()
            + chrono::Duration::days(day as i64);
        sqlx::query("INSERT INTO clinic_sessions(id,facility_id,clinic_id,practitioner_user_id,owner_type,owner_id,name,mode,starts_at,ends_at,slot_minutes,capacity) VALUES($1,$2,$3,$4,'practitioner',$4,'Synthetic session','fixed_slot',$5,$6,20,1)").bind(id).bind(facility).bind(clinic).bind(actor).bind(start).bind(start+chrono::Duration::hours(1)).execute(&pool).await.unwrap();
        occurrences.push(json!({"session_id":id,"starts_at":start,"ends_at":start+chrono::Duration::minutes(20),"overbook_reason":null}));
    }
    json!({"client_request_id":Uuid::new_v4(),"patient_id":patient,"clinic_id":clinic,"service_id":service,"occurrences":occurrences})
}
#[tokio::test]
async fn series_http_books_atomic_real_slots_and_recovers_exact_same_actor_request() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let data = config(&app, 2).await;
    let (a, b) = tokio::join!(
        send(&app, &token, Method::POST, BASE, data.clone()),
        send(&app, &token, Method::POST, BASE, data.clone())
    );
    assert_eq!(a.status(), StatusCode::OK);
    assert_eq!(b.status(), StatusCode::OK);
    let a = json_body(a).await;
    let b = json_body(b).await;
    assert_eq!(a["data"], b["data"]);
    assert_eq!(a["data"]["appointments"].as_array().unwrap().len(), 2);
    assert!(a["data"]["snapshot_token"].is_string());
    let id = a["data"]["id"].as_str().unwrap();
    let key = data["client_request_id"].as_str().unwrap();
    let recovered = json_body(
        send(
            &app,
            &token,
            Method::GET,
            &format!("{BASE}/requests/{key}"),
            Value::Null,
        )
        .await,
    )
    .await;
    assert_eq!(recovered["data"], a["data"]);
    let listed = send(
        &app,
        &token,
        Method::GET,
        &format!(
            "{BASE}?patient_id={}&limit=1",
            data["patient_id"].as_str().unwrap()
        ),
        Value::Null,
    )
    .await;
    assert_eq!(listed.status(), StatusCode::OK);
    let listed = json_body(listed).await;
    assert_eq!(listed["data"][0]["id"], id);
    assert_eq!(listed["data"][0]["scheduled_count"], 2);
    assert!(listed["data"][0].get("appointments").is_none());
    let mut changed = data.clone();
    changed["occurrences"][0]["overbook_reason"] = json!("Different synthetic instructions");
    let denied = send(&app, &token, Method::POST, BASE, changed).await;
    assert_eq!(denied.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(denied).await["error"]["code"],
        "appointment_series_request_conflict"
    );
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM appointment_series WHERE id=$1),(SELECT count(*) FROM appointments WHERE series_id=$1)").bind(Uuid::parse_str(id).unwrap()).fetch_one(&app.db_pool().await).await.unwrap();
    assert_eq!(counts, (1, 2));
}
#[tokio::test]
async fn future_cancellation_preserves_arrived_and_past_and_returns_a_saved_idempotent_receipt() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let data = config(&app, 3).await;
    let created = send(&app, &token, Method::POST, BASE, data).await;
    assert_eq!(created.status(), StatusCode::OK);
    let created = json_body(created).await;
    let saved = &created["data"];
    let id = saved["id"].as_str().unwrap();
    let path = format!("{BASE}/{id}");
    let cancel = format!("{path}/cancel-future");
    let first = Uuid::parse_str(saved["appointments"][0]["id"].as_str().unwrap()).unwrap();
    let second = Uuid::parse_str(saved["appointments"][1]["id"].as_str().unwrap()).unwrap();
    let pool = app.db_pool().await;
    sqlx::query("UPDATE appointments SET status='checked_in' WHERE id=$1")
        .bind(first)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE appointments SET starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' WHERE id=$1").bind(second).execute(&pool).await.unwrap();
    let mut command = json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":saved["snapshot_token"],"reason":"Synthetic cancellation"});
    let stale = send(&app, &token, Method::POST, &cancel, command.clone()).await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(stale).await["error"]["code"],
        "appointment_series_snapshot_changed"
    );
    let fresh = json_body(send(&app, &token, Method::GET, &path, Value::Null).await).await;
    command["expected_snapshot_token"] = fresh["data"]["snapshot_token"].clone();
    let a = send(&app, &token, Method::POST, &cancel, command.clone()).await;
    assert_eq!(a.status(), StatusCode::OK);
    let a = json_body(a).await;
    assert_eq!(a["data"]["cancelled_count"], 1);
    assert_eq!(
        a["data"]["retained_appointment_ids"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let b = json_body(send(&app, &token, Method::POST, &cancel, command).await).await;
    assert_eq!(a["data"], b["data"]);
    let arrived: String = sqlx::query_scalar("SELECT status FROM appointments WHERE id=$1")
        .bind(first)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(arrived, "checked_in");
}
#[tokio::test]
async fn series_permissions_strict_payloads_and_patient_scope_fail_before_writes() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    let data = config(&app, 2).await;
    assert_eq!(
        send(&app, &limited, Method::POST, BASE, data.clone())
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let mut extra = data.clone();
    extra["repeat_rule"] = json!("weekly");
    assert!(send(&app, &token, Method::POST, BASE, extra)
        .await
        .status()
        .is_client_error());
    let mut manual = data.clone();
    manual["occurrences"][0]["session_id"] = Value::Null;
    assert!(send(&app, &token, Method::POST, BASE, manual)
        .await
        .status()
        .is_client_error());
    let mut unknown = data.clone();
    unknown["patient_id"] = json!(Uuid::new_v4());
    assert_eq!(
        send(&app, &token, Method::POST, BASE, unknown)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(&app, &token, Method::GET, BASE, Value::Null)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let saved = json_body(send(&app, &token, Method::POST, BASE, data.clone()).await).await;
    let id = saved["data"]["id"].as_str().unwrap();
    for path in [
        format!("{BASE}/{id}"),
        format!(
            "{BASE}/requests/{}",
            data["client_request_id"].as_str().unwrap()
        ),
        format!("{BASE}?patient_id={}", data["patient_id"].as_str().unwrap()),
    ] {
        assert_eq!(
            send(&app, &limited, Method::GET, &path, Value::Null)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    let missing = format!("{BASE}/{}", Uuid::new_v4());
    assert_eq!(
        send(&app, &token, Method::GET, &missing, Value::Null)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}
#[tokio::test]
async fn generic_storage_failure_is_unconfirmed_and_transactionally_leaves_no_booking() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let data = config(&app, 2).await;
    sqlx::query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_series_failure CHECK(event_type<>'appointment.series_created')").execute(&app.db_pool().await).await.unwrap();
    let response = send(&app, &token, Method::POST, BASE, data.clone()).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "appointment_series_create_unconfirmed"
    );
    let key = data["client_request_id"].as_str().unwrap();
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            &format!("{BASE}/requests/{key}"),
            Value::Null
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM appointment_series WHERE request_key_hash IS NOT NULL",
    )
    .fetch_one(&app.db_pool().await)
    .await
    .unwrap();
    assert_eq!(count, 0);
}
