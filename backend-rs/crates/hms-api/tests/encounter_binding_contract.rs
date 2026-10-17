//! Actual HTTP admission/encounter binding and first-terminal evidence contracts.
//! Every subject and login belongs to the isolated Docker-backed test database.
mod support;
use support::*;

fn must<T, E>(value: Result<T, E>, message: &'static str) -> T {
    value.unwrap_or_else(|_| panic!("{message}"))
}

struct Outcome {
    status: StatusCode,
    body: Value,
}

impl Outcome {
    fn error_code(&self) -> &str {
        self.body["error"]["code"]
            .as_str()
            .filter(|code| code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
            .unwrap_or("unclassified")
    }

    fn definite_conflict(&self) -> bool {
        self.status == StatusCode::CONFLICT && !self.error_code().ends_with("_unconfirmed")
    }
}

#[derive(Clone)]
struct Fixture {
    app: TestApp,
    pool: hms_db::PgPool,
    token: String,
    clinic: Uuid,
    ward: Uuid,
}

impl Fixture {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
        let token = login(app.clone(), "owner@hms.local").await.0;
        let mut fixture = Self {
            app,
            pool,
            token,
            clinic: Uuid::nil(),
            ward: Uuid::nil(),
        };
        let clinic = fixture
            .good(
                Method::POST,
                "/api/v2/clinics".to_owned(),
                Some(json!({"code":"SYN-ENCOUNTER-CONTROL","name":"Synthetic encounter control clinic"})),
            )
            .await;
        fixture.clinic = identifier(&clinic, "id");
        let ward = fixture
            .good(
                Method::POST,
                "/api/v2/wards".to_owned(),
                Some(json!({"code":"SYN-ENCOUNTER-CONTROL","name":"Synthetic encounter control ward"})),
            )
            .await;
        fixture.ward = identifier(&ward, "id");
        fixture
    }

    async fn send(&self, method: Method, path: String, input: Option<Value>) -> Outcome {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(AUTHORIZATION, format!("Bearer {}", self.token));
        let content = match input {
            Some(value) => {
                request = request.header("content-type", "application/json");
                Body::from(must(
                    serde_json::to_vec(&value),
                    "synthetic encounter request encodes",
                ))
            }
            None => Body::empty(),
        };
        let response = must(
            self.app
                .clone()
                .oneshot(must(
                    request.body(content),
                    "synthetic encounter request builds",
                ))
                .await,
            "actual encounter route responds",
        );
        let status = response.status();
        let bytes = must(
            to_bytes(response.into_body(), 2 * 1024 * 1024).await,
            "bounded encounter response reads",
        );
        Outcome {
            status,
            body: must(
                serde_json::from_slice(&bytes),
                "actual encounter envelope decodes",
            ),
        }
    }

    async fn good(&self, method: Method, path: String, input: Option<Value>) -> Value {
        let out = self.send(method, path, input).await;
        assert!(
            out.status == StatusCode::OK,
            "actual synthetic setup/read must succeed: status={} code={}",
            out.status.as_u16(),
            out.error_code()
        );
        out.body["data"].clone()
    }

    async fn patient(&self) -> Uuid {
        let suffix = Uuid::new_v4().simple().to_string();
        let patient = self
            .good(
                Method::POST,
                "/api/v2/patients".to_owned(),
                Some(json!({"first_name":format!("Synthetic{}", &suffix[..16]),"last_name":format!("Encounter{}", &suffix[16..]),"date_of_birth":"1991-03-14","sex":"other"})),
            )
            .await;
        identifier(&patient, "id")
    }

    async fn visit(&self, patient: Uuid) -> Uuid {
        let visit = self
            .good(
                Method::POST,
                "/api/v2/visits/check-in".to_owned(),
                Some(json!({"patient_id":patient,"appointment_id":null,"clinic_id":self.clinic})),
            )
            .await;
        assert!(
            visit["status"] == "waiting",
            "actual new visit starts waiting"
        );
        identifier(&visit, "id")
    }

    async fn encounter(&self, patient: Uuid, visit: Option<Uuid>, kind: &str) -> Value {
        let encounter = self
            .good(
                Method::POST,
                "/api/v2/encounters".to_owned(),
                Some(json!({"patient_id":patient,"visit_id":visit,"encounter_type":kind})),
            )
            .await;
        assert!(
            encounter["patient_id"] == json!(patient)
                && encounter["visit_id"] == json!(visit)
                && encounter["encounter_type"] == kind
                && encounter["status"] == "in_progress"
                && encounter["ended_at"].is_null(),
            "real encounter creation establishes exact open source identity"
        );
        encounter
    }

    async fn admitted_case(&self, patient: Uuid, encounter: Uuid, visit: Uuid) -> Uuid {
        let bed = self
            .good(
                Method::POST,
                format!("/api/v2/wards/{}/beds", self.ward),
                Some(
                    json!({"section_id":null,"bed_code":format!("SYN-{}",Uuid::new_v4().simple())}),
                ),
            )
            .await;
        let bed = identifier(&bed, "id");
        let case = self
            .good(
                Method::POST,
                "/api/v2/admissions/cases".to_owned(),
                Some(json!({"patient_id":patient,"ward_id":self.ward,"encounter_id":encounter,"visit_id":visit})),
            )
            .await;
        let case = identifier(&case, "id");
        self.good(
            Method::POST,
            format!("/api/v2/admissions/cases/{case}/reserve-bed"),
            Some(json!({"bed_id":bed})),
        )
        .await;
        let admitted = self
            .good(
                Method::POST,
                format!("/api/v2/admissions/cases/{case}/activate"),
                None,
            )
            .await;
        assert!(
            admitted["status"] == "admitted"
                && admitted["patient_id"] == json!(patient)
                && admitted["encounter_id"] == json!(encounter)
                && admitted["visit_id"] == json!(visit)
                && admitted["bed_id"] == json!(bed),
            "canonical real activation retains the reviewed patient encounter visit and bed"
        );
        case
    }
}

fn identifier(value: &Value, field: &'static str) -> Uuid {
    must(
        Uuid::parse_str(value[field].as_str().unwrap_or("")),
        "actual synthetic response carries its resource identity",
    )
}

#[tokio::test]
async fn unlinked_in_progress_encounter_can_update_exact_same_patient_visit_and_type() {
    let f = Fixture::new().await;
    let patient = f.patient().await;
    let first = f.visit(patient).await;
    let second = f.visit(patient).await;
    assert!(
        first != second,
        "positive control has distinct actual visit identities"
    );
    let original = f.encounter(patient, Some(first), "inpatient").await;
    let encounter = identifier(&original, "id");
    let updated = f
        .good(
            Method::PATCH,
            format!("/api/v2/encounters/{encounter}"),
            Some(json!({"visit_id":second,"encounter_type":"outpatient"})),
        )
        .await;
    let cases: i64 = must(
        sqlx::query_scalar(
            "SELECT count(*) FROM admission_cases WHERE facility_id=$1 AND encounter_id=$2",
        )
        .bind(f.app.state().facility_id())
        .bind(encounter)
        .fetch_one(&f.pool)
        .await,
        "positive control proves this actual encounter is not admission bound",
    );
    let preserved = updated["id"] == original["id"]
        && updated["patient_id"] == original["patient_id"]
        && updated["visit_id"] == json!(second)
        && updated["encounter_type"] == "outpatient"
        && updated["status"] == "in_progress"
        && updated["started_at"] == original["started_at"]
        && updated["ended_at"].is_null();
    eprintln!("unlinked_positive_status=200 admission_bindings={cases} original_episode_preserved={preserved}");
    assert!(
        cases == 0 && preserved,
        "ordinary authorized unlinked updates remain supported"
    );
}

#[tokio::test]
async fn active_admission_bound_encounter_cannot_retarget_its_visit_or_type() {
    let f = Fixture::new().await;
    let mut controls = Vec::new();
    for change_visit in [true, false] {
        let patient = f.patient().await;
        let source_visit = f.visit(patient).await;
        let different_visit = f.visit(patient).await;
        assert!(
            source_visit != different_visit,
            "binding probe uses two actual distinct visits"
        );
        let original = f.encounter(patient, Some(source_visit), "inpatient").await;
        let encounter = identifier(&original, "id");
        let case = f.admitted_case(patient, encounter, source_visit).await;
        let original_case = f
            .good(
                Method::GET,
                format!("/api/v2/admissions/cases/{case}"),
                None,
            )
            .await;
        let input = if change_visit {
            json!({"visit_id":different_visit})
        } else {
            json!({"encounter_type":"outpatient"})
        };
        let out = f
            .send(
                Method::PATCH,
                format!("/api/v2/encounters/{encounter}"),
                Some(input),
            )
            .await;
        let saved = f
            .good(Method::GET, format!("/api/v2/encounters/{encounter}"), None)
            .await;
        let saved_case = f
            .good(
                Method::GET,
                format!("/api/v2/admissions/cases/{case}"),
                None,
            )
            .await;
        let exact_binding: bool = must(
            sqlx::query_scalar("SELECT c.encounter_id=e.id AND c.visit_id IS NOT DISTINCT FROM e.visit_id AND e.encounter_type='inpatient' AND c.status='admitted' AND e.status='in_progress' FROM admission_cases c JOIN encounters e ON e.facility_id=c.facility_id AND e.patient_id=c.patient_id AND e.id=c.encounter_id WHERE c.facility_id=$1 AND c.patient_id=$2 AND c.id=$3")
                .bind(f.app.state().facility_id()).bind(patient).bind(case)
                .fetch_one(&f.pool).await,
            "exact committed admission and encounter binding reads",
        );
        let preserved = saved == original && saved_case == original_case;
        controls.push((
            change_visit,
            out.status.as_u16(),
            out.definite_conflict(),
            preserved,
            exact_binding,
        ));
    }
    eprintln!("bound_encounter_change_visit_status_definite_preserved_exact={controls:?}");
    assert!(
        controls.iter().all(|(_, _, definite, preserved, exact)| *definite && *preserved && *exact),
        "an actual active admission binding rejects changed visit or type without contradicting its committed episode"
    );
}

#[tokio::test]
async fn first_encounter_terminal_status_and_time_survive_repeat_and_opposite_terminal_action() {
    let f = Fixture::new().await;
    let mut controls = Vec::new();
    for complete_first in [true, false] {
        let patient = f.patient().await;
        let original = f.encounter(patient, None, "outpatient").await;
        let encounter = identifier(&original, "id");
        let first_action = if complete_first { "complete" } else { "cancel" };
        let other_action = if complete_first { "cancel" } else { "complete" };
        let expected = if complete_first {
            "completed"
        } else {
            "cancelled"
        };
        let first = f
            .good(
                Method::POST,
                format!("/api/v2/encounters/{encounter}/{first_action}"),
                None,
            )
            .await;
        assert!(
            first["status"] == expected
                && first["ended_at"].is_string()
                && first["started_at"] == original["started_at"],
            "real first terminal action establishes its original status and time"
        );
        let repeated = f
            .good(
                Method::POST,
                format!("/api/v2/encounters/{encounter}/{first_action}"),
                None,
            )
            .await;
        let repeat_preserved = repeated == first;
        let opposite = f
            .send(
                Method::POST,
                format!("/api/v2/encounters/{encounter}/{other_action}"),
                None,
            )
            .await;
        let saved = f
            .good(Method::GET, format!("/api/v2/encounters/{encounter}"), None)
            .await;
        let committed: (bool, bool) = must(
            sqlx::query_as("SELECT status=$3, ended_at=$4::timestamptz FROM encounters WHERE facility_id=$1 AND id=$2")
                .bind(f.app.state().facility_id()).bind(encounter).bind(expected)
                .bind(first["ended_at"].as_str().unwrap_or(""))
                .fetch_one(&f.pool).await,
            "committed original terminal status and time facts read",
        );
        controls.push((
            complete_first,
            opposite.status.as_u16(),
            opposite.definite_conflict(),
            repeat_preserved,
            saved == first,
            committed,
        ));
    }
    eprintln!("first_terminal_complete_status_definite_repeat_saved_committed={controls:?}");
    assert!(
        controls.iter().all(|(_, _, definite, repeated, saved, committed)| *definite && *repeated && *saved && *committed == (true, true)),
        "first completed or cancelled evidence stays monotonic through exact replay and an opposite terminal request"
    );
}

#[tokio::test]
async fn actual_terminal_visit_cannot_be_reopened_by_new_encounter_or_start_consultation() {
    let f = Fixture::new().await;
    let mut controls = Vec::new();
    for terminal_action in ["checkout", "no-show"] {
        for create_encounter in [true, false] {
            let patient = f.patient().await;
            let visit = f.visit(patient).await;
            let terminal = f
                .good(
                    Method::POST,
                    format!("/api/v2/visits/{visit}/{terminal_action}"),
                    None,
                )
                .await;
            let out = if create_encounter {
                f.send(Method::POST, "/api/v2/encounters".to_owned(), Some(json!({"patient_id":patient,"visit_id":visit,"encounter_type":"outpatient"}))).await
            } else {
                f.send(
                    Method::POST,
                    format!("/api/v2/visits/{visit}/start-consultation"),
                    None,
                )
                .await
            };
            let saved = f
                .good(Method::GET, format!("/api/v2/visits/{visit}"), None)
                .await;
            let encounters: i64 = must(sqlx::query_scalar("SELECT count(*) FROM encounters WHERE facility_id=$1 AND patient_id=$2 AND visit_id=$3")
                .bind(f.app.state().facility_id()).bind(patient).bind(visit).fetch_one(&f.pool).await, "terminal visit encounter aggregate reads");
            controls.push((
                create_encounter,
                out.status.as_u16(),
                out.definite_conflict(),
                saved == terminal,
                encounters,
            ));
        }
    }
    eprintln!("terminal_visit_create_status_definite_preserved_count={controls:?}");
    assert!(controls.iter().all(|(_,_,definite,preserved,count)| *definite && *preserved && *count==0),
        "canonical terminal visits retain their first queue outcome and gain no encounter after a new-start attempt");
}

#[tokio::test]
async fn historical_cancelled_admission_keeps_encounter_identity_and_exact_noop_stable() {
    let f = Fixture::new().await;
    let patient = f.patient().await;
    let source_visit = f.visit(patient).await;
    let alternate = f.visit(patient).await;
    let original = f.encounter(patient, Some(source_visit), "triage").await;
    let encounter = identifier(&original, "id");
    let case = f.good(Method::POST, "/api/v2/admissions/cases".to_owned(),
        Some(json!({"patient_id":patient,"ward_id":f.ward,"encounter_id":encounter,"visit_id":source_visit}))).await;
    let case = identifier(&case, "id");
    let cancelled = f
        .good(
            Method::POST,
            format!("/api/v2/admissions/cases/{case}/cancel"),
            None,
        )
        .await;
    assert!(
        cancelled["status"] == "cancelled",
        "canonical cancellation creates genuine historical case evidence"
    );
    let unchanged = f
        .good(
            Method::PATCH,
            format!("/api/v2/encounters/{encounter}"),
            Some(json!({"visit_id":source_visit,"encounter_type":"triage"})),
        )
        .await;
    let changed = f
        .send(
            Method::PATCH,
            format!("/api/v2/encounters/{encounter}"),
            Some(json!({"visit_id":alternate,"encounter_type":"outpatient"})),
        )
        .await;
    let saved = f
        .good(Method::GET, format!("/api/v2/encounters/{encounter}"), None)
        .await;
    assert!(unchanged == original && changed.definite_conflict() && saved == original,
        "historical admission identity remains exact, including actual triage type, while a no-op preserves the saved episode");
}

#[tokio::test]
async fn generic_terminal_action_requires_actual_active_admission_workflow() {
    let f = Fixture::new().await;
    let patient = f.patient().await;
    let visit = f.visit(patient).await;
    let original = f.encounter(patient, Some(visit), "inpatient").await;
    let encounter = identifier(&original, "id");
    f.admitted_case(patient, encounter, visit).await;
    for action in ["complete", "cancel"] {
        let out = f
            .send(
                Method::POST,
                format!("/api/v2/encounters/{encounter}/{action}"),
                None,
            )
            .await;
        let saved = f
            .good(Method::GET, format!("/api/v2/encounters/{encounter}"), None)
            .await;
        assert!(out.definite_conflict() && out.error_code()=="encounter_admission_workflow_required" && saved==original,
            "generic terminal routes cannot close or cancel an encounter belonging to actual active inpatient work");
    }
}

#[tokio::test]
async fn admission_publisher_rechecks_exact_encounter_tuple_after_real_gate_wait() {
    let f = Fixture::new().await;
    let patient = f.patient().await;
    let first = f.visit(patient).await;
    let second = f.visit(patient).await;
    let original = f.encounter(patient, Some(first), "outpatient").await;
    let encounter = identifier(&original, "id");
    let mut gate = must(f.pool.begin().await, "encounter publication gate begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "publication gate pid reads",
    );
    must(
        sqlx::query("SELECT id FROM encounters WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(f.app.state().facility_id())
            .bind(encounter)
            .execute(&mut *gate)
            .await,
        "exact source encounter locks",
    );
    let pending_f = f.clone();
    let pending = tokio::spawn(async move {
        pending_f
            .send(
                Method::POST,
                "/api/v2/admissions/cases".to_owned(),
                Some(
                    json!({"patient_id":patient,"ward_id":pending_f.ward,"encounter_id":encounter}),
                ),
            )
            .await
    });
    let mut waited = false;
    for _ in 0..150 {
        waited = must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND (query ILIKE '%encounters%' OR query ILIKE '%admission_cases%'))")
            .bind(pid).fetch_one(&f.pool).await, "actual encounter publication blocking edge reads");
        if waited {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    // Competing source publication occurs before the first binding exists.
    must(
        sqlx::query("UPDATE encounters SET visit_id=$3 WHERE facility_id=$1 AND id=$2")
            .bind(f.app.state().facility_id())
            .bind(encounter)
            .bind(second)
            .execute(&mut *gate)
            .await,
        "unbound source tuple changes before queued publication",
    );
    must(
        gate.commit().await,
        "source tuple publication commits before queued gate resumes",
    );
    let out = must(pending.await, "waiting actual admission joins");
    let facts:(i64,i64)=must(sqlx::query_as("SELECT count(*),count(*) FILTER(WHERE c.visit_id IS DISTINCT FROM e.visit_id OR c.patient_id<>e.patient_id OR c.facility_id<>e.facility_id) FROM admission_cases c JOIN encounters e ON e.id=c.encounter_id WHERE c.facility_id=$1 AND c.patient_id=$2")
        .bind(f.app.state().facility_id()).bind(patient).fetch_one(&f.pool).await, "committed exact binding counts read");
    eprintln!("admission_publisher_real_wait={waited} status={} committed_cases={} contradictory_bindings={}",out.status.as_u16(),facts.0,facts.1);
    assert!(waited && facts.1==0 && ((out.status==StatusCode::OK && facts.0==1) || (out.definite_conflict() && facts.0==0)),
        "a queued admission publisher either binds the fresh exact source or definitely refuses; it never commits a stale service-preloaded visit");
}

async fn natural_expiry_during_encounter_wait(terminal: bool) {
    let mut f = Fixture::new().await;
    let patient = f.patient().await;
    let visit = f.visit(patient).await;
    let alternate = f.visit(patient).await;
    let original = f.encounter(patient, Some(visit), "outpatient").await;
    let encounter = identifier(&original, "id");
    let facility = f.app.state().facility_id();
    let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    must(
        sqlx::query(
            "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='encounter.manage'",
        )
        .bind(user)
        .execute(&f.pool)
        .await,
        "timed control removes direct encounter authority",
    );
    let grant:Uuid=must(sqlx::query_scalar("INSERT INTO permission_assignments(id,facility_id,grantee_user_id,permission_code,scope_type,granted_by_user_id,starts_at,ends_at,status) VALUES(gen_random_uuid(),$1,$2,'encounter.manage','facility',$2,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '5 minutes','active') RETURNING id")
        .bind(facility).bind(user).fetch_one(&f.pool).await, "managed encounter authority allows authentication setup");
    f.token = login(f.app.clone(), "owner@hms.local").await.0;
    let end:chrono::DateTime<Utc>=must(sqlx::query_scalar("UPDATE permission_assignments SET ends_at=clock_timestamp()+interval '4 seconds' WHERE id=$1 RETURNING ends_at")
        .bind(grant).fetch_one(&f.pool).await, "managed deadline arms only after actual authentication");
    let mut gate = must(f.pool.begin().await, "timed encounter gate begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "timed gate pid reads",
    );
    must(
        sqlx::query("SELECT id FROM encounters WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(facility)
            .bind(encounter)
            .execute(&mut *gate)
            .await,
        "timed exact encounter locks",
    );
    let pending_f = f.clone();
    let pending = tokio::spawn(async move {
        if terminal {
            pending_f
                .send(
                    Method::POST,
                    format!("/api/v2/encounters/{encounter}/complete"),
                    None,
                )
                .await
        } else {
            pending_f
                .send(
                    Method::PATCH,
                    format!("/api/v2/encounters/{encounter}"),
                    Some(json!({"visit_id":alternate})),
                )
                .await
        }
    });
    let mut waited = false;
    for _ in 0..150 {
        waited=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query ILIKE '%encounters%')").bind(pid).fetch_one(&f.pool).await, "actual timed encounter wait reads");
        if waited {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let mut expired = false;
    for _ in 0..500 {
        expired = must(
            sqlx::query_scalar("SELECT clock_timestamp()>$1")
                .bind(end)
                .fetch_one(&f.pool)
                .await,
            "actual managed expiry reads",
        );
        if expired {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    must(
        gate.rollback().await,
        "timed gate releases before assertions",
    );
    let out = must(pending.await, "timed actual encounter joins");
    let preserved:bool=must(sqlx::query_scalar("SELECT visit_id=$3 AND status='in_progress' AND ended_at IS NULL FROM encounters WHERE facility_id=$1 AND id=$2")
        .bind(facility).bind(encounter).bind(visit).fetch_one(&f.pool).await, "timed committed identity and terminal facts read");
    eprintln!("encounter_timed_terminal={terminal} real_wait={waited} expired={expired} status={} saved_preserved={preserved}",out.status.as_u16());
    assert!(waited && expired && out.status==StatusCode::FORBIDDEN && preserved,
        "retained current care authority reaches final database time after the actual encounter wait");
}

#[tokio::test]
async fn encounter_identity_command_rechecks_natural_authority_expiry_after_real_wait() {
    natural_expiry_during_encounter_wait(false).await;
}

#[tokio::test]
async fn encounter_terminal_command_rechecks_natural_authority_expiry_after_real_wait() {
    natural_expiry_during_encounter_wait(true).await;
}

#[tokio::test]
async fn generic_care_preserves_its_real_demographic_workflow_purpose_without_full_or_relationship()
{
    let mut f = Fixture::new().await;
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    must(
        sqlx::query(
            "DELETE FROM user_patient_visibility WHERE user_id=$1 AND visibility<>'demographics'",
        )
        .bind(owner)
        .execute(&f.pool)
        .await,
        "generic positive control retains only demographic visibility",
    );
    f.token = login(f.app.clone(), "owner@hms.local").await.0;
    let patient = f.patient().await;
    // Creating a synthetic identity is administrative and does not manufacture
    // an authored note or ordinary-care relationship for this caller.
    must(
        sqlx::query(
            "DELETE FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2 AND user_id=$3",
        )
        .bind(f.app.state().facility_id())
        .bind(patient)
        .bind(owner)
        .execute(&f.pool)
        .await,
        "generic positive control has no ordinary clinical relationship",
    );
    let visit = f.visit(patient).await;
    let original = f.encounter(patient, Some(visit), "outpatient").await;
    let encounter = identifier(&original, "id");
    let no_op = f
        .good(
            Method::PATCH,
            format!("/api/v2/encounters/{encounter}"),
            Some(json!({"encounter_type":"outpatient"})),
        )
        .await;
    let complete = f
        .good(
            Method::POST,
            format!("/api/v2/encounters/{encounter}/complete"),
            None,
        )
        .await;
    let facts:(bool,i64)=must(sqlx::query_as("SELECT EXISTS(SELECT 1 FROM user_patient_visibility WHERE user_id=$1 AND visibility='full_clinical'),(SELECT count(*) FROM patient_contexts WHERE facility_id=$2 AND patient_id=$3 AND user_id=$1)")
        .bind(owner).bind(f.app.state().facility_id()).bind(patient).fetch_one(&f.pool).await, "generic real visibility and relationship facts read");
    assert!(facts==(false,0) && no_op==original && complete["status"]=="completed",
        "generic encounter commands preserve existing demographic workflow semantics; the consultation purpose owns its separate Full ordinary-care requirements");
}

#[tokio::test]
async fn new_admission_may_retain_exact_closed_origin_without_reopening_or_type_coercion() {
    let f = Fixture::new().await;
    let patient = f.patient().await;
    let visit = f.visit(patient).await;
    let source = f.encounter(patient, Some(visit), "outpatient").await;
    let encounter = identifier(&source, "id");
    let closed = f
        .good(
            Method::POST,
            format!("/api/v2/encounters/{encounter}/complete"),
            None,
        )
        .await;
    let case = f
        .good(
            Method::POST,
            "/api/v2/admissions/cases".to_owned(),
            Some(json!({"patient_id":patient,"ward_id":f.ward,"encounter_id":encounter})),
        )
        .await;
    let saved = f
        .good(Method::GET, format!("/api/v2/encounters/{encounter}"), None)
        .await;
    assert!(saved==closed && case["encounter_id"]==json!(encounter) && case["visit_id"]==json!(visit)
        && saved["encounter_type"]=="outpatient" && saved["ended_at"]==closed["ended_at"],
        "canonical admission binding retains an exact closed historical origin and does not claim a resumed consultation");
}

#[tokio::test]
async fn imported_finished_terminal_alias_keeps_actual_first_status_and_time() {
    let f = Fixture::new().await;
    let patient = f.patient().await;
    let encounter = Uuid::new_v4();
    must(sqlx::query("INSERT INTO encounters(id,facility_id,patient_id,encounter_type,status,started_at,ended_at,created_by_user_id) VALUES($1,$2,$3,'inpatient','finished',clock_timestamp()-interval '1 day',clock_timestamp()-interval '23 hours',$4)")
        .bind(encounter).bind(f.app.state().facility_id()).bind(patient).bind(Uuid::from_u128(hms_db::provision::OWNER_USER_ID))
        .execute(&f.pool).await, "historical supported finished fixture establishes its original evidence directly");
    let original = f
        .good(Method::GET, format!("/api/v2/encounters/{encounter}"), None)
        .await;
    assert!(
        original["status"] == "completed" && original["ended_at"].is_string(),
        "historical alias remains readable through the actual canonical DTO"
    );
    let repeated = f
        .good(
            Method::POST,
            format!("/api/v2/encounters/{encounter}/complete"),
            None,
        )
        .await;
    let opposite = f
        .send(
            Method::POST,
            format!("/api/v2/encounters/{encounter}/cancel"),
            None,
        )
        .await;
    let original_preserved:bool=must(sqlx::query_scalar("SELECT status='finished' AND ended_at=$3::timestamptz FROM encounters WHERE facility_id=$1 AND id=$2")
        .bind(f.app.state().facility_id()).bind(encounter).bind(original["ended_at"].as_str().unwrap_or(""))
        .fetch_one(&f.pool).await, "actual original stored legacy terminal spelling and time read");
    assert!(repeated==original && opposite.definite_conflict() && original_preserved,
        "canonical same-outcome replay preserves imported finished evidence and an opposite terminal action cannot rewrite it");
}

#[tokio::test]
async fn historical_visit_only_admission_preserves_origin_during_first_encounter_attachment() {
    let f = Fixture::new().await;
    let mut controls = Vec::new();
    for matching_origin in [false, true] {
        let patient = f.patient().await;
        let origin = f.visit(patient).await;
        let other = f.visit(patient).await;
        let case = f
            .good(
                Method::POST,
                "/api/v2/admissions/cases".to_owned(),
                Some(json!({"patient_id":patient,"ward_id":f.ward,"visit_id":origin})),
            )
            .await;
        let case = identifier(&case, "id");
        let historical = f
            .good(
                Method::POST,
                format!("/api/v2/admissions/cases/{case}/cancel"),
                None,
            )
            .await;
        assert!(
            historical["status"] == "cancelled"
                && historical["encounter_id"].is_null()
                && historical["visit_id"] == json!(origin),
            "canonical cancellation establishes a real visit-only historical origin"
        );
        let selected = if matching_origin { origin } else { other };
        let source = f.encounter(patient, Some(selected), "outpatient").await;
        let encounter = identifier(&source, "id");
        let updated = sqlx::query(
            "UPDATE admission_cases SET encounter_id=$3,visit_id=$4 WHERE facility_id=$1 AND id=$2",
        )
        .bind(f.app.state().facility_id())
        .bind(case)
        .bind(encounter)
        .bind(selected)
        .execute(&f.pool)
        .await;
        let facts:(bool,bool,bool)=must(sqlx::query_as("SELECT visit_id=$3,encounter_id IS NOT DISTINCT FROM $4::uuid,status='cancelled' FROM admission_cases WHERE facility_id=$1 AND id=$2")
            .bind(f.app.state().facility_id()).bind(case).bind(origin)
            .bind(if matching_origin { Some(encounter) } else { None }).fetch_one(&f.pool).await,
            "actual saved historical visit-only origin reads");
        controls.push((matching_origin, updated.is_ok(), facts));
    }
    eprintln!(
        "historical_visit_only_matching_update_succeeded_origin_encounter_closed={controls:?}"
    );
    assert!(controls==vec![(false,false,(true,true,true)),(true,true,(true,true,true))],
        "first attachment may add the exact matching encounter but cannot replace an already recorded historical visit origin");
}
