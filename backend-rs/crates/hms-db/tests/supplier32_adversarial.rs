//! Additional supplier proofs use honest historical schema and current repositories.
#[path = "support_item_governance/mod.rs"]
mod governed;
use hms_db::{inventory::suppliers, provision, test_support::TestDb, PgPool};
use hms_domain::{deployment::DeploymentProfile, inventory_suppliers::*};
use serde_json::Value;
use uuid::Uuid;

fn before032() -> sqlx::migrate::Migrator {
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202611020032)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    }
}
async fn historical() -> TestDb {
    TestDb::with_profile_and_migrator(DeploymentProfile::Hospital, &before032())
        .await
        .unwrap()
}
async fn actors(
    pool: &PgPool,
    facility: Uuid,
) -> (
    suppliers::InventorySupplierActor,
    suppliers::InventorySupplierReadActor,
) {
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code) VALUES($1,'inventory.view') ON CONFLICT DO NOTHING").bind(Uuid::from_u128(provision::LIMITED_USER_ID)).execute(pool).await.unwrap();
    let writer = governed::actor(pool, facility).await;
    let reader = suppliers::InventorySupplierReadActor {
        facility_id: facility,
        user_id: writer.user_id,
        request_id: writer.request_id.clone(),
        authorization: writer.authorization.clone(),
    };
    (writer, reader)
}
fn supplier_error<T>(result: anyhow::Result<T>, expected: suppliers::InventorySupplierError) {
    match result {
        Err(error) => assert_eq!(
            error.downcast_ref::<suppliers::InventorySupplierError>(),
            Some(&expected)
        ),
        Ok(_) => panic!("supplier operation unexpectedly succeeded"),
    }
}
async fn supplier_snapshot(pool: &PgPool) -> Value {
    sqlx::query_scalar("SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM inventory_suppliers s").fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn supplier32_honest_foreign_inactive_references_block_lifecycle_and_survive_item_correction()
{
    let database = historical().await;
    let pool = database.pool();
    let facility = database.facility_id();
    let foreign = Uuid::new_v4();
    let foreign_category = Uuid::new_v4();
    let local_active = Uuid::new_v4();
    let local_retired = Uuid::new_v4();
    let foreign_retired = Uuid::new_v4();
    let local_item = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'S32_FOREIGN_REFS','Synthetic foreign facility','hospital')").bind(foreign).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO inventory_categories(id,facility_id,code,name) VALUES($1,$2,'S32_FOREIGN_CATEGORY','Synthetic foreign category')").bind(foreign_category).bind(foreign).execute(pool).await.unwrap();
    for (id, owner, code, active) in [
        (local_active, facility, "S32_LOCAL_ACTIVE", true),
        (local_retired, facility, "S32_LOCAL_RETIRED", false),
        (foreign_retired, foreign, "S32_FOREIGN_RETIRED", false),
    ] {
        sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name,is_active) VALUES($1,$2,$3,'Synthetic retained supplier',$4)").bind(id).bind(owner).bind(code).bind(active).execute(pool).await.unwrap();
    }
    // These unavailable/foreign links are imported under031, with every old guard intact.
    for (id, owner, category, supplier, code, active) in [
        (
            local_item,
            facility,
            Uuid::from_u128(provision::DEFAULT_INVENTORY_CATEGORY_MED_ID),
            foreign_retired,
            "S32_LOCAL_FOREIGN_SOURCE",
            true,
        ),
        (
            Uuid::new_v4(),
            foreign,
            foreign_category,
            local_active,
            "S32_FOREIGN_ACTIVE_SOURCE",
            false,
        ),
        (
            Uuid::new_v4(),
            foreign,
            foreign_category,
            local_retired,
            "S32_FOREIGN_RETIRED_SOURCE",
            false,
        ),
    ] {
        sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,primary_supplier_id,is_active) VALUES($1,$2,$3,$4,'Synthetic retained item','supply','piece',$5,$6)").bind(id).bind(owner).bind(category).bind(code).bind(supplier).bind(active).execute(pool).await.unwrap();
    }
    let pointers: Value = sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_array(id,primary_supplier_id,is_active) ORDER BY id) FROM inventory_items").fetch_one(pool).await.unwrap();
    hms_db::migrate::run(pool).await.unwrap();
    let after: Value = sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_array(id,primary_supplier_id,is_active) ORDER BY id) FROM inventory_items").fetch_one(pool).await.unwrap();
    assert!(
        pointers == after,
        "migration preserves all retained item pointers and inactive observations"
    );
    let (writer, reader) = actors(pool, facility).await;
    for (id, retire) in [(local_active, true), (local_retired, false)] {
        let detail = suppliers::detail(pool, reader.clone(), id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            detail.eligibility.lifecycle_blocked_by,
            Some(InventorySupplierEligibilityBlocker::ItemReference)
        );
        let input = if retire {
            InventorySupplierReviewedInput::Retire {
                client_request_id: Uuid::new_v4(),
                supplier_id: id,
                expected_version: detail.supplier.version,
            }
        } else {
            InventorySupplierReviewedInput::Reactivate {
                client_request_id: Uuid::new_v4(),
                supplier_id: id,
                expected_version: detail.supplier.version,
            }
        };
        supplier_error(
            suppliers::command(pool, writer.clone(), input).await,
            suppliers::InventorySupplierError::ItemReference,
        );
    }
    governed::correct(
        pool,
        facility,
        local_item,
        "piece",
        "S32_LOCAL_FOREIGN_SOURCE",
        "Reviewed retained item",
    )
    .await
    .unwrap();
    let retained: Option<Uuid> =
        sqlx::query_scalar("SELECT primary_supplier_id FROM inventory_items WHERE id=$1")
            .bind(local_item)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(
        retained == Some(foreign_retired),
        "unrelated governed item correction retains its unavailable original supplier pointer"
    );
    let foreign_detail = suppliers::detail(pool, reader, foreign_retired)
        .await
        .unwrap();
    assert!(
        foreign_detail.is_none(),
        "exact supplier read remains facility scoped"
    );
    let commands: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_supplier_commands")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(commands, 0);
}

async fn inventory_matches(
    pool: &PgPool,
    facility: Uuid,
    demographics: bool,
) -> Vec<hms_domain::search::OmniSearchItem> {
    use hms_domain::{
        auth::PatientDataVisibility,
        deployment::{FeatureKey, PermissionCode},
        search::SearchResourceType,
    };
    let mut permissions = vec![PermissionCode::InventoryView];
    if demographics {
        permissions.push(PermissionCode::PatientDemographicsView);
    }
    hms_db::search::omni_search(
        pool,
        hms_db::search::OmniSearchFilters {
            facility_id: facility,
            user_id: Uuid::from_u128(provision::LIMITED_USER_ID),
            query: Some("S32_OLD_PRODUCER".into()),
            types: vec![SearchResourceType::Inventory],
            limit_per_group: 25,
            permission_codes: permissions,
            feature_keys: vec![FeatureKey::Inventory],
            patient_visibility: if demographics {
                vec![PatientDataVisibility::Demographics]
            } else {
                vec![]
            },
        },
    )
    .await
    .unwrap()
    .groups
    .inventory
}

#[tokio::test]
async fn supplier32_mandatory_old_producer_repair_is_scoped_and_demographics_guarded_without_rebuild(
) {
    let database = historical().await;
    let pool = database.pool();
    let facility = database.facility_id();
    let supplier = Uuid::new_v4();
    let document = Uuid::new_v4();
    let orphan = Uuid::new_v4();
    let unrelated = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name,contact_name,phone,email) VALUES($1,$2,'S32_OLD_PRODUCER','Synthetic old supplier','Synthetic contact','0000000000','synthetic@example.test')").bind(supplier).bind(facility).execute(pool).await.unwrap();
    // This is the actual031 inventory supplier producer shape, with an extra retained metadata fact.
    sqlx::query("INSERT INTO search_documents(id,facility_id,resource_type,resource_id,title,subtitle,route_path,status_label,feature_key,permission_code,search_text,rank_boost,source_updated_at,occurred_at,metadata,is_active) SELECT $1,s.facility_id,'inventory',s.id,s.name,'Supplier '||s.code,'/inventory/items?supplier='||s.id::text,CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END,'inventory','inventory.view',concat_ws(' ',s.code,s.name,s.contact_name,s.phone,s.email),40,s.updated_at,s.created_at,jsonb_build_object('source_table','inventory_suppliers','code',s.code,'retained_extra','retained'),s.is_active FROM inventory_suppliers s WHERE s.id=$2").bind(document).bind(supplier).execute(pool).await.unwrap();
    for (id, source, code) in [
        (orphan, "inventory_suppliers", "S32_ORPHAN"),
        (unrelated, "storage_locations", "S32_UNRELATED"),
    ] {
        sqlx::query("INSERT INTO search_documents(id,facility_id,resource_type,resource_id,title,route_path,feature_key,permission_code,search_text,metadata) VALUES($1,$2,'inventory',$3,'Synthetic unchanged projection','/inventory/items','inventory','inventory.view',$4,jsonb_build_object('source_table',$5::text))").bind(id).bind(facility).bind(Uuid::new_v4()).bind(code).bind(source).execute(pool).await.unwrap();
    }
    let unrelated_before: Value = sqlx::query_scalar(
        "SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM search_documents d WHERE id=ANY($1)",
    )
    .bind(vec![orphan, unrelated])
    .fetch_one(pool)
    .await
    .unwrap();
    let supplier_before: Value =
        sqlx::query_scalar("SELECT to_jsonb(s) FROM inventory_suppliers s WHERE id=$1")
            .bind(supplier)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(
        inventory_matches(pool, facility, false)
            .await
            .iter()
            .any(|item| item.id == supplier),
        "actual historical producer admits supplier without demographics"
    );
    // No baseline, optional rebuild or producer function is called across this boundary.
    hms_db::migrate::run(pool).await.unwrap();
    assert!(
        !inventory_matches(pool, facility, false)
            .await
            .iter()
            .any(|item| item.id == supplier),
        "mandatory repair closes the old admission path"
    );
    assert!(
        inventory_matches(pool, facility, true)
            .await
            .iter()
            .any(|item| item.id == supplier),
        "current permitted reader retains the actual supplier result"
    );
    let repaired: (Uuid,bool,String,Value) = sqlx::query_as("SELECT id,requires_patient_demographics,route_path,metadata FROM search_documents WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2").bind(facility).bind(supplier).fetch_one(pool).await.unwrap();
    assert!(repaired.0 == document && repaired.1 && repaired.2 == format!("/inventory/suppliers/{supplier}") && repaired.3["retained_extra"] == "retained", "repair preserves document identity/extra metadata and publishes the exact protected supplier route");
    let unrelated_after: Value = sqlx::query_scalar(
        "SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM search_documents d WHERE id=ANY($1)",
    )
    .bind(vec![orphan, unrelated])
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(
        unrelated_before == unrelated_after,
        "mandatory repair leaves orphan and unrelated families byte-exact"
    );
    let supplier_after: Value = sqlx::query_scalar("SELECT to_jsonb(s)-ARRAY['address','version','catalog_changed_at','created_by_user_id','updated_by_user_id'] FROM inventory_suppliers s WHERE id=$1").bind(supplier).fetch_one(pool).await.unwrap();
    assert!(
        supplier_before == supplier_after,
        "repair preserves the complete historical operational supplier observation"
    );
}

#[tokio::test]
async fn supplier32_foreign_canonical_identity_requires_operator_review_without_rewrite() {
    let database = historical().await;
    let pool = database.pool();
    let facility = database.facility_id();
    let foreign = Uuid::new_v4();
    let canonical = Uuid::from_u128(provision::DEFAULT_SUPPLIER_ACME_ID);
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'S32_FOREIGN_CANONICAL','Synthetic foreign facility','hospital')").bind(foreign).execute(pool).await.unwrap();
    sqlx::query("UPDATE inventory_suppliers SET facility_id=$1,is_active=false WHERE id=$2")
        .bind(foreign)
        .bind(canonical)
        .execute(pool)
        .await
        .unwrap();
    hms_db::migrate::run(pool).await.unwrap();
    let before = supplier_snapshot(pool).await;
    let failure = provision::provision_baseline(
        pool,
        &provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .unwrap_err();
    assert_eq!(
        failure.downcast_ref::<provision::InventorySupplierProvisioningError>(),
        Some(&provision::InventorySupplierProvisioningError::OperatorReview)
    );
    assert!(
        before == supplier_snapshot(pool).await,
        "foreign canonical owner and all configured supplier observations remain unchanged"
    );
    let owner: Uuid = sqlx::query_scalar("SELECT facility_id FROM inventory_suppliers WHERE id=$1")
        .bind(canonical)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(owner == foreign && owner != facility);
}

#[tokio::test]
async fn supplier32_missing_canonical_id_with_shipped_code_owner_requires_operator_review() {
    let database = historical().await;
    let pool = database.pool();
    let facility = database.facility_id();
    let canonical = Uuid::from_u128(provision::DEFAULT_SUPPLIER_ACME_ID);
    let configured = Uuid::new_v4();
    sqlx::query("UPDATE inventory_items SET primary_supplier_id=NULL WHERE primary_supplier_id=$1")
        .bind(canonical)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM inventory_suppliers WHERE id=$1")
        .bind(canonical)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name,contact_name,email,is_active) VALUES($1,$2,'ACME','Synthetic configured owner','Retained contact','retained malformed email',false)").bind(configured).bind(facility).execute(pool).await.unwrap();
    hms_db::migrate::run(pool).await.unwrap();
    let before = supplier_snapshot(pool).await;
    let failure = provision::provision_baseline(
        pool,
        &provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .unwrap_err();
    assert_eq!(
        failure.downcast_ref::<provision::InventorySupplierProvisioningError>(),
        Some(&provision::InventorySupplierProvisioningError::OperatorReview)
    );
    assert!(
        before == supplier_snapshot(pool).await,
        "configured code owner is neither adopted nor overwritten"
    );
    let absent: bool =
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM inventory_suppliers WHERE id=$1)")
            .bind(canonical)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(absent);
}

#[tokio::test]
async fn supplier32_pending_foreign_canonical_insert_is_definite_busy_before_unique_wait() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    sqlx::query("INSERT INTO deployment_profiles(code,label) VALUES('hospital','Synthetic hospital profile')").execute(&pool).await.unwrap();
    let foreign = Uuid::new_v4();
    let canonical = Uuid::from_u128(provision::DEFAULT_SUPPLIER_ACME_ID);
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile)VALUES($1,'S32_PENDING_CANONICAL','Synthetic foreign facility','hospital')").bind(foreign).execute(&pool).await.unwrap();
    let mut pending = pool.begin().await.unwrap();
    // Successful INSERT proves the current intrinsic global supplier UUID gate is held.
    sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name) VALUES($1,$2,'S32_FOREIGN_PENDING','Synthetic pending supplier')").bind(canonical).bind(foreign).execute(&mut *pending).await.unwrap();
    let baseline = provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital);
    let failure = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        provision::provision_baseline(&pool, &baseline),
    )
    .await
    .expect("global supplier identity try gate must not wait for pending foreign uniqueness")
    .unwrap_err();
    assert_eq!(
        failure.downcast_ref::<provision::InventorySupplierProvisioningError>(),
        Some(&provision::InventorySupplierProvisioningError::Busy)
    );
    pending.rollback().await.unwrap();
    provision::provision_baseline(&pool, &baseline)
        .await
        .unwrap();
    let owner: Uuid = sqlx::query_scalar("SELECT facility_id FROM inventory_suppliers WHERE id=$1")
        .bind(canonical)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(owner == baseline.facility_id);
}
