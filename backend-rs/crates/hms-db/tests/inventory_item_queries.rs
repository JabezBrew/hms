//! Focused query budgets, not a production latency or load-test claim.
#[path = "support_item_governance/mod.rs"]
mod governed;
use hms_db::{inventory::items, test_support::TestDb};
use hms_domain::inventory_items::*;
use uuid::Uuid;
#[tokio::test]
async fn item24_minimal_pages_and_both_history_sources_have_constant_query_counts() {
    let db = TestDb::hospital().await.unwrap();
    let pool = db.pool();
    let f = db.facility_id();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit)SELECT gen_random_uuid(),$1,$2,'S24_QUERY_'||lpad(n::text,4,'0'),'Synthetic query item','medication','tablet' FROM generate_series(1,1000)n").bind(f).bind(Uuid::from_u128(hms_db::provision::DEFAULT_INVENTORY_CATEGORY_MED_ID)).execute(pool).await.unwrap();
    let item: Uuid = sqlx::query_scalar(
        "SELECT id FROM inventory_items WHERE facility_id=$1 AND code='S24_QUERY_0001'",
    )
    .bind(f)
    .fetch_one(pool)
    .await
    .unwrap();
    let actor = governed::actor(pool, f).await;
    for n in 1..=12 {
        items::command(
            pool,
            actor.clone(),
            InventoryItemReviewedInput::Correct {
                client_request_id: Uuid::new_v4(),
                item_id: item,
                expected_version: n,
                effective_from: chrono::Utc::now().date_naive(),
                code: "S24_QUERY_0001".into(),
                name: format!("Synthetic query revision {n}"),
                unit: "tablet".into(),
                reason: "Synthetic query history".into(),
            },
        )
        .await
        .unwrap();
    }
    for limit in [1, 10, 50] {
        let (rows, count) = hms_observability::with_request_query_counter(items::list(
            pool,
            f,
            None,
            limit,
            InventoryItemAdministrationQuery::default(),
        ))
        .await;
        assert_eq!(rows.unwrap().len(), limit as usize);
        assert_eq!(
            count, 1,
            "minimal list is one joined page, without per-row existence"
        );
        let (rows, count) = hms_observability::with_request_query_counter(items::history(
            pool, f, item, None, limit,
        ))
        .await;
        assert_eq!(rows.unwrap().len(), (limit as usize).min(12));
        assert_eq!(count, 3, "one source proof and two bounded history SELECTs");
    }
    let (detail, count) =
        hms_observability::with_request_query_counter(items::detail(pool, f, item)).await;
    assert!(detail.unwrap().is_some());
    assert_eq!(count, 2);
    let (categories, count) =
        hms_observability::with_request_query_counter(items::categories(pool, f, None, 101, None))
            .await;
    assert!(categories.unwrap().len() <= 101);
    assert_eq!(count, 1);
    // Real unrelated metadata history makes the target UUID index selective.
    let other: Uuid = sqlx::query_scalar(
        "SELECT id FROM inventory_items WHERE facility_id=$1 AND code='S24_QUERY_0002'",
    )
    .bind(f)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO stock_transfers(id,facility_id,item_id,from_location_id,to_location_id,quantity,status,created_by_user_id,requested_unit)SELECT gen_random_uuid(),$1,$2,$3,$4,1,'requested',$5,'tablet' FROM generate_series(1,1000)").bind(f).bind(other).bind(Uuid::from_u128(hms_db::provision::DEFAULT_MAIN_STORE_ID)).bind(Uuid::from_u128(hms_db::provision::DEFAULT_PHARMACY_STORE_ID)).bind(db.owner_user_id()).execute(pool).await.unwrap();
    sqlx::query("ANALYZE stock_transfers")
        .execute(pool)
        .await
        .unwrap();
    let plan: serde_json::Value = sqlx::query_scalar(
        "EXPLAIN(FORMAT JSON)SELECT EXISTS(SELECT 1 FROM stock_transfers WHERE item_id=$1)",
    )
    .bind(item)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(
        plan.to_string()
            .contains("inventory_item_transfer_reference_idx"),
        "actual UUID probe has a selective leading index"
    );
    let unused: bool = sqlx::query_scalar("SELECT inventory_item_has_operational_history($1)")
        .bind(item)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(!unused);
    let used: bool = sqlx::query_scalar("SELECT inventory_item_has_operational_history($1)")
        .bind(other)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(used);
    println!("ITEM24 observed query budgets list1/detail2/history3/categories1 at page1,10,50; actual selective UUID probe over1000unrelated transfers used leadingindex (notp99acceptance)");
}
