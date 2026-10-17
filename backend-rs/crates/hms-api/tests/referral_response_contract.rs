//! Referral responses use real routes and isolated synthetic state; no private body output.
mod support;
use axum::response::Response;
use support::*;

fn must<T, E>(value: Result<T, E>, message: &'static str) -> T {
    value.unwrap_or_else(|_| panic!("{message}"))
}
async fn request(
    app: &TestApp,
    token: &str,
    method: Method,
    path: String,
    input: Option<Value>,
) -> Response {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = if let Some(input) = input {
        builder = builder.header("content-type", "application/json");
        Body::from(must(
            serde_json::to_vec(&input),
            "synthetic request encodes",
        ))
    } else {
        Body::empty()
    };
    must(
        app.clone()
            .oneshot(must(builder.body(body), "synthetic request builds"))
            .await,
        "actual referral route responds",
    )
}
async fn body(response: Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded response reads",
    );
    (
        status,
        must(serde_json::from_slice(&bytes), "response envelope decodes"),
    )
}
async fn checked(response: Response, expected: StatusCode) -> Value {
    let (status, value) = body(response).await;
    assert_eq!(
        status,
        expected,
        "static referral route code {}",
        value["error"]["code"].as_str().unwrap_or("none")
    );
    value
}
struct Fixture {
    app: TestApp,
    pool: hms_db::PgPool,
    token: String,
    patient: Uuid,
}
impl Fixture {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
        let (token, _, _) = login(app.clone(), "owner@hms.local").await;
        let patient = Uuid::new_v4();
        must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,'Synthetic','Referral','2000-01-01','other','active','registered','presumed_alive')").bind(patient).bind(app.state().facility_id()).bind(format!("SYN-RESPONSE-{}",patient.simple())).execute(&pool).await,"synthetic patient inserts");
        must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned')").bind(app.state().facility_id()).bind(owner).bind(patient).execute(&pool).await,"ordinary patient relationship inserts");
        Self {
            app,
            pool,
            token,
            patient,
        }
    }
    async fn post(&self, path: String, value: Value) -> Response {
        request(&self.app, &self.token, Method::POST, path, Some(value)).await
    }
    async fn create(&self) -> Uuid {
        let value=checked(self.post("/api/v2/referrals".into(),json!({"patient_id":self.patient,"to_service":"Synthetic specialist review","priority":"routine","reason":"Synthetic response contract"})).await,StatusCode::OK).await;
        must(
            Uuid::parse_str(
                value["data"]["id"]
                    .as_str()
                    .expect("opaque referral identity exists"),
            ),
            "opaque identity parses",
        )
    }
    async fn scheduled(&self) -> Uuid {
        let id = self.create().await;
        checked(
            self.post(
                format!("/api/v2/referrals/{id}/accept"),
                json!({"acceptance_notes":"Synthetic accepted review"}),
            )
            .await,
            StatusCode::OK,
        )
        .await;
        let start = Utc::now() + Duration::hours(2);
        let value=checked(self.post(format!("/api/v2/referrals/{id}/schedule"),json!({"starts_at":start,"ends_at":start+Duration::minutes(30),"manual_booking_reason":"Synthetic explicit manual slot"})).await,StatusCode::OK).await;
        assert!(
            value["data"]["status"] == "scheduled",
            "actual schedule route establishes scheduled source"
        );
        assert!(
            value["data"]["scheduled_appointment_id"].is_string(),
            "scheduled source has a real appointment link"
        );
        id
    }
}

#[tokio::test]
async fn legacy_complete_cannot_report_success_for_an_unchanged_scheduled_or_sent_referral() {
    let f = Fixture::new().await;
    let scheduled = f.scheduled().await;
    let sent = f.create().await;
    let mut outcomes = Vec::new();
    for (id, original) in [(scheduled, "scheduled"), (sent, "sent")] {
        let (status,value)=body(f.post(format!("/api/v2/referrals/{id}/complete"),json!({"specialist_notes":"SYNTHETIC_PRIVATE_RESPONSE_NOT_SAVED","recommendations":"SYNTHETIC_PRIVATE_RECOMMENDATION"})).await).await;
        let saved:(String,Option<String>,Option<chrono::DateTime<Utc>>)=must(sqlx::query_as("SELECT status,specialist_notes,completed_at FROM referrals WHERE facility_id=$1 AND id=$2").bind(f.app.state().facility_id()).bind(id).fetch_one(&f.pool).await,"saved source state loads");
        let false_success =
            status.is_success() && saved.0 == original && saved.1.is_none() && saved.2.is_none();
        outcomes.push((
            status,
            value["error"]["code"].as_str().unwrap_or("none").to_owned(),
            false_success,
        ));
    }
    assert!(
        outcomes.iter().all(|(_, _, false_success)| !false_success),
        "legacy complete must not acknowledge an unchanged source as saved"
    );
    // This retired writer cannot bypass the new reviewed response command.
    assert!(
        outcomes
            .iter()
            .all(|(status, code, _)| *status == StatusCode::CONFLICT
                && code == "referral_response_review_required"),
        "legacy completion requires the explicit reviewed response workflow"
    );
}

#[tokio::test]
async fn referral_schedule_has_no_committed_appointment_before_its_referral_source_lock() {
    let f = Fixture::new().await;
    let id = f.create().await;
    checked(
        f.post(
            format!("/api/v2/referrals/{id}/accept"),
            json!({"acceptance_notes":"Synthetic explicit accepted source"}),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let before: i64 = must(
        sqlx::query_scalar(
            "SELECT count(*) FROM appointments WHERE facility_id=$1 AND patient_id=$2",
        )
        .bind(f.app.state().facility_id())
        .bind(f.patient)
        .fetch_one(&f.pool)
        .await,
        "initial appointment count loads",
    );
    let mut gate = must(f.pool.begin().await, "source gate begins");
    let gate_pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "source gate identity loads",
    );
    must(
        sqlx::query("SELECT id FROM referrals WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(f.app.state().facility_id())
            .bind(id)
            .execute(&mut *gate)
            .await,
        "exact source root locks",
    );
    let app = f.app.clone();
    let token = f.token.clone();
    let start = Utc::now() + Duration::hours(3);
    let pending = tokio::spawn(async move {
        request(&app,&token,Method::POST,format!("/api/v2/referrals/{id}/schedule"),Some(json!({"starts_at":start,"ends_at":start+Duration::minutes(30),"manual_booking_reason":"Synthetic atomic referral slot"}))).await
    });
    let mut source_wait = false;
    for _ in 0..150 {
        source_wait=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>$1 AND $1=ANY(pg_blocking_pids(pid)) AND query ILIKE '%referrals%')").bind(gate_pid).fetch_one(&f.pool).await,"actual source wait edge loads");
        if source_wait {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let committed: i64 = must(
        sqlx::query_scalar(
            "SELECT count(*) FROM appointments WHERE facility_id=$1 AND patient_id=$2",
        )
        .bind(f.app.state().facility_id())
        .bind(f.patient)
        .fetch_one(&f.pool)
        .await,
        "observer reads only committed appointments",
    );
    let histories:i64=must(sqlx::query_scalar("SELECT count(*) FROM appointment_history h JOIN appointments a ON a.id=h.appointment_id AND a.facility_id=h.facility_id WHERE a.facility_id=$1 AND a.patient_id=$2").bind(f.app.state().facility_id()).bind(f.patient).fetch_one(&f.pool).await,"observer reads committed appointment history");
    must(
        gate.rollback().await,
        "source gate releases before assertions",
    );
    let result = must(pending.await, "actual schedule request joins");
    let result = checked(result, StatusCode::OK).await;
    assert!(
        result["data"]["status"] == "scheduled",
        "released schedule saves an explicit source link"
    );
    assert!(
        source_wait,
        "actual route waits on the held referral source"
    );
    assert!(
        committed == before && histories == 0,
        "no independently committed appointment or history may precede the referral source lock"
    );
}

impl Fixture {
    fn response_path(&self, id: Uuid) -> String {
        format!("/api/v2/patients/{}/referrals/{id}/response", self.patient)
    }
    async fn get(&self, path: String) -> Response {
        request(&self.app, &self.token, Method::GET, path, None).await
    }
    async fn context(&self, id: Uuid) -> Value {
        checked(self.get(self.response_path(id)).await, StatusCode::OK).await["data"].clone()
    }
    async fn accepted(&self) -> Uuid {
        let id = self.create().await;
        checked(
            self.post(
                format!("/api/v2/referrals/{id}/accept"),
                json!({"acceptance_notes":"Synthetic accepted response source"}),
            )
            .await,
            StatusCode::OK,
        )
        .await;
        id
    }
    async fn input(&self, id: Uuid, operation: &str, notes: &str) -> Value {
        let c = self.context(id).await;
        json!({"client_request_id":Uuid::new_v4(),"expected_version":c["version"],"expected_context_token":c["context_token"],"operation":operation,"specialist_notes":notes,"recommendations":"  SYNTHETIC_PRIVATE_RECOMMENDATIONS\nExact  ","amendment_reason":if operation=="amend"{Some(" Synthetic completed response correction ")}else{None}})
    }
    async fn execute(&self, id: Uuid, input: Value) -> Value {
        checked(
            self.post(format!("{}/commands", self.response_path(id)), input)
                .await,
            StatusCode::OK,
        )
        .await["data"]
            .clone()
    }
    async fn grant_manager(&self, full: bool) -> String {
        let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
        for permission in [
            PermissionCode::PatientDemographicsView,
            PermissionCode::ReferralManage,
            PermissionCode::ClinicalDocumentationManage,
            PermissionCode::ClinicalDocumentationView,
        ] {
            grant_test_permission(&self.app, user, permission).await;
        }
        for feature in [
            FeatureKey::Patients,
            FeatureKey::Referrals,
            FeatureKey::Encounters,
        ] {
            grant_test_feature(&self.app, user, feature).await;
        }
        grant_test_patient_visibility(&self.app, user, PatientDataVisibility::Demographics).await;
        if full {
            grant_test_patient_visibility(&self.app, user, PatientDataVisibility::FullClinical)
                .await;
        }
        login(self.app.clone(), "limited@hms.local").await.0
    }
}
#[tokio::test]
async fn reviewed_draft_scheduled_completion_and_terminal_amendment_preserve_exact_immutable_evidence(
) {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    let c = f.context(id).await;
    assert!(
        c["version"] == 0
            && c["response"].is_null()
            && c["can_save_draft"] == true
            && c["can_complete"] == true
    );
    let first = f
        .input(
            id,
            "save_draft",
            "  SYNTHETIC_PRIVATE_FIRST_RESPONSE\nExact  ",
        )
        .await;
    let draft = f.execute(id, first.clone()).await;
    assert!(
        draft["operation"] == "draft_saved"
            && draft["response"]["version"] == 1
            && draft["response"]["status"] == "accepted"
            && draft["response"]["completed_at"].is_null()
    );
    assert!(
        draft["response"]["specialist_notes"] == first["specialist_notes"]
            && draft["response"]["recommendations"] == first["recommendations"]
    );
    let start = Utc::now() + Duration::hours(4);
    checked(f.post(format!("/api/v2/referrals/{id}/schedule"),json!({"starts_at":start,"ends_at":start+Duration::minutes(30),"manual_booking_reason":"Synthetic later scheduled review"})).await,StatusCode::OK).await;
    let scheduled = f.context(id).await;
    assert!(
        scheduled["status"] == "scheduled"
            && scheduled["version"] == 1
            && scheduled["response"]["status"] == "accepted"
            && scheduled["can_complete"] == true
            && scheduled["context_token"] != c["context_token"]
    );
    let complete_input = f
        .input(id, "complete", "SYNTHETIC_PRIVATE_COMPLETED_RESPONSE")
        .await;
    let complete = f.execute(id, complete_input.clone()).await;
    assert!(
        complete["operation"] == "completed"
            && complete["response"]["status"] == "completed"
            && complete["response"]["version"] == 2
            && complete["response"]["completed_at"].is_string()
    );
    // Historical documentation remains available after death, without inferring a new encounter.
    must(
        sqlx::query("UPDATE patients SET vital_status='deceased' WHERE facility_id=$1 AND id=$2")
            .bind(f.app.state().facility_id())
            .bind(f.patient)
            .execute(&f.pool)
            .await,
        "historical patient state updates",
    );
    let amendment_input = f
        .input(id, "amend", "SYNTHETIC_PRIVATE_AMENDED_RESPONSE")
        .await;
    let amended = f.execute(id, amendment_input).await;
    assert!(
        amended["response"]["version"] == 3
            && amended["response"]["completed_at"] == complete["response"]["completed_at"]
            && amended["response"]["amendment_reason"] == "Synthetic completed response correction"
    );
    let old = checked(
        f.get(format!(
            "{}/versions/{}",
            f.response_path(id),
            draft["response"]["id"].as_str().unwrap()
        ))
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(
        old["data"] == draft["response"],
        "original exact response version remains unchanged"
    );
    let replay = f.execute(id, first.clone()).await;
    assert!(
        replay["replayed"] == true && replay["response"] == draft["response"],
        "same key retains original recorded response after later completion/amendment"
    );
    let receipt = checked(
        f.get(format!(
            "{}/requests/{}",
            f.response_path(id),
            first["client_request_id"].as_str().unwrap()
        ))
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(receipt["data"]["response"] == draft["response"]);
    let mut changed = first.clone();
    changed["specialist_notes"] = json!("Different synthetic request intent");
    let denied = checked(
        f.post(format!("{}/commands", f.response_path(id)), changed)
            .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert!(denied["error"]["code"] == "referral_response_request_conflict");
    let page = checked(
        f.get(format!("{}/history?limit=1", f.response_path(id)))
            .await,
        StatusCode::OK,
    )
    .await;
    assert!(
        page["data"].as_array().unwrap().len() == 1
            && page["data"][0]["version"] == 3
            && page["page"]["next_cursor"] == "v:3"
    );
    assert!(
        page["data"][0].get("specialist_notes").is_none()
            && page["data"][0].get("amendment_reason").is_none()
    );
    let next = checked(
        f.get(format!(
            "{}/history?limit=1&cursor=v:3",
            f.response_path(id)
        ))
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(next["data"][0]["version"] == 2);
    let counts:(i64,i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM referral_response_revisions WHERE referral_id=$1),(SELECT count(*) FROM referral_response_commands WHERE referral_id=$1),(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='referral.response_recorded')").bind(id).fetch_one(&f.pool).await,"exact saved event counts load");
    assert_eq!(counts, (3, 3, 3));
}
#[tokio::test]
async fn protected_response_body_never_reappears_in_legacy_demographic_list_or_detail() {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    let input = f
        .input(id, "save_draft", "SYNTHETIC_PRIVATE_HIDDEN_RESPONSE")
        .await;
    f.execute(id, input).await;
    let token = f.grant_manager(false).await;
    for path in [
        format!("/api/v2/referrals/{id}"),
        "/api/v2/referrals?limit=100".into(),
        format!("/api/v2/referrals/{id}/sla-state"),
    ] {
        let value = checked(
            request(&f.app, &token, Method::GET, path, None).await,
            StatusCode::OK,
        )
        .await;
        let encoded = value.to_string();
        assert!(
            !encoded.contains("SYNTHETIC_PRIVATE_HIDDEN_RESPONSE")
                && !encoded.contains("SYNTHETIC_PRIVATE_RECOMMENDATIONS"),
            "legacy operational projections never disclose protected response text"
        );
        if value["data"].is_object() && value["data"].get("specialist_notes").is_some() {
            assert!(
                value["data"]["specialist_notes"].is_null()
                    && value["data"]["recommendations"].is_null()
            );
        }
    }
    let denied = checked(
        request(&f.app, &token, Method::GET, f.response_path(id), None).await,
        StatusCode::FORBIDDEN,
    )
    .await;
    assert!(denied.get("data").is_none_or(Value::is_null));
}
#[tokio::test]
async fn ordinary_full_purpose_requires_real_care_or_referral_actor_edges_without_note_manage_inference(
) {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    let token = f.grant_manager(true).await;
    checked(
        request(&f.app, &token, Method::GET, f.response_path(id), None).await,
        StatusCode::FORBIDDEN,
    )
    .await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    // An actual authored clinical note creates a genuine care edge. It is not
    // fabricated from role, service name or a merely readable referral identity.
    let note=checked(request(&f.app,&token,Method::POST,format!("/api/v2/patients/{}/clinical/notes/record",f.patient),Some(json!({"client_request_id":Uuid::new_v4(),"encounter_id":null,"template_revision_id":null,"note_type":"doctor_note","title":"Synthetic authored relationship","body":"Synthetic authored clinical context"}))).await,StatusCode::OK).await;
    assert!(note["data"]["note"]["author_user_id"] == json!(user));
    must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code IN ('clinical_documentation.manage','clinical_documentation.view')").bind(user).execute(&f.pool).await,"unrelated note permissions withdraw");
    must(
        sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
            .bind(user)
            .execute(&f.pool)
            .await,
        "permission snapshot advances",
    );
    let token = login(f.app.clone(), "limited@hms.local").await.0;
    checked(
        request(&f.app, &token, Method::GET, f.response_path(id), None).await,
        StatusCode::OK,
    )
    .await;
    let receipt = f
        .input(id, "save_draft", "Synthetic shared care response")
        .await;
    f.execute(id, receipt.clone()).await;
    checked(
        request(
            &f.app,
            &token,
            Method::GET,
            format!(
                "{}/requests/{}",
                f.response_path(id),
                receipt["client_request_id"].as_str().unwrap()
            ),
            None,
        )
        .await,
        StatusCode::NOT_FOUND,
    )
    .await;
    let current = checked(
        request(&f.app, &token, Method::GET, f.response_path(id), None).await,
        StatusCode::OK,
    )
    .await;
    let command = json!({"client_request_id":Uuid::new_v4(),"expected_version":current["data"]["version"],"expected_context_token":current["data"]["context_token"],"operation":"save_draft","specialist_notes":"Synthetic authored-care response without note permission","recommendations":"","amendment_reason":null});
    let own = checked(
        request(
            &f.app,
            &token,
            Method::POST,
            format!("{}/commands", f.response_path(id)),
            Some(command),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(
        own["data"]["response"]["recorded_by_user_id"] == json!(user)
            && own["data"]["response"]["version"] == 2
    );
}
#[tokio::test]
async fn reviewed_response_rejects_stale_sources_invalid_fields_and_foreign_exact_versions() {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    let first = f
        .input(id, "save_draft", "Synthetic first reviewed response")
        .await;
    let saved = f.execute(id, first.clone()).await;
    let mut stale = first.clone();
    stale["client_request_id"] = json!(Uuid::new_v4());
    let denied = checked(
        f.post(format!("{}/commands", f.response_path(id)), stale)
            .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert!(denied["error"]["code"] == "referral_response_source_changed");
    let current = f
        .input(id, "save_draft", "Synthetic valid reviewed response")
        .await;
    for (field, value) in [
        ("client_request_id", json!(Uuid::nil())),
        ("expected_context_token", json!("bad")),
        ("expected_version", json!(-1)),
        ("specialist_notes", json!("short")),
        ("recommendations", json!("x".repeat(10001))),
        ("amendment_reason", json!("not a draft field")),
        ("extra_tokens", json!({"name":"PRIVATE"})),
    ] {
        let mut input = current.clone();
        input[field] = value;
        let denied = checked(
            f.post(format!("{}/commands", f.response_path(id)), input)
                .await,
            StatusCode::BAD_REQUEST,
        )
        .await;
        assert!(denied.get("data").is_none_or(Value::is_null));
    }
    let other = f.accepted().await;
    checked(
        f.get(format!(
            "{}/versions/{}",
            f.response_path(other),
            saved["response"]["id"].as_str().unwrap()
        ))
        .await,
        StatusCode::NOT_FOUND,
    )
    .await;
    for cursor in ["bad", "v:0", "v:-1", "v:999999999999999999999999"] {
        checked(
            f.get(format!("{}/history?cursor={cursor}", f.response_path(id)))
                .await,
            StatusCode::BAD_REQUEST,
        )
        .await;
    }
}
#[tokio::test]
async fn response_audit_failure_rolls_back_body_version_and_receipt_as_unconfirmed() {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    let input = f
        .input(id, "save_draft", "SYNTHETIC_PRIVATE_ROLLBACK_RESPONSE")
        .await;
    must(sqlx::query("CREATE FUNCTION synthetic_response_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='referral.response_recorded' THEN RAISE EXCEPTION 'synthetic_response_audit_fault'; END IF; RETURN NEW; END $$").execute(&f.pool).await,"isolated fault function creates");
    must(sqlx::query("CREATE TRIGGER synthetic_response_audit_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_response_audit_fault()").execute(&f.pool).await,"isolated fault installs");
    let denied = checked(
        f.post(format!("{}/commands", f.response_path(id)), input)
            .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert!(denied["error"]["code"] == "referral_response_write_unconfirmed");
    assert!(!denied
        .to_string()
        .contains("SYNTHETIC_PRIVATE_ROLLBACK_RESPONSE"));
    let count:(i64,i64,i64)=must(sqlx::query_as("SELECT response_version,(SELECT count(*) FROM referral_response_revisions WHERE referral_id=$1),(SELECT count(*) FROM referral_response_commands WHERE referral_id=$1) FROM referrals WHERE id=$1").bind(id).fetch_one(&f.pool).await,"rolled back evidence counts load");
    assert_eq!(count, (0, 0, 0));
}
#[tokio::test]
async fn schedule_audit_failure_conserves_appointment_history_and_referral_link_atomically() {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    must(sqlx::query("CREATE FUNCTION synthetic_schedule_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='referral.scheduled' THEN RAISE EXCEPTION 'synthetic_schedule_audit_fault'; END IF; RETURN NEW; END $$").execute(&f.pool).await,"isolated schedule fault function creates");
    must(sqlx::query("CREATE TRIGGER synthetic_schedule_audit_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_schedule_audit_fault()").execute(&f.pool).await,"isolated schedule fault installs");
    let start = Utc::now() + Duration::hours(5);
    let denied=checked(f.post(format!("/api/v2/referrals/{id}/schedule"),json!({"starts_at":start,"ends_at":start+Duration::minutes(30),"manual_booking_reason":"Synthetic atomic rollback slot"})).await,StatusCode::CONFLICT).await;
    assert!(denied["error"]["code"] == "referral_response_write_unconfirmed");
    let counts:(i64,i64,String,Option<Uuid>)=must(sqlx::query_as("SELECT (SELECT count(*) FROM appointments WHERE patient_id=$2),(SELECT count(*) FROM appointment_history h JOIN appointments a ON a.id=h.appointment_id WHERE a.patient_id=$2),status,scheduled_appointment_id FROM referrals WHERE id=$1").bind(id).bind(f.patient).fetch_one(&f.pool).await,"atomic schedule rollback counts load");
    assert!(counts.0 == 0 && counts.1 == 0 && counts.2 == "accepted" && counts.3.is_none());
}

async fn waiting_on_source(pool: &hms_db::PgPool, blocker: i32) -> bool {
    for _ in 0..150 {
        let waiting: bool = must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,'FROM referrals')>0)").bind(blocker).fetch_one(pool).await,"bounded actual referral wait graph loads");
        if waiting {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    false
}

#[tokio::test]
async fn concurrent_reviewed_commands_have_one_cas_winner_and_one_immutable_uuid_result() {
    let f = Fixture::new().await;
    for same_key in [false, true] {
        let id = f.accepted().await;
        let first = f
            .input(id, "save_draft", "Synthetic concurrent exact response")
            .await;
        let mut second = first.clone();
        if !same_key {
            second["client_request_id"] = json!(Uuid::new_v4());
        }
        let path = format!("{}/commands", f.response_path(id));
        let (one, two) = tokio::join!(f.post(path.clone(), first), f.post(path, second));
        let one = body(one).await;
        let two = body(two).await;
        let count: (i64,i64,i64) = must(sqlx::query_as("SELECT response_version,(SELECT count(*) FROM referral_response_revisions WHERE referral_id=$1),(SELECT count(*) FROM referral_response_commands WHERE referral_id=$1) FROM referrals WHERE id=$1").bind(id).fetch_one(&f.pool).await,"concurrent saved evidence counts load");
        assert_eq!(count, (1, 1, 1));
        if same_key {
            assert!(one.0 == StatusCode::OK && two.0 == StatusCode::OK);
            assert!(one.1["data"]["response"] == two.1["data"]["response"]);
            assert!(one.1["data"]["replayed"].as_bool() != two.1["data"]["replayed"].as_bool());
        } else {
            assert!(
                [one.0, two.0].contains(&StatusCode::OK)
                    && [one.0, two.0].contains(&StatusCode::CONFLICT)
            );
            let denied = if one.0 == StatusCode::CONFLICT {
                &one.1
            } else {
                &two.1
            };
            assert!(denied["error"]["code"] == "referral_response_source_changed");
        }
    }
}

#[tokio::test]
async fn pure_response_read_faults_are_static_definite_failures_without_write_recovery_codes() {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    let input = f
        .input(id, "save_draft", "SYNTHETIC_PRIVATE_READ_FAULT_BODY")
        .await;
    let saved = f.execute(id, input.clone()).await;
    must(sqlx::query("ALTER TABLE referral_response_revisions RENAME COLUMN operation TO synthetic_read_fault_operation").execute(&f.pool).await,"isolated read fault installs");
    let mut outcomes = Vec::new();
    for path in [
        f.response_path(id),
        format!("{}/history", f.response_path(id)),
        format!(
            "{}/versions/{}",
            f.response_path(id),
            saved["response"]["id"].as_str().unwrap()
        ),
        format!(
            "{}/requests/{}",
            f.response_path(id),
            input["client_request_id"].as_str().unwrap()
        ),
    ] {
        outcomes.push(body(f.get(path).await).await);
    }
    must(sqlx::query("ALTER TABLE referral_response_revisions RENAME COLUMN synthetic_read_fault_operation TO operation").execute(&f.pool).await,"isolated read fault restores before assertions");
    assert!(outcomes
        .iter()
        .all(|(status, value)| *status == StatusCode::CONFLICT
            && value["error"]["code"] == "referral_response_failed"
            && !value
                .to_string()
                .contains("SYNTHETIC_PRIVATE_READ_FAULT_BODY")));
    let current = f.context(id).await;
    assert!(current["version"] == 1 && current["response"]["id"] == saved["response"]["id"]);
}

#[tokio::test]
async fn corrupt_imported_receipts_cannot_project_another_root_or_an_altered_clinical_snapshot() {
    let f = Fixture::new().await;
    let a = f.accepted().await;
    let b = f.accepted().await;
    let input = f
        .input(a, "save_draft", "SYNTHETIC_PRIVATE_RECEIPT_A")
        .await;
    let saved_a = f.execute(a, input.clone()).await;
    let other_input = f
        .input(b, "save_draft", "SYNTHETIC_PRIVATE_RECEIPT_B")
        .await;
    let saved_b = f.execute(b, other_input).await;
    let mut outcomes = Vec::new();
    must(sqlx::query("ALTER TABLE referral_response_commands DISABLE TRIGGER referral_response_command_immutable").execute(&f.pool).await,"trusted corruption seam opens only in isolated fixture");
    for wrong_root in [true, false] {
        let mut receipt = if wrong_root {
            saved_b.clone()
        } else {
            saved_a.clone()
        };
        receipt["replayed"] = json!(false);
        if !wrong_root {
            receipt["response"]["specialist_notes"] = json!("SYNTHETIC_PRIVATE_RECEIPT_B");
        }
        let result = must(
            Uuid::parse_str(receipt["response"]["id"].as_str().unwrap()),
            "opaque result identity parses",
        );
        must(sqlx::query("UPDATE referral_response_commands SET result_id=$2,receipt=$3 WHERE referral_id=$1").bind(a).bind(result).bind(sqlx::types::Json(receipt)).execute(&f.pool).await,"isolated imported receipt corruption persists");
        outcomes.push(
            body(
                f.get(format!(
                    "{}/requests/{}",
                    f.response_path(a),
                    input["client_request_id"].as_str().unwrap()
                ))
                .await,
            )
            .await,
        );
        outcomes.push(
            body(
                f.post(format!("{}/commands", f.response_path(a)), input.clone())
                    .await,
            )
            .await,
        );
    }
    let mut restored = saved_a.clone();
    restored["replayed"] = json!(false);
    let result = must(
        Uuid::parse_str(restored["response"]["id"].as_str().unwrap()),
        "original result identity parses",
    );
    must(
        sqlx::query(
            "UPDATE referral_response_commands SET result_id=$2,receipt=$3 WHERE referral_id=$1",
        )
        .bind(a)
        .bind(result)
        .bind(sqlx::types::Json(restored))
        .execute(&f.pool)
        .await,
        "original receipt restores before assertions",
    );
    must(sqlx::query("ALTER TABLE referral_response_commands ENABLE TRIGGER referral_response_command_immutable").execute(&f.pool).await,"fixture immutable guard restores");
    for (i, (status, value)) in outcomes.iter().enumerate() {
        assert!(
            *status == StatusCode::CONFLICT
                && value["error"]["code"]
                    == if i % 2 == 0 {
                        "referral_response_failed"
                    } else {
                        "referral_response_write_unconfirmed"
                    }
        );
        assert!(!value.to_string().contains("SYNTHETIC_PRIVATE_RECEIPT_B"));
    }
    let count:(i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM referral_response_revisions WHERE referral_id IN($1,$2)),(SELECT count(*) FROM referral_response_commands WHERE referral_id IN($1,$2))").bind(a).bind(b).fetch_one(&f.pool).await,"receipt faults do not create new evidence");
    assert_eq!(count, (2, 2));
}

#[tokio::test]
async fn response_paths_do_not_cross_patient_or_facility_and_exact_versions_never_fall_back() {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    let input = f
        .input(id, "save_draft", "SYNTHETIC_PRIVATE_LOCAL_SCOPE")
        .await;
    let saved = f.execute(id, input.clone()).await;
    let foreign = Uuid::new_v4();
    let patient = Uuid::new_v4();
    let referral = Uuid::new_v4();
    must(sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) SELECT $1,'SYN-RESPONSE-FOREIGN','Synthetic foreign response facility',deployment_profile FROM facilities WHERE id=$2").bind(foreign).bind(f.app.state().facility_id()).execute(&f.pool).await,"foreign synthetic facility inserts");
    must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) VALUES($1,$2,'SYN-RESPONSE-FOREIGN','Synthetic','Foreign','2000-01-01','other','active')").bind(patient).bind(foreign).execute(&f.pool).await,"foreign synthetic patient inserts");
    must(sqlx::query("INSERT INTO referrals(id,facility_id,patient_id,to_service,priority,status,sla_due_at,specialist_notes) VALUES($1,$2,$3,'Synthetic foreign service','routine','completed',clock_timestamp(),'SYNTHETIC_PRIVATE_FOREIGN_SCOPE')").bind(referral).bind(foreign).bind(patient).execute(&f.pool).await,"observed foreign imported response inserts");
    let revision: Uuid = must(
        sqlx::query_scalar("SELECT id FROM referral_response_revisions WHERE referral_id=$1")
            .bind(referral)
            .fetch_one(&f.pool)
            .await,
        "foreign imported exact revision loads privately",
    );
    let mut outcomes = Vec::new();
    for path in [
        format!("/api/v2/patients/{patient}/referrals/{id}/response"),
        format!("/api/v2/patients/{patient}/referrals/{referral}/response"),
        format!("{}/versions/{revision}", f.response_path(id)),
        format!("{}/versions/{}", f.response_path(id), Uuid::new_v4()),
    ] {
        outcomes.push(body(f.get(path).await).await);
    }
    let denied = body(
        f.post(
            format!("/api/v2/patients/{patient}/referrals/{referral}/response/commands"),
            input,
        )
        .await,
    )
    .await;
    outcomes.push(denied);
    assert!(outcomes
        .iter()
        .all(|(status, value)| *status == StatusCode::NOT_FOUND
            && !value.to_string().contains("SYNTHETIC_PRIVATE_")
            && value.get("data").is_none_or(Value::is_null)));
    let current = f.context(id).await;
    assert!(current["response"]["id"] == saved["response"]["id"] && current["version"] == 1);
}

#[tokio::test]
async fn booking_capacity_and_overbooking_refusals_are_definite_and_leave_no_partial_referral_link()
{
    let f = Fixture::new().await;
    let clinic: Uuid = must(
        sqlx::query_scalar(
            "SELECT id FROM clinics WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
        )
        .bind(f.app.state().facility_id())
        .fetch_one(&f.pool)
        .await,
        "active local clinic exists",
    );
    let start = Utc::now() + Duration::hours(6);
    let session=checked(f.post("/api/v2/scheduling/sessions".into(),json!({"clinic_id":clinic,"owner_type":"clinic","owner_id":clinic,"name":"Synthetic bounded referral session","mode":"capacity_block","starts_at":start,"ends_at":start+Duration::hours(2),"capacity":1})).await,StatusCode::OK).await["data"]["id"].clone();
    let slot = json!({"session_id":session,"clinic_id":clinic,"starts_at":start+Duration::minutes(15),"ends_at":start+Duration::minutes(45)});
    let first = f.accepted().await;
    checked(
        f.post(format!("/api/v2/referrals/{first}/schedule"), slot.clone())
            .await,
        StatusCode::OK,
    )
    .await;
    let denied_root = f.accepted().await;
    let mut outcomes = vec![
        body(
            f.post(
                format!("/api/v2/referrals/{denied_root}/schedule"),
                slot.clone(),
            )
            .await,
        )
        .await,
    ];
    let session_id = must(
        Uuid::parse_str(session.as_str().unwrap()),
        "opaque session identity parses",
    );
    must(
        sqlx::query(
            "UPDATE clinic_sessions SET allow_overbooking=true,overbook_limit=1 WHERE id=$1",
        )
        .bind(session_id)
        .execute(&f.pool)
        .await,
        "explicit overbooking policy enables one extra slot",
    );
    outcomes.push(
        body(
            f.post(
                format!("/api/v2/referrals/{denied_root}/schedule"),
                slot.clone(),
            )
            .await,
        )
        .await,
    );
    let overbooked = f.accepted().await;
    let mut overbook = slot.clone();
    overbook["overbook_reason"] = json!("Synthetic reviewed capacity exception");
    checked(
        f.post(
            format!("/api/v2/referrals/{overbooked}/schedule"),
            overbook.clone(),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    outcomes.push(
        body(
            f.post(
                format!("/api/v2/referrals/{denied_root}/schedule"),
                overbook,
            )
            .await,
        )
        .await,
    );
    assert!(outcomes
        .iter()
        .all(|(status, value)| *status == StatusCode::CONFLICT
            && value["error"]["code"] == "referral_response_source_changed"));
    let counts:(i64,i64,String,Option<Uuid>)=must(sqlx::query_as("SELECT (SELECT count(*) FROM appointments WHERE patient_id=$2),(SELECT count(*) FROM appointment_history h JOIN appointments a ON a.id=h.appointment_id WHERE a.patient_id=$2),status,scheduled_appointment_id FROM referrals WHERE id=$1").bind(denied_root).bind(f.patient).fetch_one(&f.pool).await,"known booking denials preserve atomic evidence counts");
    assert!(counts.0 == 2 && counts.1 == 1 && counts.2 == "accepted" && counts.3.is_none());
}

#[tokio::test]
async fn scheduling_rechecks_appointment_permission_and_feature_after_actual_referral_wait() {
    for feature in [false, true] {
        let f = Fixture::new().await;
        let id = f.accepted().await;
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        let mut gate = must(f.pool.begin().await, "root authority gate begins");
        let pid: i32 = must(
            sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *gate)
                .await,
            "gate identity loads",
        );
        must(
            sqlx::query("SELECT id FROM referrals WHERE id=$1 FOR UPDATE")
                .bind(id)
                .execute(&mut *gate)
                .await,
            "actual referral root locks",
        );
        let app = f.app.clone();
        let token = f.token.clone();
        let start = Utc::now() + Duration::hours(7);
        let task = tokio::spawn(async move {
            request(&app,&token,Method::POST,format!("/api/v2/referrals/{id}/schedule"),Some(json!({"starts_at":start,"ends_at":start+Duration::minutes(30),"manual_booking_reason":"Synthetic authority wait slot"}))).await
        });
        let waiting = waiting_on_source(&f.pool, pid).await;
        if feature {
            must(
                sqlx::query(
                    "DELETE FROM user_features WHERE user_id=$1 AND feature_key='appointments'",
                )
                .bind(owner)
                .execute(&f.pool)
                .await,
                "booking feature withdraws before retained proof",
            );
        } else {
            must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='appointment.manage'").bind(owner).execute(&f.pool).await,"booking permission withdraws before retained proof");
        }
        must(
            gate.rollback().await,
            "root authority gate releases before assertions",
        );
        let result = must(task.await, "released booking request joins");
        let denied = checked(result, StatusCode::FORBIDDEN).await;
        assert!(waiting && denied["error"]["code"] == "referral_response_unavailable");
        let counts:(i64,i64,i64,String,Option<Uuid>)=must(sqlx::query_as("SELECT (SELECT count(*) FROM appointments WHERE patient_id=$2),(SELECT count(*) FROM appointment_history h JOIN appointments a ON a.id=h.appointment_id WHERE a.patient_id=$2),(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='referral.scheduled'),status,scheduled_appointment_id FROM referrals WHERE id=$1").bind(id).bind(f.patient).fetch_one(&f.pool).await,"withdrawn authority leaves no clinical scheduling effects");
        assert!(
            counts.0 == 0
                && counts.1 == 0
                && counts.2 == 0
                && counts.3 == "accepted"
                && counts.4.is_none()
        );
    }
}

#[tokio::test]
async fn response_command_rechecks_live_permission_feature_visibility_and_session_after_root_wait()
{
    for change in ["permission", "feature", "visibility", "session"] {
        let f = Fixture::new().await;
        let id = f.accepted().await;
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        // The actual creating actor edge is sufficient ordinary purpose, without
        // a fabricated active encounter or an unrelated patient-context fallback.
        must(
            sqlx::query("DELETE FROM patient_contexts WHERE user_id=$1 AND patient_id=$2")
                .bind(owner)
                .bind(f.patient)
                .execute(&f.pool)
                .await,
            "creator relationship control removes separate patient context",
        );
        let input = f
            .input(id, "save_draft", "SYNTHETIC_PRIVATE_WITHDRAWN_AUTHORITY")
            .await;
        let mut gate = must(f.pool.begin().await, "response authority root gate begins");
        let pid: i32 = must(
            sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *gate)
                .await,
            "response root gate identity loads",
        );
        must(
            sqlx::query("SELECT id FROM referrals WHERE id=$1 FOR UPDATE")
                .bind(id)
                .execute(&mut *gate)
                .await,
            "actual response source locks",
        );
        let app = f.app.clone();
        let token = f.token.clone();
        let path = format!("{}/commands", f.response_path(id));
        let task =
            tokio::spawn(
                async move { request(&app, &token, Method::POST, path, Some(input)).await },
            );
        let waiting = waiting_on_source(&f.pool, pid).await;
        match change {
            "permission" => {
                must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='referral.manage'").bind(owner).execute(&f.pool).await,"response permission withdraws");
            }
            "feature" => {
                must(
                    sqlx::query(
                        "DELETE FROM user_features WHERE user_id=$1 AND feature_key='referrals'",
                    )
                    .bind(owner)
                    .execute(&f.pool)
                    .await,
                    "response feature withdraws",
                );
            }
            "visibility" => {
                must(sqlx::query("DELETE FROM user_patient_visibility WHERE user_id=$1 AND visibility='full_clinical'").bind(owner).execute(&f.pool).await,"Full clinical visibility withdraws");
            }
            _ => {
                must(sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL").bind(owner).execute(&f.pool).await,"actual response actor sessions revoke");
            }
        }
        must(
            gate.rollback().await,
            "response root gate releases before assertions",
        );
        let denied = checked(
            must(task.await, "released response request joins"),
            StatusCode::FORBIDDEN,
        )
        .await;
        assert!(
            waiting
                && denied["error"]["code"] == "referral_response_unavailable"
                && !denied
                    .to_string()
                    .contains("SYNTHETIC_PRIVATE_WITHDRAWN_AUTHORITY")
        );
        let count:(i64,i64,i64,i64)=must(sqlx::query_as("SELECT response_version,(SELECT count(*) FROM referral_response_revisions WHERE referral_id=$1),(SELECT count(*) FROM referral_response_commands WHERE referral_id=$1),(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='referral.response_recorded') FROM referrals WHERE id=$1").bind(id).fetch_one(&f.pool).await,"denied response leaves no clinical evidence");
        assert_eq!(count, (0, 0, 0, 0));
    }
}

#[tokio::test]
async fn timed_appointment_authority_expires_while_waiting_on_the_actual_booking_session() {
    let f = Fixture::new().await;
    let id = f.accepted().await;
    let clinic: Uuid = must(
        sqlx::query_scalar(
            "SELECT id FROM clinics WHERE facility_id=$1 AND is_active ORDER BY id LIMIT 1",
        )
        .bind(f.app.state().facility_id())
        .fetch_one(&f.pool)
        .await,
        "timed booking clinic exists",
    );
    let start = Utc::now() + Duration::hours(8);
    let session=checked(f.post("/api/v2/scheduling/sessions".into(),json!({"clinic_id":clinic,"owner_type":"clinic","owner_id":clinic,"name":"Synthetic timed referral session","mode":"capacity_block","starts_at":start,"ends_at":start+Duration::hours(2),"capacity":1})).await,StatusCode::OK).await;
    let session_id = must(
        Uuid::parse_str(session["data"]["id"].as_str().unwrap()),
        "timed session identity parses",
    );
    let _initial = f.grant_manager(false).await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_feature(&f.app, user, FeatureKey::Appointments).await;
    let end:chrono::DateTime<Utc>=must(sqlx::query_scalar("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,granted_by_user_id,starts_at,ends_at,status) VALUES(gen_random_uuid(),$1,$2,'appointment.manage','facility',$3,now()-interval '1 minute',clock_timestamp()+interval '4 seconds','active') RETURNING ends_at").bind(f.app.state().facility_id()).bind(user).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).fetch_one(&f.pool).await,"genuine bounded appointment authority inserts");
    let token = login(f.app.clone(), "limited@hms.local").await.0;
    let mut gate = must(f.pool.begin().await, "timed actual session gate begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "timed session gate identity loads",
    );
    must(
        sqlx::query("SELECT id FROM clinic_sessions WHERE id=$1 FOR UPDATE")
            .bind(session_id)
            .execute(&mut *gate)
            .await,
        "exact booking session locks",
    );
    let app = f.app.clone();
    let task = tokio::spawn(async move {
        request(&app,&token,Method::POST,format!("/api/v2/referrals/{id}/schedule"),Some(json!({"session_id":session_id,"clinic_id":clinic,"starts_at":start+Duration::minutes(15),"ends_at":start+Duration::minutes(45)}))).await
    });
    let mut waiting = false;
    for _ in 0..150 {
        waiting=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,'FROM clinic_sessions')>0)").bind(pid).fetch_one(&f.pool).await,"actual timed session wait graph loads");
        if waiting {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    must(sqlx::query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.05)").bind(end).execute(&f.pool).await,"database clock crosses genuine booking authority deadline");
    must(
        gate.rollback().await,
        "timed session releases before assertions",
    );
    let denied = checked(
        must(task.await, "expired actual booking request joins"),
        StatusCode::FORBIDDEN,
    )
    .await;
    assert!(waiting && denied["error"]["code"] == "referral_response_unavailable");
    let count:(i64,i64,i64,String,Option<Uuid>)=must(sqlx::query_as("SELECT (SELECT count(*) FROM appointments WHERE patient_id=$2),(SELECT count(*) FROM appointment_history h JOIN appointments a ON a.id=h.appointment_id WHERE a.patient_id=$2),(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='referral.scheduled'),status,scheduled_appointment_id FROM referrals WHERE id=$1").bind(id).bind(f.patient).fetch_one(&f.pool).await,"expired booking rolls back all appointment and referral effects");
    assert!(
        count.0 == 0 && count.1 == 0 && count.2 == 0 && count.3 == "accepted" && count.4.is_none()
    );
}
