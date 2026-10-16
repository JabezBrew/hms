mod support;
use support::*;

async fn setup(app: &TestApp, token: &str) -> (Uuid, Uuid, Uuid) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let admission = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
    let stock:Uuid=sqlx::query_scalar("SELECT id FROM inventory_items WHERE facility_id=$1 AND NOT controlled AND item_type='medication' LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
    let unit: String = sqlx::query_scalar("SELECT unit FROM inventory_items WHERE id=$1")
        .bind(stock)
        .fetch_one(&pool)
        .await
        .unwrap();
    // The active inpatient Chronicle passes this real encounter context. Seeded
    // inpatient vocabulary must cross the same typed read used by prescribing.
    let encounter = Uuid::new_v4();
    sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'inpatient','in_progress')")
        .bind(encounter).bind(facility).bind(patient).execute(&pool).await.unwrap();
    let created=post(app,token,format!("/api/v2/patients/{patient}/clinical/prescriptions"),json!({"encounter_id":encounter,"admission_case_id":admission,"medication_name":"Synthetic PRN","dose":"2 tablets","route":"oral","frequency":"prn","inventory_item_id":stock,"prn_policy":{"expected_stock_unit":unit,"minimum_interval_hours":4,"maximum_doses_per_24_hours":2,"stock_units_per_dose":2,"indication":"Synthetic prescribed indication"}})).await;
    assert_eq!(created.status(), StatusCode::OK);
    let body = json_body(created).await;
    assert!(body["data"]["prn_policy"]["stock_unit"].is_string());
    (
        patient,
        admission,
        Uuid::parse_str(body["data"]["id"].as_str().unwrap()).unwrap(),
    )
}
async fn post(app: &TestApp, token: &str, path: String, body: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn get(app: &TestApp, token: &str, path: String) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}
fn request(source: Uuid, admission: Uuid, key: Uuid) -> Value {
    json!({"prescription_id":source,"admission_case_id":admission,"client_request_id":key,"indication":"Synthetic actual indication"})
}

#[tokio::test]
async fn configured_prn_is_source_linked_visible_scoped_and_idempotent_without_anonymous_administration(
) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (patient, admission, source) = setup(&app, &token).await;
    let list = get(
        &app,
        &token,
        format!("/api/v2/nursing/prn-orders?admission_case_id={admission}&limit=1"),
    )
    .await;
    assert_eq!(list.status(), StatusCode::OK);
    let data = json_body(list).await;
    assert_eq!(data["data"][0]["patient_id"], patient.to_string());
    assert_eq!(data["data"][0]["prescription_id"], source.to_string());
    let body = request(source, admission, Uuid::new_v4());
    let a = post(
        &app,
        &token,
        "/api/v2/nursing/prn-dose-requests".into(),
        body.clone(),
    )
    .await;
    assert_eq!(a.status(), StatusCode::OK);
    let a = json_body(a).await;
    assert_eq!(a["data"]["created"], true);
    let b = post(
        &app,
        &token,
        "/api/v2/nursing/prn-dose-requests".into(),
        body,
    )
    .await;
    assert_eq!(b.status(), StatusCode::OK);
    let b = json_body(b).await;
    assert_eq!(b["data"]["created"], false);
    assert_eq!(
        a["data"]["medication_administration_id"],
        b["data"]["medication_administration_id"]
    );
    let id = a["data"]["medication_administration_id"].as_str().unwrap();
    let outcome = post(
        &app,
        &token,
        format!("/api/v2/nursing/medication-administrations/{id}/outcome"),
        json!({"status":"administered"}),
    )
    .await;
    assert_eq!(outcome.status(), StatusCode::CONFLICT);
    let list = get(
        &app,
        &token,
        format!("/api/v2/nursing/medication-administrations?admission_case_id={admission}"),
    )
    .await;
    let list = json_body(list).await;
    assert_eq!(
        list["data"][0]["prn_indication"],
        "Synthetic actual indication"
    );
    assert_eq!(list["data"][0]["is_dispensed"], false);
}

#[tokio::test]
async fn prn_validates_typed_payload_and_patient_permissions_before_writes() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (_patient, admission, source) = setup(&app, &token).await;
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in [
        format!("/api/v2/nursing/prn-orders?admission_case_id={admission}"),
        "/api/v2/nursing/prn-orders".into(),
    ] {
        let status = get(&app, &limited, path).await.status();
        assert!(status == StatusCode::FORBIDDEN || status == StatusCode::BAD_REQUEST);
    }
    assert_eq!(
        post(
            &app,
            &limited,
            "/api/v2/nursing/prn-dose-requests".into(),
            request(source, admission, Uuid::new_v4())
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    for body in [
        json!({}),
        json!({"prescription_id":source,"admission_case_id":admission,"client_request_id":Uuid::new_v4(),"indication":"Synthetic","typo":true}),
    ] {
        assert!(post(
            &app,
            &token,
            "/api/v2/nursing/prn-dose-requests".into(),
            body
        )
        .await
        .status()
        .is_client_error());
    }
    let mut invalid = request(source, admission, Uuid::new_v4());
    invalid["indication"] = json!("   ");
    assert_eq!(
        post(
            &app,
            &token,
            "/api/v2/nursing/prn-dose-requests".into(),
            invalid
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    let mut wrong = request(source, Uuid::new_v4(), Uuid::new_v4());
    assert_eq!(
        post(
            &app,
            &token,
            "/api/v2/nursing/prn-dose-requests".into(),
            wrong.clone()
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    wrong["admission_case_id"] = json!(admission);
    wrong["prescription_id"] = json!(Uuid::new_v4());
    assert_eq!(
        post(
            &app,
            &token,
            "/api/v2/nursing/prn-dose-requests".into(),
            wrong
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM medication_administrations WHERE prescription_id=$1",
    )
    .bind(source)
    .fetch_one(&app.db_pool().await)
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn prn_generic_storage_failure_is_truthfully_unconfirmed_and_rolls_back() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (_, admission, source) = setup(&app, &token).await;
    sqlx::query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_prn_audit_failure CHECK(event_type<>'medication.prn_requested')").execute(&app.db_pool().await).await.unwrap();
    let response = post(
        &app,
        &token,
        "/api/v2/nursing/prn-dose-requests".into(),
        request(source, admission, Uuid::new_v4()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "prn_request_unconfirmed"
    );
}

#[tokio::test]
async fn prn_prescriber_stock_unit_is_checked_under_lock_and_stale_unit_does_not_save() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (patient, _, source) = setup(&app, &token).await;
    let pool = app.db_pool().await;
    let (item, old_unit): (Uuid, String) = sqlx::query_as(
        "SELECT inventory_item_id,prn_policy->>'stock_unit' FROM prescriptions WHERE id=$1",
    )
    .bind(source)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE inventory_items SET unit='different synthetic unit' WHERE id=$1")
        .bind(item)
        .execute(&pool)
        .await
        .unwrap();
    let response=post(&app,&token,format!("/api/v2/patients/{patient}/clinical/prescriptions"),json!({"medication_name":"Synthetic stale PRN","dose":"2 tablets","route":"oral","frequency":"prn","inventory_item_id":item,"prn_policy":{"expected_stock_unit":old_unit,"minimum_interval_hours":4,"maximum_doses_per_24_hours":2,"stock_units_per_dose":2,"indication":"Synthetic indication"}})).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "prn_stock_unit_changed"
    );
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM prescriptions WHERE patient_id=$1 AND medication_name='Synthetic stale PRN'").bind(patient).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 0);
}
