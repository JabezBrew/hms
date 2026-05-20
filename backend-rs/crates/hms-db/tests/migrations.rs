use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::deployment::DeploymentProfile;

#[tokio::test]
async fn migrations_apply_to_fresh_database_and_seed_baseline() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let patient_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM patients")
        .fetch_one(&pool)
        .await
        .expect("patient count query succeeds");
    let profile_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM deployment_profiles")
        .fetch_one(&pool)
        .await
        .expect("profile count query succeeds");
    let chronicle_count =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM patient_chronicle_read_models")
            .fetch_one(&pool)
            .await
            .expect("chronicle count query succeeds");

    assert!(profile_count >= 8);
    assert_eq!(patient_count, 2);
    assert_eq!(chronicle_count, 2);
}
