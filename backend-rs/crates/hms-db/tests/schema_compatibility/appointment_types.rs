use super::*;
async fn current() -> (hms_db::test_support::TestDatabase, hms_db::PgPool) {
    let d = hms_db::test_support::TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
    (d, p)
}
#[tokio::test]
async fn type_epoch_metadata_and_immutable_publication_guards_must_agree() {
    let (_db, p) = current().await;
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|m| m.version == 202610180029)
        .unwrap()
        .checksum
        .as_ref();
    for sql in ["UPDATE _sqlx_migrations SET success=false WHERE version=202610180029","UPDATE _sqlx_migrations SET success=true,checksum=decode('00','hex') WHERE version=202610180029","UPDATE _sqlx_migrations SET success=true,version=209901010006 WHERE version=202610180029"]{
 sqlx::query(sql).execute(&p).await.unwrap();assert!(committed_breaking_epoch(&p).await.is_err());
 sqlx::query("UPDATE _sqlx_migrations SET version=202610180029,success=true,checksum=$1 WHERE version IN(202610180029,209901010006)").bind(checksum).execute(&p).await.unwrap();require_runtime_schema(&p).await.unwrap();}
    for (table, name) in [
        ("appointment_types", "appointment_type_identity_lifecycle"),
        ("appointments", "appointment_type_appointment_reference"),
        ("appointment_series", "appointment_type_series_reference"),
        (
            "clinic_session_appointment_types",
            "appointment_type_session_allowed_reference",
        ),
        (
            "clinic_session_template_appointment_types",
            "appointment_type_template_allowed_reference",
        ),
        (
            "clinic_sessions",
            "appointment_type_session_owner_reference",
        ),
        (
            "clinic_session_templates",
            "appointment_type_template_owner_reference",
        ),
        (
            "clinic_session_appointment_types",
            "appointment_type_session_allowed_membership",
        ),
        (
            "clinic_session_template_appointment_types",
            "appointment_type_template_allowed_membership",
        ),
        (
            "appointment_type_commands",
            "appointment_type_command_immutable",
        ),
    ] {
        sqlx::query(&format!("ALTER TABLE {table} DISABLE TRIGGER {name}"))
            .execute(&p)
            .await
            .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "disabled required type guard"
        );
        sqlx::query(&format!("ALTER TABLE {table} ENABLE TRIGGER {name}"))
            .execute(&p)
            .await
            .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
}
#[tokio::test]
async fn type_epoch_requires_exact_columns_and_fresh_future_function() {
    let (_db, p) = current().await;
    for (table, column, bad, restore) in [("appointment_types", "version", "int4", "int8")] {
        sqlx::query(&format!(
            "ALTER TABLE {table} ALTER COLUMN {column} TYPE {bad} USING {column}::{bad}"
        ))
        .execute(&p)
        .await
        .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "wrong critical type"
        );
        sqlx::query(&format!(
            "ALTER TABLE {table} ALTER COLUMN {column} TYPE {restore} USING {column}::{restore}"
        ))
        .execute(&p)
        .await
        .unwrap();
        require_runtime_schema(&p).await.unwrap();
        sqlx::query(&format!(
            "ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL"
        ))
        .execute(&p)
        .await
        .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "nullable critical column"
        );
        sqlx::query(&format!(
            "ALTER TABLE {table} ALTER COLUMN {column} SET NOT NULL"
        ))
        .execute(&p)
        .await
        .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
    sqlx::raw_sql("ALTER TABLE appointment_type_commands RENAME COLUMN receipt TO original_receipt;ALTER TABLE appointment_type_commands ADD COLUMN receipt text NOT NULL DEFAULT '';").execute(&p).await.unwrap();
    assert!(
        require_runtime_schema(&p).await.is_err(),
        "wrong critical receipt type despite original constraints"
    );
    sqlx::raw_sql("ALTER TABLE appointment_type_commands DROP COLUMN receipt;ALTER TABLE appointment_type_commands RENAME COLUMN original_receipt TO receipt;").execute(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
    sqlx::query(
        "ALTER FUNCTION appointment_type_has_future_generator(uuid,uuid,timestamptz) STABLE",
    )
    .execute(&p)
    .await
    .unwrap();
    assert!(require_runtime_schema(&p).await.is_err());
    sqlx::query(
        "ALTER FUNCTION appointment_type_has_future_generator(uuid,uuid,timestamptz) VOLATILE",
    )
    .execute(&p)
    .await
    .unwrap();
    require_runtime_schema(&p).await.unwrap();
}
#[tokio::test]
async fn type_epoch_requires_exact_lookup_indexes_and_parent_membership_arguments() {
    let (_db, p) = current().await;
    for (index, table, keys) in [
        (
            "appointment_type_commands_type_idx",
            "appointment_type_commands",
            "type_id",
        ),
        (
            "appointment_type_administration_page_idx",
            "appointment_types",
            "id",
        ),
        (
            "appointment_type_template_allowed_reference_idx",
            "clinic_session_template_appointment_types",
            "clinic_session_template_id",
        ),
        (
            "appointment_type_active_template_owner_idx",
            "clinic_session_templates",
            "facility_id,owner_id",
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
        sqlx::query(&format!("CREATE INDEX {index} ON {table}({keys})"))
            .execute(&p)
            .await
            .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "same index name with incorrect keys or predicate"
        );
        sqlx::query(&format!("DROP INDEX {index}"))
            .execute(&p)
            .await
            .unwrap();
        sqlx::query(&original).execute(&p).await.unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
    let original:String=sqlx::query_scalar("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='appointment_type_template_allowed_membership'").fetch_one(&p).await.unwrap();
    sqlx::raw_sql("DROP TRIGGER appointment_type_template_allowed_membership ON clinic_session_template_appointment_types;CREATE TRIGGER appointment_type_template_allowed_membership BEFORE INSERT OR DELETE OR UPDATE ON clinic_session_template_appointment_types FOR EACH ROW EXECUTE FUNCTION appointment_type_membership_guard('clinic_session_id');").execute(&p).await.unwrap();
    assert!(require_runtime_schema(&p).await.is_err());
    sqlx::query("DROP TRIGGER appointment_type_template_allowed_membership ON clinic_session_template_appointment_types").execute(&p).await.unwrap();
    sqlx::query(&original).execute(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
}
