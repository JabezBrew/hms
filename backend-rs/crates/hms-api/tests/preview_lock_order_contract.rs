//! Real authored-note-only preview/amend queue ordering, with observed DB edges.
//! Only numeric outcomes and static error codes may reach diagnostic output.
mod support;
use axum::response::Response;
use std::time::Duration as WallDuration;
use support::*;
use tokio::task::JoinHandle;

fn must<T, E>(value: Result<T, E>, message: &'static str) -> T {
    value.unwrap_or_else(|_| panic!("{message}"))
}
fn opaque(value: &Value, field: &str) -> Uuid {
    must(
        Uuid::parse_str(value[field].as_str().expect("fixture identity exists")),
        "fixture identity parses",
    )
}
async fn send(
    app: TestApp,
    token: &str,
    method: Method,
    path: String,
    value: Option<Value>,
) -> Response {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = match value {
        Some(value) => {
            request = request.header("content-type", "application/json");
            Body::from(must(serde_json::to_vec(&value), "fixture request encodes"))
        }
        None => Body::empty(),
    };
    must(
        app.oneshot(must(request.body(body), "fixture request builds"))
            .await,
        "actual route responds",
    )
}
async fn response(response: Response) -> (StatusCode, Value) {
    let status = response.status();
    let body = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded response reads",
    );
    (
        status,
        must(serde_json::from_slice(&body), "typed response decodes"),
    )
}
async fn checked(response_value: Response) -> Value {
    let (status, value) = response(response_value).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "fixture actual route succeeds with static code {}",
        value["error"]["code"].as_str().unwrap_or("none")
    );
    value
}
async fn join_response(mut task: JoinHandle<Response>) -> (StatusCode, Value) {
    match tokio::time::timeout(WallDuration::from_secs(8), &mut task).await {
        Ok(joined) => response(must(joined, "actual HTTP task joins")).await,
        Err(_) => {
            task.abort();
            panic!("released actual HTTP task completes within bounded wait");
        }
    }
}
async fn edge_except(
    pool: &hms_db::PgPool,
    blocker: i32,
    query: &'static str,
    excluded: i32,
) -> Option<i32> {
    tokio::time::timeout(WallDuration::from_secs(4), async {
        loop {
            let pid:Option<i32>=must(sqlx::query_scalar(
                "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0 AND pid<>$3 ORDER BY pid LIMIT 1",
            ).bind(blocker).bind(query).bind(excluded).fetch_optional(pool).await, "actual queue edge reads");
            if pid.is_some() { return pid; }
            tokio::time::sleep(WallDuration::from_millis(10)).await;
        }
    }).await.ok().flatten()
}

async fn edge(pool: &hms_db::PgPool, blocker: i32, query: &'static str) -> Option<i32> {
    edge_except(pool, blocker, query, 0).await
}

#[tokio::test]
async fn authored_note_preview_and_amendment_progress_with_queued_facility_update() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
    let patient:Uuid=must(sqlx::query_scalar("SELECT p.id FROM patients p WHERE p.facility_id=$1 AND p.record_status='registered' AND p.vital_status<>'deceased' AND NOT EXISTS(SELECT 1 FROM clinical_notes n WHERE n.facility_id=p.facility_id AND n.patient_id=p.id AND n.created_by_user_id=$2) ORDER BY p.id LIMIT 1").bind(facility).bind(owner).fetch_one(&pool).await, "synthetic active patient exists");
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let note = checked(send(app.clone(), &token, Method::POST, format!("/api/v2/patients/{patient}/clinical/notes/record"), Some(json!({
        "client_request_id":Uuid::new_v4(),"encounter_id":null,"template_revision_id":null,
        "note_type":"doctor_note","title":"Synthetic ordering note","body":"Synthetic original narrative"
    }))).await).await;
    let note_id = opaque(&note["data"]["note"], "id");
    let template = checked(send(app.clone(), &token, Method::POST, "/api/v2/clinical/note-templates/record".into(), Some(json!({
        "client_request_id":Uuid::new_v4(),"title":"Synthetic ordering template","note_type":"doctor_note",
        "body_template":"Synthetic preview for {{patient_first_name}}","is_active":true
    }))).await).await;
    let template_id = opaque(&template["data"]["template"], "id");
    let revision_id = opaque(&template["data"]["template"], "current_revision_id");
    // There must be no context shortcut. Only this actor's immutable authorship
    // provides ordinary care evidence for the new preview.
    must(
        sqlx::query(
            "DELETE FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3",
        )
        .bind(facility)
        .bind(owner)
        .bind(patient)
        .execute(&pool)
        .await,
        "isolated context shortcut removes",
    );
    let counts:(i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM patient_contexts WHERE facility_id=$1 AND user_id=$2 AND patient_id=$3),(SELECT count(*) FROM clinical_notes WHERE facility_id=$1 AND created_by_user_id=$2 AND patient_id=$3)").bind(facility).bind(owner).bind(patient).fetch_one(&pool).await, "ordinary relationship source counts read");
    assert!(
        counts.0 == 0 && counts.1 == 1,
        "authored-note-only relationship is real"
    );
    let preview_input = json!({"template_id":template_id,"template_revision_id":revision_id,"encounter_id":null,"apply_mode":"empty_only","sections":[],"base_body":"","chief_complaint":null});
    let preview_path = format!("/api/v2/patients/{patient}/clinical/note-template-previews");
    // Warm actual request-context caches and prove this route/source is valid
    // before introducing any production-row lock contention.
    checked(
        send(
            app.clone(),
            &token,
            Method::POST,
            preview_path.clone(),
            Some(preview_input.clone()),
        )
        .await,
    )
    .await;
    checked(
        send(
            app.clone(),
            &token,
            Method::GET,
            format!("/api/v2/clinical/notes/{note_id}"),
            None,
        )
        .await,
    )
    .await;
    let mut gate = must(pool.begin().await, "actor gate starts");
    let gate_pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "actor gate connection reads",
    );
    must(
        sqlx::query("SELECT id FROM users WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(facility)
            .bind(owner)
            .fetch_one(&mut *gate)
            .await,
        "actual actor parent is held",
    );
    let preview_app = app.clone();
    let preview_token = token.clone();
    let preview_task = tokio::spawn(async move {
        send(
            preview_app,
            &preview_token,
            Method::POST,
            preview_path,
            Some(preview_input),
        )
        .await
    });
    let preview_pid = match edge(&pool, gate_pid, "FROM users").await {
        Some(pid) => pid,
        None => {
            preview_task.abort();
            must(gate.rollback().await, "unused actor gate releases");
            panic!("actual preview reaches actor gate after facility proof");
        }
    };
    let mut publisher = must(pool.begin().await, "controlled facility publisher starts");
    let publisher_pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *publisher)
            .await,
        "publisher connection reads",
    );
    let publisher_task = tokio::spawn(async move {
        sqlx::query("UPDATE facilities SET updated_at=updated_at WHERE id=$1")
            .bind(facility)
            .execute(&mut *publisher)
            .await?;
        publisher.commit().await
    });
    let publisher_edge = edge(&pool, preview_pid, "UPDATE facilities").await;
    if publisher_edge != Some(publisher_pid) {
        preview_task.abort();
        publisher_task.abort();
        must(gate.rollback().await, "unused actor gate releases");
        panic!("real facility publisher waits on preview retained SHARE");
    }
    let amend_app = app.clone();
    let amend_token = token.clone();
    let amendment = json!({"client_request_id":Uuid::new_v4(),"expected_version":1,"reason":"Synthetic ordering correction","body":"Synthetic reviewed narrative"});
    let amend_task = tokio::spawn(async move {
        send(
            amend_app,
            &amend_token,
            Method::POST,
            format!("/api/v2/clinical/notes/{note_id}/amendments"),
            Some(amendment),
        )
        .await
    });
    // The actual baseline disproved the predicted queued-facility cycle:
    // amendment takes a compatible facility SHARE and reaches the user gate.
    // Prove that alternate edge, excluding the already observed preview PID.
    let amend_pid = edge_except(&pool, gate_pid, "FROM users", preview_pid).await;
    // A real NOWAIT probe proves amendment has taken this sole authored note's
    // conflicting root lock, rather than merely waiting in HTTP preflight.
    // Preview is still user-gated and cannot yet have touched the note.
    let mut probe = must(pool.begin().await, "bounded source-lock probe starts");
    let probe_result = must(
        tokio::time::timeout(
            WallDuration::from_secs(2),
            sqlx::query(
                "SELECT id FROM clinical_notes WHERE facility_id=$1 AND id=$2 FOR SHARE NOWAIT",
            )
            .bind(facility)
            .bind(note_id)
            .fetch_optional(&mut *probe),
        )
        .await,
        "NOWAIT source-lock probe completes within bounded wait",
    );
    let note_locked = probe_result.err().is_some_and(|error| {
        error
            .as_database_error()
            .is_some_and(|database| database.code().as_deref() == Some("55P03"))
    });
    must(probe.rollback().await, "source-lock probe rolls back");
    must(gate.commit().await, "observed graph releases actor gate");
    let (preview_status, preview) = join_response(preview_task).await;
    let (amend_status, amended) = join_response(amend_task).await;
    let mut publisher_task = publisher_task;
    let publisher_ok =
        match tokio::time::timeout(WallDuration::from_secs(8), &mut publisher_task).await {
            Ok(joined) => joined.is_ok_and(|result| result.is_ok()),
            Err(_) => {
                publisher_task.abort();
                false
            }
        };
    let preview_code = preview["error"]["code"].as_str().unwrap_or("none");
    let amend_code = amended["error"]["code"].as_str().unwrap_or("none");
    eprintln!("ordered_preview_status={} code={} amendment_status={} code={} publisher_ok={} amendment_reached_user_gate={}",preview_status.as_u16(),preview_code,amend_status.as_u16(),amend_code,publisher_ok,amend_pid.is_some());
    assert!(
        amend_pid.is_some(),
        "actual amendment reaches user gate after its note and compatible facility SHARE"
    );
    assert!(
        note_locked,
        "real amendment holds the authored note root before gate release"
    );
    assert!(
        publisher_ok,
        "queued unchanged facility publication completes without deadlock victim"
    );
    assert_eq!(
        amend_status,
        StatusCode::OK,
        "actual reviewed amendment completes with one result"
    );
    assert!(
        amended["data"]["note"]["version"] == 2,
        "one reviewed amendment reaches expected version"
    );
    assert_eq!(
        preview_status,
        StatusCode::OK,
        "protected preview completes without deadlock or read fallback"
    );
    assert!(
        preview["data"]["patient_id"] == patient.to_string()
            && preview["data"]["template_revision_id"] == revision_id.to_string(),
        "preview keeps its exact protected source binding"
    );
    let persisted:(i64,i64,i64)=must(sqlx::query_as("SELECT (SELECT version FROM clinical_notes WHERE facility_id=$1 AND id=$2),(SELECT count(*) FROM clinical_note_commands WHERE facility_id=$1 AND target_id=$2 AND command_kind='amend'),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND resource_id=$2 AND event_type='clinical.note.amended')").bind(facility).bind(note_id).fetch_one(&pool).await,"minimal amendment result counts read");
    assert_eq!(
        persisted,
        (2, 1, 1),
        "one version advance, command and audit survive contention"
    );
}
