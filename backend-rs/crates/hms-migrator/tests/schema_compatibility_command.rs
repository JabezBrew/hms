use std::{
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};

fn probe(url: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_hms-migrator"))
        .arg("schema-compatibility")
        .env("HMS_DATABASE_URL", url)
        .env("HMS_DATABASE_MAX_CONNECTIONS", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let started = Instant::now();
    while child.try_wait().unwrap().is_none() {
        if started.elapsed() > Duration::from_secs(12) {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("schema compatibility command exceeded its bounded deadline");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    child.wait_with_output().unwrap()
}

#[tokio::test]
async fn actual_binary_reports_only_committed_epoch_without_provisioning_or_writes() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let initial = probe(database.database_url());
    assert!(initial.status.success());
    assert_eq!(initial.stdout, b"0\n");
    assert!(initial.stderr.is_empty());
    let tables: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        tables, 0,
        "the read-only command does not migrate or provision"
    );
    hms_db::migrate::run(&pool).await.unwrap();
    let after = probe(database.database_url());
    assert!(after.status.success());
    assert_eq!(after.stdout, b"202610170028\n");
    assert!(after.stderr.is_empty());
    let identities: (i64, i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(identities, (0, 0, 0));
}

#[tokio::test]
async fn actual_binary_refuses_failed_or_incoherent_migration_evidence() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET success=false WHERE version=202610170024")
        .execute(&pool)
        .await
        .unwrap();
    let outcome = probe(database.database_url());
    assert!(!outcome.status.success());
    assert!(outcome.stdout.is_empty());
    assert_eq!(
        String::from_utf8(outcome.stderr).unwrap().trim(),
        "Error: Database schema compatibility could not be confirmed."
    );
}

#[tokio::test]
async fn actual_binary_times_out_metadata_lock_and_never_prints_database_identity() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    let mut held = pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE _sqlx_migrations IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *held)
        .await
        .unwrap();
    let started = Instant::now();
    let outcome = probe(database.database_url());
    assert!(!outcome.status.success());
    assert!(started.elapsed() < Duration::from_secs(8));
    assert!(outcome.stdout.is_empty());
    assert_eq!(
        String::from_utf8(outcome.stderr).unwrap().trim(),
        "Error: Database schema compatibility could not be confirmed."
    );
    held.rollback().await.unwrap();
    let invalid =
        probe("postgres://synthetic:PRIVATE_SENTINEL@127.0.0.1:1/PRIVATE_DATABASE_SENTINEL");
    assert!(!invalid.status.success());
    assert!(invalid.stdout.is_empty());
    let diagnostic = String::from_utf8(invalid.stderr).unwrap();
    assert!(!diagnostic.contains("PRIVATE_") && !diagnostic.contains("127.0.0.1"));
}

#[tokio::test]
async fn actual_binary_cannot_report_an_old_epoch_while_sqlx_migration_is_running() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let mut migrator = pool.acquire().await.unwrap();
    migrator.close_on_drop();
    sqlx::migrate::Migrate::lock(&mut *migrator).await.unwrap();
    let started = Instant::now();
    let outcome = probe(database.database_url());
    assert!(!outcome.status.success());
    assert!(outcome.stdout.is_empty());
    assert!(started.elapsed() < Duration::from_secs(8));
    sqlx::migrate::Migrate::unlock(&mut *migrator)
        .await
        .unwrap();
    let after = probe(database.database_url());
    assert!(after.status.success());
    assert_eq!(after.stdout, b"0\n");
}

#[tokio::test]
async fn actual_binary_distinguishes_historical_schema_from_false_referral_migration_claim() {
    use std::borrow::Cow;
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < 202610170024)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let before = probe(database.database_url());
    assert!(before.status.success());
    assert_eq!(before.stdout, b"202610170023\n");
    assert!(before.stderr.is_empty());
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202610170024)
        .expect("required referral migration is packaged")
        .checksum
        .as_ref();
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(202610170024,'Synthetic unconfirmed layout',true,$1,0)").bind(checksum).execute(&pool).await.unwrap();
    let false_claim = probe(database.database_url());
    assert!(!false_claim.status.success());
    assert!(false_claim.stdout.is_empty());
    assert_eq!(
        String::from_utf8(false_claim.stderr).unwrap().trim(),
        "Error: Database schema compatibility could not be confirmed."
    );
    let identities:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)").fetch_one(&pool).await.unwrap();
    assert_eq!(identities, (0, 0, 0));
}

#[tokio::test]
async fn actual_binary_distinguishes_024_from_false_placement_migration_claim() {
    use std::borrow::Cow;
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < 202610170025)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let before = probe(database.database_url());
    assert!(before.status.success());
    assert_eq!(before.stdout, b"202610170024\n");
    assert!(before.stderr.is_empty());
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202610170025)
        .expect("required placement migration is packaged")
        .checksum
        .as_ref();
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(202610170025,'Synthetic unconfirmed placement layout',true,$1,0)")
        .bind(checksum).execute(&pool).await.unwrap();
    let false_claim = probe(database.database_url());
    assert!(!false_claim.status.success());
    assert!(false_claim.stdout.is_empty());
    assert_eq!(
        String::from_utf8(false_claim.stderr).unwrap().trim(),
        "Error: Database schema compatibility could not be confirmed."
    );
    let identities: (i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(identities, (0, 0, 0));
}

#[tokio::test]
async fn actual_binary_distinguishes_025_from_false_consultation_migration_claim() {
    use std::borrow::Cow;
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < 202610170026)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let before = probe(database.database_url());
    assert!(before.status.success());
    assert_eq!(before.stdout, b"202610170025\n");
    assert!(before.stderr.is_empty());
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202610170026)
        .expect("required consultation migration is packaged")
        .checksum
        .as_ref();
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(202610170026,'Synthetic unconfirmed consultation layout',true,$1,0)")
        .bind(checksum).execute(&pool).await.unwrap();
    let false_claim = probe(database.database_url());
    assert!(!false_claim.status.success());
    assert!(false_claim.stdout.is_empty());
    assert_eq!(
        String::from_utf8(false_claim.stderr).unwrap().trim(),
        "Error: Database schema compatibility could not be confirmed."
    );
    let identities: (i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(identities, (0, 0, 0));
}

#[tokio::test]
async fn actual_binary_distinguishes_026_from_false_organization_migration_claim() {
    use std::borrow::Cow;
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < 202610170027)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let before = probe(database.database_url());
    assert!(before.status.success());
    assert_eq!(before.stdout, b"202610170026\n");
    assert!(before.stderr.is_empty());
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|migration| migration.version == 202610170027)
        .expect("required organization migration is packaged")
        .checksum
        .as_ref();
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(202610170027,'Synthetic unconfirmed organization layout',true,$1,0)")
        .bind(checksum).execute(&pool).await.unwrap();
    let false_claim = probe(database.database_url());
    assert!(!false_claim.status.success());
    assert!(false_claim.stdout.is_empty());
    assert_eq!(
        String::from_utf8(false_claim.stderr).unwrap().trim(),
        "Error: Database schema compatibility could not be confirmed."
    );
    let identities: (i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(identities, (0, 0, 0));
}

#[tokio::test]
async fn actual_binary_distinguishes_027_from_false_location_migration_claim() {
    use std::borrow::Cow;
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|m| m.version < 202610170028)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let before = probe(database.database_url());
    assert!(before.status.success());
    assert_eq!(before.stdout, b"202610170027\n");
    assert!(before.stderr.is_empty());
    let checksum = hms_db::migrate::MIGRATOR
        .iter()
        .find(|m| m.version == 202610170028)
        .unwrap()
        .checksum
        .as_ref();
    sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(202610170028,'Synthetic unconfirmed location layout',true,$1,0)").bind(checksum).execute(&pool).await.unwrap();
    let outcome = probe(database.database_url());
    assert!(!outcome.status.success());
    assert!(outcome.stdout.is_empty());
    assert_eq!(
        String::from_utf8(outcome.stderr).unwrap().trim(),
        "Error: Database schema compatibility could not be confirmed."
    );
    let identities: (i64,i64,i64) = sqlx::query_as("SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)").fetch_one(&pool).await.unwrap();
    assert_eq!(identities, (0, 0, 0));
}
