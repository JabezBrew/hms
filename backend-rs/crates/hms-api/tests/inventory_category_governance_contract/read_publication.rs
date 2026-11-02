//! Real HTTP requests and observed PostgreSQL blocking edges, never timing guesses.
use super::*;
use chrono::{DateTime, Utc};
use std::time::Duration;
use tokio::task::JoinHandle;

const PRIVATE: &str = "S25_PRIVATE_PUBLICATION_DESCRIPTION";
type PendingRead = JoinHandle<(StatusCode, Value)>;

fn paths(id: &str) -> [String; 3] {
    [
        "/api/v2/inventory/category-administration".into(),
        format!("/api/v2/inventory/categories/{id}/administration"),
        format!("/api/v2/inventory/categories/{id}/history"),
    ]
}
async fn category(app: &TestApp, token: &str) -> Value {
    let mut body = input("S25_READ_PUBLICATION");
    body["description"] = json!(PRIVATE);
    create_category(app, token, body).await
}
fn reads(app: &TestApp, token: &str, paths: &[String]) -> Vec<PendingRead> {
    paths
        .iter()
        .map(|path| {
            let app = app.clone();
            let token = token.to_owned();
            let path = path.clone();
            tokio::spawn(async move { request(&app, &token, Method::GET, &path, None).await })
        })
        .collect()
}
async fn waiters<T>(
    pool: &hms_db::PgPool,
    blocker: i32,
    fragment: &str,
    pending: &[JoinHandle<T>],
) -> Vec<i32> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let waiting: Vec<i32> = sqlx::query_scalar(
                "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0 ORDER BY pid",
            )
            .bind(blocker)
            .bind(fragment)
            .fetch_all(pool)
            .await
            .unwrap();
            if waiting.len() >= pending.len() {
                return waiting;
            }
            assert!(
                pending.iter().all(|task| !task.is_finished()),
                "the actual protected request must reach its retained proof/data lock"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the actual PostgreSQL blocking edge is observed")
}
async fn denied(pending: Vec<PendingRead>) {
    for task in pending {
        let (status, body) = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            body["error"]["code"],
            "inventory_category_authority_required"
        );
        assert!(body["data"].is_null(), "no category DTO is published");
        assert!(!body.to_string().contains(PRIVATE));
    }
}

#[tokio::test]
async fn view_only_reads_do_not_require_management_or_fresh_onsite_credentials() {
    let (app, token) = ordinary().await;
    let receipt = category(&app, &token).await;
    let id = receipt["category"]["id"].as_str().unwrap();
    let pool = app.db_pool().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    sqlx::query(
        "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='inventory.manage'",
    )
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    let (viewer, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1")
        .bind(access_claims(&viewer).session_id).execute(&pool).await.unwrap();
    sqlx::query("UPDATE facility_network_policies SET version=version+1,onsite_cidrs=ARRAY['127.0.0.0/8']::cidr[],offsite_mode='deny' WHERE facility_id=$1")
        .bind(app.state().facility_id()).execute(&pool).await.unwrap();
    for path in paths(id) {
        let (status, _) = request(&app, &viewer, Method::GET, &path, None).await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, _) = request(
        &app,
        &viewer,
        Method::GET,
        &format!(
            "/api/v2/inventory/category-commands/{}",
            receipt["client_request_id"].as_str().unwrap()
        ),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = request(
        &app,
        &viewer,
        Method::POST,
        "/api/v2/inventory/category-administration",
        Some(input("S25_VIEWER_DENIED")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_read_retains_user_session_network_and_feature_proof_until_result_commit() {
    for kind in ["permission", "session", "network", "feature"] {
        let (app, token) = ordinary().await;
        let receipt = category(&app, &token).await;
        let id = receipt["category"]["id"].as_str().unwrap();
        let pool = app.db_pool().await;
        let claims = access_claims(&token);
        let facility = app.state().facility_id();
        let mut gate = pool.begin().await.unwrap();
        let gate_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await
            .unwrap();
        sqlx::query("LOCK TABLE inventory_categories IN ACCESS EXCLUSIVE MODE")
            .execute(&mut *gate)
            .await
            .unwrap();
        let pending = reads(&app, &token, &[paths(id)[1].clone()]);
        let read_pid = waiters(&pool, gate_pid, "inventory_categories", &pending).await[0];
        let mut revoke = pool.begin().await.unwrap();
        let revoke_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *revoke)
            .await
            .unwrap();
        let revoker = tokio::spawn(async move {
            match kind {
                "permission" => {
                    sqlx::query(
                        "UPDATE users SET permission_version=permission_version+1 WHERE id=$1",
                    )
                    .bind(claims.sub)
                    .execute(&mut *revoke)
                    .await
                    .unwrap();
                    sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='inventory.view'")
                        .bind(claims.sub).execute(&mut *revoke).await.unwrap();
                }
                "session" => {
                    sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
                        .bind(claims.session_id).execute(&mut *revoke).await.unwrap();
                }
                "network" => {
                    sqlx::query("UPDATE facility_network_policies SET version=version+1,onsite_cidrs=ARRAY['127.0.0.0/8']::cidr[] WHERE facility_id=$1")
                        .bind(facility).execute(&mut *revoke).await.unwrap();
                }
                "feature" => {
                    sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
                        .bind(facility)
                        .execute(&mut *revoke)
                        .await
                        .unwrap();
                    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled)VALUES($1,'inventory',false) ON CONFLICT(facility_id,feature_key)DO UPDATE SET enabled=false")
                        .bind(facility).execute(&mut *revoke).await.unwrap();
                }
                _ => unreachable!(),
            }
            revoke.commit().await.unwrap();
        });
        waiters(&pool, read_pid, "", std::slice::from_ref(&revoker)).await;
        assert!(
            !revoker.is_finished(),
            "authority change waits for the retained read"
        );
        gate.commit().await.unwrap();
        let (status, body) = pending.into_iter().next().unwrap().await.unwrap();
        assert_eq!(status, StatusCode::OK, "the read linearizes before {kind}");
        assert_eq!(body["data"]["category"]["description"], PRIVATE);
        tokio::time::timeout(Duration::from_secs(5), revoker)
            .await
            .unwrap()
            .unwrap();
        let still_waiting: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock')",
        )
        .bind(revoke_pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!still_waiting);
    }
}

#[tokio::test]
async fn a_prior_authority_change_denies_all_three_waiting_reads_without_category_dtos() {
    for kind in [
        "permission",
        "demographics",
        "visibility",
        "user_feature",
        "inactive",
        "session",
        "network",
        "feature",
        "profile",
    ] {
        let (app, token) = ordinary().await;
        let receipt = category(&app, &token).await;
        let pool = app.db_pool().await;
        let claims = access_claims(&token);
        let facility = app.state().facility_id();
        if kind == "profile" {
            sqlx::query("INSERT INTO deployment_profiles(code,label)VALUES('clinic','Synthetic clinic profile') ON CONFLICT DO NOTHING")
                .execute(&pool).await.unwrap();
        }
        let mut revoke = pool.begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *revoke)
            .await
            .unwrap();
        let (sql, bind) = match kind {
            "session" => (
                "SELECT session_id FROM refresh_sessions WHERE session_id=$1 FOR UPDATE",
                claims.session_id,
            ),
            "network" => (
                "SELECT facility_id FROM facility_network_policies WHERE facility_id=$1 FOR UPDATE",
                facility,
            ),
            "feature" | "profile" => ("SELECT id FROM facilities WHERE id=$1 FOR UPDATE", facility),
            _ => ("SELECT id FROM users WHERE id=$1 FOR UPDATE", claims.sub),
        };
        sqlx::query(sql)
            .bind(bind)
            .execute(&mut *revoke)
            .await
            .unwrap();
        let pending = reads(
            &app,
            &token,
            &paths(receipt["category"]["id"].as_str().unwrap()),
        );
        waiters(&pool, pid, "", &pending).await;
        match kind {
            "permission" | "demographics" => {
                // Intentionally omit a version bump: the repository also has
                // to verify the current exact read capabilities independently.
                let permission = if kind == "permission" {
                    "inventory.view"
                } else {
                    "patient.demographics.view"
                };
                sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code=$2")
                    .bind(claims.sub)
                    .bind(permission)
                    .execute(&mut *revoke)
                    .await
                    .unwrap();
            }
            "visibility" => {
                sqlx::query("DELETE FROM user_patient_visibility WHERE user_id=$1 AND visibility='demographics'")
                    .bind(claims.sub).execute(&mut *revoke).await.unwrap();
            }
            "user_feature" => {
                sqlx::query(
                    "DELETE FROM user_features WHERE user_id=$1 AND feature_key='inventory'",
                )
                .bind(claims.sub)
                .execute(&mut *revoke)
                .await
                .unwrap();
            }
            "inactive" => {
                sqlx::query("UPDATE users SET is_active=false WHERE id=$1")
                    .bind(claims.sub)
                    .execute(&mut *revoke)
                    .await
                    .unwrap();
            }
            "session" => {
                sqlx::query(
                    "UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1",
                )
                .bind(claims.session_id)
                .execute(&mut *revoke)
                .await
                .unwrap();
            }
            "network" => {
                sqlx::query(
                    "UPDATE facility_network_policies SET version=version+1,onsite_cidrs=ARRAY['127.0.0.0/8']::cidr[] WHERE facility_id=$1",
                )
                .bind(facility)
                .execute(&mut *revoke)
                .await
                .unwrap();
            }
            "feature" => {
                sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled)VALUES($1,'inventory',false) ON CONFLICT(facility_id,feature_key)DO UPDATE SET enabled=false")
                    .bind(facility).execute(&mut *revoke).await.unwrap();
            }
            "profile" => {
                sqlx::query("UPDATE facilities SET deployment_profile='clinic' WHERE id=$1")
                    .bind(facility)
                    .execute(&mut *revoke)
                    .await
                    .unwrap();
            }
            _ => unreachable!(),
        }
        revoke.commit().await.unwrap();
        denied(pending).await;
    }
}

#[tokio::test]
async fn session_and_delegation_deadlines_are_rechecked_after_the_actual_projection_wait() {
    for kind in ["session", "delegation"] {
        let (app, mut token) = ordinary().await;
        let receipt = category(&app, &token).await;
        let pool = app.db_pool().await;
        let facility = app.state().facility_id();
        let user = access_claims(&token).sub;
        let delegation = if kind == "delegation" {
            sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='inventory.view'")
                .bind(user).execute(&pool).await.unwrap();
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO delegations(id,facility_id,delegator_user_id,delegate_user_id,permission_code,starts_at,ends_at,status,reason)VALUES($1,$2,$3,$4,'inventory.view',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','active','Synthetic read authority')")
                .bind(id).bind(facility).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).bind(user).execute(&pool).await.unwrap();
            sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
                .bind(user)
                .execute(&pool)
                .await
                .unwrap();
            token = login_with_password(app.clone(), "limited@hms.local", PASSWORD)
                .await
                .0;
            Some(id)
        } else {
            None
        };
        let end: DateTime<Utc> = if let Some(id) = delegation {
            sqlx::query_scalar("UPDATE delegations SET ends_at=clock_timestamp()+interval '5 seconds' WHERE id=$1 RETURNING ends_at")
                .bind(id).fetch_one(&pool).await.unwrap()
        } else {
            sqlx::query_scalar("UPDATE refresh_sessions SET expires_at=clock_timestamp()+interval '5 seconds' WHERE session_id=$1 RETURNING expires_at")
                .bind(access_claims(&token).session_id).fetch_one(&pool).await.unwrap()
        };
        let mut gate = pool.begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await
            .unwrap();
        sqlx::query("LOCK TABLE inventory_categories IN ACCESS EXCLUSIVE MODE")
            .execute(&mut *gate)
            .await
            .unwrap();
        let pending = reads(
            &app,
            &token,
            &paths(receipt["category"]["id"].as_str().unwrap()),
        );
        waiters(&pool, pid, "inventory_categories", &pending).await;
        sqlx::query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM($1::timestamptz-clock_timestamp())))+0.05)")
            .bind(end).execute(&pool).await.unwrap();
        gate.commit().await.unwrap();
        denied(pending).await;
    }
}
