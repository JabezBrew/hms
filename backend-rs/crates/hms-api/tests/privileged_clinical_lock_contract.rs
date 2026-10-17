mod support;
use support::*;
#[path = "auth_factor_matrix/mod.rs"]
mod matrix;
use matrix::Matrix;
use support::webauthn_signing::{Ceremony, SoftwareAuthenticator};

async fn ok(response: axum::response::Response) -> Value {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "safe clinical command error {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    body["data"].clone()
}

async fn wait_for_case_requests(
    pool: &hms_db::PgPool,
    count: i64,
    commands: &[&tokio::task::JoinHandle<axum::response::Response>],
) {
    tokio::time::timeout(std::time::Duration::from_secs(3),async {loop {
        let blocked:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND cardinality(pg_blocking_pids(pid))>0 AND query ILIKE '%discharge_cases%' AND query NOT ILIKE '%pg_stat_activity%'").fetch_one(pool).await.unwrap();
        if blocked>=count {break;}
        assert!(commands.iter().all(|command| !command.is_finished()),"both real clinical commands reach the held discharge source");
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }}).await.expect("real clinical requests wait on the discharge parent");
}

#[tokio::test]
async fn same_actor_round_and_privileged_override_share_live_proof_without_a_parent_lock_cycle() {
    discharge_lock_queue(false).await;
}

#[tokio::test]
async fn queued_key_withdrawal_does_not_create_a_round_override_proof_cycle() {
    discharge_lock_queue(true).await;
}

async fn discharge_lock_queue(queue_key_withdrawal: bool) {
    let matrix = Matrix::new().await;
    let app = &matrix.app;
    let pool = app.db_pool().await;
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    for permission in [
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::ClinicalDocumentationManage,
        PermissionCode::AdmissionManage,
        PermissionCode::WardBoardViewAll,
    ] {
        grant_test_permission(app, owner, permission).await;
    }
    let (patient, admission): (Uuid, Uuid) =
        sqlx::query_as("SELECT patient_id,admission_case_id FROM discharge_cases WHERE id=$1")
            .bind(matrix.discharge)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING")
        .bind(app.state().facility_id()).bind(owner).bind(patient).execute(&pool).await.unwrap();
    let (mut token, _, _) = login(app.clone(), "owner@hms.local").await;
    let first_key: Uuid =
        sqlx::query_scalar("SELECT credential_id FROM auth_session_assurance WHERE session_id=$1")
            .bind(access_claims(&token).session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    if queue_key_withdrawal {
        let added = SoftwareAuthenticator::new();
        let options = ok(fixture_json_post(
            app,
            Some(&token),
            "/api/v2/auth/mfa/webauthn/register/options",
            json!({}),
        )
        .await)
        .await;
        ok(fixture_json_post(app,Some(&token),"/api/v2/auth/mfa/webauthn/register/verify",json!({"mfa_session":options["mfa_session"],"credential":added.registration(&Ceremony::from_options(&options,"http://localhost:8080",0))})).await).await;
        token = step_up_test_session(app, &token, None).await;
    }
    let root = format!("/api/v2/patients/{patient}/chronicle/ward-rounds");
    let saved=ok(fixture_json_post(app,Some(&token),&format!("{root}/draft"),json!({"client_request_id":Uuid::new_v4(),"expected_version":0,"ward_round_id":null,"admission_case_id":admission,"note_sections":{"interval_history":null,"examination":null,"assessment":null,"plan":null,"clinical_readiness_blockers":[]},"rendered_note":"Synthetic reviewed round","actions":[{"action_type":"discharge_request","payload":{}}]})).await).await;
    let round = saved["ward_round"]["id"].as_str().unwrap().to_owned();
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM discharge_cases WHERE id=$1 FOR UPDATE")
        .bind(matrix.discharge)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    // Queue the parent-first override first. The round then retains its current
    // actor/session SHARE proof while joining the same parent queue behind it.
    let operation = matrix
        .operations
        .iter()
        .find(|operation| operation.name == "discharge blocker override")
        .unwrap()
        .clone();
    let pending_app = app.clone();
    let override_token = token.clone();
    let overriding =
        tokio::spawn(async move { operation.send(&pending_app, &override_token).await });
    wait_for_case_requests(&pool, 1, &[&overriding]).await;
    let pending_app = app.clone();
    let round_token = token.clone();
    let committing = tokio::spawn(async move {
        fixture_json_post(
            &pending_app,
            Some(&round_token),
            &format!("{root}/{round}/commit"),
            json!({"client_request_id":Uuid::new_v4(),"expected_version":1}),
        )
        .await
    });
    wait_for_case_requests(&pool, 2, &[&overriding, &committing]).await;
    let mut probe = pool.begin().await.unwrap();
    let held = sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT")
        .bind(owner)
        .fetch_one(&mut *probe)
        .await
        .expect_err("the queued round retains its live actor read proof");
    assert_eq!(
        held.as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("55P03")
    );
    probe.rollback().await.unwrap();
    // A real key-management request takes its strong identity lock after the
    // round's existing SHARE proof. Measure the compatible reader's behavior
    // with that stronger waiter queued, rather than assuming queue fairness.
    let withdrawing = if queue_key_withdrawal {
        let pending_app = app.clone();
        let management_token = token.clone();
        let task = tokio::spawn(async move {
            fixture_json_post(
                &pending_app,
                Some(&management_token),
                &format!("/api/v2/auth/mfa/passkeys/{first_key}/disable"),
                json!({}),
            )
            .await
        });
        tokio::time::timeout(std::time::Duration::from_secs(3),async {loop {
            let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND cardinality(pg_blocking_pids(pid))>0 AND query ILIKE '%users%' AND query ILIKE '%FOR NO KEY UPDATE%' AND query NOT ILIKE '%pg_stat_activity%')").fetch_one(&pool).await.unwrap();
            if blocked {break;}assert!(!task.is_finished(),"real key withdrawal must queue behind retained actor proof");tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }}).await.expect("key withdrawal reaches the held actor");
        Some(task)
    } else {
        None
    };
    blocker.commit().await.unwrap();
    let (overridden, committed) = tokio::time::timeout(std::time::Duration::from_secs(4), async {
        tokio::join!(overriding, committing)
    })
    .await
    .expect("compatible actor/session proof does not deadlock the clinical parent queue");
    ok(overridden.unwrap()).await;
    let result = ok(committed.unwrap()).await;
    assert_eq!(result["operation"], "committed");
    assert_eq!(
        result["created_artifacts"][0]["resource_type"],
        "discharge_case"
    );
    let evidence:(i64,i64,String)=sqlx::query_as("SELECT (SELECT count(*) FROM discharge_blocker_overrides WHERE discharge_case_id=$1),(SELECT count(*) FROM ward_round_commands WHERE command_type='committed'),(SELECT status FROM discharge_cases WHERE id=$1)").bind(matrix.discharge).fetch_one(&pool).await.unwrap();
    assert_eq!(evidence, (1, 1, "requested".into()));
    if let Some(withdrawing) = withdrawing {
        let result = tokio::time::timeout(std::time::Duration::from_secs(4), withdrawing)
            .await
            .expect("queued key withdrawal finishes after clinical proof releases")
            .unwrap();
        ok(result).await;
        let active:i64=sqlx::query_scalar("SELECT count(*) FROM auth_webauthn_credentials WHERE user_id=$1 AND disabled_at IS NULL").bind(owner).fetch_one(&pool).await.unwrap();
        assert_eq!(active, 1);
    }
}
