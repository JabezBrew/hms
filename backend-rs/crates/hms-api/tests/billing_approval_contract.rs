//! Named reviewer eligibility is not a second-person authentication ceremony.
//! These tests cross the actual router with a genuinely asserted actor session.
mod support;
use support::*;
#[path = "auth_factor_matrix/mod.rs"]
mod matrix;
use matrix::{Matrix, Operation};

#[derive(Clone, Copy, Debug)]
enum FinancialAction {
    Finalize,
    Refund,
}
impl FinancialAction {
    fn name(self) -> &'static str {
        match self {
            Self::Finalize => "billing finalization",
            Self::Refund => "payment reversal",
        }
    }
}
const ACTIONS: [FinancialAction; 2] = [FinancialAction::Finalize, FinancialAction::Refund];

struct Fixture {
    matrix: Matrix,
    pool: hms_db::PgPool,
    token: String,
    facility: Uuid,
    owner: Uuid,
    reviewer: Uuid,
    invoice: Uuid,
    payment: Uuid,
}
impl Fixture {
    async fn new() -> Self {
        let matrix = Matrix::new().await;
        let pool = matrix.app.db_pool().await;
        let facility = matrix.app.state().facility_id();
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        let reviewer: Uuid = sqlx::query_scalar(
            "SELECT id FROM users WHERE facility_id=$1 AND email='factor-supervisor@hms.local'",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        let invoice = sqlx::query_scalar(
            "SELECT id FROM invoices WHERE facility_id=$1 AND invoice_number='SYN_FACTOR'",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        let payment = sqlx::query_scalar(
            "SELECT id FROM payments WHERE facility_id=$1 AND receipt_number='SYN_FACTOR'",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        let (token, _, _) = login(matrix.app.clone(), "owner@hms.local").await;
        Self {
            matrix,
            pool,
            token,
            facility,
            owner,
            reviewer,
            invoice,
            payment,
        }
    }

    fn operation(&self, action: FinancialAction, reviewer: Uuid) -> Operation {
        let mut operation = self
            .matrix
            .operations
            .iter()
            .find(|operation| operation.name == action.name())
            .unwrap()
            .clone();
        operation.body.as_mut().unwrap()["approval"]["supervisor_user_id"] = json!(reviewer);
        operation
    }

    async fn evidence(&self) -> Value {
        // Only persisted workflow amounts/status/attribution and business-audit
        // counts. No names, patient identifiers, narrative, tokens or key data.
        sqlx::query_scalar(
            r#"
            SELECT jsonb_build_object(
              'invoice',(SELECT jsonb_build_object('locked_at',locked_at,'locked_reason',locked_reason,
                'finalized_at',finalized_at,'finalized_by',finalized_by_user_id,
                'reviewer',finalized_approval_user_id,'reauthorized_at',finalized_reauthorized_at,
                'status',status,'paid_amount',paid_amount_minor,'updated_at',updated_at)
                FROM invoices WHERE id=$1),
              'payment',(SELECT jsonb_build_object('status',status,'amount',amount_minor)
                FROM payments WHERE id=$2),
              'reversals',(SELECT count(*) FROM payment_reversal_ledger WHERE payment_id=$2),
              'audit',(SELECT count(*) FROM audit_events WHERE
                (resource_id=$1 AND event_type='billing.invoice.finalized') OR
                (resource_id=$2 AND event_type IN ('billing.payment_refund.recorded','billing.payment_void.recorded')))
            )
            "#,
        )
        .bind(self.invoice)
        .bind(self.payment)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }

    async fn create_reviewer(&self, facility: Uuid) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,$2,$3,'Synthetic billing reviewer',password_hash FROM users WHERE id=$4",
        )
        .bind(id)
        .bind(facility)
        .bind(format!("reviewer-{}@hms.local", id.simple()))
        .bind(self.owner)
        .execute(&self.pool)
        .await
        .unwrap();
        grant_test_feature(&self.matrix.app, id, FeatureKey::Billing).await;
        id
    }

    async fn clear_direct_permission(&self) {
        sqlx::query(
            "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='billing.manage'",
        )
        .bind(self.reviewer)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    async fn assignment(
        &self,
        reviewer: Uuid,
        scope: &str,
        scope_id: Option<Uuid>,
        future: bool,
    ) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,scope_id,granted_by_user_id,starts_at,ends_at,status) VALUES($1,$2,$3,'billing.manage',$4,$5,$6,clock_timestamp()+CASE WHEN $7 THEN interval '1 hour' ELSE interval '-1 hour' END,clock_timestamp()+interval '2 hours','active')",
        )
        .bind(id)
        .bind(self.facility)
        .bind(reviewer)
        .bind(scope)
        .bind(scope_id)
        .bind(self.owner)
        .bind(future)
        .execute(&self.pool)
        .await
        .unwrap();
        id
    }

    async fn expiring_assignment(&self) -> Uuid {
        self.clear_direct_permission().await;
        self.assignment(self.reviewer, "facility", None, false)
            .await
    }

    async fn set_near_deadline(&self, assignment: Uuid) -> chrono::DateTime<Utc> {
        sqlx::query_scalar(
            "UPDATE permission_assignments SET ends_at=clock_timestamp()+interval '4 seconds' WHERE id=$1 RETURNING ends_at",
        )
        .bind(assignment)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }
}

async fn assert_denied(response: axum::response::Response, expected_code: &str) {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "typed code {}",
        body["error"]["code"]
    );
    assert_eq!(body["error"]["code"], expected_code);
    assert!(
        body["data"].is_null(),
        "denial cannot publish financial data"
    );
}

async fn wait_for_lock(
    pool: &hms_db::PgPool,
    blocker: i32,
    query_fragment: &str,
    pending: &tokio::task::JoinHandle<axum::response::Response>,
) {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0)",
            )
            .bind(blocker)
            .bind(query_fragment)
            .fetch_one(pool)
            .await
            .unwrap();
            if waiting {
                break;
            }
            assert!(!pending.is_finished(), "actual request must reach its held production lock");
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("actual request reached the intended lock while reviewer authority was live");
}

async fn cross_deadline(pool: &hms_db::PgPool, end: chrono::DateTime<Utc>) {
    sqlx::query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.04)",
    )
    .bind(end)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn invalid_named_reviewers_cannot_finalize_or_refund_or_write_business_audit() {
    let f = Fixture::new().await;
    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'APPROVER-FOREIGN','Synthetic billing facility','hospital')")
        .bind(foreign_facility).execute(&f.pool).await.unwrap();
    let foreign = f.create_reviewer(foreign_facility).await;
    let inactive = f.create_reviewer(f.facility).await;
    let unprivileged = f.create_reviewer(f.facility).await;
    let unit_only = f.create_reviewer(f.facility).await;
    let future = f.create_reviewer(f.facility).await;
    let without_feature = f.create_reviewer(f.facility).await;
    let forced_password = f.create_reviewer(f.facility).await;
    for reviewer in [foreign, inactive, without_feature, forced_password] {
        grant_test_permission(&f.matrix.app, reviewer, PermissionCode::BillingManage).await;
    }
    sqlx::query("UPDATE users SET is_active=false WHERE id=$1")
        .bind(inactive)
        .execute(&f.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET password_change_required=true WHERE id=$1")
        .bind(forced_password)
        .execute(&f.pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM user_features WHERE user_id=$1 AND feature_key='billing'")
        .bind(without_feature)
        .execute(&f.pool)
        .await
        .unwrap();
    let unit = Uuid::new_v4();
    sqlx::query("INSERT INTO organization_units(id,facility_id,code,name,unit_type) VALUES($1,$2,'APPROVER-UNIT','Synthetic billing unit','department')")
        .bind(unit).bind(f.facility).execute(&f.pool).await.unwrap();
    f.assignment(unit_only, "organization_unit", Some(unit), false)
        .await;
    f.assignment(future, "facility", None, true).await;
    let before = f.evidence().await;
    for (label, reviewer) in [
        ("foreign", foreign),
        ("inactive", inactive),
        ("self", f.owner),
        ("no billing authority", unprivileged),
        ("unit authority only", unit_only),
        ("future authority", future),
        ("missing billing feature", without_feature),
        ("password change required", forced_password),
    ] {
        for action in ACTIONS {
            let response = f
                .operation(action, reviewer)
                .send(&f.matrix.app, &f.token)
                .await;
            assert_denied(response, "billing_approver_required").await;
            assert_eq!(
                f.evidence().await,
                before,
                "{action:?}: {label} must leave no financial or business-audit effects"
            );
        }
    }
}

#[tokio::test]
async fn explicit_direct_facility_assignment_and_delegation_reviewers_are_eligible() {
    for authority in ["direct", "legacy_unresolved", "assignment", "delegation"] {
        let f = Fixture::new().await;
        f.clear_direct_permission().await;
        match authority {
            "direct" | "legacy_unresolved" => {
                sqlx::query("INSERT INTO user_permissions(user_id,permission_code,origin) VALUES($1,'billing.manage',$2)")
                    .bind(f.reviewer).bind(authority).execute(&f.pool).await.unwrap();
            }
            "assignment" => {
                f.assignment(f.reviewer, "facility", None, false).await;
            }
            "delegation" => {
                sqlx::query("INSERT INTO delegations(id,facility_id,delegator_user_id,delegate_user_id,permission_code,starts_at,ends_at,status,reason) VALUES(gen_random_uuid(),$1,$2,$3,'billing.manage',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','active','Synthetic reviewed delegation')")
                    .bind(f.facility).bind(f.owner).bind(f.reviewer).execute(&f.pool).await.unwrap();
            }
            _ => unreachable!(),
        }
        for action in ACTIONS {
            let response = f
                .operation(action, f.reviewer)
                .send(&f.matrix.app, &f.token)
                .await;
            let status = response.status();
            let body = json_body(response).await;
            assert_eq!(
                status,
                StatusCode::OK,
                "{authority} {action:?}: {}",
                body["error"]["code"]
            );
            match action {
                FinancialAction::Finalize => {
                    let actual: Uuid = sqlx::query_scalar("SELECT finalized_approval_user_id FROM invoices WHERE id=$1 AND finalized_at IS NOT NULL")
                        .bind(f.invoice).fetch_one(&f.pool).await.unwrap();
                    assert_eq!(actual, f.reviewer);
                }
                FinancialAction::Refund => {
                    assert_eq!(body["data"]["approved_by_user_id"], f.reviewer.to_string());
                    let actual: (Uuid, i64) = sqlx::query_as("SELECT approved_by_user_id,amount_minor FROM payment_reversal_ledger WHERE payment_id=$1")
                        .bind(f.payment).fetch_one(&f.pool).await.unwrap();
                    assert_eq!(actual, (f.reviewer, 1));
                }
            }
        }
        let audit: Vec<Value> = sqlx::query_scalar("SELECT metadata FROM audit_events WHERE resource_id=$1 AND event_type='billing.payment_refund.recorded'")
            .bind(f.payment).fetch_all(&f.pool).await.unwrap();
        assert_eq!(audit.len(), 1);
        assert_eq!(audit[0]["reviewer_attributed"], true);
        assert_eq!(audit[0]["approver_identity_verified"], false);
        assert!(
            audit[0].get("supervisor_approved").is_none(),
            "eligibility never claims a second-person ceremony"
        );
    }
}

#[tokio::test]
async fn approver_target_lock_wait_uses_current_clock_not_transaction_start_permission_view() {
    for action in ACTIONS {
        let f = Fixture::new().await;
        let assignment = f.expiring_assignment().await;
        let before = f.evidence().await;
        let mut gate = f.pool.begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await
            .unwrap();
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
            .bind(f.reviewer)
            .fetch_one(&mut *gate)
            .await
            .unwrap();
        let end = f.set_near_deadline(assignment).await;
        let operation = f.operation(action, f.reviewer);
        let app = f.matrix.app.clone();
        let token = f.token.clone();
        let pending = tokio::spawn(async move { operation.send(&app, &token).await });
        wait_for_lock(&f.pool, pid, "users", &pending).await;
        cross_deadline(&f.pool, end).await;
        gate.commit().await.unwrap();
        assert_denied(pending.await.unwrap(), "billing_approver_required").await;
        assert_eq!(
            f.evidence().await,
            before,
            "expired reviewer must not survive an earlier transaction timestamp"
        );
    }
}

#[derive(Clone, Copy)]
enum WaitPoint {
    Source,
    Audit,
}
async fn wait_past_retained_deadline(action: FinancialAction, point: WaitPoint) {
    let f = Fixture::new().await;
    let assignment = f.expiring_assignment().await;
    let before = f.evidence().await;
    if matches!(point, WaitPoint::Audit) {
        sqlx::raw_sql("CREATE FUNCTION hold_billing_reviewer_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type IN ('billing.invoice.finalized','billing.payment_refund.recorded') THEN PERFORM pg_advisory_xact_lock(714202614); END IF; RETURN NEW; END $$; CREATE TRIGGER hold_billing_reviewer_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION hold_billing_reviewer_audit();")
            .execute(&f.pool).await.unwrap();
    }
    let mut gate = f.pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *gate)
        .await
        .unwrap();
    let query_fragment = match point {
        WaitPoint::Source => match action {
            FinancialAction::Finalize => {
                sqlx::query("SELECT id FROM invoices WHERE id=$1 FOR UPDATE")
                    .bind(f.invoice)
                    .fetch_one(&mut *gate)
                    .await
                    .unwrap();
                "UPDATE invoices"
            }
            FinancialAction::Refund => {
                sqlx::query("SELECT id FROM payments WHERE id=$1 FOR UPDATE")
                    .bind(f.payment)
                    .fetch_one(&mut *gate)
                    .await
                    .unwrap();
                "FROM payments"
            }
        },
        WaitPoint::Audit => {
            sqlx::query("SELECT pg_advisory_xact_lock(714202614)")
                .execute(&mut *gate)
                .await
                .unwrap();
            "INSERT INTO audit_events"
        }
    };
    let end = f.set_near_deadline(assignment).await;
    let operation = f.operation(action, f.reviewer);
    let app = f.matrix.app.clone();
    let token = f.token.clone();
    let pending = tokio::spawn(async move { operation.send(&app, &token).await });
    wait_for_lock(&f.pool, pid, query_fragment, &pending).await;
    cross_deadline(&f.pool, end).await;
    gate.commit().await.unwrap();
    assert_denied(pending.await.unwrap(), "billing_approver_authority_expired").await;
    assert_eq!(
        f.evidence().await,
        before,
        "source, balance, attribution and successful business audit roll back together"
    );
}

#[tokio::test]
async fn financial_source_wait_cannot_outlive_reviewers_retained_authority_deadline() {
    for action in ACTIONS {
        wait_past_retained_deadline(action, WaitPoint::Source).await;
    }
}

#[tokio::test]
async fn financial_audit_wait_cannot_outlive_reviewers_retained_authority_deadline() {
    for action in ACTIONS {
        wait_past_retained_deadline(action, WaitPoint::Audit).await;
    }
}

#[tokio::test]
async fn target_serialized_revocation_winning_before_proof_denies_both_financial_actions() {
    for action in ACTIONS {
        let f = Fixture::new().await;
        let assignment = f.expiring_assignment().await;
        let before = f.evidence().await;
        let mut revoker = f.pool.begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *revoker)
            .await
            .unwrap();
        // Match managed revoke's target serialization and durable version bump.
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
            .bind(f.reviewer)
            .fetch_one(&mut *revoker)
            .await
            .unwrap();
        let operation = f.operation(action, f.reviewer);
        let app = f.matrix.app.clone();
        let token = f.token.clone();
        let pending = tokio::spawn(async move { operation.send(&app, &token).await });
        wait_for_lock(&f.pool, pid, "users", &pending).await;
        sqlx::query("UPDATE permission_assignments SET status='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=$2 WHERE id=$1")
            .bind(assignment).bind(f.owner).execute(&mut *revoker).await.unwrap();
        sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
            .bind(f.reviewer)
            .execute(&mut *revoker)
            .await
            .unwrap();
        revoker.commit().await.unwrap();
        assert_denied(pending.await.unwrap(), "billing_approver_required").await;
        assert_eq!(f.evidence().await, before);
    }
}
