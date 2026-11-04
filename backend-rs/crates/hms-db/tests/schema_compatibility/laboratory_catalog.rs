//! Authored static controls only. Run after accepted26B rebase, not in this proposal.
use super::*;
async fn current() -> (hms_db::test_support::TestDatabase, hms_db::PgPool) {
    let d = hms_db::test_support::TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
    assert_eq!(committed_breaking_epoch(&p).await.unwrap(), 202611030033);
    (d, p)
}
async fn fault(p: &hms_db::PgPool, break_sql: &str, restore_sql: &str) {
    sqlx::query(break_sql).execute(p).await.unwrap();
    let refused = require_runtime_schema(p).await.is_err();
    sqlx::query(restore_sql).execute(p).await.unwrap();
    assert!(
        refused,
        "incoherent laboratory033 layout must refuse startup"
    );
    require_runtime_schema(p).await.unwrap();
}
#[tokio::test]
async fn laboratory033_history_columns_defaults_constraints_and_indexes_fail_closed() {
    let (_d, p) = current().await;
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|m| m.version == 202611030033)
        .unwrap()
        .checksum
        .as_ref();
    for mutation in [
        "UPDATE _sqlx_migrations SET success=false WHERE version=202611030033",
        "UPDATE _sqlx_migrations SET checksum=decode('00','hex') WHERE version=202611030033",
    ] {
        sqlx::query(mutation).execute(&p).await.unwrap();
        assert!(require_runtime_schema(&p).await.is_err());
        sqlx::query(
            "UPDATE _sqlx_migrations SET success=true,checksum=$1 WHERE version=202611030033",
        )
        .bind(checksum)
        .execute(&p)
        .await
        .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
    for table in ["lab_tests", "lab_panels"] {
        fault(
            &p,
            &format!("ALTER TABLE {table} ALTER COLUMN version SET DEFAULT 9"),
            &format!("ALTER TABLE {table} ALTER COLUMN version SET DEFAULT 1"),
        )
        .await;
        fault(
            &p,
            &format!("ALTER TABLE {table} ALTER COLUMN version DROP NOT NULL"),
            &format!("ALTER TABLE {table} ALTER COLUMN version SET NOT NULL"),
        )
        .await;
        for column in ["catalog_changed_at", "catalog_changed_by_user_id"] {
            fault(
                &p,
                &format!("ALTER TABLE {table} RENAME COLUMN {column} TO missing033"),
                &format!("ALTER TABLE {table} RENAME COLUMN missing033 TO {column}"),
            )
            .await;
        }
        fault(
            &p,
            &format!("ALTER TABLE {table} ALTER COLUMN catalog_changed_at SET DEFAULT now()"),
            &format!("ALTER TABLE {table} ALTER COLUMN catalog_changed_at DROP DEFAULT"),
        )
        .await;
    }
    fault(
        &p,
        "ALTER TABLE lab_tests ALTER COLUMN specimen_type DROP NOT NULL",
        "ALTER TABLE lab_tests ALTER COLUMN specimen_type SET NOT NULL",
    )
    .await;
    fault(
        &p,
        "ALTER TABLE lab_tests ALTER COLUMN category SET NOT NULL",
        "ALTER TABLE lab_tests ALTER COLUMN category DROP NOT NULL",
    )
    .await;
    fault(
        &p,
        "ALTER TABLE lab_tests ALTER COLUMN result_unit TYPE varchar",
        "ALTER TABLE lab_tests ALTER COLUMN result_unit TYPE text",
    )
    .await;
    for table in ["lab_tests", "lab_panels"] {
        for column in ["is_system_default", "is_facility_modified"] {
            fault(
                &p,
                &format!("ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL"),
                &format!("ALTER TABLE {table} ALTER COLUMN {column} SET NOT NULL"),
            )
            .await;
        }
    }
    for (table, column) in [
        ("lab_panel_tests", "panel_id"),
        ("lab_panel_tests", "test_id"),
        ("lab_order_tests", "order_id"),
        ("lab_order_tests", "test_id"),
    ] {
        fault(
            &p,
            &format!("ALTER TABLE {table} RENAME COLUMN {column} TO missing033"),
            &format!("ALTER TABLE {table} RENAME COLUMN missing033 TO {column}"),
        )
        .await;
    }
    fault(
        &p,
        "ALTER INDEX lab_order_tests_pkey RENAME TO missing033_primary",
        "ALTER INDEX missing033_primary RENAME TO lab_order_tests_pkey",
    )
    .await;
    fault(
        &p,
        "ALTER TABLE lab_panels ALTER COLUMN membership_generation SET DEFAULT 1",
        "ALTER TABLE lab_panels ALTER COLUMN membership_generation SET DEFAULT 0",
    )
    .await;
    fault(
        &p,
        "ALTER TABLE lab_panels ALTER COLUMN membership_generation DROP NOT NULL",
        "ALTER TABLE lab_panels ALTER COLUMN membership_generation SET NOT NULL",
    )
    .await;
    for (table, name) in [
        ("lab_tests", "laboratory_test_version_positive"),
        ("lab_panels", "laboratory_panel_version_positive"),
        (
            "lab_panels",
            "laboratory_panel_membership_generation_nonnegative",
        ),
        ("lab_tests", "lab_tests_catalog_changed_by_user_id_fkey"),
        ("lab_panels", "lab_panels_catalog_changed_by_user_id_fkey"),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_commands_request_key_hash_check",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_commands_payload_digest_check",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_commands_receipt_check",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_commands_subject_kind_check",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_command_subject",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_commands_facility_id_fkey",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_commands_actor_user_id_fkey",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_commands_test_id_fkey",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_commands_panel_id_fkey",
        ),
    ] {
        let definition:String=sqlx::query_scalar("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2").bind(table).bind(name).fetch_one(&p).await.unwrap();
        fault(
            &p,
            &format!("ALTER TABLE {table} DROP CONSTRAINT {name}"),
            &format!("ALTER TABLE {table} ADD CONSTRAINT {name} {definition}"),
        )
        .await;
    }
    for index in [
        "laboratory_test_administration_page_idx",
        "laboratory_panel_administration_page_idx",
        "laboratory_catalog_commands_history_idx",
        "laboratory_catalog_audit_command_idx",
    ] {
        let definition: String = sqlx::query_scalar("SELECT pg_get_indexdef($1::regclass)")
            .bind(index)
            .fetch_one(&p)
            .await
            .unwrap();
        fault(&p, &format!("DROP INDEX {index}"), &definition).await;
    }
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT(SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)").fetch_one(&p).await.unwrap();
    assert_eq!(
        counts,
        (0, 0, 0),
        "schema probes do not provision clinical data"
    );
}
#[tokio::test]
async fn laboratory033_every_guard_signature_body_and_trigger_shape_is_required() {
    let (_d, p) = current().await;
    for (table, trigger) in [
        ("lab_tests", "laboratory_test_definition"),
        ("lab_panels", "laboratory_panel_definition"),
        ("lab_panel_tests", "laboratory_panel_membership"),
        ("lab_panel_tests", "laboratory_panel_membership_changed"),
        ("lab_order_tests", "laboratory_order_test_source"),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_command_immutable",
        ),
        (
            "laboratory_catalog_commands",
            "laboratory_catalog_command_complete",
        ),
        ("lab_tests", "laboratory_test_search"),
        ("lab_panels", "laboratory_panel_search"),
    ] {
        fault(
            &p,
            &format!("ALTER TABLE {table} DISABLE TRIGGER {trigger}"),
            &format!("ALTER TABLE {table} ENABLE TRIGGER {trigger}"),
        )
        .await;
    }
    for signature in [
        "laboratory_catalog_identity_gate(text,uuid)",
        "laboratory_catalog_code_gate(text,uuid,text)",
        "laboratory_catalog_request_gate(uuid,uuid)",
        "laboratory_catalog_panel_gates(uuid[],boolean)",
        "laboratory_catalog_definition_guard()",
        "laboratory_catalog_membership_guard()",
        "laboratory_catalog_membership_changed()",
        "laboratory_order_test_source_guard()",
        "laboratory_catalog_receipt_valid(jsonb)",
        "laboratory_catalog_command_guard()",
        "laboratory_catalog_command_complete_guard()",
        "laboratory_catalog_refresh_document(uuid,text,uuid)",
        "laboratory_catalog_search_guard()",
    ] {
        let (definition, body): (String, String) = sqlx::query_as(
            "SELECT pg_get_functiondef(oid),prosrc FROM pg_proc WHERE oid=$1::regprocedure",
        )
        .bind(signature)
        .fetch_one(&p)
        .await
        .unwrap();
        // Same callable signature, different intrinsic body: exact-body evidence
        // must refuse even if a superficial signature/layout check still passes.
        let altered = definition.replacen(
            &body,
            &format!("{body}\n-- changed laboratory guard body\n"),
            1,
        );
        assert_ne!(altered, definition);
        fault(&p, &altered, &definition).await;
        fault(
            &p,
            &format!("ALTER FUNCTION {signature} SET search_path=public"),
            &definition,
        )
        .await;
    }
    let original:String=sqlx::query_scalar("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='lab_order_tests'::regclass AND tgname='laboratory_order_test_source'").fetch_one(&p).await.unwrap();
    sqlx::query("DROP TRIGGER laboratory_order_test_source ON lab_order_tests")
        .execute(&p)
        .await
        .unwrap();
    sqlx::query("CREATE TRIGGER laboratory_order_test_source BEFORE INSERT OR UPDATE OF order_id ON lab_order_tests FOR EACH ROW EXECUTE FUNCTION laboratory_order_test_source_guard()").execute(&p).await.unwrap();
    let refused = require_runtime_schema(&p).await.is_err();
    sqlx::query("DROP TRIGGER laboratory_order_test_source ON lab_order_tests")
        .execute(&p)
        .await
        .unwrap();
    sqlx::query(&original).execute(&p).await.unwrap();
    assert!(
        refused,
        "all retargeting columns, not one column, require intrinsic proof"
    );
    require_runtime_schema(&p).await.unwrap();
}
