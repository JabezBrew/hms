use super::*;
struct Legacy {
    app: TestApp,
    token: String,
    item: Uuid,
    unsupported: Uuid,
    mismatched: Uuid,
    transfer: Uuid,
    shared: Uuid,
    stamp: chrono::DateTime<Utc>,
    before: Value,
}
async fn legacy() -> Legacy {
    let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610300030)
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
    let f = baseline.facility_id;
    let category: Uuid = sqlx::query_scalar(
        "SELECT id FROM inventory_categories WHERE facility_id=$1 AND is_active LIMIT 1",
    )
    .bind(f)
    .fetch_one(&pool)
    .await
    .unwrap();
    let item = Uuid::new_v4();
    let unsupported = Uuid::new_v4();
    let mismatched = Uuid::new_v4();
    let shared = Uuid::new_v4();
    let transfer = Uuid::new_v4();
    let stamp = chrono::DateTime::parse_from_rfc3339("2001-01-02T03:04:05Z")
        .unwrap()
        .with_timezone(&Utc);
    for (id, code, kind, name, unit, active) in [
        (
            item,
            " LEGACY RAW ",
            "medication",
            "x".repeat(200),
            " legacy tablet ",
            true,
        ),
        (
            unsupported,
            "LEGACY_UNKNOWN",
            "historical_unknown",
            "Synthetic unknown type".into(),
            "legacy unit",
            true,
        ),
        (
            mismatched,
            "LEGACY_INACTIVE_CATEGORY",
            "supply",
            "Synthetic category mismatch".into(),
            "box",
            false,
        ),
    ] {
        sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,is_active)VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(id).bind(f).bind(category).bind(code).bind(name).bind(kind).bind(unit).bind(active).execute(&pool).await.unwrap();
    }
    let foreign = Uuid::new_v4();
    let foreigncategory = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'S24_LEGACY_OTHER','Synthetic legacy other','hospital')").bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name)VALUES($1,$2,'S24_LEGACY_CATEGORY','Synthetic legacy foreign category')").bind(foreigncategory).bind(foreign).execute(&pool).await.unwrap();
    sqlx::query("UPDATE inventory_items SET category_id=$2 WHERE id=$1")
        .bind(mismatched)
        .bind(foreigncategory)
        .execute(&pool)
        .await
        .unwrap();
    for (id, date, until, code) in [
        (
            shared,
            chrono::NaiveDate::from_ymd_opt(1999, 1, 1).unwrap(),
            Some(chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
            "HISTORICAL_RAW",
        ),
        (
            Uuid::new_v4(),
            today() + Duration::days(365),
            None,
            "FUTURE_RAW",
        ),
    ] {
        sqlx::query("INSERT INTO inventory_item_catalog_versions(id,facility_id,item_id,effective_from,effective_to,code,name,unit,reason,created_at)VALUES($1,$2,$3,$4,$5,$6,'Legacy evidence','legacy tablet','Historical review',$7)").bind(id).bind(f).bind(item).bind(date).bind(until).bind(code).bind(stamp).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO stock_transfers(id,facility_id,item_id,from_location_id,to_location_id,quantity,status)VALUES($1,$2,$3,$4,$5,1,'requested')").bind(transfer).bind(f).bind(item).bind(Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID)).bind(Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID)).execute(&pool).await.unwrap();
    let before = sqlx::query_scalar(
        "SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM inventory_item_catalog_versions v",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    hms_db::schema_compatibility::require_runtime_schema(&pool)
        .await
        .unwrap();
    pool.close().await;
    let (app, token) = ordinary_in(
        app_with_config(
            Config::for_tests_with_database_url(database.database_url().to_owned()),
            database,
        )
        .await,
    )
    .await;
    Legacy {
        app,
        token,
        item,
        unsupported,
        mismatched,
        transfer,
        shared,
        stamp,
        before,
    }
}
#[tokio::test]
async fn historical_raw_catalog_future_rows_and_nullable_transfer_stamps_remain_exact() {
    let l = legacy().await;
    let pool = l.app.db_pool().await;
    let d = detail(&l.app, &l.token, l.item).await;
    assert_eq!(d["item"]["code"], " LEGACY RAW ");
    assert_eq!(d["item"]["name"].as_str().unwrap().len(), 200);
    assert_eq!(d["item"]["unit"], " legacy tablet ");
    assert_eq!(d["item"]["version"], 1);
    assert!(d["item"]["catalog_changed_at"].is_null());
    let (s, b) = correction(
        &l.app,
        &l.token,
        l.item,
        1,
        today() - Duration::days(2),
        " legacy tablet ",
        &"x".repeat(200),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["changed"], false);
    assert_eq!(b["data"]["item"], d["item"]);
    let(s,b)=request(&l.app,&l.token,Method::POST,"/api/v2/inventory/transfers",Some(json!({"expected_unit":" legacy tablet ","item_id":l.item,"from_location_id":Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID),"to_location_id":Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID),"quantity":1}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["data"]["requested_unit"], " legacy tablet ");
    let (s, b) = request(
        &l.app,
        &l.token,
        Method::GET,
        "/api/v2/inventory/transfers?limit=100",
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let old = b["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == l.transfer.to_string())
        .unwrap();
    assert!(old["requested_unit"].is_null());
    sqlx::query("UPDATE stock_transfers SET status='completed' WHERE id=$1")
        .bind(l.transfer)
        .execute(&pool)
        .await
        .unwrap();
    let stamp: Option<String> =
        sqlx::query_scalar("SELECT requested_unit FROM stock_transfers WHERE id=$1")
            .bind(l.transfer)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stamp, None);
    assert!(
        sqlx::query("UPDATE stock_transfers SET requested_unit='invented' WHERE id=$1")
            .bind(l.transfer)
            .execute(&pool)
            .await
            .is_err()
    );
    for sql in ["UPDATE inventory_item_catalog_versions SET name=name WHERE item_id=$1","DELETE FROM inventory_item_catalog_versions WHERE item_id=$1","INSERT INTO inventory_item_catalog_versions(id,facility_id,item_id,effective_from,code,name,unit,reason)SELECT gen_random_uuid(),facility_id,id,'1900-01-01','X','X','X','X' FROM inventory_items WHERE id=$1"]{assert!(sqlx::query(sql).bind(l.item).execute(&pool).await.is_err());}
    let after: Value = sqlx::query_scalar(
        "SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM inventory_item_catalog_versions v",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after, l.before);
    let u = detail(&l.app, &l.token, l.unsupported).await;
    assert_eq!(u["item"]["item_type"], "historical_unknown");
    assert_eq!(
        u["eligibility"]["lifecycle_blocked_by"],
        "controlled_or_unsupported"
    );
    assert_eq!(
        lifecycle(&l.app, &l.token, l.unsupported, "retire", 1)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let m = detail(&l.app, &l.token, l.mismatched).await;
    assert!(m["item"]["category"].is_null());
    let before = effects(&l.app).await;
    assert_eq!(
        lifecycle(&l.app, &l.token, l.mismatched, "reactivate", 1)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(effects(&l.app).await, before);
    println!("ITEM24 real029 imported raw strings/future intervals/category mismatch and legacyNULL transfer remain exact under030; current source stamps preserve rawunit");
}
#[tokio::test]
async fn history_cursor_total_order_keeps_same_uuid_and_timestamp_in_both_sources() {
    let l = legacy().await;
    let pool = l.app.db_pool().await;
    let item = detail(&l.app, &l.token, l.item).await["item"].clone();
    let key = Uuid::new_v4();
    let input = json!({"action":"correct","client_request_id":key,"item_id":l.item,"expected_version":1,"effective_from":"1999-01-01","code":item["code"],"name":item["name"],"unit":item["unit"],"reason":"Synthetic equal-key fixture"});
    let digest = Sha256::digest(serde_json::to_vec(&input).unwrap());
    let hex: String = digest.iter().map(|v| format!("{v:02x}")).collect();
    let projection =
        json!({"code":item["code"],"name":item["name"],"unit":item["unit"],"version":1});
    let receipt = json!({"client_request_id":key,"input_digest":hex,"reviewed_input":input,"recorded_by_user_id":Uuid::from_u128(hms_db::provision::LIMITED_USER_ID),"item":item,"changed":false,"recorded_at":l.stamp,"correction_revision":{"id":l.shared,"reviewed_effective_from":"1999-01-01","recorded_at":l.stamp,"before":projection,"after":projection,"projection_changed":false}});
    let _: hms_domain::inventory_items::InventoryItemCommandReceipt =
        serde_json::from_value(receipt.clone()).unwrap();
    // Trusted guarded fixture makes the adversarial equal(source UUID,time) case;
    // it is not a claim that an HTTP caller chooses revision IDs or timestamps.
    let hash = Sha256::digest(key.as_bytes()).to_vec();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO inventory_item_commands(facility_id,request_key_hash,actor_user_id,item_id,action,payload_digest,receipt,recorded_at)VALUES($1,$2,$3,$4,'correct',$5,$6,$7)").bind(l.app.state().facility_id()).bind(&hash).bind(Uuid::from_u128(hms_db::provision::LIMITED_USER_ID)).bind(l.item).bind(digest.to_vec()).bind(&receipt).bind(l.stamp).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO inventory_item_catalog_revisions(id,facility_id,item_id,request_key_hash,reviewed_effective_from,recorded_at,before_code,before_name,before_unit,before_version,after_code,after_name,after_unit,after_version,projection_changed,reason_present)VALUES($1,$2,$3,$4,'1999-01-01',$5,$6,$7,$8,1,$6,$7,$8,1,false,true)").bind(l.shared).bind(l.app.state().facility_id()).bind(l.item).bind(hash).bind(l.stamp).bind(item["code"].as_str().unwrap()).bind(item["name"].as_str().unwrap()).bind(item["unit"].as_str().unwrap()).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let mut cursor = None;
    let mut rows = Vec::new();
    for _ in 0..5 {
        let path = format!(
            "/api/v2/inventory/items/{}/catalog-history?limit=1{}",
            l.item,
            cursor
                .as_ref()
                .map(|c: &String| format!("&cursor={c}"))
                .unwrap_or_default()
        );
        let (s, b) = request(&l.app, &l.token, Method::GET, &path, None).await;
        assert_eq!(s, StatusCode::OK);
        rows.extend(b["data"].as_array().unwrap().iter().cloned());
        cursor = b["page"]["next_cursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(rows.len(), 3);
    let shared: Vec<_> = rows
        .iter()
        .filter(|r| r["id"] == l.shared.to_string())
        .collect();
    assert_eq!(shared.len(), 2);
    assert_eq!(shared[0]["source"], "governed_correction");
    assert_eq!(shared[1]["source"], "legacy_dated_version");
    assert!(rows
        .iter()
        .all(|v| v.get("recorded_by_user_id").is_none() && v.get("reason").is_none()));
    let after: Value = sqlx::query_scalar(
        "SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM inventory_item_catalog_versions v",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after, l.before);
    println!("ITEM24 boundedactualhistory totalorder retains both exactUUID/time sources and private-free general DTOs");
}
