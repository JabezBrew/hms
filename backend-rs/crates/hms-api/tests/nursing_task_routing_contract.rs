//! Effective nursing responsibility and move/decision races through actual HTTP.
mod support;
use support::*;

fn must<T, E>(value: Result<T, E>, message: &'static str) -> T {
    value.unwrap_or_else(|_| panic!("{message}"))
}

async fn request(
    app: TestApp,
    token: &str,
    method: Method,
    path: String,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let body = match body {
        Some(body) => {
            builder = builder.header("content-type", "application/json");
            Body::from(must(serde_json::to_vec(&body), "synthetic request encodes"))
        }
        None => Body::empty(),
    };
    let response = must(
        must(
            tokio::time::timeout(
                std::time::Duration::from_secs(15),
                app.oneshot(must(builder.body(body), "actual routing request builds")),
            )
            .await,
            "actual routing HTTP operation is bounded",
        ),
        "actual routing route responds",
    );
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded routing response reads",
    );
    (
        status,
        must(serde_json::from_slice(&bytes), "routing response is JSON"),
    )
}

struct Fixture {
    app: TestApp,
    pool: hms_db::PgPool,
    owner: String,
    source_token: String,
    destination_token: String,
    patient: Uuid,
    case: Uuid,
    source: Uuid,
    destination: Uuid,
    destination_bed: Uuid,
    source_user: Uuid,
    destination_user: Uuid,
}

async fn assign(app: &TestApp, user: Uuid, ward: Uuid) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let staff:Uuid=must(sqlx::query_scalar("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic nursing','Nurse',CURRENT_DATE) ON CONFLICT(user_id) DO UPDATE SET position=staff_profiles.position RETURNING id").bind(facility).bind(user).bind(format!("SYN-{user}")).fetch_one(&pool).await,"synthetic nursing staff exists");
    let practitioner:Uuid=must(sqlx::query_scalar("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES(gen_random_uuid(),$1,$2,$3,'Nursing','Synthetic') ON CONFLICT(staff_id) DO UPDATE SET qualification=practitioner_profiles.qualification RETURNING id").bind(facility).bind(staff).bind(format!("SYN-{user}")).fetch_one(&pool).await,"synthetic nursing practitioner exists");
    must(sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES(gen_random_uuid(),$1,$2,$3,'staff_nurse','Nurse','nursing')").bind(facility).bind(ward).bind(practitioner).execute(&pool).await,"synthetic exact ward assignment exists");
}

impl Fixture {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let facility = app.state().facility_id();
        let owner_user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        let source_user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
        let destination_user = Uuid::new_v4();
        // Copy only the initial synthetic fixture hash before any fixture login
        // completes its mandatory password change; no human credentials involved.
        must(sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) SELECT $1,facility_id,'route-destination@hms.local','Synthetic destination nurse',password_hash FROM users WHERE id=$2").bind(destination_user).bind(owner_user).execute(&pool).await,"isolated destination account inserts");
        grant_test_patient_visibility(&app, owner_user, PatientDataVisibility::FullClinical).await;
        grant_test_permission(&app, owner_user, PermissionCode::WardBoardViewAll).await;
        for user in [source_user, destination_user] {
            for permission in [
                PermissionCode::NursingTaskManage,
                PermissionCode::PatientDemographicsView,
            ] {
                grant_test_permission(&app, user, permission).await;
            }
            for feature in [FeatureKey::Nursing, FeatureKey::Patients] {
                grant_test_feature(&app, user, feature).await;
            }
            for visibility in [
                PatientDataVisibility::Demographics,
                PatientDataVisibility::FullClinical,
            ] {
                grant_test_patient_visibility(&app, user, visibility).await;
            }
        }
        let patient = Uuid::new_v4();
        must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,'Synthetic','Routing','2000-01-01','other','active','registered','presumed_alive')").bind(patient).bind(facility).bind(format!("SYN-ROUTE-{}",patient.simple())).execute(&pool).await,"isolated patient inserts");
        let source = Uuid::new_v4();
        let destination = Uuid::new_v4();
        let source_bed = Uuid::new_v4();
        let destination_bed = Uuid::new_v4();
        for (ward, bed, code) in [
            (source, source_bed, "SYN-ROUTE-SOURCE"),
            (destination, destination_bed, "SYN-ROUTE-DEST"),
        ] {
            must(sqlx::query("INSERT INTO wards(id,facility_id,code,name,status) VALUES($1,$2,$3,'Synthetic routing ward','active')").bind(ward).bind(facility).bind(code).execute(&pool).await,"isolated ward inserts");
            must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,bed_code,status) VALUES($1,$2,$3,'SYN-ROUTE-BED','available')").bind(bed).bind(facility).bind(ward).execute(&pool).await,"isolated bed inserts");
        }
        assign(&app, source_user, source).await;
        assign(&app, destination_user, destination).await;
        for user in [owner_user, source_user, destination_user] {
            must(
                hms_db::patients::upsert_patient_context(
                    &pool,
                    facility,
                    user,
                    patient,
                    hms_domain::patients::PatientContextKind::Assigned,
                    None,
                )
                .await,
                "ordinary assigned patient context exists",
            );
        }
        let owner = login(app.clone(), "owner@hms.local").await.0;
        let source_token = login(app.clone(), "limited@hms.local").await.0;
        let destination_token = login(app.clone(), "route-destination@hms.local").await.0;
        let (status, body) = request(
            app.clone(),
            &owner,
            Method::POST,
            "/api/v2/admissions".into(),
            Some(json!({"patient_id":patient,"ward_id":source,"bed_id":source_bed})),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "valid explicit available-bed control admits"
        );
        let case = must(
            Uuid::parse_str(
                body["data"]["admission_id"]
                    .as_str()
                    .expect("admission ID shape"),
            ),
            "admission ID parses",
        );
        Self {
            app,
            pool,
            owner,
            source_token,
            destination_token,
            patient,
            case,
            source,
            destination,
            destination_bed,
            source_user,
            destination_user,
        }
    }
    fn base(&self) -> String {
        format!(
            "/api/v2/patients/{}/chronicle/admissions/{}",
            self.patient, self.case
        )
    }
    fn task_input(&self, assigned: Option<Uuid>) -> Value {
        json!({"patient_id":self.patient,"admission_case_id":self.case,"task_type":"observation","title":"Synthetic routed task","instruction":"Synthetic original instruction","due_at":Utc::now(),"assigned_to_user_id":assigned})
    }
    async fn task(&self, assigned: Option<Uuid>) -> Uuid {
        let (status, body) = request(
            self.app.clone(),
            &self.owner,
            Method::POST,
            "/api/v2/nursing/tasks".into(),
            Some(self.task_input(assigned)),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "valid source task creates");
        must(
            Uuid::parse_str(body["data"]["id"].as_str().expect("task ID shape")),
            "task ID parses",
        )
    }
    async fn reviewed(&self) -> Value {
        let (status, context) = request(
            self.app.clone(),
            &self.owner,
            Method::GET,
            format!("{}/placement", self.base()),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "actual placement review loads");
        let (status, destinations) = request(
            self.app.clone(),
            &self.owner,
            Method::GET,
            format!(
                "{}/move-destinations?ward_id={}",
                self.base(),
                self.destination
            ),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "actual destination review loads");
        let candidate = destinations["data"]
            .as_array()
            .expect("candidate list shape")
            .iter()
            .find(|row| row["bed_id"].as_str() == Some(self.destination_bed.to_string().as_str()))
            .expect("exact available destination is present");
        assert!(
            context["data"]["task_membership_token"].is_string(),
            "complete reviewed membership token exists"
        );
        json!({"client_request_id":Uuid::new_v4(),"expected_placement_token":context["data"]["placement_token"],
            "destination_bed_id":self.destination_bed,"expected_destination_token":candidate["candidate_token"],
            "expected_task_membership_token":context["data"]["task_membership_token"],"task_policy":"route_all_clear_assignees","reason":"Synthetic reviewed nursing route"})
    }
    async fn move_with(&self, body: Value) -> (StatusCode, Value) {
        request(
            self.app.clone(),
            &self.owner,
            Method::POST,
            format!("{}/moves", self.base()),
            Some(body),
        )
        .await
    }
    async fn task_decision(&self, token: &str, task: Uuid) -> (StatusCode, Value) {
        request(
            self.app.clone(),
            token,
            Method::POST,
            format!("/api/v2/nursing/tasks/{task}/complete"),
            None,
        )
        .await
    }
}

async fn edge(pool: &hms_db::PgPool, blocker: i32, needle: &str) -> Option<i32> {
    tokio::time::timeout(std::time::Duration::from_secs(6),async {loop {
        let pid:Option<i32>=must(sqlx::query_scalar("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND $1=ANY(pg_blocking_pids(pid)) AND position($2 in query)>0 ORDER BY pid LIMIT 1").bind(blocker).bind(needle).fetch_optional(pool).await,"bounded actual lock graph reads");
        if pid.is_some(){return pid;}tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }}).await.ok().flatten()
}
async fn collect(handle: tokio::task::JoinHandle<(StatusCode, Value)>) -> (StatusCode, Value) {
    must(
        must(
            tokio::time::timeout(std::time::Duration::from_secs(10), handle).await,
            "actual routing operation finishes after gate release",
        ),
        "actual routing task joins",
    )
}
async fn pause_routes(f: &Fixture) -> (sqlx::Transaction<'_, sqlx::Postgres>, i32) {
    must(sqlx::query("CREATE FUNCTION synthetic_route_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(17001803); RETURN NEW; END $$").execute(&f.pool).await,"isolated route pause function creates");
    must(sqlx::query("CREATE TRIGGER synthetic_route_pause AFTER INSERT ON nursing_task_routes FOR EACH ROW EXECUTE FUNCTION synthetic_route_pause()").execute(&f.pool).await,"isolated route pause trigger creates");
    let mut gate = must(f.pool.begin().await, "route gate transaction opens");
    must(
        sqlx::query("SELECT pg_advisory_xact_lock(17001803)")
            .execute(&mut *gate)
            .await,
        "route gate takes real advisory lock",
    );
    let pid = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "route gate PID reads",
    );
    (gate, pid)
}

#[tokio::test]
async fn moved_open_work_follows_effective_ward_and_preserves_terminal_origin_and_provenance() {
    let f = Fixture::new().await;
    let open = f.task(Some(f.source_user)).await;
    let terminal = f.task(None).await;
    let (status, terminal_before) = f.task_decision(&f.owner, terminal).await;
    assert_eq!(status, StatusCode::OK);
    let (status, movement) = f.move_with(f.reviewed().await).await;
    assert_eq!(status, StatusCode::OK, "reviewed move commits");
    assert_eq!(
        movement["data"]["movement"]["task_result"]["routed_task_count"],
        1
    );
    assert_eq!(
        movement["data"]["movement"]["task_result"]["cleared_assignee_count"],
        1
    );
    let (status, denial) = f.task_decision(&f.source_token, open).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(denial["error"]["code"], "nursing_ward_access_denied");
    for (token, ward, expected, route) in [
        (&f.source_token, f.source, terminal, 0),
        (&f.destination_token, f.destination, open, 1),
    ] {
        let (status, body) = request(
            f.app.clone(),
            token,
            Method::GET,
            format!(
                "/api/v2/nursing/tasks?patient_id={}&admission_case_id={}&ward_id={ward}&limit=1",
                f.patient, f.case
            ),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let rows = body["data"].as_array().expect("bounded task list shape");
        assert_eq!(
            rows.len(),
            1,
            "effective ward filter is applied before paging"
        );
        assert!(
            rows[0]["id"].as_str() == Some(expected.to_string().as_str()),
            "only effective ward work is present"
        );
        assert!(
            rows[0]["ward_id"].as_str() == Some(f.source.to_string().as_str()),
            "captured origin is immutable"
        );
        assert!(
            rows[0]["service_ward_id"].as_str() == Some(ward.to_string().as_str()),
            "effective ward is explicit"
        );
        assert_eq!(rows[0]["route_version"], route);
        if route == 0 {
            assert!(
                rows[0] == terminal_before["data"],
                "terminal evidence is unchanged"
            );
        } else {
            assert!(
                rows[0]["assigned_to_user_id"].is_null(),
                "old assignment clears"
            );
        }
    }
    let (status, completed) = f.task_decision(&f.destination_token, open).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        completed["data"]["completed_by_user_id"].as_str()
            == Some(f.destination_user.to_string().as_str()),
        "current destination clinician owns completion evidence"
    );
    assert_eq!(completed["data"]["route_version"], 1);
    let (events,prior_assignment,unchanged_text):(i64,bool,bool)=must(sqlx::query_as("SELECT (SELECT count(*) FROM nursing_task_routes WHERE task_id=$1),(SELECT bool_and(from_assigned_to_user_id=$2 AND to_assigned_to_user_id IS NULL) FROM nursing_task_routes WHERE task_id=$1),(SELECT instruction='Synthetic original instruction' FROM nursing_tasks WHERE id=$1)").bind(open).bind(f.source_user).fetch_one(&f.pool).await,"saved routing evidence loads");
    assert_eq!((events, prior_assignment, unchanged_text), (1, true, true));
    let completed_audits:i64=must(sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE resource_id=$1 AND event_type='nursing.task.completed'").bind(open).fetch_one(&f.pool).await,"exact completion audit count loads");
    assert_eq!(completed_audits, 1);
}

#[tokio::test]
async fn actual_source_decision_holds_task_then_move_nowait_is_definite_and_terminal_is_not_routed()
{
    let f = Fixture::new().await;
    let task = f.task(None).await;
    let reviewed = f.reviewed().await;
    let mut gate = must(f.pool.begin().await, "user gate opens");
    must(
        sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
            .bind(f.source_user)
            .fetch_one(&mut *gate)
            .await,
        "source user gate holds",
    );
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "user gate PID reads",
    );
    let app = f.app.clone();
    let token = f.source_token.clone();
    let decision = tokio::spawn(async move {
        request(
            app,
            &token,
            Method::POST,
            format!("/api/v2/nursing/tasks/{task}/complete"),
            None,
        )
        .await
    });
    let reached = edge(&f.pool, pid, "FROM users WHERE facility_id").await;
    let mut probe = must(f.pool.begin().await, "task lock probe opens");
    let probe_result = sqlx::query("SELECT id FROM nursing_tasks WHERE id=$1 FOR SHARE NOWAIT")
        .bind(task)
        .fetch_one(&mut *probe)
        .await;
    let held = probe_result
        .as_ref()
        .err()
        .and_then(sqlx::Error::as_database_error)
        .is_some_and(|e| e.code().as_deref() == Some("55P03"));
    must(probe.rollback().await, "task lock probe rolls back");
    let movement = f.move_with(reviewed).await;
    must(gate.rollback().await, "source user gate releases");
    let completed = collect(decision).await;
    assert!(
        reached.is_some() && held,
        "actual decision has source task lock while waiting current-user proof"
    );
    assert_eq!(movement.0, StatusCode::CONFLICT);
    assert_eq!(movement.1["error"]["code"], "admission_move_busy");
    assert_eq!(completed.0, StatusCode::OK);
    let (status, receipt) = f.move_with(f.reviewed().await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        receipt["data"]["movement"]["task_result"]["routed_task_count"],
        0
    );
    let (status, again) = f.task_decision(&f.source_token, task).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "terminal replay uses captured effective ward"
    );
    assert!(
        again["data"] == completed.1["data"],
        "terminal completion actor and time are immutable"
    );
}

#[tokio::test]
async fn actual_decision_waiting_move_task_rechecks_effective_ward_after_commit() {
    let f = Fixture::new().await;
    let task = f.task(None).await;
    let reviewed = f.reviewed().await;
    let (gate, pid) = pause_routes(&f).await;
    let app = f.app.clone();
    let token = f.owner.clone();
    let path = format!("{}/moves", f.base());
    let movement =
        tokio::spawn(async move { request(app, &token, Method::POST, path, Some(reviewed)).await });
    let move_pid = edge(&f.pool, pid, "INSERT INTO nursing_task_routes").await;
    if move_pid.is_none() {
        must(
            gate.rollback().await,
            "route gate releases after failed premise",
        );
        let _ = collect(movement).await;
        panic!("actual move must reach route persistence gate");
    }
    let app = f.app.clone();
    let token = f.source_token.clone();
    let decision = tokio::spawn(async move {
        request(
            app,
            &token,
            Method::POST,
            format!("/api/v2/nursing/tasks/{task}/complete"),
            None,
        )
        .await
    });
    let waited = edge(
        &f.pool,
        move_pid.unwrap(),
        "FROM nursing_tasks WHERE facility_id",
    )
    .await;
    must(gate.rollback().await, "route gate releases");
    let moved = collect(movement).await;
    let decided = collect(decision).await;
    assert!(
        waited.is_some(),
        "actual decision waits on the move's task lock"
    );
    assert_eq!(moved.0, StatusCode::OK);
    assert_eq!(decided.0, StatusCode::FORBIDDEN);
    assert_eq!(decided.1["error"]["code"], "nursing_ward_access_denied");
    assert_eq!(
        f.task_decision(&f.destination_token, task).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn actual_creator_waiting_move_case_refuses_stale_preflight_ward_without_new_work() {
    let f = Fixture::new().await;
    let _ = f.task(None).await;
    let reviewed = f.reviewed().await;
    let (gate, pid) = pause_routes(&f).await;
    let app = f.app.clone();
    let token = f.owner.clone();
    let path = format!("{}/moves", f.base());
    let movement =
        tokio::spawn(async move { request(app, &token, Method::POST, path, Some(reviewed)).await });
    let move_pid = edge(&f.pool, pid, "INSERT INTO nursing_task_routes").await;
    if move_pid.is_none() {
        must(
            gate.rollback().await,
            "route gate releases after failed premise",
        );
        let _ = collect(movement).await;
        panic!("actual move must reach route persistence gate");
    }
    let app = f.app.clone();
    let token = f.source_token.clone();
    let input = f.task_input(None);
    let creator = tokio::spawn(async move {
        request(
            app,
            &token,
            Method::POST,
            "/api/v2/nursing/tasks".into(),
            Some(input),
        )
        .await
    });
    let waited = edge(&f.pool, move_pid.unwrap(), "FROM admission_cases").await;
    must(gate.rollback().await, "route gate releases");
    let moved = collect(movement).await;
    let created = collect(creator).await;
    assert!(
        waited.is_some(),
        "actual creator retains preflight ward then waits the selected admission"
    );
    assert_eq!(moved.0, StatusCode::OK);
    assert_eq!(created.0, StatusCode::CONFLICT);
    assert_eq!(created.1["error"]["code"], "nursing_context_changed");
    let (tasks,audits):(i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM nursing_tasks WHERE admission_case_id=$1),(SELECT count(*) FROM audit_events WHERE resource_id IN(SELECT id FROM nursing_tasks WHERE admission_case_id=$1) AND event_type='nursing.task.created')").bind(f.case).fetch_one(&f.pool).await,"committed task and creation audit counts load");
    assert_eq!((tasks, audits), (1, 1));
}

#[tokio::test]
async fn actual_creator_case_share_makes_move_busy_then_new_membership_requires_review() {
    let f = Fixture::new().await;
    let _ = f.task(None).await;
    let reviewed = f.reviewed().await;
    must(sqlx::query("CREATE FUNCTION synthetic_create_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='nursing.task.created' THEN PERFORM pg_advisory_xact_lock(17001804); END IF; RETURN NEW; END $$").execute(&f.pool).await,"isolated task audit pause function creates");
    must(sqlx::query("CREATE TRIGGER synthetic_create_pause BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_create_pause()").execute(&f.pool).await,"isolated task audit pause trigger creates");
    let mut gate = must(f.pool.begin().await, "creation gate opens");
    must(
        sqlx::query("SELECT pg_advisory_xact_lock(17001804)")
            .execute(&mut *gate)
            .await,
        "creation gate holds",
    );
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "creation gate PID reads",
    );
    let app = f.app.clone();
    let token = f.source_token.clone();
    let input = f.task_input(None);
    let creator = tokio::spawn(async move {
        request(
            app,
            &token,
            Method::POST,
            "/api/v2/nursing/tasks".into(),
            Some(input),
        )
        .await
    });
    let reached = edge(&f.pool, pid, "INSERT INTO audit_events").await;
    let (status, busy) = f.move_with(reviewed.clone()).await;
    must(gate.rollback().await, "creation gate releases");
    let created = collect(creator).await;
    assert!(
        reached.is_some(),
        "actual creator holds admission share before creation audit"
    );
    assert_eq!(created.0, StatusCode::OK);
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(busy["error"]["code"], "admission_move_busy");
    let (status, stale) = f.move_with(reviewed).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(stale["error"]["code"], "admission_move_tasks_changed");
    let (status, moved) = f.move_with(f.reviewed().await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        moved["data"]["movement"]["task_result"]["routed_task_count"],
        2
    );
}
