use chrono::{Duration, Utc};
use hms_db::{
    admin::{
        create_delegation, create_permission_assignment, NewDelegation, NewPermissionAssignment,
    },
    admin_access::{revoke_access_grant, RevokeGrant, RevokeGrantError},
    test_support::TestDb,
};
use hms_domain::{
    admin_access::{AccessGrantKind, LegacyPermissionReconciliation},
    deployment::PermissionCode,
};
use uuid::Uuid;

async fn recipient(db: &TestDb) -> Uuid {
    sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'")
        .bind(db.facility_id())
        .fetch_one(db.pool())
        .await
        .unwrap()
}
async fn assignment(
    db: &TestDb,
    user_id: Uuid,
    start: chrono::DateTime<Utc>,
    end: Option<chrono::DateTime<Utc>>,
) -> Uuid {
    create_permission_assignment(
        db.pool(),
        NewPermissionAssignment {
            facility_id: db.facility_id(),
            grantee_user_id: user_id,
            permission_code: PermissionCode::AdminAuthorityManage,
            scope_type: "facility".to_owned(),
            scope_id: None,
            granted_by_user_id: db.owner_user_id(),
            starts_at: start,
            ends_at: end,
            reason_code: "temporary_cover".to_owned(),
        },
        None,
    )
    .await
    .unwrap()
    .id
}
fn revoke(
    db: &TestDb,
    id: Uuid,
    kind: AccessGrantKind,
    reconciliation: Option<LegacyPermissionReconciliation>,
) -> RevokeGrant {
    RevokeGrant {
        facility_id: db.facility_id(),
        actor_user_id: db.owner_user_id(),
        id,
        kind,
        reconciliation,
        request_id: Some("access-lifecycle-test".to_owned()),
    }
}
async fn effective(db: &TestDb, user: Uuid) -> bool {
    hms_db::auth::user_by_id(db.pool(), user)
        .await
        .unwrap()
        .unwrap()
        .permissions
        .contains(&PermissionCode::AdminAuthorityManage)
}

#[tokio::test]
async fn new_managed_access_obeys_time_scope_and_revocation_without_copying_direct_rights() {
    let db = TestDb::hospital().await.unwrap();
    let user = recipient(&db).await;
    let future = assignment(&db, user, Utc::now() + Duration::hours(1), None).await;
    assert!(!effective(&db, user).await);
    let copied:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_permissions WHERE user_id=$1 AND permission_code='admin.authority.manage')").bind(user).fetch_one(db.pool()).await.unwrap();
    assert!(!copied);
    revoke_access_grant(
        db.pool(),
        revoke(&db, future, AccessGrantKind::PermissionAssignment, None),
    )
    .await
    .unwrap();
    let live = assignment(
        &db,
        user,
        Utc::now() - Duration::minutes(1),
        Some(Utc::now() + Duration::hours(1)),
    )
    .await;
    assert!(effective(&db, user).await);
    let first = revoke_access_grant(
        db.pool(),
        revoke(&db, live, AccessGrantKind::PermissionAssignment, None),
    )
    .await
    .unwrap();
    assert_eq!(first.effective_permission_remaining, Some(false));
    assert!(!first.independent_access_retained);
    assert!(!effective(&db, user).await);
    let before = hms_db::auth::user_by_id(db.pool(), user)
        .await
        .unwrap()
        .unwrap()
        .permission_version;
    let repeated = revoke_access_grant(
        db.pool(),
        revoke(&db, live, AccessGrantKind::PermissionAssignment, None),
    )
    .await
    .unwrap();
    assert_eq!(first.revoked_at, repeated.revoked_at);
    assert_eq!(
        before,
        hms_db::auth::user_by_id(db.pool(), user)
            .await
            .unwrap()
            .unwrap()
            .permission_version
    );
    let bad = create_permission_assignment(
        db.pool(),
        NewPermissionAssignment {
            facility_id: db.facility_id(),
            grantee_user_id: user,
            permission_code: PermissionCode::AdminAuthorityManage,
            scope_type: "organization_unit".into(),
            scope_id: Some(Uuid::new_v4()),
            granted_by_user_id: db.owner_user_id(),
            starts_at: Utc::now(),
            ends_at: None,
            reason_code: "cover".into(),
        },
        None,
    )
    .await;
    assert!(bad.is_err());
}

#[tokio::test]
async fn historical_copy_requires_decision_and_other_valid_managed_sources_survive() {
    let db = TestDb::hospital().await.unwrap();
    let user = recipient(&db).await;
    let id = assignment(&db, user, Utc::now() - Duration::minutes(1), None).await;
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code,origin) VALUES($1,'admin.authority.manage','legacy_unresolved')").bind(user).execute(db.pool()).await.unwrap();
    let version = hms_db::auth::user_by_id(db.pool(), user)
        .await
        .unwrap()
        .unwrap()
        .permission_version;
    assert!(matches!(
        revoke_access_grant(
            db.pool(),
            revoke(&db, id, AccessGrantKind::PermissionAssignment, None)
        )
        .await,
        Err(RevokeGrantError::ReconciliationRequired)
    ));
    assert_eq!(
        version,
        hms_db::auth::user_by_id(db.pool(), user)
            .await
            .unwrap()
            .unwrap()
            .permission_version
    );
    let delegation = create_delegation(
        db.pool(),
        NewDelegation {
            facility_id: db.facility_id(),
            actor_user_id: db.owner_user_id(),
            delegator_user_id: db.owner_user_id(),
            delegate_user_id: user,
            permission_code: PermissionCode::AdminAuthorityManage,
            starts_at: Utc::now() - Duration::minutes(1),
            ends_at: None,
            reason: "cover".into(),
        },
        None,
    )
    .await
    .unwrap();
    let result = revoke_access_grant(
        db.pool(),
        revoke(
            &db,
            id,
            AccessGrantKind::PermissionAssignment,
            Some(LegacyPermissionReconciliation::RemoveHistoricalCopy),
        ),
    )
    .await
    .unwrap();
    assert!(!result.independent_access_retained);
    assert_eq!(result.effective_permission_remaining, Some(true));
    assert!(effective(&db, user).await);
    let result = revoke_access_grant(
        db.pool(),
        revoke(&db, delegation.id, AccessGrantKind::Delegation, None),
    )
    .await
    .unwrap();
    assert_eq!(result.effective_permission_remaining, Some(false));
}

#[tokio::test]
async fn explicit_independent_access_is_preserved_and_concurrent_revoke_is_idempotent() {
    let db = TestDb::hospital().await.unwrap();
    let user = recipient(&db).await;
    let id = assignment(&db, user, Utc::now() - Duration::minutes(1), None).await;
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code,origin) VALUES($1,'admin.authority.manage','legacy_unresolved')").bind(user).execute(db.pool()).await.unwrap();
    let (a, b) = tokio::join!(
        revoke_access_grant(
            db.pool(),
            revoke(
                &db,
                id,
                AccessGrantKind::PermissionAssignment,
                Some(LegacyPermissionReconciliation::RetainIndependent)
            )
        ),
        revoke_access_grant(
            db.pool(),
            revoke(
                &db,
                id,
                AccessGrantKind::PermissionAssignment,
                Some(LegacyPermissionReconciliation::RetainIndependent)
            )
        )
    );
    let a = a.unwrap();
    let b = b.unwrap();
    assert_eq!(a.revoked_at, b.revoked_at);
    assert!(a.independent_access_retained);
    assert!(effective(&db, user).await);
    let audits:i64=sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE event_type='admin.access_grant.revoked' AND resource_id=$1").bind(id).fetch_one(db.pool()).await.unwrap();
    assert_eq!(audits, 1);
    let mut foreign = revoke(&db, id, AccessGrantKind::PermissionAssignment, None);
    foreign.facility_id = Uuid::new_v4();
    assert!(matches!(
        revoke_access_grant(db.pool(), foreign).await,
        Err(RevokeGrantError::NotFound)
    ));
}

#[tokio::test]
async fn failed_audit_rolls_back_reconciliation_grant_and_permission_version() {
    let db = TestDb::hospital().await.unwrap();
    let user = recipient(&db).await;
    let id = assignment(&db, user, Utc::now(), None).await;
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code,origin) VALUES($1,'admin.authority.manage','legacy_unresolved')").bind(user).execute(db.pool()).await.unwrap();
    let version = hms_db::auth::user_by_id(db.pool(), user)
        .await
        .unwrap()
        .unwrap()
        .permission_version;
    sqlx::raw_sql("CREATE FUNCTION fail_access_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admin.access_grant.revoked' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_access_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_access_audit();").execute(db.pool()).await.unwrap();
    assert!(revoke_access_grant(
        db.pool(),
        revoke(
            &db,
            id,
            AccessGrantKind::PermissionAssignment,
            Some(LegacyPermissionReconciliation::RemoveHistoricalCopy)
        )
    )
    .await
    .is_err());
    let row: (String, Option<chrono::DateTime<Utc>>) =
        sqlx::query_as("SELECT status,revoked_at FROM permission_assignments WHERE id=$1")
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(row, ("active".to_owned(), None));
    assert_eq!(
        version,
        hms_db::auth::user_by_id(db.pool(), user)
            .await
            .unwrap()
            .unwrap()
            .permission_version
    );
    let origin:String=sqlx::query_scalar("SELECT origin FROM user_permissions WHERE user_id=$1 AND permission_code='admin.authority.manage'").bind(user).fetch_one(db.pool()).await.unwrap();
    assert_eq!(origin, "legacy_unresolved");
}

#[tokio::test]
async fn scoped_permissions_and_appointments_keep_scope_and_history_when_revoked() {
    let db = TestDb::hospital().await.unwrap();
    let user = recipient(&db).await;
    let unit: Uuid = sqlx::query_scalar(
        "SELECT id FROM organization_units WHERE facility_id=$1 AND is_active=TRUE LIMIT 1",
    )
    .bind(db.facility_id())
    .fetch_one(db.pool())
    .await
    .unwrap();
    // This case tests scope and revocation, not a cross-clock activation boundary.
    // Derive an already-active start from the same clock used by the reader.
    let starts_at = sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
        "SELECT clock_timestamp() - interval '1 second'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    let scoped = create_permission_assignment(
        db.pool(),
        NewPermissionAssignment {
            facility_id: db.facility_id(),
            grantee_user_id: user,
            permission_code: PermissionCode::AdminAuthorityManage,
            scope_type: "organization_unit".into(),
            scope_id: Some(unit),
            granted_by_user_id: db.owner_user_id(),
            starts_at,
            ends_at: None,
            reason_code: "unit_cover".into(),
        },
        None,
    )
    .await
    .unwrap();
    assert!(!effective(&db, user).await);
    let authorities = hms_db::admin::active_authorities_for_user(db.pool(), db.facility_id(), user)
        .await
        .unwrap();
    assert!(authorities
        .iter()
        .any(|v| v.source_id == scoped.id && v.scope.scope_id == Some(unit)));
    revoke_access_grant(
        db.pool(),
        revoke(&db, scoped.id, AccessGrantKind::PermissionAssignment, None),
    )
    .await
    .unwrap();
    let appointment:(Uuid,Uuid,Option<chrono::DateTime<Utc>>)=sqlx::query_as("SELECT id,user_id,ends_at FROM authority_appointments WHERE facility_id=$1 AND status='active' LIMIT 1").bind(db.facility_id()).fetch_one(db.pool()).await.unwrap();
    let version = hms_db::auth::user_by_id(db.pool(), appointment.1)
        .await
        .unwrap()
        .unwrap()
        .permission_version;
    let result = revoke_access_grant(
        db.pool(),
        revoke(
            &db,
            appointment.0,
            AccessGrantKind::AuthorityAppointment,
            None,
        ),
    )
    .await
    .unwrap();
    assert_eq!(result.effective_permission_remaining, None);
    assert_eq!(
        hms_db::auth::user_by_id(db.pool(), appointment.1)
            .await
            .unwrap()
            .unwrap()
            .permission_version,
        version + 1
    );
    let end: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT ends_at FROM authority_appointments WHERE id=$1")
            .bind(appointment.0)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(end, appointment.2);
    assert!(!hms_db::admin::active_authorities_for_user(
        db.pool(),
        db.facility_id(),
        appointment.1
    )
    .await
    .unwrap()
    .iter()
    .any(|v| v.source_id == appointment.0));
}

#[tokio::test]
async fn concurrent_creation_and_revocation_preserve_the_new_managed_source_without_direct_copy() {
    let db = TestDb::hospital().await.unwrap();
    let user = recipient(&db).await;
    let id = assignment(&db, user, Utc::now() - Duration::minutes(1), None).await;
    let new = NewDelegation {
        facility_id: db.facility_id(),
        actor_user_id: db.owner_user_id(),
        delegator_user_id: db.owner_user_id(),
        delegate_user_id: user,
        permission_code: PermissionCode::AdminAuthorityManage,
        starts_at: Utc::now() - Duration::minutes(1),
        ends_at: None,
        reason: "replacement cover".into(),
    };
    let (ended, created) = tokio::join!(
        revoke_access_grant(
            db.pool(),
            revoke(&db, id, AccessGrantKind::PermissionAssignment, None)
        ),
        create_delegation(db.pool(), new, None)
    );
    assert!(ended.is_ok());
    let created = created.unwrap();
    assert!(effective(&db, user).await);
    let copied:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_permissions WHERE user_id=$1 AND permission_code='admin.authority.manage')").bind(user).fetch_one(db.pool()).await.unwrap();
    assert!(!copied);
    assert_eq!(
        revoke_access_grant(
            db.pool(),
            revoke(&db, created.id, AccessGrantKind::Delegation, None)
        )
        .await
        .unwrap()
        .effective_permission_remaining,
        Some(false)
    );
}

#[tokio::test]
async fn unresolved_copy_on_an_already_ended_historical_record_can_be_reconciled() {
    let db = TestDb::hospital().await.unwrap();
    let user = recipient(&db).await;
    let id = assignment(&db, user, Utc::now() - Duration::minutes(1), None).await;
    sqlx::query("UPDATE permission_assignments SET status='revoked' WHERE id=$1")
        .bind(id)
        .execute(db.pool())
        .await
        .unwrap();
    sqlx::query("INSERT INTO user_permissions(user_id,permission_code,origin) VALUES($1,'admin.authority.manage','legacy_unresolved')").bind(user).execute(db.pool()).await.unwrap();
    assert!(matches!(
        revoke_access_grant(
            db.pool(),
            revoke(&db, id, AccessGrantKind::PermissionAssignment, None)
        )
        .await,
        Err(RevokeGrantError::ReconciliationRequired)
    ));
    let result = revoke_access_grant(
        db.pool(),
        revoke(
            &db,
            id,
            AccessGrantKind::PermissionAssignment,
            Some(LegacyPermissionReconciliation::RemoveHistoricalCopy),
        ),
    )
    .await
    .unwrap();
    assert_eq!(result.effective_permission_remaining, Some(false));
    assert!(!effective(&db, user).await);
}

#[tokio::test]
async fn upgrade_classifies_ambiguous_existing_copies_without_removing_direct_access() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    for migration in hms_db::migrate::MIGRATOR
        .iter()
        .filter(|m| m.version < 202610150007)
    {
        sqlx::raw_sql(&migration.sql).execute(&pool).await.unwrap();
    }
    hms_db::provision::provision_baseline(
        &pool,
        &hms_db::provision::BaselineProvisioning::hms_local(
            hms_domain::deployment::DeploymentProfile::Hospital,
        ),
    )
    .await
    .unwrap();
    let facility = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .unwrap()
        .unwrap();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let limited: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    // Simulate the old ON CONFLICT copy: owner already held this permission,
    // whereas the limited user's row was inserted solely for a managed grant.
    for user in [owner, limited] {
        create_permission_assignment(
            &pool,
            NewPermissionAssignment {
                facility_id: facility,
                grantee_user_id: user,
                permission_code: PermissionCode::AdminAuthorityManage,
                scope_type: "facility".into(),
                scope_id: None,
                granted_by_user_id: owner,
                starts_at: Utc::now() - Duration::minutes(1),
                ends_at: None,
                reason_code: "historical_cover".into(),
            },
            None,
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO user_permissions(user_id,permission_code) VALUES($1,'admin.authority.manage') ON CONFLICT DO NOTHING").bind(user).execute(&pool).await.unwrap();
    }
    let migration = hms_db::migrate::MIGRATOR
        .iter()
        .find(|m| m.version == 202610150007)
        .unwrap();
    sqlx::raw_sql(&migration.sql).execute(&pool).await.unwrap();
    for user in [owner, limited] {
        let origin:String=sqlx::query_scalar("SELECT origin FROM user_permissions WHERE user_id=$1 AND permission_code='admin.authority.manage'").bind(user).fetch_one(&pool).await.unwrap();
        assert_eq!(origin, "legacy_unresolved");
        assert!(hms_db::auth::user_by_id(&pool, user)
            .await
            .unwrap()
            .unwrap()
            .permissions
            .contains(&PermissionCode::AdminAuthorityManage));
    }
    let untouched: String = sqlx::query_scalar(
        "SELECT origin FROM user_permissions WHERE user_id=$1 AND permission_code='auth.me.view'",
    )
    .bind(owner)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(untouched, "direct");
}

#[tokio::test]
async fn appointment_revocation_preserves_an_independent_live_facility_permission_assignment() {
    let db = TestDb::hospital().await.unwrap();
    let user = recipient(&db).await;
    let position: Uuid = sqlx::query_scalar(
        "SELECT id FROM positions WHERE facility_id=$1 AND status='active' LIMIT 1",
    )
    .bind(db.facility_id())
    .fetch_one(db.pool())
    .await
    .unwrap();
    let acting = hms_db::admin::create_authority_appointment(
        db.pool(),
        hms_db::admin::NewAuthorityAppointment {
            facility_id: db.facility_id(),
            position_id: position,
            user_id: user,
            appointed_by_user_id: db.owner_user_id(),
            appointment_type: "acting".into(),
            starts_at: Utc::now(),
            ends_at: None,
        },
        None,
    )
    .await
    .unwrap();
    assert!(!effective(&db, user).await);
    let independent = assignment(&db, user, Utc::now() - Duration::minutes(1), None).await;
    revoke_access_grant(
        db.pool(),
        revoke(&db, acting.id, AccessGrantKind::AuthorityAppointment, None),
    )
    .await
    .unwrap();
    assert!(effective(&db, user).await);
    revoke_access_grant(
        db.pool(),
        revoke(
            &db,
            independent,
            AccessGrantKind::PermissionAssignment,
            None,
        ),
    )
    .await
    .unwrap();
    assert!(!effective(&db, user).await);
}

#[tokio::test]
async fn revoking_a_new_grant_never_removes_a_known_independent_direct_permission() {
    let db = TestDb::hospital().await.unwrap();
    let user = db.owner_user_id();
    let id = assignment(&db, user, Utc::now() - Duration::minutes(1), None).await;
    let result = revoke_access_grant(
        db.pool(),
        revoke(&db, id, AccessGrantKind::PermissionAssignment, None),
    )
    .await
    .unwrap();
    assert!(result.independent_access_retained);
    assert_eq!(result.effective_permission_remaining, Some(true));
    assert!(effective(&db, user).await);
}
