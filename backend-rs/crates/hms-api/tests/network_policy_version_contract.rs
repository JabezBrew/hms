//! Publication must bind to the policy the server authorized, not a guessed version.
mod support;

use axum::extract::ConnectInfo;
use hms_domain::network::*;
use support::*;

fn operator(facility: Uuid) -> hms_db::network::NetworkPolicyActor {
    hms_db::network::NetworkPolicyActor {
        facility_id: facility,
        user_id: None,
        request_id: None,
        reauth_deadline: None,
        auth_versions: None,
        session_id: None,
        active_profile: None,
        resolved_policy_version: None,
    }
}

fn policy_change(version: i64, mode: NetworkOffsiteMode) -> UpdateNetworkPolicyRequest {
    UpdateNetworkPolicyRequest {
        client_request_id: Uuid::new_v4(),
        expected_version: version,
        onsite_cidrs: vec!["127.0.0.1/32".into(), "::1/128".into()],
        offsite_mode: mode,
        reason: "Synthetic concurrent policy review".into(),
    }
}

#[tokio::test]
async fn guessed_future_version_cannot_undo_a_policy_that_denies_the_waiting_connection() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let initial = hms_db::network::get_policy(&pool, facility).await.unwrap();
    let allowed = hms_db::network::update_policy(
        &pool,
        operator(facility),
        policy_change(initial.version, NetworkOffsiteMode::FreshReauth),
        None,
    )
    .await
    .unwrap();
    enroll_owner_test_passkey(&app).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;

    // The production operator writer first locks and updates the row, then waits
    // before commit. MVCC readers still see the previous allowed policy.
    sqlx::raw_sql(
        "CREATE FUNCTION hold_network_policy_for_review() RETURNS trigger LANGUAGE plpgsql AS $$ \
         BEGIN PERFORM pg_advisory_xact_lock(615160012); RETURN NEW; END $$; \
         CREATE TRIGGER hold_network_policy_for_review AFTER UPDATE ON facility_network_policies \
         FOR EACH ROW EXECUTE FUNCTION hold_network_policy_for_review();",
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut blocker = pool.begin().await.unwrap();
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(615160012)")
        .execute(&mut *blocker)
        .await
        .unwrap();
    let operator_pool = pool.clone();
    let denied_version = allowed.policy.version + 1;
    let operator_write = tokio::spawn(async move {
        hms_db::network::update_policy(
            &operator_pool,
            operator(facility),
            policy_change(denied_version - 1, NetworkOffsiteMode::Deny),
            None,
        )
        .await
    });
    let operator_pid = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let waiting: Option<i32> = sqlx::query_scalar(
                "SELECT pid FROM pg_stat_activity WHERE datname=current_database() \
                 AND $1=ANY(pg_blocking_pids(pid)) LIMIT 1",
            )
            .bind(blocker_pid)
            .fetch_optional(&pool)
            .await
            .unwrap();
            if let Some(pid) = waiting {
                break pid;
            }
            assert!(!operator_write.is_finished());
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("operator publication reaches its held commit point");

    // The caller deliberately supplies the next version, which the server has
    // not observed yet, and a candidate which would promote itself to onsite.
    let request = json!({
        "client_request_id": Uuid::new_v4(),
        "expected_version": denied_version,
        "onsite_cidrs": ["127.0.0.1/32", "::1/128", "192.0.2.23/32"],
        "offsite_mode": "fresh_reauth",
        "reason": "Synthetic queued publication"
    });
    let mut request = Request::builder()
        .method(Method::PUT)
        .uri("/api/v2/admin/network-policy")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(request.to_string()))
        .unwrap();
    request.extensions_mut().insert(ConnectInfo(
        "192.0.2.23:44000".parse::<std::net::SocketAddr>().unwrap(),
    ));
    let pending_app = app.clone();
    let pending = tokio::spawn(async move { pending_app.oneshot(request).await.unwrap() });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() \
                 AND $1=ANY(pg_blocking_pids(pid)))",
            )
            .bind(operator_pid)
            .fetch_one(&pool)
            .await
            .unwrap();
            if waiting {
                break;
            }
            assert!(
                !pending.is_finished(),
                "HTTP publication must wait on the policy writer"
            );
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("HTTP publication passed its original allowed policy and waits on the newer writer");

    blocker.commit().await.unwrap();
    let operator_receipt = operator_write.await.unwrap().unwrap();
    assert_eq!(operator_receipt.policy.version, denied_version);
    let response = pending.await.unwrap();
    let status = response.status();
    let body = json_body(response).await;
    let current = hms_db::network::get_policy(&pool, facility).await.unwrap();
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "operator_version={}, final_version={}, denied_policy_preserved={}",
        denied_version,
        current.version,
        current.offsite_mode == NetworkOffsiteMode::Deny
    );
    assert_eq!(body["error"]["code"], "network_policy_changed");
    assert_eq!(current.version, denied_version);
    assert_eq!(current.offsite_mode, NetworkOffsiteMode::Deny);
    assert_eq!(current.onsite_cidrs.len(), 2);
}
