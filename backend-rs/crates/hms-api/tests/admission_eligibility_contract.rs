//! Actual canonical admission controls for current ward/section eligibility.
mod support;
use support::*;

fn must<T, E>(value: Result<T, E>, stage: &'static str) -> T {
    value.unwrap_or_else(|_| panic!("{stage}"))
}

async fn request(
    app: &TestApp,
    token: &str,
    method: Method,
    path: String,
    body: Value,
) -> (StatusCode, Value) {
    let response = must(
        app.clone()
            .oneshot(must(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(must(
                        serde_json::to_vec(&body),
                        "bounded synthetic input encodes",
                    ))),
                "actual eligibility request builds",
            ))
            .await,
        "actual eligibility route responds",
    );
    let status = response.status();
    let bytes = must(
        to_bytes(response.into_body(), 2 * 1024 * 1024).await,
        "bounded eligibility response reads",
    );
    (
        status,
        must(
            serde_json::from_slice(&bytes),
            "eligibility envelope decodes",
        ),
    )
}

#[track_caller]
fn success(out: (StatusCode, Value)) -> Value {
    assert!(
        out.0 == StatusCode::OK,
        "required setup/positive route succeeds with static code {}",
        out.1["error"]["code"].as_str().unwrap_or("none")
    );
    out.1["data"].clone()
}

struct Fixture {
    app: TestApp,
    pool: hms_db::PgPool,
    token: String,
    facility: Uuid,
}

impl Fixture {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let facility = app.state().facility_id();
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
        let token = login(app.clone(), "owner@hms.local").await.0;
        Self {
            app,
            pool,
            token,
            facility,
        }
    }

    async fn placement(&self) -> (Uuid, Uuid, Uuid, Uuid) {
        let patient = Uuid::new_v4();
        must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,'Synthetic','Eligibility','2000-01-01','other','active','registered','presumed_alive')").bind(patient).bind(self.facility).bind(format!("SYN-ELIGIBILITY-{}",patient.simple())).execute(&self.pool).await,"isolated synthetic patient inserts");
        let ward = Uuid::new_v4();
        must(sqlx::query("INSERT INTO wards(id,facility_id,code,name,status) VALUES($1,$2,$3,'Synthetic eligibility ward','active')").bind(ward).bind(self.facility).bind(format!("SYN-WARD-{}",ward.simple())).execute(&self.pool).await,"active synthetic ward inserts");
        let section = Uuid::new_v4();
        must(sqlx::query("INSERT INTO ward_sections(id,facility_id,ward_id,code,name,status) VALUES($1,$2,$3,'SYN-SECTION','Synthetic eligibility section','active')").bind(section).bind(self.facility).bind(ward).execute(&self.pool).await,"active synthetic section inserts");
        let bed = Uuid::new_v4();
        must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,section_id,bed_code,status) VALUES($1,$2,$3,$4,'SYN-BED','available')").bind(bed).bind(self.facility).bind(ward).bind(section).execute(&self.pool).await,"available section bed inserts");
        (patient, ward, section, bed)
    }

    async fn admit(&self, patient: Uuid, ward: Uuid, bed: Uuid) -> (StatusCode, Value) {
        request(
            &self.app,
            &self.token,
            Method::POST,
            "/api/v2/admissions".into(),
            json!({"patient_id":patient,"ward_id":ward,"bed_id":bed}),
        )
        .await
    }

    async fn reserved_case(&self, patient: Uuid, ward: Uuid, bed: Uuid) -> Uuid {
        let created = success(
            request(
                &self.app,
                &self.token,
                Method::POST,
                "/api/v2/admissions/cases".into(),
                json!({"patient_id":patient,"ward_id":ward}),
            )
            .await,
        );
        let id = must(
            Uuid::parse_str(created["id"].as_str().expect("actual case has typed ID")),
            "actual case ID decodes",
        );
        success(
            request(
                &self.app,
                &self.token,
                Method::POST,
                format!("/api/v2/admissions/cases/{id}/reserve-bed"),
                json!({"bed_id":bed}),
            )
            .await,
        );
        id
    }
}

#[tokio::test]
async fn direct_admission_cannot_use_a_section_disabled_during_its_exact_bed_wait() {
    let f = Fixture::new().await;
    let (control_patient, control_ward, _, control_bed) = f.placement().await;
    let positive = f.admit(control_patient, control_ward, control_bed).await;
    let (patient, ward, section, bed) = f.placement().await;
    let mut gate = must(f.pool.begin().await, "exact selected-bed gate begins");
    let gate_pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "selected-bed gate process loads",
    );
    must(
        sqlx::query("SELECT id FROM beds WHERE id=$1 FOR UPDATE")
            .bind(bed)
            .execute(&mut *gate)
            .await,
        "exact selected bed locks",
    );
    let app = f.app.clone();
    let token = f.token.clone();
    let admission = tokio::spawn(async move {
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/admissions".into(),
            json!({"patient_id":patient,"ward_id":ward,"bed_id":bed}),
        )
        .await
    });
    let mut actual_wait = false;
    for _ in 0..150 {
        actual_wait=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query ILIKE '%FROM beds%')").bind(gate_pid).fetch_one(&f.pool).await,"actual selected-bed blocking edge loads");
        if actual_wait {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let app = f.app.clone();
    let token = f.token.clone();
    let mut admin = tokio::spawn(async move {
        request(
            &app,
            &token,
            Method::PATCH,
            format!("/api/v2/wards/sections/{section}"),
            json!({"status":"inactive"}),
        )
        .await
    });
    // A correct retained section lock may serialize the administrator after the
    // admission. Always release the bed before any assertion or pending join.
    let disabled_before_release =
        tokio::time::timeout(std::time::Duration::from_secs(1), &mut admin).await;
    let admin_before = disabled_before_release.is_ok();
    must(
        gate.rollback().await,
        "selected-bed gate releases before assertions",
    );
    let admit_out = must(admission.await, "waiting actual admission joins");
    let admin_out = match disabled_before_release {
        Ok(value) => must(value, "completed administrator joins"),
        Err(_) => must(admin.await, "serialized administrator joins"),
    };
    let facts:(i64,i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM admission_cases WHERE patient_id=$1),(SELECT count(*) FROM admission_placements WHERE patient_id=$1),(SELECT count(*) FROM admission_cases WHERE patient_id=$2 AND status='admitted')").bind(patient).bind(control_patient).fetch_one(&f.pool).await,"committed admission and interval counts load");
    let definite_refusal = admit_out.0.is_client_error()
        && !admit_out.1["error"]["code"]
            .as_str()
            .unwrap_or("")
            .ends_with("_unconfirmed");
    eprintln!("section_wait_observed={actual_wait} section_disable_committed_before_release={admin_before} admin_status={} admit_status={} committed_counts={facts:?} positive_status={}",admin_out.0.as_u16(),admit_out.0.as_u16(),positive.0.as_u16());
    assert!(actual_wait&&positive.0==StatusCode::OK&&admin_out.0==StatusCode::OK&&facts.2==1&&if admin_before { definite_refusal&&facts.0==0&&facts.1==0 } else { admit_out.0==StatusCode::OK&&facts.0==1&&facts.1==1 },"a section disabled before a waiting admission resumes causes a definite no-write refusal; retained section authority may instead serialize the administrator after a valid admission");
}

#[tokio::test]
async fn reserved_activation_requires_current_active_ward_and_section() {
    let f = Fixture::new().await;
    let mut statuses = Vec::new();
    let mut saved = Vec::new();
    let mut definite = Vec::new();
    for disable in ["none", "ward", "section"] {
        let (patient, ward, section, bed) = f.placement().await;
        let case = f.reserved_case(patient, ward, bed).await;
        if disable != "none" {
            let path = if disable == "ward" {
                format!("/api/v2/wards/{ward}")
            } else {
                format!("/api/v2/wards/sections/{section}")
            };
            success(
                request(
                    &f.app,
                    &f.token,
                    Method::PATCH,
                    path,
                    json!({"status":"inactive"}),
                )
                .await,
            );
        }
        let out = request(
            &f.app,
            &f.token,
            Method::POST,
            format!("/api/v2/admissions/cases/{case}/activate"),
            json!({}),
        )
        .await;
        statuses.push(out.0.as_u16());
        definite.push(
            out.0.is_client_error()
                && !out.1["error"]["code"]
                    .as_str()
                    .unwrap_or("")
                    .ends_with("_unconfirmed"),
        );
        let facts:(bool,bool,i64)=must(sqlx::query_as("SELECT a.status='admitted',b.status='occupied',(SELECT count(*) FROM admission_placements p WHERE p.admission_case_id=a.id) FROM admission_cases a JOIN beds b ON b.id=a.bed_id WHERE a.id=$1").bind(case).fetch_one(&f.pool).await,"activation committed state loads");
        saved.push(facts);
    }
    eprintln!("reserved_activation_statuses={statuses:?} saved_admitted_occupied_intervals={saved:?} definite_refusals={definite:?}");
    assert!(statuses[0]==200&&saved[0]==(true,true,1)&&definite[1..].iter().all(|v|*v)&&saved[1..].iter().all(|v|*v==(false,false,0)),"active reserved placement activates once; inactive ward or section yields a definite refusal preserving reserved state and no placement interval");
}
