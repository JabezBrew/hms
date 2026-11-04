use super::*;
async fn current_item24() -> (hms_db::test_support::TestDatabase, hms_db::PgPool) {
    let d = hms_db::test_support::TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
    assert_eq!(committed_breaking_epoch(&p).await.unwrap(), 202611020032);
    (d, p)
}
#[tokio::test]
async fn item24_epoch_requires_committed_checksum_predecessor_and_no_partial_layout() {
    let (_d, p) = current_item24().await;
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|m| m.version == 202610300030)
        .unwrap()
        .checksum
        .as_ref();
    for sql in["UPDATE _sqlx_migrations SET success=false WHERE version=202610300030","UPDATE _sqlx_migrations SET success=true,checksum=decode('00','hex') WHERE version=202610300030","UPDATE _sqlx_migrations SET success=true,version=209901010030 WHERE version=202610300030"]{sqlx::query(sql).execute(&p).await.unwrap();assert!(committed_breaking_epoch(&p).await.is_err());sqlx::query("UPDATE _sqlx_migrations SET version=202610300030,success=true,checksum=$1 WHERE version IN(202610300030,209901010030)").bind(checksum).execute(&p).await.unwrap();require_runtime_schema(&p).await.unwrap();}
    sqlx::query("UPDATE _sqlx_migrations SET success=false WHERE version=202610180029")
        .execute(&p)
        .await
        .unwrap();
    assert!(require_runtime_schema(&p).await.is_err());
    sqlx::query("UPDATE _sqlx_migrations SET success=true WHERE version=202610180029")
        .execute(&p)
        .await
        .unwrap();
    require_runtime_schema(&p).await.unwrap();
    sqlx::query("ALTER TABLE inventory_item_catalog_revisions RENAME TO missing_item24_revisions")
        .execute(&p)
        .await
        .unwrap();
    assert!(require_runtime_schema(&p).await.is_err());
    sqlx::query("ALTER TABLE missing_item24_revisions RENAME TO inventory_item_catalog_revisions")
        .execute(&p)
        .await
        .unwrap();
    require_runtime_schema(&p).await.unwrap();
}
#[tokio::test]
async fn item24_epoch_requires_every_retained_reference_and_immutable_guard() {
    let (_d, p) = current_item24().await;
    for (table, name) in [
        ("inventory_items", "inventory_item_identity_catalog"),
        (
            "inventory_item_catalog_versions",
            "inventory_item_legacy_catalog_closed",
        ),
        (
            "inventory_item_commands",
            "inventory_item_command_immutable",
        ),
        ("inventory_item_commands", "inventory_item_command_complete"),
        (
            "inventory_item_catalog_revisions",
            "inventory_item_revision_immutable",
        ),
        ("stock_batches", "inventory_item_batch_reference"),
        ("stock_movements", "inventory_item_movement_reference"),
        ("stock_transfers", "inventory_item_transfer_reference"),
        (
            "controlled_substance_register",
            "inventory_item_controlled_reference",
        ),
        ("pharmacy_dispenses", "inventory_item_dispense_reference"),
        ("prescriptions", "inventory_item_prescription_reference"),
        ("medication_courses", "inventory_item_course_reference"),
        (
            "pharmacy_fulfillments",
            "inventory_item_fulfillment_reference",
        ),
        (
            "inventory_standing_order_template_items",
            "inventory_item_template_reference",
        ),
        (
            "stock_requisition_items",
            "inventory_item_requisition_reference",
        ),
    ] {
        sqlx::query(&format!("ALTER TABLE {table} DISABLE TRIGGER {name}"))
            .execute(&p)
            .await
            .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "disabled retained guard"
        );
        sqlx::query(&format!("ALTER TABLE {table} ENABLE TRIGGER {name}"))
            .execute(&p)
            .await
            .unwrap();
        require_runtime_schema(&p).await.unwrap();
        sqlx::query(&format!(
            "ALTER TRIGGER {name} ON {table} RENAME TO wrong_item24_guard"
        ))
        .execute(&p)
        .await
        .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "renamed retained guard"
        );
        sqlx::query(&format!(
            "ALTER TRIGGER wrong_item24_guard ON {table} RENAME TO {name}"
        ))
        .execute(&p)
        .await
        .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
    let original:String=sqlx::query_scalar("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='inventory_item_transfer_reference'").fetch_one(&p).await.unwrap();
    sqlx::raw_sql("DROP TRIGGER inventory_item_transfer_reference ON stock_transfers;CREATE TRIGGER inventory_item_transfer_reference BEFORE INSERT OR UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION inventory_item_operational_reference_guard('inventory_item_id');").execute(&p).await.unwrap();
    assert!(require_runtime_schema(&p).await.is_err());
    sqlx::query("DROP TRIGGER inventory_item_transfer_reference ON stock_transfers")
        .execute(&p)
        .await
        .unwrap();
    sqlx::query(&original).execute(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
}
#[tokio::test]
async fn item24_epoch_requires_exact_columns_version_check_and_function_semantics() {
    let (_d, p) = current_item24().await;
    for (table, column, bad, good) in [
        ("inventory_items", "version", "int4", "int8"),
        ("stock_transfers", "requested_unit", "varchar", "text"),
    ] {
        sqlx::query(&format!(
            "ALTER TABLE {table} ALTER COLUMN {column} TYPE {bad} USING {column}::{bad}"
        ))
        .execute(&p)
        .await
        .unwrap();
        assert!(require_runtime_schema(&p).await.is_err());
        sqlx::query(&format!(
            "ALTER TABLE {table} ALTER COLUMN {column} TYPE {good} USING {column}::{good}"
        ))
        .execute(&p)
        .await
        .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
    sqlx::raw_sql("ALTER TABLE inventory_items ALTER COLUMN version DROP NOT NULL;")
        .execute(&p)
        .await
        .unwrap();
    assert!(require_runtime_schema(&p).await.is_err());
    sqlx::raw_sql("ALTER TABLE inventory_items ALTER COLUMN version SET NOT NULL;")
        .execute(&p)
        .await
        .unwrap();
    require_runtime_schema(&p).await.unwrap();
    sqlx::raw_sql("ALTER TABLE inventory_items DROP CONSTRAINT inventory_item_version_positive;ALTER TABLE inventory_items ADD CONSTRAINT inventory_item_version_positive CHECK(version>=0);").execute(&p).await.unwrap();
    assert!(require_runtime_schema(&p).await.is_err());
    sqlx::raw_sql("ALTER TABLE inventory_items DROP CONSTRAINT inventory_item_version_positive;ALTER TABLE inventory_items ADD CONSTRAINT inventory_item_version_positive CHECK(version>0);").execute(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
    for signature in [
        "inventory_item_has_operational_history(uuid)",
        "inventory_item_reserve_codes(uuid,text[])",
    ] {
        sqlx::query(&format!("ALTER FUNCTION {signature} STABLE"))
            .execute(&p)
            .await
            .unwrap();
        assert!(require_runtime_schema(&p).await.is_err());
        sqlx::query(&format!("ALTER FUNCTION {signature} VOLATILE"))
            .execute(&p)
            .await
            .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
}
#[tokio::test]
async fn item24_epoch_requires_bounded_page_and_all_ten_uuid_leading_lookup_indexes() {
    let (_d, p) = current_item24().await;
    for (index, table, wrong) in [
        (
            "inventory_item_administration_page_idx",
            "inventory_items",
            "id",
        ),
        (
            "inventory_item_legacy_history_page_idx",
            "inventory_item_catalog_versions",
            "item_id",
        ),
        (
            "inventory_item_correction_history_page_idx",
            "inventory_item_catalog_revisions",
            "item_id",
        ),
        (
            "inventory_item_commands_item_idx",
            "inventory_item_commands",
            "item_id",
        ),
        (
            "inventory_item_batch_reference_idx",
            "stock_batches",
            "facility_id",
        ),
        (
            "inventory_item_movement_reference_idx",
            "stock_movements",
            "facility_id",
        ),
        (
            "inventory_item_transfer_reference_idx",
            "stock_transfers",
            "facility_id",
        ),
        (
            "inventory_item_controlled_reference_idx",
            "controlled_substance_register",
            "facility_id",
        ),
        (
            "inventory_item_dispense_reference_idx",
            "pharmacy_dispenses",
            "facility_id",
        ),
        (
            "inventory_item_prescription_reference_idx",
            "prescriptions",
            "facility_id",
        ),
        (
            "inventory_item_course_reference_idx",
            "medication_courses",
            "facility_id",
        ),
        (
            "inventory_item_fulfillment_reference_idx",
            "pharmacy_fulfillments",
            "facility_id",
        ),
        (
            "inventory_item_template_reference_idx",
            "inventory_standing_order_template_items",
            "facility_id",
        ),
        (
            "inventory_item_requisition_reference_idx",
            "stock_requisition_items",
            "facility_id",
        ),
    ] {
        let original: String = sqlx::query_scalar("SELECT pg_get_indexdef($1::regclass)")
            .bind(index)
            .fetch_one(&p)
            .await
            .unwrap();
        sqlx::query(&format!("DROP INDEX {index}"))
            .execute(&p)
            .await
            .unwrap();
        assert!(require_runtime_schema(&p).await.is_err());
        sqlx::query(&format!("CREATE INDEX {index} ON {table}({wrong})"))
            .execute(&p)
            .await
            .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "same-name wrong-key index"
        );
        sqlx::query(&format!("DROP INDEX {index}"))
            .execute(&p)
            .await
            .unwrap();
        sqlx::query(&original).execute(&p).await.unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
}

#[tokio::test]
async fn item24_historical_migrator_refuses_downward_replay_without_touching_catalog() {
    let (_d, p) = current_item24().await;
    let before:serde_json::Value=sqlx::query_scalar("SELECT jsonb_build_object('items',(SELECT coalesce(jsonb_agg(to_jsonb(i)ORDER BY id),'[]'::jsonb)FROM inventory_items i),'legacy',(SELECT coalesce(jsonb_agg(to_jsonb(v)ORDER BY id),'[]'::jsonb)FROM inventory_item_catalog_versions v),'epoch',(SELECT max(version)FROM _sqlx_migrations))").fetch_one(&p).await.unwrap();
    let old = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610300030)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    assert!(
        old.run(&p).await.is_err(),
        "historical migration set cannot erase unknown committed030"
    );
    let after:serde_json::Value=sqlx::query_scalar("SELECT jsonb_build_object('items',(SELECT coalesce(jsonb_agg(to_jsonb(i)ORDER BY id),'[]'::jsonb)FROM inventory_items i),'legacy',(SELECT coalesce(jsonb_agg(to_jsonb(v)ORDER BY id),'[]'::jsonb)FROM inventory_item_catalog_versions v),'epoch',(SELECT max(version)FROM _sqlx_migrations))").fetch_one(&p).await.unwrap();
    assert_eq!(after, before);
    require_runtime_schema(&p).await.unwrap();
}
