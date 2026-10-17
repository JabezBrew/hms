//! Actual protected consultation commands with isolated synthetic data only.
mod support;
use axum::response::Response;
use sha2::{Digest, Sha256};
use support::*;
fn must<T, E>(v: Result<T, E>, s: &'static str) -> T {
    v.unwrap_or_else(|_| panic!("{s}"))
}
async fn body(r: Response) -> (StatusCode, Value) {
    let status = r.status();
    let bytes = must(
        to_bytes(r.into_body(), 2 * 1024 * 1024).await,
        "bounded synthetic response reads",
    );
    (
        status,
        must(serde_json::from_slice(&bytes), "synthetic envelope decodes"),
    )
}
async fn ok(r: Response) -> Value {
    let (status, v) = body(r).await;
    assert!(
        status == StatusCode::OK,
        "actual consultation response status {} static code {}",
        status.as_u16(),
        v["error"]["code"].as_str().unwrap_or("none")
    );
    v["data"].clone()
}
async fn call(
    app: &TestApp,
    actor: &Actor,
    method: Method,
    path: String,
    input: Option<Value>,
) -> Response {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, actor.bearer());
    let b = if let Some(i) = input {
        builder = builder.header("content-type", "application/json");
        Body::from(must(serde_json::to_vec(&i), "synthetic input serializes"))
    } else {
        Body::empty()
    };
    must(
        app.clone()
            .oneshot(must(builder.body(b), "synthetic request builds"))
            .await,
        "actual route returns",
    )
}
struct F {
    app: TestApp,
    pool: hms_db::PgPool,
    actor: Actor,
    patient: Uuid,
    user: Uuid,
}
impl F {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        for p in [
            PermissionCode::EncounterView,
            PermissionCode::ClinicalDocumentationView,
            PermissionCode::EncounterManage,
            PermissionCode::ReferralManage,
            PermissionCode::AppointmentManage,
            PermissionCode::PatientUpdate,
            PermissionCode::PatientDemographicsView,
            PermissionCode::AdmissionManage,
            PermissionCode::WardBoardViewAll,
        ] {
            grant_test_permission(&app, user, p).await;
        }
        for f in [
            FeatureKey::Patients,
            FeatureKey::Referrals,
            FeatureKey::Encounters,
            FeatureKey::Appointments,
            FeatureKey::Admissions,
            FeatureKey::Wards,
        ] {
            grant_test_feature(&app, user, f).await;
        }
        grant_test_patient_visibility(&app, user, PatientDataVisibility::FullClinical).await;
        grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
        let facility = app.state().facility_id();
        let staff:Uuid=must(sqlx::query_scalar("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic','Synthetic','2000-01-01') ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id").bind(facility).bind(user).bind(format!("SYN-CONSULT-{}",Uuid::new_v4().simple())).fetch_one(&pool).await,"local synthetic staff profile establishes");
        must(sqlx::query("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic','Synthetic') ON CONFLICT(staff_id) DO NOTHING").bind(facility).bind(staff).bind(format!("SYN-LIC-{}",Uuid::new_v4().simple())).execute(&pool).await,"actual local practitioner profile establishes");
        let patient = Uuid::new_v4();
        must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,'Synthetic','Consultation','2000-01-01','other','active','registered','presumed_alive')").bind(patient).bind(facility).bind(format!("SYN-CONSULT-{}",patient.simple())).execute(&pool).await,"isolated synthetic patient inserts");
        must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned')").bind(facility).bind(user).bind(patient).execute(&pool).await,"ordinary care relationship establishes");
        let actor = Actor::login(&app, "owner@hms.local").await;
        Self {
            app,
            pool,
            actor,
            patient,
            user,
        }
    }
    fn path(&self, r: Uuid) -> String {
        format!(
            "/api/v2/patients/{}/referrals/{r}/consultation",
            self.patient
        )
    }
    async fn request(&self, method: Method, path: String, v: Option<Value>) -> Response {
        call(&self.app, &self.actor, method, path, v).await
    }
    async fn referral(&self) -> Uuid {
        let r=ok(self.request(Method::POST,"/api/v2/referrals".into(),Some(json!({"patient_id":self.patient,"to_service":"Synthetic consultation service","priority":"routine"}))).await).await;
        let id = must(
            Uuid::parse_str(r["id"].as_str().expect("referral id exists")),
            "opaque referral parses",
        );
        ok(self
            .request(
                Method::POST,
                format!("/api/v2/referrals/{id}/accept"),
                Some(json!({"acceptance_notes":"Synthetic explicit accepted referral"})),
            )
            .await)
        .await;
        id
    }
    async fn context(&self, r: Uuid, query: &str) -> Value {
        ok(self
            .request(Method::GET, format!("{}{}", self.path(r), query), None)
            .await)
        .await
    }
    fn input(&self, context: &Value, source: Value) -> Value {
        json!({"client_request_id":Uuid::new_v4(),"expected_link_version":0,"expected_context_token":context["context_token"],"source":source,"restricted_record_override":null})
    }
    async fn start(&self, r: Uuid, input: Value) -> Response {
        self.request(Method::POST, format!("{}/start", self.path(r)), Some(input))
            .await
    }
    async fn visit(&self, status: &str, appointment: Option<Uuid>) -> Uuid {
        let id = Uuid::new_v4();
        must(sqlx::query("INSERT INTO visits(id,facility_id,patient_id,appointment_id,status,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(self.app.state().facility_id()).bind(self.patient).bind(appointment).bind(status).bind(self.user).execute(&self.pool).await,"explicit synthetic visit inserts");
        id
    }
    async fn counts(&self) -> (i64, i64, i64, i64) {
        must(sqlx::query_as("SELECT (SELECT count(*) FROM referral_consultation_starts WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM referral_consultation_start_commands WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM encounters WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type='referral.consultation_started' AND resource_id IN(SELECT id FROM referrals WHERE patient_id=$2 AND facility_id=$1))").bind(self.app.state().facility_id()).bind(self.patient).fetch_one(&self.pool).await,"committed consultation counts read")
    }
}
const NO_VISIT: &str = "?mode=new_outpatient&visit_choice=no_visit";
fn no_visit() -> Value {
    json!({"mode":"new_outpatient","visit":{"choice":"no_visit"}})
}
#[tokio::test]
async fn explicit_no_visit_start_preserves_referral_and_original_receipt_after_terminal_change() {
    let f = F::new().await;
    let r = f.referral().await;
    let unselected = f.context(r, "").await;
    assert!(
        unselected["can_start"] == false && unselected["selection"].is_null(),
        "source is never invented"
    );
    let c = f.context(r, NO_VISIT).await;
    assert!(c["can_start"] == true, "explicit active source is eligible");
    let input = f.input(&c, no_visit());
    let saved = ok(f.start(r, input.clone()).await).await;
    let e = saved["link"]["encounter_id"]
        .as_str()
        .expect("exact encounter id");
    assert!(
        saved["link"]["visit_id"].is_null()
            && saved["link"]["appointment_at_start"].is_null()
            && saved["link"]["encounter_type"] == "outpatient"
            && saved["link"]["source_referral_status"] == "accepted"
            && saved["link"]["resulting_referral_status"] == "accepted",
        "no_visit creates only the explicit new OPD encounter"
    );
    let canonical = must(
        serde_json::to_vec(&input),
        "canonical complete input encodes",
    );
    let hash: String = Sha256::digest(canonical)
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect();
    assert!(
        saved["input_digest"] == hash,
        "digest binds complete sorted JSON input"
    );
    ok(f.request(
        Method::POST,
        format!("/api/v2/encounters/{e}/complete"),
        Some(json!({})),
    )
    .await)
    .await;
    let after = f.context(r, "").await;
    assert!(
        after["link"] == saved["link"]
            && after["current_linked_encounter"]["status"] == "completed"
            && after["can_resume"] == false,
        "immutable original start separates current terminal state"
    );
    let replay = ok(f.start(r, input.clone()).await).await;
    assert!(
        replay["replayed"] == true && replay["link"] == saved["link"],
        "unchanged actor UUID replay precedes first-start eligibility"
    );
    let receipt = ok(f
        .request(
            Method::GET,
            format!(
                "{}/requests/{}",
                f.path(r),
                input["client_request_id"]
                    .as_str()
                    .expect("request reference")
            ),
            None,
        )
        .await)
    .await;
    assert!(
        receipt["link"] == saved["link"],
        "original actor receipt remains exact"
    );
    let mut changed = input.clone();
    changed["expected_context_token"] = json!("a".repeat(64));
    let (s, v) = body(f.start(r, changed).await).await;
    assert!(
        s == StatusCode::CONFLICT && v["error"]["code"] == "referral_consultation_request_conflict",
        "UUID changed intent cannot replay"
    );
    let mut duplicate = input;
    duplicate["client_request_id"] = json!(Uuid::new_v4());
    let (s, _) = body(f.start(r, duplicate).await).await;
    assert!(
        s == StatusCode::CONFLICT && f.counts().await == (1, 1, 1, 1),
        "singleton prevents second encounter or partial command"
    );
}
#[tokio::test]
async fn all_six_precheckout_visit_states_are_explicitly_reviewed_and_terminal_states_refuse() {
    let f = F::new().await;
    for status in [
        "waiting",
        "called",
        "in_triage",
        "triaged",
        "in_consultation",
        "on_hold",
        "ready_checkout",
        "checked_out",
        "no_show",
        "cancelled",
    ] {
        let r = f.referral().await;
        let visit = f.visit(status, None).await;
        let c = f
            .context(
                r,
                &format!("?mode=new_outpatient&visit_choice=existing_visit&visit_id={visit}"),
            )
            .await;
        let eligible = !matches!(
            status,
            "ready_checkout" | "checked_out" | "no_show" | "cancelled"
        );
        assert!(
            c["can_start"] == eligible,
            "exact reviewed visit state eligibility"
        );
        let input = f.input(
            &c,
            json!({"mode":"new_outpatient","visit":{"choice":"existing_visit","visit_id":visit}}),
        );
        let (s, v) = body(f.start(r, input).await).await;
        if eligible {
            assert!(
                s == StatusCode::OK
                    && v["data"]["link"]["visit_transition"]["before_status"] == status
                    && v["data"]["link"]["visit_transition"]["after_status"] == "in_consultation",
                "all six explicit starts preserve transition evidence"
            );
            let encounter = v["data"]["link"]["encounter_id"]
                .as_str()
                .expect("exact encounter id");
            assert!(
                encounter != visit.to_string(),
                "encounter and visit identifiers stay distinct"
            );
            let startup = ok(f
                .request(
                    Method::GET,
                    format!("/api/v2/patients/{}/chronicle", f.patient),
                    None,
                )
                .await)
            .await;
            let found = startup["encounters"]
                .as_array()
                .expect("actual startup encounters")
                .iter()
                .any(|v| v["id"] == encounter && v["visit_id"] == visit.to_string());
            assert!(
                found,
                "actual bounded Chronicle producer carries the distinct exact visit id"
            );
        } else {
            assert!(
                s == StatusCode::CONFLICT,
                "terminal or checkout source never reopens"
            );
        }
    }
    assert!(
        f.counts().await == (6, 6, 6, 6),
        "only six reviewed precheckout starts commit"
    );
}
#[tokio::test]
async fn restricted_override_never_bypasses_deceased_status_or_persists_raw_note() {
    for (restricted, deceased) in [(false, false), (true, false), (false, true), (true, true)] {
        let f = F::new().await;
        let r = f.referral().await;
        ok(f.request(Method::PATCH,format!("/api/v2/patients/{}",f.patient),Some(json!({"record_status":if restricted{"restricted"}else{"registered"},"vital_status":if deceased{"deceased"}else{"presumed_alive"},"status_reason_code":"synthetic_status_review"}))).await).await;
        let c = f.context(r, NO_VISIT).await;
        assert!(
            c["can_start"] == !deceased,
            "deceased blocks every new outpatient source before override"
        );
        let mut input = f.input(&c, no_visit());
        let note = "Synthetic private restricted consultation explanation";
        if restricted {
            input["restricted_record_override"] =
                json!({"reason_code":"synthetic_reviewed_override","reason_note":note})
        }
        let (s, v) = body(f.start(r, input.clone()).await).await;
        if deceased {
            assert!(
                s == StatusCode::CONFLICT && f.counts().await == (0, 0, 0, 0),
                "deceased start leaves no encounter link command or audit"
            );
        } else {
            assert!(
                s == StatusCode::OK,
                "living explicit override permits governed intake"
            );
            let private_free:bool=must(sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM referral_consultation_start_commands WHERE facility_id=$1 AND position($2 in receipt::text)>0) AND NOT EXISTS(SELECT 1 FROM referral_consultation_starts WHERE facility_id=$1 AND position($2 in detail::text)>0) AND NOT EXISTS(SELECT 1 FROM audit_events WHERE facility_id=$1 AND position($2 in metadata::text)>0)").bind(f.app.state().facility_id()).bind(note).fetch_one(&f.pool).await,"private text absence aggregate reads");
            assert!(
                private_free,
                "raw override note never persists in evidence or audit"
            );
            if restricted {
                assert!(
                    v["data"]["reviewed_input"]["restricted_record_override"]
                        ["reason_note_present"]
                        == true,
                    "receipt records presence without text"
                );
                let mut changed = input;
                changed["restricted_record_override"]["reason_note"] =
                    json!("Different synthetic private note");
                let (s, v) = body(f.start(r, changed).await).await;
                assert!(
                    s == StatusCode::CONFLICT
                        && v["error"]["code"] == "referral_consultation_request_conflict",
                    "private note participates in complete intent digest"
                );
            }
        }
    }
}
#[tokio::test]
async fn exact_source_tokens_strict_input_and_root_busy_refuse_without_side_effects() {
    let f = F::new().await;
    let r = f.referral().await;
    let c = f.context(r, NO_VISIT).await;
    let input = f.input(&c, no_visit());
    let mut unknown = input.clone();
    unknown["source"]["unrecognized"] = json!("Synthetic private body must not echo");
    let (s, v) = body(f.start(r, unknown).await).await;
    assert!(
        s == StatusCode::BAD_REQUEST && v["error"]["code"] == "invalid_referral_consultation",
        "nested unsupported fields fail strictly"
    );
    let mut stale = input.clone();
    stale["expected_context_token"] = json!("0".repeat(64));
    assert!(
        body(f.start(r, stale).await).await.0 == StatusCode::CONFLICT,
        "CAS refuses unreviewed source"
    );
    let mut gate = must(f.pool.begin().await, "exact synthetic root gate begins");
    must(
        sqlx::query("SELECT id FROM referrals WHERE facility_id=$1 AND id=$2 FOR UPDATE")
            .bind(f.app.state().facility_id())
            .bind(r)
            .execute(&mut *gate)
            .await,
        "exact root retained",
    );
    let (s, v) = body(f.start(r, input).await).await;
    must(gate.rollback().await, "gate releases");
    assert!(
        s == StatusCode::CONFLICT
            && v["error"]["code"] == "referral_consultation_busy"
            && f.counts().await == (0, 0, 0, 0),
        "NOWAIT root refusal is definite and side-effect free"
    );
}
#[tokio::test]
async fn scheduled_starts_prove_the_exact_booking_without_inventing_checkin_or_changing_status() {
    let f = F::new().await;
    let r = f.referral().await;
    let start = Utc::now() + Duration::hours(3);
    let scheduled=ok(f.request(Method::POST,format!("/api/v2/referrals/{r}/schedule"),Some(json!({"starts_at":start,"ends_at":start+Duration::minutes(30),"manual_booking_reason":"Synthetic reviewed manual consultation slot"}))).await).await;
    let appointment = must(
        Uuid::parse_str(
            scheduled["scheduled_appointment_id"]
                .as_str()
                .expect("exact booked id"),
        ),
        "booked opaque identity parses",
    );
    let before:(String,i64)=must(sqlx::query_as("SELECT status,(SELECT count(*) FROM visits WHERE facility_id=$1 AND patient_id=$2) FROM appointments WHERE facility_id=$1 AND patient_id=$2 AND id=$3").bind(f.app.state().facility_id()).bind(f.patient).bind(appointment).fetch_one(&f.pool).await,"booking prestate reads");
    let c = f.context(r, NO_VISIT).await;
    let receipt = ok(f.start(r, f.input(&c, no_visit())).await).await;
    let after:(String,i64,String)=must(sqlx::query_as("SELECT a.status,(SELECT count(*) FROM visits WHERE facility_id=$1 AND patient_id=$2),r.status FROM appointments a JOIN referrals r ON r.scheduled_appointment_id=a.id AND r.facility_id=a.facility_id WHERE a.facility_id=$1 AND a.patient_id=$2 AND r.id=$3").bind(f.app.state().facility_id()).bind(f.patient).bind(r).fetch_one(&f.pool).await,"booking poststate reads");
    assert!(
        before == (after.0, after.1)
            && after.2 == "scheduled"
            && receipt["link"]["scheduled_appointment_id"] == appointment.to_string()
            && receipt["link"]["visit_id"].is_null(),
        "reviewed no_visit leaves booking and referral status unchanged"
    );
    assert!(
        receipt["link"]["appointment_at_start"] == c["selection"]["appointment"]
            && receipt["link"]["appointment_at_start"]
                .as_object()
                .is_some_and(|v| v.len() == 6),
        "immutable appointment evidence is the exact bounded reviewed booking projection"
    );
    let changed_start = start + Duration::minutes(45);
    ok(f.request(
        Method::PATCH,
        format!("/api/v2/appointments/{appointment}"),
        Some(json!({"starts_at":changed_start,"ends_at":changed_start+Duration::minutes(30)})),
    )
    .await)
    .await;
    let historical = f.context(r, NO_VISIT).await;
    let reloaded = ok(f
        .request(
            Method::GET,
            format!(
                "{}/requests/{}",
                f.path(r),
                receipt["client_request_id"]
                    .as_str()
                    .expect("actual command reference")
            ),
            None,
        )
        .await)
    .await;
    assert!(historical["selection"]["appointment"] != c["selection"]["appointment"]
        && historical["link"]["appointment_at_start"] == c["selection"]["appointment"]
        && reloaded["link"] == receipt["link"],
        "later canonical booking time changes do not rewrite original start evidence or the actor receipt");
    let other = f.referral().await;
    let start = Utc::now() + Duration::hours(5);
    let scheduled=ok(f.request(Method::POST,format!("/api/v2/referrals/{other}/schedule"),Some(json!({"starts_at":start,"ends_at":start+Duration::minutes(30),"manual_booking_reason":"Synthetic second explicit slot"}))).await).await;
    let app_id = must(
        Uuid::parse_str(
            scheduled["scheduled_appointment_id"]
                .as_str()
                .expect("real booked identity"),
        ),
        "real identity parses",
    );
    let wrong = f.visit("waiting", Some(appointment)).await;
    let c = f
        .context(
            other,
            &format!("?mode=new_outpatient&visit_choice=existing_visit&visit_id={wrong}"),
        )
        .await;
    assert!(
        c["can_start"] == false && c["unavailable_reason"] == "appointment_unavailable",
        "another booking visit cannot become selected source"
    );
    let right = f.visit("waiting", Some(app_id)).await;
    let c = f
        .context(
            other,
            &format!("?mode=new_outpatient&visit_choice=existing_visit&visit_id={right}"),
        )
        .await;
    let receipt=ok(f.start(other,f.input(&c,json!({"mode":"new_outpatient","visit":{"choice":"existing_visit","visit_id":right}}))).await).await;
    assert!(
        receipt["link"]["scheduled_appointment_id"] == app_id.to_string()
            && receipt["link"]["visit_id"] == right.to_string(),
        "only exact real scheduled visit binding starts"
    );
}
#[tokio::test]
async fn inpatient_reuse_preserves_actual_triage_type_episode_and_first_encounter_time() {
    let f = F::new().await;
    let r = f.referral().await;
    let visit = f.visit("in_consultation", None).await;
    let encounter = ok(f
        .request(
            Method::POST,
            "/api/v2/encounters".into(),
            Some(json!({"patient_id":f.patient,"visit_id":visit,"encounter_type":"triage"})),
        )
        .await)
    .await;
    let e = must(
        Uuid::parse_str(encounter["id"].as_str().expect("actual source encounter")),
        "encounter identity parses",
    );
    let ward = Uuid::new_v4();
    let bed = Uuid::new_v4();
    must(sqlx::query("INSERT INTO wards(id,facility_id,code,name,status) VALUES($1,$2,$3,'Synthetic consultation ward','active')").bind(ward).bind(f.app.state().facility_id()).bind(format!("SYN-CONS-WARD-{}",ward.simple())).execute(&f.pool).await,"synthetic ward creates");
    must(sqlx::query("INSERT INTO beds(id,facility_id,ward_id,bed_code,status) VALUES($1,$2,$3,'SYN-CONS-BED','available')").bind(bed).bind(f.app.state().facility_id()).bind(ward).execute(&f.pool).await,"synthetic bed creates");
    let case = ok(f
        .request(
            Method::POST,
            "/api/v2/admissions/cases".into(),
            Some(json!({"patient_id":f.patient,"ward_id":ward,"encounter_id":e,"visit_id":visit})),
        )
        .await)
    .await;
    let case_id = must(
        Uuid::parse_str(case["id"].as_str().expect("actual case id")),
        "case id parses",
    );
    ok(f.request(
        Method::POST,
        format!("/api/v2/admissions/cases/{case_id}/reserve-bed"),
        Some(json!({"bed_id":bed})),
    )
    .await)
    .await;
    ok(f.request(
        Method::POST,
        format!("/api/v2/admissions/cases/{case_id}/activate"),
        Some(json!({})),
    )
    .await)
    .await;
    let before:(String,Option<Uuid>,chrono::DateTime<Utc>,chrono::DateTime<Utc>,i64)=must(sqlx::query_as("SELECT e.encounter_type,e.visit_id,e.started_at,c.admitted_at,c.placement_revision FROM encounters e JOIN admission_cases c ON c.encounter_id=e.id AND c.facility_id=e.facility_id WHERE e.facility_id=$1 AND c.id=$2").bind(f.app.state().facility_id()).bind(case_id).fetch_one(&f.pool).await,"exact care source prestate reads");
    let c = f
        .context(
            r,
            &format!(
                "?mode=existing_admission_encounter&admission_case_id={case_id}&encounter_id={e}"
            ),
        )
        .await;
    let input = f.input(
        &c,
        json!({"mode":"existing_admission_encounter","admission_case_id":case_id,"encounter_id":e}),
    );
    let receipt = ok(f.start(r, input).await).await;
    let after:(String,Option<Uuid>,chrono::DateTime<Utc>,chrono::DateTime<Utc>,i64)=must(sqlx::query_as("SELECT e.encounter_type,e.visit_id,e.started_at,c.admitted_at,c.placement_revision FROM encounters e JOIN admission_cases c ON c.encounter_id=e.id AND c.facility_id=e.facility_id WHERE e.facility_id=$1 AND c.id=$2").bind(f.app.state().facility_id()).bind(case_id).fetch_one(&f.pool).await,"exact care source poststate reads");
    assert!(
        before == after
            && receipt["link"]["encounter_id"] == e.to_string()
            && receipt["link"]["encounter_type"] == "triage"
            && receipt["link"]["encounter_created"] == false
            && receipt["link"]["visit_transition"].is_null()
            && f.counts().await == (1, 1, 1, 1),
        "reuse never coerces or duplicates the exact existing inpatient journey"
    );
    let (s, v) = body(
        f.request(
            Method::POST,
            format!("/api/v2/encounters/{e}/complete"),
            Some(json!({})),
        )
        .await,
    )
    .await;
    assert!(
        s == StatusCode::CONFLICT && v["error"]["code"] == "encounter_admission_workflow_required",
        "generic completion cannot close active inpatient journey"
    );
}
#[tokio::test]
async fn immutable_start_command_and_bound_encounter_guards_refuse_direct_rewrites() {
    let f = F::new().await;
    let r = f.referral().await;
    let c = f.context(r, NO_VISIT).await;
    let saved = ok(f.start(r, f.input(&c, no_visit())).await).await;
    let e = must(
        Uuid::parse_str(
            saved["link"]["encounter_id"]
                .as_str()
                .expect("encounter id"),
        ),
        "opaque encounter parses",
    );
    let start = must(
        Uuid::parse_str(saved["link"]["id"].as_str().expect("link id")),
        "opaque link parses",
    );
    let mut refusals = Vec::new();
    for sql in ["UPDATE referral_consultation_starts SET detail=detail || '{\"link_version\":2}'::jsonb WHERE id=$1","DELETE FROM referral_consultation_starts WHERE id=$1"]{refusals.push(sqlx::query(sql).bind(start).execute(&f.pool).await.is_err());}
    for sql in [
        "UPDATE encounters SET encounter_type='emergency' WHERE id=$1",
        "UPDATE encounters SET started_at=started_at-interval '1 second' WHERE id=$1",
        "DELETE FROM encounters WHERE id=$1",
    ] {
        refusals.push(sqlx::query(sql).bind(e).execute(&f.pool).await.is_err());
    }
    for sql in ["UPDATE referral_consultation_start_commands SET receipt=receipt || '{\"replayed\":true}'::jsonb WHERE referral_id=$1","DELETE FROM referral_consultation_start_commands WHERE referral_id=$1"]{refusals.push(sqlx::query(sql).bind(r).execute(&f.pool).await.is_err());}
    must(sqlx::query("UPDATE encounters SET visit_id=visit_id,encounter_type=encounter_type,started_at=started_at WHERE id=$1").bind(e).execute(&f.pool).await,"exact identity no-op remains valid");
    assert!(
        refusals.iter().all(|v| *v) && f.counts().await == (1, 1, 1, 1),
        "all immutable original evidence and bound care tuple rewrites refuse without change"
    );
}
#[tokio::test]
async fn historical_full_reader_needs_ordinary_relationship_and_receipt_remains_actor_bound() {
    let f = F::new().await;
    let r = f.referral().await;
    let c = f.context(r, NO_VISIT).await;
    let input = f.input(&c, no_visit());
    let saved = ok(f.start(r, input.clone()).await).await;
    use argon2::{Argon2, PasswordHasher};
    let salt = password_hash::SaltString::generate(&mut rand_core::OsRng);
    let password = must(
        Argon2::default().hash_password(b"ChangeMe123!", &salt),
        "synthetic reader password hashes",
    )
    .to_string();
    let reader = Uuid::new_v4();
    let email = format!("synthetic-consult-reader-{}@hms.local", reader.simple());
    must(sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) VALUES($1,$2,$3,'Synthetic consultation reader',$4)").bind(reader).bind(f.app.state().facility_id()).bind(&email).bind(password).execute(&f.pool).await,"separate synthetic reader creates");
    for p in [
        PermissionCode::EncounterView,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&f.app, reader, p).await;
    }
    for feature in [
        FeatureKey::Patients,
        FeatureKey::Referrals,
        FeatureKey::Encounters,
    ] {
        grant_test_feature(&f.app, reader, feature).await;
    }
    grant_test_patient_visibility(&f.app, reader, PatientDataVisibility::FullClinical).await;
    grant_test_patient_visibility(&f.app, reader, PatientDataVisibility::Demographics).await;
    let actor = Actor::login(&f.app, &email).await;
    assert!(
        body(call(&f.app, &actor, Method::GET, f.path(r), None).await)
            .await
            .0
            == StatusCode::FORBIDDEN,
        "full visibility alone never supplies ordinary referral relationship"
    );
    must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned')").bind(f.app.state().facility_id()).bind(reader).bind(f.patient).execute(&f.pool).await,"actual ordinary relationship adds");
    let context = ok(call(&f.app, &actor, Method::GET, f.path(r), None).await).await;
    assert!(context["link"]==saved["link"]&&context["can_issue_start_command"]==false&&context["can_resume"]==false,"historical metadata read requires actual EncounterView and ordinary Full purpose while Chronicle entry requires independent documentation read authority");
    let receipt = format!(
        "{}/requests/{}",
        f.path(r),
        input["client_request_id"]
            .as_str()
            .expect("request reference")
    );
    assert!(
        body(call(&f.app, &actor, Method::GET, receipt, None).await)
            .await
            .0
            == StatusCode::NOT_FOUND,
        "another current authorized reader cannot fetch original actor receipt"
    );
    let wrong = Uuid::new_v4();
    let path = format!("/api/v2/patients/{wrong}/referrals/{r}/consultation");
    assert!(
        body(f.request(Method::GET, path, None).await).await.0 == StatusCode::NOT_FOUND,
        "route patient cannot retarget exact referral"
    );
}
#[tokio::test]
async fn consultation_audit_failure_atomically_rolls_back_visit_encounter_link_and_command() {
    let f = F::new().await;
    let r = f.referral().await;
    let visit = f.visit("on_hold", None).await;
    let c = f
        .context(
            r,
            &format!("?mode=new_outpatient&visit_choice=existing_visit&visit_id={visit}"),
        )
        .await;
    let input = f.input(
        &c,
        json!({"mode":"new_outpatient","visit":{"choice":"existing_visit","visit_id":visit}}),
    );
    must(sqlx::query("CREATE FUNCTION synthetic_consult_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='referral.consultation_started' THEN RAISE EXCEPTION 'synthetic_consult_audit_fault'; END IF; RETURN NEW; END $$").execute(&f.pool).await,"isolated fault creates");
    must(sqlx::query("CREATE TRIGGER synthetic_consult_audit_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_consult_audit_fault()").execute(&f.pool).await,"isolated fault installs");
    let (s, v) = body(f.start(r, input).await).await;
    let visit_state: (String, Option<chrono::DateTime<Utc>>) = must(
        sqlx::query_as("SELECT status,consultation_started_at FROM visits WHERE id=$1")
            .bind(visit)
            .fetch_one(&f.pool)
            .await,
        "rolled back visit reads",
    );
    assert!(s==StatusCode::CONFLICT&&v["error"]["code"]=="referral_consultation_write_unconfirmed"&&f.counts().await==(0,0,0,0)&&visit_state==("on_hold".to_owned(),None),"unconfirmed persistence failure never leaves independent queue, encounter, link or receipt effects");
}
#[tokio::test]
async fn current_feature_and_exact_session_revocation_fence_previously_reviewed_start() {
    let f = F::new().await;
    let r = f.referral().await;
    let c = f.context(r, NO_VISIT).await;
    let input = f.input(&c, no_visit());
    must(sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'referrals',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(f.app.state().facility_id()).execute(&f.pool).await,"actual feature entitlement disables");
    let (s, v) = body(f.start(r, input.clone()).await).await;
    assert!(
        s == StatusCode::FORBIDDEN
            && v["error"]["code"] != "referral_consultation_write_unconfirmed"
            && f.counts().await == (0, 0, 0, 0),
        "current feature denial is definite before any partial command"
    );
    must(sqlx::query("UPDATE facility_feature_entitlements SET enabled=true WHERE facility_id=$1 AND feature_key='referrals'").bind(f.app.state().facility_id()).execute(&f.pool).await,"actual feature restores");
    must(sqlx::query("UPDATE refresh_sessions SET revoked_at=clock_timestamp() WHERE facility_id=$1 AND user_id=$2 AND revoked_at IS NULL").bind(f.app.state().facility_id()).bind(f.user).execute(&f.pool).await,"exact actor sessions revoke");
    let (s, _) = body(f.start(r, input).await).await;
    assert!(
        matches!(s, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
            && f.counts().await == (0, 0, 0, 0),
        "old reviewed source never bypasses actual revoked session"
    );
}
#[tokio::test]
async fn shared_request_reference_never_waits_on_another_referrals_uncommitted_command() {
    let f = F::new().await;
    let first = f.referral().await;
    let second = f.referral().await;
    let mut first_input = f.input(&f.context(first, NO_VISIT).await, no_visit());
    let mut second_input = f.input(&f.context(second, NO_VISIT).await, no_visit());
    let key = Uuid::new_v4();
    first_input["client_request_id"] = json!(key);
    second_input["client_request_id"] = json!(key);
    let mut gate = must(f.pool.begin().await, "controlled audit gate begins");
    let gate_pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "controlled gate identity reads",
    );
    must(
        sqlx::query("SELECT pg_advisory_xact_lock(619,26019)")
            .execute(&mut *gate)
            .await,
        "controlled audit gate holds",
    );
    let function=format!("CREATE FUNCTION synthetic_consultation_uuid_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='referral.consultation_started' AND NEW.resource_id='{first}'::uuid THEN PERFORM pg_advisory_xact_lock(619,26019); END IF; RETURN NEW; END $$");
    must(
        sqlx::query(&function).execute(&f.pool).await,
        "controlled first audit wait function creates",
    );
    must(sqlx::query("CREATE TRIGGER synthetic_consultation_uuid_gate BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_consultation_uuid_gate()").execute(&f.pool).await,"controlled first audit wait trigger creates");
    let app = f.app.clone();
    let actor = f.actor.clone();
    let path = format!("{}/start", f.path(first));
    let first_call =
        tokio::spawn(
            async move { call(&app, &actor, Method::POST, path, Some(first_input)).await },
        );
    let mut first_wait = false;
    for _ in 0..200 {
        first_wait=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event='advisory')").bind(gate_pid).fetch_one(&f.pool).await,"actual audit wait fact reads");
        if first_wait {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let app = f.app.clone();
    let actor = f.actor.clone();
    let path = format!("{}/start", f.path(second));
    let mut second_call =
        tokio::spawn(
            async move { call(&app, &actor, Method::POST, path, Some(second_input)).await },
        );
    let early = tokio::time::timeout(std::time::Duration::from_millis(400), &mut second_call).await;
    let (bounded, early_result) = match early {
        Ok(v) => (true, Some(must(v, "bounded second route joins"))),
        Err(_) => (false, None),
    };
    let index_wait:bool=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query ILIKE '%INSERT INTO referral_consultation_start_commands%' AND cardinality(pg_blocking_pids(pid))>0)").fetch_one(&f.pool).await,"actual unique command wait fact reads");
    must(
        gate.rollback().await,
        "controlled audit gate releases before assertions",
    );
    let first_result = body(must(first_call.await, "first real route joins")).await;
    let second_result = body(match early_result {
        Some(v) => v,
        None => must(second_call.await, "released second real route joins"),
    })
    .await;
    eprintln!("consultation_shared_uuid first_wait={first_wait} bounded_second={bounded} actual_unique_index_wait={index_wait} final_statuses={:?}",[first_result.0.as_u16(),second_result.0.as_u16()]);
    assert!(first_wait&&first_result.0==StatusCode::OK&&bounded&&!index_wait&&second_result.0==StatusCode::CONFLICT&&second_result.1["error"]["code"]=="referral_consultation_busy"&&f.counts().await==(1,1,1,1),"same UUID across distinct referrals refuses promptly before unique index waiting and preserves one original result");
}
#[tokio::test]
async fn actual_start_actor_link_opens_its_exact_chronicle_without_fabricating_patient_context() {
    let f = F::new().await;
    let r = f.referral().await;
    must(
        sqlx::query(
            "DELETE FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2 AND user_id=$3",
        )
        .bind(f.app.state().facility_id())
        .bind(f.patient)
        .bind(f.user)
        .execute(&f.pool)
        .await,
        "independent generic relationship removes",
    );
    let path = format!("/api/v2/patients/{}/chronicle", f.patient);
    let before = body(f.request(Method::GET, path.clone(), None).await)
        .await
        .0;
    let c = f.context(r, NO_VISIT).await;
    let saved = ok(f.start(r, f.input(&c, no_visit())).await).await;
    // Close the operational referral without inventing a clinical response.
    // Historical access must follow the immutable actual start actor edge.
    must(sqlx::query("UPDATE referrals SET status='cancelled',updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(f.app.state().facility_id()).bind(r).execute(&f.pool).await,"isolated operational referral closes");
    let after = body(f.request(Method::GET, path, None).await).await;
    let invented:i64=must(sqlx::query_scalar("SELECT count(*) FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2 AND user_id=$3").bind(f.app.state().facility_id()).bind(f.patient).bind(f.user).fetch_one(&f.pool).await,"context facts count reads");
    let actual_link = after.1["data"]["encounters"]
        .as_array()
        .is_some_and(|rows| {
            rows.iter()
                .any(|e| e["id"] == saved["link"]["encounter_id"])
        });
    eprintln!("consultation_actor_link_handoff statuses={:?} invented_contexts={invented} exact_encounter_visible={actual_link}",[before.as_u16(),after.0.as_u16()]);
    assert!(before==StatusCode::OK&&after.0==StatusCode::OK&&invented==0&&actual_link,"actual immutable consultation author relationship supports exact reachable Chronicle handoff while unrelated generic contexts remain absent");
}
#[tokio::test]
async fn repository_command_completes_all_deferred_original_evidence_guards() {
    let f = F::new().await;
    let r = f.referral().await;
    let context = f.context(r, NO_VISIT).await;
    let input: hms_domain::referral_consultations::ReferralConsultationStartRequest = must(
        serde_json::from_value(f.input(&context, no_visit())),
        "actual reviewed typed input decodes",
    );
    let bearer = f.actor.bearer();
    let claims = access_claims(bearer.strip_prefix("Bearer ").expect("actual test bearer"));
    let version: i64 = must(
        sqlx::query_scalar("SELECT version FROM facility_network_policies WHERE facility_id=$1")
            .bind(f.app.state().facility_id())
            .fetch_one(&f.pool)
            .await,
        "actual synthetic connection policy version reads",
    );
    let actor = hms_db::referral_consultations::ConsultationActor {
        facility_id: claims.facility_id,
        user_id: claims.sub,
        request_id: None,
        authorization: hms_db::clinical::prescription_courses::PrescriptionAuthorization {
            session_id: claims.session_id,
            session_version: claims.session_version,
            permission_version: claims.permission_version,
            active_profile: must(
                hms_db::codec::decode(&claims.active_profile),
                "actual active profile decodes",
            ),
            valid_until: chrono::DateTime::<Utc>::from_timestamp(claims.exp as i64, 0)
                .expect("actual credential deadline"),
            resolved_network_policy_version: Some(version),
        },
    };
    let out = hms_db::referral_consultations::start(&f.pool, actor, f.patient, r, input).await;
    if let Err(error) = &out {
        if let Some(database) = error
            .downcast_ref::<sqlx::Error>()
            .and_then(|e| e.as_database_error())
        {
            let code = database.code().map(|v| v.into_owned()).unwrap_or_default();
            let category = if database.message().starts_with("operator does not exist") {
                "operator_resolution"
            } else if database.message().starts_with("function ") {
                "function_resolution"
            } else if database.message().starts_with("record ") {
                "record_shape"
            } else if database.message().starts_with("column ") {
                "column_resolution"
            } else if database.message().starts_with("invalid input syntax") {
                "input_cast"
            } else {
                "other_static_guard"
            };
            eprintln!("consultation_database_code={code} category={category}");
        }
        let label = error
            .downcast_ref::<sqlx::Error>()
            .and_then(|e| e.as_database_error())
            .map(|e| match e.message() {
                "referral_consultation_source_invalid" => "source_invalid",
                "referral_consultation_outpatient_invalid" => "outpatient_invalid",
                "referral_consultation_detail_invalid" => "detail_invalid",
                "referral_consultation_appointment_evidence_invalid" => {
                    "appointment_evidence_invalid"
                }
                "referral_consultation_start_incomplete" => "start_incomplete",
                "referral_consultation_command_incomplete" => "command_incomplete",
                _ => "other_database_error",
            })
            .unwrap_or("non_database_error");
        eprintln!("consultation_deferred_guard_outcome={label}");
    }
    assert!(
        out.is_ok() && f.counts().await == (1, 1, 1, 1),
        "production repository command commits all original-evidence deferred guards atomically"
    );
}
#[tokio::test]
async fn clinical_visit_start_needs_encounter_authority_without_front_desk_booking_management() {
    let mut f = F::new().await;
    let referral = f.referral().await;
    let canonical_visit = f.visit("waiting", None).await;
    let selected = f.visit("waiting", None).await;
    for sql in ["DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='appointment.manage'","DELETE FROM permission_assignments WHERE grantee_user_id=$1 AND permission_code='appointment.manage'","DELETE FROM delegations WHERE delegate_user_id=$1 AND permission_code='appointment.manage'","DELETE FROM user_features WHERE user_id=$1 AND feature_key='appointments'"]{must(sqlx::query(sql).bind(f.user).execute(&f.pool).await,"isolated front desk capability removes");}
    must(sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'appointments',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(f.app.state().facility_id()).execute(&f.pool).await,"isolated booking feature disables");
    must(sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE facility_id=$1 AND id=$2").bind(f.app.state().facility_id()).bind(f.user).execute(&f.pool).await,"current clinical authority republishes");
    f.actor = Actor::login(&f.app, "owner@hms.local").await;
    let canonical = body(
        f.request(
            Method::POST,
            format!("/api/v2/visits/{canonical_visit}/start-consultation"),
            Some(json!({})),
        )
        .await,
    )
    .await;
    let c = f
        .context(
            referral,
            &format!("?mode=new_outpatient&visit_choice=existing_visit&visit_id={selected}"),
        )
        .await;
    let started=body(f.start(referral,f.input(&c,json!({"mode":"new_outpatient","visit":{"choice":"existing_visit","visit_id":selected}}))).await).await;
    let status: String = must(
        sqlx::query_scalar("SELECT status FROM visits WHERE facility_id=$1 AND id=$2")
            .bind(f.app.state().facility_id())
            .bind(selected)
            .fetch_one(&f.pool)
            .await,
        "exact selected visit state reads",
    );
    eprintln!("consultation_clinical_visit_authority canonical_status={} quoted_start={} governed_status={} selected_promoted={}",canonical.0.as_u16(),c["can_start"]==true,started.0.as_u16(),status=="in_consultation");
    assert!(canonical.0==StatusCode::OK&&c["can_issue_start_command"]==true&&c["can_start"]==true&&started.0==StatusCode::OK&&status=="in_consultation"&&f.counts().await==(1,1,1,1),"actual encounter and referral authority starts an explicitly reviewed clinical visit without unrelated appointment management or booking entitlement");
}
#[tokio::test]
async fn resume_capability_matches_the_exact_reachable_chronicle_purpose_after_record_changes() {
    let f = F::new().await;
    let referral = f.referral().await;
    let c = f.context(referral, NO_VISIT).await;
    ok(f.start(referral, f.input(&c, no_visit())).await).await;
    use argon2::{Argon2, PasswordHasher};
    let salt = password_hash::SaltString::generate(&mut rand_core::OsRng);
    let password = must(
        Argon2::default().hash_password(b"ChangeMe123!", &salt),
        "synthetic contextual reader password hashes",
    )
    .to_string();
    let reader = Uuid::new_v4();
    let email = format!("synthetic-doc-reader-{}@hms.local", reader.simple());
    must(sqlx::query("INSERT INTO users(id,facility_id,email,display_name,password_hash) VALUES($1,$2,$3,'Synthetic contextual reader',$4)").bind(reader).bind(f.app.state().facility_id()).bind(&email).bind(password).execute(&f.pool).await,"separate synthetic documentation reader creates");
    for p in [
        PermissionCode::EncounterView,
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&f.app, reader, p).await;
    }
    for feature in [
        FeatureKey::Patients,
        FeatureKey::Referrals,
        FeatureKey::Encounters,
    ] {
        grant_test_feature(&f.app, reader, feature).await;
    }
    for visibility in [
        PatientDataVisibility::FullClinical,
        PatientDataVisibility::Demographics,
    ] {
        grant_test_patient_visibility(&f.app, reader, visibility).await;
    }
    must(sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'assigned')").bind(f.app.state().facility_id()).bind(reader).bind(f.patient).execute(&f.pool).await,"real reader ordinary relationship establishes");
    let actor = Actor::login(&f.app, &email).await;
    let mut observed = Vec::new();
    for (record, vital) in [
        ("registered", "presumed_alive"),
        ("restricted", "presumed_alive"),
        ("registered", "deceased"),
    ] {
        ok(f.request(Method::PATCH,format!("/api/v2/patients/{}",f.patient),Some(json!({"record_status":record,"vital_status":vital,"status_reason_code":"synthetic_reviewed_record_change"}))).await).await;
        let metadata = ok(call(&f.app, &actor, Method::GET, f.path(referral), None).await).await;
        let chart = body(
            call(
                &f.app,
                &actor,
                Method::GET,
                format!("/api/v2/patients/{}/chronicle", f.patient),
                None,
            )
            .await,
        )
        .await
        .0;
        let author = f.context(referral, "").await;
        let author_chart = body(
            f.request(
                Method::GET,
                format!("/api/v2/patients/{}/chronicle", f.patient),
                None,
            )
            .await,
        )
        .await
        .0;
        observed.push((
            metadata["can_resume"] == true,
            chart.as_u16(),
            author["can_resume"] == true,
            author_chart.as_u16(),
        ));
    }
    eprintln!("consultation_reachable_resume_purpose={observed:?}");
    assert!(observed==[(true,200,true,200),(false,403,true,200),(false,403,true,200)],"metadata ordinary read does not overpromise a restricted or deceased chart to another contextual reader, while the immutable original start actor retains the exact historical purpose");
}

#[tokio::test]
async fn bounded_patient_confirmation_is_current_and_identity_changes_invalidate_review() {
    let f = F::new().await;
    let referral = f.referral().await;
    let before = f.context(referral, NO_VISIT).await;
    let identity: (String, String, String) = must(
        sqlx::query_as(
            "SELECT first_name,last_name,patient_code FROM patients WHERE facility_id=$1 AND id=$2",
        )
        .bind(f.app.state().facility_id())
        .bind(f.patient)
        .fetch_one(&f.pool)
        .await,
        "actual synthetic patient identity reads",
    );
    assert!(
        before["patient"]["id"] == f.patient.to_string()
            && before["patient"]["display_name"] == format!("{} {}", identity.0, identity.1)
            && before["patient"]["patient_code"] == identity.2
            && before["patient"].as_object().is_some_and(|v| v.len() == 3),
        "protected confirmation contains exactly the actual bounded current patient identity"
    );
    let stale = f.input(&before, no_visit());
    ok(f.request(
        Method::PATCH,
        format!("/api/v2/patients/{}", f.patient),
        Some(json!({"first_name":"SyntheticCorrected","last_name":"ConsultationReviewed"})),
    )
    .await)
    .await;
    let refused = body(f.start(referral, stale).await).await;
    assert!(refused.0==StatusCode::CONFLICT && refused.1["error"]["code"]=="referral_consultation_source_changed" && f.counts().await==(0,0,0,0),
        "a real identity correction invalidates the earlier confirmation without consultation effects");
    let current = f.context(referral, NO_VISIT).await;
    assert!(
        current["patient"]["display_name"] == "SyntheticCorrected ConsultationReviewed"
            && current["patient"]["patient_code"] == before["patient"]["patient_code"]
            && current["context_token"] != before["context_token"],
        "fresh confirmation carries the actual corrected identity"
    );
    let receipt = ok(f.start(referral, f.input(&current, no_visit())).await).await;
    let persisted:bool=must(sqlx::query_scalar("SELECT s.detail::text LIKE '%' || $3 || '%' OR c.receipt::text LIKE '%' || $3 || '%' OR s.detail::text LIKE '%' || $4 || '%' OR c.receipt::text LIKE '%' || $4 || '%' FROM referral_consultation_starts s JOIN referral_consultation_start_commands c ON c.result_id=s.id AND c.facility_id=s.facility_id WHERE s.facility_id=$1 AND s.referral_id=$2").bind(f.app.state().facility_id()).bind(referral).bind("SyntheticCorrected").bind(&identity.2).fetch_one(&f.pool).await,"identity persistence presence reads without emitting data");
    assert!(!persisted && receipt.get("patient").is_none() && receipt["link"].get("patient").is_none(),
        "current confirmation identity is absent from immutable start and command receipt persistence");
}
