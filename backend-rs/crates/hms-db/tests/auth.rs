use chrono::{Duration, Utc};
use hms_db::auth::NewRefreshSession;
use hms_db::provision::{provision_baseline, BaselineProvisioning};
use hms_domain::auth::{PatientDataVisibility, UpdateAuthProfileRequest};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
use uuid::Uuid;

async fn insert_test_refresh_session(
    pool: &hms_db::PgPool,
    user_id: Uuid,
    facility_id: Uuid,
) -> Uuid {
    let (session_version, permission_version) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT session_version, permission_version FROM users WHERE id = $1 AND facility_id = $2",
    )
    .bind(user_id)
    .bind(facility_id)
    .fetch_one(pool)
    .await
    .expect("user auth versions exist");
    let session_id = Uuid::new_v4();
    hms_db::auth::insert_refresh_session(
        pool,
        &NewRefreshSession {
            token_hash: format!("test-token-{session_id}"),
            session_id,
            session_family_id: session_id,
            rotated_from_session_id: None,
            user_id,
            facility_id,
            session_version,
            permission_version_at_issue: permission_version,
            csrf_token_hash: format!("test-csrf-{session_id}"),
            expires_at: Utc::now() + Duration::hours(1),
            device_label: Some("Auth contract".to_owned()),
        },
    )
    .await
    .expect("test refresh session inserts");
    session_id
}

#[tokio::test]
async fn request_context_facts_are_loaded_in_one_scoped_query() {
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
    let session_id = insert_test_refresh_session(&pool, owner_id, facility_id).await;

    let (facts, observed_queries) = hms_observability::with_request_query_counter(async {
        hms_db::auth::request_context_facts(
            &pool,
            owner_id,
            facility_id,
            session_id,
            DeploymentProfile::Hospital,
        )
        .await
    })
    .await;
    let facts = facts
        .expect("request context facts query succeeds")
        .expect("owner facts exist");

    assert_eq!(observed_queries, 1);
    assert_eq!(facts.user.id, owner_id);
    assert_eq!(facts.user.facility_id, facility_id);
    assert!(facts
        .user
        .permissions
        .contains(&PermissionCode::PatientDemographicsView));
    assert!(facts.user.features.contains(&FeatureKey::Patients));
    assert!(facts
        .user
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics));
    assert_eq!(facts.feature_flags.get(&FeatureKey::Patients), Some(&true));
    assert!(facts.active_authorities.iter().any(|authority| {
        authority.facility_id == facility_id
            && authority.permission_code == Some(PermissionCode::AdminAuthorityManage)
            && authority.scope.scope_type == "organization_unit"
            && authority.scope.scope_id.is_some()
    }));

    assert!(hms_db::auth::request_context_facts(
        &pool,
        owner_id,
        Uuid::new_v4(),
        session_id,
        DeploymentProfile::Hospital,
    )
    .await
    .expect("cross-facility request context query succeeds")
    .is_none());

    hms_db::auth::revoke_user_session(
        &pool,
        facility_id,
        owner_id,
        session_id,
        "contract_test_revoked",
    )
    .await
    .expect("session revokes");
    assert!(hms_db::auth::request_context_facts(
        &pool,
        owner_id,
        facility_id,
        session_id,
        DeploymentProfile::Hospital,
    )
    .await
    .expect("revoked-session request context query succeeds")
    .is_none());
}

#[tokio::test]
async fn auth_user_for_facility_is_single_query_and_scoped() {
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

    let (user, observed_queries) = hms_observability::with_request_query_counter(async {
        hms_db::auth::user_by_id_for_facility(&pool, owner_id, facility_id).await
    })
    .await;
    let user = user
        .expect("auth user query succeeds")
        .expect("owner user exists");

    assert_eq!(observed_queries, 1);
    assert_eq!(user.id, owner_id);
    assert_eq!(user.facility_id, facility_id);
    assert!(user
        .permissions
        .contains(&PermissionCode::PatientDemographicsView));

    assert!(
        hms_db::auth::user_by_id_for_facility(&pool, owner_id, Uuid::new_v4())
            .await
            .expect("cross-facility auth user query succeeds")
            .is_none()
    );

    let session_id = insert_test_refresh_session(&pool, owner_id, facility_id).await;
    let scoped_session_user =
        hms_db::auth::user_by_id_for_facility_session(&pool, owner_id, facility_id, session_id)
            .await
            .expect("session-scoped auth user query succeeds")
            .expect("session-scoped owner user exists");
    assert_eq!(scoped_session_user.id, owner_id);

    hms_db::auth::revoke_user_session(
        &pool,
        facility_id,
        owner_id,
        session_id,
        "contract_test_revoked",
    )
    .await
    .expect("session revokes");
    assert!(hms_db::auth::user_by_id_for_facility_session(
        &pool,
        owner_id,
        facility_id,
        session_id
    )
    .await
    .expect("revoked session auth user query succeeds")
    .is_none());
}

#[tokio::test]
async fn auth_versions_for_facility_are_single_query_and_scoped() {
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

    let (versions, observed_queries) = hms_observability::with_request_query_counter(async {
        hms_db::auth::user_auth_versions_for_facility(&pool, owner_id, facility_id).await
    })
    .await;
    let versions = versions
        .expect("auth versions query succeeds")
        .expect("owner versions exist");

    assert_eq!(observed_queries, 1);
    assert_eq!(versions.session_version, 1);
    assert_eq!(versions.permission_version, 1);
    assert_eq!(versions.active_profile, DeploymentProfile::Hospital);

    assert!(
        hms_db::auth::user_auth_versions_for_facility(&pool, owner_id, Uuid::new_v4())
            .await
            .expect("cross-facility auth versions query succeeds")
            .is_none()
    );
}

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

#[tokio::test]
async fn auth_password_changes_are_user_and_facility_scoped() {
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
    let old_hash = sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id = $1")
        .bind(owner_id)
        .fetch_one(&pool)
        .await
        .expect("old hash exists");

    let changed =
        hms_db::auth::change_user_password(&pool, facility_id, owner_id, "new-password-hash")
            .await
            .expect("password change succeeds")
            .expect("user exists");

    assert_eq!(changed.id, owner_id);
    assert_eq!(changed.password_hash, "new-password-hash");
    assert!(!changed.password_change_required);
    assert_eq!(changed.session_version, 2);
    let history_hashes = sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM password_history WHERE user_id = $1",
    )
    .bind(owner_id)
    .fetch_all(&pool)
    .await
    .expect("history hashes load");
    assert!(history_hashes.contains(&old_hash));

    assert!(hms_db::auth::change_user_password(
        &pool,
        Uuid::new_v4(),
        owner_id,
        "cross-facility-hash",
    )
    .await
    .expect("cross-facility password change succeeds")
    .is_none());
}

#[tokio::test]
async fn auth_sessions_are_listed_and_revoked_by_user_and_facility() {
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
    let current_session_id = Uuid::new_v4();
    let other_session_id = Uuid::new_v4();
    let expired_session_id = Uuid::new_v4();

    for (session_id, token_hash, device_label, expires_at) in [
        (
            current_session_id,
            "current-token",
            "Safari on macOS",
            Utc::now() + chrono::Duration::hours(1),
        ),
        (
            other_session_id,
            "other-token",
            "Chrome on Windows",
            Utc::now() + chrono::Duration::hours(1),
        ),
        (
            expired_session_id,
            "expired-token",
            "Old Browser",
            Utc::now() - chrono::Duration::hours(1),
        ),
    ] {
        hms_db::auth::insert_refresh_session(
            &pool,
            &NewRefreshSession {
                token_hash: token_hash.to_owned(),
                session_id,
                session_family_id: session_id,
                rotated_from_session_id: None,
                user_id: owner_id,
                facility_id,
                session_version: 1,
                permission_version_at_issue: 1,
                csrf_token_hash: format!("{token_hash}-csrf"),
                expires_at,
                device_label: Some(device_label.to_owned()),
            },
        )
        .await
        .expect("session inserts");
    }

    let sessions = hms_db::auth::list_active_user_sessions(
        &pool,
        facility_id,
        owner_id,
        current_session_id,
        20,
    )
    .await
    .expect("sessions list");
    assert_eq!(sessions.len(), 2);
    assert!(sessions.iter().any(|session| session.is_current));
    assert!(sessions
        .iter()
        .any(|session| session.device_label.as_deref() == Some("Chrome on Windows")));

    assert!(hms_db::auth::revoke_user_session(
        &pool,
        facility_id,
        owner_id,
        other_session_id,
        "user_revoked",
    )
    .await
    .expect("session revokes"));
    assert!(!hms_db::auth::revoke_user_session(
        &pool,
        Uuid::new_v4(),
        owner_id,
        current_session_id,
        "cross_facility",
    )
    .await
    .expect("cross-facility revoke checks"));

    let revoked_count = hms_db::auth::revoke_other_user_sessions(
        &pool,
        facility_id,
        owner_id,
        current_session_id,
        "user_revoked_others",
    )
    .await
    .expect("other sessions revoke");
    assert_eq!(revoked_count, 0);

    let current_session_still_active = hms_db::auth::list_active_user_sessions(
        &pool,
        facility_id,
        owner_id,
        current_session_id,
        20,
    )
    .await
    .expect("sessions list");
    assert_eq!(current_session_still_active.len(), 1);
    assert_eq!(current_session_still_active[0].id, current_session_id);
}

#[tokio::test]
async fn recovery_code_regeneration_invalidates_existing_unused_codes() {
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

    hms_db::auth::replace_recovery_codes(
        &pool,
        facility_id,
        owner_id,
        vec!["old-code-hash-a".to_owned(), "old-code-hash-b".to_owned()],
    )
    .await
    .expect("initial recovery codes insert");

    assert_eq!(
        hms_db::auth::recovery_codes_remaining(&pool, facility_id, owner_id)
            .await
            .expect("initial remaining count"),
        2
    );

    hms_db::auth::replace_recovery_codes(
        &pool,
        facility_id,
        owner_id,
        vec!["new-code-hash-a".to_owned()],
    )
    .await
    .expect("replacement recovery codes insert");

    assert_eq!(
        hms_db::auth::recovery_codes_remaining(&pool, facility_id, owner_id)
            .await
            .expect("replacement remaining count"),
        1
    );
    assert!(
        !hms_db::auth::consume_recovery_code(&pool, facility_id, owner_id, "old-code-hash-a")
            .await
            .expect("old code consume check")
    );
    assert!(
        hms_db::auth::consume_recovery_code(&pool, facility_id, owner_id, "new-code-hash-a")
            .await
            .expect("new code consume")
    );
    assert_eq!(
        hms_db::auth::recovery_codes_remaining(&pool, facility_id, owner_id)
            .await
            .expect("post-consume remaining count"),
        0
    );
}
