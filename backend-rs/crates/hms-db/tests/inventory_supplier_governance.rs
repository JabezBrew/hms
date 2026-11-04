//! Synthetic supplier checks use the same proof-bearing repositories as production.
#[path = "support_item_governance/mod.rs"]
mod governed;
use hms_db::{inventory::suppliers, test_support::TestDb, PgPool};
use hms_domain::inventory_suppliers::*;
use uuid::Uuid;

async fn actors(
    pool: &PgPool,
    facility: Uuid,
) -> (
    suppliers::InventorySupplierActor,
    suppliers::InventorySupplierReadActor,
) {
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code)VALUES($1,'inventory.view') ON CONFLICT DO NOTHING").bind(user).execute(pool).await.unwrap();
    let writer = governed::actor(pool, facility).await;
    let mut authorization = writer.authorization.clone();
    authorization.ordinary_reauth_required = false;
    authorization.original_password_verified_at = None;
    authorization.valid_until=sqlx::query_scalar("SELECT LEAST(expires_at,idle_expires_at,absolute_expires_at) FROM refresh_sessions WHERE session_id=$1").bind(authorization.session_id).fetch_one(pool).await.unwrap();
    let reader = suppliers::InventorySupplierReadActor {
        facility_id: facility,
        user_id: writer.user_id,
        request_id: writer.request_id.clone(),
        authorization,
    };
    (writer, reader)
}
fn create_input(code: &str) -> InventorySupplierReviewedInput {
    InventorySupplierReviewedInput::Create {
        client_request_id: Uuid::new_v4(),
        code: code.into(),
        name: "Synthetic supplier".into(),
        contact_name: Some(String::new()),
        phone: None,
        email: Some("synthetic@example.test".into()),
        address: Some("Synthetic address\nSecond line".into()),
    }
}
fn correction(supplier: &GovernedInventorySupplier, name: &str) -> InventorySupplierReviewedInput {
    InventorySupplierReviewedInput::Correct {
        client_request_id: Uuid::new_v4(),
        supplier_id: supplier.id,
        expected_version: supplier.version,
        name: name.into(),
        contact_name: supplier.contact_name.clone(),
        phone: supplier.phone.clone(),
        email: supplier.email.clone(),
        address: supplier.address.clone(),
        reason: "Synthetic exact metadata review".into(),
    }
}
fn error<T>(result: anyhow::Result<T>, expected: suppliers::InventorySupplierError) {
    match result {
        Err(error) => assert_eq!(
            error.downcast_ref::<suppliers::InventorySupplierError>(),
            Some(&expected)
        ),
        Ok(_) => panic!("supplier command unexpectedly succeeded"),
    }
}

#[tokio::test]
async fn supplier32_original_receipts_noops_cas_and_scalar_private_boundaries() {
    let database = TestDb::hospital().await.unwrap();
    let pool = database.pool();
    let facility = database.facility_id();
    let (writer, reader) = actors(pool, facility).await;
    let created = suppliers::command(pool, writer.clone(), create_input("S32_ORIGINAL"))
        .await
        .unwrap();
    assert_eq!(created.supplier.version, 1);
    assert_eq!(created.supplier.contact_name, Some(String::new()));
    assert!(created.before.is_none());
    let original_input = correction(&created.supplier, "Reviewed supplier");
    let first = suppliers::command(pool, writer.clone(), original_input.clone())
        .await
        .unwrap();
    assert!(first.changed);
    assert_eq!(first.supplier.version, 2);
    let search_before:(Uuid,chrono::DateTime<chrono::Utc>)=sqlx::query_as("SELECT id,indexed_at FROM search_documents WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2").bind(facility).bind(first.supplier.id).fetch_one(pool).await.unwrap();
    let noop = suppliers::command(
        pool,
        writer.clone(),
        correction(&first.supplier, &first.supplier.name),
    )
    .await
    .unwrap();
    assert!(!noop.changed);
    assert_eq!(noop.supplier.version, 2);
    assert_eq!(noop.supplier.updated_at, first.supplier.updated_at);
    assert_eq!(
        noop.supplier.catalog_changed_at,
        first.supplier.catalog_changed_at
    );
    let search_after:(Uuid,chrono::DateTime<chrono::Utc>)=sqlx::query_as("SELECT id,indexed_at FROM search_documents WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2").bind(facility).bind(first.supplier.id).fetch_one(pool).await.unwrap();
    assert_eq!(search_before, search_after);
    let later = suppliers::command(
        pool,
        writer.clone(),
        correction(&noop.supplier, "Later supplier"),
    )
    .await
    .unwrap();
    assert_eq!(later.supplier.version, 3);
    let replay = suppliers::command(pool, writer.clone(), original_input)
        .await
        .unwrap();
    let recovered = suppliers::receipt(pool, writer.clone(), first.client_request_id)
        .await
        .unwrap();
    assert!(
        serde_json::to_value(replay).unwrap() == serde_json::to_value(&first).unwrap(),
        "original replay remains exact"
    );
    assert!(
        serde_json::to_value(recovered).unwrap() == serde_json::to_value(&first).unwrap(),
        "receipt does not join later state"
    );
    error(
        suppliers::command(
            pool,
            writer.clone(),
            correction(&created.supplier, "Stale supplier"),
        )
        .await,
        suppliers::InventorySupplierError::VersionConflict,
    );
    let history = suppliers::history(pool, reader.clone(), created.supplier.id, None, 101)
        .await
        .unwrap();
    assert_eq!(history.len(), 4);
    for row in history {
        let value = serde_json::to_value(row).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 11);
        for hidden in [
            "address",
            "email",
            "phone",
            "contact_name",
            "reason",
            "before",
            "supplier",
            "recorded_by_user_id",
        ] {
            assert!(
                value.get(hidden).is_none(),
                "scalar history privacy boundary"
            );
        }
    }
    let rows = suppliers::list(
        pool,
        reader.clone(),
        None,
        101,
        InventorySupplierAdministrationQuery {
            search: Some("S32_ORIGINAL".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        serde_json::to_value(&rows[0])
            .unwrap()
            .as_object()
            .unwrap()
            .len(),
        7
    );
    let current = suppliers::detail(pool, reader, created.supplier.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(current.supplier)
            .unwrap()
            .as_object()
            .unwrap()
            .len(),
        14
    );
    let counts:(i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM inventory_supplier_commands WHERE supplier_id=$1),(SELECT count(*) FROM audit_events WHERE resource_type='inventory_supplier' AND resource_id=$1)").bind(created.supplier.id).fetch_one(pool).await.unwrap();
    assert_eq!(counts, (4, 4));
}

#[tokio::test]
async fn supplier32_unused_lifecycle_and_all_retained_item_reference_backstop() {
    let database = TestDb::hospital().await.unwrap();
    let pool = database.pool();
    let facility = database.facility_id();
    let (writer, reader) = actors(pool, facility).await;
    let created = suppliers::command(pool, writer.clone(), create_input("S32_LIFECYCLE"))
        .await
        .unwrap()
        .supplier;
    let retired = suppliers::command(
        pool,
        writer.clone(),
        InventorySupplierReviewedInput::Retire {
            client_request_id: Uuid::new_v4(),
            supplier_id: created.id,
            expected_version: created.version,
        },
    )
    .await
    .unwrap()
    .supplier;
    assert!(!retired.is_active);
    let rejected=sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,primary_supplier_id)VALUES($1,$2,$3,'S32_INACTIVE_SOURCE','Synthetic retained item','supply','piece',$4)").bind(Uuid::new_v4()).bind(facility).bind(Uuid::from_u128(hms_db::provision::DEFAULT_INVENTORY_CATEGORY_MED_ID)).bind(retired.id).execute(pool).await.unwrap_err();
    assert_eq!(
        rejected.as_database_error().unwrap().message(),
        "inventory_supplier_source_unavailable"
    );
    let active = suppliers::command(
        pool,
        writer.clone(),
        InventorySupplierReviewedInput::Reactivate {
            client_request_id: Uuid::new_v4(),
            supplier_id: created.id,
            expected_version: retired.version,
        },
    )
    .await
    .unwrap()
    .supplier;
    let item = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,primary_supplier_id,is_active)VALUES($1,$2,$3,'S32_INACTIVE_ITEM','Synthetic retained item','supply','piece',$4,false)").bind(item).bind(facility).bind(Uuid::from_u128(hms_db::provision::DEFAULT_INVENTORY_CATEGORY_MED_ID)).bind(active.id).execute(pool).await.unwrap();
    let before: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1")
            .bind(item)
            .fetch_one(pool)
            .await
            .unwrap();
    let changed = suppliers::command(
        pool,
        writer.clone(),
        correction(&active, "Referenced supplier corrected"),
    )
    .await
    .unwrap()
    .supplier;
    for input in [
        InventorySupplierReviewedInput::Retire {
            client_request_id: Uuid::new_v4(),
            supplier_id: changed.id,
            expected_version: changed.version,
        },
        InventorySupplierReviewedInput::Reactivate {
            client_request_id: Uuid::new_v4(),
            supplier_id: changed.id,
            expected_version: changed.version,
        },
    ] {
        error(
            suppliers::command(pool, writer.clone(), input).await,
            suppliers::InventorySupplierError::ItemReference,
        );
    }
    let detail = suppliers::detail(pool, reader, changed.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        detail.eligibility.lifecycle_blocked_by,
        Some(InventorySupplierEligibilityBlocker::ItemReference)
    );
    let after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(i) FROM inventory_items i WHERE id=$1")
            .bind(item)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(
        before == after,
        "supplier metadata never rewrites retained item observations"
    );
}

#[tokio::test]
async fn supplier32_directory_history_detail_and_legacy_contact_page_queries_are_constant() {
    let database = TestDb::hospital().await.unwrap();
    let pool = database.pool();
    let facility = database.facility_id();
    let (writer, reader) = actors(pool, facility).await;
    sqlx::query("INSERT INTO inventory_suppliers(id,facility_id,code,name,phone,email)SELECT gen_random_uuid(),$1,'S32_PAGE_'||lpad(n::text,4,'0'),'Synthetic bounded supplier','S32PHONE'||n::text,'synthetic'||n::text||'@example.test' FROM generate_series(1,1000)n").bind(facility).execute(pool).await.unwrap();
    let supplier = suppliers::command(pool, writer, create_input("S32%_LITERAL"))
        .await
        .unwrap()
        .supplier;
    for limit in [1, 25, 100] {
        let (rows, queries) = hms_observability::with_request_query_counter(suppliers::list(
            pool,
            reader.clone(),
            None,
            limit,
            InventorySupplierAdministrationQuery::default(),
        ))
        .await;
        assert_eq!(rows.unwrap().len(), limit as usize);
        assert_eq!(queries, 11);
        let (rows, queries) = hms_observability::with_request_query_counter(suppliers::history(
            pool,
            reader.clone(),
            supplier.id,
            None,
            limit,
        ))
        .await;
        assert_eq!(rows.unwrap().len(), 1);
        assert_eq!(queries, 12);
        let (rows, queries) =
            hms_observability::with_request_query_counter(hms_db::inventory::list_suppliers(
                pool,
                reader.clone(),
                None,
                limit,
                Default::default(),
            ))
            .await;
        let rows = rows.unwrap();
        assert_eq!(rows.len(), limit as usize);
        assert_eq!(queries, 11);
        assert_eq!(
            serde_json::to_value(&rows[0])
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            8
        );
    }
    let (_, queries) = hms_observability::with_request_query_counter(suppliers::detail(
        pool,
        reader.clone(),
        supplier.id,
    ))
    .await;
    assert_eq!(queries, 12);
    let rows = suppliers::list(
        pool,
        reader.clone(),
        None,
        101,
        InventorySupplierAdministrationQuery {
            search: Some("%_".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, supplier.id);
    for search in ["S32PHONE1000", "synthetic1000@example.test"] {
        let rows = suppliers::list(
            pool,
            reader.clone(),
            None,
            101,
            InventorySupplierAdministrationQuery {
                search: Some(search.into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
    }
    let mut seen = std::collections::HashSet::new();
    let mut cursor = None;
    loop {
        let rows = suppliers::list(
            pool,
            reader.clone(),
            cursor,
            100,
            InventorySupplierAdministrationQuery {
                search: Some("S32_PAGE_".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        for row in &rows {
            assert!(seen.insert(row.id));
        }
        if rows.len() < 100 {
            break;
        }
        let last = rows.last().unwrap();
        cursor = Some(hms_db::inventory::InventoryCursor {
            occurred_at: last.created_at,
            id: last.id,
        });
    }
    assert_eq!(seen.len(), 1000);
}

#[tokio::test]
async fn supplier32_projection_updates_only_own_document_and_preserves_identity_metadata() {
    let database = TestDb::hospital().await.unwrap();
    let pool = database.pool();
    let facility = database.facility_id();
    let (writer, _) = actors(pool, facility).await;
    let created = suppliers::command(pool, writer.clone(), create_input("S32_PROJECTION"))
        .await
        .unwrap()
        .supplier;
    sqlx::query("UPDATE search_documents SET metadata=metadata||jsonb_build_object('retained_marker','synthetic marker') WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2").bind(facility).bind(created.id).execute(pool).await.unwrap();
    let id:Uuid=sqlx::query_scalar("SELECT id FROM search_documents WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2").bind(facility).bind(created.id).fetch_one(pool).await.unwrap();
    let before_other:serde_json::Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM search_documents d WHERE NOT(facility_id=$1 AND resource_type='inventory' AND resource_id=$2)").bind(facility).bind(created.id).fetch_one(pool).await.unwrap();
    let mut input = correction(&created, "Search supplier corrected");
    if let InventorySupplierReviewedInput::Correct { address, .. } = &mut input {
        *address = Some("Synthetic private address sentinel".into());
    }
    suppliers::command(pool, writer, input).await.unwrap();
    let (actual,requires,path,metadata,text):(Uuid,bool,String,serde_json::Value,String)=sqlx::query_as("SELECT id,requires_patient_demographics,route_path,metadata,search_text FROM search_documents WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2").bind(facility).bind(created.id).fetch_one(pool).await.unwrap();
    assert_eq!(actual, id);
    assert!(requires);
    assert_eq!(path, format!("/inventory/suppliers/{}", created.id));
    assert_eq!(
        metadata
            .get("retained_marker")
            .and_then(serde_json::Value::as_str),
        Some("synthetic marker")
    );
    assert!(!text.contains("private address sentinel"));
    let after_other:serde_json::Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM search_documents d WHERE NOT(facility_id=$1 AND resource_type='inventory' AND resource_id=$2)").bind(facility).bind(created.id).fetch_one(pool).await.unwrap();
    assert!(
        before_other == after_other,
        "no item/order/unrelated search fanout"
    );
}

#[tokio::test]
async fn supplier32_projection_busy_and_ownership_conflict_roll_back_every_command_effect() {
    let database = TestDb::hospital().await.unwrap();
    let pool = database.pool();
    let facility = database.facility_id();
    let (writer, _) = actors(pool, facility).await;
    let created = suppliers::command(
        pool,
        writer.clone(),
        create_input("S32_PROJECTION_ROLLBACK"),
    )
    .await
    .unwrap()
    .supplier;
    let snapshot = |pool: PgPool, id: Uuid| async move {
        sqlx::query_scalar::<_,serde_json::Value>("SELECT jsonb_build_object('supplier',(SELECT to_jsonb(s) FROM inventory_suppliers s WHERE id=$1),'commands',(SELECT count(*) FROM inventory_supplier_commands WHERE supplier_id=$1),'audits',(SELECT count(*) FROM audit_events WHERE resource_type='inventory_supplier' AND resource_id=$1))").bind(id).fetch_one(&pool).await.unwrap()
    };
    let before = snapshot(pool.clone(), created.id).await;
    let mut held = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM search_documents WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2 FOR UPDATE").bind(facility).bind(created.id).execute(&mut *held).await.unwrap();
    let input = correction(&created, "Blocked projection correction");
    error(
        suppliers::command(pool, writer.clone(), input.clone()).await,
        suppliers::InventorySupplierError::Busy,
    );
    assert!(
        before == snapshot(pool.clone(), created.id).await,
        "projection contention is a definite full rollback"
    );
    held.rollback().await.unwrap();
    let confirmed = suppliers::command(pool, writer.clone(), input)
        .await
        .unwrap()
        .supplier;
    sqlx::query("UPDATE search_documents SET metadata=jsonb_set(metadata,'{source_table}','\"purchase_orders\"'::jsonb) WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2").bind(facility).bind(created.id).execute(pool).await.unwrap();
    let before = snapshot(pool.clone(), created.id).await;
    error(
        suppliers::command(
            pool,
            writer,
            correction(&confirmed, "Rejected ownership correction"),
        )
        .await,
        suppliers::InventorySupplierError::ProjectionConflict,
    );
    assert!(
        before == snapshot(pool.clone(), created.id).await,
        "foreign projection ownership cannot publish supplier/audit/receipt changes"
    );
    let owner:String=sqlx::query_scalar("SELECT metadata->>'source_table' FROM search_documents WHERE facility_id=$1 AND resource_type='inventory' AND resource_id=$2").bind(facility).bind(created.id).fetch_one(pool).await.unwrap();
    assert_eq!(owner, "purchase_orders");
}

#[tokio::test]
async fn supplier32_reference_and_lifecycle_locks_serialize_in_both_orders() {
    let database = TestDb::hospital().await.unwrap();
    let pool = database.pool();
    let facility = database.facility_id();
    let (writer, _) = actors(pool, facility).await;
    let first = suppliers::command(pool, writer.clone(), create_input("S32_REFERENCE_FIRST"))
        .await
        .unwrap()
        .supplier;
    let mut assignment = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,primary_supplier_id,is_active)VALUES($1,$2,$3,'S32_REFERENCE_FIRST_ITEM','Synthetic retained item','supply','piece',$4,false)").bind(Uuid::new_v4()).bind(facility).bind(Uuid::from_u128(hms_db::provision::DEFAULT_INVENTORY_CATEGORY_MED_ID)).bind(first.id).execute(&mut *assignment).await.unwrap();
    error(
        suppliers::command(
            pool,
            writer.clone(),
            InventorySupplierReviewedInput::Retire {
                client_request_id: Uuid::new_v4(),
                supplier_id: first.id,
                expected_version: first.version,
            },
        )
        .await,
        suppliers::InventorySupplierError::Busy,
    );
    assignment.commit().await.unwrap();
    error(
        suppliers::command(
            pool,
            writer.clone(),
            InventorySupplierReviewedInput::Retire {
                client_request_id: Uuid::new_v4(),
                supplier_id: first.id,
                expected_version: first.version,
            },
        )
        .await,
        suppliers::InventorySupplierError::ItemReference,
    );
    let second = suppliers::command(pool, writer.clone(), create_input("S32_LIFECYCLE_FIRST"))
        .await
        .unwrap()
        .supplier;
    let mut lifecycle = pool.begin().await.unwrap();
    sqlx::query("WITH point AS MATERIALIZED(SELECT clock_timestamp() AS at) UPDATE inventory_suppliers s SET is_active=false,version=version+1,catalog_changed_at=p.at,updated_at=p.at,updated_by_user_id=$2 FROM point p WHERE s.id=$1").bind(second.id).bind(writer.user_id).execute(&mut *lifecycle).await.unwrap();
    let id = Uuid::new_v4();
    let statement="INSERT INTO inventory_items(id,facility_id,category_id,code,name,item_type,unit,primary_supplier_id)VALUES($1,$2,$3,'S32_LIFECYCLE_FIRST_ITEM','Synthetic retained item','supply','piece',$4)";
    let busy = sqlx::query(statement)
        .bind(id)
        .bind(facility)
        .bind(Uuid::from_u128(
            hms_db::provision::DEFAULT_INVENTORY_CATEGORY_MED_ID,
        ))
        .bind(second.id)
        .execute(pool)
        .await
        .unwrap_err();
    assert_eq!(
        busy.as_database_error().unwrap().code().as_deref(),
        Some("55P03")
    );
    lifecycle.commit().await.unwrap();
    let unavailable = sqlx::query(statement)
        .bind(id)
        .bind(facility)
        .bind(Uuid::from_u128(
            hms_db::provision::DEFAULT_INVENTORY_CATEGORY_MED_ID,
        ))
        .bind(second.id)
        .execute(pool)
        .await
        .unwrap_err();
    assert_eq!(
        unavailable.as_database_error().unwrap().message(),
        "inventory_supplier_source_unavailable"
    );
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_items WHERE id=$1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(rows, 0);
}
