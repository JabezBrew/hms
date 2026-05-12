use chrono::Utc;
use hms_db::provision::BaselineProvisioning;
use hms_db::referrals::{NewClinicWaitlistEntry, NewReferral};
use hms_domain::deployment::DeploymentProfile;
use hms_domain::referrals::{ClinicWaitlistStatus, ReferralPriority, ReferralStatus};

#[tokio::test]
async fn referrals_sla_and_waitlist_are_facility_scoped() {
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

    let sla_due_at = Utc::now() + chrono::Duration::hours(24);
    let referral = hms_db::referrals::create_referral(
        &pool,
        NewReferral {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            to_service: "Medicine".to_owned(),
            priority: ReferralPriority::Urgent,
            reason: Some("Medical review".to_owned()),
            sla_due_at,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("referral create succeeds");
    assert_eq!(referral.status, ReferralStatus::Sent);
    assert_eq!(referral.reason.as_deref(), Some("Medical review"));
    assert_eq!(referral.sla_due_at, sla_due_at);

    let accepted = hms_db::referrals::accept_referral(
        &pool,
        facility_id,
        referral.id,
        owner_id,
        Some("Accepted for same-day review".to_owned()),
    )
    .await
    .expect("referral accept query succeeds")
    .expect("referral exists");
    assert_eq!(accepted.status, ReferralStatus::Accepted);
    assert_eq!(
        accepted.acceptance_notes.as_deref(),
        Some("Accepted for same-day review")
    );

    let completed = hms_db::referrals::complete_referral(
        &pool,
        facility_id,
        referral.id,
        "Specialist review completed".to_owned(),
        Some("Continue current treatment".to_owned()),
    )
    .await
    .expect("referral complete query succeeds")
    .expect("referral exists");
    assert_eq!(completed.status, ReferralStatus::Completed);
    assert_eq!(
        completed.specialist_notes.as_deref(),
        Some("Specialist review completed")
    );
    assert_eq!(
        completed.recommendations.as_deref(),
        Some("Continue current treatment")
    );

    let decline_referral = hms_db::referrals::create_referral(
        &pool,
        NewReferral {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            to_service: "Surgery".to_owned(),
            priority: ReferralPriority::Routine,
            reason: Some("Surgical review".to_owned()),
            sla_due_at: Utc::now() + chrono::Duration::hours(72),
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("decline referral create succeeds");
    let declined = hms_db::referrals::decline_referral(
        &pool,
        facility_id,
        decline_referral.id,
        "Needs orthopedics instead".to_owned(),
    )
    .await
    .expect("referral decline query succeeds")
    .expect("referral exists");
    assert_eq!(declined.status, ReferralStatus::Declined);
    assert_eq!(
        declined.decline_reason.as_deref(),
        Some("Needs orthopedics instead")
    );

    let waitlist_entry = hms_db::referrals::create_clinic_waitlist_entry(
        &pool,
        NewClinicWaitlistEntry {
            id: uuid::Uuid::new_v4(),
            facility_id,
            patient_id,
            service: "Medicine".to_owned(),
            priority: ReferralPriority::Urgent,
            created_by_user_id: owner_id,
        },
    )
    .await
    .expect("waitlist create succeeds");
    assert_eq!(waitlist_entry.status, ClinicWaitlistStatus::Waiting);

    let offered = hms_db::referrals::offer_next_clinic_waitlist_entry(
        &pool,
        facility_id,
        "Medicine",
        owner_id,
    )
    .await
    .expect("offer next query succeeds")
    .expect("waitlist entry exists");
    assert_eq!(offered.id, waitlist_entry.id);
    assert_eq!(offered.status, ClinicWaitlistStatus::Offered);

    let other_facility = uuid::Uuid::new_v4();
    assert!(
        hms_db::referrals::list_referrals(&pool, other_facility, None, 25)
            .await
            .expect("cross-facility referrals list succeeds")
            .is_empty()
    );
    assert!(
        hms_db::referrals::list_clinic_waitlist_entries(&pool, other_facility, None, 25)
            .await
            .expect("cross-facility waitlist list succeeds")
            .is_empty()
    );
}
