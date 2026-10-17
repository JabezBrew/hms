//! A new API runtime cannot bypass its required schema through auto-migrate=false.
use hms_api::{config::Config, state::AppState};
use std::borrow::Cow;
async fn refuses_before_provisioning_and_accepts_required_schema(before: i64) {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    let historical = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            hms_db::migrate::MIGRATOR
                .iter()
                .filter(|migration| migration.version < before)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    historical.run(&pool).await.unwrap();
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.auto_migrate = false;
    config.provision_baseline = true;
    let result = AppState::new(config.clone()).await;
    assert!(
        result.is_err(),
        "an old schema cannot start a new runtime by skipping migration"
    );
    let message = result.err().unwrap().to_string();
    assert_eq!(message, "required runtime schema is unavailable");
    let identities:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM facilities),(SELECT count(*) FROM users),(SELECT count(*) FROM audit_events)").fetch_one(&pool).await.unwrap();
    assert_eq!(
        identities,
        (0, 0, 0),
        "schema refusal precedes baseline provisioning"
    );
    hms_db::migrate::run(&pool).await.unwrap();
    AppState::new(config)
        .await
        .expect("required schema permits normal startup");
}

#[tokio::test]
async fn api_refuses_023_without_auto_migrate_before_provisioning() {
    refuses_before_provisioning_and_accepts_required_schema(202610170024).await;
}

#[tokio::test]
async fn api_refuses_024_without_auto_migrate_and_accepts_025() {
    refuses_before_provisioning_and_accepts_required_schema(202610170025).await;
}
