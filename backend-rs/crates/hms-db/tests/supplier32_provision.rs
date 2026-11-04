//! Supplier-row preservation is distinct from the accepted NULL-only item binding.
#[path = "support_item_governance/mod.rs"]
mod governed;
use hms_db::{inventory::suppliers, provision, test_support::TestDatabase};
use hms_domain::{deployment::DeploymentProfile, inventory_suppliers::*};
use serde_json::Value;
use uuid::Uuid;

fn before032() -> sqlx::migrate::Migrator {
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < 202611020032)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    }
}
async fn snapshot(pool: &hms_db::PgPool, facility: Uuid, item: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('suppliers',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM inventory_suppliers s WHERE facility_id=$1),'item',(SELECT to_jsonb(i) FROM inventory_items i WHERE id=$2),'documents',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM search_documents d WHERE facility_id=$1 AND metadata->>'source_table'='inventory_suppliers'))").bind(facility).bind(item).fetch_one(pool).await.unwrap()
}
#[tokio::test]
async fn supplier32_baseline_preserves_configured_retired_rows_former_codes_contacts_address_and_null_item(
) {
    let database = TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    before032().run(&pool).await.unwrap();
    let baseline = provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let id = Uuid::from_u128(provision::DEFAULT_SUPPLIER_ACME_ID);
    let item = Uuid::from_u128(provision::DEFAULT_INVENTORY_ITEM_PARACETAMOL_ID);
    // These exact unusual observations are honestly constructed under031,
    // before032 introduces permanent supplier identity/version guards.
    sqlx::query("UPDATE inventory_items SET primary_supplier_id=NULL WHERE id=$1")
        .bind(item)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE inventory_suppliers SET code='RETAINED_CANONICAL',name=repeat('L',130),contact_name='  retained contact  ',phone=repeat('1',35),email='retained malformed email',is_active=false,updated_at=TIMESTAMPTZ '2000-01-01' WHERE id=$1").bind(id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name)VALUES($1,$2,'ACME','Synthetic former-code owner')").bind(Uuid::new_v4()).bind(baseline.facility_id).execute(&pool).await.unwrap();
    let old: Value =
        sqlx::query_scalar("SELECT to_jsonb(s) FROM inventory_suppliers s WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let retained:Value=sqlx::query_scalar("SELECT to_jsonb(s)-ARRAY['address','version','catalog_changed_at','created_by_user_id','updated_by_user_id'] FROM inventory_suppliers s WHERE id=$1").bind(id).fetch_one(&pool).await.unwrap();
    assert!(
        old == retained,
        "migration preserves actual old supplier observations"
    );
    let user = Uuid::from_u128(provision::LIMITED_USER_ID);
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code)VALUES($1,'inventory.view') ON CONFLICT DO NOTHING").bind(user).execute(&pool).await.unwrap();
    let writer = governed::actor(&pool, baseline.facility_id).await;
    let reader = suppliers::InventorySupplierReadActor {
        facility_id: baseline.facility_id,
        user_id: writer.user_id,
        request_id: writer.request_id.clone(),
        authorization: writer.authorization.clone(),
    };
    let current = suppliers::detail(&pool, reader, id)
        .await
        .unwrap()
        .unwrap()
        .supplier;
    assert_eq!(current.version, 1);
    assert!(current.catalog_changed_at.is_none());
    assert!(current.created_by_user_id.is_none());
    assert!(current.updated_by_user_id.is_none());
    let changed = suppliers::command(
        &pool,
        writer,
        InventorySupplierReviewedInput::Correct {
            client_request_id: Uuid::new_v4(),
            supplier_id: id,
            expected_version: current.version,
            name: current.name.clone(),
            contact_name: current.contact_name.clone(),
            phone: current.phone.clone(),
            email: current.email.clone(),
            address: Some("Synthetic retained address\nSecond line".into()),
            reason: "Synthetic address review".into(),
        },
    )
    .await
    .unwrap();
    assert!(
        changed.supplier.name == current.name
            && changed.supplier.phone == current.phone
            && changed.supplier.email == current.email,
        "unchanged legacy values survive an independent address correction"
    );
    assert!(!changed.supplier.is_active);
    assert!(changed.supplier.created_by_user_id.is_none());
    let before = snapshot(&pool, baseline.facility_id, item).await;
    for _ in 0..2 {
        provision::provision_baseline(&pool, &baseline)
            .await
            .unwrap();
        assert!(before==snapshot(&pool,baseline.facility_id,item).await,"baseline preserves exact configured supplier rows, search times and optional unbound item");
    }
    let supplier: Option<Uuid> =
        sqlx::query_scalar("SELECT primary_supplier_id FROM inventory_items WHERE id=$1")
            .bind(item)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        supplier.is_none(),
        "retired canonical source is not replaced by the active former-code owner"
    );
}

async fn performance_graph(pool: &hms_db::PgPool, facility: Uuid) -> Value {
    // Hash inside PostgreSQL; no synthetic patient bodies enter evidence/logs.
    sqlx::query_scalar("SELECT jsonb_build_object('patients',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'null'),'UTF8')),'hex') FROM patients p WHERE facility_id=$1),'items',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(i) ORDER BY id)::text,'null'),'UTF8')),'hex') FROM inventory_items i WHERE facility_id=$1),'batches',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id)::text,'null'),'UTF8')),'hex') FROM stock_batches b WHERE facility_id=$1),'movements',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id)::text,'null'),'UTF8')),'hex') FROM stock_movements m WHERE facility_id=$1),'suppliers',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'null'),'UTF8')),'hex') FROM inventory_suppliers s WHERE facility_id=$1),'audits',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'null'),'UTF8')),'hex') FROM audit_events a WHERE facility_id=$1))").bind(facility).fetch_one(pool).await.unwrap()
}
#[tokio::test]
async fn supplier32_completed_performance_receipt_precedes_current_supplier_revalidation() {
    let database = TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let baseline = provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let config = provision::PerformanceSeedConfig {
        patient_count: 2,
        chronicled_patient_count: 0,
        notes_per_chronicle_patient: 0,
        lab_order_count: 0,
        inventory_item_count: 2,
        admission_count: 0,
        invoice_count: 0,
    };
    provision::provision_performance_seed(&pool, &baseline, config)
        .await
        .unwrap();
    let source:Uuid=sqlx::query_scalar("SELECT primary_supplier_id FROM inventory_items WHERE facility_id=$1 AND code='PERF-MED-000001'").bind(baseline.facility_id).fetch_one(&pool).await.unwrap();
    let user = Uuid::from_u128(provision::LIMITED_USER_ID);
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code)VALUES($1,'inventory.view') ON CONFLICT DO NOTHING").bind(user).execute(&pool).await.unwrap();
    let writer = governed::actor(&pool, baseline.facility_id).await;
    let reader = suppliers::InventorySupplierReadActor {
        facility_id: baseline.facility_id,
        user_id: writer.user_id,
        request_id: writer.request_id.clone(),
        authorization: writer.authorization.clone(),
    };
    let current = suppliers::detail(&pool, reader, source)
        .await
        .unwrap()
        .unwrap()
        .supplier;
    suppliers::command(
        &pool,
        writer,
        InventorySupplierReviewedInput::Correct {
            client_request_id: Uuid::new_v4(),
            supplier_id: source,
            expected_version: current.version,
            name: "Configured performance supplier".into(),
            contact_name: current.contact_name,
            phone: current.phone,
            email: current.email,
            address: Some("Synthetic configured address".into()),
            reason: "Synthetic retained supplier review".into(),
        },
    )
    .await
    .unwrap();
    let before = performance_graph(&pool, baseline.facility_id).await;
    let mut held = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM inventory_suppliers WHERE id=$1 FOR UPDATE")
        .bind(source)
        .execute(&mut *held)
        .await
        .unwrap();
    // Revalidating the selected supplier here would return busy. The completed
    // original receipt must return first, preserving all later governed state.
    provision::provision_performance_seed(&pool, &baseline, config)
        .await
        .unwrap();
    held.rollback().await.unwrap();
    assert!(
        before == performance_graph(&pool, baseline.facility_id).await,
        "completed performance replay preserves the exact later graph and original receipt"
    );
    let receipts:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE facility_id=$1 AND resource_type='performance_seed' AND event_type='performance.seed.provisioned'").bind(baseline.facility_id).fetch_one(&pool).await.unwrap();
    assert_eq!(receipts, 1);
}
