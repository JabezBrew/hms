mod support;
use axum::response::Response;
use support::*;

async fn catalog_get(app: &TestApp, bearer: Option<&str>, path: &str) -> Response {
    let mut request = Request::builder().uri(path);
    if let Some(bearer) = bearer {
        request = request.header(AUTHORIZATION, bearer);
    }
    app.clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn prescribing_catalog_is_minimal_scoped_searchable_and_cursor_bounded() {
    let app = app().await;
    grant_test_patient_visibility(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PatientDataVisibility::FullClinical,
    )
    .await;
    let path = "/api/v2/clinical/medication-catalog";
    assert_eq!(
        catalog_get(&app, None, path).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let owner = Actor::login(&app, "owner@hms.local").await;
    let limited = Actor::login(&app, "limited@hms.local").await;
    assert_eq!(
        catalog_get(&app, Some(&limited.bearer()), path)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );

    let pool = app.db_pool().await;
    let facility_id = Uuid::from_u128(hms_db::provision::FACILITY_ID);
    let category_id: Uuid =
        sqlx::query_scalar("SELECT id FROM inventory_categories WHERE facility_id = $1 LIMIT 1")
            .bind(facility_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities (id, code, name, deployment_profile) SELECT $1, 'catalog-other', 'Synthetic catalog facility', deployment_profile FROM facilities WHERE id = $2")
        .bind(foreign_facility).bind(facility_id).execute(&pool).await.unwrap();
    let foreign_category = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_categories (id, facility_id, code, name) VALUES ($1,$2,'catalog-other','Synthetic catalog category')")
        .bind(foreign_category).bind(foreign_facility).execute(&pool).await.unwrap();
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let supply = Uuid::new_v4();
    let inactive = Uuid::new_v4();
    let foreign = Uuid::new_v4();
    for (id, facility, category, code, kind, active) in [
        (
            first,
            facility_id,
            category_id,
            "CATALOG%_A",
            "medication",
            true,
        ),
        (
            second,
            facility_id,
            category_id,
            "CATALOG%_B",
            "controlled_substance",
            true,
        ),
        (
            supply,
            facility_id,
            category_id,
            "CATALOG%_SUPPLY",
            "supply",
            true,
        ),
        (
            inactive,
            facility_id,
            category_id,
            "CATALOG%_INACTIVE",
            "medication",
            false,
        ),
        (
            foreign,
            foreign_facility,
            foreign_category,
            "CATALOG%_FOREIGN",
            "medication",
            true,
        ),
    ] {
        sqlx::query("INSERT INTO inventory_items (id, facility_id, category_id, code, name, item_type, unit, controlled, is_active) VALUES ($1,$2,$3,$4,$4,$5,'tablet',$6,$7)")
            .bind(id).bind(facility).bind(category).bind(code).bind(kind)
            .bind(kind == "controlled_substance").bind(active).execute(&pool).await.unwrap();
    }
    // Escaped percent and underscore match literally, not every catalog row.
    let response = catalog_get(
        &app,
        Some(&owner.bearer()),
        &format!("{path}?search=catalog%25_&limit=1"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["page"]["has_next"], true);
    let item = &body["data"][0];
    assert_eq!(item.as_object().unwrap().len(), 6);
    for field in ["id", "code", "name", "unit", "controlled", "updated_at"] {
        assert!(item.get(field).is_some());
    }
    let cursor = body["page"]["next_cursor"].as_str().unwrap();
    let response = catalog_get(
        &app,
        Some(&owner.bearer()),
        &format!("{path}?search=catalog%25_&limit=1&cursor={cursor}"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let next = json_body(response).await;
    assert_eq!(next["data"].as_array().unwrap().len(), 1);
    assert_ne!(item["id"], next["data"][0]["id"]);
    assert_eq!(next["page"]["has_next"], false);
    let actual = [
        item["id"].as_str().unwrap(),
        next["data"][0]["id"].as_str().unwrap(),
    ];
    assert!(actual.contains(&first.to_string().as_str()));
    assert!(actual.contains(&second.to_string().as_str()));
    assert_eq!(
        catalog_get(
            &app,
            Some(&owner.bearer()),
            &format!("{path}?cursor=invalid")
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );

    // Picking is optional, but a supplied binding must be a live facility medication.
    let patient: Uuid =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id = $1 LIMIT 1")
            .bind(facility_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    for id in [supply, inactive, foreign] {
        let response = app.clone().oneshot(Request::builder().method(Method::POST)
            .uri(format!("/api/v2/patients/{patient}/clinical/prescriptions"))
            .header(AUTHORIZATION, owner.bearer()).header("content-type", "application/json")
            .body(Body::from(json!({"medication_name":"Synthetic catalog medication","dose":"1 tablet","frequency":"daily","inventory_item_id":id}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = json_body(response).await;
        assert!(body["error"]["details"]["inventory_item_id"].is_array());
    }
}
