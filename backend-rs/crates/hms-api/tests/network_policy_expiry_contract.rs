//! A credential-confirmed policy write cannot outlive its managed authority.
mod support;

use hms_db::admin::{
    create_delegation, create_permission_assignment, NewDelegation, NewPermissionAssignment,
};
use support::*;

#[derive(Clone, Copy)]
enum ManagedGrant {
    PermissionAssignment,
    Delegation,
}

async fn policy_evidence(pool: &hms_db::PgPool, facility: Uuid) -> Value {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(\
            'version', p.version, 'ranges', p.onsite_cidrs::text[],\
            'mode', p.offsite_mode, 'updated_at', p.updated_at,\
            'versions', (SELECT count(*) FROM facility_network_policy_versions WHERE facility_id=$1),\
            'commands', (SELECT count(*) FROM facility_network_policy_commands WHERE facility_id=$1),\
            'audits', (SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type='network.policy.updated')\
         ) FROM facility_network_policies p WHERE p.facility_id=$1",
    )
    .bind(facility)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assert_authority_expiry_prevents_waiting_publication(kind: ManagedGrant) {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let recipient: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_feature(&app, recipient, FeatureKey::Admin).await;
    enroll_test_passkey(&app, recipient).await;
    let direct: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_permissions WHERE user_id=$1 AND permission_code='admin.authority.manage'",
    )
    .bind(recipient)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        direct, 0,
        "only the expiring managed grant can authorize this actor"
    );
    let expires_at: chrono::DateTime<Utc> =
        // The migrated application connection can carry the existing 5-second
        // PostgreSQL lock timeout. Exercise authority expiry before that bound.
        sqlx::query_scalar("SELECT clock_timestamp()+interval '4 seconds'")
            .fetch_one(&pool)
            .await
            .unwrap();
    match kind {
        ManagedGrant::PermissionAssignment => {
            create_permission_assignment(
                &pool,
                NewPermissionAssignment {
                    facility_id: facility,
                    grantee_user_id: recipient,
                    permission_code: PermissionCode::AdminAuthorityManage,
                    scope_type: "facility".into(),
                    scope_id: None,
                    granted_by_user_id: owner,
                    starts_at: expires_at - Duration::minutes(1),
                    ends_at: Some(expires_at),
                    reason_code: "temporary_network_cover".into(),
                },
                None,
            )
            .await
            .unwrap();
        }
        ManagedGrant::Delegation => {
            create_delegation(
                &pool,
                NewDelegation {
                    facility_id: facility,
                    actor_user_id: owner,
                    delegator_user_id: owner,
                    delegate_user_id: recipient,
                    permission_code: PermissionCode::AdminAuthorityManage,
                    starts_at: expires_at - Duration::minutes(1),
                    ends_at: Some(expires_at),
                    reason: "Synthetic temporary network cover".into(),
                },
                None,
            )
            .await
            .unwrap();
        }
    }
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let claims = access_claims(&token);
    let settings = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v2/admin/network-policy")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(settings.status(), StatusCode::OK);
    assert_eq!(json_body(settings).await["data"]["can_update"], true);
    let before = policy_evidence(&pool, facility).await;
    let mut blocker = pool.begin().await.unwrap();
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT version FROM facility_network_policies WHERE facility_id=$1 FOR UPDATE")
        .bind(facility)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let pending_app = app.clone();
    let request = Request::builder()
        .method(Method::PUT)
        .uri("/api/v2/admin/network-policy")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "client_request_id": Uuid::new_v4(),
                "expected_version": before["version"],
                "onsite_cidrs": ["127.0.0.1/32", "::1/128"],
                "offsite_mode": "fresh_reauth",
                "reason": "Synthetic expiry contention regression"
            })
            .to_string(),
        ))
        .unwrap();
    let pending = tokio::spawn(async move { pending_app.oneshot(request).await.unwrap() });
    // Observe the real production writer waiting, rather than merely sleeping
    // and accidentally testing a request that started after authority expiry.
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))",
            )
            .bind(blocker_pid)
            .fetch_one(&pool)
            .await
            .unwrap();
            if waiting {
                break;
            }
            assert!(!pending.is_finished(), "publication must reach the held policy lock");
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("policy publication waits on the held policy row");
    let remaining: i64 = sqlx::query_scalar(
        "SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp()))*1000))::bigint",
    )
    .bind(expires_at)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(remaining > 0, "the write began with live managed authority");
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 100)).await;
    blocker.commit().await.unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(3), pending)
        .await
        .expect("expired publication finishes after lock release")
        .unwrap();
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{}", body["error"]["code"]);
    assert_eq!(body["error"]["code"], "reauth_required");
    assert_eq!(policy_evidence(&pool, facility).await, before);
    let versions: (i64, i64) =
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(recipient)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        versions,
        (claims.session_version, claims.permission_version)
    );
    let effective: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM effective_user_permissions WHERE user_id=$1 AND permission_code='admin.authority.manage')",
    )
    .bind(recipient)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !effective,
        "authority expires without a version change or explicit revocation"
    );
}

#[tokio::test]
async fn policy_publication_cannot_outlive_a_managed_permission_while_waiting() {
    assert_authority_expiry_prevents_waiting_publication(ManagedGrant::PermissionAssignment).await;
}

#[tokio::test]
async fn policy_publication_cannot_outlive_a_delegation_while_waiting() {
    assert_authority_expiry_prevents_waiting_publication(ManagedGrant::Delegation).await;
}
