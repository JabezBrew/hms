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
async fn new_runtime_requires_consultation_epoch_while_probe_preserves_historical_epochs() {
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
    hms_db::migrate::run(&pool).await.unwrap();
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170026);
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
