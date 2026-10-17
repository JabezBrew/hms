//! Cleanup bounds must include cascaded work and preserve durable evidence.
use hms_domain::deployment::DeploymentProfile;
use uuid::Uuid;

#[tokio::test]
async fn cleanup_batches_are_bounded_skip_locked_and_preserve_active_and_audit_records() {
    let database = hms_db::test_support::TestDatabase::create().unwrap();
    let pool = hms_db::connect(database.database_url()).await.unwrap();
    hms_db::migrate::run(&pool).await.unwrap();
    hms_db::provision::provision_baseline(
        &pool,
        &hms_db::provision::BaselineProvisioning::hms_local(DeploymentProfile::Hospital),
    )
    .await
    .unwrap();
    let facility = hms_db::facilities::facility_id_by_code(&pool, "HMS")
        .await
        .unwrap()
        .unwrap();
    let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let parent = Uuid::new_v4();
    sqlx::query("INSERT INTO auth_login_grants(id,token_hash,facility_id,user_id,session_version,permission_version,factor_version,active_profile,password_verified_at,state,created_at,expires_at) SELECT $1,'cleanup-expired-parent',$2,$3,session_version,permission_version,auth_factor_version,'hospital',clock_timestamp()-interval '3 days','factor',clock_timestamp()-interval '3 days',clock_timestamp()-interval '2 days' FROM users WHERE id=$3").bind(parent).bind(facility).bind(user).execute(&pool).await.unwrap();
    // One intentionally oversized imported graph: deleting one grant must not
    // cascade away all 137 children through a nominally ten-row batch.
    sqlx::query("INSERT INTO auth_factor_challenges(id,facility_id,user_id,purpose,login_grant_id,session_version,permission_version,factor_version,active_profile,state,created_at,expires_at) SELECT gen_random_uuid(),$1,$2,'login',$3,u.session_version,u.permission_version,u.auth_factor_version,'hospital','{}'::jsonb,clock_timestamp()-interval '3 days',clock_timestamp()-interval '2 days' FROM users u CROSS JOIN generate_series(1,137) n WHERE u.id=$2").bind(facility).bind(user).bind(parent).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO auth_login_grants(id,token_hash,facility_id,user_id,session_version,permission_version,factor_version,active_profile,password_verified_at,state,expires_at) SELECT gen_random_uuid(),'cleanup-active-parent',$1,$2,session_version,permission_version,auth_factor_version,'hospital',clock_timestamp(),'factor',clock_timestamp()+interval '5 minutes' FROM users WHERE id=$2").bind(facility).bind(user).execute(&pool).await.unwrap();
    let audit = Uuid::new_v4();
    sqlx::query("INSERT INTO audit_events(id,facility_id,actor_user_id,event_type,resource_type,metadata) VALUES($1,$2,$3,'auth.factor.synthetic.retained','auth_factor','{}'::jsonb)").bind(audit).bind(facility).bind(user).execute(&pool).await.unwrap();
    let mut held = pool.begin().await.unwrap();
    let retained: Uuid =
        sqlx::query_scalar("SELECT id FROM auth_factor_challenges ORDER BY id LIMIT 1 FOR UPDATE")
            .fetch_one(&mut *held)
            .await
            .unwrap();
    let removed = hms_db::auth::assurance::cleanup_ephemeral_auth(&pool, 10)
        .await
        .unwrap();
    assert_eq!(removed, 10);
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM auth_factor_challenges),(SELECT count(*) FROM auth_login_grants)").fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (127, 2));
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM auth_factor_challenges WHERE id=$1)")
            .bind(retained)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(exists);
    held.commit().await.unwrap();
    let mut total = removed;
    for _ in 0..20 {
        let removed = hms_db::auth::assurance::cleanup_ephemeral_auth(&pool, 10)
            .await
            .unwrap();
        assert!(
            removed <= 50,
            "no table can remove more than its ten-row allocation"
        );
        total += removed;
        if removed == 0 {
            break;
        }
    }
    assert_eq!(total, 138);
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM auth_factor_challenges),(SELECT count(*) FROM auth_login_grants),(SELECT count(*) FROM audit_events WHERE id=$1)").bind(audit).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (0, 1, 1));
}
