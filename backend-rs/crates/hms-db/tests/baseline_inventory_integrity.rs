//! A normal baseline deploy must never reinterpret retained stock evidence.
use hms_db::provision::{self, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;
use serde_json::Value;
use uuid::Uuid;
#[path = "support_item_governance/mod.rs"]
mod governed;

async fn fixture() -> (
    hms_db::test_support::TestDatabase,
    hms_db::PgPool,
    BaselineProvisioning,
) {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    governed::before030().run(&pool).await.unwrap();
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
    hms_db::migrate::run(&pool).await.unwrap();
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
    hms_db::migrate::run(&pool).await.unwrap();
    let para = Uuid::from_u128(provision::DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID);
    governed::correct(
        &pool,
        baseline.facility_id,
        para,
        "tablet",
        "REVIEWED-PARA",
        "Reviewed retained item",
    )
    .await
    .unwrap();
    let before = critical_fields(&pool, baseline.facility_id).await;
    let versions: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_item_catalog_revisions")
        .fetch_one(&pool)
        .await
        .unwrap();
    provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    assert_eq!(critical_fields(&pool, baseline.facility_id).await, before);
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_item_catalog_revisions")
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
    hms_db::migrate::run(&pool).await.unwrap();
    let before = critical_fields(&pool, baseline.facility_id).await;
    let result = provision::provision_baseline(&pool, &baseline).await;
    assert!(
        result.is_err(),
        "an existing code is not permission to rewrite its identity"
    );
    let error = result.unwrap_err();
    assert!(
        error.chain().any(|e| e
            .downcast_ref::<sqlx::Error>()
            .and_then(|s| s.as_database_error())
            .is_some_and(|e| e.message() == "inventory_item_code_conflict")),
        "intrinsic code collision refuses before missing-default insertion"
    );
    assert_eq!(critical_fields(&pool, baseline.facility_id).await, before);
    let canonical_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_items WHERE id=$1)")
            .bind(para)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!canonical_exists);
}

#[tokio::test]
async fn baseline_supplier_defaults_bind_canonical_uuid_preserve_custom_values_and_real_nonzero_stock(
) {
    let (_d, p, b) = fixture().await;
    hms_db::migrate::run(&p).await.unwrap();
    let id = Uuid::from_u128(provision::DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID);
    let shipped = Uuid::from_u128(provision::DEFAULT_SUPPLIER_ACME_ID);
    let initial: Option<Uuid> =
        sqlx::query_scalar("SELECT primary_supplier_id FROM inventory_items WHERE id=$1")
            .bind(id)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(
        initial,
        Some(shipped),
        "fresh baseline initializes canonical default"
    );
    let custom = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name)VALUES($1,$2,'S24_CUSTOM_SUPPLIER','Synthetic custom supplier')").bind(custom).bind(b.facility_id).execute(&p).await.unwrap();
    governed::correct(
        &p,
        b.facility_id,
        id,
        "tablet",
        "S24_CANONICAL_RENAMED",
        "Synthetic reviewed canonical item",
    )
    .await
    .unwrap();
    let reused = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit)SELECT $1,facility_id,category_id,'PARA500','Synthetic former-code reuse','medication','tablet' FROM inventory_items WHERE id=$2").bind(reused).bind(id).execute(&p).await.unwrap();
    hms_db::inventory::create_batch(
        &p,
        hms_db::inventory::NewStockBatch {
            authorization: None,
            expected_unit: "tablet".into(),
            id: Uuid::new_v4(),
            facility_id: b.facility_id,
            item_id: id,
            location_id: Uuid::from_u128(provision::DEFAULT_MAIN_STORE_ID),
            batch_number: "S24_NONZERO_SUPPLIER".into(),
            expires_on: None,
            quantity_received: 7,
            actor_user_id: Uuid::from_u128(provision::OWNER_USER_ID),
        },
    )
    .await
    .unwrap();
    let positive: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM stock_batches WHERE item_id=$1 AND quantity_on_hand>0)",
    )
    .bind(id)
    .fetch_one(&p)
    .await
    .unwrap();
    assert!(positive, "stored quantity is explicitly greater than zero");
    sqlx::query("UPDATE inventory_items SET primary_supplier_id=$2 WHERE id=$1")
        .bind(id)
        .bind(custom)
        .execute(&p)
        .await
        .unwrap();
    let before: Value = sqlx::query_scalar("SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1")
        .bind(id)
        .fetch_one(&p)
        .await
        .unwrap();
    let stock:Value=sqlx::query_scalar("SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM stock_batches b),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM stock_movements m))").fetch_one(&p).await.unwrap();
    provision::provision_baseline(&p, &b).await.unwrap();
    let after: Value = sqlx::query_scalar("SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1")
        .bind(id)
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(
        after, before,
        "custom supplier and all catalog/version/timestamps remain exact"
    );
    let stockafter:Value=sqlx::query_scalar("SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM stock_batches b),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM stock_movements m))").fetch_one(&p).await.unwrap();
    assert_eq!(stockafter, stock);
    let other: Option<Uuid> =
        sqlx::query_scalar("SELECT primary_supplier_id FROM inventory_items WHERE id=$1")
            .bind(reused)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(
        other, None,
        "mutable shipped code grants no default ownership"
    );
    sqlx::query("UPDATE inventory_items SET primary_supplier_id=NULL WHERE id=$1")
        .bind(id)
        .execute(&p)
        .await
        .unwrap();
    let catalog: Value = sqlx::query_scalar(
        "SELECT to_jsonb(i)-'primary_supplier_id'-'updated_at' FROM inventory_items i WHERE id=$1",
    )
    .bind(id)
    .fetch_one(&p)
    .await
    .unwrap();
    provision::provision_baseline(&p, &b).await.unwrap();
    let missingfilled: Option<Uuid> =
        sqlx::query_scalar("SELECT primary_supplier_id FROM inventory_items WHERE id=$1")
            .bind(id)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(missingfilled, Some(shipped));
    let after: Value = sqlx::query_scalar(
        "SELECT to_jsonb(i)-'primary_supplier_id'-'updated_at' FROM inventory_items i WHERE id=$1",
    )
    .bind(id)
    .fetch_one(&p)
    .await
    .unwrap();
    assert_eq!(after, catalog);
    let exact: Value = sqlx::query_scalar("SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1")
        .bind(id)
        .fetch_one(&p)
        .await
        .unwrap();
    provision::provision_baseline(&p, &b).await.unwrap();
    let after: Value = sqlx::query_scalar("SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1")
        .bind(id)
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(
        after, exact,
        "initialized defaults are a true no-op including updated_at"
    );
}

#[tokio::test]
async fn performance_seed_original_receipt_preserves_later_governed_inventory_and_refuses_changed_intent(
) {
    let (_d, p, b) = fixture().await;
    hms_db::migrate::run(&p).await.unwrap();
    let config = provision::PerformanceSeedConfig {
        patient_count: 2,
        chronicled_patient_count: 0,
        notes_per_chronicle_patient: 0,
        lab_order_count: 0,
        inventory_item_count: 2,
        admission_count: 0,
        invoice_count: 0,
    };
    provision::provision_performance_seed(&p, &b, config)
        .await
        .unwrap();
    let item: Uuid = sqlx::query_scalar(
        "SELECT id FROM inventory_items WHERE facility_id=$1 AND code='PERF-MED-000001'",
    )
    .bind(b.facility_id)
    .fetch_one(&p)
    .await
    .unwrap();
    governed::correct(
        &p,
        b.facility_id,
        item,
        "unit",
        "PERF-MED-000001",
        "Synthetic reviewed performance label",
    )
    .await
    .unwrap();
    let before:Value=sqlx::query_scalar("SELECT jsonb_build_object('item',(SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1),'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM inventory_item_catalog_revisions r WHERE item_id=$1),'batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM stock_batches b WHERE item_id=$1),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM stock_movements m WHERE item_id=$1),'receipt',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE event_type='performance.seed.provisioned'))").bind(item).fetch_one(&p).await.unwrap();
    provision::provision_performance_seed(&p, &b, config)
        .await
        .unwrap();
    let changed = provision::PerformanceSeedConfig {
        inventory_item_count: 3,
        ..config
    };
    assert_eq!(
        provision::provision_performance_seed(&p, &b, changed)
            .await
            .unwrap_err()
            .to_string(),
        "performance_seed_configuration_changed_use_fresh_database"
    );
    let after:Value=sqlx::query_scalar("SELECT jsonb_build_object('item',(SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1),'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM inventory_item_catalog_revisions r WHERE item_id=$1),'batches',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM stock_batches b WHERE item_id=$1),'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM stock_movements m WHERE item_id=$1),'receipt',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE event_type='performance.seed.provisioned'))").bind(item).fetch_one(&p).await.unwrap();
    assert_eq!(after, before);
}

fn before031() -> sqlx::migrate::Migrator {
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610310031)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    }
}
#[tokio::test]
async fn category25_baseline_rerun_preserves_exact_retired_legacy_metadata_and_existing_defaults() {
    let d = hms_db::test_support::TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    before031().run(&p).await.unwrap();
    let b = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision::provision_baseline(&p, &b).await.unwrap();
    let id = Uuid::from_u128(provision::DEFAULT_INVENTORY_CATEGORY_MED_ID);
    // This observation is genuinely constructed under030, before031 makes identity permanent.
    sqlx::query("UPDATE inventory_categories SET code='  retained code  ',name='  retained configured name  ',is_active=false WHERE id=$1").bind(id).execute(&p).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    let before: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM inventory_categories c WHERE id=$1")
            .bind(id)
            .fetch_one(&p)
            .await
            .unwrap();
    provision::provision_baseline(&p, &b).await.unwrap();
    let after: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM inventory_categories c WHERE id=$1")
            .bind(id)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(after, before);
    assert!(after["created_by_user_id"].is_null() && after["catalog_changed_at"].is_null());
}
#[tokio::test]
async fn category25_baseline_conflicting_code_is_typed_operator_review_and_never_rekeys() {
    let (d, p, b) = fixture().await;
    let _keep = d;
    let id = Uuid::from_u128(provision::DEFAULT_INVENTORY_CATEGORY_MED_ID);
    let foreign_id = Uuid::new_v4();
    // Existing items first move to a separately retained category under actual pre030 schema.
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name)VALUES($1,$2,'S25_RETAINED','Synthetic retained')").bind(foreign_id).bind(b.facility_id).execute(&p).await.unwrap();
    sqlx::query("UPDATE inventory_items SET category_id=$1 WHERE category_id=$2")
        .bind(foreign_id)
        .bind(id)
        .execute(&p)
        .await
        .unwrap();
    sqlx::query("UPDATE inventory_categories SET id=$1 WHERE id=$2")
        .bind(Uuid::new_v4())
        .bind(id)
        .execute(&p)
        .await
        .unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    let before: Value =
        sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM inventory_categories c")
            .fetch_one(&p)
            .await
            .unwrap();
    let e = provision::provision_baseline(&p, &b).await.unwrap_err();
    assert_eq!(
        e.downcast_ref::<provision::InventoryCategoryProvisioningError>(),
        Some(&provision::InventoryCategoryProvisioningError::OperatorReview)
    );
    let after: Value =
        sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM inventory_categories c")
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(after, before);
}

#[tokio::test]
async fn category25_missing_default_item_cannot_publish_under_retired_canonical_category() {
    let (_d, p, b) = fixture().await;
    let category = Uuid::from_u128(provision::DEFAULT_INVENTORY_CATEGORY_MED_ID);
    let missing = Uuid::from_u128(provision::DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID);
    // The missing default and retired state are genuine pre030 import facts.
    sqlx::query("DELETE FROM inventory_items WHERE id=$1")
        .bind(missing)
        .execute(&p)
        .await
        .unwrap();
    sqlx::query("UPDATE inventory_categories SET is_active=false WHERE id=$1")
        .bind(category)
        .execute(&p)
        .await
        .unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    let before: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM inventory_categories c WHERE id=$1")
            .bind(category)
            .fetch_one(&p)
            .await
            .unwrap();
    let error = provision::provision_baseline(&p, &b).await.unwrap_err();
    assert!(error.chain().any(|e| e
        .downcast_ref::<sqlx::Error>()
        .and_then(|e| e.as_database_error())
        .is_some_and(|e| e.message() == "inventory_item_category_unavailable")));
    let after: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM inventory_categories c WHERE id=$1")
            .bind(category)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(after, before);
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_items WHERE id=$1)")
            .bind(missing)
            .fetch_one(&p)
            .await
            .unwrap();
    assert!(!exists);
}

#[tokio::test]
async fn category25_foreign_canonical_id_requires_typed_operator_review() {
    let (_d, p, b) = fixture().await;
    let category = Uuid::from_u128(provision::DEFAULT_INVENTORY_CATEGORY_MED_ID);
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'S25_CANONICAL_OWNER','Synthetic other facility','hospital')").bind(foreign).execute(&p).await.unwrap();
    // Existing foreign ownership is imported under pre030; no current guard bypass.
    sqlx::query("UPDATE inventory_categories SET facility_id=$1 WHERE id=$2")
        .bind(foreign)
        .bind(category)
        .execute(&p)
        .await
        .unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    let before: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM inventory_categories c WHERE id=$1")
            .bind(category)
            .fetch_one(&p)
            .await
            .unwrap();
    let error = provision::provision_baseline(&p, &b).await.unwrap_err();
    assert_eq!(
        error.downcast_ref::<provision::InventoryCategoryProvisioningError>(),
        Some(&provision::InventoryCategoryProvisioningError::OperatorReview)
    );
    let after: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM inventory_categories c WHERE id=$1")
            .bind(category)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(after, before);
}

#[tokio::test]
async fn category25_pending_foreign_canonical_insert_is_definite_busy_without_uniqueness_wait() {
    let d = hms_db::test_support::TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    sqlx::query("INSERT INTO deployment_profiles(code,label)VALUES('hospital','Synthetic hospital profile')").execute(&p).await.unwrap();
    let foreign = Uuid::new_v4();
    let canonical = Uuid::from_u128(provision::DEFAULT_INVENTORY_CATEGORY_MED_ID);
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'S25_PENDING_FOREIGN','Synthetic foreign facility','hospital')").bind(foreign).execute(&p).await.unwrap();
    let mut pending = p.begin().await.unwrap();
    // Returning from this INSERT proves the intrinsic global ID gate is held.
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name)VALUES($1,$2,'S25_FOREIGN_PENDING','Synthetic pending foreign category')").bind(canonical).bind(foreign).execute(&mut *pending).await.unwrap();
    let b = BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    let error = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        provision::provision_baseline(&p, &b),
    )
    .await
    .expect("canonical identity try gate never waits for a pending foreign unique-key owner")
    .unwrap_err();
    assert_eq!(
        error.downcast_ref::<provision::InventoryCategoryProvisioningError>(),
        Some(&provision::InventoryCategoryProvisioningError::Busy)
    );
    pending.rollback().await.unwrap();
    provision::provision_baseline(&p, &b).await.unwrap();
    let owner: Uuid =
        sqlx::query_scalar("SELECT facility_id FROM inventory_categories WHERE id=$1")
            .bind(canonical)
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(owner, b.facility_id);
}
