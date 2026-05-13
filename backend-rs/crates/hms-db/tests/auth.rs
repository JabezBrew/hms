use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::auth::UpdateAuthProfileRequest;
use hms_domain::deployment::DeploymentProfile;
use uuid::Uuid;

#[tokio::test]
async fn auth_profile_updates_are_user_and_facility_scoped() {
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

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");

    let updated = hms_db::auth::update_user_profile(
        &pool,
        facility_id,
        owner_id,
        UpdateAuthProfileRequest {
            display_name: Some("Updated Owner".to_owned()),
        },
    )
    .await
    .expect("profile update succeeds")
    .expect("user exists");

    assert_eq!(updated.display_name, "Updated Owner");
    assert!(hms_db::auth::update_user_profile(
        &pool,
        Uuid::new_v4(),
        owner_id,
        UpdateAuthProfileRequest {
            display_name: Some("Cross Facility".to_owned()),
        },
    )
    .await
    .expect("cross-facility profile update succeeds")
    .is_none());
}
