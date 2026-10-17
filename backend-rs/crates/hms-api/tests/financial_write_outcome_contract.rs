//! Persistence-error classification and immutable invoice-finalization evidence.
//! The audit trigger exercises a definite SQL rollback, not a lost commit reply.
mod support;
use support::*;
#[path = "auth_factor_matrix/mod.rs"]
mod matrix;
use matrix::{Matrix, Operation};

const UNKNOWN_WRITES: [(&str, &str); 8] = [
    (
        "billing finalization",
        "invoice_finalization_write_unconfirmed",
    ),
    ("payment reversal", "payment_reversal_write_unconfirmed"),
    (
        "NHIS receivable adjustment",
        "nhis_ar_adjustment_write_unconfirmed",
    ),
    ("laboratory verify", "lab_result_verify_write_unconfirmed"),
    (
        "laboratory bulk verify",
        "lab_results_bulk_verify_write_unconfirmed",
    ),
    ("consent creation", "consent_create_write_unconfirmed"),
    ("consent revocation", "consent_revoke_write_unconfirmed"),
    (
        "discharge blocker override",
        "discharge_blocker_override_write_unconfirmed",
    ),
];

async fn business_and_audit_evidence(matrix: &Matrix) -> Value {
    // Select status, amount, attribution and timestamps only. Clinical values,
    // patient identities, notes, consent purposes and request bodies stay out.
    let persisted: Value = sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
          'invoices', (SELECT COALESCE(jsonb_agg(jsonb_build_array(
              status, paid_amount_minor, locked_at, locked_reason, finalized_at,
              finalized_by_user_id, finalized_approval_user_id,
              finalized_reauthorized_at, updated_at) ORDER BY id),'[]')
            FROM invoices WHERE facility_id=$1),
          'payments', (SELECT COALESCE(jsonb_agg(jsonb_build_array(
              status, amount_minor) ORDER BY id),'[]')
            FROM payments WHERE facility_id=$1),
          'claims', (SELECT COALESCE(jsonb_agg(jsonb_build_array(
              status, payer_receivable_minor, updated_at) ORDER BY id),'[]')
            FROM nhis_claims WHERE facility_id=$1),
          'results', (SELECT COALESCE(jsonb_agg(jsonb_build_array(
              status, verified_by_user_id, verified_at, updated_at) ORDER BY id),'[]')
            FROM lab_results WHERE facility_id=$1),
          'orders', (SELECT COALESCE(jsonb_agg(jsonb_build_array(
              status, updated_at) ORDER BY id),'[]')
            FROM lab_orders WHERE facility_id=$1),
          'consents', (SELECT COALESCE(jsonb_agg(jsonb_build_array(
              status, revoked_by_user_id, revoked_at, updated_at) ORDER BY id),'[]')
            FROM consent_grants WHERE facility_id=$1),
          'audits', (SELECT count(*) FROM audit_events WHERE facility_id=$1)
        )
        "#,
    )
    .bind(matrix.app.state().facility_id())
    .fetch_one(&matrix.app.db_pool().await)
    .await
    .expect("minimal persisted business and audit evidence reads");
    json!({"business": matrix.evidence().await, "persisted": persisted})
}

fn assert_safe_error_shape(body: &Value) {
    let object = body.as_object().expect("error response is an object");
    assert!(
        object.len() == 2 && object.contains_key("error") && object.contains_key("request_id"),
        "failure envelope contains only a typed error and opaque request id"
    );
    let error = body["error"].as_object().expect("typed error is an object");
    assert!(
        error.len() == 3
            && error.contains_key("code")
            && error.contains_key("message")
            && error.contains_key("details"),
        "error must not attach source records or SQL diagnostics"
    );
    assert!(body["error"]["details"] == json!({}));
    assert!(body["request_id"].as_str().is_some_and(|id| !id.is_empty()));
    let message = body["error"]["message"]
        .as_str()
        .expect("failure message is static text");
    assert!(
        !message.is_empty()
            && !message.contains("SYNTHETIC_PRIVATE_AUDIT_DETAIL")
            && !message.contains("INSERT")
            && !message.contains("audit_events"),
        "error message must not contain the deliberately private SQL fault"
    );
}

#[tokio::test]
async fn unknown_persistence_errors_keep_each_privileged_write_outcome_unconfirmed() {
    let matrix = Matrix::new().await;
    let (token, _, _) = login(matrix.app.clone(), "owner@hms.local").await;
    let pool = matrix.app.db_pool().await;
    // BEFORE INSERT guarantees the transaction cannot commit a successful
    // business audit. This verifies conservative unknown-error classification;
    // it does not simulate an acknowledgement lost after a successful commit.
    sqlx::raw_sql(
        "CREATE FUNCTION reject_outcome_contract_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_AUDIT_DETAIL'; END $$; CREATE TRIGGER reject_outcome_contract_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_outcome_contract_audit();",
    )
    .execute(&pool)
    .await
    .unwrap();
    let before = business_and_audit_evidence(&matrix).await;
    let mut classifications = Vec::new();
    for (name, expected_code) in UNKNOWN_WRITES {
        let operation = matrix
            .operations
            .iter()
            .find(|operation| operation.name == name)
            .expect("matrix contains the actual privileged write route");
        let response = operation.send(&matrix.app, &token).await;
        let status = response.status();
        let body = json_body(response).await;
        assert_safe_error_shape(&body);
        let code = body["error"]["code"]
            .as_str()
            .expect("unknown persistence error has a typed code");
        classifications.push((name, status, code.to_owned(), expected_code));
        assert!(
            business_and_audit_evidence(&matrix).await == before,
            "{name}: audit failure must leave business state and successful audit unchanged"
        );
    }
    // Collect only static operation names and typed codes so an unpatched run
    // demonstrates every affected fallback without printing clinical responses.
    assert!(
        classifications.iter().all(|(_, status, actual, expected)| {
            *status == StatusCode::CONFLICT && actual.as_str() == *expected
        }),
        "privileged unknown-write classifications: {classifications:?}"
    );
}

async fn definite_balance_conflict(
    matrix: &Matrix,
    token: &str,
    operation: &Operation,
    expected_code: &'static str,
) {
    let before = business_and_audit_evidence(matrix).await;
    let response = operation.send(&matrix.app, token).await;
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"].as_str(), Some(expected_code));
    assert_safe_error_shape(&body);
    assert!(
        business_and_audit_evidence(matrix).await == before,
        "a definite balance rejection leaves business data and successful audit unchanged"
    );
}

#[tokio::test]
async fn known_remaining_balance_conflicts_stay_definite_before_and_after_full_consumption() {
    let matrix = Matrix::new().await;
    let (token, _, _) = login(matrix.app.clone(), "owner@hms.local").await;
    let pool = matrix.app.db_pool().await;
    let facility = matrix.app.state().facility_id();
    let payment_amount: i64 = sqlx::query_scalar(
        "SELECT amount_minor FROM payments WHERE facility_id=$1 AND receipt_number='SYN_FACTOR'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    let payer_receivable: i64 = sqlx::query_scalar(
        "SELECT payer_receivable_minor FROM nhis_claims WHERE facility_id=$1 AND claim_number='SYN_FACTOR'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        payment_amount, 100,
        "fixture has an actual reversible payment"
    );
    assert_eq!(
        payer_receivable, 100,
        "fixture has an actual payer receivable"
    );
    let payment = matrix
        .operations
        .iter()
        .find(|operation| operation.name == "payment reversal")
        .unwrap()
        .clone();
    let nhis = matrix
        .operations
        .iter()
        .find(|operation| operation.name == "NHIS receivable adjustment")
        .unwrap()
        .clone();
    for (amount, consume_remaining) in [(101, true), (1, false)] {
        for kind in ["refund", "void"] {
            let mut operation = payment.clone();
            let body = operation.body.as_mut().unwrap();
            body["reversal_kind"] = json!(kind);
            body["amount_minor"] = json!(amount);
            definite_balance_conflict(&matrix, &token, &operation, "payment_reversal_failed").await;
        }
        for kind in ["remittance", "write_off", "adjustment", "reconciliation"] {
            let mut operation = nhis.clone();
            let body = operation.body.as_mut().unwrap();
            body["adjustment_kind"] = json!(kind);
            body["amount_minor"] = json!(amount);
            definite_balance_conflict(&matrix, &token, &operation, "nhis_ar_adjustment_failed")
                .await;
        }
        if consume_remaining {
            // Cross the production writes that reduce both independent limits
            // to zero; subsequent positive commands must remain definite denials.
            for mut operation in [payment.clone(), nhis.clone()] {
                operation.body.as_mut().unwrap()["amount_minor"] = json!(100);
                let response = operation.send(&matrix.app, &token).await;
                let status = response.status();
                let body = json_body(response).await;
                assert_eq!(
                    status,
                    StatusCode::OK,
                    "valid full consumption typed error {}",
                    body["error"]["code"].as_str().unwrap_or("none")
                );
                assert!(body["data"]["amount_minor"] == json!(100));
            }
            let remaining: (i64, i64) = sqlx::query_as(
                r#"
                SELECT
                  (SELECT p.amount_minor-COALESCE((SELECT sum(l.amount_minor)
                    FROM payment_reversal_ledger l WHERE l.payment_id=p.id),0)::bigint
                    FROM payments p WHERE p.facility_id=$1 AND p.receipt_number='SYN_FACTOR'),
                  (SELECT payer_receivable_minor FROM nhis_claims
                    WHERE facility_id=$1 AND claim_number='SYN_FACTOR')
                "#,
            )
            .bind(facility)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(remaining, (0, 0));
        }
    }
}

#[derive(PartialEq)]
struct FinalizationEvidence {
    locked_at: Option<chrono::DateTime<Utc>>,
    locked_reason: Option<String>,
    finalized_at: Option<chrono::DateTime<Utc>>,
    actor: Option<Uuid>,
    reviewer: Option<Uuid>,
    reauthorized_at: Option<chrono::DateTime<Utc>>,
    updated_at: chrono::DateTime<Utc>,
    audit_count: i64,
    audit_actor: Option<Uuid>,
}

struct FinalizationFixture {
    matrix: Matrix,
    pool: hms_db::PgPool,
    invoice: Uuid,
    first_actor: Uuid,
    first_reviewer: Uuid,
    second_actor: Uuid,
    second_reviewer: Uuid,
    first_token: String,
    second_token: String,
}
impl FinalizationFixture {
    async fn new() -> Self {
        let matrix = Matrix::new().await;
        let pool = matrix.app.db_pool().await;
        let facility = matrix.app.state().facility_id();
        let first_actor = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        let second_actor = Uuid::new_v4();
        let second_reviewer = Uuid::new_v4();
        // Copy the initial synthetic password before the owner's real login
        // completes any mandatory password change. Keys and assurance are
        // established independently through the ordinary login fixture below.
        for (user, email) in [
            (second_actor, "outcome-actor@hms.local"),
            (second_reviewer, "outcome-reviewer@hms.local"),
        ] {
            sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,facility_id,$2,'Synthetic outcome fixture',password_hash FROM users WHERE id=$3")
                .bind(user).bind(email).bind(first_actor)
                .execute(&pool).await.unwrap();
            grant_test_permission(&matrix.app, user, PermissionCode::BillingManage).await;
            grant_test_feature(&matrix.app, user, FeatureKey::Billing).await;
        }
        grant_test_permission(
            &matrix.app,
            second_actor,
            PermissionCode::PatientDemographicsView,
        )
        .await;
        grant_test_feature(&matrix.app, second_actor, FeatureKey::Patients).await;
        for visibility in [
            PatientDataVisibility::Demographics,
            PatientDataVisibility::Billing,
        ] {
            grant_test_patient_visibility(&matrix.app, second_actor, visibility).await;
        }
        let invoice: Uuid = sqlx::query_scalar(
            "SELECT id FROM invoices WHERE facility_id=$1 AND invoice_number='SYN_FACTOR'",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        let first_reviewer: Uuid = sqlx::query_scalar(
            "SELECT id FROM users WHERE facility_id=$1 AND email='factor-supervisor@hms.local'",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        let (first_token, _, _) = login(matrix.app.clone(), "owner@hms.local").await;
        let (second_token, _, _) = login(matrix.app.clone(), "outcome-actor@hms.local").await;
        for token in [&first_token, &second_token] {
            let claims = access_claims(token);
            let genuine: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM auth_session_assurance a JOIN auth_webauthn_credentials k ON k.id=a.credential_id AND k.user_id=a.user_id AND k.facility_id=a.facility_id WHERE a.session_id=$1 AND a.method='passkey' AND a.expires_at>clock_timestamp() AND k.disabled_at IS NULL)",
            ).bind(claims.session_id).fetch_one(&pool).await.unwrap();
            assert!(
                genuine,
                "each actor has its own genuinely signed live factor proof"
            );
        }
        Self {
            matrix,
            pool,
            invoice,
            first_actor,
            first_reviewer,
            second_actor,
            second_reviewer,
            first_token,
            second_token,
        }
    }

    fn operation(&self, reviewer: Uuid) -> Operation {
        let mut operation = self
            .matrix
            .operations
            .iter()
            .find(|operation| operation.name == "billing finalization")
            .unwrap()
            .clone();
        operation.body.as_mut().unwrap()["approval"]["supervisor_user_id"] = json!(reviewer);
        operation
    }

    async fn evidence(&self) -> FinalizationEvidence {
        let row: (
            Option<chrono::DateTime<Utc>>,
            Option<String>,
            Option<chrono::DateTime<Utc>>,
            Option<Uuid>,
            Option<Uuid>,
            Option<chrono::DateTime<Utc>>,
            chrono::DateTime<Utc>,
            i64,
            Option<Uuid>,
        ) = sqlx::query_as(
            r#"
            SELECT locked_at, locked_reason, finalized_at, finalized_by_user_id,
              finalized_approval_user_id, finalized_reauthorized_at, updated_at,
              (SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='billing.invoice.finalized'),
              (SELECT actor_user_id FROM audit_events WHERE resource_id=$1 AND event_type='billing.invoice.finalized' ORDER BY occurred_at,id LIMIT 1)
            FROM invoices WHERE id=$1
            "#,
        )
        .bind(self.invoice)
        .fetch_one(&self.pool)
        .await
        .unwrap();
        FinalizationEvidence {
            locked_at: row.0,
            locked_reason: row.1,
            finalized_at: row.2,
            actor: row.3,
            reviewer: row.4,
            reauthorized_at: row.5,
            updated_at: row.6,
            audit_count: row.7,
            audit_actor: row.8,
        }
    }
}

async fn successful_invoice(response: axum::response::Response) -> Value {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "invoice finalization typed error {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    assert!(
        body["data"].is_object(),
        "successful invoice projection exists"
    );
    body["data"].clone()
}

#[tokio::test]
async fn later_valid_actor_and_reviewer_cannot_replace_saved_finalization_evidence() {
    let f = FinalizationFixture::new().await;
    let before = f.evidence().await;
    assert!(before.finalized_at.is_none() && before.audit_count == 0);
    let first = successful_invoice(
        f.operation(f.first_reviewer)
            .send(&f.matrix.app, &f.first_token)
            .await,
    )
    .await;
    let saved = f.evidence().await;
    assert!(saved.finalized_at.is_some() && saved.locked_at.is_some());
    assert!(saved.reauthorized_at.is_some());
    assert!(saved.locked_reason.as_deref() == Some("finalized"));
    assert!(saved.actor == Some(f.first_actor));
    assert!(saved.reviewer == Some(f.first_reviewer));
    assert!(saved.audit_count == 1 && saved.audit_actor == Some(f.first_actor));
    let second = successful_invoice(
        f.operation(f.second_reviewer)
            .send(&f.matrix.app, &f.second_token)
            .await,
    )
    .await;
    assert!(
        first == second,
        "both callers receive the same saved invoice projection"
    );
    assert!(
        f.evidence().await == saved,
        "later valid finalization must preserve original actor, reviewer, every timestamp, updated_at and single business audit"
    );
}

async fn await_both_invoice_writers(
    pool: &hms_db::PgPool,
    blocker_pid: i32,
    first: &tokio::task::JoinHandle<axum::response::Response>,
    second: &tokio::task::JoinHandle<axum::response::Response>,
) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            // PostgreSQL may queue the second UPDATE behind the first row
            // waiter. Follow the actual blocking chain back to our held row.
            let count: i64 = sqlx::query_scalar(
                r#"
                WITH RECURSIVE blocked(pid) AS (
                  SELECT pid FROM pg_stat_activity
                    WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
                  UNION
                  SELECT a.pid FROM pg_stat_activity a JOIN blocked b
                    ON b.pid=ANY(pg_blocking_pids(a.pid))
                    WHERE a.datname=current_database()
                )
                SELECT count(*) FROM pg_stat_activity a JOIN blocked b USING(pid)
                  WHERE a.wait_event_type='Lock' AND strpos(lower(a.query),'update invoices')>0
                "#,
            )
            .bind(blocker_pid)
            .fetch_one(pool)
            .await
            .unwrap();
            if count == 2 {
                break;
            }
            assert!(
                !first.is_finished() && !second.is_finished(),
                "both valid commands must reach the actual held invoice UPDATE"
            );
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("both actual first finalizations wait on the same invoice");
}

#[tokio::test]
async fn concurrent_first_finalizations_have_one_immutable_winner_and_one_audit() {
    let f = FinalizationFixture::new().await;
    let before = f.evidence().await;
    assert!(before.finalized_at.is_none() && before.audit_count == 0);
    let mut blocker = f.pool.begin().await.unwrap();
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM invoices WHERE id=$1 FOR UPDATE")
        .bind(f.invoice)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let operation = f.operation(f.first_reviewer);
    let app = f.matrix.app.clone();
    let token = f.first_token.clone();
    let first = tokio::spawn(async move { operation.send(&app, &token).await });
    let operation = f.operation(f.second_reviewer);
    let app = f.matrix.app.clone();
    let token = f.second_token.clone();
    let second = tokio::spawn(async move { operation.send(&app, &token).await });
    await_both_invoice_writers(&f.pool, blocker_pid, &first, &second).await;
    blocker.commit().await.unwrap();
    let (first, second) = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        tokio::join!(first, second)
    })
    .await
    .expect("both finalized callers complete after the held row is released");
    let first = successful_invoice(first.unwrap()).await;
    let second = successful_invoice(second.unwrap()).await;
    assert!(
        first == second,
        "both callers observe the same saved invoice projection"
    );
    let saved = f.evidence().await;
    assert!(saved.finalized_at.is_some() && saved.locked_at.is_some());
    assert!(saved.reauthorized_at.is_some());
    assert!(saved.locked_reason.as_deref() == Some("finalized"));
    assert!(
        (saved.actor == Some(f.first_actor) && saved.reviewer == Some(f.first_reviewer))
            || (saved.actor == Some(f.second_actor) && saved.reviewer == Some(f.second_reviewer)),
        "saved actor and reviewer must belong to one actual winning command"
    );
    assert!(
        saved.audit_count == 1 && saved.audit_actor == saved.actor,
        "concurrent first finalizations have one matching business audit"
    );
    let replay = successful_invoice(
        f.operation(f.first_reviewer)
            .send(&f.matrix.app, &f.first_token)
            .await,
    )
    .await;
    assert!(replay == first);
    assert!(
        f.evidence().await == saved,
        "repeated reads of the saved finalization cannot change its winning evidence"
    );
}

async fn await_both_payment_writers(
    pool: &hms_db::PgPool,
    blocker_pid: i32,
    first: &tokio::task::JoinHandle<axum::response::Response>,
    second: &tokio::task::JoinHandle<axum::response::Response>,
) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let count: i64 = sqlx::query_scalar(
                r#"
                WITH RECURSIVE blocked(pid) AS (
                  SELECT pid FROM pg_stat_activity
                    WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
                  UNION
                  SELECT a.pid FROM pg_stat_activity a JOIN blocked b
                    ON b.pid=ANY(pg_blocking_pids(a.pid))
                    WHERE a.datname=current_database()
                )
                SELECT count(*) FROM pg_stat_activity a JOIN blocked b USING(pid)
                  WHERE a.wait_event_type='Lock'
                    AND strpos(lower(a.query),'from payments')>0
                    AND strpos(lower(a.query),'for update')>0
                "#,
            )
            .bind(blocker_pid)
            .fetch_one(pool)
            .await
            .unwrap();
            if count == 2 {
                break;
            }
            assert!(
                !first.is_finished() && !second.is_finished(),
                "both genuine refund commands must reach the actual held payment lock"
            );
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("both actual refund requests wait on the same payment");
}

#[tokio::test]
async fn concurrent_partial_refunds_cannot_reuse_a_pre_lock_remaining_balance() {
    let f = FinalizationFixture::new().await;
    let payment: Uuid = sqlx::query_scalar(
        "SELECT id FROM payments WHERE invoice_id=$1 AND receipt_number='SYN_FACTOR' AND amount_minor=100",
    )
    .bind(f.invoice)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    let before: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM payment_reversal_ledger WHERE payment_id=$1),(SELECT paid_amount_minor FROM invoices WHERE id=$2)",
    )
    .bind(payment)
    .bind(f.invoice)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(before, (0, 100));
    let mut blocker = f.pool.begin().await.unwrap();
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM payments WHERE id=$1 FOR UPDATE")
        .bind(payment)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let refund = |reviewer| {
        let mut operation = f
            .matrix
            .operations
            .iter()
            .find(|operation| operation.name == "payment reversal")
            .unwrap()
            .clone();
        let body = operation.body.as_mut().unwrap();
        body["amount_minor"] = json!(60);
        body["approval"]["supervisor_user_id"] = json!(reviewer);
        operation
    };
    let operation = refund(f.first_reviewer);
    let app = f.matrix.app.clone();
    let token = f.first_token.clone();
    let first = tokio::spawn(async move { operation.send(&app, &token).await });
    let operation = refund(f.second_reviewer);
    let app = f.matrix.app.clone();
    let token = f.second_token.clone();
    let second = tokio::spawn(async move { operation.send(&app, &token).await });
    await_both_payment_writers(&f.pool, blocker_pid, &first, &second).await;
    blocker.commit().await.unwrap();
    let (first, second) = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        tokio::join!(first, second)
    })
    .await
    .expect("both refund callers complete after the held payment is released");
    let mut outcomes = Vec::new();
    for response in [first.unwrap(), second.unwrap()] {
        let status = response.status();
        let body = json_body(response).await;
        let code = if status == StatusCode::OK {
            assert!(body["data"]["amount_minor"] == json!(60));
            "saved".to_owned()
        } else {
            assert_safe_error_shape(&body);
            body["error"]["code"]
                .as_str()
                .unwrap_or("untyped_error")
                .to_owned()
        };
        outcomes.push((status.as_u16(), code));
    }
    outcomes.sort_unstable();
    let persisted: (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
          (SELECT count(*) FROM payment_reversal_ledger WHERE payment_id=$1),
          (SELECT COALESCE(sum(amount_minor),0)::bigint FROM payment_reversal_ledger WHERE payment_id=$1),
          (SELECT paid_amount_minor FROM invoices WHERE id=$2),
          (SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='billing.payment_refund.recorded')
        "#,
    )
    .bind(payment)
    .bind(f.invoice)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert!(
        outcomes == vec![(200, "saved".to_owned()), (409, "payment_reversal_failed".to_owned())]
            && persisted == (1, 60, 40, 1),
        "two concurrent refunds of 60 from 100: typed outcomes {outcomes:?}; ledger count/amount, invoice paid, audit count {persisted:?}"
    );
}
