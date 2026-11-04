use hms_db::schema_compatibility::{committed_breaking_epoch, require_runtime_schema};

#[tokio::test]
async fn supplier32_checksum_defaults_source_triggers_and_reference_lookup_are_required() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202611020032);
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202611020032)
        .unwrap()
        .checksum
        .as_ref();
    sqlx::query(
        "UPDATE _sqlx_migrations SET checksum=decode('00','hex') WHERE version=202611020032",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("UPDATE _sqlx_migrations SET checksum=$1 WHERE version=202611020032")
        .bind(checksum)
        .execute(&pool)
        .await
        .unwrap();
    require_runtime_schema(&pool).await.unwrap();
    for (table, trigger) in [
        ("inventory_suppliers", "inventory_supplier_identity"),
        ("inventory_items", "inventory_item_supplier_source"),
        ("inventory_suppliers", "inventory_supplier_search"),
        (
            "inventory_supplier_commands",
            "inventory_supplier_command_immutable",
        ),
        (
            "inventory_supplier_commands",
            "inventory_supplier_command_complete",
        ),
    ] {
        sqlx::query(&format!("ALTER TABLE {table} DISABLE TRIGGER {trigger}"))
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            require_runtime_schema(&pool).await.is_err(),
            "disabled supplier guard cannot be accepted"
        );
        sqlx::query(&format!("ALTER TABLE {table} ENABLE TRIGGER {trigger}"))
            .execute(&pool)
            .await
            .unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
    sqlx::query("ALTER TABLE inventory_suppliers ALTER COLUMN version SET DEFAULT 9")
        .execute(&pool)
        .await
        .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("ALTER TABLE inventory_suppliers ALTER COLUMN version SET DEFAULT 1")
        .execute(&pool)
        .await
        .unwrap();
    require_runtime_schema(&pool).await.unwrap();
    sqlx::query("ALTER TABLE inventory_suppliers ALTER COLUMN address SET DEFAULT ''")
        .execute(&pool)
        .await
        .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("ALTER TABLE inventory_suppliers ALTER COLUMN address DROP DEFAULT")
        .execute(&pool)
        .await
        .unwrap();
    require_runtime_schema(&pool).await.unwrap();
    let definition: String = sqlx::query_scalar(
        "SELECT pg_get_indexdef('inventory_supplier_item_reference_idx'::regclass)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("DROP INDEX inventory_supplier_item_reference_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE INDEX inventory_supplier_item_reference_idx ON inventory_items(facility_id,primary_supplier_id) WHERE primary_supplier_id IS NOT NULL").execute(&pool).await.unwrap();
    assert!(
        require_runtime_schema(&pool).await.is_err(),
        "a facility-first index does not establish the global retained-reference contract"
    );
    sqlx::query("DROP INDEX inventory_supplier_item_reference_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(&definition).execute(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    let identities:(i64,i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)").fetch_one(&pool).await.unwrap();
    assert_eq!(
        identities,
        (0, 0, 0),
        "readiness probes do not provision business data"
    );
}

#[tokio::test]
async fn supplier32_exact_function_bodies_trigger_columns_and_restrict_fk_are_required() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    let function: String = sqlx::query_scalar(
        "SELECT pg_get_functiondef('inventory_supplier_identity_guard()'::regprocedure)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("CREATE OR REPLACE FUNCTION inventory_supplier_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$").execute(&pool).await.unwrap();
    assert!(
        require_runtime_schema(&pool).await.is_err(),
        "matching signature with a replaced body is insufficient"
    );
    sqlx::query(&function).execute(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    let trigger:String=sqlx::query_scalar("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='inventory_items'::regclass AND tgname='inventory_item_supplier_source'").fetch_one(&pool).await.unwrap();
    sqlx::query("DROP TRIGGER inventory_item_supplier_source ON inventory_items")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE TRIGGER inventory_item_supplier_source BEFORE INSERT OR UPDATE OF name ON inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_item_supplier_source_guard()").execute(&pool).await.unwrap();
    assert!(
        require_runtime_schema(&pool).await.is_err(),
        "source trigger event columns must remain exact"
    );
    sqlx::query("DROP TRIGGER inventory_item_supplier_source ON inventory_items")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(&trigger).execute(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    let foreign_key:String=sqlx::query_scalar("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='inventory_items'::regclass AND conname='inventory_items_primary_supplier_id_fkey'").fetch_one(&pool).await.unwrap();
    sqlx::query(
        "ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_primary_supplier_id_fkey",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_primary_supplier_id_fkey FOREIGN KEY(primary_supplier_id) REFERENCES inventory_suppliers(id) ON DELETE SET NULL").execute(&pool).await.unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query(
        "ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_primary_supplier_id_fkey",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(&format!("ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_primary_supplier_id_fkey {foreign_key}")).execute(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
}
