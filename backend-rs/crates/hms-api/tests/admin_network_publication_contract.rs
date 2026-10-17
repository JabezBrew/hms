//! Actual administration publication order; genuine factor/session fixtures.
mod support;
use hms_domain::network::{NetworkOffsiteMode, UpdateNetworkPolicyRequest};
use std::time::Duration;
use support::*;
use tokio::task::JoinHandle;

async fn call(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    input: Value,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(input.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
fn template(code: &str) -> Value {
    json!({"code":code,"title":"Synthetic bounded administration","description":"Synthetic reviewed publication","permission_codes":["auth.me.view"]})
}
async fn task<T>(pending: JoinHandle<T>) -> T {
    tokio::time::timeout(Duration::from_secs(8), pending)
        .await
        .expect("bounded participant completion")
        .expect("participant joins")
}
async fn waiters(pool: &hms_db::PgPool, blocker: i32, fragment: &str, count: usize) -> Vec<i32> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let rows: Vec<i32> = sqlx::query_scalar("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0")
                .bind(blocker).bind(fragment).fetch_all(pool).await.expect("private wait graph reads");
            if rows.len() >= count { return rows; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("actual intended source/audit wait is observed")
}
async fn published_behind(
    pool: &hms_db::PgPool,
    business_pid: i32,
    publisher: &JoinHandle<()>,
) -> bool {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,'facility_network_policies')>0)")
                .bind(business_pid).fetch_one(pool).await.expect("private policy wait graph reads");
            if waiting { return true; }
            if publisher.is_finished() { return false; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("bounded policy publication ordering")
}
async fn evidence(app: &TestApp, code: &str) -> (i64, i64) {
    sqlx::query_as("SELECT (SELECT count(*) FROM position_templates WHERE facility_id=$1 AND code=$2),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type='admin.position_template.created')")
        .bind(app.state().facility_id()).bind(code).fetch_one(&app.db_pool().await).await.expect("scoped administration evidence reads")
}
async fn deny(app: TestApp) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let current = hms_db::network::get_policy(&pool, facility)
        .await
        .expect("policy reads");
    let result = hms_db::network::update_policy(
        &pool,
        hms_db::network::NetworkPolicyActor {
            facility_id: facility,
            user_id: None,
            request_id: None,
            reauth_deadline: None,
            auth_versions: None,
            session_id: None,
            active_profile: None,
            resolved_policy_version: None,
        },
        UpdateNetworkPolicyRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: current.version,
            onsite_cidrs: vec!["192.0.2.254/32".into()],
            offsite_mode: NetworkOffsiteMode::Deny,
            reason: "Synthetic reviewed operator publication".into(),
        },
        None,
    )
    .await;
    assert!(result.is_ok(), "canonical operator publication succeeds");
}
async fn success(response: axum::response::Response, code: &str) {
    let status = response.status();
    let saved = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "typed code {}",
        saved["error"]["code"].as_str().unwrap_or("none")
    );
    assert!(saved["data"]["id"]
        .as_str()
        .and_then(|id| Uuid::parse_str(id).ok())
        .is_some());
    assert!(
        saved["data"]["code"] == code,
        "response is the exact saved local projection"
    );
}

#[tokio::test]
async fn administration_waiting_before_business_proof_rejects_winning_policy_without_effects() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let owner = access_claims(&token).sub;
    let code = "PUB-ACTOR-WAIT";
    let before = evidence(&app, code).await;
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
        .bind(owner)
        .execute(&mut *held)
        .await
        .unwrap();
    let copy = app.clone();
    let pending = tokio::spawn(async move {
        call(
            &copy,
            &token,
            Method::POST,
            "/api/v2/admin/position-templates",
            template(code),
        )
        .await
    });
    waiters(&pool, pid, "SELECT id FROM users WHERE facility_id=", 1).await;
    let publisher = tokio::spawn(deny(app.clone()));
    let mut publisher = publisher;
    let published = tokio::time::timeout(Duration::from_secs(5), &mut publisher).await;
    held.commit().await.unwrap();
    let response = task(pending).await;
    match published {
        Ok(done) => done.expect("operator joins"),
        Err(_) => {
            task(publisher).await;
            panic!("operator must publish before actor release")
        }
    }
    let status = response.status();
    let saved = json_body(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        saved["error"]["code"] == "network_policy_changed",
        "definite current policy denial"
    );
    assert!(saved.get("data").is_none_or(Value::is_null));
    assert_eq!(
        before,
        evidence(&app, code).await,
        "no administrative mutation/audit from stale policy"
    );
}

#[tokio::test]
async fn actual_business_source_wait_retains_policy_proof_until_saved_projection() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let code = "PUB-SOURCE-WAIT";
    let before = evidence(&app, code).await;
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("LOCK TABLE position_templates IN SHARE MODE")
        .execute(&mut *held)
        .await
        .unwrap();
    let copy = app.clone();
    let pending = tokio::spawn(async move {
        call(
            &copy,
            &token,
            Method::POST,
            "/api/v2/admin/position-templates",
            template(code),
        )
        .await
    });
    let business = waiters(&pool, pid, "INSERT INTO position_templates", 1).await[0];
    let publisher = tokio::spawn(deny(app.clone()));
    let waited = published_behind(&pool, business, &publisher).await;
    held.commit().await.unwrap();
    let response = task(pending).await;
    task(publisher).await;
    assert!(
        waited,
        "canonical publisher waits on the actual business policy proof"
    );
    success(response, code).await;
    let after = evidence(&app, code).await;
    assert_eq!(after, (before.0 + 1, before.1 + 1));
}

#[tokio::test]
async fn final_audit_and_return_projection_finish_before_proof_commit_without_pool_readback() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let code = "PUB-RETURN-TX";
    let before = evidence(&app, code).await;
    sqlx::raw_sql("CREATE FUNCTION hold_admin_publication_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admin.position_template.created' THEN PERFORM pg_advisory_xact_lock(7142026); END IF; RETURN NEW; END $$; CREATE TRIGGER hold_admin_publication_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION hold_admin_publication_audit();")
        .execute(&pool).await.unwrap();
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(7142026)")
        .execute(&mut *held)
        .await
        .unwrap();
    let copy = app.clone();
    let mut pending = tokio::spawn(async move {
        call(
            &copy,
            &token,
            Method::POST,
            "/api/v2/admin/position-templates",
            template(code),
        )
        .await
    });
    let business = waiters(&pool, pid, "INSERT INTO audit_events", 1).await[0];
    let (acquired_tx, acquired_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let locker_pool = pool.clone();
    let locker = tokio::spawn(async move {
        let mut parent = locker_pool.begin().await.unwrap();
        let parent_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *parent)
            .await
            .unwrap();
        sqlx::query("LOCK TABLE position_templates IN ACCESS EXCLUSIVE MODE")
            .execute(&mut *parent)
            .await
            .unwrap();
        let _ = acquired_tx.send(parent_pid);
        let _ = release_rx.await;
        parent.rollback().await.unwrap();
    });
    waiters(
        &pool,
        business,
        "LOCK TABLE position_templates IN ACCESS EXCLUSIVE MODE",
        1,
    )
    .await;
    let publisher = tokio::spawn(deny(app.clone()));
    let waited = published_behind(&pool, business, &publisher).await;
    held.commit().await.unwrap();
    let acquired = tokio::time::timeout(Duration::from_secs(5), acquired_rx)
        .await
        .ok()
        .and_then(Result::ok);
    let projected = if let Some(parent_pid) = acquired {
        Some(tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if pending.is_finished() {
                    return Some((&mut pending).await.expect("protected command joins"));
                }
                let unprotected: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,'FROM position_templates')>0)")
                    .bind(parent_pid).fetch_one(&pool).await.expect("private return-query graph reads");
                if unprotected { return None; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await)
    } else {
        None
    };
    // Release the independent table lock before asserting or joining any
    // participant. Old post-commit pool SELECT would be waiting on this lock.
    let _ = release_tx.send(());
    task(locker).await;
    task(publisher).await;
    assert!(
        acquired.is_some(),
        "competing parent lock is acquired only after business commit"
    );
    assert!(
        waited,
        "publisher remains behind proof through actual final audit"
    );
    let response = match projected {
        Some(Ok(Some(response))) => response,
        Some(Ok(None)) => {
            let _ = task(pending).await;
            panic!("actual post-commit pool SELECT is blocked outside the publication proof")
        }
        _ => {
            let _ = task(pending).await;
            panic!("no return/publication graph observed; timeout is a harness failure")
        }
    };
    success(response, code).await;
    let after = evidence(&app, code).await;
    assert_eq!(after, (before.0 + 1, before.1 + 1));
}

#[tokio::test]
async fn concurrent_authenticated_policy_publication_is_exclusive_cas_without_business_share_upgrade(
) {
    let app = app().await;
    let pool = app.db_pool().await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, limited, PermissionCode::AdminAuthorityManage).await;
    grant_test_feature(&app, limited, FeatureKey::Admin).await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let (other, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_ne!(access_claims(&owner).sub, access_claims(&other).sub);
    let initial = hms_db::network::get_policy(&pool, app.state().facility_id())
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION hold_authenticated_policy_commands() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_user_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(7142027); END IF; RETURN NEW; END $$; CREATE TRIGGER hold_authenticated_policy_commands BEFORE INSERT ON facility_network_policy_commands FOR EACH ROW EXECUTE FUNCTION hold_authenticated_policy_commands();")
        .execute(&pool).await.unwrap();
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(7142027)")
        .execute(&mut *held)
        .await
        .unwrap();
    let candidate = |mode: &str| json!({"client_request_id":Uuid::new_v4(),"expected_version":initial.version,"onsite_cidrs":["127.0.0.1/32","::1/128"],"offsite_mode":mode,"reason":"Synthetic concurrent authenticated publication"});
    let one = candidate("readonly");
    let two = candidate("fresh_reauth");
    let copy = app.clone();
    let a = tokio::spawn(async move {
        call(
            &copy,
            &owner,
            Method::PUT,
            "/api/v2/admin/network-policy",
            one,
        )
        .await
    });
    let copy = app.clone();
    let b = tokio::spawn(async move {
        call(
            &copy,
            &other,
            Method::PUT,
            "/api/v2/admin/network-policy",
            two,
        )
        .await
    });
    waiters(
        &pool,
        pid,
        "INSERT INTO facility_network_policy_commands",
        2,
    )
    .await;
    held.commit().await.unwrap();
    let first = task(a).await;
    let second = task(b).await;
    let mut statuses = vec![first.status().as_u16(), second.status().as_u16()];
    statuses.sort_unstable();
    assert_eq!(statuses, vec![200, 409]);
    for response in [first, second] {
        let status = response.status();
        let value = json_body(response).await;
        if status == StatusCode::CONFLICT {
            assert!(
                value["error"]["code"] == "network_policy_changed",
                "loser is definite CAS, never a deadlock/unconfirmed error"
            );
        }
    }
    let current = hms_db::network::get_policy(&pool, app.state().facility_id())
        .await
        .unwrap();
    assert_eq!(current.version, initial.version + 1);
}
