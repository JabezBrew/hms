use chrono::Utc;
use hms_db::consent::NewConsentGrant;
use hms_db::provision::BaselineProvisioning;
use hms_domain::consent::{ConsentGrantStatus, ConsentScope};
use hms_domain::deployment::DeploymentProfile;

#[tokio::test]
async fn consent_grants_are_patient_and_facility_scoped() {
    let database =
        hms_db::test_support::TestDatabase::create().expect("test database is available");
    let pool = hms_db::connect(database.database_url())
        .await
        .expect("database connects");

    hms_db::migrate::run(&pool).await.expect("migrations apply");
    hms_db::provision::provision_baseline(
        &pool,
        &BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .expect("baseline provisions");

    let facility_id = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .expect("facility query succeeds")
        .expect("facility exists");
    let owner_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM users WHERE facility_id = $1 AND email = 'owner@hms.local'",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("owner exists");
    let patient_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM patients WHERE facility_id = $1 ORDER BY created_at, id LIMIT 1",
    )
    .bind(facility_id)
    .fetch_one(&pool)
    .await
    .expect("patient exists");

    let expires_at = Utc::now() + chrono::Duration::days(30);
    let grant = hms_db::consent::create_consent_grant(
        &pool,
        NewConsentGrant {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            scope: ConsentScope::ReferralCoordination,
            purpose: "Specialist referral coordination".to_owned(),
            expires_at: Some(expires_at),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("consent grant create succeeds");
    assert_eq!(grant.status, ConsentGrantStatus::Active);
    assert_eq!(grant.expires_at, Some(expires_at));

    let revoked = hms_db::consent::revoke_consent_grant(&pool, facility_id, grant.id, owner_id)
        .await
        .expect("consent revoke query succeeds")
        .expect("grant exists");
    assert_eq!(revoked.status, ConsentGrantStatus::Revoked);
    assert!(revoked.revoked_at.is_some());

    let other_facility = uuid::Uuid::new_v4();
    assert!(
        hms_db::consent::list_consent_grants(&pool, other_facility, None, 25)
            .await
            .expect("cross-facility consent list succeeds")
            .is_empty()
    );
}
