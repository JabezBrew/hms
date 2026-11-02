//! Minimum runtime and rollback epochs are proven without migration/provisioning writes.
use hms_db::schema_compatibility::{committed_breaking_epoch, require_runtime_schema};
use std::borrow::Cow;

async fn historical(pool: &hms_db::PgPool, before: i64) {
    let migrations = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < before)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    migrations
        .run(pool)
        .await
        .expect("historical migrations apply");
}
#[tokio::test]
async fn new_runtime_requires_category_epoch_while_probe_preserves_historical_epochs() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 0);
    assert!(require_runtime_schema(&pool).await.is_err());
    let tables: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tables, 0, "startup proof does not migrate or provision");
    historical(&pool, 202610170024).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170023);
    assert!(require_runtime_schema(&pool).await.is_err());
    historical(&pool, 202610170025).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170024);
    assert!(require_runtime_schema(&pool).await.is_err());
    historical(&pool, 202610170026).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170025);
    assert!(require_runtime_schema(&pool).await.is_err());
    historical(&pool, 202610170027).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170026);
    assert!(require_runtime_schema(&pool).await.is_err());
    historical(&pool, 202610170028).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170027);
    assert!(require_runtime_schema(&pool).await.is_err());
    historical(&pool, 202610180029).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170028);
    assert!(require_runtime_schema(&pool).await.is_err());
    historical(&pool, 202610300030).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610180029);
    assert!(require_runtime_schema(&pool).await.is_err());
    historical(&pool, 202610310031).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610300030);
    assert!(require_runtime_schema(&pool).await.is_err());
    hms_db::migrate::run(&pool).await.unwrap();
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610310031);
    require_runtime_schema(&pool).await.unwrap();
    let identities:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)").fetch_one(&pool).await.unwrap();
    assert_eq!(identities, (0, 0, 0));
}
#[tokio::test]
async fn referral_metadata_checksum_and_enabled_immutable_layout_must_agree() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202610170024)
        .unwrap()
        .checksum
        .as_ref();
    sqlx::query("UPDATE _sqlx_migrations SET success=false WHERE version=202610170024")
        .execute(&pool)
        .await
        .unwrap();
    assert!(committed_breaking_epoch(&pool).await.is_err());
    sqlx::query("UPDATE _sqlx_migrations SET success=true,checksum=decode('00','hex') WHERE version=202610170024").execute(&pool).await.unwrap();
    assert!(committed_breaking_epoch(&pool).await.is_err());
    sqlx::query("UPDATE _sqlx_migrations SET checksum=$1 WHERE version=202610170024")
        .bind(checksum)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET version=209901010001 WHERE version=202610170024")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        committed_breaking_epoch(&pool).await.is_err(),
        "new layout cannot pretend to be a historical epoch"
    );
    sqlx::query("UPDATE _sqlx_migrations SET version=202610170024 WHERE version=209901010001")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE referral_response_commands DISABLE TRIGGER referral_response_command_immutable").execute(&pool).await.unwrap();
    assert!(committed_breaking_epoch(&pool).await.is_err());
    sqlx::query(
        "ALTER TABLE referral_response_commands ENABLE TRIGGER referral_response_command_immutable",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("ALTER TABLE referrals DISABLE TRIGGER referral_response_root_consistent")
        .execute(&pool)
        .await
        .unwrap();
    assert!(committed_breaking_epoch(&pool).await.is_err());
    sqlx::query("ALTER TABLE referrals ENABLE TRIGGER referral_response_root_consistent")
        .execute(&pool)
        .await
        .unwrap();
    require_runtime_schema(&pool).await.unwrap();
}
#[tokio::test]
async fn cancelled_required_schema_probe_releases_the_canonical_migration_lock() {
    use sqlx::migrate::Migrate;
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::pool::connect_with_max_connections(database.database_url(), 1)
        .await
        .unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let blocker_pool = hms_db::connect(database.database_url()).await.unwrap();
    let mut blocker = blocker_pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE _sqlx_migrations IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    blocker.rollback().await.unwrap();
    let mut connection = pool.acquire().await.unwrap();
    connection.close_on_drop();
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        Migrate::lock(&mut *connection),
    )
    .await
    .expect("failed schema proof releases its session advisory lock")
    .unwrap();
    Migrate::unlock(&mut *connection).await.unwrap();
}

#[tokio::test]
async fn placement_metadata_and_deferred_routing_guards_must_agree() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202610170025)
        .expect("required placement migration is packaged")
        .checksum
        .as_ref();
    sqlx::query("UPDATE _sqlx_migrations SET success=false WHERE version=202610170025")
        .execute(&pool)
        .await
        .unwrap();
    assert!(committed_breaking_epoch(&pool).await.is_err());
    sqlx::query("UPDATE _sqlx_migrations SET success=true,checksum=decode('00','hex') WHERE version=202610170025")
        .execute(&pool).await.unwrap();
    assert!(committed_breaking_epoch(&pool).await.is_err());
    sqlx::query("UPDATE _sqlx_migrations SET checksum=$1 WHERE version=202610170025")
        .bind(checksum)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET version=209901010002 WHERE version=202610170025")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        committed_breaking_epoch(&pool).await.is_err(),
        "new placement layout cannot masquerade as an older schema"
    );
    sqlx::query("UPDATE _sqlx_migrations SET version=202610170025 WHERE version=209901010002")
        .execute(&pool)
        .await
        .unwrap();
    for (disable, enable) in [
        (
            "ALTER TABLE admission_cases DISABLE TRIGGER admission_placement_consistent",
            "ALTER TABLE admission_cases ENABLE TRIGGER admission_placement_consistent",
        ),
        (
            "ALTER TABLE admission_moves DISABLE TRIGGER admission_move_complete",
            "ALTER TABLE admission_moves ENABLE TRIGGER admission_move_complete",
        ),
        (
            "ALTER TABLE admission_move_commands DISABLE TRIGGER admission_move_command_complete",
            "ALTER TABLE admission_move_commands ENABLE TRIGGER admission_move_command_complete",
        ),
        (
            "ALTER TABLE nursing_tasks DISABLE TRIGGER nursing_task_route_consistent",
            "ALTER TABLE nursing_tasks ENABLE TRIGGER nursing_task_route_consistent",
        ),
        (
            "ALTER TABLE nursing_task_routes DISABLE TRIGGER nursing_task_route_immutable",
            "ALTER TABLE nursing_task_routes ENABLE TRIGGER nursing_task_route_immutable",
        ),
    ] {
        sqlx::query(disable).execute(&pool).await.unwrap();
        assert!(
            require_runtime_schema(&pool).await.is_err(),
            "disabled required placement/routing protection must refuse startup"
        );
        sqlx::query(enable).execute(&pool).await.unwrap();
    }
    require_runtime_schema(&pool).await.unwrap();
}

#[tokio::test]
async fn placement_owner_index_requires_actual_unique_scoped_keys() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    // Definition remains solely in test memory. No raw schema/plan or resource
    // identity enters logs or evidence.
    let original: String = sqlx::query_scalar(
        "SELECT pg_get_indexdef('admission_move_current_bed_owner_idx'::regclass)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("DROP INDEX admission_move_current_bed_owner_idx")
        .execute(&pool)
        .await
        .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("CREATE UNIQUE INDEX admission_move_current_bed_owner_idx ON admission_cases(facility_id,id) WHERE bed_id IS NOT NULL")
        .execute(&pool).await.unwrap();
    assert!(
        require_runtime_schema(&pool).await.is_err(),
        "a familiar index name with wrong ownership keys is insufficient"
    );
    sqlx::query("DROP INDEX admission_move_current_bed_owner_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(&original).execute(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
}

#[tokio::test]
async fn placement_runtime_columns_must_exist_before_startup() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    // Actual lost-column counterexample: committed metadata, index keys and
    // enabled PL/pgSQL guards alone did not establish a usable move layout.
    sqlx::query("ALTER TABLE admission_moves DROP COLUMN detail")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        committed_breaking_epoch(&pool).await.is_err(),
        "missing immutable move evidence must refuse the schema epoch"
    );
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("ALTER TABLE admission_moves ADD COLUMN detail jsonb NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    require_runtime_schema(&pool).await.unwrap();
    for (relation, column) in [
        ("admission_moves", "actor_display_name"),
        ("admission_moves", "source_cleaning_minutes"),
        ("admission_moves", "source_cleaning_due_at"),
        ("admission_move_commands", "request_key_hash"),
        ("admission_move_commands", "payload_digest"),
        ("admission_move_commands", "recorded_at"),
    ] {
        // Static schema identifiers only; each committed rename preserves all
        // data, constraints and migration metadata, then restores the fixture.
        sqlx::query(&format!(
            "ALTER TABLE {relation} RENAME COLUMN {column} TO unconfirmed_runtime_field"
        ))
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            require_runtime_schema(&pool).await.is_err(),
            "missing required immutable move or command facts must refuse startup"
        );
        sqlx::query(&format!(
            "ALTER TABLE {relation} RENAME COLUMN unconfirmed_runtime_field TO {column}"
        ))
        .execute(&pool)
        .await
        .unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
}

#[tokio::test]
async fn consultation_metadata_and_all_essential_columns_must_agree() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202610170026)
        .unwrap()
        .checksum
        .as_ref();
    for mutation in [
        "UPDATE _sqlx_migrations SET success=false WHERE version=202610170026",
        "UPDATE _sqlx_migrations SET success=true,checksum=decode('00','hex') WHERE version=202610170026",
        "UPDATE _sqlx_migrations SET success=true,version=209901010003 WHERE version=202610170026",
    ] {
        sqlx::query(mutation).execute(&pool).await.unwrap();
        assert!(require_runtime_schema(&pool).await.is_err());
        sqlx::query("UPDATE _sqlx_migrations SET version=202610170026,success=true,checksum=$1 WHERE version IN(202610170026,209901010003)")
            .bind(checksum).execute(&pool).await.unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
    for (relation, columns) in [
        (
            "referral_consultation_starts",
            vec![
                "id",
                "facility_id",
                "patient_id",
                "referral_id",
                "encounter_id",
                "visit_id",
                "admission_case_id",
                "actor_user_id",
                "practitioner_profile_id",
                "source_mode",
                "recorded_at",
                "detail",
            ],
        ),
        (
            "referral_consultation_start_commands",
            vec![
                "facility_id",
                "request_key_hash",
                "patient_id",
                "referral_id",
                "actor_user_id",
                "payload_digest",
                "result_id",
                "receipt",
                "recorded_at",
            ],
        ),
    ] {
        for column in columns {
            sqlx::query(&format!(
                "ALTER TABLE {relation} RENAME COLUMN {column} TO unconfirmed_runtime_field"
            ))
            .execute(&pool)
            .await
            .unwrap();
            assert!(
                require_runtime_schema(&pool).await.is_err(),
                "every runtime column is required"
            );
            sqlx::query(&format!(
                "ALTER TABLE {relation} RENAME COLUMN unconfirmed_runtime_field TO {column}"
            ))
            .execute(&pool)
            .await
            .unwrap();
            require_runtime_schema(&pool).await.unwrap();
        }
    }
    sqlx::query("ALTER TABLE referral_consultation_starts ALTER COLUMN detail DROP NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("ALTER TABLE referral_consultation_starts ALTER COLUMN detail SET NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE referral_consultation_starts ALTER COLUMN visit_id SET NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        require_runtime_schema(&pool).await.is_err(),
        "nullable no-visit identity remains supported"
    );
    sqlx::query("ALTER TABLE referral_consultation_starts ALTER COLUMN visit_id DROP NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    require_runtime_schema(&pool).await.unwrap();
}

#[tokio::test]
async fn consultation_guards_and_actual_index_keys_are_required() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    for (relation, trigger) in [
        (
            "referral_consultation_starts",
            "referral_consultation_start_scope",
        ),
        (
            "referral_consultation_starts",
            "referral_consultation_start_immutable",
        ),
        (
            "referral_consultation_starts",
            "referral_consultation_start_complete",
        ),
        (
            "referral_consultation_start_commands",
            "referral_consultation_command_immutable",
        ),
        (
            "referral_consultation_start_commands",
            "referral_consultation_command_complete",
        ),
        ("encounters", "encounter_care_identity"),
        ("admission_cases", "admission_encounter_binding"),
    ] {
        sqlx::query(&format!("ALTER TABLE {relation} DISABLE TRIGGER {trigger}"))
            .execute(&pool)
            .await
            .unwrap();
        assert!(require_runtime_schema(&pool).await.is_err());
        sqlx::query(&format!("ALTER TABLE {relation} ENABLE TRIGGER {trigger}"))
            .execute(&pool)
            .await
            .unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
    let index = "referral_consultation_patient_actor_idx";
    let original: String = sqlx::query_scalar("SELECT pg_get_indexdef($1::regclass)")
        .bind(index)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("DROP INDEX referral_consultation_patient_actor_idx")
        .execute(&pool)
        .await
        .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("CREATE INDEX referral_consultation_patient_actor_idx ON referral_consultation_starts(facility_id,patient_id)").execute(&pool).await.unwrap();
    assert!(
        require_runtime_schema(&pool).await.is_err(),
        "same-name incomplete actor keys are unsafe"
    );
    sqlx::query("DROP INDEX referral_consultation_patient_actor_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(&original).execute(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
}

#[tokio::test]
async fn organization_metadata_and_each_command_column_are_required() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202610170027)
        .unwrap()
        .checksum
        .as_ref();
    for statement in [
        "UPDATE _sqlx_migrations SET success=false WHERE version=202610170027",
        "UPDATE _sqlx_migrations SET success=true,checksum=decode('00','hex') WHERE version=202610170027",
        "UPDATE _sqlx_migrations SET success=true,version=209901010004 WHERE version=202610170027",
    ] {
        sqlx::query(statement).execute(&pool).await.unwrap();
        assert!(require_runtime_schema(&pool).await.is_err());
        sqlx::query("UPDATE _sqlx_migrations SET version=202610170027,success=true,checksum=$1 WHERE version IN(202610170027,209901010004)")
            .bind(checksum).execute(&pool).await.unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
    // Static table/column names only; never interpolate caller input into SQL.
    for (table, columns) in [
        ("organization_units", &["version"][..]),
        (
            "organization_unit_commands",
            &[
                "facility_id",
                "request_key_hash",
                "actor_user_id",
                "unit_id",
                "action",
                "payload_digest",
                "receipt",
                "recorded_at",
            ][..],
        ),
    ] {
        for column in columns {
            sqlx::query(&format!(
                "ALTER TABLE {table} RENAME COLUMN {column} TO hidden_runtime_column"
            ))
            .execute(&pool)
            .await
            .unwrap();
            assert!(
                require_runtime_schema(&pool).await.is_err(),
                "missing essential column refuses readiness"
            );
            sqlx::query(&format!(
                "ALTER TABLE {table} RENAME COLUMN hidden_runtime_column TO {column}"
            ))
            .execute(&pool)
            .await
            .unwrap();
            require_runtime_schema(&pool).await.unwrap();
        }
    }
    sqlx::query("ALTER TABLE organization_units ALTER COLUMN version DROP NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("ALTER TABLE organization_units ALTER COLUMN version SET NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE organization_units ALTER COLUMN version TYPE integer")
        .execute(&pool)
        .await
        .unwrap();
    assert!(require_runtime_schema(&pool).await.is_err());
    sqlx::query("ALTER TABLE organization_units ALTER COLUMN version TYPE bigint")
        .execute(&pool)
        .await
        .unwrap();
    require_runtime_schema(&pool).await.unwrap();
}

#[tokio::test]
async fn organization_reference_guards_and_lookup_indexes_cannot_be_name_only() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    for (table, guard) in [
        ("organization_units", "organization_unit_identity_lifecycle"),
        ("positions", "organization_position_unit_reference"),
        (
            "permission_assignments",
            "organization_permission_unit_reference",
        ),
        (
            "organization_unit_commands",
            "organization_unit_command_immutable",
        ),
    ] {
        sqlx::query(&format!("ALTER TABLE {table} DISABLE TRIGGER {guard}"))
            .execute(&pool)
            .await
            .unwrap();
        assert!(require_runtime_schema(&pool).await.is_err());
        sqlx::query(&format!("ALTER TABLE {table} ENABLE TRIGGER {guard}"))
            .execute(&pool)
            .await
            .unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
    for definition in [
        "(facility_id,scope_id) WHERE scope_type='organization_unit'",
        "(scope_id,facility_id) WHERE scope_type='facility'",
        "(scope_id,facility_id)",
    ] {
        sqlx::query("DROP INDEX organization_permission_scope_reference_idx")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(&format!("CREATE INDEX organization_permission_scope_reference_idx ON permission_assignments {definition}"))
            .execute(&pool).await.unwrap();
        assert!(
            require_runtime_schema(&pool).await.is_err(),
            "same index name cannot substitute different scope or keys"
        );
    }
    sqlx::query("DROP INDEX organization_permission_scope_reference_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE INDEX organization_permission_scope_reference_idx ON permission_assignments(scope_id,facility_id) WHERE scope_type='organization_unit'")
        .execute(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
}

#[tokio::test]
async fn location_metadata_and_each_required_column_refuse_incomplete_layouts() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|m| m.version == 202610170028)
        .unwrap()
        .checksum
        .as_ref();
    for statement in [
        "UPDATE _sqlx_migrations SET success=false WHERE version=202610170028",
        "UPDATE _sqlx_migrations SET success=true,checksum=decode('00','hex') WHERE version=202610170028",
        "UPDATE _sqlx_migrations SET success=true,version=209901010005 WHERE version=202610170028",
    ] {
        sqlx::query(statement).execute(&pool).await.unwrap();
        assert!(require_runtime_schema(&pool).await.is_err());
        sqlx::query("UPDATE _sqlx_migrations SET version=202610170028,success=true,checksum=$1 WHERE version IN(202610170028,209901010005)")
            .bind(checksum).execute(&pool).await.unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
    // Static reviewed names only; no caller input is interpolated into SQL.
    for (table, columns) in [
        ("storage_locations", &["version", "updated_at"][..]),
        (
            "storage_location_commands",
            &[
                "facility_id",
                "request_key_hash",
                "actor_user_id",
                "location_id",
                "action",
                "payload_digest",
                "receipt",
                "recorded_at",
            ][..],
        ),
    ] {
        for column in columns {
            sqlx::query(&format!(
                "ALTER TABLE {table} RENAME COLUMN {column} TO hidden_runtime_column"
            ))
            .execute(&pool)
            .await
            .unwrap();
            assert!(require_runtime_schema(&pool).await.is_err());
            sqlx::query(&format!(
                "ALTER TABLE {table} RENAME COLUMN hidden_runtime_column TO {column}"
            ))
            .execute(&pool)
            .await
            .unwrap();
            require_runtime_schema(&pool).await.unwrap();
        }
    }
    for (weaken, restore) in [
        (
            "ALTER TABLE storage_locations ALTER COLUMN version DROP NOT NULL",
            "ALTER TABLE storage_locations ALTER COLUMN version SET NOT NULL",
        ),
        (
            "ALTER TABLE storage_locations ALTER COLUMN version TYPE integer",
            "ALTER TABLE storage_locations ALTER COLUMN version TYPE bigint",
        ),
        (
            "ALTER TABLE storage_locations ALTER COLUMN updated_at DROP NOT NULL",
            "ALTER TABLE storage_locations ALTER COLUMN updated_at SET NOT NULL",
        ),
        (
            "ALTER TABLE storage_location_commands ALTER COLUMN receipt DROP NOT NULL",
            "ALTER TABLE storage_location_commands ALTER COLUMN receipt SET NOT NULL",
        ),
    ] {
        sqlx::query(weaken).execute(&pool).await.unwrap();
        assert!(require_runtime_schema(&pool).await.is_err());
        sqlx::query(restore).execute(&pool).await.unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
}

#[tokio::test]
async fn location_guards_reference_arguments_and_actual_index_keys_are_required() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    for (table, trigger) in [
        ("storage_locations", "storage_location_identity_lifecycle"),
        ("stock_batches", "storage_location_batch_reference"),
        ("stock_movements", "storage_location_movement_reference"),
        ("stock_transfers", "storage_location_transfer_reference"),
        (
            "stock_requisitions",
            "storage_location_requisition_reference",
        ),
        (
            "controlled_substance_register",
            "storage_location_controlled_reference",
        ),
        ("pharmacy_dispenses", "storage_location_dispense_reference"),
        (
            "inventory_standing_orders",
            "storage_location_standing_reference",
        ),
        ("stock_check_queue", "storage_location_check_reference"),
        (
            "pharmacy_fulfillments",
            "storage_location_fulfillment_reference",
        ),
        (
            "inventory_standing_order_templates",
            "storage_location_template_reference",
        ),
        (
            "storage_location_commands",
            "storage_location_command_immutable",
        ),
    ] {
        sqlx::query(&format!("ALTER TABLE {table} DISABLE TRIGGER {trigger}"))
            .execute(&pool)
            .await
            .unwrap();
        assert!(require_runtime_schema(&pool).await.is_err());
        sqlx::query(&format!("ALTER TABLE {table} ENABLE TRIGGER {trigger}"))
            .execute(&pool)
            .await
            .unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
    let original: String = sqlx::query_scalar("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='stock_transfers'::regclass AND tgname='storage_location_transfer_reference'").fetch_one(&pool).await.unwrap();
    sqlx::query("DROP TRIGGER storage_location_transfer_reference ON stock_transfers")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE TRIGGER storage_location_transfer_reference BEFORE INSERT OR UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION storage_location_operational_reference_guard('from_location_id')").execute(&pool).await.unwrap();
    assert!(
        require_runtime_schema(&pool).await.is_err(),
        "same guard name/function without destination proof is insufficient"
    );
    sqlx::query("DROP TRIGGER storage_location_transfer_reference ON stock_transfers")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(&original).execute(&pool).await.unwrap();
    require_runtime_schema(&pool).await.unwrap();
    for (index, table, wrong_keys) in [
        (
            "storage_location_administration_page_idx",
            "storage_locations",
            "id",
        ),
        (
            "storage_location_batch_location_id_reference_idx",
            "stock_batches",
            "id",
        ),
        (
            "storage_location_movement_location_id_reference_idx",
            "stock_movements",
            "id",
        ),
        (
            "storage_location_transfer_from_location_id_reference_idx",
            "stock_transfers",
            "id",
        ),
        (
            "storage_location_transfer_to_location_id_reference_idx",
            "stock_transfers",
            "id",
        ),
        (
            "storage_location_requisition_requesting_reference_idx",
            "stock_requisitions",
            "id",
        ),
        (
            "storage_location_requisition_fulfilling_reference_idx",
            "stock_requisitions",
            "id",
        ),
        (
            "storage_location_controlled_location_id_reference_idx",
            "controlled_substance_register",
            "id",
        ),
        (
            "storage_location_dispense_location_id_reference_idx",
            "pharmacy_dispenses",
            "id",
        ),
        (
            "storage_location_standing_requesting_location_id_reference_idx",
            "inventory_standing_orders",
            "id",
        ),
        (
            "storage_location_check_location_id_reference_idx",
            "stock_check_queue",
            "id",
        ),
        (
            "storage_location_fulfillment_dispensing_reference_idx",
            "pharmacy_fulfillments",
            "id",
        ),
        (
            "storage_location_template_requesting_location_id_reference_idx",
            "inventory_standing_order_templates",
            "id",
        ),
        (
            "storage_location_template_fulfilling_location_id_reference_idx",
            "inventory_standing_order_templates",
            "id",
        ),
        (
            "storage_location_commands_location_idx",
            "storage_location_commands",
            "location_id",
        ),
    ] {
        let definition: String = sqlx::query_scalar("SELECT pg_get_indexdef($1::regclass)")
            .bind(index)
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query(&format!("DROP INDEX {index}"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(&format!("CREATE INDEX {index} ON {table}({wrong_keys})"))
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            require_runtime_schema(&pool).await.is_err(),
            "same index name with incomplete lookup keys is insufficient"
        );
        sqlx::query(&format!("DROP INDEX {index}"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(&definition).execute(&pool).await.unwrap();
        require_runtime_schema(&pool).await.unwrap();
    }
}

#[path = "schema_compatibility/appointment_types.rs"]
mod appointment_types;

#[path = "schema_compatibility/inventory_items.rs"]
mod inventory_items;

#[tokio::test]
async fn category25_checksum_layout_intrinsic_guards_and_indexes_are_required() {
    let d = hms_db::test_support::TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|m| m.version == 202610310031)
        .unwrap()
        .checksum
        .as_ref();
    sqlx::query(
        "UPDATE _sqlx_migrations SET checksum=decode('00','hex') WHERE version=202610310031",
    )
    .execute(&p)
    .await
    .unwrap();
    assert!(require_runtime_schema(&p).await.is_err());
    sqlx::query("UPDATE _sqlx_migrations SET checksum=$1 WHERE version=202610310031")
        .bind(checksum)
        .execute(&p)
        .await
        .unwrap();
    for (table, guard) in [
        ("inventory_categories", "inventory_category_identity"),
        (
            "inventory_category_commands",
            "inventory_category_command_immutable",
        ),
        (
            "inventory_category_commands",
            "inventory_category_command_complete",
        ),
    ] {
        sqlx::query(&format!("ALTER TABLE {table} DISABLE TRIGGER {guard}"))
            .execute(&p)
            .await
            .unwrap();
        assert!(require_runtime_schema(&p).await.is_err());
        sqlx::query(&format!("ALTER TABLE {table} ENABLE TRIGGER {guard}"))
            .execute(&p)
            .await
            .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
    for index in [
        "inventory_category_administration_page_idx",
        "inventory_category_item_reference_idx",
        "inventory_category_child_reference_idx",
        "inventory_category_commands_history_idx",
        "inventory_category_search_idx",
        "inventory_category_audit_command_idx",
    ] {
        sqlx::query(&format!(
            "ALTER INDEX {index} RENAME TO synthetic_missing_category25_index"
        ))
        .execute(&p)
        .await
        .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "exact category index required"
        );
        sqlx::query(&format!(
            "ALTER INDEX synthetic_missing_category25_index RENAME TO {index}"
        ))
        .execute(&p)
        .await
        .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
}

#[tokio::test]
async fn category25_same_signature_noop_guard_body_is_not_a_valid_schema() {
    let d = hms_db::test_support::TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
    sqlx::query("CREATE OR REPLACE FUNCTION inventory_category_parent_proof(facility uuid,subject uuid,parent uuid,expected bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$").execute(&p).await.unwrap();
    assert!(
        require_runtime_schema(&p).await.is_err(),
        "matching function name and signature cannot hide changed guard semantics"
    );
}

#[tokio::test]
async fn category25_exact_version_one_default_is_required_before_runtime_startup() {
    let d = hms_db::test_support::TestDatabase::create().unwrap();
    let p = hms_db::connect(d.database_url()).await.unwrap();
    hms_db::migrate::run(&p).await.unwrap();
    require_runtime_schema(&p).await.unwrap();
    sqlx::query("ALTER TABLE inventory_categories ALTER COLUMN version SET DEFAULT 2")
        .execute(&p)
        .await
        .unwrap();
    assert!(
        require_runtime_schema(&p).await.is_err(),
        "a positive but incompatible create default must refuse startup"
    );
    sqlx::query("ALTER TABLE inventory_categories ALTER COLUMN version SET DEFAULT 1")
        .execute(&p)
        .await
        .unwrap();
    require_runtime_schema(&p).await.unwrap();
    for column in [
        "description",
        "parent_id",
        "catalog_changed_at",
        "created_by_user_id",
        "updated_by_user_id",
    ] {
        let value = match column {
            "description" => "'synthetic invented description'",
            "catalog_changed_at" => "clock_timestamp()",
            _ => "'00000000-0000-0000-0000-000000000001'::uuid",
        };
        sqlx::query(&format!(
            "ALTER TABLE inventory_categories ALTER COLUMN {column} SET DEFAULT {value}"
        ))
        .execute(&p)
        .await
        .unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "provisioning may not invent current metadata or historical actor provenance"
        );
        sqlx::query(&format!(
            "ALTER TABLE inventory_categories ALTER COLUMN {column} DROP DEFAULT"
        ))
        .execute(&p)
        .await
        .unwrap();
        require_runtime_schema(&p).await.unwrap();
    }

    let migration =
        include_str!("../../../migrations/202610310031_inventory_category_governance.sql");
    for (name, original, replacement) in [
        (
            "inventory_category_parent_proof",
            "DEFAULT NULL",
            "DEFAULT 2",
        ),
        (
            "inventory_category_text_valid",
            "DEFAULT false",
            "DEFAULT true",
        ),
    ] {
        let start = migration.find(&format!("CREATE FUNCTION {name}(")).unwrap();
        let end = start + migration[start..].find("$$;").unwrap() + 3;
        let exact =
            migration[start..end].replacen("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1);
        let wrong = exact.replacen(original, replacement, 1);
        assert_ne!(wrong, exact);
        sqlx::raw_sql(&wrong).execute(&p).await.unwrap();
        assert!(
            require_runtime_schema(&p).await.is_err(),
            "intrinsic omitted-argument defaults are part of the exact guard contract"
        );
        sqlx::raw_sql(&exact).execute(&p).await.unwrap();
        require_runtime_schema(&p).await.unwrap();
    }
}
