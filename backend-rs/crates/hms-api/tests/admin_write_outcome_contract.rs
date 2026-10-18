//! Conservative unknown outcomes through real privileged routes; definite
//! reference/uniqueness denials remain distinct. An audit fault rolls back the
//! transaction; it does not reproduce a lost acknowledgement after COMMIT.
mod support;
use support::*;
#[path = "auth_factor_matrix/mod.rs"]
mod matrix;
use matrix::{Matrix, Operation};

struct Fixture {
    matrix: Matrix,
    operations: Vec<Operation>,
    unit: Uuid,
    target: Uuid,
    target_staff: Uuid,
}

impl Fixture {
    async fn new() -> Self {
        let matrix = Matrix::new().await;
        let pool = matrix.app.db_pool().await;
        let facility = matrix.app.state().facility_id();
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        let target: Uuid = sqlx::query_scalar(
            "SELECT id FROM users WHERE facility_id=$1 AND email='factor-target@hms.local'",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        let staff: Uuid =
            sqlx::query_scalar("SELECT id FROM staff_profiles WHERE facility_id=$1 AND user_id=$2")
                .bind(facility)
                .bind(target)
                .fetch_one(&pool)
                .await
                .unwrap();
        // This command must remain a genuine inactive -> active transition
        // when same-state lifecycle requests become immutable no-ops.
        let inactive_user = Uuid::new_v4();
        let inactive_staff = Uuid::new_v4();
        sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash,is_active) SELECT $1,facility_id,'outcome-inactive@hms.local','Synthetic inactive outcome fixture',password_hash,FALSE FROM users WHERE id=$2")
            .bind(inactive_user).bind(owner).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES($1,$2,$3,'OUTCOME14_INACTIVE','Synthetic','Synthetic',CURRENT_DATE)")
            .bind(inactive_staff).bind(facility).bind(inactive_user).execute(&pool).await.unwrap();
        let unit: Uuid = sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,code,name,unit_type) VALUES(gen_random_uuid(),$1,'OUTCOME14_BASE','Synthetic outcome unit','department') RETURNING id")
            .bind(facility).fetch_one(&pool).await.unwrap();
        let template: Uuid = sqlx::query_scalar("INSERT INTO position_templates(id,facility_id,code,title,description,permission_codes) VALUES(gen_random_uuid(),$1,'OUTCOME14_BASE','Synthetic outcome template','Synthetic','{}'::text[]) RETURNING id")
            .bind(facility).fetch_one(&pool).await.unwrap();
        let position: Uuid = sqlx::query_scalar("INSERT INTO positions(id,facility_id,org_unit_id,template_id,code,title,status) VALUES(gen_random_uuid(),$1,$2,$3,'OUTCOME14_BASE','Synthetic outcome position','active') RETURNING id")
            .bind(facility).bind(unit).bind(template).fetch_one(&pool).await.unwrap();
        let existing = |name| {
            matrix
                .operations
                .iter()
                .find(|operation| operation.name == name)
                .unwrap()
                .clone()
        };
        let operations = vec![
            existing("authority template"),
            Operation {
                name: "position",
                method: Method::POST,
                path: "/api/v2/admin/positions".into(),
                body: Some(
                    json!({"code":"OUTCOME14_NEW","title":"Synthetic position","org_unit_id":unit,"template_id":template}),
                ),
            },
            Operation {
                name: "authority appointment",
                method: Method::POST,
                path: "/api/v2/admin/authority-appointments".into(),
                body: Some(
                    json!({"position_id":position,"user_id":target,"appointment_type":"substantive","starts_at":null,"ends_at":null}),
                ),
            },
            Operation {
                name: "permission assignment",
                method: Method::POST,
                path: "/api/v2/admin/permission-assignments".into(),
                body: Some(
                    json!({"grantee_user_id":target,"permission_code":"patient.create","scope_type":"facility","scope_id":null,"starts_at":null,"ends_at":null,"reason_code":"SYNTHETIC_REVIEW"}),
                ),
            },
            existing("feature entitlement"),
            Operation {
                name: "feature entitlement deletion",
                method: Method::DELETE,
                path: "/api/v2/admin/features/nursing".into(),
                body: None,
            },
            Operation {
                name: "staff creation",
                method: Method::POST,
                path: "/api/v2/admin/staff".into(),
                body: Some(
                    json!({"email":"outcome-new@hms.local","display_name":"Synthetic outcome staff","department":"Synthetic","position":"Synthetic","hire_date":"2026-10-17","practitioner_profile":null}),
                ),
            },
            Operation {
                name: "staff password reset",
                method: Method::POST,
                path: format!("/api/v2/admin/staff/{staff}/force-password-reset"),
                body: None,
            },
            existing("staff deactivation"),
            Operation {
                name: "staff reactivation",
                method: Method::POST,
                path: format!("/api/v2/admin/staff/{inactive_staff}/reactivate"),
                body: None,
            },
            Operation {
                name: "delegation",
                method: Method::POST,
                path: "/api/v2/admin/delegations".into(),
                body: Some(
                    json!({"delegator_user_id":owner,"delegate_user_id":target,"permission_code":"patient.create","starts_at":null,"ends_at":null,"reason":"Synthetic reviewed delegation"}),
                ),
            },
            existing("break glass"),
        ];
        Self {
            matrix,
            operations,
            unit,
            target,
            target_staff: staff,
        }
    }

    fn operation(&self, name: &str) -> Operation {
        self.operations
            .iter()
            .find(|operation| operation.name == name)
            .unwrap()
            .clone()
    }

    async fn evidence(&self) -> Value {
        // Only counts, flags, versions and timestamps. No names, account input,
        // patient identity, clinical narrative, credentials or SQL diagnostics.
        // Reset preparation may durably create an inactive token before its
        // separate finalization rolls back. Count usable reset links only.
        sqlx::query_scalar(r#"SELECT jsonb_build_object(
            'users',(SELECT COALESCE(jsonb_agg(jsonb_build_array(is_active,session_version,permission_version,password_change_required,updated_at) ORDER BY id),'[]') FROM users WHERE facility_id=$1),
            'staff',(SELECT count(*) FROM staff_profiles WHERE facility_id=$1),
            'templates',(SELECT count(*) FROM position_templates WHERE facility_id=$1),
            'positions',(SELECT count(*) FROM positions WHERE facility_id=$1),
            'appointments',(SELECT count(*) FROM authority_appointments WHERE facility_id=$1),
            'assignments',(SELECT count(*) FROM permission_assignments WHERE facility_id=$1),
            'delegations',(SELECT count(*) FROM delegations WHERE facility_id=$1),
            'features',(SELECT COALESCE(jsonb_object_agg(feature_key,enabled),'{}') FROM facility_feature_entitlements WHERE facility_id=$1),
            'usable_reset_links',(SELECT count(*) FROM password_reset_tokens WHERE facility_id=$1 AND used_at IS NULL AND expires_at>clock_timestamp()),
            'grants',(SELECT count(*) FROM patient_break_glass_grants WHERE facility_id=$1),
            'audits',(SELECT count(*) FROM audit_events WHERE facility_id=$1))"#)
            .bind(self.matrix.app.state().facility_id()).fetch_one(&self.matrix.app.db_pool().await).await.unwrap()
    }
}

fn safe_error(body: &Value) {
    let top = body.as_object().expect("typed error envelope");
    assert!(top.len() == 2 && top.contains_key("error") && top.contains_key("request_id"));
    let error = body["error"].as_object().expect("typed error");
    assert!(
        error.len() == 3
            && error.contains_key("code")
            && error.contains_key("message")
            && error.contains_key("details")
    );
    assert!(body["error"]["details"] == json!({}));
    let message = body["error"]["message"]
        .as_str()
        .expect("static error message");
    assert!(
        !message.is_empty()
            && !message.contains("SYNTHETIC_PRIVATE_OUTCOME_DETAIL")
            && !message.contains("audit_events")
    );
}

#[tokio::test]
async fn unknown_admin_and_emergency_access_persistence_errors_keep_outcomes_unconfirmed() {
    let fixture = Fixture::new().await;
    let (token, _, _) = login(fixture.matrix.app.clone(), "owner@hms.local").await;
    let pool = fixture.matrix.app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION reject_admin_outcome_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_OUTCOME_DETAIL'; END $$; CREATE TRIGGER reject_admin_outcome_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_admin_outcome_audit();")
        .execute(&pool).await.unwrap();
    let before = fixture.evidence().await;
    let mut outcomes = Vec::new();
    for (name, expected) in [
        (
            "authority template",
            "position_template_create_write_unconfirmed",
        ),
        ("position", "position_create_write_unconfirmed"),
        (
            "authority appointment",
            "authority_appointment_create_write_unconfirmed",
        ),
        (
            "permission assignment",
            "permission_assignment_create_write_unconfirmed",
        ),
        (
            "feature entitlement",
            "feature_entitlement_update_write_unconfirmed",
        ),
        (
            "feature entitlement deletion",
            "feature_entitlement_delete_write_unconfirmed",
        ),
        ("staff creation", "staff_create_write_unconfirmed"),
        ("staff password reset", "staff_reset_write_unconfirmed"),
        ("staff deactivation", "staff_deactivate_write_unconfirmed"),
        ("staff reactivation", "staff_reactivate_write_unconfirmed"),
        ("delegation", "delegation_create_write_unconfirmed"),
        ("break glass", "break_glass_grant_write_unconfirmed"),
    ] {
        let response = fixture
            .operation(name)
            .send(&fixture.matrix.app, &token)
            .await;
        let status = response.status();
        let body = json_body(response).await;
        safe_error(&body);
        outcomes.push((
            name,
            status,
            body["error"]["code"].as_str().unwrap().to_owned(),
            expected,
        ));
        assert!(
            fixture.evidence().await == before,
            "{name}: failed business audit rolls back business effects and successful audit"
        );
    }
    assert!(
        outcomes.iter().all(
            |(_, status, actual, expected)| *status == StatusCode::CONFLICT
                && actual.as_str() == *expected
        ),
        "safe static operation/outcome classifications: {outcomes:?}"
    );
}

async fn definite(fixture: &Fixture, token: &str, operation: Operation, code: &str) {
    let before = fixture.evidence().await;
    let response = operation.send(&fixture.matrix.app, token).await;
    let status = response.status();
    let body = json_body(response).await;
    safe_error(&body);
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "{} remains a definite pre-write denial",
        operation.name
    );
    assert_eq!(body["error"]["code"].as_str(), Some(code));
    assert!(
        fixture.evidence().await == before,
        "{}: definite rejection has no business effects",
        operation.name
    );
}

#[tokio::test]
async fn known_unavailable_admin_references_and_invalid_scope_stay_definite() {
    let fixture = Fixture::new().await;
    let (token, _, _) = login(fixture.matrix.app.clone(), "owner@hms.local").await;
    for (name, field, replacement, expected) in [
        (
            "position",
            "org_unit_id",
            json!(Uuid::new_v4()),
            "position_create_failed",
        ),
        (
            "position",
            "template_id",
            json!(Uuid::new_v4()),
            "position_create_failed",
        ),
        (
            "authority appointment",
            "user_id",
            json!(Uuid::new_v4()),
            "authority_appointment_create_failed",
        ),
        (
            "authority appointment",
            "position_id",
            json!(Uuid::new_v4()),
            "authority_appointment_create_failed",
        ),
        (
            "permission assignment",
            "grantee_user_id",
            json!(Uuid::new_v4()),
            "permission_assignment_create_failed",
        ),
        (
            "permission assignment",
            "scope_type",
            json!("unsupported"),
            "permission_assignment_create_failed",
        ),
        (
            "permission assignment",
            "scope_id",
            json!(Uuid::new_v4()),
            "permission_assignment_create_failed",
        ),
        (
            "delegation",
            "delegate_user_id",
            json!(Uuid::new_v4()),
            "delegation_create_failed",
        ),
        (
            "delegation",
            "delegator_user_id",
            json!(Uuid::new_v4()),
            "delegation_create_failed",
        ),
    ] {
        let mut operation = fixture.operation(name);
        operation.body.as_mut().unwrap()[field] = replacement;
        definite(&fixture, &token, operation, expected).await;
    }
    let mut unit_scope = fixture.operation("permission assignment");
    let body = unit_scope.body.as_mut().unwrap();
    body["scope_type"] = json!("organization_unit");
    body["scope_id"] = json!(Uuid::new_v4());
    definite(
        &fixture,
        &token,
        unit_scope,
        "permission_assignment_create_failed",
    )
    .await;
    // A distinct unreferenced unit is honestly retired. Existing historical
    // position references are intentionally conserved by the organization guard.
    let inactive_unit: Uuid = sqlx::query_scalar("INSERT INTO organization_units(id,facility_id,code,name,unit_type) VALUES(gen_random_uuid(),$1,'OUTCOME20_INACTIVE','Synthetic inactive reference','department') RETURNING id")
        .bind(fixture.matrix.app.state().facility_id()).fetch_one(&fixture.matrix.app.db_pool().await).await.unwrap();
    sqlx::query("UPDATE organization_units SET is_active=FALSE,version=version+1,updated_at=clock_timestamp() WHERE id=$1")
        .bind(inactive_unit).execute(&fixture.matrix.app.db_pool().await).await.unwrap();
    let mut position = fixture.operation("position");
    position.body.as_mut().unwrap()["org_unit_id"] = json!(inactive_unit);
    definite(&fixture, &token, position, "position_create_failed").await;
}

#[tokio::test]
async fn known_unique_admin_conflicts_stay_definite_without_database_message_matching() {
    let fixture = Fixture::new().await;
    let (token, _, _) = login(fixture.matrix.app.clone(), "owner@hms.local").await;
    for (name, field, replacement, expected) in [
        (
            "authority template",
            "code",
            "OUTCOME14_BASE",
            "position_template_create_failed",
        ),
        (
            "position",
            "code",
            "OUTCOME14_BASE",
            "position_create_failed",
        ),
        (
            "staff creation",
            "email",
            "factor-target@hms.local",
            "staff_create_failed",
        ),
    ] {
        let mut operation = fixture.operation(name);
        operation.body.as_mut().unwrap()[field] = json!(replacement);
        definite(&fixture, &token, operation, expected).await;
    }
}

#[derive(PartialEq)]
struct LifecycleEvidence {
    active: bool,
    version: i64,
    updated_at: chrono::DateTime<Utc>,
    audit_count: i64,
    live_sessions: i64,
}

async fn lifecycle_evidence(fixture: &Fixture) -> LifecycleEvidence {
    let row: (bool, i64, chrono::DateTime<Utc>, i64, i64) = sqlx::query_as(
        "SELECT is_active,session_version,updated_at,
         (SELECT count(*) FROM audit_events WHERE resource_id=$2 AND event_type IN ('admin.staff.deactivated','admin.staff.reactivated')),
         (SELECT count(*) FROM refresh_sessions WHERE user_id=$1 AND revoked_at IS NULL)
         FROM users WHERE id=$1",
    ).bind(fixture.target).bind(fixture.target_staff).fetch_one(&fixture.matrix.app.db_pool().await).await.unwrap();
    LifecycleEvidence {
        active: row.0,
        version: row.1,
        updated_at: row.2,
        audit_count: row.3,
        live_sessions: row.4,
    }
}

async fn lifecycle_success(response: axum::response::Response) {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "staff lifecycle typed error {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    assert!(body["data"]["id"]
        .as_str()
        .is_some_and(|id| Uuid::parse_str(id).is_ok()));
}

async fn account_status(app: &TestApp, token: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn repeated_staff_lifecycle_commands_preserve_transition_evidence_and_new_sessions() {
    let fixture = Fixture::new().await;
    let app = &fixture.matrix.app;
    grant_test_permission(app, fixture.target, PermissionCode::AuthMeView).await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (old_target_token, _, _) = login(app.clone(), "factor-target@hms.local").await;
    assert_eq!(account_status(app, &old_target_token).await, StatusCode::OK);
    let pool = app.db_pool().await;
    let mut repeated_outcomes = Vec::new();
    for active in [false, true] {
        let operation = Operation {
            name: if active {
                "repeated staff reactivation"
            } else {
                "repeated staff deactivation"
            },
            method: Method::POST,
            path: format!(
                "/api/v2/admin/staff/{}/{}",
                fixture.target_staff,
                if active { "reactivate" } else { "deactivate" }
            ),
            body: None,
        };
        let before = lifecycle_evidence(&fixture).await;
        assert!(
            before.active != active,
            "each first command really transitions the current status"
        );
        lifecycle_success(operation.send(app, &token).await).await;
        let saved = lifecycle_evidence(&fixture).await;
        assert!(saved.active == active && saved.version == before.version+1 && saved.audit_count == before.audit_count+1,
            "first transition updates current status, revokes old authority and records one business audit");
        let fresh_token = if active {
            let (fresh, _, _) = login(app.clone(), "factor-target@hms.local").await;
            assert_eq!(account_status(app, &fresh).await, StatusCode::OK);
            Some(fresh)
        } else {
            assert_eq!(
                account_status(app, &old_target_token).await,
                StatusCode::UNAUTHORIZED
            );
            None
        };
        let saved = lifecycle_evidence(&fixture).await;
        lifecycle_success(operation.send(app, &token).await).await;
        repeated_outcomes.push((
            active,
            "sequential evidence preserved",
            lifecycle_evidence(&fixture).await == saved,
        ));

        let mut held = pool.begin().await.unwrap();
        let blocker: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await
            .unwrap();
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE")
            .bind(fixture.target)
            .execute(&mut *held)
            .await
            .unwrap();
        let pending: Vec<_> = (0..2)
            .map(|_| {
                let operation = operation.clone();
                let app = app.clone();
                let token = token.clone();
                tokio::spawn(async move { operation.send(&app, &token).await })
            })
            .collect();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let count: i64 = sqlx::query_scalar(
                    "WITH RECURSIVE blocked(pid) AS (
                       SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
                       UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=current_database())
                     SELECT count(*) FROM pg_stat_activity a JOIN blocked b USING(pid) WHERE a.wait_event_type='Lock' AND strpos(a.query,'users')>0",
                ).bind(blocker).fetch_one(&pool).await.unwrap();
                if count >= 2 { break; }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.expect("both real lifecycle requests reach the actual held user-row blocking chain");
        held.commit().await.unwrap();
        for participant in pending {
            let response = tokio::time::timeout(std::time::Duration::from_secs(8), participant)
                .await
                .expect("bounded lifecycle participant")
                .unwrap();
            lifecycle_success(response).await;
        }
        repeated_outcomes.push((
            active,
            "concurrent evidence preserved",
            lifecycle_evidence(&fixture).await == saved,
        ));
        if let Some(fresh) = fresh_token {
            repeated_outcomes.push((
                active,
                "genuine newer session remains authorized",
                account_status(app, &fresh).await == StatusCode::OK,
            ));
        }
    }
    // Run both actual transitions and concurrent participants before reporting
    // static booleans; an unpatched deactivation must not hide reactivation's
    // separate revocation of a genuinely established newer session.
    assert!(
        repeated_outcomes.iter().all(|(_, _, preserved)| *preserved),
        "same-state staff lifecycle evidence: {repeated_outcomes:?}"
    );
}

#[tokio::test]
async fn failed_setup_delivery_is_definite_only_after_confirmed_account_compensation() {
    use hms_api::config::{AccountSetupDeliveryConfig, AccountSetupDeliveryMode};
    let mut outcomes = Vec::new();
    for cleanup in ["error", "skipped", "removed"] {
        // The only delivery endpoint is this test-owned ephemeral loopback
        // listener. No email is sent and no request body is logged or saved.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let webhook = tokio::spawn(async move {
            axum::serve(
                listener,
                axum::Router::new().route(
                    "/",
                    axum::routing::post(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
                ),
            )
            .await
            .unwrap();
        });
        let database = Arc::new(hms_db::test_support::TestDatabase::create().unwrap());
        let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
        config.account_setup_delivery = AccountSetupDeliveryConfig {
            mode: AccountSetupDeliveryMode::Webhook,
            webhook_url: Some(format!("http://{address}/")),
            public_app_url: Some("http://localhost".into()),
            timeout: std::time::Duration::from_secs(1),
        };
        let app = app_with_config(config, database).await;
        grant_test_permission(
            &app,
            Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
            PermissionCode::AdminStaffManage,
        )
        .await;
        let (token, _, _) = login(app.clone(), "owner@hms.local").await;
        let pool = app.db_pool().await;
        match cleanup {
            "error" => {
                sqlx::raw_sql("CREATE FUNCTION reject_outcome_account_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_COMPENSATION_DETAIL'; END $$; CREATE TRIGGER reject_outcome_account_cleanup BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION reject_outcome_account_cleanup();")
                    .execute(&pool).await.unwrap();
            }
            "skipped" => {
                sqlx::raw_sql("CREATE FUNCTION retain_outcome_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER retain_outcome_account BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION retain_outcome_account();")
                    .execute(&pool).await.unwrap();
            }
            _ => {}
        }
        let operation = Operation {
            name: "staff creation with failed setup delivery",
            method: Method::POST,
            path: "/api/v2/admin/staff".into(),
            body: Some(
                json!({"email":"outcome-delivery@hms.local","display_name":"Synthetic delivery outcome","department":"Synthetic","position":"Synthetic","hire_date":"2026-10-17","practitioner_profile":null}),
            ),
        };
        let response = operation.send(&app, &token).await;
        webhook.abort();
        let status = response.status();
        let body = json_body(response).await;
        safe_error(&body);
        assert!(!body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("SYNTHETIC_PRIVATE_COMPENSATION_DETAIL"));
        let retained: (i64,i64,i64,i64,i64) = sqlx::query_as(
            "SELECT
              (SELECT count(*) FROM users WHERE facility_id=$1 AND email='outcome-delivery@hms.local'),
              (SELECT count(*) FROM staff_profiles s JOIN users u ON u.id=s.user_id WHERE s.facility_id=$1 AND u.email='outcome-delivery@hms.local'),
              (SELECT count(*) FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.facility_id=$1 AND u.email='outcome-delivery@hms.local'),
              (SELECT count(*) FROM domain_events WHERE facility_id=$1 AND event_type='admin.staff_account_setup_requested'),
              (SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type='admin.staff.create_delivery_compensated')",
        ).bind(app.state().facility_id()).fetch_one(&pool).await.unwrap();
        match cleanup {
            "error" => assert!(retained == (1,1,1,1,0), "failed compensation leaves the committed account, setup token and event intact"),
            "skipped" => assert!(retained == (1,1,1,0,0), "zero-row compensation retains the account and setup token without claiming successful removal"),
            _ => assert!(retained == (0,0,0,0,1), "confirmed compensation removes all account material and records its successful compensation"),
        }
        let expected = if cleanup == "removed" {
            "staff_account_setup_delivery_failed"
        } else {
            "staff_create_write_unconfirmed"
        };
        outcomes.push((
            cleanup,
            status,
            body["error"]["code"].as_str().unwrap().to_owned(),
            expected,
        ));
    }
    assert!(
        outcomes.iter().all(
            |(_, status, actual, expected)| *status == StatusCode::CONFLICT
                && actual.as_str() == *expected
        ),
        "safe compensation classifications: {outcomes:?}"
    );
}
