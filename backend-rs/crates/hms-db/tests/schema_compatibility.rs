//! Minimum runtime and rollback epochs are proven without migration/provisioning writes.
use hms_db::schema_compatibility::{committed_breaking_epoch, require_runtime_schema};
use std::borrow::Cow;

async fn historical(pool: &hms_db::PgPool) {
    let migrations = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < 202610170024)
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
async fn new_runtime_requires_referral_epoch_while_probe_preserves_historical_epoch() {
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
    historical(&pool).await;
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170023);
    assert!(require_runtime_schema(&pool).await.is_err());
    hms_db::migrate::run(&pool).await.unwrap();
    assert_eq!(committed_breaking_epoch(&pool).await.unwrap(), 202610170024);
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
