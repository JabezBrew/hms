//! Actual Chronicle reachability from exact referral relationships. No global
//! patient-access or intake authority is manufactured by these read tests.
mod support;
use support::*;

fn must<T, E>(v: Result<T, E>, stage: &'static str) -> T {
    v.unwrap_or_else(|_| panic!("{stage}"))
}
struct Outcome {
    status: StatusCode,
    value: Value,
}
struct F {
    app: TestApp,
    pool: hms_db::PgPool,
    owner: Actor,
    other: Actor,
    user: Uuid,
}
impl F {
    async fn new() -> Self {
        let app = app().await;
        let pool = app.db_pool().await;
        let user = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        let other_user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
        for id in [user, other_user] {
            for p in [
                PermissionCode::PatientDemographicsView,
                PermissionCode::EncounterView,
                PermissionCode::ClinicalDocumentationView,
                PermissionCode::ReferralManage,
                PermissionCode::PatientCreate,
                PermissionCode::PatientUpdate,
            ] {
                grant_test_permission(&app, id, p).await;
            }
            for f in [
                FeatureKey::Patients,
                FeatureKey::Referrals,
                FeatureKey::Encounters,
            ] {
                grant_test_feature(&app, id, f).await;
            }
            grant_test_patient_visibility(&app, id, PatientDataVisibility::FullClinical).await;
            grant_test_patient_visibility(&app, id, PatientDataVisibility::Demographics).await;
        }
        let owner = Actor::login(&app, "owner@hms.local").await;
        let other = Actor::login(&app, "limited@hms.local").await;
        Self {
            app,
            pool,
            owner,
            other,
            user,
        }
    }
    async fn for_consultation(documentation: bool) -> Self {
        let mut f = Self::new().await;
        grant_test_permission(&f.app, f.user, PermissionCode::EncounterManage).await;
        if documentation {
            grant_test_permission(&f.app, f.user, PermissionCode::ClinicalDocumentationManage)
                .await;
        } else {
            for sql in [
                "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.manage'",
                "DELETE FROM permission_assignments WHERE grantee_user_id=$1 AND permission_code='clinical_documentation.manage'",
                "DELETE FROM delegations WHERE delegate_user_id=$1 AND permission_code='clinical_documentation.manage'",
            ] {
                must(sqlx::query(sql).bind(f.user).execute(&f.pool).await,
                    "only isolated synthetic actor documentation management authority removes");
            }
        }
        let facility = f.app.state().facility_id();
        let staff:Uuid=must(sqlx::query_scalar("INSERT INTO staff_profiles(id,facility_id,user_id,employee_id,department,position,hire_date) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic','Synthetic','2000-01-01') ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id").bind(facility).bind(f.user).bind(format!("SYN-HANDOFF-{}",Uuid::new_v4().simple())).fetch_one(&f.pool).await,"actual synthetic staff profile establishes");
        must(sqlx::query("INSERT INTO practitioner_profiles(id,facility_id,staff_id,license_number,specialization,qualification) VALUES(gen_random_uuid(),$1,$2,$3,'Synthetic','Synthetic') ON CONFLICT(staff_id) DO NOTHING").bind(facility).bind(staff).bind(format!("SYN-HANDOFF-{}",Uuid::new_v4().simple())).execute(&f.pool).await,"actual local practitioner profile establishes");
        f.owner = Actor::login(&f.app, "owner@hms.local").await;
        f
    }
    async fn start(&self, patient: Uuid, referral: Uuid) -> Uuid {
        let path = format!("/api/v2/patients/{patient}/referrals/{referral}/consultation");
        let context = self
            .good(
                &self.owner,
                Method::GET,
                format!("{path}?mode=new_outpatient&visit_choice=no_visit"),
                None,
            )
            .await;
        let receipt = self.good(&self.owner,Method::POST,format!("{path}/start"),
            Some(json!({"client_request_id":Uuid::new_v4(),"expected_link_version":0,"expected_context_token":context["context_token"],"source":{"mode":"new_outpatient","visit":{"choice":"no_visit"}},"restricted_record_override":null}))).await;
        must(
            Uuid::parse_str(receipt["link"]["encounter_id"].as_str().unwrap_or("")),
            "actual committed consultation encounter identity reads",
        )
    }
    async fn call(
        &self,
        actor: &Actor,
        method: Method,
        path: String,
        input: Option<Value>,
    ) -> Outcome {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(AUTHORIZATION, actor.bearer());
        let body = if let Some(input) = input {
            request = request.header("content-type", "application/json");
            Body::from(must(
                serde_json::to_vec(&input),
                "synthetic access request encodes",
            ))
        } else {
            Body::empty()
        };
        let response = must(
            self.app
                .clone()
                .oneshot(must(request.body(body), "synthetic access request builds"))
                .await,
            "actual access route responds",
        );
        let status = response.status();
        let bytes = must(
            to_bytes(response.into_body(), 2 * 1024 * 1024).await,
            "bounded access response reads",
        );
        Outcome {
            status,
            value: must(serde_json::from_slice(&bytes), "access envelope decodes"),
        }
    }
    async fn good(
        &self,
        actor: &Actor,
        method: Method,
        path: String,
        input: Option<Value>,
    ) -> Value {
        let out = self.call(actor, method, path, input).await;
        assert!(
            out.status == StatusCode::OK,
            "synthetic setup or protected read succeeds, status={}",
            out.status.as_u16()
        );
        out.value["data"].clone()
    }
    async fn patient(&self) -> Uuid {
        let suffix = Uuid::new_v4().simple().to_string();
        let p=self.good(&self.owner,Method::POST,"/api/v2/patients".into(),Some(json!({"first_name":format!("Synthetic{}",&suffix[..16]),"last_name":format!("Access{}",&suffix[16..]),"date_of_birth":"1990-01-01","sex":"other"}))).await;
        let id = must(
            Uuid::parse_str(p["id"].as_str().unwrap_or("")),
            "actual synthetic patient identity reads",
        );
        must(
            sqlx::query("DELETE FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2")
                .bind(self.app.state().facility_id())
                .bind(id)
                .execute(&self.pool)
                .await,
            "only this fresh synthetic identity's administrative contexts clear",
        );
        id
    }
    async fn referral(&self, patient: Uuid, owner_creates: bool, owner_accepts: bool) -> Uuid {
        let creator = if owner_creates {
            &self.owner
        } else {
            &self.other
        };
        let accepter = if owner_accepts {
            &self.owner
        } else {
            &self.other
        };
        let r=self.good(creator,Method::POST,"/api/v2/referrals".into(),Some(json!({"patient_id":patient,"to_service":"Synthetic protected handoff","priority":"routine"}))).await;
        let id = must(
            Uuid::parse_str(r["id"].as_str().unwrap_or("")),
            "actual synthetic referral identity reads",
        );
        self.good(
            accepter,
            Method::POST,
            format!("/api/v2/referrals/{id}/accept"),
            Some(json!({"acceptance_notes":"Synthetic explicit acceptance"})),
        )
        .await;
        id
    }
    async fn chronicle(&self, patient: Uuid) -> Outcome {
        self.call(
            &self.owner,
            Method::GET,
            format!("/api/v2/patients/{patient}/chronicle?limit=1"),
            None,
        )
        .await
    }
    async fn global_relationship(&self, patient: Uuid) -> bool {
        must(
            hms_db::auth::clinical_patient_access_evidence(
                &self.pool,
                self.app.state().facility_id(),
                self.user,
                patient,
                Utc::now(),
            )
            .await,
            "unchanged global access evidence reads",
        )
        .workflow_reason
        .is_some()
    }
}

#[tokio::test]
async fn registered_referral_creator_and_acceptor_can_reach_chronicle_without_invented_contexts() {
    let f = F::new().await;
    let mut controls = Vec::new();
    for creator in [true, false] {
        let patient = f.patient().await;
        let referral = f.referral(patient, creator, !creator).await;
        let protected = f
            .call(
                &f.owner,
                Method::GET,
                format!("/api/v2/patients/{patient}/referrals/{referral}/consultation"),
                None,
            )
            .await;
        let chart = f.chronicle(patient).await;
        let facts:(bool,bool,i64,i64)=must(sqlx::query_as("SELECT r.created_by_user_id=$3,r.accepted_by_user_id=$3,(SELECT count(*) FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2 AND user_id=$3),(SELECT count(*) FROM clinical_notes WHERE facility_id=$1 AND patient_id=$2 AND created_by_user_id=$3) FROM referrals r WHERE r.facility_id=$1 AND r.patient_id=$2 AND r.id=$4")
            .bind(f.app.state().facility_id()).bind(patient).bind(f.user).bind(referral).fetch_one(&f.pool).await,"actual independent referral relationship and no invented-context facts read");
        controls.push((
            creator,
            protected.status.as_u16(),
            chart.status.as_u16(),
            facts,
            f.global_relationship(patient).await,
        ));
    }
    eprintln!("referral_chronicle_creator_protected_chart_exact_context_note_global={controls:?}");
    assert!(controls.iter().all(|(creator,protected,chart,facts,global)| *protected==200 && *chart==200 && *facts==(*creator,!*creator,0,0) && !*global),
        "actual exact creating and accepting actors can reach the registered patient Chronicle under current full clinical read authority, without changing global access evidence or manufacturing assignment/note rows");
}

#[tokio::test]
async fn referral_chronicle_fallback_requires_current_full_documentation_and_referrals_feature() {
    for denial in ["full", "documentation", "referrals_feature"] {
        let f = F::new().await;
        let patient = f.patient().await;
        f.referral(patient, true, false).await;
        assert!(
            f.chronicle(patient).await.status == StatusCode::OK,
            "positive actual relationship control succeeds before one current authority is removed"
        );
        match denial {
            "full" => {
                must(sqlx::query("DELETE FROM user_patient_visibility WHERE user_id=$1 AND visibility='full_clinical'").bind(f.user).execute(&f.pool).await,"actual full data-class authority removes");
            }
            "documentation" => {
                must(sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.view'").bind(f.user).execute(&f.pool).await,"actual documentation read authority removes");
            }
            _ => {
                must(sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled) VALUES($1,'referrals',false) ON CONFLICT(facility_id,feature_key) DO UPDATE SET enabled=false").bind(f.app.state().facility_id()).execute(&f.pool).await,"actual deployed referral feature disables");
            }
        }
        // Retain the original authenticated session: the repository must prove
        // current facts even if its earlier request context was cached.
        let denied = f.chronicle(patient).await;
        assert!(denied.status==StatusCode::FORBIDDEN && !f.global_relationship(patient).await,
            "a known relationship cannot substitute for current full, documentation or deployed-feature authority");
    }
}

#[tokio::test]
async fn full_clinical_outsider_and_foreign_facility_subject_remain_denied() {
    let f = F::new().await;
    let patient = f.patient().await;
    f.referral(patient, false, false).await;
    let outside = f.chronicle(patient).await;
    assert!(
        outside.status == StatusCode::FORBIDDEN && !f.global_relationship(patient).await,
        "full clinical visibility and a privileged role do not manufacture a referral relationship"
    );
    let facility = Uuid::new_v4();
    let foreign = Uuid::new_v4();
    must(sqlx::query("INSERT INTO facilities(id,code,name,deployment_profile) VALUES($1,$2,'Synthetic foreign access facility','hospital')")
        .bind(facility).bind(format!("SYN-ACCESS-{}",facility.simple())).execute(&f.pool).await,"isolated foreign facility inserts");
    must(sqlx::query("INSERT INTO patients(id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status,record_status,vital_status) VALUES($1,$2,$3,'Synthetic','Foreign','1990-01-01','other','active','registered','presumed_alive')")
        .bind(foreign).bind(facility).bind(format!("SYN-ACCESS-{}",foreign.simple())).execute(&f.pool).await,"actual foreign-facility synthetic subject inserts");
    let foreign_read = f.chronicle(foreign).await;
    assert!(
        foreign_read.status == StatusCode::NOT_FOUND && foreign_read.value["data"].is_null(),
        "same token cannot read a real foreign-facility subject through the new fallback"
    );
}

#[tokio::test]
async fn restricted_preparation_does_not_turn_an_intake_override_into_global_chart_access() {
    let f = F::new().await;
    let patient = f.patient().await;
    let referral = f.referral(patient, true, false).await;
    f.good(
        &f.owner,
        Method::PATCH,
        format!("/api/v2/patients/{patient}"),
        Some(json!({"record_status":"restricted","status_reason_code":"synthetic_review"})),
    )
    .await;
    let context=f.good(&f.owner,Method::GET,format!("/api/v2/patients/{patient}/referrals/{referral}/consultation?mode=new_outpatient&visit_choice=no_visit"),None).await;
    let chart = f.chronicle(patient).await;
    assert!(context["selection"]["restricted_override_required"]==true && context["can_override_restricted_record"]==true
        && chart.status==StatusCode::FORBIDDEN && !f.global_relationship(patient).await,
        "the exact bounded consultation preparation purpose may review an intake override while the broader restricted chart remains denied before an actual saved start");
}

#[tokio::test]
async fn actual_referral_start_handoff_records_exact_note_only_with_independent_documentation_manage(
) {
    let mut controls = Vec::new();
    for documentation in [false, true] {
        let f = F::for_consultation(documentation).await;
        let patient = f.patient().await;
        let referral = f.referral(patient, true, false).await;
        let encounter = f.start(patient, referral).await;
        let chart = f.chronicle(patient).await;
        let context = f
            .good(
                &f.owner,
                Method::GET,
                format!("/api/v2/patients/{patient}/referrals/{referral}/consultation"),
                None,
            )
            .await;
        let before:(i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2 AND user_id=$3),(SELECT count(*) FROM clinical_notes WHERE facility_id=$1 AND patient_id=$2 AND created_by_user_id=$3)").bind(f.app.state().facility_id()).bind(patient).bind(f.user).fetch_one(&f.pool).await,"actual no-context no-note handoff facts read");
        let command = Uuid::new_v4();
        let saved = f.call(&f.owner,Method::POST,
            format!("/api/v2/patients/{patient}/clinical/notes/record"),
            Some(json!({"client_request_id":command,"encounter_id":encounter,"template_revision_id":null,"note_type":"doctor_note","title":"Synthetic exact handoff note","body":"Synthetic clinical handoff body"}))).await;
        let after:(i64,i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2 AND user_id=$3),(SELECT count(*) FROM clinical_notes WHERE facility_id=$1 AND patient_id=$2 AND created_by_user_id=$3 AND encounter_id=$4),(SELECT count(*) FROM clinical_note_commands WHERE facility_id=$1 AND patient_id=$2)").bind(f.app.state().facility_id()).bind(patient).bind(f.user).bind(encounter).fetch_one(&f.pool).await,"exact note and no fabricated-context effects read");
        let exact =
            !documentation || saved.value["data"]["note"]["encounter_id"] == json!(encounter);
        controls.push((
            documentation,
            chart.status.as_u16(),
            context["can_resume"] == true,
            chart.value["data"]["permissions"]["can_add_note"] == true,
            before,
            saved.status.as_u16(),
            after,
            exact,
        ));
    }
    eprintln!("referral_chronicle_note_handoff_controls={controls:?}");
    assert!(controls.iter().all(|(manage,chart,resume,advertised,before,saved,after,exact)|
        *chart==200 && *resume && *advertised==*manage && *before==(0,0)
        && *saved==if *manage {200}else{403}
        && *after==if *manage {(0,1,1)}else{(0,0,0)} && *exact),
        "actual saved referral handoff supports exact linked encounter documentation under independently granted management, while read authority and start alone produce no note or command effects");
}

#[tokio::test]
async fn original_saved_start_actor_retains_historical_read_after_terminal_and_patient_status_changes(
) {
    let f = F::for_consultation(false).await;
    let patient = f.patient().await;
    let referral = f.referral(patient, true, false).await;
    let encounter = f.start(patient, referral).await;
    must(sqlx::query("UPDATE referrals SET status='cancelled',updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(f.app.state().facility_id()).bind(referral).execute(&f.pool).await,"isolated operational referral closes without inventing a clinical response");
    let closed = f
        .call(
            &f.owner,
            Method::POST,
            format!("/api/v2/encounters/{encounter}/complete"),
            None,
        )
        .await;
    assert!(
        closed.status == StatusCode::OK,
        "actual linked encounter terminal command succeeds"
    );
    must(sqlx::query("UPDATE patients SET record_status='restricted',vital_status='deceased',updated_at=clock_timestamp() WHERE facility_id=$1 AND id=$2").bind(f.app.state().facility_id()).bind(patient).execute(&f.pool).await,"isolated later patient state represents historical access without reopening intake");
    let chart = f.chronicle(patient).await;
    let facts:(i64,i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM patient_contexts WHERE facility_id=$1 AND patient_id=$2 AND user_id=$3),(SELECT count(*) FROM clinical_notes WHERE facility_id=$1 AND patient_id=$2 AND created_by_user_id=$3),(SELECT count(*) FROM referral_consultation_starts WHERE facility_id=$1 AND patient_id=$2 AND actor_user_id=$3 AND encounter_id=$4)").bind(f.app.state().facility_id()).bind(patient).bind(f.user).bind(encounter).fetch_one(&f.pool).await,"actual immutable original actor and no invented ordinary edges read");
    let exact = chart.value["data"]["encounters"]
        .as_array()
        .is_some_and(|rows| rows.iter().any(|e| e["id"] == json!(encounter)));
    let global = f.global_relationship(patient).await;
    eprintln!("referral_chronicle_historical_actor status={} exact_visible={exact} context_note_link_counts={facts:?} global={global}",chart.status.as_u16());
    assert!(chart.status==StatusCode::OK && exact && facts==(0,0,1) && !global,
        "actual original start history supplies this narrow retained read purpose after referral/encounter closure and restricted deceased patient state, without reviving intake or changing global patient access evidence");
}

#[tokio::test]
async fn actual_final_audit_wait_cannot_publish_a_start_after_its_retained_session_deadline() {
    let f = F::for_consultation(false).await;
    let patient = f.patient().await;
    let referral = f.referral(patient, true, false).await;
    let path = format!("/api/v2/patients/{patient}/referrals/{referral}/consultation");
    let context = f
        .good(
            &f.owner,
            Method::GET,
            format!("{path}?mode=new_outpatient&visit_choice=no_visit"),
            None,
        )
        .await;
    let input = json!({"client_request_id":Uuid::new_v4(),"expected_link_version":0,"expected_context_token":context["context_token"],"source":{"mode":"new_outpatient","visit":{"choice":"no_visit"}},"restricted_record_override":null});
    let mut gate = must(f.pool.begin().await, "controlled final audit gate begins");
    let pid: i32 = must(
        sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await,
        "controlled final audit gate identity reads",
    );
    must(
        sqlx::query("SELECT pg_advisory_xact_lock(619,26022)")
            .execute(&mut *gate)
            .await,
        "controlled final audit gate holds",
    );
    let function=format!("CREATE FUNCTION synthetic_consultation_final_clock_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='referral.consultation_started' AND NEW.resource_id='{referral}'::uuid THEN PERFORM pg_advisory_xact_lock(619,26022); END IF; RETURN NEW; END $$");
    must(
        sqlx::query(&function).execute(&f.pool).await,
        "isolated final audit wait function creates",
    );
    must(sqlx::query("CREATE TRIGGER synthetic_consultation_final_clock_gate BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_consultation_final_clock_gate()").execute(&f.pool).await,"isolated final audit wait trigger creates");
    must(sqlx::query("UPDATE refresh_sessions SET expires_at=clock_timestamp()+interval '3 seconds' WHERE facility_id=$1 AND user_id=$2 AND revoked_at IS NULL").bind(f.app.state().facility_id()).bind(f.user).execute(&f.pool).await,"actual original session receives a short natural deadline");
    let app = f.app.clone();
    let actor = f.owner.clone();
    let pending = tokio::spawn(async move {
        let request = must(
            Request::builder()
                .method(Method::POST)
                .uri(format!("{path}/start"))
                .header(AUTHORIZATION, actor.bearer())
                .header("content-type", "application/json")
                .body(Body::from(must(
                    serde_json::to_vec(&input),
                    "bounded synthetic deadline command encodes",
                ))),
            "actual final-clock request builds",
        );
        let response = must(
            app.oneshot(request).await,
            "actual final-clock request returns",
        );
        response.status()
    });
    let mut observed = false;
    for _ in 0..200 {
        observed=must(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event='advisory')").bind(pid).fetch_one(&f.pool).await,"actual final audit wait fact reads");
        if observed {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    if observed {
        tokio::time::sleep(std::time::Duration::from_millis(3100)).await;
    }
    must(
        gate.rollback().await,
        "controlled final audit wait releases before assertions",
    );
    let status = must(pending.await, "actual final-clock request joins");
    let counts:(i64,i64,i64,i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM referral_consultation_starts WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM referral_consultation_start_commands WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM encounters WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM visits WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM audit_events WHERE facility_id=$1 AND event_type='referral.consultation_started' AND resource_id=$3)").bind(f.app.state().facility_id()).bind(patient).bind(referral).fetch_one(&f.pool).await,"post-deadline committed effects count reads");
    eprintln!("referral_consultation_final_clock actual_final_audit_wait={observed} status={} committed_link_command_encounter_visit_audit={counts:?}",status.as_u16());
    assert!(observed && status==StatusCode::FORBIDDEN && counts==(0,0,0,0,0),
        "the actual retained session deadline is checked after a real late audit wait, rolling back every prospective start effect");
}

#[tokio::test]
async fn offsite_read_only_context_never_bypasses_the_http_consultation_write_fence() {
    let f = F::for_consultation(false).await;
    let patient = f.patient().await;
    let referral = f.referral(patient, true, false).await;
    let current = must(
        hms_db::network::get_policy(&f.pool, f.app.state().facility_id()).await,
        "actual synthetic network policy loads",
    );
    must(
        hms_db::network::update_policy(
            &f.pool,
            hms_db::network::NetworkPolicyActor {
                facility_id: f.app.state().facility_id(),
                user_id: None,
                request_id: None,
                reauth_deadline: None,
                auth_versions: None,
                session_id: None,
                active_profile: None,
                resolved_policy_version: None,
            },
            hms_domain::network::UpdateNetworkPolicyRequest {
                client_request_id: Uuid::new_v4(),
                expected_version: current.version,
                onsite_cidrs: vec!["127.0.0.1/32".into(), "::1/128".into()],
                offsite_mode: hms_domain::network::NetworkOffsiteMode::Readonly,
                reason: "Synthetic independently reviewed offsite read-only control".into(),
            },
            None,
        )
        .await,
        "actual governed synthetic network policy updates",
    );
    let path = format!("/api/v2/patients/{patient}/referrals/{referral}/consultation");
    let read = must(
        Request::builder()
            .method(Method::GET)
            .uri(format!("{path}?mode=new_outpatient&visit_choice=no_visit"))
            .header(AUTHORIZATION, f.owner.bearer())
            .body(Body::empty()),
        "actual offsite context request builds",
    );
    let mut read = read;
    read.extensions_mut()
        .insert(axum::extract::ConnectInfo(must(
            "192.0.2.23:44000".parse::<std::net::SocketAddr>(),
            "synthetic offsite socket parses",
        )));
    let read = must(
        f.app.clone().oneshot(read).await,
        "actual offsite context request returns",
    );
    let read_status = read.status();
    let context: Value = must(
        serde_json::from_slice(&must(
            to_bytes(read.into_body(), 2 * 1024 * 1024).await,
            "bounded offsite context reads",
        )),
        "offsite context envelope decodes",
    );
    let input = json!({"client_request_id":Uuid::new_v4(),"expected_link_version":0,"expected_context_token":context["data"]["context_token"],"source":{"mode":"new_outpatient","visit":{"choice":"no_visit"}},"restricted_record_override":null});
    let mut write = must(
        Request::builder()
            .method(Method::POST)
            .uri(format!("{path}/start"))
            .header(AUTHORIZATION, f.owner.bearer())
            .header("content-type", "application/json")
            .header("x-hms-offsite", "false")
            .body(Body::from(must(
                serde_json::to_vec(&input),
                "bounded offsite command encodes",
            ))),
        "actual offsite command builds",
    );
    write
        .extensions_mut()
        .insert(axum::extract::ConnectInfo(must(
            "192.0.2.23:44000".parse::<std::net::SocketAddr>(),
            "synthetic offsite socket parses",
        )));
    let write = must(
        f.app.clone().oneshot(write).await,
        "actual offsite command returns",
    );
    let counts:(i64,i64,i64,i64)=must(sqlx::query_as("SELECT (SELECT count(*) FROM referral_consultation_starts WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM referral_consultation_start_commands WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM encounters WHERE facility_id=$1 AND patient_id=$2),(SELECT count(*) FROM visits WHERE facility_id=$1 AND patient_id=$2)").bind(f.app.state().facility_id()).bind(patient).fetch_one(&f.pool).await,"offsite command committed effects read");
    eprintln!("referral_consultation_offsite_read_only context_status={} source_can_start={} write_status={} effects={counts:?}",read_status.as_u16(),context["data"]["can_start"]==true,write.status().as_u16());
    assert!(read_status==StatusCode::OK && write.status()==StatusCode::FORBIDDEN && counts==(0,0,0,0),
        "bounded source eligibility metadata remains readable offsite, while the actual HTTP write fence independently refuses the start despite a spoofed client header");
}
