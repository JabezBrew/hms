//! Ordinary-care previews are protected reads, never clinical saves or receipts.
mod support;
use axum::response::Response;
use chrono::{Datelike, NaiveDate};
use hms_db::clinical::{
    note_previews, note_records::NoteActor, prescription_courses::PrescriptionAuthorization,
};
use hms_domain::{
    clinical_notes::*,
    network::{NetworkOffsiteMode, UpdateNetworkPolicyRequest},
};
use std::time::Duration as WallDuration;
use support::*;
use tokio::task::JoinHandle;

const TOKENS:&str="{{patient_name}}|{{ patient_first_name }}|{{PATIENT_LAST_NAME}}|{{age}}|{{sex}}|{{mrn}}|{{today}}|{{chief_complaint}}";
const FIRST: &str = "Synthetic \"quoted\"\nFirst";
const LAST: &str = "Preview Family";
const CHIEF: &str = "Synthetic clinician supplied complaint";
fn must<T, E>(result: Result<T, E>, message: &'static str) -> T {
    result.unwrap_or_else(|_| panic!("{message}"))
}
fn opaque(value: &Value, field: &str) -> Uuid {
    must(
        Uuid::parse_str(value[field].as_str().expect("opaque identity exists")),
        "opaque identity parses",
    )
}
async fn request(
    app: &TestApp,
    token: &str,
    method: Method,
    path: String,
    input: Option<Value>,
) -> Response {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = match input {
        Some(value) => {
            request = request.header("content-type", "application/json");
            Body::from(must(serde_json::to_vec(&value), "fixture input encodes"))
        }
        None => Body::empty(),
    };
    must(
        app.clone()
            .oneshot(must(request.body(body), "fixture request builds"))
            .await,
        "actual route responds",
    )
}
async fn checked(response: Response, expected: StatusCode) -> Value {
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded response reads",
    );
    let value: Value = must(serde_json::from_slice(&bytes), "typed response decodes");
    assert_eq!(
        status,
        expected,
        "static preview route code {}",
        value["error"]["code"].as_str().unwrap_or("none")
    );
    if !status.is_success() {
        assert!(value.get("data").is_none_or(Value::is_null));
        assert!(value["error"]["details"] == json!({}));
        let encoded = value.to_string();
        for marker in [
            FIRST,
            LAST,
            CHIEF,
            "PRIVATE_PREVIEW_INPUT",
            "PRIVATE_PREVIEW_SOURCE",
        ] {
            assert!(
                !encoded.contains(marker),
                "denial has no private source, token or draft values"
            );
        }
        assert!(
            !value["error"]["code"]
                .as_str()
                .unwrap_or_default()
                .ends_with("_unconfirmed"),
            "preview never claims an uncertain clinical write"
        );
    }
    value
}
struct Fixture {
    app: TestApp,
    pool: hms_db::PgPool,
    token: String,
    patient: Uuid,
    encounter: Uuid,
    template: Uuid,
    revision: Uuid,
    code: String,
}
impl Fixture {
    async fn new(source: &str) -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        let facility = app.state().facility_id();
        grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
        let (token, _, _) = login(app.clone(), "owner@hms.local").await;
        let patient = Uuid::new_v4();
        let encounter = Uuid::new_v4();
        let code = format!("SYN-PREVIEW-{}", patient.simple());
        must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,$4,$5,'2000-06-15','other','active','registered','presumed_alive')").bind(patient).bind(facility).bind(&code).bind(FIRST).bind(LAST).execute(&pool).await,"explicit synthetic patient inserts");
        must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned')").bind(facility).bind(owner).bind(patient).execute(&pool).await,"ordinary care relationship inserts");
        must(sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status,created_by_user_id) VALUES($1,$2,$3,'outpatient','in_progress',$4)").bind(encounter).bind(facility).bind(patient).bind(owner).execute(&pool).await,"explicit current encounter inserts");
        let saved=checked(request(&app,&token,Method::POST,"/api/v2/clinical/note-templates/record".into(),Some(json!({"client_request_id":Uuid::new_v4(),"title":"Synthetic preview template","note_type":"doctor_note","body_template":source,"is_active":true}))).await,StatusCode::OK).await;
        let template = opaque(&saved["data"]["template"], "id");
        let revision = opaque(&saved["data"]["template"], "current_revision_id");
        Self {
            app,
            pool,
            token,
            patient,
            encounter,
            template,
            revision,
            code,
        }
    }
    fn input(&self) -> Value {
        json!({"template_id":self.template,"template_revision_id":self.revision,"encounter_id":self.encounter,"apply_mode":"empty_only","sections":[],"base_body":"","chief_complaint":CHIEF})
    }
    fn path(&self) -> String {
        format!(
            "/api/v2/patients/{}/clinical/note-template-previews",
            self.patient
        )
    }
    async fn preview(&self, token: &str, input: Value, expected: StatusCode) -> Value {
        checked(
            request(&self.app, token, Method::POST, self.path(), Some(input)).await,
            expected,
        )
        .await
    }
    async fn reader(&self, full: bool, relationship: bool) -> String {
        let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
        for permission in [
            PermissionCode::PatientDemographicsView,
            PermissionCode::ClinicalDocumentationView,
        ] {
            grant_test_permission(&self.app, user, permission).await;
        }
        for feature in [FeatureKey::Patients, FeatureKey::Encounters] {
            grant_test_feature(&self.app, user, feature).await;
        }
        grant_test_patient_visibility(&self.app, user, PatientDataVisibility::Demographics).await;
        if full {
            grant_test_patient_visibility(&self.app, user, PatientDataVisibility::FullClinical)
                .await;
        } else {
            grant_test_patient_visibility(&self.app, user, PatientDataVisibility::ClinicalSummary)
                .await;
        }
        if relationship {
            must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned') ON CONFLICT(user_id,patient_id,context_kind) DO NOTHING").bind(self.app.state().facility_id()).bind(user).bind(self.patient).execute(&self.pool).await,"reader ordinary care relationship inserts");
        }
        login(self.app.clone(), "limited@hms.local").await.0
    }
    async fn evidence(&self) -> Value {
        must(sqlx::query_scalar(
            r#"SELECT jsonb_build_object(
              'notes',(SELECT count(*) FROM clinical_notes WHERE facility_id=$1),
              'versions',(SELECT count(*) FROM clinical_note_versions WHERE facility_id=$1),
              'commands',(SELECT count(*) FROM clinical_note_commands WHERE facility_id=$1),
              'template_commands',(SELECT count(*) FROM clinical_note_template_commands WHERE facility_id=$1),
              'audit',(SELECT count(*) FROM audit_events WHERE facility_id=$1),
              'problems',(SELECT count(*) FROM patient_problems WHERE facility_id=$1),
              'charts',(SELECT count(*) FROM chart_entries WHERE facility_id=$1),
              'prescriptions',(SELECT count(*) FROM prescriptions WHERE facility_id=$1),
              'mar',(SELECT count(*) FROM medication_administrations WHERE facility_id=$1),
              'stock',(SELECT COALESCE(sum(quantity_on_hand),0) FROM stock_batches WHERE facility_id=$1)
            )"#
        ).bind(self.app.state().facility_id()).fetch_one(&self.pool).await,"minimal clinical side-effect evidence reads")
    }
    async fn policy(&self, mode: NetworkOffsiteMode) {
        let facility = self.app.state().facility_id();
        let current = must(
            hms_db::network::get_policy(&self.pool, facility).await,
            "current network policy reads",
        );
        must(
            hms_db::network::update_policy(
                &self.pool,
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
                    offsite_mode: mode,
                    reason: "Synthetic reviewed preview access policy".into(),
                },
                None,
            )
            .await,
            "canonical operator network publication commits",
        );
    }
    async fn actor(&self) -> NoteActor {
        let claims = access_claims(&self.token);
        NoteActor {
            facility_id: claims.facility_id,
            user_id: claims.sub,
            request_id: None,
            can_manage: false,
            override_ownership: false,
            authorization: PrescriptionAuthorization {
                session_id: claims.session_id,
                session_version: claims.session_version,
                permission_version: claims.permission_version,
                active_profile: must(
                    hms_db::codec::decode(&claims.active_profile),
                    "current profile decodes",
                ),
                valid_until: Utc::now() + Duration::minutes(5),
                resolved_network_policy_version: Some(
                    must(
                        hms_db::network::get_policy(&self.pool, claims.facility_id).await,
                        "current policy reads",
                    )
                    .version,
                ),
            },
        }
    }
}

#[tokio::test]
async fn actual_preview_uses_eight_server_tokens_and_binds_exact_patient_context_and_revision() {
    let f = Fixture::new(TOKENS).await;
    let before = f.evidence().await;
    let response = f.preview(&f.token, f.input(), StatusCode::OK).await;
    let data = &response["data"];
    assert!(opaque(data, "patient_id") == f.patient && opaque(data, "encounter_id") == f.encounter);
    assert!(
        opaque(data, "template_id") == f.template
            && opaque(data, "template_revision_id") == f.revision
    );
    assert_eq!(data["template_revision_version"], 1);
    assert_eq!(data["kind"], "plain");
    assert_eq!(data["date_basis"], "utc");
    let date = must(
        NaiveDate::parse_from_str(data["rendered_on"].as_str().unwrap(), "%Y-%m-%d"),
        "explicit UTC render date parses",
    );
    let age = date.year() - 2000 - i32::from((date.month(), date.day()) < (6, 15));
    let expected = format!(
        "{FIRST} {LAST}|{FIRST}|{LAST}|{age}|other|{}|{date}|{CHIEF}",
        f.code
    );
    assert!(
        data["patch"] == expected,
        "only authoritative patient facts and explicit complaint render literally"
    );
    assert!(data["unresolved"] == json!([]) && data["unresolved_truncated"] == false);
    assert!(data["applied_sections"] == json!(["text"]));
    for forbidden in [
        "access_token",
        "tokens",
        "body_template",
        "note",
        "client_request_id",
        "receipt",
    ] {
        assert!(data.get(forbidden).is_none());
    }
    assert!(
        f.evidence().await == before,
        "preview creates no clinical data, stock, audit or command"
    );
}

#[tokio::test]
async fn ordinary_full_read_only_actor_can_preview_offsite_without_management_or_factor_escalation()
{
    let f = Fixture::new(TOKENS).await;
    let reader = f.reader(true, true).await;
    f.policy(NetworkOffsiteMode::Readonly).await;
    let before = f.evidence().await;
    f.preview(&reader, f.input(), StatusCode::OK).await;
    let claims = access_claims(&reader);
    let factor: bool = must(
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM auth_session_assurance WHERE session_id=$1)",
        )
        .bind(claims.session_id)
        .fetch_one(&f.pool)
        .await,
        "ordinary reader assurance facts read",
    );
    assert!(
        !factor,
        "preview does not invent a privileged-factor requirement"
    );
    let save = json!({"client_request_id":Uuid::new_v4(),"encounter_id":f.encounter,"template_revision_id":f.revision,"note_type":"doctor_note","title":"Synthetic blocked implicit save","body":"Synthetic reviewed draft"});
    checked(
        request(
            &f.app,
            &reader,
            Method::POST,
            format!("/api/v2/patients/{}/clinical/notes/record", f.patient),
            Some(save),
        )
        .await,
        StatusCode::FORBIDDEN,
    )
    .await;
    assert!(
        f.evidence().await == before,
        "read-only preview is not permission to save a note"
    );
}

#[tokio::test]
async fn summary_or_emergency_grant_cannot_replace_current_full_ordinary_care_authority() {
    let f = Fixture::new(TOKENS).await;
    let summary = f.reader(false, true).await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    must(sqlx::query("INSERT INTO patient_break_glass_grants(id,facility_id,user_id,patient_id,category,started_at,expires_at) VALUES(gen_random_uuid(),$1,$2,$3,'urgent_clinical_continuity',now(),now()+interval '2 hours')").bind(f.app.state().facility_id()).bind(user).bind(f.patient).execute(&f.pool).await,"explicit synthetic emergency fixture inserts");
    let before = f.evidence().await;
    let denied = f.preview(&summary, f.input(), StatusCode::FORBIDDEN).await;
    assert_eq!(
        denied["error"]["code"],
        "clinical_note_template_preview_unavailable"
    );
    assert!(f.evidence().await == before);
    grant_test_patient_visibility(&f.app, user, PatientDataVisibility::FullClinical).await;
    must(
        sqlx::query(
            "DELETE FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3",
        )
        .bind(f.app.state().facility_id())
        .bind(user)
        .bind(f.patient)
        .execute(&f.pool)
        .await,
        "ordinary context is explicitly withdrawn",
    );
    let full = login(f.app.clone(), "limited@hms.local").await.0;
    let before = f.evidence().await;
    let denied = f.preview(&full, f.input(), StatusCode::FORBIDDEN).await;
    assert_eq!(
        denied["error"]["code"],
        "clinical_note_template_preview_unavailable"
    );
    assert!(
        f.evidence().await == before,
        "even Full plus emergency does not bypass this ordinary-care preview purpose"
    );
}

#[tokio::test]
async fn preview_rejects_forged_tokens_unknown_fields_and_unbounded_or_ambiguous_inputs() {
    let f = Fixture::new(TOKENS).await;
    let before = f.evidence().await;
    let mut inputs = Vec::new();
    for field in [
        "extra_tokens",
        "patient_name",
        "date_basis",
        "client_request_id",
    ] {
        let mut input = f.input();
        input[field] = json!("PRIVATE_PREVIEW_INPUT");
        inputs.push(input);
    }
    for (field, value) in [
        ("base_body", json!("x".repeat(20_001))),
        ("chief_complaint", json!("x".repeat(501))),
        ("sections", json!(vec!["text"; 101])),
        ("template_id", json!(Uuid::nil())),
        ("template_revision_id", json!(Uuid::nil())),
        ("encounter_id", json!(Uuid::nil())),
        ("apply_mode", json!("unsafe")),
    ] {
        let mut input = f.input();
        input[field] = value;
        inputs.push(input);
    }
    let mut selected = f.input();
    selected["apply_mode"] = json!("selected");
    inputs.push(selected);
    let mut ambiguous = f.input();
    ambiguous["sections"] = json!(["text"]);
    inputs.push(ambiguous);
    for input in inputs {
        f.preview(&f.token, input, StatusCode::BAD_REQUEST).await;
    }
    assert!(
        f.evidence().await == before,
        "invalid previews have no persisted effects"
    );
}

#[tokio::test]
async fn wrong_patient_context_and_template_tuple_never_fall_back_to_a_current_resource() {
    let f = Fixture::new(TOKENS).await;
    let before = f.evidence().await;
    let other_patient = Uuid::new_v4();
    let other_encounter = Uuid::new_v4();
    must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) VALUES($1,$2,'SYN-PREVIEW-OTHER','Synthetic','Other','2001-01-01','unknown','active')").bind(other_patient).bind(f.app.state().facility_id()).execute(&f.pool).await,"other explicit synthetic patient inserts");
    must(sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status) VALUES($1,$2,$3,'outpatient','in_progress')").bind(other_encounter).bind(f.app.state().facility_id()).bind(other_patient).execute(&f.pool).await,"other current encounter inserts");
    for encounter in [other_encounter, Uuid::new_v4()] {
        let mut input = f.input();
        input["encounter_id"] = json!(encounter);
        let denied = f.preview(&f.token, input, StatusCode::FORBIDDEN).await;
        assert_eq!(
            denied["error"]["code"],
            "clinical_note_template_preview_unavailable"
        );
    }
    let missing = request(
        &f.app,
        &f.token,
        Method::POST,
        format!(
            "/api/v2/patients/{}/clinical/note-template-previews",
            Uuid::new_v4()
        ),
        Some(f.input()),
    )
    .await;
    checked(missing, StatusCode::FORBIDDEN).await;
    let other=checked(request(&f.app,&f.token,Method::POST,"/api/v2/clinical/note-templates/record".into(),Some(json!({"client_request_id":Uuid::new_v4(),"title":"Synthetic other preview template","note_type":"doctor_note","body_template":"Other source","is_active":true}))).await,StatusCode::OK).await;
    let other_revision = opaque(&other["data"]["template"], "current_revision_id");
    let mut mismatch = f.input();
    mismatch["template_revision_id"] = json!(other_revision);
    let denial = f.preview(&f.token, mismatch, StatusCode::CONFLICT).await;
    assert_eq!(
        denial["error"]["code"],
        "clinical_note_template_preview_source_unavailable"
    );
    let _ = before; // Explicit fixture/template writes above are separate setup, not preview effects.
}

#[tokio::test]
async fn exact_old_revision_preview_and_reviewed_save_remain_pinned_after_template_changes() {
    let f = Fixture::new(TOKENS).await;
    let change = |version, active| json!({"client_request_id":Uuid::new_v4(),"expected_version":version,"title":"Synthetic changed preview source","note_type":"doctor_note","body_template":"PRIVATE_PREVIEW_SOURCE latest content","is_active":active,"change_summary":"Synthetic independent catalog change"});
    checked(
        request(
            &f.app,
            &f.token,
            Method::POST,
            format!("/api/v2/clinical/note-templates/{}/changes", f.template),
            Some(change(1, true)),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let before = f.evidence().await;
    let preview = f.preview(&f.token, f.input(), StatusCode::OK).await;
    assert_eq!(preview["data"]["template_revision_version"], 1);
    assert!(!preview["data"]["patch"]
        .as_str()
        .unwrap()
        .contains("PRIVATE_PREVIEW_SOURCE"));
    assert!(
        f.evidence().await == before,
        "preview remains side-effect-free before explicit reviewed save"
    );
    let reviewed = format!(
        "{}\nSynthetic clinician reviewed addition",
        preview["data"]["patch"].as_str().unwrap()
    );
    let saved=checked(request(&f.app,&f.token,Method::POST,format!("/api/v2/patients/{}/clinical/notes/record",f.patient),Some(json!({"client_request_id":Uuid::new_v4(),"encounter_id":f.encounter,"template_revision_id":f.revision,"note_type":"doctor_note","title":"Synthetic reviewed preview note","body":reviewed}))).await,StatusCode::OK).await;
    let note = opaque(&saved["data"]["note"], "id");
    assert!(saved["data"]["note"]["body"] == reviewed);
    assert!(opaque(&saved["data"]["note"]["template_revision"], "id") == f.revision);
    checked(
        request(
            &f.app,
            &f.token,
            Method::POST,
            format!("/api/v2/clinical/note-templates/{}/changes", f.template),
            Some(change(2, false)),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let before = f.evidence().await;
    f.preview(&f.token, f.input(), StatusCode::CONFLICT).await;
    assert!(f.evidence().await == before);
    let historical = checked(
        request(
            &f.app,
            &f.token,
            Method::GET,
            format!("/api/v2/clinical/notes/{note}"),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(
        historical["data"]["body"] == reviewed
            && opaque(&historical["data"]["template_revision"], "id") == f.revision
    );
}

#[tokio::test]
async fn structured_preview_returns_only_generated_narrative_patch_with_constant_query_work() {
    let sections:Vec<_>=(0..100).map(|index|json!({"section":format!("s{index}"),"type":if index==0 {"medication_administration"} else {"observation"},"default_text":"Narrative {{mrn}}"})).collect();
    let f = Fixture::new(
        &json!({"private_metadata":{"opaque":9007199254740993_u64},"sections":sections})
            .to_string(),
    )
    .await;
    let before = f.evidence().await;
    let mut input = f.input();
    input["base_body"] =
        json!("{\"s0\":false,\"s1\":0,\"s2\":{\"notes\":\"Synthetic existing work\"}}");
    let response = f.preview(&f.token, input.clone(), StatusCode::OK).await;
    let patch = &response["data"]["patch"];
    assert_eq!(response["data"]["kind"], "structured");
    assert!(patch.get("s0").is_none() && patch.get("s1").is_none() && patch.get("s2").is_none());
    assert_eq!(patch.as_object().unwrap().len(), 97);
    assert!(patch.get("private_metadata").is_none());
    assert!(patch["s3"]["notes"]
        .as_str()
        .is_some_and(|value| value.starts_with("Narrative ")));
    let actor = f.actor().await;
    let mut small: PreviewClinicalNoteTemplateRequest = must(
        serde_json::from_value(f.input()),
        "actual preview request decodes",
    );
    small.apply_mode = NoteTemplatePreviewMode::Selected;
    small.sections = vec!["s0".into()];
    let mut large = small.clone();
    large.apply_mode = NoteTemplatePreviewMode::All;
    large.sections.clear();
    let (one, one_count) = hms_observability::with_request_query_counter(note_previews::preview(
        &f.pool,
        actor.clone(),
        f.patient,
        small,
    ))
    .await;
    let (hundred, hundred_count) = hms_observability::with_request_query_counter(
        note_previews::preview(&f.pool, actor, f.patient, large),
    )
    .await;
    assert_eq!(
        must(one, "one-section preview reads")
            .applied_sections
            .len(),
        1
    );
    assert_eq!(
        must(hundred, "hundred-section preview reads")
            .applied_sections
            .len(),
        100
    );
    assert!(one_count >= 8);
    assert_eq!(
        one_count, hundred_count,
        "proof and query work is independent of section count"
    );
    assert!(
        f.evidence().await == before,
        "narrative wrappers never create observations, MAR, prescriptions, stock or a note"
    );
}

async fn waiting(
    pool: &hms_db::PgPool,
    blocker: i32,
    query: &'static str,
    task: &JoinHandle<Response>,
) {
    must(tokio::time::timeout(WallDuration::from_secs(4),async {loop {
        let found:bool=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0)").bind(blocker).bind(query).fetch_one(pool).await,"actual preview wait graph reads");
        if found {break;}assert!(!task.is_finished(),"preview reaches intended held production lock");tokio::time::sleep(WallDuration::from_millis(10)).await;
    }}).await,"actual preview source wait is observed");
}
async fn join(mut task: JoinHandle<Response>, expected: StatusCode) -> Value {
    let response = match tokio::time::timeout(WallDuration::from_secs(6), &mut task).await {
        Ok(result) => must(result, "released preview joins"),
        Err(_) => {
            task.abort();
            panic!("released preview completes within bounded time");
        }
    };
    checked(response, expected).await
}
fn spawn(f: &Fixture, token: &str) -> JoinHandle<Response> {
    let app = f.app.clone();
    let token = token.to_owned();
    let path = f.path();
    let input = f.input();
    tokio::spawn(async move { request(&app, &token, Method::POST, path, Some(input)).await })
}
#[derive(Clone, Copy)]
enum Change {
    Revoke,
    Permission,
    Feature,
    Policy,
    Template,
    Encounter,
}
async fn changed_before_proof(change: Change) {
    let f = Fixture::new(TOKENS).await;
    let reader = f.reader(true, true).await;
    f.preview(&reader, f.input(), StatusCode::OK).await;
    let claims = access_claims(&reader);
    let mut blocker = must(f.pool.begin().await, "blocking fixture transaction starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking identity reads",
    );
    let facility = f.app.state().facility_id();
    let (query, code) = if matches!(change, Change::Feature) {
        must(
            sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
                .bind(facility)
                .fetch_one(&mut *blocker)
                .await,
            "facility feature parent is held",
        );
        (
            "FROM facilities",
            "clinical_note_template_preview_unavailable",
        )
    } else {
        must(
            sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
                .bind(claims.sub)
                .fetch_one(&mut *blocker)
                .await,
            "actual actor parent is held",
        );
        (
            "FROM users",
            if matches!(change, Change::Template) {
                "clinical_note_template_preview_source_unavailable"
            } else if matches!(change, Change::Encounter) {
                "clinical_note_template_preview_unavailable"
            } else if matches!(change, Change::Policy) {
                "network_policy_changed"
            } else {
                "clinical_note_template_preview_authorization_expired"
            },
        )
    };
    let task = spawn(&f, &reader);
    waiting(&f.pool, pid, query, &task).await;
    match change {
        Change::Revoke => {
            must(
                sqlx::query(
                    "UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1",
                )
                .bind(claims.session_id)
                .execute(&mut *blocker)
                .await,
                "winning actor session revocation persists",
            );
        }
        Change::Permission => {
            must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.view'").bind(claims.sub).execute(&mut *blocker).await,"winning read permission withdrawal persists");
            must(
                sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
                    .bind(claims.sub)
                    .execute(&mut *blocker)
                    .await,
                "winning permission version advances",
            );
        }
        Change::Feature => {
            must(sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'patients',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(facility).execute(&mut *blocker).await,"winning current patient feature withdrawal persists");
        }
        Change::Policy => f.policy(NetworkOffsiteMode::Deny).await,
        Change::Template => {
            checked(request(&f.app,&f.token,Method::POST,format!("/api/v2/clinical/note-templates/{}/changes",f.template),Some(json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"title":"Synthetic retired preview template","note_type":"doctor_note","body_template":TOKENS,"is_active":false,"change_summary":"Synthetic reviewed template retirement"}))).await,StatusCode::OK).await;
        }
        Change::Encounter => {
            checked(
                request(
                    &f.app,
                    &f.token,
                    Method::POST,
                    format!("/api/v2/encounters/{}/complete", f.encounter),
                    None,
                )
                .await,
                StatusCode::OK,
            )
            .await;
        }
    }
    let before = f.evidence().await;
    must(blocker.commit().await, "winning fixture change commits");
    let denied = join(
        task,
        if matches!(change, Change::Template) {
            StatusCode::CONFLICT
        } else {
            StatusCode::FORBIDDEN
        },
    )
    .await;
    assert!(denied["error"]["code"] == code);
    assert!(
        f.evidence().await == before,
        "stale preview publication creates no clinical or audit effects"
    );
}
#[tokio::test]
async fn preview_revoked_session_is_rejected_after_actual_user_wait() {
    changed_before_proof(Change::Revoke).await;
}
#[tokio::test]
async fn preview_withdrawn_permission_is_rejected_after_actual_user_wait() {
    changed_before_proof(Change::Permission).await;
}
#[tokio::test]
async fn preview_disabled_patient_feature_is_rejected_after_actual_facility_wait() {
    changed_before_proof(Change::Feature).await;
}
#[tokio::test]
async fn preview_new_policy_is_rejected_after_actual_user_wait() {
    changed_before_proof(Change::Policy).await;
}
#[tokio::test]
async fn preview_template_retired_before_source_proof_cannot_render_old_revision() {
    changed_before_proof(Change::Template).await;
}
#[tokio::test]
async fn preview_selected_encounter_closed_before_source_proof_never_falls_back() {
    changed_before_proof(Change::Encounter).await;
}

#[tokio::test]
async fn preview_final_clock_rejects_session_expiry_during_real_template_root_wait() {
    let f = Fixture::new(TOKENS).await;
    let reader = f.reader(true, true).await;
    let claims = access_claims(&reader);
    let end:chrono::DateTime<Utc>=must(sqlx::query_scalar("UPDATE refresh_sessions SET idle_expires_at=clock_timestamp()+interval '4 seconds' WHERE session_id=$1 RETURNING idle_expires_at").bind(claims.session_id).fetch_one(&f.pool).await,"bounded exact session deadline installs");
    let before = f.evidence().await;
    let mut blocker = must(f.pool.begin().await, "template blocker starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking identity reads",
    );
    must(
        sqlx::query("SELECT id FROM clinical_note_templates WHERE id=$1 FOR UPDATE")
            .bind(f.template)
            .fetch_one(&mut *blocker)
            .await,
        "actual selected template root is held",
    );
    let task = spawn(&f, &reader);
    waiting(&f.pool, pid, "FROM clinical_note_templates", &task).await;
    must(sqlx::query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.05)").bind(end).execute(&f.pool).await,"database clock crosses retained session deadline");
    must(blocker.commit().await, "template blocker releases");
    let denied = join(task, StatusCode::FORBIDDEN).await;
    assert_eq!(
        denied["error"]["code"],
        "clinical_note_template_preview_authorization_expired"
    );
    assert!(f.evidence().await == before);
}

#[tokio::test]
async fn real_foreign_facility_patient_template_and_revision_cannot_be_substituted() {
    let f = Fixture::new(TOKENS).await;
    let foreign_facility = Uuid::new_v4();
    let foreign_patient = Uuid::new_v4();
    let foreign_template = Uuid::new_v4();
    must(sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) SELECT $1,'SYN-PREVIEW-FOREIGN','Synthetic foreign preview facility',deployment_profile FROM facilities WHERE id=$2").bind(foreign_facility).bind(f.app.state().facility_id()).execute(&f.pool).await,"explicit foreign synthetic facility inserts");
    must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) VALUES($1,$2,'SYN-PREVIEW-FOREIGN','PRIVATE_PREVIEW_INPUT','Foreign','2001-01-01','unknown','active')").bind(foreign_patient).bind(foreign_facility).execute(&f.pool).await,"explicit foreign synthetic patient inserts");
    let foreign_revision:Uuid=must(sqlx::query_scalar("INSERT INTO clinical_note_templates(id,facility_id,title,note_type,body_template,is_active) VALUES($1,$2,'Synthetic foreign template','doctor_note','PRIVATE_PREVIEW_SOURCE {{mrn}}',true) RETURNING current_revision_id").bind(foreign_template).bind(foreign_facility).fetch_one(&f.pool).await,"unattributed foreign imported template inserts");
    let before = f.evidence().await;
    let patient_denied = checked(
        request(
            &f.app,
            &f.token,
            Method::POST,
            format!("/api/v2/patients/{foreign_patient}/clinical/note-template-previews"),
            Some(f.input()),
        )
        .await,
        StatusCode::FORBIDDEN,
    )
    .await;
    assert_eq!(
        patient_denied["error"]["code"],
        "clinical_note_template_preview_unavailable"
    );
    for (template, revision) in [
        (foreign_template, foreign_revision),
        (f.template, foreign_revision),
        (foreign_template, f.revision),
    ] {
        let mut input = f.input();
        input["template_id"] = json!(template);
        input["template_revision_id"] = json!(revision);
        let denied = f.preview(&f.token, input, StatusCode::CONFLICT).await;
        assert_eq!(
            denied["error"]["code"],
            "clinical_note_template_preview_source_unavailable"
        );
    }
    assert!(
        f.evidence().await == before,
        "cross-facility denials cannot create clinical effects"
    );
}

#[tokio::test]
async fn imported_malformed_revision_remains_exact_readable_evidence_but_cannot_render() {
    let f = Fixture::new(TOKENS).await;
    let imported = Uuid::new_v4();
    let original = r#"{"private_metadata":"PRIVATE_PREVIEW_SOURCE","sections":[{"section":"ambiguous","type":"structured","subsections":[{"name":"same key"},{"name":"same_key"}]}]}"#;
    let revision:Uuid=must(sqlx::query_scalar("INSERT INTO clinical_note_templates(id,facility_id,title,note_type,body_template,is_active) VALUES($1,$2,'Synthetic malformed historical configuration','doctor_note',$3,true) RETURNING current_revision_id").bind(imported).bind(f.app.state().facility_id()).bind(original).fetch_one(&f.pool).await,"immutable imported malformed evidence inserts");
    let before = f.evidence().await;
    let exact = checked(
        request(
            &f.app,
            &f.token,
            Method::GET,
            format!("/api/v2/clinical/note-templates/{imported}/versions/{revision}"),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(exact["data"]["body_template"] == original && exact["data"]["imported_legacy"] == true);
    assert!(exact["data"]["created_by_user_id"].is_null());
    let mut input = f.input();
    input["template_id"] = json!(imported);
    input["template_revision_id"] = json!(revision);
    let denied = f.preview(&f.token, input, StatusCode::BAD_REQUEST).await;
    assert_eq!(
        denied["error"]["code"],
        "clinical_note_template_preview_unsupported"
    );
    let unchanged: String = must(
        sqlx::query_scalar(
            "SELECT body_template FROM clinical_note_template_revisions WHERE id=$1",
        )
        .bind(revision)
        .fetch_one(&f.pool)
        .await,
        "original immutable malformed evidence reads",
    );
    assert!(
        unchanged == original && f.evidence().await == before,
        "preview never repairs or saves historical evidence implicitly"
    );
}

#[tokio::test]
async fn registered_alive_patient_and_the_explicit_encounter_visit_are_current_purpose_requirements(
) {
    let f = Fixture::new(TOKENS).await;
    let visit = Uuid::new_v4();
    must(sqlx::query("INSERT INTO visits(id,facility_id,patient_id,status) VALUES($1,$2,$3,'in_consultation')").bind(visit).bind(f.app.state().facility_id()).bind(f.patient).execute(&f.pool).await,"explicit inherited active visit inserts");
    must(
        sqlx::query("UPDATE encounters SET visit_id=$1 WHERE id=$2")
            .bind(visit)
            .bind(f.encounter)
            .execute(&f.pool)
            .await,
        "exact encounter binds actual visit",
    );
    f.preview(&f.token, f.input(), StatusCode::OK).await;
    for (record, vital) in [
        ("restricted", "presumed_alive"),
        ("entered_in_error", "presumed_alive"),
        ("registered", "deceased"),
    ] {
        must(
            sqlx::query("UPDATE patients SET record_status=$1,vital_status=$2 WHERE id=$3")
                .bind(record)
                .bind(vital)
                .bind(f.patient)
                .execute(&f.pool)
                .await,
            "explicit current patient purpose transition commits",
        );
        let before = f.evidence().await;
        let denied = f.preview(&f.token, f.input(), StatusCode::FORBIDDEN).await;
        assert_eq!(
            denied["error"]["code"],
            "clinical_note_template_preview_unavailable"
        );
        assert!(f.evidence().await == before);
    }
    must(sqlx::query("UPDATE patients SET record_status='registered',vital_status='presumed_alive' WHERE id=$1").bind(f.patient).execute(&f.pool).await,"synthetic patient purpose restores");
    must(
        sqlx::query("UPDATE visits SET status='checked_out' WHERE id=$1")
            .bind(visit)
            .execute(&f.pool)
            .await,
        "selected encounter's exact visit closes",
    );
    let before = f.evidence().await;
    let denied = f.preview(&f.token, f.input(), StatusCode::FORBIDDEN).await;
    assert_eq!(
        denied["error"]["code"],
        "clinical_note_template_preview_unavailable"
    );
    let mut standalone = f.input();
    standalone["encounter_id"] = Value::Null;
    let preview = f.preview(&f.token, standalone, StatusCode::OK).await;
    assert!(
        preview["data"]["encounter_id"].is_null(),
        "explicitly absent context stays absent; no latest encounter substitution"
    );
    assert!(f.evidence().await == before);
}

#[tokio::test]
async fn timed_current_view_permission_cannot_publish_after_expiring_during_source_wait() {
    let f = Fixture::new(TOKENS).await;
    let _initial_reader = f.reader(true, true).await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.view'").bind(user).execute(&f.pool).await,"direct synthetic view permission withdraws");
    let end:chrono::DateTime<Utc>=must(sqlx::query_scalar("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,granted_by_user_id,starts_at,ends_at,status) VALUES(gen_random_uuid(),$1,$2,'clinical_documentation.view','facility',$3,now()-interval '1 minute',clock_timestamp()+interval '4 seconds','active') RETURNING ends_at").bind(f.app.state().facility_id()).bind(user).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).fetch_one(&f.pool).await,"bounded genuine facility view assignment inserts");
    let reader = login(f.app.clone(), "limited@hms.local").await.0;
    let before = f.evidence().await;
    let mut blocker = must(f.pool.begin().await, "exact template source blocker starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking identity reads",
    );
    must(
        sqlx::query("SELECT id FROM clinical_note_templates WHERE id=$1 FOR UPDATE")
            .bind(f.template)
            .fetch_one(&mut *blocker)
            .await,
        "exact template source holds",
    );
    let task = spawn(&f, &reader);
    waiting(&f.pool, pid, "FROM clinical_note_templates", &task).await;
    must(sqlx::query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.05)").bind(end).execute(&f.pool).await,"database clock crosses genuine assignment deadline");
    must(blocker.commit().await, "exact source blocker releases");
    let denied = join(task, StatusCode::FORBIDDEN).await;
    assert_eq!(
        denied["error"]["code"],
        "clinical_note_template_preview_authorization_expired"
    );
    assert!(
        f.evidence().await == before,
        "expired timed view authority cannot publish or persist a preview"
    );
}

#[tokio::test]
async fn unknown_preview_read_fault_returns_static_read_failure_without_write_uncertainty() {
    let f = Fixture::new(TOKENS).await;
    let before = f.evidence().await;
    // Isolated schema fault affects this exact SELECT, before any rendering.
    // It is deliberately a failed read, not a simulated post-commit outcome.
    must(
        sqlx::query(
            "ALTER TABLE clinical_note_template_revisions RENAME TO synthetic_preview_read_fault",
        )
        .execute(&f.pool)
        .await,
        "isolated unavailable revision relation installs",
    );
    let response = request(&f.app, &f.token, Method::POST, f.path(), Some(f.input())).await;
    must(
        sqlx::query(
            "ALTER TABLE synthetic_preview_read_fault RENAME TO clinical_note_template_revisions",
        )
        .execute(&f.pool)
        .await,
        "isolated exact revision relation restores",
    );
    let denied = checked(response, StatusCode::CONFLICT).await;
    assert_eq!(
        denied["error"]["code"],
        "clinical_note_template_preview_failed"
    );
    let body = denied.to_string();
    for internal in [
        "synthetic_preview_read_fault",
        "clinical_note_template_revisions",
        "42P01",
        "sqlx",
        "Postgres",
        "SELECT ",
    ] {
        assert!(
            !body.contains(internal),
            "unknown read denial does not reflect SQL internals"
        );
    }
    assert!(
        f.evidence().await == before,
        "unknown failed preview read creates no clinical effect, audit or command"
    );
}
