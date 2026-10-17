//! A normal baseline deploy must never reinterpret retained stock evidence.
use hms_db::provision::{self, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;
use serde_json::Value;
use uuid::Uuid;

async fn fixture() -> (
    hms_db::test_support::TestDatabase,
    hms_db::PgPool,
    BaselineProvisioning,
) {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let baseline = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    (database, pool, baseline)
}

async fn critical_fields(pool: &hms_db::PgPool, facility: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_object('id',id,'category_id',category_id,'code',code,'name',name,'unit',unit,'item_type',item_type,'controlled',controlled,'is_active',is_active) ORDER BY code) FROM inventory_items WHERE facility_id=$1")
        .bind(facility).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn baseline_preserves_reviewed_item_identity_classification_units_and_retained_stock() {
    let (_database, pool, baseline) = fixture().await;
    let para = Uuid::from_u128(provision::DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID);
    let morphine = Uuid::from_u128(provision::DEFAULT_INVENTORY_ITEM_MORPHINE_ID);
    let location = Uuid::from_u128(provision::DEFAULT_MAIN_STORE_ID);
    sqlx::query("UPDATE inventory_items SET name='Retained reviewed catalog item',unit='retained reviewed unit',item_type=CASE WHEN id=$1 THEN 'controlled_substance' ELSE 'medication' END,controlled=(id=$1),is_active=false WHERE id=ANY($2)")
        .bind(para).bind(vec![para,morphine]).execute(&pool).await.unwrap();
    let batch = Uuid::new_v4();
    sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand,received_unit) VALUES($1,$2,$3,$4,'SYNTHETIC-RETAINED',7,'retained reviewed unit')")
        .bind(batch).bind(baseline.facility_id).bind(para).bind(location).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO controlled_substance_register(id,facility_id,item_id,location_id,movement_type,quantity_delta,balance_after,created_by_user_id) VALUES($1,$2,$3,$4,'receipt',7,7,$5)")
        .bind(Uuid::new_v4()).bind(baseline.facility_id).bind(para).bind(location)
        .bind(Uuid::from_u128(provision::OWNER_USER_ID)).execute(&pool).await.unwrap();
    let before = critical_fields(&pool, baseline.facility_id).await;
    let stock_before: Value = sqlx::query_scalar("SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM stock_batches b),'ledger',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM controlled_substance_register r))")
        .fetch_one(&pool).await.unwrap();
    provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    assert_eq!(critical_fields(&pool, baseline.facility_id).await, before);
    let stock_after: Value = sqlx::query_scalar("SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM stock_batches b),'ledger',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM controlled_substance_register r))")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(stock_after, stock_before);
}

#[tokio::test]
async fn baseline_preserves_a_governed_code_rename_on_the_canonical_item() {
    let (_database, pool, baseline) = fixture().await;
    let para = Uuid::from_u128(provision::DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID);
    hms_db::inventory::apply_catalog_edit(
        &pool,
        hms_db::inventory::CatalogEditCommand {
            authorization: None,
            id: Uuid::new_v4(),
            facility_id: baseline.facility_id,
            item_id: para,
            effective_from: chrono::Utc::now().date_naive(),
            code: "REVIEWED-PARA".into(),
            name: "Reviewed retained item".into(),
            unit: "tablet".into(),
            reason: "Synthetic reviewed catalog correction".into(),
            actor_user_id: Uuid::from_u128(provision::OWNER_USER_ID),
        },
    )
    .await
    .unwrap();
    let before = critical_fields(&pool, baseline.facility_id).await;
    let versions: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_item_catalog_versions")
        .fetch_one(&pool)
        .await
        .unwrap();
    provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    assert_eq!(critical_fields(&pool, baseline.facility_id).await, before);
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_item_catalog_versions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, versions);
}

#[tokio::test]
async fn baseline_refuses_noncanonical_code_collision_without_rewriting_existing_item() {
    let (_database, pool, baseline) = fixture().await;
    let para = Uuid::from_u128(provision::DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID);
    let retained_id = Uuid::new_v4();
    sqlx::query("UPDATE inventory_items SET id=$1,name='Retained legacy identity',unit='legacy physical unit',controlled=true,item_type='controlled_substance',is_active=false WHERE id=$2")
        .bind(retained_id).bind(para).execute(&pool).await.unwrap();
    let before = critical_fields(&pool, baseline.facility_id).await;
    let result = provision::provision_baseline(&pool, &baseline).await;
    assert!(
        result.is_err(),
        "an existing code is not permission to rewrite its identity"
    );
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("baseline_inventory_item_review_required"));
    assert_eq!(critical_fields(&pool, baseline.facility_id).await, before);
    let canonical_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_items WHERE id=$1)")
            .bind(para)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!canonical_exists);
}
