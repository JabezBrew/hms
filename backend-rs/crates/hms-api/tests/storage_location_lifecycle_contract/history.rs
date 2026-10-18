use super::*;
#[tokio::test]
async fn actual_pre028_inactive_history_migrates_and_can_close_without_retarget_or_reactivation() {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610170028)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let baseline = hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    hms_db::provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let id = Uuid::new_v4();
    let row = Uuid::new_v4();
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,is_active,location_type,temperature_zone)VALUES($1,$2,'SYNTH21_OLD','Synthetic historical inactive location',false,'historical_type','historical_zone')").bind(id).bind(baseline.facility_id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO stock_check_queue(id,facility_id,location_id,status,reason)VALUES($1,$2,$3,'completed','synthetic historical check')").bind(row).bind(baseline.facility_id).bind(id).execute(&pool).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let app = app_with_config(
        Config::for_tests_with_database_url(database.database_url().to_owned()),
        database,
    )
    .await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (s, b) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/storage-locations/{id}/administration"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["location_type"], "historical_type");
    assert_eq!(b["data"]["is_active"], false);
    assert_eq!(
        command(&app, &token, id, "reactivate", 1).await.1["error"]["code"],
        "storage_location_has_operational_history"
    );
    let (s, b) = command(&app, &token, id, "retire", 1).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["changed"], false);
    sqlx::query("UPDATE stock_check_queue SET status='cancelled' WHERE id=$1")
        .bind(row)
        .execute(&pool)
        .await
        .unwrap();
    let(s,b)=request(&app,&token,Method::POST,&format!("/api/v2/inventory/storage-locations/{id}/rename"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic corrected history"}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["location"]["version"], 2);
    let late = Uuid::new_v4();
    sqlx::query("INSERT INTO storage_locations(id,facility_id,code,name,is_active)VALUES($1,$2,'SYNTH21_LATE','Synthetic inactive target',false)").bind(late).bind(baseline.facility_id).execute(&pool).await.unwrap();
    assert!(
        sqlx::query("UPDATE stock_check_queue SET location_id=$2 WHERE id=$1")
            .bind(row)
            .bind(late)
            .execute(&pool)
            .await
            .is_err()
    );
    let linked: Uuid = sqlx::query_scalar("SELECT location_id FROM stock_check_queue WHERE id=$1")
        .bind(row)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(linked, id);
}
#[tokio::test]
async fn canonical_stock_receipt_to_new_location_is_positive_and_metadata_never_changes_its_evidence(
) {
    let (app, token) = setup().await;
    let r = create(&app, &token, "SYNTH21_STOCK").await;
    let id = location_id(&r);
    let pool = app.db_pool().await;
    let(item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled LIMIT 1").bind(app.state().facility_id()).fetch_one(&pool).await.unwrap();
    let(s,b)=request(&app,&token,Method::POST,"/api/v2/inventory/stock-batches",Some(json!({"item_id":item,"location_id":id,"expected_unit":unit,"batch_number":"SYNTHETIC21RECEIPT","quantity_received":3}))).await;
    assert_eq!(s, StatusCode::OK, "static {}", b["error"]["code"]);
    let snapshot = |id| {
        sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(b)ORDER BY id)FROM stock_batches b WHERE location_id=$1),'movements',(SELECT jsonb_agg(to_jsonb(m)ORDER BY id)FROM stock_movements m WHERE location_id=$1))").bind(id)
    };
    let before = snapshot(id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        command(&app, &token, id, "retire", 1).await.1["error"]["code"],
        "storage_location_has_operational_history"
    );
    let(s,_)=request(&app,&token,Method::POST,&format!("/api/v2/inventory/storage-locations/{id}/rename"),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"name":"Synthetic used stock location"}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(snapshot(id).fetch_one(&pool).await.unwrap(), before);
    let quantity: i64 = sqlx::query_scalar(
        "SELECT sum(quantity_on_hand)::bigint FROM stock_batches WHERE location_id=$1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(quantity, 3);
}
#[tokio::test]
async fn retired_default_seed_is_refused_without_reactivation_or_receipt_changes() {
    let (app, token) = setup().await;
    let id = Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID);
    let (s, r) = command(&app, &token, id, "retire", 1).await;
    assert_eq!(s, StatusCode::OK);
    let before = effects(&app).await;
    let seeded = hms_db::provision::provision_baseline(
        &app.db_pool().await,
        &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await;
    assert!(seeded.is_err());
    let (s, current) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/inventory/storage-locations/{id}/administration"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(current["data"], r["data"]["location"]);
    assert_eq!(effects(&app).await, before);
}
