//! Admission placement safety through real routes and isolated synthetic state.
mod support;
use support::*;

fn must<T, E>(value: Result<T, E>, message: &'static str) -> T {
    value.unwrap_or_else(|_| panic!("{message}"))
}

async fn synthetic_patient(pool: &hms_db::PgPool, facility: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,'Synthetic','Placement','2000-01-01','other','active','registered','presumed_alive')").bind(id).bind(facility).bind(format!("SYN-PLACEMENT-{}",id.simple())).execute(pool).await,"explicit isolated synthetic patient inserts");
    id
}

async fn admit(
    app: &TestApp,
    token: &str,
    patient: Uuid,
    ward: Uuid,
    bed: Uuid,
) -> (StatusCode, String) {
    let response = must(
        app.clone()
            .oneshot(must(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v2/admissions")
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(must(
                        serde_json::to_vec(
                            &json!({"patient_id":patient,"ward_id":ward,"bed_id":bed}),
                        ),
                        "bounded synthetic admission input encodes",
                    ))),
                "synthetic admission request builds",
            ))
            .await,
        "actual admission route responds",
    );
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded actual admission response reads",
    );
    let value: Value = must(
        serde_json::from_slice(&bytes),
        "actual admission envelope decodes",
    );
    (
        status,
        value["error"]["code"].as_str().unwrap_or("none").to_owned(),
    )
}

#[tokio::test]
async fn explicit_admission_bed_cannot_duplicate_an_owner_claim_cleaning_or_mismatch_its_ward() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
    let token = login(app.clone(), "owner@hms.local").await.0;
    let source = Uuid::new_v4();
    let other = Uuid::new_v4();
    for (id, code) in [
        (source, "SYN-PLACEMENT-SOURCE"),
        (other, "SYN-PLACEMENT-OTHER"),
    ] {
        must(sqlx::query("INSERT INTO wards(id,facility_id,code,name,status) VALUES($1,$2,$3,'Synthetic placement ward','active')").bind(id).bind(facility).bind(code).execute(&pool).await,"explicit synthetic ward inserts");
    }
    let available = Uuid::new_v4();
    let cleaning = Uuid::new_v4();
    let wrong_ward = Uuid::new_v4();
    for (id, ward, code, status) in [
        (available, source, "SYN-AVAILABLE", "available"),
        (cleaning, source, "SYN-CLEANING", "cleaning"),
        (wrong_ward, other, "SYN-OTHER-WARD", "available"),
    ] {
        must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,bed_code,status,cleaning_due_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $5='cleaning' THEN clock_timestamp()+interval '1 hour' ELSE NULL END)").bind(id).bind(facility).bind(ward).bind(code).bind(status).execute(&pool).await,"explicit synthetic bed state inserts");
    }
    let mut outcomes = Vec::new();
    for bed in [available, available, cleaning, wrong_ward] {
        let patient = synthetic_patient(&pool, facility).await;
        outcomes.push(admit(&app, &token, patient, source, bed).await);
    }
    let counts:(i64,i64,i64)=must(sqlx::query_as("SELECT count(*) FILTER(WHERE bed_id=$2),count(*) FILTER(WHERE bed_id=$3),count(*) FILTER(WHERE bed_id=$4) FROM admission_cases WHERE facility_id=$1 AND status IN('ready_for_activation','admitted','discharge_pending') AND bed_id IN($2,$3,$4)").bind(facility).bind(available).bind(cleaning).bind(wrong_ward).fetch_one(&pool).await,"committed exact bed ownership facts load");
    let cleaning_state: String = must(
        sqlx::query_scalar("SELECT status FROM beds WHERE id=$1")
            .bind(cleaning)
            .fetch_one(&pool)
            .await,
        "saved cleaning state loads",
    );
    // Static aggregate evidence only: no identity, URL, patient or body output.
    eprintln!(
        "explicit_bed_admit_statuses={:?} current_owner_counts={counts:?} cleaning_preserved={}",
        outcomes
            .iter()
            .map(|(status, _)| status.as_u16())
            .collect::<Vec<_>>(),
        cleaning_state == "cleaning"
    );
    assert!(outcomes[0].0==StatusCode::OK && counts==(1,0,0) && cleaning_state=="cleaning" && outcomes[1..].iter().all(|(status,code)|status.is_client_error() && !code.ends_with("_unconfirmed")),"a real available-bed control succeeds, while occupied, cleaning and wrong-ward explicit beds are definite refusals without a new owner or bed-state rewrite");
}

async fn send(
    app: &TestApp,
    token: &str,
    method: Method,
    path: String,
    input: Option<Value>,
) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let content = if let Some(v) = input {
        b = b.header("content-type", "application/json");
        Body::from(must(serde_json::to_vec(&v), "synthetic move input encodes"))
    } else {
        Body::empty()
    };
    let response = must(
        app.clone()
            .oneshot(must(b.body(content), "synthetic move request builds"))
            .await,
        "actual move route responds",
    );
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded move response reads",
    );
    (
        status,
        must(serde_json::from_slice(&bytes), "move response decodes"),
    )
}
#[track_caller]
fn good(out: (StatusCode, Value)) -> Value {
    assert_eq!(
        out.0,
        StatusCode::OK,
        "static move route code {}",
        out.1["error"]["code"].as_str().unwrap_or("none")
    );
    out.1["data"].clone()
}
struct MoveFixture {
    app: TestApp,
    pool: hms_db::PgPool,
    token: String,
    patient: Uuid,
    case: Uuid,
    source: Uuid,
    destination: Uuid,
    beds: Vec<Uuid>,
}
impl MoveFixture {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let facility = app.state().facility_id();
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
        grant_test_permission(&app, owner, PermissionCode::WardBoardViewAll).await;
        let token = login(app.clone(), "owner@hms.local").await.0;
        let patient = synthetic_patient(&pool, facility).await;
        must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient')").bind(facility).bind(owner).bind(patient).execute(&pool).await,"ordinary synthetic care relationship inserts");
        let source = Uuid::new_v4();
        let destination = Uuid::new_v4();
        for (id, code) in [(source, "SYN-MOVE-ORIGIN"), (destination, "SYN-MOVE-DEST")] {
            must(sqlx::query("INSERT INTO wards(id,facility_id,code,name,status,bed_cleaning_minutes_override) VALUES($1,$2,$3,'Synthetic move ward','active',0)").bind(id).bind(facility).bind(code).execute(&pool).await,"synthetic move ward inserts");
        }
        let mut beds = vec![];
        for (ward, code) in [
            (source, "SYN-MOVE-A"),
            (destination, "SYN-MOVE-B"),
            (destination, "SYN-MOVE-C"),
        ] {
            let id = Uuid::new_v4();
            must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,bed_code,status) VALUES($1,$2,$3,$4,'available')").bind(id).bind(facility).bind(ward).bind(code).execute(&pool).await,"synthetic eligible bed inserts");
            beds.push(id);
        }
        let value = good(
            send(
                &app,
                &token,
                Method::POST,
                "/api/v2/admissions".into(),
                Some(json!({"patient_id":patient,"ward_id":source,"bed_id":beds[0]})),
            )
            .await,
        );
        let case = must(
            Uuid::parse_str(
                value["admission_id"]
                    .as_str()
                    .expect("actual admission has opaque identity"),
            ),
            "admission identity parses",
        );
        Self {
            app,
            pool,
            token,
            patient,
            case,
            source,
            destination,
            beds,
        }
    }
    fn base(&self) -> String {
        format!(
            "/api/v2/patients/{}/chronicle/admissions/{}",
            self.patient, self.case
        )
    }
    async fn get(&self, suffix: &str) -> (StatusCode, Value) {
        send(
            &self.app,
            &self.token,
            Method::GET,
            format!("{}{suffix}", self.base()),
            None,
        )
        .await
    }
    async fn post(&self, input: Value) -> (StatusCode, Value) {
        send(
            &self.app,
            &self.token,
            Method::POST,
            format!("{}/moves", self.base()),
            Some(input),
        )
        .await
    }
    async fn prepared(&self, bed: Uuid) -> Value {
        let c = good(self.get("/placement").await);
        let rows = good(self.get("/move-destinations").await);
        let d = rows
            .as_array()
            .expect("destinations are bounded list")
            .iter()
            .find(|v| v["bed_id"] == json!(bed))
            .expect("explicit available destination is present");
        json!({"client_request_id":Uuid::new_v4(),"expected_placement_token":c["placement_token"],"destination_bed_id":bed,"expected_destination_token":d["candidate_token"],"expected_task_membership_token":c["task_membership_token"],"task_policy":"route_all_clear_assignees","reason":"Synthetic reviewed same-episode move"})
    }
    async fn task(&self, assigned: bool) -> Uuid {
        let id = Uuid::new_v4();
        must(sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,title,instruction,due_at,status,created_by_user_id,assigned_to_user_id) VALUES($1,$2,$3,$4,$5,'other','Synthetic routing task','SYNTHETIC_PRIVATE_INSTRUCTION',clock_timestamp(),'open',$6,CASE WHEN $7 THEN $6 ELSE NULL END)").bind(id).bind(self.app.state().facility_id()).bind(self.case).bind(self.patient).bind(self.source).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).bind(assigned).execute(&self.pool).await,"synthetic open task inserts");
        id
    }
    async fn effects(&self) -> (i64, i64, i64) {
        must(sqlx::query_as("SELECT (SELECT count(*) FROM admission_moves WHERE admission_case_id=$1),(SELECT count(*) FROM admission_move_commands WHERE admission_case_id=$1),(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='admission.moved')").bind(self.case).fetch_one(&self.pool).await,"bounded saved move counts load")
    }
}

#[tokio::test]
async fn immediate_move_preserves_episode_routes_every_open_task_and_replays_exact_immutable_receipt(
) {
    let f = MoveFixture::new().await;
    let task = f.task(true).await;
    let second = f.task(false).await;
    let before = good(f.get("/placement").await);
    assert!(
        before["can_move"] == true
            && before["open_task_count"] == 2
            && before["assigned_open_task_count"] == 1,
        "complete reviewed task counts load"
    );
    let input = f.prepared(f.beds[1]).await;
    let receipt = good(f.post(input.clone()).await);
    let m = &receipt["movement"];
    assert!(
        m["episode"]["admitted_at"] == before["admitted_at"]
            && m["episode"]["encounter_id"] == before["encounter_id"]
            && m["episode"]["visit_id"] == before["visit_id"]
            && m["episode"]["status"] == before["status"],
        "same original episode identity and admission time survive"
    );
    assert!(
        m["placement_revision"].as_i64()
            == Some(before["placement_revision"].as_i64().unwrap() + 1)
            && m["source_bed_release"]["status"] == "cleaning"
            && m["source_bed_release"]["cleaning_minutes"] == 0
            && receipt["recorded_at"] == m["moved_at"],
        "one real clock records source cleaning even at zero duration"
    );
    let facts:(i64,i64,i64)=must(sqlx::query_as("SELECT count(*),count(*) FILTER(WHERE ward_id=$2 AND service_ward_id=$3 AND assigned_to_user_id IS NULL AND route_version=1 AND instruction='SYNTHETIC_PRIVATE_INSTRUCTION'),(SELECT count(*) FROM nursing_task_routes WHERE admission_case_id=$1) FROM nursing_tasks WHERE admission_case_id=$1 AND id=ANY($4)").bind(f.case).bind(f.source).bind(f.destination).bind(vec![task,second]).fetch_one(&f.pool).await,"immutable task origin and effective routes load");
    assert_eq!(
        facts,
        (2, 2, 2),
        "every reviewed task routes once while origin/instruction survive"
    );
    let intervals:(i64,i64)=must(sqlx::query_as("SELECT count(*),count(*) FILTER(WHERE ended_at IS NULL) FROM admission_placements WHERE admission_case_id=$1").bind(f.case).fetch_one(&f.pool).await,"known placement interval counts load");
    assert_eq!(intervals, (2, 1));
    let saved = good(f.get("/placement").await);
    assert!(
        saved["ward_id"] == json!(f.destination)
            && saved["bed_id"] == json!(f.beds[1])
            && !saved["placement_history_partial"].as_bool().unwrap(),
        "current placement is authoritative without fabricated legacy prefix"
    );
    let replay = good(f.post(input.clone()).await);
    assert!(
        replay["replayed"] == true && replay["movement"] == *m && replay["reviewed_input"] == input,
        "same UUID preserves the original complete immutable movement"
    );
    let key = input["client_request_id"].as_str().unwrap();
    let recovered = good(f.get(&format!("/move-requests/{key}")).await);
    assert!(
        recovered["movement"] == *m,
        "exact recovered full movement is immutable"
    );
    assert_eq!(f.effects().await, (1, 1, 1));
    let history = good(f.get("/moves?limit=1").await);
    assert!(
        history.as_array().unwrap().len() == 1
            && history[0].get("reason").is_none()
            && history[0].get("task_result").is_none(),
        "history is lean rather than a clinical detail body"
    );
    let detail = good(
        f.get(&format!("/moves/{}", m["id"].as_str().unwrap()))
            .await,
    );
    assert!(
        detail == *m,
        "exact detail equals the originally saved immutable movement"
    );
    let mut changed = input;
    changed["reason"] = json!("Synthetic changed request");
    let denied = f.post(changed).await;
    assert!(
        denied.0 == StatusCode::CONFLICT
            && denied.1["error"]["code"] == "admission_move_request_conflict"
    );
}

#[tokio::test]
async fn source_destination_and_complete_task_membership_cas_are_definite_and_effect_free() {
    let f = MoveFixture::new().await;
    let stale = f.prepared(f.beds[1]).await;
    f.task(false).await;
    let task_denial = f.post(stale).await;
    let mut bad = f.prepared(f.beds[1]).await;
    bad["expected_placement_token"] = json!("0".repeat(64));
    let source_denial = f.post(bad).await;
    let stale = f.prepared(f.beds[1]).await;
    must(
        sqlx::query(
            "UPDATE beds SET bed_code='SYN-MOVE-RENAMED',updated_at=clock_timestamp() WHERE id=$1",
        )
        .bind(f.beds[1])
        .execute(&f.pool)
        .await,
        "reviewed destination metadata changes",
    );
    let destination_denial = f.post(stale).await;
    let old_source = f.prepared(f.beds[1]).await;
    must(sqlx::query("UPDATE beds SET bed_code='SYN-SOURCE-RENAMED',updated_at=clock_timestamp() WHERE id=$1").bind(f.beds[0]).execute(&f.pool).await,"reviewed human source label changes");
    let source_label_denial = f.post(old_source).await;
    let mut malformed = f.prepared(f.beds[1]).await;
    malformed["ignored_override"] = json!(true);
    let malformed = f.post(malformed).await;
    for (out, expected) in [
        (task_denial, "admission_move_tasks_changed"),
        (source_denial, "admission_move_source_changed"),
        (source_label_denial, "admission_move_source_changed"),
        (destination_denial, "admission_move_destination_changed"),
        (malformed, "invalid_admission_move"),
    ] {
        assert!(
            out.0.is_client_error() && out.1["error"]["code"] == expected,
            "reviewed mismatch has typed definite error"
        );
    }
    assert_eq!(f.effects().await, (0, 0, 0));
}

#[tokio::test]
async fn historical_move_reads_need_real_full_relationship_and_current_ward_without_emergency_inference(
) {
    let f = MoveFixture::new().await;
    let limited = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for p in [
        PermissionCode::PatientDemographicsView,
        PermissionCode::AdmissionManage,
        PermissionCode::WardBoardViewAll,
    ] {
        grant_test_permission(&f.app, limited, p).await;
    }
    for k in [FeatureKey::Patients, FeatureKey::Admissions] {
        grant_test_feature(&f.app, limited, k).await;
    }
    grant_test_patient_visibility(&f.app, limited, PatientDataVisibility::Demographics).await;
    let token = login(f.app.clone(), "limited@hms.local").await.0;
    let read = || {
        send(
            &f.app,
            &token,
            Method::GET,
            format!("{}/placement", f.base()),
            None,
        )
    };
    assert_eq!(
        read().await.0,
        StatusCode::FORBIDDEN,
        "demographic manager does not receive rich placement context"
    );
    grant_test_patient_visibility(&f.app, limited, PatientDataVisibility::FullClinical).await;
    let token = login(f.app.clone(), "limited@hms.local").await.0;
    let read = || {
        send(
            &f.app,
            &token,
            Method::GET,
            format!("{}/placement", f.base()),
            None,
        )
    };
    assert_eq!(
        read().await.0,
        StatusCode::FORBIDDEN,
        "same facility Full manager without ordinary relationship is denied"
    );
    must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned')").bind(f.app.state().facility_id()).bind(limited).bind(f.patient).execute(&f.pool).await,"real limited care relationship inserts");
    let data = good(read().await);
    assert!(
        data["can_move"] == true,
        "zero-task context needs no Nursing authority"
    );
    f.task(true).await;
    let data = good(read().await);
    assert!(
        data["can_move"] == false
            && data["unavailable_reason"] == "nursing_authority_required"
            && data["open_task_count"] == 1,
        "nonempty nursing routing requires actual Nursing authority"
    );
    must(
        sqlx::query(
            "UPDATE patients SET record_status='restricted',vital_status='deceased' WHERE id=$1",
        )
        .bind(f.patient)
        .execute(&f.pool)
        .await,
        "historical patient state changes without inventing intake policy",
    );
    assert_eq!(
        read().await.0,
        StatusCode::OK,
        "historical purpose retains access without guessed vital/registration gate"
    );
    must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='ward_board.view_all'").bind(limited).execute(&f.pool).await,"current explicit all-ward authority withdraws");
    assert_eq!(
        read().await.0,
        StatusCode::FORBIDDEN,
        "a real role never substitutes for current ward assignment or explicit permission"
    );
}

#[tokio::test]
async fn move_audit_failure_rolls_back_every_placement_bed_task_and_receipt() {
    let f = MoveFixture::new().await;
    f.task(true).await;
    let before = good(f.get("/placement").await);
    let input = f.prepared(f.beds[1]).await;
    must(sqlx::raw_sql("CREATE FUNCTION synthetic_move_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admission.moved' THEN RAISE EXCEPTION 'synthetic_move_audit_fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_move_audit_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_move_audit_fault()").execute(&f.pool).await,"isolated synthetic audit fault installs");
    let out = f.post(input.clone()).await;
    assert!(
        out.0 == StatusCode::CONFLICT
            && out.1["error"]["code"] == "admission_move_write_unconfirmed",
        "unknown database failure stays explicitly unconfirmed"
    );
    assert_eq!(f.effects().await, (0, 0, 0));
    let after = good(f.get("/placement").await);
    assert!(
        after["placement_token"] == before["placement_token"]
            && after["task_membership_token"] == before["task_membership_token"],
        "all clinical placement and task state rolled back"
    );
    let counts:(i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM admission_placements WHERE admission_case_id=$1),(SELECT count(*) FROM nursing_task_routes WHERE admission_case_id=$1)").bind(f.case).fetch_one(&f.pool).await,"saved placement evidence counts load");
    assert_eq!(counts, (1, 0));
    must(sqlx::raw_sql("DROP TRIGGER synthetic_move_audit_fault ON audit_events;DROP FUNCTION synthetic_move_audit_fault()").execute(&f.pool).await,"isolated synthetic fault removes");
    good(f.post(input).await);
    assert_eq!(f.effects().await, (1, 1, 1));
}

#[tokio::test]
async fn actual_held_bed_is_busy_and_two_patient_admission_competition_has_one_owner() {
    let f = MoveFixture::new().await;
    let input = f.prepared(f.beds[1]).await;
    let mut gate = must(f.pool.begin().await, "bed gate begins");
    must(
        sqlx::query("SELECT id FROM beds WHERE id=$1 FOR UPDATE")
            .bind(f.beds[1])
            .execute(&mut *gate)
            .await,
        "exact reviewed bed locks",
    );
    let outcome = f.post(input.clone()).await;
    must(gate.rollback().await, "bed gate releases before assertions");
    assert!(
        outcome.0 == StatusCode::CONFLICT && outcome.1["error"]["code"] == "admission_move_busy",
        "reviewed locks fail fast without guessing a wait graph"
    );
    assert_eq!(f.effects().await, (0, 0, 0));
    let a = synthetic_patient(&f.pool, f.app.state().facility_id()).await;
    let b = synthetic_patient(&f.pool, f.app.state().facility_id()).await;
    let (one, two) = tokio::join!(
        admit(&f.app, &f.token, a, f.destination, f.beds[2]),
        admit(&f.app, &f.token, b, f.destination, f.beds[2])
    );
    let owners:i64=must(sqlx::query_scalar("SELECT count(*) FROM admission_cases WHERE bed_id=$1 AND status IN('ready_for_activation','admitted','discharge_pending')").bind(f.beds[2]).fetch_one(&f.pool).await,"concurrent committed bed owner count loads");
    assert!(
        owners == 1
            && [&one, &two]
                .iter()
                .filter(|v| v.0 == StatusCode::OK)
                .count()
                == 1
            && [&one, &two]
                .iter()
                .filter(|v| v.0.is_client_error() && !v.1.ends_with("_unconfirmed"))
                .count()
                == 1,
        "two genuine patients compete for one real available bed with one definite loser"
    );
}

#[tokio::test]
async fn same_ward_bed_move_changes_revision_and_exact_history_pages_never_fallback() {
    let f = MoveFixture::new().await;
    let first = good(f.post(f.prepared(f.beds[1]).await).await);
    let input = f.prepared(f.beds[2]).await;
    let second = good(f.post(input).await);
    assert!(
        second["movement"]["source"]["ward_id"] == second["movement"]["destination"]["ward_id"]
            && second["movement"]["source"]["bed_id"]
                != second["movement"]["destination"]["bed_id"]
            && second["movement"]["placement_revision"].as_i64()
                == Some(first["movement"]["placement_revision"].as_i64().unwrap() + 1),
        "same-ward physical move remains authoritative and revisioned"
    );
    let page = f.get("/moves?limit=1").await;
    assert!(
        page.0 == StatusCode::OK && page.1["page"]["has_next"] == true,
        "actual bounded history page advertises seek"
    );
    let cursor = page.1["page"]["next_cursor"].as_str().unwrap();
    let older = good(f.get(&format!("/moves?limit=1&cursor={cursor}")).await);
    assert!(
        older[0]["id"] == first["movement"]["id"],
        "seek reaches the exact older movement"
    );
    let absent = f.get(&format!("/moves/{}", Uuid::new_v4())).await;
    assert_eq!(
        absent.0,
        StatusCode::NOT_FOUND,
        "unknown exact evidence never falls back to latest"
    );
    let invalid = f.get("/moves?cursor=v%3A0").await;
    assert_eq!(invalid.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ready_unbedded_and_legacy_observation_contexts_preserve_unknown_history_without_permitting_moves(
) {
    let f = MoveFixture::new().await;
    let facility = f.app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    for status in ["ready_for_activation", "admitted", "discharged"] {
        let patient = synthetic_patient(&f.pool, facility).await;
        must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned')").bind(facility).bind(owner).bind(patient).execute(&f.pool).await,"ordinary relationship for explicit history inserts");
        let case:Uuid=must(sqlx::query_scalar("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES(gen_random_uuid(),$1,$2,$3,$4) RETURNING id").bind(facility).bind(patient).bind(f.source).bind(status).fetch_one(&f.pool).await,"explicit ready or legacy unbedded source inserts");
        let base = format!("/api/v2/patients/{patient}/chronicle/admissions/{case}");
        let c = good(
            send(
                &f.app,
                &f.token,
                Method::GET,
                format!("{base}/placement"),
                None,
            )
            .await,
        );
        assert!(
            c["can_move"] == false && c["current_placement"].is_null() && c["bed_id"].is_null(),
            "unbedded/imported case remains a typed protected context without fabricated placement"
        );
        if status == "ready_for_activation" {
            assert!(
                c["admitted_at"].is_null() && c["placement_history_partial"] == false,
                "ready source has no claimed actual admission interval"
            );
        } else {
            assert!(
                c["placement_history_partial"] == true && c["placement_known_from"].is_string(),
                "legacy unknown prefix is explicitly partial"
            );
        }
        let mut input = f.prepared(f.beds[1]).await;
        input["expected_placement_token"] = c["placement_token"].clone();
        input["expected_task_membership_token"] = c["task_membership_token"].clone();
        let out = send(
            &f.app,
            &f.token,
            Method::POST,
            format!("{base}/moves"),
            Some(input),
        )
        .await;
        assert!(
            out.0 == StatusCode::CONFLICT
                && out.1["error"]["code"] == "admission_move_source_changed",
            "unavailable source refuses before clinical writes"
        );
    }
    assert_eq!(f.effects().await, (0, 0, 0));
}

#[tokio::test]
async fn all_open_task_counts_are_complete_and_oversized_membership_never_silently_truncates() {
    let f = MoveFixture::new().await;
    let input = f.prepared(f.beds[1]).await;
    must(sqlx::query("INSERT INTO nursing_tasks(id,facility_id,admission_case_id,patient_id,ward_id,task_type,status,due_at,created_by_user_id,assigned_to_user_id) SELECT gen_random_uuid(),$1,$2,$3,$4,'other','open',clock_timestamp(),$5,CASE WHEN n%2=0 THEN $5 ELSE NULL END FROM generate_series(1,501) n").bind(f.app.state().facility_id()).bind(f.case).bind(f.patient).bind(f.source).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).execute(&f.pool).await,"complete synthetic oversized work inserts");
    let c = good(f.get("/placement").await);
    assert!(c["open_task_count"]==501&&c["assigned_open_task_count"]==250&&c["task_membership_token"].is_null()&&c["can_move"]==false&&c["unavailable_reason"]=="too_many_open_tasks","actual complete counts are retained without pretending a truncated membership is reviewable");
    let out = f.post(input).await;
    assert!(
        out.0 == StatusCode::CONFLICT && out.1["error"]["code"] == "admission_move_task_limit",
        "oversized source has a typed definite refusal"
    );
    assert_eq!(f.effects().await, (0, 0, 0));
}

#[tokio::test]
async fn canonical_admission_rechecks_natural_authority_expiry_after_real_bed_wait() {
    let f = MoveFixture::new().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let facility = f.app.state().facility_id();
    for k in [FeatureKey::Patients, FeatureKey::Admissions] {
        grant_test_feature(&f.app, user, k).await;
    }
    grant_test_permission(&f.app, user, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&f.app, user, PatientDataVisibility::Demographics).await;
    // Complete mandatory password/factor setup before starting a short-lived grant.
    let _ = login(f.app.clone(), "limited@hms.local").await;
    must(
        sqlx::query(
            "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='admission.manage'",
        )
        .bind(user)
        .execute(&f.pool)
        .await,
        "static admission grant removes for timed control",
    );
    let end:chrono::DateTime<Utc>=must(sqlx::query_scalar("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,granted_by_user_id,starts_at,ends_at,status) VALUES(gen_random_uuid(),$1,$2,'admission.manage','facility',$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 seconds','active') RETURNING ends_at").bind(facility).bind(user).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).fetch_one(&f.pool).await,"actual bounded managed authority inserts");
    let token = login(f.app.clone(), "limited@hms.local").await.0;
    let patient = synthetic_patient(&f.pool, facility).await;
    let mut gate = must(f.pool.begin().await, "exact admission bed gate begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "gate process loads",
    );
    must(
        sqlx::query("SELECT id FROM beds WHERE id=$1 FOR UPDATE")
            .bind(f.beds[2])
            .execute(&mut *gate)
            .await,
        "destination bed holds exact lock",
    );
    let app = f.app.clone();
    let bed = f.beds[2];
    let ward = f.destination;
    let pending = tokio::spawn(async move { admit(&app, &token, patient, ward, bed).await });
    let mut actual_wait = false;
    for _ in 0..100 {
        actual_wait=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query ILIKE '%FROM beds%')").bind(pid).fetch_one(&f.pool).await,"actual bed lock edge loads");
        if actual_wait {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let mut expired = false;
    for _ in 0..250 {
        expired = must(
            sqlx::query_scalar("SELECT clock_timestamp()>$1")
                .bind(end)
                .fetch_one(&f.pool)
                .await,
            "actual managed deadline loads",
        );
        if expired {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    must(gate.rollback().await, "bed gate releases before assertions");
    let out = must(pending.await, "actual waiting admission joins");
    let owners: i64 = must(
        sqlx::query_scalar("SELECT count(*) FROM admission_cases WHERE patient_id=$1")
            .bind(patient)
            .fetch_one(&f.pool)
            .await,
        "expired command committed owner count loads",
    );
    assert!(
        actual_wait && expired && out.0 == StatusCode::FORBIDDEN && owners == 0,
        "real authority expires while bed-blocked and final DB clock prevents any admission commit"
    );
}

#[tokio::test]
async fn actual_chronicle_encounter_links_exact_case_and_revisions_without_latest_or_active_fallback(
) {
    let f = MoveFixture::new().await;
    let facility = f.app.state().facility_id();
    let encounter = Uuid::new_v4();
    must(sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status,created_by_user_id) VALUES($1,$2,$3,'inpatient','in_progress',$4)").bind(encounter).bind(facility).bind(f.patient).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).execute(&f.pool).await,"explicit actual inpatient encounter persists");
    must(
        sqlx::query("UPDATE admission_cases SET encounter_id=$2 WHERE id=$1")
            .bind(f.case)
            .bind(encounter)
            .execute(&f.pool)
            .await,
        "fixture retains actual exact encounter foreign key",
    );
    let path = format!(
        "/api/v2/patients/{}/chronicle?encounter_id={encounter}",
        f.patient
    );
    let read = || send(&f.app, &f.token, Method::GET, path.clone(), None);
    let before = good(read().await);
    let exact = before["encounters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == json!(encounter))
        .expect("selected actual encounter exists");
    assert!(
        exact["admission"]["admission_id"] == json!(f.case)
            && exact["admission"]["placement_revision"] == 1
            && exact["admission_link_ambiguous"] == false
            && before["active_admission"]["encounter_id"] == json!(encounter),
        "actual startup projects a single scoped case association and explicit encounter identity"
    );
    for bed in [f.beds[1], f.beds[2]] {
        let saved = good(f.post(f.prepared(bed).await).await);
        let current = good(read().await);
        let selected = current["encounters"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == json!(encounter))
            .unwrap();
        assert!(selected["admission"]["admission_id"]==json!(f.case)&&selected["admission"]["placement_revision"]==saved["movement"]["placement_revision"]&&selected["admission"]["bed_id"]==json!(bed)&&current["active_admission"]["placement_revision"]==saved["movement"]["placement_revision"],"both crossward and sameward actual moves refresh authoritative selected case placement without changing episode binding");
    }
    must(sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,encounter_id,status) VALUES(gen_random_uuid(),$1,$2,$3,$4,'cancelled')").bind(facility).bind(f.patient).bind(f.source).bind(encounter).execute(&f.pool).await,"historical second exact binding inserts without active-patient conflict");
    let ambiguous = good(read().await);
    let selected = ambiguous["encounters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == json!(encounter))
        .unwrap();
    assert!(
        selected["admission"].is_null()
            && selected["admission_link_ambiguous"] == true
            && ambiguous["active_admission"]["admission_id"] == json!(f.case),
        "multiple actual case bindings never select latest or borrow the separate active admission"
    );
    let patient = synthetic_patient(&f.pool, facility).await;
    must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned')").bind(facility).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID)).bind(patient).execute(&f.pool).await,"historical ready patient has a real ordinary care relationship");
    let historical = Uuid::new_v4();
    must(sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status,ended_at) VALUES($1,$2,$3,'inpatient','completed',clock_timestamp())").bind(historical).bind(facility).bind(patient).execute(&f.pool).await,"historical actual encounter inserts");
    must(sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,encounter_id,status) VALUES(gen_random_uuid(),$1,$2,$3,$4,'ready_for_activation')").bind(facility).bind(patient).bind(f.source).bind(historical).execute(&f.pool).await,"real ready case with no admission interval links");
    let ready = good(
        send(
            &f.app,
            &f.token,
            Method::GET,
            format!("/api/v2/patients/{patient}/chronicle?encounter_id={historical}"),
            None,
        )
        .await,
    );
    let selected = ready["encounters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == json!(historical))
        .unwrap();
    assert!(selected["admission"]["status"]=="ready_for_activation"&&selected["admission"]["admitted_at"].is_null(),"ready linked metadata does not fabricate clinical admission chronology from stored default timestamp");
}

async fn source_section(f: &MoveFixture) -> Uuid {
    let section = Uuid::new_v4();
    must(sqlx::query("INSERT INTO ward_sections(id,facility_id,ward_id,code,name,status) VALUES($1,$2,$3,'SYN-MOVE-SECTION','Synthetic occupied source section','active')").bind(section).bind(f.app.state().facility_id()).bind(f.source).execute(&f.pool).await,"actual source section inserts");
    good(
        send(
            &f.app,
            &f.token,
            Method::PATCH,
            format!("/api/v2/wards/beds/{}", f.beds[0]),
            Some(json!({"section_id":section})),
        )
        .await,
    );
    section
}

async fn set_location_inactive(f: &MoveFixture, ward: bool, id: Uuid) {
    let path = if ward {
        format!("/api/v2/wards/{id}")
    } else {
        format!("/api/v2/wards/sections/{id}")
    };
    good(
        send(
            &f.app,
            &f.token,
            Method::PATCH,
            path,
            Some(json!({"status":"inactive"})),
        )
        .await,
    );
}

async fn move_from_inactive_source(ward_inactive: bool) {
    let f = MoveFixture::new().await;
    let section = source_section(&f).await;
    let task = f.task(true).await;
    // A section may be vacated within its active ward; an inactive ward must
    // be vacated for an active different ward.
    let (target_bed, target_ward) = if ward_inactive {
        (f.beds[1], f.destination)
    } else {
        let id = Uuid::new_v4();
        must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,bed_code,status) VALUES($1,$2,$3,'SYN-ACTIVE-SAME-WARD','available')").bind(id).bind(f.app.state().facility_id()).bind(f.source).execute(&f.pool).await,"active same-ward distinct section destination inserts");
        (id, f.source)
    };
    set_location_inactive(
        &f,
        ward_inactive,
        if ward_inactive { f.source } else { section },
    )
    .await;
    let before = good(f.get("/placement").await);
    let out = f.post(f.prepared(target_bed).await).await;
    let saved = good(f.get("/placement").await);
    let effects = f.effects().await;
    let routes:(i64,i64)=must(sqlx::query_as("SELECT count(*),count(*) FILTER(WHERE ward_id=$2 AND service_ward_id=$3 AND assigned_to_user_id IS NULL AND route_version=1 AND instruction='SYNTHETIC_PRIVATE_INSTRUCTION') FROM nursing_tasks WHERE id=$1").bind(task).bind(f.source).bind(target_ward).fetch_one(&f.pool).await,"full preserved origin and effective task route load");
    let cleaning: bool = must(
        sqlx::query_scalar(
            "SELECT status='cleaning' AND cleaning_due_at IS NOT NULL FROM beds WHERE id=$1",
        )
        .bind(f.beds[0])
        .fetch_one(&f.pool)
        .await,
        "vacated source cleaning fact loads",
    );
    let episode = &out.1["data"]["movement"]["episode"];
    let preserved = episode["admitted_at"] == before["admitted_at"]
        && episode["encounter_id"] == before["encounter_id"]
        && episode["visit_id"] == before["visit_id"]
        && saved["admission_case_id"] == before["admission_case_id"];
    eprintln!("inactive_source_is_ward={ward_inactive} context_can_move={} move_status={} effects={effects:?} routed_origin_counts={routes:?} source_cleaning={cleaning} episode_preserved={preserved}",before["can_move"].as_bool().unwrap_or(false),out.0.as_u16());
    assert!(before["can_move"]==true&&out.0==StatusCode::OK&&effects==(1,1,1)&&routes==(1,1)&&cleaning&&preserved&&saved["ward_id"]==json!(target_ward)&&saved["bed_id"]==json!(target_bed),"a current authorized occupied source can be vacated despite inactive metadata, preserving its episode, canonical cleaning and every reviewed task");
}

#[tokio::test]
async fn occupied_inactive_source_ward_can_be_vacated_for_an_active_destination() {
    move_from_inactive_source(true).await;
}

#[tokio::test]
async fn occupied_inactive_source_section_can_be_vacated_within_its_active_ward() {
    move_from_inactive_source(false).await;
}

#[tokio::test]
async fn inactive_destination_including_shared_source_metadata_never_accepts_new_occupancy() {
    let mut collected = Vec::new();
    for shared_source in [false, true] {
        for ward_inactive in [false, true] {
            let f = MoveFixture::new().await;
            let section = source_section(&f).await;
            let target_ward = if shared_source {
                f.source
            } else {
                f.destination
            };
            let target_section = if shared_source {
                section
            } else {
                let id = Uuid::new_v4();
                must(sqlx::query("INSERT INTO ward_sections(id,facility_id,ward_id,code,name,status) VALUES($1,$2,$3,'SYN-DEST-SECTION','Synthetic destination section','active')").bind(id).bind(f.app.state().facility_id()).bind(target_ward).execute(&f.pool).await,"active distinct destination section inserts");
                id
            };
            let bed = Uuid::new_v4();
            must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,section_id,bed_code,status) VALUES($1,$2,$3,$4,'SYN-INACTIVE-DEST','available')").bind(bed).bind(f.app.state().facility_id()).bind(target_ward).bind(target_section).execute(&f.pool).await,"initially active explicit candidate inserts");
            let mut input = f.prepared(bed).await;
            set_location_inactive(
                &f,
                ward_inactive,
                if ward_inactive {
                    target_ward
                } else {
                    target_section
                },
            )
            .await;
            // Fresh source review must not make shared inactive metadata an
            // eligible destination.
            let context = good(f.get("/placement").await);
            input["expected_placement_token"] = context["placement_token"].clone();
            input["expected_task_membership_token"] = context["task_membership_token"].clone();
            let candidates = good(f.get("/move-destinations").await);
            let hidden = !candidates
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v["bed_id"] == json!(bed));
            let out = f.post(input).await;
            let definite = out.0 == StatusCode::CONFLICT
                && !out.1["error"]["code"]
                    .as_str()
                    .unwrap_or("")
                    .ends_with("_unconfirmed");
            let effects = f.effects().await;
            collected.push((out.0.as_u16(), hidden, definite, effects));
        }
    }
    let active = MoveFixture::new().await;
    let positive = active.post(active.prepared(active.beds[1]).await).await;
    eprintln!(
        "inactive_destination_cases={collected:?} active_destination_positive={}",
        positive.0.as_u16()
    );
    assert!(positive.0==StatusCode::OK&&collected.iter().all(|(_,hidden,definite,effects)|*hidden&&*definite&&*effects==(0,0,0)),"inactive ward or section cannot receive new occupancy even when shared with an inactive source; every refusal is definite and effect-free");
}

#[tokio::test]
async fn same_facility_move_request_reference_refuses_without_waiting_on_another_cases_command() {
    let f = MoveFixture::new().await;
    let facility = f.app.state().facility_id();
    let actor = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let patient = synthetic_patient(&f.pool, facility).await;
    must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient')").bind(facility).bind(actor).bind(patient).execute(&f.pool).await,"second real ordinary relationship inserts");
    let source = Uuid::new_v4();
    let destination = Uuid::new_v4();
    for (id, ward, code) in [
        (source, f.source, "SYN-UUID-SECOND-SOURCE"),
        (destination, f.destination, "SYN-UUID-SECOND-DEST"),
    ] {
        must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,bed_code,status) VALUES($1,$2,$3,$4,'available')").bind(id).bind(facility).bind(ward).bind(code).execute(&f.pool).await,"second independent source and destination beds create");
    }
    let case = good(
        send(
            &f.app,
            &f.token,
            Method::POST,
            "/api/v2/admissions".into(),
            Some(json!({"patient_id":patient,"ward_id":f.source,"bed_id":source})),
        )
        .await,
    );
    let case = must(
        Uuid::parse_str(
            case["admission_id"]
                .as_str()
                .expect("second actual case id"),
        ),
        "second case id parses",
    );
    let base = format!("/api/v2/patients/{patient}/chronicle/admissions/{case}");
    let context = good(
        send(
            &f.app,
            &f.token,
            Method::GET,
            format!("{base}/placement"),
            None,
        )
        .await,
    );
    let rows = good(
        send(
            &f.app,
            &f.token,
            Method::GET,
            format!("{base}/move-destinations"),
            None,
        )
        .await,
    );
    let choice = rows
        .as_array()
        .expect("bounded second choices")
        .iter()
        .find(|v| v["bed_id"] == json!(destination))
        .expect("second explicit destination exists");
    let key = Uuid::new_v4();
    let mut first_input = f.prepared(f.beds[1]).await;
    first_input["client_request_id"] = json!(key);
    let second_input = json!({"client_request_id":key,"expected_placement_token":context["placement_token"],"destination_bed_id":destination,"expected_destination_token":choice["candidate_token"],"expected_task_membership_token":context["task_membership_token"],"task_policy":"route_all_clear_assignees","reason":"Synthetic independent second move"});
    let mut gate = must(
        f.pool.begin().await,
        "first controlled move audit gate begins",
    );
    let gate_pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "audit gate identity reads",
    );
    must(
        sqlx::query("SELECT pg_advisory_xact_lock(619,18018)")
            .execute(&mut *gate)
            .await,
        "first controlled move audit gate retains",
    );
    let ddl=format!("CREATE FUNCTION synthetic_move_uuid_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admission.moved' AND NEW.resource_id='{}'::uuid THEN PERFORM pg_advisory_xact_lock(619,18018); END IF; RETURN NEW; END $$",f.case);
    must(
        sqlx::query(&ddl).execute(&f.pool).await,
        "first controlled move audit function creates",
    );
    must(sqlx::query("CREATE TRIGGER synthetic_move_uuid_gate BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_move_uuid_gate()").execute(&f.pool).await,"first controlled move audit trigger creates");
    let app = f.app.clone();
    let token = f.token.clone();
    let path = format!("{}/moves", f.base());
    let first =
        tokio::spawn(
            async move { send(&app, &token, Method::POST, path, Some(first_input)).await },
        );
    let mut first_wait = false;
    for _ in 0..200 {
        first_wait=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event='advisory')").bind(gate_pid).fetch_one(&f.pool).await,"actual first audit wait reads");
        if first_wait {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let app = f.app.clone();
    let token = f.token.clone();
    let mut second = tokio::spawn(async move {
        send(
            &app,
            &token,
            Method::POST,
            format!("{base}/moves"),
            Some(second_input),
        )
        .await
    });
    let early = tokio::time::timeout(std::time::Duration::from_millis(400), &mut second).await;
    let (bounded, early_result) = match early {
        Ok(v) => (true, Some(must(v, "bounded second real move joins"))),
        Err(_) => (false, None),
    };
    let index_wait:bool=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query ILIKE '%INSERT INTO admission_move_commands%' AND cardinality(pg_blocking_pids(pid))>0)").fetch_one(&f.pool).await,"actual unique move command wait reads");
    must(
        gate.rollback().await,
        "audit gate releases before assertions",
    );
    let first = must(first.await, "first released real move joins");
    let second = match early_result {
        Some(v) => v,
        None => must(second.await, "second released real move joins"),
    };
    let second_facts:(i64,i64,i64,bool)=must(sqlx::query_as("SELECT (SELECT count(*) FROM admission_moves WHERE admission_case_id=$1),(SELECT count(*) FROM admission_move_commands WHERE admission_case_id=$1),(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='admission.moved'),EXISTS(SELECT 1 FROM admission_cases c JOIN beds s ON s.id=c.bed_id JOIN beds d ON d.id=$3 WHERE c.id=$1 AND c.bed_id=$2 AND c.placement_revision=$4 AND s.status='occupied' AND d.status='available')").bind(case).bind(source).bind(destination).bind(context["placement_revision"].as_i64().expect("actual pre-move revision exists")).fetch_one(&f.pool).await,"second case committed movement and placement facts read");
    eprintln!("admission_move_shared_uuid first_wait={first_wait} bounded_second={bounded} actual_unique_index_wait={index_wait} final_statuses={:?} second_effect_counts={:?} second_placement_preserved={}",[first.0.as_u16(),second.0.as_u16()],(second_facts.0,second_facts.1,second_facts.2),second_facts.3);
    assert!(first_wait&&first.0==StatusCode::OK&&bounded&&!index_wait&&second.0==StatusCode::CONFLICT&&second.1["error"]["code"]=="admission_move_busy"&&f.effects().await==(1,1,1)&&second_facts==(0,0,0,true),"different cases sharing one facility request reference refuse promptly before unique index waiting and preserve the first successful immutable movement only");
}
