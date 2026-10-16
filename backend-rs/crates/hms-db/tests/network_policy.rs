use chrono::{Duration, Utc};
use hms_db::{network::*, test_support::TestDb};
use hms_domain::network::*;
use uuid::Uuid;

fn operator(db: &TestDb) -> NetworkPolicyActor {
    NetworkPolicyActor {
        facility_id: db.facility_id(),
        user_id: None,
        request_id: None,
        reauth_deadline: None,
        auth_versions: None,
        session_id: None,
        active_profile: None,
        resolved_policy_version: None,
    }
}
fn input(version: i64) -> UpdateNetworkPolicyRequest {
    UpdateNetworkPolicyRequest {
        client_request_id: Uuid::new_v4(),
        expected_version: version,
        onsite_cidrs: vec!["127.0.0.1/32".into(), "::1/128".into()],
        offsite_mode: NetworkOffsiteMode::Readonly,
        reason: "Synthetic network policy review".into(),
    }
}
async fn administrator(db: &TestDb) -> NetworkPolicyActor {
    let versions: (i64, i64) =
        sqlx::query_as("SELECT session_version,permission_version FROM users WHERE id=$1")
            .bind(db.owner_user_id())
            .fetch_one(db.pool())
            .await
            .unwrap();
    let session = Uuid::new_v4();
    let now = Utc::now();
    hms_db::auth::insert_refresh_session(
        db.pool(),
        &hms_db::auth::NewRefreshSession {
            token_hash: Uuid::new_v4().to_string(),
            session_id: session,
            session_family_id: session,
            rotated_from_session_id: None,
            user_id: db.owner_user_id(),
            facility_id: db.facility_id(),
            session_version: versions.0,
            permission_version_at_issue: versions.1,
            csrf_token_hash: "synthetic-hash".into(),
            expires_at: now + Duration::hours(1),
            session_started_at: now,
            idle_expires_at: now + Duration::minutes(30),
            absolute_expires_at: now + Duration::hours(1),
            device_label: None,
        },
    )
    .await
    .unwrap();
    NetworkPolicyActor {
        facility_id: db.facility_id(),
        user_id: Some(db.owner_user_id()),
        request_id: None,
        reauth_deadline: Some(now + Duration::minutes(15)),
        auth_versions: Some(versions),
        session_id: Some(session),
        active_profile: Some(hms_domain::deployment::DeploymentProfile::Hospital),
        resolved_policy_version: Some(
            get_policy(db.pool(), db.facility_id())
                .await
                .unwrap()
                .version,
        ),
    }
}

#[tokio::test]
async fn unconfigured_has_no_implicit_localhost_and_operator_snapshot_replays_immutably() {
    let db = TestDb::hospital().await.unwrap();
    let empty = get_policy(db.pool(), db.facility_id()).await.unwrap();
    assert!(!empty.configured);
    assert!(empty.onsite_cidrs.is_empty());
    let mut first = input(0);
    first.onsite_cidrs = vec!["192.0.2.23/24".into(), "192.0.2.0/24".into()];
    let saved = update_policy(db.pool(), operator(&db), first.clone(), None)
        .await
        .unwrap();
    assert_eq!(saved.policy.onsite_cidrs, vec!["192.0.2.0/24"]);
    let mut second = input(1);
    second.offsite_mode = NetworkOffsiteMode::Deny;
    update_policy(db.pool(), operator(&db), second, None)
        .await
        .unwrap();
    let replay = update_policy(db.pool(), operator(&db), first, None)
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.policy.version, 1);
    assert_eq!(replay.policy.offsite_mode, NetworkOffsiteMode::Readonly);
    assert_eq!(
        get_policy(db.pool(), db.facility_id())
            .await
            .unwrap()
            .version,
        2
    );
    let metadata: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT metadata FROM audit_events WHERE event_type='network.policy.updated'",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(metadata.len(), 2);
    assert!(metadata
        .iter()
        .all(|v| !v.to_string().contains("192.0.2") && !v.to_string().contains("Synthetic")));
}

#[tokio::test]
async fn concurrent_same_key_is_exact_once_and_changed_payload_conflicts() {
    let db = TestDb::hospital().await.unwrap();
    let request = input(0);
    let (a, b) = tokio::join!(
        update_policy(db.pool(), operator(&db), request.clone(), None),
        update_policy(db.pool(), operator(&db), request.clone(), None)
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_ne!(a.replayed, b.replayed);
    assert_eq!(a.policy.version, b.policy.version);
    let mut altered = request;
    altered.offsite_mode = NetworkOffsiteMode::Deny;
    assert_eq!(
        update_policy(db.pool(), operator(&db), altered, None)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&NetworkPolicyError::RequestConflict)
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM facility_network_policy_versions")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn concurrent_distinct_reviewed_versions_have_one_winner_without_orphan_commands() {
    let db = TestDb::hospital().await.unwrap();
    update_policy(db.pool(), operator(&db), input(0), None)
        .await
        .unwrap();
    let mut right = input(1);
    right.offsite_mode = NetworkOffsiteMode::Deny;
    let (a, b) = tokio::join!(
        update_policy(db.pool(), operator(&db), input(1), None),
        update_policy(db.pool(), operator(&db), right, None)
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(
        a.err().or(b.err()).unwrap().downcast_ref(),
        Some(&NetworkPolicyError::VersionChanged)
    );
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM facility_network_policy_versions),(SELECT count(*) FROM facility_network_policy_commands)").fetch_one(db.pool()).await.unwrap();
    assert_eq!(counts, (2, 2));
}

#[tokio::test]
async fn admin_cannot_remove_its_current_connection_or_use_stale_actor_proof() {
    let db = TestDb::hospital().await.unwrap();
    update_policy(db.pool(), operator(&db), input(0), None)
        .await
        .unwrap();
    let actor = administrator(&db).await;
    let mut denied = input(1);
    denied.onsite_cidrs = vec!["192.0.2.0/24".into()];
    assert_eq!(
        update_policy(
            db.pool(),
            actor.clone(),
            denied,
            Some("127.0.0.1".parse().unwrap())
        )
        .await
        .unwrap_err()
        .downcast_ref(),
        Some(&NetworkPolicyError::WouldLockOut)
    );
    sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
        .bind(db.owner_user_id())
        .execute(db.pool())
        .await
        .unwrap();
    assert_eq!(
        update_policy(
            db.pool(),
            actor,
            input(1),
            Some("127.0.0.1".parse().unwrap())
        )
        .await
        .unwrap_err()
        .downcast_ref(),
        Some(&NetworkPolicyError::InvalidActor)
    );
    assert_eq!(
        get_policy(db.pool(), db.facility_id())
            .await
            .unwrap()
            .version,
        1
    );
}

#[tokio::test]
async fn resolved_policy_fences_new_writes_but_preserves_the_original_admin_receipt() {
    let db = TestDb::hospital().await.unwrap();
    update_policy(db.pool(), operator(&db), input(0), None)
        .await
        .unwrap();
    let actor = administrator(&db).await;
    let request = input(1);
    let client = Some("127.0.0.1".parse().unwrap());
    let saved = update_policy(db.pool(), actor.clone(), request.clone(), client)
        .await
        .unwrap();
    update_policy(db.pool(), operator(&db), input(2), None)
        .await
        .unwrap();
    let replay = update_policy(db.pool(), actor.clone(), request, client)
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.policy.version, saved.policy.version);
    assert_eq!(
        update_policy(db.pool(), actor.clone(), input(3), client)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&NetworkPolicyError::VersionChanged)
    );
    let mut missing_proof = actor;
    missing_proof.resolved_policy_version = None;
    assert_eq!(
        update_policy(db.pool(), missing_proof, input(3), client)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&NetworkPolicyError::InvalidActor)
    );
    let counts: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM facility_network_policy_versions), \
         (SELECT count(*) FROM facility_network_policy_commands)",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(counts, (3, 3));
}

#[tokio::test]
async fn waiting_policy_update_cannot_publish_after_its_fresh_proof_deadline() {
    let db = TestDb::hospital().await.unwrap();
    update_policy(db.pool(), operator(&db), input(0), None)
        .await
        .unwrap();
    let mut actor = administrator(&db).await;
    actor.reauth_deadline = Some(Utc::now() + Duration::milliseconds(350));
    let mut held = db.pool().begin().await.unwrap();
    sqlx::query("SELECT 1 FROM facility_network_policies WHERE facility_id=$1 FOR UPDATE")
        .bind(db.facility_id())
        .execute(&mut *held)
        .await
        .unwrap();
    let pool = db.pool().clone();
    let task = tokio::spawn(async move {
        update_policy(&pool, actor, input(1), Some("127.0.0.1".parse().unwrap())).await
    });
    let mut blocked = false;
    for _ in 0..50 {
        blocked=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT version FROM facility_network_policies%')").fetch_one(db.pool()).await.unwrap();
        if blocked {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(blocked, "the real policy row must block the update");
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    held.commit().await.unwrap();
    assert_eq!(
        task.await.unwrap().unwrap_err().downcast_ref(),
        Some(&NetworkPolicyError::ReauthExpired)
    );
    assert_eq!(
        get_policy(db.pool(), db.facility_id())
            .await
            .unwrap()
            .version,
        1
    );
}

#[tokio::test]
async fn audit_failure_rolls_back_policy_history_and_key_then_exact_retry_can_succeed() {
    let db = TestDb::hospital().await.unwrap();
    let request = input(0);
    sqlx::raw_sql("CREATE FUNCTION fail_network_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='network.policy.updated' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_network_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_network_audit();").execute(db.pool()).await.unwrap();
    assert!(
        update_policy(db.pool(), operator(&db), request.clone(), None)
            .await
            .is_err()
    );
    assert!(
        !get_policy(db.pool(), db.facility_id())
            .await
            .unwrap()
            .configured
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM facility_network_policy_commands")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("DROP TRIGGER fail_network_audit ON audit_events")
        .execute(db.pool())
        .await
        .unwrap();
    update_policy(db.pool(), operator(&db), request, None)
        .await
        .unwrap();
}

#[tokio::test]
async fn foreign_actor_and_all_public_ranges_fail_without_creating_policy() {
    let db = TestDb::hospital().await.unwrap();
    let mut actor = operator(&db);
    actor.facility_id = Uuid::new_v4();
    assert_eq!(
        update_policy(db.pool(), actor, input(0), None)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&NetworkPolicyError::InvalidActor)
    );
    let mut request = input(0);
    request.onsite_cidrs = vec!["0.0.0.0/1".into(), "128.0.0.0/1".into()];
    assert_eq!(
        update_policy(db.pool(), operator(&db), request, None)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&NetworkPolicyError::InvalidPolicy)
    );
    assert!(
        !get_policy(db.pool(), db.facility_id())
            .await
            .unwrap()
            .configured
    );
}
