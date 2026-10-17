//! Actual HTTP publication regressions; six unpatched behavioral failures were
//! reproduced before the business network-proof repair. Existing genuine-factor
//! fixtures and canonical policy publication cross the production interfaces.
//! No production bypass, fabricated factor, or direct network-policy SQL.
mod support;
use support::*;
#[path = "auth_factor_matrix/mod.rs"]
mod matrix;
use axum::response::Response;
use hms_domain::network::{NetworkOffsiteMode, UpdateNetworkPolicyRequest};
use std::time::Duration as WallDuration;
use tokio::task::JoinHandle;

const RX_MARKER: &str = "SYNTHETIC-P14-PROTECTED-INSTRUCTIONS";
const FLUID_MARKER: &str = "SYNTHETIC-P14-PROTECTED-FLUID";

// Never format SQL errors, response bodies, IDs, tokens, or clinical strings in
// assertions. Existing isolated support retains its own normal setup checks.
fn must<T, E>(result: Result<T, E>, message: &'static str) -> T {
    match result {
        Ok(value) => value,
        Err(_) => panic!("{message}"),
    }
}
fn id(value: &Value, field: &str) -> Uuid {
    must(
        Uuid::parse_str(value[field].as_str().expect("fixture has opaque identity")),
        "fixture identity parses",
    )
}
async fn body(response: Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded body reads",
    );
    (
        status,
        must(serde_json::from_slice(&bytes), "typed JSON response"),
    )
}
async fn checked(response: Response, expected: StatusCode) -> Value {
    let (status, value) = body(response).await;
    assert_eq!(
        status,
        expected,
        "static route status; typed code {}",
        value["error"]["code"].as_str().unwrap_or("none")
    );
    value
}
fn validate_denial(status: StatusCode, value: &Value) {
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "static route status; typed code {}",
        value["error"]["code"].as_str().unwrap_or("none")
    );
    let code = value["error"]["code"].as_str().expect("denial is typed");
    // The final shared mapper/code is a phase14 contract choice. Do not accept
    // an unknown-write response as proof of a definite pre-publication rollback.
    assert!(
        !code.ends_with("_unconfirmed"),
        "definite policy denial required"
    );
    assert!(
        value.get("data").is_none_or(Value::is_null),
        "denial has no clinical data"
    );
    let encoded = value.to_string();
    assert!(
        !encoded.contains(RX_MARKER),
        "denial excludes prescription narrative"
    );
    assert!(
        !encoded.contains(FLUID_MARKER),
        "denial excludes fluid narrative"
    );
}
async fn denied(response: Response) -> Value {
    let (status, value) = body(response).await;
    validate_denial(status, &value);
    value
}
async fn denied_in_scope(response: Response, identities: &[Uuid]) {
    let (status, value) = body(response).await;
    let encoded = value.to_string();
    eprintln!("publication_response status={} data_present={} private_marker_present={} selected_identity_present={}", status.as_u16(), value.get("data").is_some_and(|data| !data.is_null()), encoded.contains(RX_MARKER) || encoded.contains(FLUID_MARKER), identities.iter().any(|identity| encoded.contains(&identity.to_string())));
    validate_denial(status, &value);
    assert!(
        value["error"]["code"] == "network_policy_changed",
        "in-flight stale business proof has the canonical definite code"
    );
    assert!(
        identities
            .iter()
            .all(|identity| !encoded.contains(&identity.to_string())),
        "denial does not echo selected clinical resource identities"
    );
}
async fn send(
    app: &TestApp,
    token: &str,
    method: Method,
    path: String,
    input: Option<Value>,
) -> Response {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header("x-request-id", Uuid::new_v4().to_string());
    let payload = match input {
        Some(value) => {
            request = request.header("content-type", "application/json");
            Body::from(must(serde_json::to_vec(&value), "fixture JSON encodes"))
        }
        None => Body::empty(),
    };
    let request = must(request.body(payload), "fixture request builds");
    must(
        app.clone().oneshot(request).await,
        "actual HTTP route responds",
    )
}

// The named operator repository path is also used by the real bootstrap CLI.
// No fake administrator, current-connection override, or direct policy UPDATE.
async fn operator_deny(app: &TestApp) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let current = must(
        hms_db::network::get_policy(&pool, facility).await,
        "current policy reads",
    );
    let result = must(
        hms_db::network::update_policy(
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
                // Excludes the genuine TestApp loopback transport. This is an
                // explicit synthetic range, never a claim about a real client.
                onsite_cidrs: vec!["192.0.2.254/32".into()],
                offsite_mode: NetworkOffsiteMode::Deny,
                reason: "Synthetic reviewed publication ordering".into(),
            },
            None,
        )
        .await,
        "canonical operator policy publication succeeds",
    );
    assert_eq!(result.policy.version, current.version + 1);
    assert_eq!(result.policy.offsite_mode, NetworkOffsiteMode::Deny);
}
async fn spawn_deny(app: &TestApp) -> JoinHandle<()> {
    let copy = app.clone();
    tokio::spawn(async move { operator_deny(&copy).await })
}
async fn join_released<T>(mut task: JoinHandle<T>, message: &'static str) -> T {
    match tokio::time::timeout(WallDuration::from_secs(6), &mut task).await {
        Ok(result) => must(result, message),
        Err(_) => {
            task.abort();
            panic!("released participant must terminate; timeout is not publication evidence");
        }
    }
}

// Query only backend relationships in the current isolated database. The PIDs
// and query text stay in RAM; all diagnostics are static. A timeout is a harness
// failure, not evidence that a particular lock/publication order was observed.
async fn source_waiter(
    pool: &hms_db::PgPool,
    blocker_pid: i32,
    query_fragment: &'static str,
    command: &JoinHandle<Response>,
) -> i32 {
    must(
        tokio::time::timeout(WallDuration::from_secs(3), async {
            loop {
                let waiter: Option<i32> = must(sqlx::query_scalar(
                    "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0 LIMIT 1"
                ).bind(blocker_pid).bind(query_fragment).fetch_optional(pool).await, "source wait graph reads");
                if let Some(pid) = waiter { return pid; }
                assert!(!command.is_finished(), "actual route must reach held source/audit");
                tokio::time::sleep(WallDuration::from_millis(10)).await;
            }
        }).await,
        "actual route source/audit wait must be observed",
    )
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum PublicationOrder {
    PublishedBeforeBusinessProof,
    WaitingBehindBusinessProof,
    HarnessFailure,
}
impl PublicationOrder {
    fn label(self) -> &'static str {
        match self {
            Self::PublishedBeforeBusinessProof => "published_before_business_proof",
            Self::WaitingBehindBusinessProof => "waiting_behind_business_proof",
            Self::HarnessFailure => "harness_failure",
        }
    }
}
async fn publication_order(
    pool: &hms_db::PgPool,
    command_pid: i32,
    publisher: &JoinHandle<()>,
) -> PublicationOrder {
    match tokio::time::timeout(WallDuration::from_secs(3), async {
        loop {
            let blocked: bool = must(sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,'facility_network_policies')>0)"
            ).bind(command_pid).fetch_one(pool).await, "policy wait graph reads");
            if blocked { return PublicationOrder::WaitingBehindBusinessProof; }
            if publisher.is_finished() { return PublicationOrder::PublishedBeforeBusinessProof; }
            tokio::time::sleep(WallDuration::from_millis(10)).await;
        }
    }).await {
        Ok(order) => order,
        Err(_) => PublicationOrder::HarnessFailure,
    }
}
async fn fresh_request_denied(app: &TestApp, token: &str, path: String) {
    denied(send(app, token, Method::GET, path, None).await).await;
    // Revocation policy must not accidentally remove the documented own-auth
    // lifecycle/read exemption while it denies clinical publication.
    checked(
        send(app, token, Method::GET, "/api/v2/auth/me".into(), None).await,
        StatusCode::OK,
    )
    .await;
}

struct ClinicalFixture {
    app: TestApp,
    token: String,
    patient: Uuid,
    admission: Uuid,
}
impl ClinicalFixture {
    async fn new(unconfigured: bool) -> Self {
        let app = if unconfigured {
            app_without_network_policy().await
        } else {
            app().await
        };
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        for permission in [
            PermissionCode::PatientDemographicsView,
            PermissionCode::ClinicalDocumentationView,
            PermissionCode::ClinicalDocumentationManage,
            PermissionCode::NursingTaskManage,
            PermissionCode::WardBoardViewAll,
        ] {
            grant_test_permission(&app, owner, permission).await;
        }
        for feature in [
            FeatureKey::Patients,
            FeatureKey::Encounters,
            FeatureKey::Nursing,
        ] {
            grant_test_feature(&app, owner, feature).await;
        }
        for visibility in [
            PatientDataVisibility::Demographics,
            PatientDataVisibility::FullClinical,
        ] {
            grant_test_patient_visibility(&app, owner, visibility).await;
        }
        let pool = app.db_pool().await;
        let facility = app.state().facility_id();
        let patient: Uuid = must(sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' AND vital_status<>'deceased' ORDER BY id LIMIT 1").bind(facility).fetch_one(&pool).await, "registered synthetic patient exists");
        let ward: Uuid = must(
            sqlx::query_scalar(
                "SELECT id FROM wards WHERE facility_id=$1 AND status='active' ORDER BY id LIMIT 1",
            )
            .bind(facility)
            .fetch_one(&pool)
            .await,
            "active selected ward exists",
        );
        let admission: Uuid = must(sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,'admitted') RETURNING id").bind(facility).bind(patient).bind(ward).fetch_one(&pool).await, "explicit selected admission created");
        must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING").bind(facility).bind(owner).bind(patient).execute(&pool).await, "ordinary clinical relationship exists");
        let practitioner =
            create_test_practitioner_for_user(&app, owner, "P14-STAFF", "P14-LICENSE").await;
        must(sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES(gen_random_uuid(),$1,$2,$3,'staff_nurse','Nurse','nursing') ON CONFLICT DO NOTHING").bind(facility).bind(ward).bind(practitioner).execute(&pool).await, "actual local ward assignment exists");
        // This is the real options -> registration -> assertion login helper;
        // the owner has an actual runtime signing key, never fabricated JSON.
        let (token, _, _) = login(app.clone(), "owner@hms.local").await;
        if unconfigured {
            let count: i64 = must(
                sqlx::query_scalar(
                    "SELECT count(*) FROM facility_network_policies WHERE facility_id=$1",
                )
                .bind(facility)
                .fetch_one(&pool)
                .await,
                "unconfigured policy absence reads",
            );
            assert_eq!(
                count, 0,
                "true-v0 fixture has no policy row or previous publication"
            );
        }
        Self {
            app,
            token,
            patient,
            admission,
        }
    }
    async fn prescription(&self) -> Value {
        checked(send(&self.app, &self.token, Method::POST,
            format!("/api/v2/patients/{}/clinical/prescriptions", self.patient),
            Some(json!({"medication_name":"Synthetic publication review","dose":"Reviewed clinical dose","route":"oral","frequency":"daily","instructions":RX_MARKER,"reason":"Synthetic explicit indication","duration_days":7,"start_date":Utc::now().date_naive()}))).await,
            StatusCode::OK).await["data"].clone()
    }
    // Imported clinical data is a fixture, not a policy or proof bypass. This
    // also permits a genuine no-policy v0 *read* without first enabling writes.
    async fn fluid(&self) -> Uuid {
        let pool = self.app.db_pool().await;
        must(sqlx::query_scalar("INSERT INTO fluid_balance_entries(id,facility_id,patient_id,admission_case_id,recorded_at,intake_ml,output_ml,metadata) VALUES(gen_random_uuid(),$1,$2,$3,clock_timestamp()-interval '1 minute',100,20,$4) RETURNING id")
            .bind(self.app.state().facility_id()).bind(self.patient).bind(self.admission)
            .bind(json!({"intake_category":"oral","output_category":"urine","notes":FLUID_MARKER}))
            .fetch_one(&pool).await, "synthetic observation and canonical root trigger inserted")
    }
}
async fn rx_evidence(f: &ClinicalFixture, source: Uuid) -> Value {
    must(sqlx::query_scalar("SELECT jsonb_build_object('source',(SELECT to_jsonb(p) FROM prescriptions p WHERE p.facility_id=$1 AND p.id=$2),'commands',(SELECT count(*) FROM prescription_commands WHERE facility_id=$1 AND source_prescription_id=$2),'provenance',(SELECT count(*) FROM prescription_course_provenance WHERE facility_id=$1 AND source_prescription_id=$2),'patient_prescriptions',(SELECT count(*) FROM prescriptions WHERE facility_id=$1 AND patient_id=$3),'courses',(SELECT count(*) FROM medication_courses WHERE facility_id=$1 AND patient_id=$3),'mar',(SELECT count(*) FROM medication_administrations WHERE facility_id=$1 AND patient_id=$3),'fulfillments',(SELECT count(*) FROM pharmacy_fulfillments WHERE facility_id=$1 AND patient_id=$3),'audit',(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type LIKE 'prescription.%'))")
        .bind(f.app.state().facility_id()).bind(source).bind(f.patient)
        .fetch_one(&f.app.db_pool().await).await, "scoped prescription business evidence reads")
}
async fn fluid_evidence(f: &ClinicalFixture, entry: Uuid) -> Value {
    must(sqlx::query_scalar("SELECT jsonb_build_object('root',(SELECT to_jsonb(r) FROM fluid_observation_roots r WHERE r.facility_id=$1 AND r.id=$2),'entries',(SELECT count(*) FROM fluid_balance_entries WHERE facility_id=$1 AND patient_id=$3 AND admission_case_id=$4),'actions',(SELECT count(*) FROM fluid_observation_actions WHERE facility_id=$1 AND root_entry_id=$2),'commands',(SELECT count(*) FROM fluid_write_commands WHERE facility_id=$1),'audit',(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type LIKE 'fluid.%'))")
        .bind(f.app.state().facility_id()).bind(entry).bind(f.patient).bind(f.admission)
        .fetch_one(&f.app.db_pool().await).await, "scoped fluid business evidence reads")
}

async fn rx_source_wait_policy_wins(replacement: bool) {
    let f = ClinicalFixture::new(false).await;
    let source = f.prescription().await;
    let source_id = id(&source, "id");
    let before = rx_evidence(&f, source_id).await;
    let pool = f.app.db_pool().await;
    let mut held = must(pool.begin().await, "source barrier begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "source backend identified privately",
    );
    must(
        sqlx::query("SELECT id FROM prescriptions WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(f.app.state().facility_id())
            .bind(source_id)
            .fetch_one(&mut *held)
            .await,
        "source prescription held",
    );
    let input = if replacement {
        json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":source["snapshot_token"],"relation":"replacement","change_reason":"Synthetic explicit replacement","medication_name":"Synthetic reviewed successor","dose":"Reviewed successor dose","route":"oral","frequency":"bid","instructions":"Synthetic successor instructions","reason":"Synthetic successor indication","start_date":Utc::now().date_naive(),"duration_days":4,"first_dose_at":null,"encounter_id":null,"visit_id":null,"inventory_item_id":null,"expected_stock_unit":null,"prn_policy":null,"scheduled_stock_policy":null})
    } else {
        json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":source["snapshot_token"],"instructions":"Synthetic reviewed update","reason":"Synthetic reviewed indication"})
    };
    let copy = f.app.clone();
    let token = f.token.clone();
    let path = format!(
        "/api/v2/clinical/prescriptions/{source_id}/{}",
        if replacement {
            "new-course"
        } else {
            "documentation"
        }
    );
    let command = tokio::spawn(async move {
        send(
            &copy,
            &token,
            if replacement {
                Method::POST
            } else {
                Method::PATCH
            },
            path,
            Some(input),
        )
        .await
    });
    source_waiter(&pool, pid, "prescriptions", &command).await;
    // Source acquisition precedes this family's live proof. Operator publication
    // must finish *while the source remains held*, then the old proof is stale.
    let mut publisher = spawn_deny(&f.app).await;
    let publication = tokio::time::timeout(WallDuration::from_secs(3), &mut publisher).await;
    must(
        held.commit().await,
        "release source before any assertion/join",
    );
    let response = join_released(command, "blocked prescription route joins").await;
    match publication {
        Ok(joined) => must(joined, "operator publication task joins"),
        Err(_) => {
            join_released(publisher, "late operator task joins after source release").await;
            panic!("operator must win before source release");
        }
    }
    let after = rx_evidence(&f, source_id).await;
    eprintln!("prescription_publication replacement={} operator_won_before_source_release=true business_unchanged={} source_changed={} source_stopped={} commands_changed={} successors_changed={} audit_changed={}", replacement, before == after, before["source"] != after["source"], after["source"]["status"] == "stopped", before["commands"] != after["commands"], before["provenance"] != after["provenance"], before["audit"] != after["audit"]);
    denied_in_scope(response, &[source_id, f.patient, f.admission]).await;
    assert!(before == after, "rejected documentation/replacement preserves source, commands, successors, MAR, demand and business audit");
    fresh_request_denied(
        &f.app,
        &f.token,
        format!("/api/v2/clinical/prescriptions/{source_id}"),
    )
    .await;
}
#[tokio::test]
async fn documentation_source_wait_rejects_policy_published_before_live_proof() {
    rx_source_wait_policy_wins(false).await;
}
#[tokio::test]
async fn replacement_source_wait_rejects_policy_without_stopping_source_or_adding_successor() {
    rx_source_wait_policy_wins(true).await;
}

async fn fluid_read_wait_policy_wins(unconfigured: bool) {
    let f = ClinicalFixture::new(unconfigured).await;
    let entry = f.fluid().await;
    let path = format!("/api/v2/nursing/fluid-observations/{entry}");
    if !unconfigured {
        let live = checked(
            send(&f.app, &f.token, Method::GET, path.clone(), None).await,
            StatusCode::OK,
        )
        .await;
        assert!(
            live.to_string().contains(FLUID_MARKER),
            "authorized Full control returns genuine fixture narrative"
        );
    } else {
        // This must be the FIRST rich request, not a warmed positive read that
        // could legitimately materialize a future unchanged default sentinel.
        // The configured counterpart above proves the identical fixture gates.
        let policy = must(
            hms_db::network::get_policy(&f.app.db_pool().await, f.app.state().facility_id()).await,
            "default policy reads",
        );
        assert!(
            !policy.configured && policy.version == 0,
            "v0 control remains unconfigured/read-only"
        );
        let count: i64 = must(
            sqlx::query_scalar(
                "SELECT count(*) FROM facility_network_policies WHERE facility_id=$1",
            )
            .bind(f.app.state().facility_id())
            .fetch_one(&f.app.db_pool().await)
            .await,
            "first rich request starts with absent policy row",
        );
        assert_eq!(
            count, 0,
            "v0 race must not be accidentally primed by a read"
        );
    }
    let before = fluid_evidence(&f, entry).await;
    let pool = f.app.db_pool().await;
    let mut held = must(pool.begin().await, "fluid root barrier begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "fluid barrier backend identified privately",
    );
    must(
        sqlx::query(
            "SELECT id FROM fluid_observation_roots WHERE facility_id=$1 AND id=$2 FOR UPDATE",
        )
        .bind(f.app.state().facility_id())
        .bind(entry)
        .fetch_one(&mut *held)
        .await,
        "actual observation root held",
    );
    let copy = f.app.clone();
    let token = f.token.clone();
    let pending_path = path.clone();
    let command =
        tokio::spawn(async move { send(&copy, &token, Method::GET, pending_path, None).await });
    source_waiter(&pool, pid, "fluid_observation_roots", &command).await;
    let mut publisher = spawn_deny(&f.app).await;
    let publication = tokio::time::timeout(WallDuration::from_secs(3), &mut publisher).await;
    must(
        held.commit().await,
        "release fluid root before assertions/joins",
    );
    let response = join_released(command, "blocked rich fluid route joins").await;
    match publication {
        Ok(joined) => must(joined, "operator publication task joins"),
        Err(_) => {
            join_released(publisher, "late operator task joins after root release").await;
            panic!("operator first publication must finish before root release");
        }
    }
    let after = fluid_evidence(&f, entry).await;
    eprintln!(
        "fluid_publication true_v0={} operator_won_before_root_release=true business_unchanged={}",
        unconfigured,
        before == after
    );
    denied_in_scope(response, &[entry, f.patient, f.admission]).await;
    assert!(
        before == after,
        "denied rich read leaves exact clinical evidence and audit unchanged"
    );
    fresh_request_denied(&f.app, &f.token, path).await;
}
#[tokio::test]
async fn rich_fluid_read_wait_does_not_publish_narrative_after_operator_deny_wins() {
    fluid_read_wait_policy_wins(false).await;
}
#[tokio::test]
async fn true_v0_first_policy_publication_fences_inflight_rich_read_without_granting_writes() {
    fluid_read_wait_policy_wins(true).await;
}

async fn lab_evidence(app: &TestApp, result: Uuid) -> Value {
    must(sqlx::query_scalar("SELECT jsonb_build_object('result',(SELECT jsonb_build_object('status',r.status,'verified_at',r.verified_at,'verified_by',r.verified_by_user_id,'updated_at',r.updated_at) FROM lab_results r WHERE r.facility_id=$1 AND r.id=$2),'order_status',(SELECT o.status FROM lab_orders o JOIN lab_results r ON r.order_id=o.id AND r.facility_id=o.facility_id WHERE r.facility_id=$1 AND r.id=$2),'audit',(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND resource_id=$2 AND event_type='laboratory.result.verified'))")
        .bind(app.state().facility_id()).bind(result).fetch_one(&app.db_pool().await).await,
        "scoped lab state and verification audit reads")
}
#[tokio::test]
async fn genuinely_factor_verified_lab_source_wait_has_one_policy_publication_order() {
    let m = matrix::Matrix::new().await;
    let app = &m.app; // Keep the original TestApp/isolated-DB guard alive.
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    for feature in [FeatureKey::Patients, FeatureKey::Laboratory] {
        grant_test_feature(app, owner, feature).await;
    }
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    let genuine: bool = must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM auth_session_assurance WHERE facility_id=$1 AND user_id=$2 AND session_id=$3 AND method='passkey' AND credential_id IS NOT NULL AND verified_at<=clock_timestamp() AND expires_at>clock_timestamp())")
        .bind(app.state().facility_id()).bind(owner).bind(claims.session_id).fetch_one(&pool).await,
        "real signed passkey session evidence reads");
    assert!(
        genuine,
        "privileged positive uses actual runtime assertion, not enrollment/password/recovery"
    );
    let path = format!("/api/v2/laboratory/results/{}", m.result);
    checked(
        send(app, &token, Method::GET, path.clone(), None).await,
        StatusCode::OK,
    )
    .await;
    let before = lab_evidence(app, m.result).await;
    let mut held = must(pool.begin().await, "lab result barrier begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "lab barrier backend identified privately",
    );
    must(
        sqlx::query("SELECT id FROM lab_results WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(app.state().facility_id())
            .bind(m.result)
            .fetch_one(&mut *held)
            .await,
        "actual lab result parent held",
    );
    let operation = m
        .operations
        .iter()
        .find(|operation| operation.name == "laboratory verify")
        .expect("real lab verify operation exists")
        .clone();
    let copy = app.clone();
    let pending_token = token.clone();
    let command = tokio::spawn(async move {
        send(
            &copy,
            &pending_token,
            operation.method,
            operation.path,
            operation.body,
        )
        .await
    });
    let command_pid = source_waiter(&pool, pid, "lab_results", &command).await;
    let publisher = spawn_deny(app).await;
    let order = publication_order(&pool, command_pid, &publisher).await;
    // Always release before waiting for the policy writer: if the command owns
    // a policy SHARE proof, waiting for that writer first would self-deadlock.
    must(
        held.commit().await,
        "release lab parent before joining either participant",
    );
    let response = join_released(command, "lab verify route joins").await;
    join_released(publisher, "operator policy task joins").await;
    let after = lab_evidence(app, m.result).await;
    eprintln!(
        "laboratory_publication order={} business_unchanged={} result_verified={} audit_changed={}",
        order.label(),
        before == after,
        after["result"]["status"] == "verified",
        before["audit"] != after["audit"]
    );
    match order {
        PublicationOrder::WaitingBehindBusinessProof => {
            checked(response, StatusCode::OK).await;
            let state: (String, bool, i64) = must(sqlx::query_as("SELECT r.status,r.verified_at IS NOT NULL,(SELECT count(*) FROM audit_events a WHERE a.facility_id=r.facility_id AND a.resource_id=r.id AND a.event_type='laboratory.result.verified') FROM lab_results r WHERE r.facility_id=$1 AND r.id=$2").bind(app.state().facility_id()).bind(m.result).fetch_one(&pool).await, "verified lab state reads");
            assert!(
                state.0 == "verified" && state.1 && state.2 == 1,
                "one verification and one audit precede policy publication"
            );
        }
        PublicationOrder::PublishedBeforeBusinessProof => {
            denied_in_scope(response, &[m.result]).await;
            assert!(
                before == after,
                "policy-winning denial has no result/order/audit effect"
            );
        }
        PublicationOrder::HarnessFailure => {
            panic!("no actual publication/wait ordering was observed")
        }
    }
    fresh_request_denied(app, &token, path).await;
}

#[tokio::test]
async fn operator_publication_waits_for_business_proof_through_final_documentation_audit() {
    let f = ClinicalFixture::new(false).await;
    let source = f.prescription().await;
    let source_id = id(&source, "id");
    let pool = f.app.db_pool().await;
    // Only this business audit is gated. Network-policy audit must remain free
    // so a missing business policy proof cannot look blocked for another reason.
    must(sqlx::raw_sql("CREATE FUNCTION phase14_documentation_audit_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='prescription.documentation.updated' THEN PERFORM pg_advisory_xact_lock(7140014); END IF; RETURN NEW; END $$; CREATE TRIGGER phase14_documentation_audit_gate BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION phase14_documentation_audit_gate();").execute(&pool).await, "isolated target-only audit gate installed");
    let mut held = must(pool.begin().await, "audit gate holder begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "audit barrier backend identified privately",
    );
    must(
        sqlx::query("SELECT pg_advisory_xact_lock(7140014)")
            .execute(&mut *held)
            .await,
        "test owns final audit barrier",
    );
    let copy = f.app.clone();
    let token = f.token.clone();
    let command = tokio::spawn(async move {
        send(&copy, &token, Method::PATCH, format!("/api/v2/clinical/prescriptions/{source_id}/documentation"), Some(json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":source["snapshot_token"],"instructions":"Synthetic protected post-proof update","reason":"Synthetic explicit review"}))).await
    });
    let command_pid = source_waiter(&pool, pid, "audit_events", &command).await;
    let publisher = spawn_deny(&f.app).await;
    let order = publication_order(&pool, command_pid, &publisher).await;
    // Cleanup precedes the ordering assertion so an unpatched RED does not
    // strand either participant or wait on an intentionally held proof.
    must(held.commit().await, "release final audit gate before joins");
    let response = join_released(command, "documentation route joins after audit release").await;
    join_released(
        publisher,
        "operator publication joins after business proof release",
    )
    .await;
    let counts: (i64, i64) = must(sqlx::query_as("SELECT (SELECT count(*) FROM prescription_commands WHERE facility_id=$1 AND source_prescription_id=$2 AND command_type='documentation'),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND resource_id=$2 AND event_type='prescription.documentation.updated')").bind(f.app.state().facility_id()).bind(source_id).fetch_one(&pool).await, "exact business command and audit counts read");
    eprintln!(
        "audit_publication order={} command_status={} one_command_saved={} one_audit_saved={}",
        order.label(),
        response.status().as_u16(),
        counts.0 == 1,
        counts.1 == 1
    );
    assert!(order == PublicationOrder::WaitingBehindBusinessProof, "operator must visibly wait on the actual business transaction policy proof through final audit");
    let saved = checked(response, StatusCode::OK).await;
    assert!(
        saved["data"]["prescription"]["instructions"] == "Synthetic protected post-proof update",
        "real committed receipt matches reviewed documentation"
    );
    assert_eq!(
        counts,
        (1, 1),
        "business publication is exactly one command and audit"
    );
    fresh_request_denied(
        &f.app,
        &f.token,
        format!("/api/v2/clinical/prescriptions/{source_id}"),
    )
    .await;
}

async fn rich_source_wait(
    f: &ClinicalFixture,
    source: Uuid,
    path: String,
    lock_sql: &'static str,
    query_fragment: &'static str,
) {
    checked(
        send(&f.app, &f.token, Method::GET, path.clone(), None).await,
        StatusCode::OK,
    )
    .await;
    let pool = f.app.db_pool().await;
    let before: i64 = must(sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type NOT LIKE 'network.%'").bind(f.app.state().facility_id()).fetch_one(&pool).await, "scoped business audit count reads");
    let mut held = must(pool.begin().await, "rich source barrier begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "rich source backend identified privately",
    );
    must(
        sqlx::query(lock_sql)
            .bind(f.app.state().facility_id())
            .bind(source)
            .fetch_one(&mut *held)
            .await,
        "actual selected rich source is held",
    );
    let copy = f.app.clone();
    let token = f.token.clone();
    let pending_path = path.clone();
    let command =
        tokio::spawn(async move { send(&copy, &token, Method::GET, pending_path, None).await });
    source_waiter(&pool, pid, query_fragment, &command).await;
    let mut publisher = spawn_deny(&f.app).await;
    let publication = tokio::time::timeout(WallDuration::from_secs(3), &mut publisher).await;
    must(
        held.commit().await,
        "release rich source before joins/assertions",
    );
    let response = join_released(command, "rich source route joins").await;
    match publication {
        Ok(joined) => must(joined, "rich source policy publication joins"),
        Err(_) => {
            join_released(publisher, "late rich source publisher joins").await;
            panic!("operator must win before rich source proof");
        }
    }
    denied_in_scope(response, &[source, f.patient, f.admission]).await;
    let after: i64 = must(sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type NOT LIKE 'network.%'").bind(f.app.state().facility_id()).fetch_one(&pool).await, "scoped business audit count rereads");
    assert_eq!(
        before, after,
        "rich read rejection adds no business evidence"
    );
    fresh_request_denied(&f.app, &f.token, path).await;
}

#[tokio::test]
async fn prescription_detail_publication_keeps_live_proof_after_source_wait() {
    let f = ClinicalFixture::new(false).await;
    let source = id(&f.prescription().await, "id");
    rich_source_wait(
        &f,
        source,
        format!("/api/v2/clinical/prescriptions/{source}"),
        "SELECT id FROM prescriptions WHERE facility_id=$1 AND id=$2 FOR UPDATE",
        "prescriptions",
    )
    .await;
}

#[tokio::test]
async fn original_prescription_receipt_publication_still_requires_current_network_proof() {
    let f = ClinicalFixture::new(false).await;
    let original = f.prescription().await;
    let source = id(&original, "id");
    let key = Uuid::new_v4();
    checked(send(&f.app, &f.token, Method::PATCH, format!("/api/v2/clinical/prescriptions/{source}/documentation"), Some(json!({"client_request_id":key,"expected_snapshot_token":original["snapshot_token"],"instructions":RX_MARKER,"reason":"Synthetic reviewed receipt"}))).await, StatusCode::OK).await;
    rich_source_wait(
        &f,
        source,
        format!("/api/v2/clinical/prescriptions/{source}/documentation/requests/{key}"),
        "SELECT id FROM prescriptions WHERE facility_id=$1 AND id=$2 FOR UPDATE",
        "prescriptions",
    )
    .await;
}

#[tokio::test]
async fn authored_note_sibling_read_cannot_publish_after_policy_wins_its_source_wait() {
    let f = ClinicalFixture::new(false).await;
    let made = checked(send(&f.app, &f.token, Method::POST, format!("/api/v2/patients/{}/clinical/notes/record", f.patient), Some(json!({"client_request_id":Uuid::new_v4(),"encounter_id":null,"template_revision_id":null,"note_type":"doctor_note","title":"Synthetic publication note","body":RX_MARKER}))).await, StatusCode::OK).await;
    let source = id(&made["data"]["note"], "id");
    rich_source_wait(
        &f,
        source,
        format!("/api/v2/clinical/notes/{source}"),
        "SELECT id FROM clinical_notes WHERE facility_id=$1 AND id=$2 FOR UPDATE",
        "clinical_notes",
    )
    .await;
}

#[tokio::test]
async fn handover_sibling_rich_read_cannot_publish_after_policy_wins_its_parent_wait() {
    let f = ClinicalFixture::new(false).await;
    let made = checked(send(&f.app, &f.token, Method::POST, "/api/v2/nursing/patient-handovers".into(), Some(json!({"client_request_id":Uuid::new_v4(),"patient_id":f.patient,"admission_case_id":f.admission,"shift_date":Utc::now().date_naive(),"shift_type":"night","intended_recipient_user_id":null,"narrative":{"patient_condition":RX_MARKER,"ongoing_issues":"Synthetic issue","pending_tasks":"Synthetic narrative only","medication_changes":"Synthetic reviewed narrative","key_events":"Synthetic event","care_plan_updates":"Synthetic plan","family_updates":"Synthetic family update"}}))).await, StatusCode::OK).await;
    let source = id(&made["data"]["handover"], "id");
    rich_source_wait(
        &f,
        source,
        format!("/api/v2/nursing/patient-handovers/{source}"),
        "SELECT id FROM patient_handovers WHERE facility_id=$1 AND id=$2 FOR UPDATE",
        "patient_handovers",
    )
    .await;
}

async fn prescribing_source_feature_wait(replacement: bool) {
    let mut f = ClinicalFixture::new(false).await;
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_permission(
        &f.app,
        owner,
        PermissionCode::AdminFeatureEntitlementsManage,
    )
    .await;
    grant_test_feature(&f.app, owner, FeatureKey::Admin).await;
    f.token = login(f.app.clone(), "owner@hms.local").await.0;
    let source = f.prescription().await;
    let source_id = id(&source, "id");
    let before = rx_evidence(&f, source_id).await;
    let pool = f.app.db_pool().await;
    let mut held = must(
        pool.begin().await,
        "feature publication source barrier begins",
    );
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "feature barrier backend identified privately",
    );
    must(
        sqlx::query("SELECT id FROM prescriptions WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(f.app.state().facility_id())
            .bind(source_id)
            .fetch_one(&mut *held)
            .await,
        "actual documentation source held",
    );
    let copy = f.app.clone();
    let token = f.token.clone();
    let (method, suffix, input) = if replacement {
        (
            Method::POST,
            "new-course",
            json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":source["snapshot_token"],"relation":"replacement","change_reason":"Synthetic explicit review","medication_name":"Synthetic reviewed successor","dose":"Reviewed dose","route":"oral","frequency":"daily","instructions":"Synthetic instruction","reason":"Synthetic indication","start_date":Utc::now().date_naive(),"duration_days":2}),
        )
    } else {
        (
            Method::PATCH,
            "documentation",
            json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":source["snapshot_token"],"instructions":"Synthetic explicit feature review","reason":"Synthetic explicit indication"}),
        )
    };
    let command = tokio::spawn(async move {
        send(
            &copy,
            &token,
            method,
            format!("/api/v2/clinical/prescriptions/{source_id}/{suffix}"),
            Some(input),
        )
        .await
    });
    source_waiter(&pool, pid, "prescriptions", &command).await;
    // Genuine privileged HTTP publication, not direct entitlement SQL. It wins
    // while the prescribing transaction has not yet acquired its facility proof.
    let publication = send(
        &f.app,
        &f.token,
        Method::PATCH,
        "/api/v2/admin/features/encounters".into(),
        Some(json!({"enabled":false})),
    )
    .await;
    must(
        held.commit().await,
        "release source before feature assertions/joins",
    );
    let response = join_released(command, "feature-wait documentation joins").await;
    checked(publication, StatusCode::OK).await;
    let after = rx_evidence(&f, source_id).await;
    eprintln!("prescribing_feature_publication replacement={} feature_disabled_before_source_release=true command_status={} business_unchanged={}", replacement, response.status().as_u16(), before == after);
    let error = checked(response, StatusCode::FORBIDDEN).await;
    assert!(
        error["error"]["code"] == "feature_disabled",
        "actual current feature denies the in-flight prescribing change"
    );
    assert!(before == after, "disabled feature leaves source, commands, provenance, stock demand and business audit unchanged");
}

#[tokio::test]
async fn documentation_source_wait_rechecks_canonical_feature_disable_before_publication() {
    prescribing_source_feature_wait(false).await;
}
#[tokio::test]
async fn replacement_source_wait_rechecks_feature_without_stopping_source_or_adding_successor() {
    prescribing_source_feature_wait(true).await;
}

#[tokio::test]
async fn documented_create_retains_its_live_feature_proof_through_care_context_wait() {
    let mut f = ClinicalFixture::new(false).await;
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_permission(
        &f.app,
        owner,
        PermissionCode::AdminFeatureEntitlementsManage,
    )
    .await;
    grant_test_feature(&f.app, owner, FeatureKey::Admin).await;
    f.token = login(f.app.clone(), "owner@hms.local").await.0;
    let pool = f.app.db_pool().await;
    let encounter: Uuid = must(sqlx::query_scalar("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status,created_by_user_id) VALUES(gen_random_uuid(),$1,$2,'outpatient','in_progress',$3) RETURNING id").bind(f.app.state().facility_id()).bind(f.patient).bind(owner).fetch_one(&pool).await, "actual selected encounter created");
    let mut held = must(pool.begin().await, "documented create care barrier begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "care barrier backend identified privately",
    );
    must(
        sqlx::query("SELECT id FROM encounters WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(f.app.state().facility_id())
            .bind(encounter)
            .fetch_one(&mut *held)
            .await,
        "actual care parent held",
    );
    let path = format!("/api/v2/patients/{}/clinical/prescriptions", f.patient);
    let input = json!({"encounter_id":encounter,"medication_name":"Synthetic documented create","dose":"Reviewed clinical dose","route":"oral","frequency":"daily","instructions":RX_MARKER,"reason":"Synthetic indication","start_date":Utc::now().date_naive(),"duration_days":2});
    let copy = f.app.clone();
    let token = f.token.clone();
    let command_path = path.clone();
    let command_input = input.clone();
    let command = tokio::spawn(async move {
        send(
            &copy,
            &token,
            Method::POST,
            command_path,
            Some(command_input),
        )
        .await
    });
    let command_pid = source_waiter(&pool, pid, "encounters", &command).await;
    let copy = f.app.clone();
    let token = f.token.clone();
    let publisher = tokio::spawn(async move {
        send(
            &copy,
            &token,
            Method::PATCH,
            "/api/v2/admin/features/encounters".into(),
            Some(json!({"enabled":false})),
        )
        .await
    });
    source_waiter(&pool, command_pid, "facilities", &publisher).await;
    must(
        held.commit().await,
        "release care parent before joining participants",
    );
    let saved = checked(
        join_released(command, "documented create joins").await,
        StatusCode::OK,
    )
    .await;
    checked(
        join_released(
            publisher,
            "feature writer joins after prescribing proof release",
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(
        saved["data"]["instructions"] == RX_MARKER,
        "documented create persisted reviewed narrative before feature disable"
    );
    let before: i64 = must(
        sqlx::query_scalar(
            "SELECT count(*) FROM prescriptions WHERE facility_id=$1 AND patient_id=$2",
        )
        .bind(f.app.state().facility_id())
        .bind(f.patient)
        .fetch_one(&pool)
        .await,
        "created prescription count reads",
    );
    let denied = checked(
        send(&f.app, &f.token, Method::POST, path, Some(input)).await,
        StatusCode::FORBIDDEN,
    )
    .await;
    assert!(
        denied["error"]["code"] == "feature_disabled",
        "subsequent create follows the new current feature state"
    );
    let after: i64 = must(
        sqlx::query_scalar(
            "SELECT count(*) FROM prescriptions WHERE facility_id=$1 AND patient_id=$2",
        )
        .bind(f.app.state().facility_id())
        .bind(f.patient)
        .fetch_one(&pool)
        .await,
        "post-denial prescription count reads",
    );
    assert_eq!(
        before, after,
        "disabled feature adds no duplicate prescription"
    );
}

#[tokio::test]
async fn prescribing_reads_preserve_facility_full_outpatient_and_historical_policy_without_care_relationship(
) {
    let mut f = ClinicalFixture::new(false).await;
    let pool = f.app.db_pool().await;
    let facility = f.app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    // A real outpatient has no care assignment, admission or authored note.
    // Prescribing's existing Full/View + demographics policy permits this read.
    f.patient = must(sqlx::query_scalar("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) VALUES(gen_random_uuid(),$1,'P14-NO-RELATION','Synthetic','Outpatient',DATE '2000-01-01','female','active') RETURNING id").bind(facility).fetch_one(&pool).await, "unrelated local outpatient created");
    let source = f.prescription().await;
    let source_id = id(&source, "id");
    let relationships: i64 = must(sqlx::query_scalar("SELECT (SELECT count(*) FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3)+(SELECT count(*) FROM clinical_notes WHERE facility_id=$1 AND created_by_user_id=$2 AND patient_id=$3)").bind(facility).bind(owner).bind(f.patient).fetch_one(&pool).await, "outpatient relationship absence checked");
    assert_eq!(
        relationships, 0,
        "fixture has no ordinary care relationship"
    );
    let key = Uuid::new_v4();
    checked(send(&f.app, &f.token, Method::PATCH, format!("/api/v2/clinical/prescriptions/{source_id}/documentation"), Some(json!({"client_request_id":key,"expected_snapshot_token":source["snapshot_token"],"instructions":RX_MARKER,"reason":"Synthetic historical indication"}))).await, StatusCode::OK).await;
    let detail = format!("/api/v2/clinical/prescriptions/{source_id}");
    let receipt =
        format!("/api/v2/clinical/prescriptions/{source_id}/documentation/requests/{key}");
    for historical in [false, true] {
        if historical {
            must(sqlx::query("UPDATE patients SET status='deceased',vital_status='deceased' WHERE facility_id=$1 AND id=$2").bind(facility).bind(f.patient).execute(&pool).await, "patient becomes historical without altering source evidence");
        }
        for path in [&detail, &receipt] {
            let result = checked(
                send(&f.app, &f.token, Method::GET, path.clone(), None).await,
                StatusCode::OK,
            )
            .await;
            assert!(
                result.to_string().contains(RX_MARKER),
                "authorized historical detail and own receipt retain protected evidence"
            );
        }
    }
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for permission in [
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&f.app, limited, permission).await;
    }
    for feature in [FeatureKey::Patients, FeatureKey::Encounters] {
        grant_test_feature(&f.app, limited, feature).await;
    }
    for visibility in [
        PatientDataVisibility::Demographics,
        PatientDataVisibility::ClinicalSummary,
    ] {
        grant_test_patient_visibility(&f.app, limited, visibility).await;
    }
    let limited_token = login(f.app.clone(), "limited@hms.local").await.0;
    for path in [&detail, &receipt] {
        denied(send(&f.app, &limited_token, Method::GET, path.clone(), None).await).await;
    }
    let foreign: Uuid = must(sqlx::query_scalar("INSERT INTO facilities(id,code,name,deployment_profile) VALUES(gen_random_uuid(),'P14-READ-FOREIGN','Synthetic foreign','hospital') RETURNING id").fetch_one(&pool).await, "foreign facility created");
    let foreign_patient: Uuid = must(sqlx::query_scalar("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) VALUES(gen_random_uuid(),$1,'P14-FOREIGN','Synthetic','Foreign',DATE '2000-01-01','female','active') RETURNING id").bind(foreign).fetch_one(&pool).await, "foreign synthetic patient created");
    let foreign_source: Uuid = must(sqlx::query_scalar("INSERT INTO prescriptions(id,facility_id,patient_id,medication_name,dose,route,frequency,status,instructions) VALUES(gen_random_uuid(),$1,$2,'Synthetic foreign medication','Reviewed dose','oral','daily','active',$3) RETURNING id").bind(foreign).bind(foreign_patient).bind(RX_MARKER).fetch_one(&pool).await, "foreign source evidence created");
    for path in [
        format!("/api/v2/clinical/prescriptions/{foreign_source}"),
        format!("/api/v2/clinical/prescriptions/{foreign_source}/documentation/requests/{key}"),
    ] {
        let result = checked(
            send(&f.app, &f.token, Method::GET, path, None).await,
            StatusCode::NOT_FOUND,
        )
        .await;
        assert!(
            !result.to_string().contains(RX_MARKER),
            "foreign detail and receipt reveal no protected narrative"
        );
    }
}

#[derive(Clone, Copy)]
enum TargetUserCommand {
    HandoverCreate,
    HandoverAmend,
    NursingTask,
    RoundSave,
    RoundCommit,
    MarWitness,
}
impl TargetUserCommand {
    fn label(self) -> &'static str {
        match self {
            Self::HandoverCreate => "handover_create",
            Self::HandoverAmend => "handover_amend",
            Self::NursingTask => "nursing_task",
            Self::RoundSave => "round_save",
            Self::RoundCommit => "round_commit",
            Self::MarWitness => "mar_witness",
        }
    }
}

// The active local target user is also a genuine signed-factor policy admin.
// Observe the actual lock graph, then release the clinical barrier before joins.
// Timeouts are harness failures, never evidence of a PostgreSQL deadlock.
async fn target_user_publication_order(kind: TargetUserCommand) {
    target_user_publication_ordered(kind, false).await;
}
async fn isolated_deadlocks(pool: &hms_db::PgPool) -> i64 {
    must(
        sqlx::query("SELECT pg_stat_clear_snapshot()")
            .execute(pool)
            .await,
        "isolated statistics snapshot refreshed",
    );
    must(
        sqlx::query_scalar(
            "SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()",
        )
        .fetch_one(pool)
        .await,
        "isolated deadlock counter reads",
    )
}
async fn target_clinical_evidence(f: &ClinicalFixture) -> Value {
    let pool = f.app.db_pool().await;
    must(sqlx::query_scalar("SELECT jsonb_build_object('handovers',(SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]'::jsonb) FROM patient_handovers h WHERE h.facility_id=$1 AND h.patient_id=$2),'revisions',(SELECT count(*) FROM patient_handover_revisions r JOIN patient_handovers h ON h.facility_id=r.facility_id AND h.id=r.handover_id WHERE h.facility_id=$1 AND h.patient_id=$2),'handover_commands',(SELECT count(*) FROM patient_handover_commands WHERE facility_id=$1 AND patient_id=$2),'tasks',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM nursing_tasks t WHERE t.facility_id=$1 AND t.patient_id=$2),'rounds',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM ward_rounds r WHERE r.facility_id=$1 AND r.patient_id=$2),'round_actions',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM ward_round_actions a WHERE a.facility_id=$1 AND a.patient_id=$2),'round_commands',(SELECT count(*) FROM ward_round_commands WHERE facility_id=$1 AND patient_id=$2),'mar',(SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb) FROM medication_administrations m WHERE m.facility_id=$1 AND m.patient_id=$2),'business_audit',(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type <> 'network.policy.updated'))").bind(f.app.state().facility_id()).bind(f.patient).fetch_one(&pool).await, "selected clinical evidence retained privately")
}
async fn target_user_publication_ordered(kind: TargetUserCommand, publisher_first: bool) {
    let f = ClinicalFixture::new(false).await;
    let pool = f.app.db_pool().await;
    let facility = f.app.state().facility_id();
    let recipient = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&f.app, recipient, PermissionCode::AdminAuthorityManage).await;
    grant_test_feature(&f.app, recipient, FeatureKey::Admin).await;
    let ward: Uuid = must(
        sqlx::query_scalar("SELECT ward_id FROM admission_cases WHERE facility_id=$1 AND id=$2")
            .bind(facility)
            .bind(f.admission)
            .fetch_one(&pool)
            .await,
        "selected admission ward reads",
    );
    let practitioner = create_test_practitioner_for_user(
        &f.app,
        recipient,
        "P14-RECIPIENT",
        "P14-RECIPIENT-LICENSE",
    )
    .await;
    must(sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES(gen_random_uuid(),$1,$2,$3,'staff_nurse','Nurse','nursing') ON CONFLICT DO NOTHING").bind(facility).bind(ward).bind(practitioner).execute(&pool).await, "target has actual active local nursing membership");
    let publisher_token = login(f.app.clone(), "limited@hms.local").await.0;
    let handover_input = json!({"client_request_id":Uuid::new_v4(),"patient_id":f.patient,"admission_case_id":f.admission,"shift_date":Utc::now().date_naive(),"shift_type":"night","intended_recipient_user_id":recipient,"narrative":{"patient_condition":"Synthetic target-user observation","ongoing_issues":"","pending_tasks":"","medication_changes":"","key_events":"","care_plan_updates":"","family_updates":""}});
    let round_input = json!({"client_request_id":Uuid::new_v4(),"ward_round_id":null,"expected_version":0,"admission_case_id":f.admission,"note_sections":{"interval_history":null,"examination":null,"assessment":"Synthetic target-user assessment","plan":null,"clinical_readiness_blockers":[]},"rendered_note":"Synthetic target-user round","actions":[{"action_type":"nursing_task","payload":{"title":"Synthetic target task","instruction":"Synthetic reviewed instruction","due_at":Utc::now(),"task_type":"ward_round","assigned_to_user_id":recipient}}]});
    let round_base = format!("/api/v2/patients/{}/chronicle/ward-rounds", f.patient);
    let (path, input, held_child) = match kind {
        TargetUserCommand::HandoverCreate => (
            "/api/v2/nursing/patient-handovers".to_owned(),
            handover_input,
            None,
        ),
        TargetUserCommand::HandoverAmend => {
            let mut initial = handover_input.clone();
            initial["intended_recipient_user_id"] = Value::Null;
            let saved = checked(
                send(
                    &f.app,
                    &f.token,
                    Method::POST,
                    "/api/v2/nursing/patient-handovers".into(),
                    Some(initial),
                )
                .await,
                StatusCode::OK,
            )
            .await;
            let root = id(&saved["data"]["handover"], "id");
            (
                format!("/api/v2/nursing/patient-handovers/{root}/amend"),
                json!({"client_request_id":Uuid::new_v4(),"expected_revision":1,"shift_date":Utc::now().date_naive(),"shift_type":"night","intended_recipient_user_id":recipient,"narrative":handover_input["narrative"],"reason":"Synthetic recipient correction"}),
                None,
            )
        }
        TargetUserCommand::NursingTask => (
            "/api/v2/nursing/tasks".to_owned(),
            json!({"patient_id":f.patient,"admission_case_id":f.admission,"task_type":"observation","title":"Synthetic target task","instruction":"Synthetic reviewed instruction","due_at":Utc::now(),"assigned_to_user_id":recipient}),
            None,
        ),
        TargetUserCommand::RoundSave => (format!("{round_base}/draft"), round_input, None),
        TargetUserCommand::RoundCommit => {
            let saved = checked(
                send(
                    &f.app,
                    &f.token,
                    Method::POST,
                    format!("{round_base}/draft"),
                    Some(round_input),
                )
                .await,
                StatusCode::OK,
            )
            .await;
            let root = id(&saved["data"]["ward_round"], "id");
            (
                format!("{round_base}/{root}/commit"),
                json!({"client_request_id":Uuid::new_v4(),"expected_version":1}),
                None,
            )
        }
        TargetUserCommand::MarWitness => {
            let saved = checked(send(&f.app, &f.token, Method::POST, "/api/v2/nursing/medication-administrations".into(), Some(json!({"admission_case_id":f.admission,"medication_name":"Synthetic unlinked manual medication","dose":"Explicit reviewed dose","route":"oral","frequency":"daily","scheduled_at":Utc::now()-chrono::Duration::hours(1)}))).await, StatusCode::OK).await;
            let child = id(&saved["data"], "id");
            (
                format!("/api/v2/nursing/medication-administrations/{child}/outcome"),
                json!({"status":"administered","witness_user_id":recipient,"administration_notes":"Synthetic recorded witness outcome"}),
                Some(child),
            )
        }
    };
    let policy = must(
        hms_db::network::get_policy(&pool, facility).await,
        "current configured policy reads",
    );
    let publisher_input = json!({"client_request_id":Uuid::new_v4(),"expected_version":policy.version,"onsite_cidrs":policy.onsite_cidrs,"offsite_mode":"fresh_reauth","reason":"Synthetic two-user publication ordering"});
    let deadlocks_before = isolated_deadlocks(&pool).await;
    if publisher_first {
        let before = target_clinical_evidence(&f).await;
        let mut held = must(pool.begin().await, "publisher-first policy barrier begins");
        let barrier_pid: i32 = must(
            sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *held)
                .await,
            "policy barrier privately identified",
        );
        must(
            sqlx::query(
                "SELECT version FROM facility_network_policies WHERE facility_id=$1 FOR SHARE",
            )
            .bind(facility)
            .fetch_one(&mut *held)
            .await,
            "policy barrier held before actual authenticated publisher",
        );
        let copy = f.app.clone();
        let publisher = tokio::spawn(async move {
            send(
                &copy,
                &publisher_token,
                Method::PUT,
                "/api/v2/admin/network-policy".into(),
                Some(publisher_input),
            )
            .await
        });
        let publisher_pid =
            source_waiter(&pool, barrier_pid, "facility_network_policies", &publisher).await;
        let copy = f.app.clone();
        let token = f.token.clone();
        let command =
            tokio::spawn(async move { send(&copy, &token, Method::POST, path, Some(input)).await });
        let observed = source_waiter(&pool, publisher_pid, "users", &command).await;
        must(
            held.commit().await,
            "release policy barrier before bounded inverse-order joins",
        );
        let publication = checked(
            join_released(
                publisher,
                "publisher-first authenticated policy command joins",
            )
            .await,
            StatusCode::OK,
        )
        .await;
        let rejected =
            denied(join_released(command, "publisher-first clinical command joins").await).await;
        assert!(
            rejected["error"]["code"] == "network_policy_changed",
            "publisher-first stale business proof has exact definite denial"
        );
        assert!(before == target_clinical_evidence(&f).await, "publisher-first denial preserves clinical parents, children, command receipts, outcome and business audit");
        let deadlocks_after = isolated_deadlocks(&pool).await;
        eprintln!("target_user_publication_inverse kind={} clinical_user_wait_observed={} deadlock_delta={} policy_version_advanced_once=true business_unchanged=true", kind.label(), observed != publisher_pid, deadlocks_after-deadlocks_before);
        assert_eq!(
            deadlocks_after, deadlocks_before,
            "inverse ordering records no isolated database deadlock"
        );
        assert_eq!(
            publication["data"]["policy"]["version"],
            policy.version + 1,
            "one first publisher succeeds"
        );
        return;
    }
    let mut held = must(pool.begin().await, "target-user clinical barrier begins");
    let barrier_pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "clinical barrier privately identified",
    );
    let fragment = if matches!(kind, TargetUserCommand::HandoverAmend) {
        // Amendment has no current-admission lookup. Its new command reservation
        // follows policy proof and precedes the changed recipient validation.
        must(sqlx::query("CREATE FUNCTION p14_target_command_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(9182305); RETURN NEW; END $$").execute(&pool).await, "isolated command gate installs");
        must(sqlx::query("CREATE TRIGGER p14_target_command_gate BEFORE INSERT ON patient_handover_commands FOR EACH ROW EXECUTE FUNCTION p14_target_command_gate()").execute(&pool).await, "isolated command gate attaches");
        must(
            sqlx::query("SELECT pg_advisory_xact_lock(9182305)")
                .execute(&mut *held)
                .await,
            "actual reservation barrier held after business proof",
        );
        "patient_handover_commands"
    } else if let Some(child) = held_child {
        must(sqlx::query("SELECT id FROM medication_administrations WHERE facility_id=$1 AND id=$2 FOR UPDATE").bind(facility).bind(child).fetch_one(&mut *held).await, "actual MAR child held after business proof");
        "medication_administrations"
    } else {
        must(
            sqlx::query("SELECT id FROM admission_cases WHERE facility_id=$1 AND id=$2 FOR UPDATE")
                .bind(facility)
                .bind(f.admission)
                .fetch_one(&mut *held)
                .await,
            "actual admission held after business proof",
        );
        "admission_cases"
    };
    let copy = f.app.clone();
    let token = f.token.clone();
    let command =
        tokio::spawn(async move { send(&copy, &token, Method::POST, path, Some(input)).await });
    let command_pid = source_waiter(&pool, barrier_pid, fragment, &command).await;
    let copy = f.app.clone();
    let publisher = tokio::spawn(async move {
        send(
            &copy,
            &publisher_token,
            Method::PUT,
            "/api/v2/admin/network-policy".into(),
            Some(publisher_input),
        )
        .await
    });
    let graph = tokio::time::timeout(WallDuration::from_secs(3), async {
        loop {
            let query: Option<String> = must(sqlx::query_scalar("SELECT CASE WHEN strpos(query,'facility_network_policies')>0 THEN 'policy' WHEN strpos(query,'users')>0 THEN 'users' ELSE 'other' END FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) ORDER BY query_start LIMIT 1").bind(command_pid).fetch_optional(&pool).await, "different publisher blocker relation reads");
            if let Some(relation) = query { return relation; }
            assert!(!publisher.is_finished(), "publisher reaches held proof before clinical release");
            tokio::time::sleep(WallDuration::from_millis(10)).await;
        }
    }).await;
    must(
        held.commit().await,
        "release clinical barrier before bounded joins",
    );
    let business = join_released(command, "target-user clinical command joins after release").await;
    let publication =
        join_released(publisher, "target-user policy command joins after release").await;
    let (business_status, business_body) = body(business).await;
    let (publication_status, publication_body) = body(publication).await;
    let graph = must(graph, "actual target-user publisher wait observed");
    let deadlocks_after = isolated_deadlocks(&pool).await;
    eprintln!(
        "target_user_database_deadlocks kind={} delta={}",
        kind.label(),
        deadlocks_after - deadlocks_before
    );
    assert_eq!(
        deadlocks_after, deadlocks_before,
        "clinical-first ordering records no isolated database deadlock"
    );
    eprintln!("target_user_publication kind={} observed_publisher_wait={} business_status={} business_code={} publisher_status={} publisher_code={}", kind.label(), graph, business_status.as_u16(), business_body["error"]["code"].as_str().unwrap_or("none"), publication_status.as_u16(), publication_body["error"]["code"].as_str().unwrap_or("none"));
    assert_eq!(
        business_status,
        StatusCode::OK,
        "clinical command and target-user publisher must complete without lock-cycle rollback"
    );
    assert_eq!(
        publication_status,
        StatusCode::OK,
        "target-user publisher completes after clinical proof"
    );
    assert_eq!(
        graph, "users",
        "reviewed target users retained before business policy lock"
    );
    assert!(
        business_body["data"].is_object(),
        "successful clinical command has typed evidence"
    );
    assert_eq!(
        publication_body["data"]["policy"]["version"],
        policy.version + 1,
        "one policy publication persisted"
    );
}

#[tokio::test]
async fn target_user_handover_create_and_authenticated_policy_writer_complete_without_cycle() {
    target_user_publication_order(TargetUserCommand::HandoverCreate).await;
}
#[tokio::test]
async fn target_user_handover_amend_and_authenticated_policy_writer_complete_without_cycle() {
    target_user_publication_order(TargetUserCommand::HandoverAmend).await;
}
#[tokio::test]
async fn target_user_task_create_and_authenticated_policy_writer_complete_without_cycle() {
    target_user_publication_order(TargetUserCommand::NursingTask).await;
}
#[tokio::test]
async fn target_user_round_save_and_authenticated_policy_writer_complete_without_cycle() {
    target_user_publication_order(TargetUserCommand::RoundSave).await;
}
#[tokio::test]
async fn target_user_round_commit_and_authenticated_policy_writer_complete_without_cycle() {
    target_user_publication_order(TargetUserCommand::RoundCommit).await;
}
#[tokio::test]
async fn target_user_existing_mar_witness_and_authenticated_policy_writer_complete_without_cycle() {
    target_user_publication_order(TargetUserCommand::MarWitness).await;
}

#[tokio::test]
async fn publisher_first_target_user_handover_create_rejects_stale_business_proof_without_effects()
{
    target_user_publication_ordered(TargetUserCommand::HandoverCreate, true).await;
}

#[tokio::test]
async fn publisher_first_target_user_handover_amend_rejects_stale_business_proof_without_effects() {
    target_user_publication_ordered(TargetUserCommand::HandoverAmend, true).await;
}

#[tokio::test]
async fn publisher_first_target_user_task_create_rejects_stale_business_proof_without_effects() {
    target_user_publication_ordered(TargetUserCommand::NursingTask, true).await;
}

#[tokio::test]
async fn publisher_first_target_user_round_save_rejects_stale_business_proof_without_effects() {
    target_user_publication_ordered(TargetUserCommand::RoundSave, true).await;
}

#[tokio::test]
async fn publisher_first_target_user_round_commit_rejects_stale_business_proof_without_effects() {
    target_user_publication_ordered(TargetUserCommand::RoundCommit, true).await;
}

#[tokio::test]
async fn publisher_first_target_user_mar_witness_rejects_stale_business_proof_without_effects() {
    target_user_publication_ordered(TargetUserCommand::MarWitness, true).await;
}

#[derive(Clone, Copy)]
enum MedicationPolicyMapping {
    Status,
    Generation,
    PrnRequest,
    Dispense,
}
impl MedicationPolicyMapping {
    fn label(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::Generation => "generation",
            Self::PrnRequest => "prn_request",
            Self::Dispense => "dispense",
        }
    }
}
async fn medication_mapping_evidence(f: &ClinicalFixture, source: Uuid, item: Uuid) -> Value {
    let pool = f.app.db_pool().await;
    let physical: Value = must(sqlx::query_scalar("SELECT jsonb_build_object('fulfillments',(SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) FROM pharmacy_fulfillments q WHERE q.facility_id=$1 AND q.prescription_id=$2),'batches',(SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]'::jsonb) FROM stock_batches b WHERE b.facility_id=$1 AND b.item_id=$3),'movements',(SELECT count(*) FROM stock_movements WHERE facility_id=$1 AND item_id=$3))").bind(f.app.state().facility_id()).bind(source).bind(item).fetch_one(&pool).await, "selected stock and fulfillment evidence reads privately");
    json!({"prescription":rx_evidence(f, source).await,"clinical":target_clinical_evidence(f).await,"physical":physical})
}
async fn medication_source_wait_has_definite_policy_mapping(kind: MedicationPolicyMapping) {
    let mut f = ClinicalFixture::new(false).await;
    let pool = f.app.db_pool().await;
    let facility = f.app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_permission(&f.app, owner, PermissionCode::PharmacyDispense).await;
    grant_test_feature(&f.app, owner, FeatureKey::Pharmacy).await;
    f.token = login(f.app.clone(), "owner@hms.local").await.0;
    let (item, unit): (Uuid, String) = must(sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled AND item_type='medication' ORDER BY id LIMIT 1").bind(facility).fetch_one(&pool).await, "actual ordinary active medication selected");
    let location: Uuid = must(sqlx::query_scalar("SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1").bind(facility).fetch_one(&pool).await, "actual active local stock location selected");
    must(sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand) VALUES(gen_random_uuid(),$1,$2,$3,'SYNTHETIC-P14-MAPPING',100)").bind(facility).bind(item).bind(location).execute(&pool).await, "explicit synthetic available stock seeded");
    let encounter: Uuid = must(sqlx::query_scalar("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status) VALUES(gen_random_uuid(),$1,$2,'inpatient','in_progress') RETURNING id").bind(facility).bind(f.patient).fetch_one(&pool).await, "actual inpatient prescribing context created");
    let mut source_input = json!({"admission_case_id":f.admission,"encounter_id":encounter,"medication_name":"Synthetic explicit medication mapping","dose":"Reviewed clinical dosage","route":"oral","frequency":"daily","instructions":RX_MARKER,"reason":"Synthetic explicit indication","inventory_item_id":item,"start_date":Utc::now().date_naive(),"duration_days":7,"first_dose_at":Utc::now()+chrono::Duration::hours(1),"scheduled_stock_policy":{"expected_stock_unit":unit,"stock_units_per_dose":2}});
    if matches!(kind, MedicationPolicyMapping::PrnRequest) {
        source_input["frequency"] = json!("prn");
        source_input["scheduled_stock_policy"] = Value::Null;
        source_input["first_dose_at"] = Value::Null;
        source_input["prn_policy"] = json!({"expected_stock_unit":unit,"stock_units_per_dose":2,"minimum_interval_hours":4,"maximum_doses_per_24_hours":2,"indication":"Synthetic prescribed indication"});
    }
    let source = checked(
        send(
            &f.app,
            &f.token,
            Method::POST,
            format!("/api/v2/patients/{}/clinical/prescriptions", f.patient),
            Some(source_input),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let source = id(&source["data"], "id");
    let generation_path = format!("/api/v2/clinical/prescriptions/{source}/generate-mar");
    let generation_input = json!({"admission_case_id":f.admission,"days":1});
    let (method, path, input) = match kind {
        MedicationPolicyMapping::Status => (
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{source}"),
            json!({"status":"on_hold"}),
        ),
        MedicationPolicyMapping::Generation => (Method::POST, generation_path, generation_input),
        MedicationPolicyMapping::PrnRequest => (
            Method::POST,
            "/api/v2/nursing/prn-dose-requests".to_owned(),
            json!({"prescription_id":source,"admission_case_id":f.admission,"client_request_id":Uuid::new_v4(),"indication":"Synthetic current indication"}),
        ),
        MedicationPolicyMapping::Dispense => {
            let generated = checked(
                send(
                    &f.app,
                    &f.token,
                    Method::POST,
                    generation_path,
                    Some(generation_input),
                )
                .await,
                StatusCode::OK,
            )
            .await;
            let fulfillment = id(&generated["data"], "pharmacy_fulfillment_id");
            (
                Method::POST,
                format!("/api/v2/pharmacy/dispensing-queue/{fulfillment}/dispense"),
                json!({"item_id":item,"location_id":location,"quantity":1}),
            )
        }
    };
    let before = medication_mapping_evidence(&f, source, item).await;
    let mut held = must(
        pool.begin().await,
        "medication mutation source barrier begins",
    );
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *held)
            .await,
        "mutation barrier privately identified",
    );
    // SHARE permits the pharmacy's protected detail preflight. The later real
    // mutation's FOR UPDATE must wait, before its own retained network proof.
    must(
        sqlx::query("SELECT id FROM prescriptions WHERE facility_id=$1 AND id=$2 FOR SHARE")
            .bind(facility)
            .bind(source)
            .fetch_one(&mut *held)
            .await,
        "actual mutation source held while read preflight remains permitted",
    );
    let copy = f.app.clone();
    let token = f.token.clone();
    let command = tokio::spawn(async move { send(&copy, &token, method, path, Some(input)).await });
    source_waiter(&pool, pid, "prescriptions", &command).await;
    let mut publisher = spawn_deny(&f.app).await;
    let publication = tokio::time::timeout(WallDuration::from_secs(3), &mut publisher).await;
    must(
        held.commit().await,
        "release mutation source before joins/assertions",
    );
    let response = join_released(command, "policy-denied medication mutation joins").await;
    match publication {
        Ok(result) => must(result, "actual operator wins before mutation proof"),
        Err(_) => {
            join_released(publisher, "late operator joins after source release").await;
            panic!("operator must publish before mutation source release");
        }
    }
    let (status, value) = body(response).await;
    let unchanged = before == medication_mapping_evidence(&f, source, item).await;
    eprintln!(
        "medication_policy_mapping kind={} status={} code={} business_unchanged={}",
        kind.label(),
        status.as_u16(),
        value["error"]["code"].as_str().unwrap_or("none"),
        unchanged
    );
    assert!(unchanged,"stale medication proof preserves actual source, MAR, PRN membership, fulfillment, stock and business audit");
    validate_denial(status, &value);
    assert!(
        value["error"]["code"] == "network_policy_changed",
        "all actual medication mutation consumers preserve the exact definite shared policy denial"
    );
}
#[tokio::test]
async fn medication_policy_mapping_status_change_is_definite_after_source_wait() {
    medication_source_wait_has_definite_policy_mapping(MedicationPolicyMapping::Status).await;
}
#[tokio::test]
async fn medication_policy_mapping_generation_is_definite_after_source_wait() {
    medication_source_wait_has_definite_policy_mapping(MedicationPolicyMapping::Generation).await;
}
#[tokio::test]
async fn medication_policy_mapping_prn_request_is_definite_after_source_wait() {
    medication_source_wait_has_definite_policy_mapping(MedicationPolicyMapping::PrnRequest).await;
}
#[tokio::test]
async fn medication_policy_mapping_dispense_is_definite_after_mutation_source_wait() {
    medication_source_wait_has_definite_policy_mapping(MedicationPolicyMapping::Dispense).await;
}
