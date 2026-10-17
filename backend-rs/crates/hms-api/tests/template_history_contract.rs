//! Protected immutable template history and reviewed independent shared copies.
//! Evidence fixtures are synthetic; response bodies and identities are not logged.
mod support;
use axum::response::Response;
use hms_db::clinical::{note_records::NoteActor, note_templates as templates};
use hms_domain::network::{NetworkOffsiteMode, UpdateNetworkPolicyRequest};
use std::time::Duration as WallDuration;
use support::*;
use tokio::task::JoinHandle;

const ORIGINAL_BODY: &str = "  {\"description\":\"Synthetic preserved metadata\",\"extra\":{\"kept\":false},\"sections\":[{\"section\":\"Assessment\",\"required\":true}]}\n";
fn must<T, E>(result: Result<T, E>, message: &'static str) -> T {
    result.unwrap_or_else(|_| panic!("{message}"))
}
fn opaque(value: &Value, field: &str) -> Uuid {
    must(
        Uuid::parse_str(
            value[field]
                .as_str()
                .expect("opaque fixture identity exists"),
        ),
        "opaque fixture identity parses",
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
            Body::from(must(serde_json::to_vec(&value), "fixture JSON encodes"))
        }
        None => Body::empty(),
    };
    must(
        app.clone()
            .oneshot(must(request.body(body), "request builds"))
            .await,
        "actual template route responds",
    )
}
async fn checked(response: Response, expected: StatusCode) -> Value {
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded response reads",
    );
    let body: Value = must(serde_json::from_slice(&bytes), "typed response decodes");
    assert_eq!(
        status,
        expected,
        "template route typed code {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    if !status.is_success() {
        assert!(body.get("data").is_none_or(Value::is_null));
        assert!(body["error"]["details"] == json!({}));
        let encoded = body.to_string();
        assert!(!encoded.contains("Synthetic preserved metadata"));
        assert!(!encoded.contains("PRIVATE_TEMPLATE_QUERY_SENTINEL"));
    }
    body
}
struct Fixture {
    app: TestApp,
    pool: hms_db::PgPool,
    token: String,
    template: Uuid,
    revision: Uuid,
}
impl Fixture {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        must(sqlx::query("DELETE FROM user_patient_visibility WHERE user_id=$1 AND visibility='full_clinical'").bind(owner).execute(&pool).await, "fixture excludes patient Full clinical visibility");
        must(
            sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
                .bind(owner)
                .execute(&pool)
                .await,
            "fixture authorization version advances",
        );
        let (token, _, _) = login(app.clone(), "owner@hms.local").await;
        let input = json!({"client_request_id":Uuid::new_v4(),"title":"Synthetic history source","note_type":"doctor_note","body_template":ORIGINAL_BODY,"is_active":true});
        let saved = checked(
            request(
                &app,
                &token,
                Method::POST,
                "/api/v2/clinical/note-templates/record".into(),
                Some(input),
            )
            .await,
            StatusCode::OK,
        )
        .await;
        let template = opaque(&saved["data"]["template"], "id");
        let revision = opaque(&saved["data"]["template"], "current_revision_id");
        Self {
            app,
            pool,
            token,
            template,
            revision,
        }
    }
    fn history(&self) -> String {
        format!("/api/v2/clinical/note-templates/{}/history", self.template)
    }
    fn version(&self, revision: Uuid) -> String {
        format!(
            "/api/v2/clinical/note-templates/{}/versions/{revision}",
            self.template
        )
    }
    async fn change(&self, version: i64, active: bool) -> Value {
        let input = json!({"client_request_id":Uuid::new_v4(),"expected_version":version,"title":format!("Synthetic history version {}",version+1),"note_type":"doctor_note","body_template":"Synthetic literal starter","is_active":active,"change_summary":"Synthetic reviewed template revision"});
        checked(
            request(
                &self.app,
                &self.token,
                Method::POST,
                format!("/api/v2/clinical/note-templates/{}/changes", self.template),
                Some(input),
            )
            .await,
            StatusCode::OK,
        )
        .await
    }
    async fn reader(&self, can_manage: bool) -> String {
        let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
        for permission in [
            PermissionCode::PatientDemographicsView,
            PermissionCode::ClinicalDocumentationView,
        ] {
            grant_test_permission(&self.app, user, permission).await;
        }
        grant_test_feature(&self.app, user, FeatureKey::Encounters).await;
        grant_test_patient_visibility(&self.app, user, PatientDataVisibility::Demographics).await;
        if can_manage {
            grant_test_permission(&self.app, user, PermissionCode::ClinicalDocumentationManage)
                .await;
        }
        let full:bool=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$1 AND visibility='full_clinical')").bind(user).fetch_one(&self.pool).await,"reader visibility reads");
        assert!(
            !full,
            "nonpatient template reading and copying need no Full clinical grant"
        );
        login(self.app.clone(), "limited@hms.local").await.0
    }
    async fn db_actor(&self) -> NoteActor {
        let claims = access_claims(&self.token);
        NoteActor {
            facility_id: claims.facility_id,
            user_id: claims.sub,
            request_id: None,
            can_manage: false,
            override_ownership: false,
            authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
                session_id: claims.session_id,
                session_version: claims.session_version,
                permission_version: claims.permission_version,
                active_profile: must(
                    hms_db::codec::decode(&claims.active_profile),
                    "actual profile decodes",
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
async fn actual_template_history_pages_beyond_one_hundred_without_bodies_or_gaps() {
    let f = Fixture::new().await;
    for version in 1..106 {
        f.change(version, true).await;
    }
    let first = checked(
        request(
            &f.app,
            &f.token,
            Method::GET,
            format!("{}?limit=255", f.history()),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(first["page"]["limit"], 100);
    assert_eq!(first["data"].as_array().unwrap().len(), 100);
    assert_eq!(first["page"]["has_next"], true);
    let mut versions: Vec<i64> = first["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            assert!(row.get("body_template").is_none());
            assert!(row.get("current_template").is_none());
            assert!(row["imported_legacy"] == false);
            assert!(row["created_by_user_id"].is_string());
            row["version"].as_i64().unwrap()
        })
        .collect();
    let cursor = first["page"]["next_cursor"].as_str().unwrap();
    f.change(106, false).await;
    let next = checked(
        request(
            &f.app,
            &f.token,
            Method::GET,
            format!("{}?limit=100&cursor={cursor}", f.history()),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(next["data"].as_array().unwrap().len(), 6);
    assert_eq!(next["page"]["has_next"], false);
    assert!(next["page"]["next_cursor"].is_null());
    versions.extend(
        next["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["version"].as_i64().unwrap()),
    );
    assert_eq!(versions, (1..=106).rev().collect::<Vec<_>>());
    let exact = checked(
        request(&f.app, &f.token, Method::GET, f.version(f.revision), None).await,
        StatusCode::OK,
    )
    .await;
    assert!(exact["data"]["body_template"] == ORIGINAL_BODY);
    assert_eq!(exact["data"]["version"], 1);
    assert_eq!(exact["data"]["is_active"], true);
    assert_eq!(exact["data"]["current_template"]["version"], 107);
    assert_eq!(exact["data"]["current_template"]["is_active"], false);
    assert!(exact["data"]["current_template"]
        .get("body_template")
        .is_none());
    let actor = f.db_actor().await;
    let (small, small_cost) = hms_observability::with_request_query_counter(templates::history(
        &f.pool,
        actor.clone(),
        f.template,
        None,
        1,
    ))
    .await;
    let (large, large_cost) = hms_observability::with_request_query_counter(templates::history(
        &f.pool, actor, f.template, None, 100,
    ))
    .await;
    assert_eq!(must(small, "one-row repository page reads").len(), 1);
    assert_eq!(must(large, "hundred-row repository page reads").len(), 100);
    assert!(
        small_cost >= 6,
        "measured work includes retained proof and metadata query"
    );
    assert_eq!(
        small_cost, large_cost,
        "observed query work does not grow per revision"
    );
}

#[tokio::test]
async fn nonpatient_reader_can_read_saved_revision_when_current_template_is_inactive() {
    let f = Fixture::new().await;
    let changed = f.change(1, false).await;
    let reader = f.reader(false).await;
    let history = checked(
        request(&f.app, &reader, Method::GET, f.history(), None).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(history["data"].as_array().unwrap().len(), 2);
    let old = checked(
        request(&f.app, &reader, Method::GET, f.version(f.revision), None).await,
        StatusCode::OK,
    )
    .await;
    assert!(old["data"]["body_template"] == ORIGINAL_BODY);
    assert_eq!(old["data"]["is_active"], true);
    assert_eq!(old["data"]["current_template"]["is_active"], false);
    assert_eq!(old["data"]["current_template"]["can_manage"], false);
    let latest = opaque(&changed["data"]["template"], "current_revision_id");
    let exact = checked(
        request(&f.app, &reader, Method::GET, f.version(latest), None).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(exact["data"]["version"], 2);
    assert_eq!(exact["data"]["is_active"], false);
    assert!(exact["data"]["change_summary"] == "Synthetic reviewed template revision");
}

#[tokio::test]
async fn imported_malformed_revision_preserves_evidence_without_foreign_creator_disclosure() {
    let f = Fixture::new().await;
    let facility = f.app.state().facility_id();
    let foreign_facility = Uuid::new_v4();
    let foreign_user = Uuid::new_v4();
    must(sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'TEMPLATE-FOREIGN','Synthetic template fixture','hospital')").bind(foreign_facility).execute(&f.pool).await,"foreign fixture facility inserts");
    must(sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) VALUES($1,$2,'foreign-template@hms.local','PRIVATE_FOREIGN_TEMPLATE_CREATOR','not-a-login-fixture')").bind(foreign_user).bind(foreign_facility).execute(&f.pool).await,"foreign fixture creator inserts");
    let imported = Uuid::new_v4();
    let historical = Uuid::new_v4();
    let raw = "  {\"description\":\"PRIVATE_TEMPLATE_HISTORY_BODY\",\"sections\":[{\"required\":true}]}\n  ";
    must(sqlx::query("INSERT INTO clinical_note_templates(id,facility_id,title,note_type,body_template,is_active,current_revision) VALUES($1,$2,'Synthetic inactive import','nursing_note',$3,false,2)").bind(imported).bind(facility).bind("Synthetic current import").execute(&f.pool).await,"imported root and actual legacy snapshot insert");
    must(sqlx::query("INSERT INTO clinical_note_template_revisions(id,facility_id,template_id,version,title,note_type,body_template,is_active,change_summary,created_by_user_id,imported_legacy) VALUES($1,$2,$3,1,'Synthetic original imported revision','nursing_note',$4,true,'Synthetic original change metadata',$5,true)").bind(historical).bind(facility).bind(imported).bind(raw).bind(foreign_user).execute(&f.pool).await,"foreign-attributed historic import inserts");
    // Explicit isolated corrupt-import fixture. Normal writes reject this owner
    // reference; reads must still redact both foreign identity fields. Restore
    // the guard before any production route runs, retaining the raw evidence.
    let mut import = must(
        f.pool.begin().await,
        "isolated corrupt-import transaction starts",
    );
    must(
        sqlx::raw_sql(
            "ALTER TABLE clinical_note_templates DISABLE TRIGGER clinical_note_template_identity",
        )
        .execute(&mut *import)
        .await,
        "isolated import guard is suspended",
    );
    must(
        sqlx::query("UPDATE clinical_note_templates SET owner_user_id=$2 WHERE id=$1")
            .bind(imported)
            .bind(foreign_user)
            .execute(&mut *import)
            .await,
        "isolated historical foreign owner is retained",
    );
    // PostgreSQL 55006 rejects ALTER TABLE while this UPDATE has pending
    // deferred consistency events. Evaluate them before restoring the guard;
    // neither the guard nor any production request runs with relaxed rules.
    must(
        sqlx::raw_sql("SET CONSTRAINTS ALL IMMEDIATE")
            .execute(&mut *import)
            .await,
        "isolated import consistency events finish before guard restoration",
    );
    let restored = sqlx::raw_sql(
        "ALTER TABLE clinical_note_templates ENABLE TRIGGER clinical_note_template_identity",
    )
    .execute(&mut *import)
    .await;
    if let Err(error) = &restored {
        let code = error.as_database_error().and_then(|error| error.code());
        eprintln!(
            "isolated_import_restore_sqlstate={}",
            code.as_deref().unwrap_or("unavailable")
        );
    }
    must(restored, "normal ownership guard is restored");
    must(import.commit().await, "isolated import fixture commits");
    let base = format!("/api/v2/clinical/note-templates/{imported}");
    let history = checked(
        request(
            &f.app,
            &f.token,
            Method::GET,
            format!("{base}/history"),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(history["data"].as_array().unwrap().len(), 2);
    for row in history["data"].as_array().unwrap() {
        assert_eq!(row["imported_legacy"], true);
        assert!(row["created_by_user_id"].is_null());
        assert!(row["created_by_display_name"].is_null());
        assert!(row.get("body_template").is_none());
    }
    let exact = checked(
        request(
            &f.app,
            &f.token,
            Method::GET,
            format!("{base}/versions/{historical}"),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(exact["data"]["body_template"] == raw);
    assert!(exact["data"]["change_summary"] == "Synthetic original change metadata");
    assert_eq!(exact["data"]["is_active"], true);
    assert_eq!(exact["data"]["current_template"]["is_active"], false);
    assert!(exact["data"]["current_template"]["owner_user_id"].is_null());
    let encoded = exact.to_string();
    assert!(!encoded.contains("PRIVATE_FOREIGN_TEMPLATE_CREATOR"));
    assert!(!encoded.contains(&foreign_user.to_string()));
    let copier = f.reader(true).await;
    for path in [base.clone(), format!("{base}/versions/{historical}")] {
        let protected = checked(
            request(&f.app, &copier, Method::GET, path, None).await,
            StatusCode::OK,
        )
        .await;
        let metadata = if protected["data"].get("current_template").is_some() {
            &protected["data"]["current_template"]
        } else {
            &protected["data"]
        };
        assert!(metadata["owner_user_id"].is_null() && metadata["owner_display_name"].is_null());
        assert_eq!(
            metadata["can_manage"], false,
            "redaction cannot grant source ownership"
        );
        assert!(!protected.to_string().contains(&foreign_user.to_string()));
    }
    let catalog = checked(
        request(
            &f.app,
            &copier,
            Method::GET,
            "/api/v2/clinical/note-templates?activity=all&search=inactive%20import".into(),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(catalog["data"].as_array().unwrap().len(), 1);
    assert!(
        catalog["data"][0]["owner_user_id"].is_null()
            && catalog["data"][0]["owner_display_name"].is_null()
    );
    assert_eq!(catalog["data"][0]["can_manage"], false);
    let change = json!({"client_request_id":Uuid::new_v4(),"expected_version":2,"title":"Synthetic attempted source change","note_type":"nursing_note","body_template":"Synthetic current import","is_active":false,"change_summary":"Synthetic attempted owner replacement"});
    let denied = checked(
        request(
            &f.app,
            &copier,
            Method::POST,
            format!("{base}/changes"),
            Some(change),
        )
        .await,
        StatusCode::FORBIDDEN,
    )
    .await;
    assert_eq!(denied["error"]["code"], "clinical_note_author_required");
    let retained_owner: Uuid = must(
        sqlx::query_scalar("SELECT owner_user_id FROM clinical_note_templates WHERE id=$1")
            .bind(imported)
            .fetch_one(&f.pool)
            .await,
        "raw imported owner remains unchanged",
    );
    assert!(retained_owner == foreign_user);
    let invalid_copy = json!({"client_request_id":Uuid::new_v4(),"title":"Synthetic reviewed malformed copy","note_type":"nursing_note","body_template":raw,"is_active":true});
    let denied = checked(
        request(
            &f.app,
            &f.token,
            Method::POST,
            "/api/v2/clinical/note-templates/record".into(),
            Some(invalid_copy),
        )
        .await,
        StatusCode::BAD_REQUEST,
    )
    .await;
    assert_eq!(denied["error"]["code"], "invalid_clinical_note_command");
    assert!(!denied.to_string().contains("PRIVATE_TEMPLATE_HISTORY_BODY"));
}

#[tokio::test]
async fn exact_revision_never_falls_back_and_history_rejects_unsupported_queries() {
    let f = Fixture::new().await;
    let other=checked(request(&f.app,&f.token,Method::POST,"/api/v2/clinical/note-templates/record".into(),Some(json!({"client_request_id":Uuid::new_v4(),"title":"Synthetic other source","note_type":"doctor_note","body_template":"Synthetic other source starter","is_active":true}))).await,StatusCode::OK).await;
    let other_revision = opaque(&other["data"]["template"], "current_revision_id");
    for revision in [other_revision, Uuid::new_v4()] {
        let denied = checked(
            request(&f.app, &f.token, Method::GET, f.version(revision), None).await,
            StatusCode::NOT_FOUND,
        )
        .await;
        assert_eq!(denied["error"]["code"], "clinical_note_not_found");
    }
    let foreign = Uuid::new_v4();
    let foreign_template = Uuid::new_v4();
    must(sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,'TEMPLATE-SCOPE','Synthetic template scope','hospital')").bind(foreign).execute(&f.pool).await,"foreign scoped fixture inserts");
    let foreign_revision:Uuid=must(sqlx::query_scalar("INSERT INTO clinical_note_templates(id,facility_id,title,note_type,body_template,is_active) VALUES($1,$2,'Synthetic foreign template','doctor_note','Synthetic foreign starter',true) RETURNING current_revision_id").bind(foreign_template).bind(foreign).fetch_one(&f.pool).await,"foreign scoped template inserts");
    for path in [
        format!("/api/v2/clinical/note-templates/{foreign_template}/history"),
        format!("/api/v2/clinical/note-templates/{foreign_template}/versions/{foreign_revision}"),
        f.version(foreign_revision),
    ] {
        checked(
            request(&f.app, &f.token, Method::GET, path, None).await,
            StatusCode::NOT_FOUND,
        )
        .await;
    }
    for query in [
        "cursor=v:0",
        "cursor=v:-1",
        "cursor=v:%2B2",
        "cursor=v:9223372036854775808",
        "cursor=PRIVATE_TEMPLATE_QUERY_SENTINEL",
        "limit=256",
        "unknown=PRIVATE_TEMPLATE_QUERY_SENTINEL",
    ] {
        checked(
            request(
                &f.app,
                &f.token,
                Method::GET,
                format!("{}?{query}", f.history()),
                None,
            )
            .await,
            StatusCode::BAD_REQUEST,
        )
        .await;
    }
    let minimum = checked(
        request(
            &f.app,
            &f.token,
            Method::GET,
            format!("{}?limit=0", f.history()),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(minimum["page"]["limit"], 1);
}

#[tokio::test]
async fn exact_saved_revision_can_seed_reviewed_independent_shared_copy_with_own_receipt() {
    let f = Fixture::new().await;
    f.change(1, false).await;
    let copier = f.reader(true).await;
    let source = checked(
        request(&f.app, &copier, Method::GET, f.version(f.revision), None).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(source["data"]["current_template"]["can_manage"], false);
    let source_before=must(sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('version',current_revision,'revision',current_revision_id,'body',body_template,'active',is_active,'updated_at',updated_at) FROM clinical_note_templates WHERE id=$1").bind(f.template).fetch_one(&f.pool).await,"source evidence reads");
    let key = Uuid::new_v4();
    let command = json!({"client_request_id":key,"title":"Synthetic reviewed facility shared copy","note_type":source["data"]["note_type"],"body_template":source["data"]["body_template"],"is_active":false});
    let response = checked(
        request(
            &f.app,
            &copier,
            Method::POST,
            "/api/v2/clinical/note-templates/record".into(),
            Some(command.clone()),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let copy = opaque(&response["data"]["template"], "id");
    assert!(copy != f.template);
    assert!(response["data"]["template"]["body_template"] == ORIGINAL_BODY);
    assert_eq!(response["data"]["template"]["is_active"], false);
    assert!(
        response["data"]["template"]["owner_user_id"]
            == Uuid::from_u128(hms_db::provision::LIMITED_USER_ID).to_string()
    );
    assert!(response["data"]["template"]
        .get("copied_from_revision_id")
        .is_none());
    let replay = checked(
        request(
            &f.app,
            &copier,
            Method::POST,
            "/api/v2/clinical/note-templates/record".into(),
            Some(command.clone()),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(replay["data"]["replayed"], true);
    assert!(replay["data"]["template"] == response["data"]["template"]);
    let receipt = checked(
        request(
            &f.app,
            &copier,
            Method::GET,
            format!("/api/v2/clinical/note-templates/requests/{key}"),
            None,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert!(receipt["data"]["template"] == response["data"]["template"]);
    let mut mismatch = command;
    mismatch["title"] = json!("Synthetic mismatched retry");
    let denied = checked(
        request(
            &f.app,
            &copier,
            Method::POST,
            "/api/v2/clinical/note-templates/record".into(),
            Some(mismatch),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(denied["error"]["code"], "clinical_note_request_conflict");
    let counts:(i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM clinical_note_template_revisions WHERE template_id=$1),(SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='clinical.note_template.created')").bind(copy).fetch_one(&f.pool).await,"copy aggregate evidence reads");
    assert_eq!(counts, (1, 1));
    let source_after=must(sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('version',current_revision,'revision',current_revision_id,'body',body_template,'active',is_active,'updated_at',updated_at) FROM clinical_note_templates WHERE id=$1").bind(f.template).fetch_one(&f.pool).await,"source evidence rereads");
    assert!(
        source_before == source_after,
        "creating independent copy preserves its source"
    );
}

async fn waiting(
    pool: &hms_db::PgPool,
    blocker: i32,
    query: &'static str,
    tasks: &[JoinHandle<Response>],
) {
    must(tokio::time::timeout(WallDuration::from_secs(4),async {
        loop {
            let count:i64=must(sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0").bind(blocker).bind(query).fetch_one(pool).await,"real wait graph reads");
            if count==tasks.len() as i64 {break;}
            assert!(tasks.iter().all(|task|!task.is_finished()),"actual protected reads reach held production lock");
            tokio::time::sleep(WallDuration::from_millis(10)).await;
        }
    }).await,"actual protected read waits are observed");
}
fn reads(f: &Fixture, token: &str) -> Vec<JoinHandle<Response>> {
    [f.history(), f.version(f.revision)]
        .into_iter()
        .map(|path| {
            let app = f.app.clone();
            let token = token.to_owned();
            tokio::spawn(async move { request(&app, &token, Method::GET, path, None).await })
        })
        .collect()
}
async fn joined(tasks: Vec<JoinHandle<Response>>, code: &str) {
    for mut task in tasks {
        let response = match tokio::time::timeout(WallDuration::from_secs(6), &mut task).await {
            Ok(result) => must(result, "protected read task completes"),
            Err(_) => {
                task.abort();
                panic!("released protected read completes within bounded wait");
            }
        };
        let denied = checked(response, StatusCode::FORBIDDEN).await;
        assert!(denied["error"]["code"] == code);
    }
}

#[tokio::test]
async fn template_history_and_exact_revision_reject_revoked_session_after_real_user_wait() {
    let f = Fixture::new().await;
    let reader = f.reader(false).await;
    let claims = access_claims(&reader);
    let mut blocker = must(f.pool.begin().await, "blocking fixture transaction starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking connection identity reads",
    );
    must(
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
            .bind(claims.sub)
            .fetch_one(&mut *blocker)
            .await,
        "actual actor parent is held",
    );
    let tasks = reads(&f, &reader);
    waiting(&f.pool, pid, "FROM users", &tasks).await;
    must(
        sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1")
            .bind(claims.session_id)
            .execute(&mut *blocker)
            .await,
        "winning fixture revokes exact session",
    );
    must(blocker.commit().await, "winning revocation commits");
    joined(tasks, "clinical_note_authorization_expired").await;
}

#[tokio::test]
async fn template_history_and_exact_revision_reject_withdrawn_permission_after_real_user_wait() {
    let f = Fixture::new().await;
    let reader = f.reader(false).await;
    let claims = access_claims(&reader);
    let mut blocker = must(f.pool.begin().await, "blocking fixture transaction starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking connection identity reads",
    );
    must(
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
            .bind(claims.sub)
            .fetch_one(&mut *blocker)
            .await,
        "actual actor parent is held",
    );
    let tasks = reads(&f, &reader);
    waiting(&f.pool, pid, "FROM users", &tasks).await;
    must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.view'").bind(claims.sub).execute(&mut *blocker).await,"winning fixture withdraws clinical read permission");
    must(
        sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
            .bind(claims.sub)
            .execute(&mut *blocker)
            .await,
        "winning fixture advances current permission version",
    );
    must(
        blocker.commit().await,
        "winning permission withdrawal commits",
    );
    joined(tasks, "clinical_note_authorization_expired").await;
}

#[tokio::test]
async fn template_history_and_exact_revision_recheck_feature_after_real_facility_wait() {
    let f = Fixture::new().await;
    let reader = f.reader(false).await;
    let mut blocker = must(f.pool.begin().await, "blocking fixture transaction starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking connection identity reads",
    );
    must(
        sqlx::query("SELECT id FROM facilities WHERE id=$1 FOR UPDATE")
            .bind(f.app.state().facility_id())
            .fetch_one(&mut *blocker)
            .await,
        "actual facility parent is held",
    );
    let tasks = reads(&f, &reader);
    waiting(&f.pool, pid, "FROM facilities", &tasks).await;
    must(sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'encounters',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(f.app.state().facility_id()).execute(&mut *blocker).await,"winning fixture disables encounter documentation");
    must(blocker.commit().await, "winning feature withdrawal commits");
    joined(tasks, "clinical_note_authorization_expired").await;
}

#[tokio::test]
async fn template_history_and_exact_revision_final_clock_rejects_expiry_during_root_wait() {
    let f = Fixture::new().await;
    let reader = f.reader(false).await;
    let claims = access_claims(&reader);
    let end:chrono::DateTime<Utc>=must(sqlx::query_scalar("UPDATE refresh_sessions SET idle_expires_at=clock_timestamp()+interval '4 seconds' WHERE session_id=$1 RETURNING idle_expires_at").bind(claims.session_id).fetch_one(&f.pool).await,"exact test session receives bounded lifetime");
    let mut blocker = must(f.pool.begin().await, "blocking fixture transaction starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking connection identity reads",
    );
    must(
        sqlx::query("SELECT id FROM clinical_note_templates WHERE id=$1 FOR UPDATE")
            .bind(f.template)
            .fetch_one(&mut *blocker)
            .await,
        "actual template root is held",
    );
    let tasks = reads(&f, &reader);
    waiting(&f.pool, pid, "FROM clinical_note_templates", &tasks).await;
    must(sqlx::query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.05)").bind(end).execute(&f.pool).await,"database clock crosses actual retained session deadline");
    must(blocker.commit().await, "held template root releases");
    joined(tasks, "clinical_note_authorization_expired").await;
}

#[tokio::test]
async fn template_history_and_exact_revision_reject_policy_published_before_business_proof() {
    let f = Fixture::new().await;
    let reader = f.reader(false).await;
    let claims = access_claims(&reader);
    let mut blocker = must(f.pool.begin().await, "blocking fixture transaction starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking connection identity reads",
    );
    must(
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
            .bind(claims.sub)
            .fetch_one(&mut *blocker)
            .await,
        "actual actor parent is held before business network proof",
    );
    let tasks = reads(&f, &reader);
    waiting(&f.pool, pid, "FROM users", &tasks).await;
    let facility = f.app.state().facility_id();
    let current = must(
        hms_db::network::get_policy(&f.pool, facility).await,
        "actual policy reads",
    );
    let published = must(
        hms_db::network::update_policy(
            &f.pool,
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
                reason: "Synthetic reviewed template access withdrawal".into(),
            },
            None,
        )
        .await,
        "canonical operator publication wins before business proof",
    );
    assert_eq!(published.policy.version, current.version + 1);
    must(
        blocker.commit().await,
        "old actor parent releases after policy publication",
    );
    joined(tasks, "network_policy_changed").await;
}

async fn copy_evidence(f: &Fixture) -> Value {
    must(sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
          'roots',(SELECT count(*) FROM clinical_note_templates WHERE facility_id=$1),
          'revisions',(SELECT count(*) FROM clinical_note_template_revisions WHERE facility_id=$1),
          'commands',(SELECT count(*) FROM clinical_note_template_commands WHERE facility_id=$1),
          'audits',(SELECT count(*) FROM audit_events WHERE facility_id=$1),
          'source',(SELECT jsonb_build_object('version',current_revision,'revision',current_revision_id,
            'body',body_template,'active',is_active,'owner',owner_user_id,'updated_at',updated_at)
            FROM clinical_note_templates WHERE facility_id=$1 AND id=$2)
        )
        "#,
    ).bind(f.app.state().facility_id()).bind(f.template).fetch_one(&f.pool).await,"minimal copy and source evidence reads")
}

#[tokio::test]
async fn previously_read_revision_cannot_create_shared_copy_after_manage_authority_is_withdrawn() {
    let f = Fixture::new().await;
    let copier = f.reader(true).await;
    let claims = access_claims(&copier);
    let source = checked(
        request(&f.app, &copier, Method::GET, f.version(f.revision), None).await,
        StatusCode::OK,
    )
    .await;
    let command = json!({"client_request_id":Uuid::new_v4(),"title":"Synthetic reviewed unsaved copy","note_type":source["data"]["note_type"],"body_template":source["data"]["body_template"],"is_active":false});
    let before = copy_evidence(&f).await;
    let mut blocker = must(f.pool.begin().await, "blocking copy fixture starts");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await,
        "blocking connection identity reads",
    );
    must(
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
            .bind(claims.sub)
            .fetch_one(&mut *blocker)
            .await,
        "actual copier parent is held",
    );
    let app = f.app.clone();
    let token = copier.clone();
    let input = command.clone();
    let task = tokio::spawn(async move {
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/clinical/note-templates/record".into(),
            Some(input),
        )
        .await
    });
    let tasks = vec![task];
    waiting(&f.pool, pid, "FROM users", &tasks).await;
    must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.manage'").bind(claims.sub).execute(&mut *blocker).await,"winning fixture withdraws copy management");
    must(
        sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
            .bind(claims.sub)
            .execute(&mut *blocker)
            .await,
        "winning fixture advances copier authority version",
    );
    must(
        blocker.commit().await,
        "winning copy-authority withdrawal commits",
    );
    joined(tasks, "clinical_note_authorization_expired").await;
    assert!(copy_evidence(&f).await==before,"in-flight copy loses authority before any new root, revision, command or audit, preserving exact source");
    // A new current session retains template View but cannot reuse captured
    // content as create authority after Manage has actually been removed.
    let fresh = login(f.app.clone(), "limited@hms.local").await.0;
    checked(
        request(&f.app, &fresh, Method::GET, f.version(f.revision), None).await,
        StatusCode::OK,
    )
    .await;
    let current = copy_evidence(&f).await;
    let denied = checked(
        request(
            &f.app,
            &fresh,
            Method::POST,
            "/api/v2/clinical/note-templates/record".into(),
            Some(command),
        )
        .await,
        StatusCode::FORBIDDEN,
    )
    .await;
    assert_eq!(denied["error"]["code"], "permission_denied");
    assert!(
        copy_evidence(&f).await == current,
        "View-only copy denial has no source or creation effects"
    );
}
