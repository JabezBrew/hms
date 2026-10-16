mod support;
use support::*;
const LOCATIONS: &str = "/api/v2/pharmacy/dispensing-locations";
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
async fn pharmacy_actor(app: &TestApp) -> String {
    let id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(app, id, PermissionCode::PharmacyDispense).await;
    grant_test_permission(app, id, PermissionCode::PatientDemographicsView).await;
    grant_test_feature(app, id, FeatureKey::Pharmacy).await;
    grant_test_patient_visibility(app, id, PatientDataVisibility::Demographics).await;
    login(app.clone(), "limited@hms.local").await.0
}
#[tokio::test]
async fn pharmacy_only_actor_can_find_named_active_local_locations_without_inventory_access() {
    let app = app().await;
    let token = pharmacy_actor(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) SELECT $1,'location-other','Synthetic other',deployment_profile FROM facilities WHERE id=$2").bind(foreign).bind(facility).execute(&pool).await.unwrap();
    for (fac, code, name, active) in [
        (facility, "SYN-LOC-A", "Synthetic dispensing A", true),
        (facility, "SYN-LOC-B", "Synthetic dispensing B", true),
        (
            facility,
            "SYN-LOC-C",
            "Synthetic dispensing inactive",
            false,
        ),
        (foreign, "SYN-LOC-D", "Synthetic dispensing foreign", true),
    ] {
        sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,location_type,is_active) VALUES($1,$2,$3,$4,'pharmacy',$5)").bind(Uuid::new_v4()).bind(fac).bind(code).bind(name).bind(active).execute(&pool).await.unwrap();
    }
    let response = send(
        &app,
        &token,
        Method::GET,
        &format!("{LOCATIONS}?search=Synthetic%20dispensing&limit=1"),
        Value::Null,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let first = json_body(response).await;
    assert_eq!(first["data"].as_array().unwrap().len(), 1);
    assert_eq!(first["data"][0].as_object().unwrap().len(), 3);
    for field in ["id", "code", "name"] {
        assert!(first["data"][0][field].is_string());
    }
    assert_eq!(first["page"]["has_next"], true);
    let cursor = first["page"]["next_cursor"].as_str().unwrap();
    let response = send(
        &app,
        &token,
        Method::GET,
        &format!("{LOCATIONS}?search=Synthetic%20dispensing&limit=1&cursor={cursor}"),
        Value::Null,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let second = json_body(response).await;
    assert_eq!(second["page"]["has_next"], false);
    assert_ne!(first["data"][0]["id"], second["data"][0]["id"]);
    let literal = send(
        &app,
        &token,
        Method::GET,
        &format!("{LOCATIONS}?search=%25&limit=100"),
        Value::Null,
    )
    .await;
    assert_eq!(literal.status(), StatusCode::OK);
    assert!(json_body(literal).await["data"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            "/api/v2/inventory/items?limit=1",
            Value::Null
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            &format!("{LOCATIONS}?cursor=invalid"),
            Value::Null
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
}
#[tokio::test]
async fn dispensing_locations_require_the_existing_pharmacy_feature_and_permission() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        send(&app, &token, Method::GET, LOCATIONS, Value::Null)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, id, PermissionCode::PharmacyDispense).await;
    grant_test_permission(&app, id, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&app, id, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        send(&app, &token, Method::GET, LOCATIONS, Value::Null)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn pharmacy_only_actor_uses_named_location_and_bound_stock_to_supply_a_real_dose() {
    let app = app().await;
    let token = pharmacy_actor(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
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
    let item:Uuid=sqlx::query_scalar("SELECT id FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled AND item_type='medication' LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
    let location = Uuid::new_v4();
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,location_type) VALUES($1,$2,'SYN-SUPPLY','Synthetic supply counter','pharmacy')").bind(location).bind(facility).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand,expires_on) VALUES($1,$2,$3,$4,'SYNTHETIC-LOT',5,(clock_timestamp() AT TIME ZONE 'UTC')::date+10)").bind(Uuid::new_v4()).bind(facility).bind(item).bind(location).execute(&pool).await.unwrap();
    let prescription = Uuid::new_v4();
    hms_db::clinical::create_prescription(
        &pool,
        hms_db::clinical::NewPrescription {
            id: prescription,
            facility_id: facility,
            patient_id: patient,
            encounter_id: None,
            visit_id: None,
            discharge_case_id: None,
            medication_name: "Synthetic prescribed medicine".into(),
            dose: "1 tablet".into(),
            route: "oral".into(),
            frequency: "daily".into(),
            inventory_item_id: Some(item),
            start_date: None,
            duration_days: Some(1),
            first_dose_at: None,
            actor_user_id: owner,
        },
    )
    .await
    .unwrap();
    let generated = hms_db::pharmacy::generate_mar_for_prescription(
        &pool,
        hms_db::pharmacy::GenerateMarCommand {
            facility_id: facility,
            prescription_id: prescription,
            admission_case_id: admission,
            days: 1,
            first_dose_at: None,
            actor_user_id: owner,
        },
    )
    .await
    .unwrap();
    let fulfillment = generated.pharmacy_fulfillment_id.unwrap();
    let locations = json_body(
        send(
            &app,
            &token,
            Method::GET,
            &format!("{LOCATIONS}?search=SYN-SUPPLY"),
            Value::Null,
        )
        .await,
    )
    .await;
    assert_eq!(locations["data"][0]["id"], location.to_string());
    assert_eq!(locations["data"][0]["name"], "Synthetic supply counter");
    let path = format!("/api/v2/pharmacy/dispensing-queue/{fulfillment}");
    let queue = send(&app, &token, Method::GET, &path, Value::Null).await;
    assert_eq!(queue.status(), StatusCode::OK);
    let queue = json_body(queue).await;
    assert!(queue["data"]["inventory_item_name"].is_string());
    assert!(queue["data"]["inventory_item_code"].is_string());
    assert!(queue["data"]["inventory_item_unit"].is_string());
    let response = send(
        &app,
        &token,
        Method::POST,
        &format!("{path}/dispense"),
        json!({"item_id":item,"location_id":location,"quantity":1}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["data"]["dispensed_dose_count"], 1);
    let remaining: i64 =
        sqlx::query_scalar("SELECT quantity_on_hand FROM stock_batches WHERE location_id=$1")
            .bind(location)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, 4);
    assert_eq!(
        send(
            &app,
            &token,
            Method::GET,
            "/api/v2/inventory/items?limit=1",
            Value::Null
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}
