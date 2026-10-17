//! Actual HTTP contracts for the selected-admission generated-course workflow.
mod support;
use support::*;
struct Fixture {
    app: TestApp,
    token: String,
    patient: Uuid,
    admission: Uuid,
    source: Uuid,
    item: Uuid,
}
async fn call(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    body: Value,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn checked(response: axum::response::Response, expected: StatusCode) -> Value {
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(
        status,
        expected,
        "static error code {}",
        body["error"]["code"].as_str().unwrap_or("none")
    );
    body
}
impl Fixture {
    async fn new() -> Self {
        let app = app().await;
        let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        grant_test_patient_visibility(&app, owner, PatientDataVisibility::FullClinical).await;
        let (token, _, _) = login(app.clone(), "owner@hms.local").await;
        let pool = app.db_pool().await;
        let facility = app.state().facility_id();
        let patient:Uuid=sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 AND record_status='registered' AND vital_status<>'deceased' ORDER BY id LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
        let ward: Uuid = sqlx::query_scalar(
            "SELECT id FROM wards WHERE facility_id=$1 AND status='active' ORDER BY id LIMIT 1",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        let admission = Uuid::new_v4();
        sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
        let(item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled AND item_type='medication' ORDER BY id LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
        let first = Utc::now() + Duration::hours(1);
        let source=checked(call(&app,&token,Method::POST,&format!("/api/v2/patients/{patient}/clinical/prescriptions"),json!({"medication_name":"Synthetic course review","dose":"Reviewed clinical dosage","route":"oral","frequency":"daily","instructions":"SYNTHETIC-COURSE-PRIVATE-INSTRUCTIONS","reason":"SYNTHETIC-COURSE-PRIVATE-INDICATION","inventory_item_id":item,"scheduled_stock_policy":{"expected_stock_unit":unit,"stock_units_per_dose":2},"start_date":first.date_naive(),"first_dose_at":first,"duration_days":10})).await,StatusCode::OK).await;
        let source = Uuid::parse_str(source["data"]["id"].as_str().unwrap()).unwrap();
        Self {
            app,
            token,
            patient,
            admission,
            source,
            item,
        }
    }
    fn base(&self) -> String {
        format!(
            "/api/v2/patients/{}/chronicle/admissions/{}/medication-courses",
            self.patient, self.admission
        )
    }
    async fn get(&self, suffix: &str) -> Value {
        checked(
            call(
                &self.app,
                &self.token,
                Method::GET,
                &format!("{}{}", self.base(), suffix),
                Value::Null,
            )
            .await,
            StatusCode::OK,
        )
        .await
    }
    async fn generate(&self) -> Value {
        checked(
            call(
                &self.app,
                &self.token,
                Method::POST,
                &format!(
                    "/api/v2/clinical/prescriptions/{}/generate-mar",
                    self.source
                ),
                json!({"admission_case_id":self.admission,"days":2}),
            )
            .await,
            StatusCode::OK,
        )
        .await["data"]
            .clone()
    }
    async fn course(&self) -> Uuid {
        let page = self.get("").await;
        assert_eq!(page["data"].as_array().unwrap().len(), 1);
        Uuid::parse_str(page["data"][0]["id"].as_str().unwrap()).unwrap()
    }
    async fn stock(&self) -> i64 {
        sqlx::query_scalar("SELECT COALESCE(SUM(quantity_on_hand),0)::bigint FROM stock_batches WHERE facility_id=$1 AND item_id=$2").bind(self.app.state().facility_id()).bind(self.item).fetch_one(&self.app.db_pool().await).await.unwrap()
    }
}
#[tokio::test]
async fn real_eight_route_course_journey_preserves_original_generation_demand_receipts_and_stock() {
    let f = Fixture::new().await;
    let empty = f.get("/context").await;
    assert_eq!(empty["data"]["generated_course_count"], 0);
    assert_eq!(empty["data"]["coverage"], "generated_courses_only");
    let initial = f.generate().await;
    let course = f.course().await;
    let context = f.get("/context").await;
    assert_eq!(context["data"]["generated_course_count"], 1);
    let detail = f.get(&format!("/{course}")).await;
    assert_eq!(
        detail["data"]["summary"]["admission_case_id"],
        f.admission.to_string()
    );
    assert_eq!(detail["data"]["can_request_schedule_window"], true);
    assert!(detail["data"]["counts"]["days_of_supply"].is_null());
    let list = f.get("").await;
    assert!(list["data"][0].get("source_instructions").is_none());
    assert!(!list.to_string().contains("SYNTHETIC-COURSE-PRIVATE"));
    let doses = f.get(&format!("/{course}/doses?limit=1")).await;
    assert_eq!(doses["data"].as_array().unwrap().len(), 1);
    assert!(
        detail["data"]["counts"]["generated_scheduled_doses"]
            .as_i64()
            .unwrap()
            > 1
    );
    let supply = f.get(&format!("/{course}/supply")).await;
    assert_eq!(supply["data"].as_array().unwrap().len(), 1);
    assert_eq!(supply["data"][0]["id"], initial["pharmacy_fulfillment_id"]);
    let old = detail["data"]["summary"]["scheduled_through"]
        .as_str()
        .unwrap();
    let old = chrono::DateTime::parse_from_rfc3339(old)
        .unwrap()
        .with_timezone(&Utc);
    let end = old + Duration::days(1);
    let key = Uuid::new_v4();
    let stock = f.stock().await;
    let input = json!({"client_request_id":key,"expected_source_token":detail["data"]["source_token"],"expected_course_token":detail["data"]["course_token"],"expected_context_token":detail["data"]["context_token"],"expected_scheduled_through":old,"scheduled_before":end,"note":"Synthetic explicit next scheduled window"});
    let saved = checked(
        call(
            &f.app,
            &f.token,
            Method::POST,
            &format!("{}/{course}/supply-windows", f.base()),
            input.clone(),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(saved["data"]["operation"], "supply_window_created");
    assert_eq!(saved["data"]["client_request_id"], key.to_string());
    assert!(saved["data"]["result"]["fulfillment_id"] != initial["pharmacy_fulfillment_id"]);
    let created = saved["data"]["result"]["created_doses"].as_array().unwrap();
    assert!(!created.is_empty() && created.len() <= 512);
    assert_eq!(
        saved["data"]["result"]["created_dose_count"],
        created.len() as i64
    );
    for dose in created {
        let at =
            chrono::DateTime::parse_from_rfc3339(dose["scheduled_at"].as_str().unwrap()).unwrap();
        assert!(at >= old && at < end);
        assert_eq!(dose["scheduled_stock_policy"]["stock_units_per_dose"], 2);
    }
    assert_eq!(
        f.stock().await,
        stock,
        "queuing dose demand never issues physical stock"
    );
    let initial_replay = f.generate().await;
    assert!(
        initial_replay["pharmacy_fulfillment_id"] == initial["pharmacy_fulfillment_id"],
        "initial replay retains its original fulfillment"
    );
    let recovered = f.get(&format!("/{course}/requests/{key}")).await;
    assert!(
        recovered["data"]["result"] == saved["data"]["result"],
        "immutable original window evidence is recovered"
    );
    let replay = checked(
        call(
            &f.app,
            &f.token,
            Method::POST,
            &format!("{}/{course}/supply-windows", f.base()),
            input.clone(),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(replay["data"]["replayed"], true);
    assert!(replay["data"]["result"] == saved["data"]["result"]);
    let mut changed = input;
    changed["note"] = json!("Different synthetic intent");
    let conflict = checked(
        call(
            &f.app,
            &f.token,
            Method::POST,
            &format!("{}/{course}/supply-windows", f.base()),
            changed,
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        conflict["error"]["code"],
        "treatment_course_request_conflict"
    );
    let current = f.get(&format!("/{course}")).await;
    let stop_key = Uuid::new_v4();
    let stop = json!({"client_request_id":stop_key,"expected_source_token":current["data"]["source_token"],"expected_course_token":current["data"]["course_token"],"expected_context_token":current["data"]["context_token"],"reason":"Synthetic admission-local retirement"});
    let stopped = checked(
        call(
            &f.app,
            &f.token,
            Method::POST,
            &format!("{}/{course}/stop", f.base()),
            stop,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(stopped["data"]["operation"], "stopped");
    assert!(
        stopped["data"]["result"]["retired_pending_dose_count"]
            .as_i64()
            .unwrap()
            > 0
    );
    let source = checked(
        call(
            &f.app,
            &f.token,
            Method::GET,
            &format!("/api/v2/clinical/prescriptions/{}", f.source),
            Value::Null,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(source["data"]["status"], "active");
    assert_eq!(f.stock().await, stock);
    let membership = f
        .get(&format!("/{course}/doses?request_id={stop_key}&limit=100"))
        .await;
    assert!(!membership["data"].as_array().unwrap().is_empty());
    assert!(membership["data"]
        .as_array()
        .unwrap()
        .iter()
        .all(|d| d["original_request_membership"].is_object()));
    let original_window = f.get(&format!("/{course}/requests/{key}")).await;
    assert!(
        original_window["data"]["result"] == saved["data"]["result"],
        "later retirement cannot rewrite original queued membership"
    );
}
#[tokio::test]
async fn course_http_contract_bounds_pages_and_rejects_unknown_fields_and_bad_scope_without_changes(
) {
    let f = Fixture::new().await;
    f.generate().await;
    let course = f.course().await;
    let detail = f.get(&format!("/{course}")).await;
    let before = f.stock().await;
    for (requested, bounded) in [(0, 1), (101, 100)] {
        let page = f.get(&format!("?limit={requested}")).await;
        assert_eq!(page["page"]["limit"], bounded);
        assert!(page["data"].as_array().unwrap().len() <= bounded as usize);
    }
    for suffix in ["?status=unrecognized-status", "/context?ignored=true"] {
        checked(
            call(
                &f.app,
                &f.token,
                Method::GET,
                &format!("{}{suffix}", f.base()),
                Value::Null,
            )
            .await,
            StatusCode::BAD_REQUEST,
        )
        .await;
    }
    let input = json!({"client_request_id":Uuid::new_v4(),"expected_source_token":detail["data"]["source_token"],"expected_course_token":detail["data"]["course_token"],"expected_context_token":detail["data"]["context_token"],"reason":"SYNTHETIC-PRIVATE-INVALID","ignored":true});
    let refused = checked(
        call(
            &f.app,
            &f.token,
            Method::POST,
            &format!("{}/{course}/stop", f.base()),
            input,
        )
        .await,
        StatusCode::BAD_REQUEST,
    )
    .await;
    assert!(!refused.to_string().contains("SYNTHETIC-PRIVATE"));
    checked(
        call(
            &f.app,
            &f.token,
            Method::GET,
            &format!(
                "/api/v2/patients/{}/chronicle/admissions/{}/medication-courses/{course}",
                f.patient,
                Uuid::new_v4()
            ),
            Value::Null,
        )
        .await,
        StatusCode::NOT_FOUND,
    )
    .await;
    assert_eq!(f.stock().await, before);
    assert_eq!(
        f.get(&format!("/{course}")).await["data"]["summary"]["status"],
        "active"
    );
}
#[tokio::test]
async fn all_rich_course_routes_require_actual_full_access_and_do_not_return_private_regimen_on_denial(
) {
    let f = Fixture::new().await;
    f.generate().await;
    let course = f.course().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for permission in [
        PermissionCode::PatientDemographicsView,
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::WardBoardViewAll,
    ] {
        grant_test_permission(&f.app, user, permission).await;
    }
    for feature in [
        FeatureKey::Patients,
        FeatureKey::Encounters,
        FeatureKey::Nursing,
    ] {
        grant_test_feature(&f.app, user, feature).await;
    }
    grant_test_patient_visibility(&f.app, user, PatientDataVisibility::Demographics).await;
    grant_test_patient_visibility(&f.app, user, PatientDataVisibility::ClinicalSummary).await;
    sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES($1,$2,$3,$4,'recent') ON CONFLICT DO NOTHING").bind(Uuid::new_v4()).bind(f.app.state().facility_id()).bind(user).bind(f.patient).execute(&f.app.db_pool().await).await.unwrap();
    let (limited, _, _) = login(f.app.clone(), "limited@hms.local").await;
    for suffix in [
        "".to_owned(),
        "/context".to_owned(),
        format!("/{course}"),
        format!("/{course}/doses"),
        format!("/{course}/supply"),
        format!("/{course}/requests/{}", Uuid::new_v4()),
    ] {
        let denied = checked(
            call(
                &f.app,
                &limited,
                Method::GET,
                &format!("{}{suffix}", f.base()),
                Value::Null,
            )
            .await,
            StatusCode::FORBIDDEN,
        )
        .await;
        assert!(denied.get("data").is_none() || denied["data"].is_null());
        assert!(!denied.to_string().contains("SYNTHETIC-COURSE-PRIVATE"));
    }

    grant_test_patient_visibility(&f.app, user, PatientDataVisibility::FullClinical).await;
    let (read_only, _, _) = login(f.app.clone(), "limited@hms.local").await;
    let current = checked(
        call(
            &f.app,
            &read_only,
            Method::GET,
            &format!("{}/{course}", f.base()),
            Value::Null,
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        current["data"]["source_instructions"],
        "SYNTHETIC-COURSE-PRIVATE-INSTRUCTIONS"
    );
    assert_eq!(current["data"]["can_stop_course"], false);
    assert_eq!(current["data"]["can_request_schedule_window"], false);
    let denied=checked(call(&f.app,&read_only,Method::POST,&format!("{}/{course}/stop",f.base()),json!({"client_request_id":Uuid::new_v4(),"expected_source_token":current["data"]["source_token"],"expected_course_token":current["data"]["course_token"],"expected_context_token":current["data"]["context_token"],"reason":"Synthetic unauthorized management attempt"})).await,StatusCode::FORBIDDEN).await;
    assert_eq!(denied["error"]["code"], "permission_denied");
}

#[tokio::test]
async fn readonly_network_allows_review_but_refuses_new_course_commands_without_effects() {
    let f = Fixture::new().await;
    f.generate().await;
    let course = f.course().await;
    let before = f.get(&format!("/{course}")).await;
    assert_eq!(before["data"]["can_stop_course"], true);
    assert_eq!(before["data"]["can_request_schedule_window"], true);
    let pool = f.app.db_pool().await;
    let facility = f.app.state().facility_id();
    let version = hms_db::network::get_policy(&pool, facility)
        .await
        .unwrap()
        .version;
    hms_db::network::update_policy(
        &pool,
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
        hms_domain::network::UpdateNetworkPolicyRequest {
            client_request_id: Uuid::new_v4(),
            expected_version: version,
            onsite_cidrs: vec!["192.0.2.0/24".into()],
            offsite_mode: hms_domain::network::NetworkOffsiteMode::Readonly,
            reason: "Synthetic readonly course-access regression".into(),
        },
        None,
    )
    .await
    .unwrap();
    let current = f.get(&format!("/{course}")).await;
    assert_eq!(current["data"]["can_stop_course"], false);
    assert_eq!(current["data"]["can_request_schedule_window"], false);
    assert_eq!(
        current["data"]["stop_unavailable_reason"],
        "network_write_unavailable"
    );
    assert_eq!(
        current["data"]["window_unavailable_reason"],
        "network_write_unavailable"
    );
    let input = json!({"client_request_id":Uuid::new_v4(),"expected_source_token":before["data"]["source_token"],"expected_course_token":before["data"]["course_token"],"expected_context_token":before["data"]["context_token"],"reason":"Synthetic refused local stop"});
    checked(
        call(
            &f.app,
            &f.token,
            Method::POST,
            &format!("{}/{course}/stop", f.base()),
            input,
        )
        .await,
        StatusCode::FORBIDDEN,
    )
    .await;
    let (stops,requests):(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM medication_course_stops WHERE facility_id=$1),(SELECT count(*) FROM treatment_course_requests WHERE facility_id=$1)").bind(facility).fetch_one(&pool).await.unwrap();
    assert_eq!((stops, requests), (0, 0));
    assert_eq!(
        f.get(&format!("/{course}")).await["data"]["summary"]["status"],
        "active"
    );
}
