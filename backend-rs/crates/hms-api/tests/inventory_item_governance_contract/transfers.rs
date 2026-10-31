use super::*;
fn transfer_body(id: Uuid, unit: &str) -> Value {
    json!({"expected_unit":unit,"item_id":id,"from_location_id":Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID),"to_location_id":Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID),"quantity":1})
}
async fn transfer(app: &TestApp, t: &str, id: Uuid, unit: &str) -> (StatusCode, Value) {
    request(
        app,
        t,
        Method::POST,
        "/api/v2/inventory/transfers",
        Some(transfer_body(id, unit)),
    )
    .await
}
async fn transfer_count(app: &TestApp, id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM stock_transfers WHERE item_id=$1")
        .bind(id)
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap()
}
pub(super) async fn wait_audit(pool: &hms_db::PgPool, key: i64) {
    for _ in 0..300 {
        let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid::bigint=$1 AND NOT granted)").bind(key).fetch_one(pool).await.unwrap();
        if waiting {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("actual configured audit advisory barrier was not reached")
}
async fn audit_barrier(pool: &hms_db::PgPool, event: &str, key: i64) {
    assert!(matches!(
        event,
        "inventory.item.correct" | "inventory.stock_transfer.requested"
    ));
    let sql=format!("CREATE FUNCTION hold_item24_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='{event}' THEN PERFORM pg_advisory_xact_lock({key});END IF;RETURN NEW;END$$;CREATE TRIGGER hold_item24_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION hold_item24_audit();");
    sqlx::raw_sql(&sql).execute(pool).await.unwrap();
}
#[tokio::test]
async fn strict_transfer_unit_and_current_local_source_refusals_leave_zero_rows() {
    let (app, t) = ordinary().await;
    let original = create(&app, &t, "S24_TRANSFER_SOURCE").await;
    let id = item_id(&original);
    let inactive = item_id(&create(&app, &t, "S24_TRANSFER_INACTIVE").await);
    assert_eq!(
        lifecycle(&app, &t, inactive, "retire", 1).await.0,
        StatusCode::OK
    );
    let pool = app.db_pool().await;
    let foreign = Uuid::new_v4();
    let category = Uuid::new_v4();
    let foreign_item = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'S24_FOREIGN','Synthetic foreign facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name)VALUES($1,$2,'S24_CATEGORY','Synthetic foreign category')").bind(category).bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit)VALUES($1,$2,$3,'S24_FOREIGN_ITEM','Synthetic foreign item','supply','box')").bind(foreign_item).bind(foreign).bind(category).execute(&pool).await.unwrap();
    let before = effects(&app).await;
    for target in [inactive, foreign_item] {
        let (s, b) = transfer(&app, &t, target, "tablet").await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(b["error"]["code"], "stock_transfer_source_unavailable");
        assert_eq!(transfer_count(&app, target).await, 0);
    }
    for unit in ["pack", " tablet "] {
        let (s, b) = transfer(&app, &t, id, unit).await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(b["error"]["code"], "stock_transfer_unit_changed");
        assert_eq!(transfer_count(&app, id).await, 0);
    }
    let mut missing = transfer_body(id, "tablet");
    missing.as_object_mut().unwrap().remove("expected_unit");
    assert_eq!(
        request(
            &app,
            &t,
            Method::POST,
            "/api/v2/inventory/transfers",
            Some(missing)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut extra = transfer_body(id, "tablet");
    extra["unexpected"] = json!(true);
    assert_eq!(
        request(
            &app,
            &t,
            Method::POST,
            "/api/v2/inventory/transfers",
            Some(extra)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(effects(&app).await, before);
    let (s, b) = transfer(&app, &t, id, "tablet").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["requested_unit"], "tablet");
    assert_eq!(b["data"]["quantity"], 1);
    assert_eq!(transfer_count(&app, id).await, 1);
    let after = effects(&app).await;
    assert_eq!(after["batches"], before["batches"]);
    assert_eq!(after["movements"], before["movements"]);
    println!("ITEM24 exact reviewed transfer unit/current local source negatives preserve0rows; explicit unchanged-unit metadata positive saves stamp without physical movement");
}
#[tokio::test]
async fn transfer_purpose_keeps_supply_and_controlled_metadata_without_medication_only_gate() {
    let (app, t) = ordinary().await;
    let mut input = create_input(&app, "S24_SUPPLY").await;
    input["item_type"] = json!("supply");
    input["unit"] = json!("box");
    let (s, b) = request(
        &app,
        &t,
        Method::POST,
        "/api/v2/inventory/items",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let supply = item_id(&b["data"]);
    let pool = app.db_pool().await;
    let controlled = Uuid::new_v4();
    let category: Uuid = sqlx::query_scalar(
        "SELECT id FROM inventory_categories WHERE facility_id=$1 AND is_active LIMIT 1",
    )
    .bind(app.state().facility_id())
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,controlled)VALUES($1,$2,$3,'S24_CONTROLLED_METADATA','Synthetic controlled metadata fixture','controlled_substance','ampoule',true)").bind(controlled).bind(app.state().facility_id()).bind(category).execute(&pool).await.unwrap();
    for (id, unit) in [(supply, "box"), (controlled, "ampoule")] {
        let (s, b) = transfer(&app, &t, id, unit).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b["data"]["requested_unit"], unit);
    }
    println!("ITEM24 existing supply/controlled transfer metadata purpose retained without physical-stock authority expansion");
}
#[tokio::test]
async fn transfer_response_projection_failure_rolls_back_before_commit() {
    let (app, t) = ordinary().await;
    let id = item_id(&create(&app, &t, "S24_TRANSFER_RETURNING").await);
    let pool = app.db_pool().await;
    let before = effects(&app).await;
    sqlx::raw_sql("CREATE FUNCTION invalid_item24_transfer_projection() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.status:='invalid_synthetic_status';RETURN NEW;END$$;CREATE TRIGGER z_invalid_item24_transfer_projection BEFORE INSERT ON stock_transfers FOR EACH ROW EXECUTE FUNCTION invalid_item24_transfer_projection();").execute(&pool).await.unwrap();
    let (s, b) = transfer(&app, &t, id, "tablet").await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "stock_transfer_write_unconfirmed");
    assert_eq!(transfer_count(&app, id).await, 0);
    assert_eq!(effects(&app).await, before);
    println!("ITEM24 transfer RETURNING/codec failure leaves0rows and0audit effects");
}
#[tokio::test]
async fn catalog_first_retains_item_exclusion_before_transfer_unit_basis() {
    let (app, t) = ordinary().await;
    let id = item_id(&create(&app, &t, "S24_CATALOG_FIRST").await);
    let pool = app.db_pool().await;
    let key = 24003021;
    audit_barrier(&pool, "inventory.item.correct", key).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let token = t.clone();
    let correcting = tokio::spawn(async move {
        correction(
            &a,
            &token,
            id,
            1,
            today(),
            "pack",
            "Synthetic catalog-first unit",
        )
        .await
    });
    wait_audit(&pool, key).await;
    let (s, b) = transfer(&app, &t, id, "tablet").await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "stock_transfer_source_busy");
    assert_eq!(transfer_count(&app, id).await, 0);
    gate.rollback().await.unwrap();
    assert_eq!(correcting.await.unwrap().0, StatusCode::OK);
    assert_eq!(detail(&app, &t, id).await["item"]["unit"], "pack");
    println!("ITEM24 actual catalog audit barrier retains item exclusion; transfer refuses before unit publication with0rows");
}
#[tokio::test]
async fn transfer_first_retains_source_share_and_new_history_blocks_later_unit_change() {
    let (app, t) = ordinary().await;
    let id = item_id(&create(&app, &t, "S24_TRANSFER_FIRST").await);
    let pool = app.db_pool().await;
    let key = 24003022;
    audit_barrier(&pool, "inventory.stock_transfer.requested", key).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let token = t.clone();
    let transferring = tokio::spawn(async move { transfer(&a, &token, id, "tablet").await });
    wait_audit(&pool, key).await;
    let before = effects(&app).await;
    let (s, b) = correction(
        &app,
        &t,
        id,
        1,
        today(),
        "pack",
        "Synthetic forbidden concurrent unit",
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_item_busy");
    assert_eq!(effects(&app).await, before);
    gate.rollback().await.unwrap();
    let (s, b) = transferring.await.unwrap();
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["requested_unit"], "tablet");
    let (s, b) = correction(
        &app,
        &t,
        id,
        1,
        today(),
        "pack",
        "Synthetic forbidden retained unit",
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(b["error"]["code"], "inventory_item_has_operational_history");
    assert_eq!(detail(&app, &t, id).await["item"]["unit"], "tablet");
    println!("ITEM24 actual transfer audit barrier retains SHARE; concurrent metadata refuses, committed history blocks unit change");
}
#[tokio::test]
async fn transfer_late_authority_expiry_rolls_back_row_and_audit() {
    let (app, t) = ordinary().await;
    let id = item_id(&create(&app, &t, "S24_TRANSFER_EXPIRY").await);
    let pool = app.db_pool().await;
    let f = app.state().facility_id();
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    sqlx::query(
        "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='inventory.manage'",
    )
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();
    let end:chrono::DateTime<Utc>=sqlx::query_scalar("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,status,starts_at,ends_at,granted_by_user_id)VALUES($1,$2,$3,'inventory.manage','facility','active',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '3 seconds',$4) RETURNING ends_at").bind(Uuid::new_v4()).bind(f).bind(user).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).fetch_one(&pool).await.unwrap();
    let (t, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    let key = 24003023;
    audit_barrier(&pool, "inventory.stock_transfer.requested", key).await;
    let before = effects(&app).await;
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut *gate)
        .await
        .unwrap();
    let a = app.clone();
    let transferring = tokio::spawn(async move { transfer(&a, &t, id, "tablet").await });
    wait_audit(&pool, key).await;
    loop {
        let expired: bool = sqlx::query_scalar("SELECT clock_timestamp()>$1")
            .bind(end)
            .fetch_one(&pool)
            .await
            .unwrap();
        if expired {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    gate.rollback().await.unwrap();
    let (s, b) = transferring.await.unwrap();
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(b["error"]["code"], "inventory_transfer_authority_required");
    assert_eq!(effects(&app).await, before);
    assert_eq!(transfer_count(&app, id).await, 0);
    println!("ITEM24 final DB-clock grant expiry after actual transfer audit wait rolls back row and audit");
}
