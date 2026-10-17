mod support;
use support::*;
async fn call(
    app: &TestApp,
    token: &str,
    method: Method,
    path: impl AsRef<str>,
    body: Value,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path.as_ref())
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
struct Fixture {
    app: TestApp,
    owner: String,
    source: Uuid,
    admission: Uuid,
    item: Uuid,
    location: Uuid,
    unit: String,
}
impl Fixture {
    async fn new() -> Self {
        let app = app().await;
        let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
        grant_test_patient_visibility(&app, owner_id, PatientDataVisibility::FullClinical).await;
        let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
        let pool = app.db_pool().await;
        let facility = app.state().facility_id();
        let patient: Uuid =
            sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
                .bind(facility)
                .fetch_one(&pool)
                .await
                .unwrap();
        let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
            .bind(facility)
            .fetch_one(&pool)
            .await
            .unwrap();
        let admission = Uuid::new_v4();
        sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
        let(item,unit):(Uuid,String)=sqlx::query_as("SELECT id,unit FROM inventory_items WHERE facility_id=$1 AND is_active AND NOT controlled AND item_type='medication' LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
        let location = sqlx::query_scalar(
            "SELECT id FROM storage_locations WHERE facility_id=$1 AND is_active LIMIT 1",
        )
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO stock_batches(id,facility_id,item_id,location_id,batch_number,quantity_on_hand) VALUES($1,$2,$3,$4,'SYNTHETIC-CONTRACT',100)").bind(Uuid::new_v4()).bind(facility).bind(item).bind(location).execute(&pool).await.unwrap();
        let response=call(&app,&owner,Method::POST,format!("/api/v2/patients/{patient}/clinical/prescriptions"),json!({"medication_name":"Synthetic reviewed schedule","dose":"Explicit clinical dosage text","route":"oral","frequency":"daily","inventory_item_id":item,"scheduled_stock_policy":{"expected_stock_unit":unit,"stock_units_per_dose":2},"start_date":(Utc::now()-Duration::days(1)).date_naive(),"first_dose_at":Utc::now()-Duration::hours(1),"duration_days":3})).await;
        let status = response.status();
        let body = json_body(response).await;
        assert_eq!(status, StatusCode::OK, "{}", body["error"]["code"]);
        assert_eq!(body["data"]["scheduled_stock_policy"]["stock_unit"], unit);
        let source = Uuid::parse_str(body["data"]["id"].as_str().unwrap()).unwrap();
        Self {
            app,
            owner,
            source,
            admission,
            item,
            location,
            unit,
        }
    }
    fn generation(&self) -> Value {
        json!({"admission_case_id":self.admission,"days":2})
    }
    async fn generate(&self) -> Uuid {
        let response = call(
            &self.app,
            &self.owner,
            Method::POST,
            format!(
                "/api/v2/clinical/prescriptions/{}/generate-mar",
                self.source
            ),
            self.generation(),
        )
        .await;
        let status = response.status();
        let body = json_body(response).await;
        assert_eq!(status, StatusCode::OK, "{}", body["error"]["code"]);
        Uuid::parse_str(body["data"]["pharmacy_fulfillment_id"].as_str().unwrap()).unwrap()
    }
    async fn dose(&self) -> Uuid {
        sqlx::query_scalar("SELECT id FROM medication_administrations WHERE prescription_id=$1 ORDER BY dose_sequence LIMIT 1").bind(self.source).fetch_one(&self.app.db_pool().await).await.unwrap()
    }
    async fn supply(&self, id: Uuid) -> Value {
        let response = call(
            &self.app,
            &self.owner,
            Method::POST,
            format!("/api/v2/pharmacy/dispensing-queue/{id}/dispense"),
            json!({"item_id":self.item,"location_id":self.location,"quantity":1}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        json_body(response).await["data"].clone()
    }
}
#[tokio::test]
async fn production_schedule_supply_and_given_return_reviewed_stock_evidence() {
    let f = Fixture::new().await;
    let fulfillment = f.generate().await;
    let issued = f.supply(fulfillment).await;
    assert_eq!(issued["issued_stock_quantity"], 2);
    assert_eq!(issued["issued_stock_unit"], f.unit);
    let dose = f.dose().await;
    let given = call(
        &f.app,
        &f.owner,
        Method::POST,
        format!("/api/v2/nursing/medication-administrations/{dose}/outcome"),
        json!({"status":"administered"}),
    )
    .await;
    assert_eq!(given.status(), StatusCode::OK);
    let body = json_body(given).await;
    assert_eq!(body["data"]["dispensed_stock_quantity"], 2);
    assert_eq!(body["data"]["dispensed_stock_unit"], f.unit);
    let response=call(&f.app,&f.owner,Method::POST,"/api/v2/inventory/stock-batches",json!({"item_id":f.item,"location_id":f.location,"batch_number":"SYNTHETIC-UNREVIEWED","quantity_received":2})).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "invalid_stock_receipt"
    );
}
async fn blocked(pool: &hms_db::PgPool, pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(2),async{loop{let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(pool).await.unwrap();if waiting{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("HTTP command reaches held production row");
}
#[derive(Clone, Copy)]
enum Action {
    Generate,
    Supply,
    Given,
}
async fn target(f: &Fixture, action: Action) -> (String, Value) {
    match action {
        Action::Generate => (
            format!("/api/v2/clinical/prescriptions/{}/generate-mar", f.source),
            f.generation(),
        ),
        Action::Supply => {
            let id = f.generate().await;
            (
                format!("/api/v2/pharmacy/dispensing-queue/{id}/dispense"),
                json!({"item_id":f.item,"location_id":f.location,"quantity":1}),
            )
        }
        Action::Given => {
            let id = f.generate().await;
            f.supply(id).await;
            (
                format!(
                    "/api/v2/nursing/medication-administrations/{}/outcome",
                    f.dose().await
                ),
                json!({"status":"administered"}),
            )
        }
    }
}
async fn assert_source_wait_revocation(action: Action) {
    let f = Fixture::new().await;
    let (path, body) = target(&f, action).await;
    let pool = f.app.db_pool().await;
    let claims = access_claims(&f.owner);
    let (second, _, _) = login(f.app.clone(), "owner@hms.local").await;
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
        .bind(f.source)
        .execute(&mut *held)
        .await
        .unwrap();
    let app = f.app.clone();
    let token = f.owner.clone();
    let write = tokio::spawn(async move { call(&app, &token, Method::POST, path, body).await });
    blocked(&pool, pid).await;
    let revoke = call(
        &f.app,
        &second,
        Method::POST,
        format!("/api/v2/auth/sessions/{}/revoke", claims.session_id),
        Value::Null,
    )
    .await;
    assert_eq!(revoke.status(), StatusCode::OK);
    held.commit().await.unwrap();
    let response = write.await.unwrap();
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{}", body["error"]["code"]);
    assert_eq!(body["error"]["code"], "medication_authorization_expired");
}
#[tokio::test]
async fn generation_wait_cannot_use_revoked_session() {
    assert_source_wait_revocation(Action::Generate).await;
}
#[tokio::test]
async fn physical_issue_wait_cannot_use_revoked_session() {
    assert_source_wait_revocation(Action::Supply).await;
}
#[tokio::test]
async fn actual_given_wait_cannot_use_revoked_session() {
    assert_source_wait_revocation(Action::Given).await;
}
async fn assert_item_wait_expiry(action: Action) {
    use hms_db::admin::{create_permission_assignment, NewPermissionAssignment};
    let f = Fixture::new().await;
    let (path, body) = target(&f, action).await;
    let pool = f.app.db_pool().await;
    let facility = f.app.state().facility_id();
    let limited: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    for feature in [
        FeatureKey::Encounters,
        FeatureKey::Nursing,
        FeatureKey::Pharmacy,
    ] {
        grant_test_feature(&f.app, limited, feature).await;
    }
    for permission in [
        PermissionCode::PatientDemographicsView,
        PermissionCode::ClinicalDocumentationView,
    ] {
        grant_test_permission(&f.app, limited, permission).await;
    }
    grant_test_patient_visibility(&f.app, limited, PatientDataVisibility::Demographics).await;
    grant_test_patient_visibility(&f.app, limited, PatientDataVisibility::FullClinical).await;
    if !matches!(action, Action::Supply) {
        let (patient, ward): (Uuid, Uuid) = sqlx::query_as(
            "SELECT patient_id,ward_id FROM admission_cases WHERE facility_id=$1 AND id=$2",
        )
        .bind(facility)
        .bind(f.admission)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO patient_contexts(id,facility_id,user_id,patient_id,context_kind) VALUES(gen_random_uuid(),$1,$2,$3,'inpatient') ON CONFLICT DO NOTHING")
            .bind(facility).bind(limited).bind(patient).execute(&pool).await.unwrap();
        let practitioner =
            create_test_practitioner_for_user(&f.app, limited, "STOCK-WAIT", "STOCK-WAIT-LIC")
                .await;
        sqlx::query("INSERT INTO ward_staff_assignments(id,facility_id,ward_id,practitioner_profile_id,role_code,role_name,role_category) VALUES(gen_random_uuid(),$1,$2,$3,'staff_nurse','Nurse','nursing')")
            .bind(facility).bind(ward).bind(practitioner).execute(&pool).await.unwrap();
    }
    let permission = match action {
        Action::Generate => PermissionCode::ClinicalDocumentationManage,
        Action::Supply => PermissionCode::PharmacyDispense,
        Action::Given => PermissionCode::NursingTaskManage,
    };
    let expires: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT clock_timestamp()+interval '4 seconds'")
            .fetch_one(&pool)
            .await
            .unwrap();
    create_permission_assignment(
        &pool,
        NewPermissionAssignment {
            facility_id: facility,
            grantee_user_id: limited,
            permission_code: permission,
            scope_type: "facility".into(),
            scope_id: None,
            granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
            starts_at: expires - Duration::minutes(1),
            ends_at: Some(expires),
            reason_code: "temporary_medication_cover".into(),
        },
        None,
    )
    .await
    .unwrap();
    let (token, _, _) = login(f.app.clone(), "limited@hms.local").await;
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE")
        .bind(f.item)
        .execute(&mut *held)
        .await
        .unwrap();
    let app = f.app.clone();
    let write = tokio::spawn(async move { call(&app, &token, Method::POST, path, body).await });
    tokio::time::timeout(std::time::Duration::from_secs(2),async {loop {let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(&pool).await.unwrap();if waiting {break;}if write.is_finished(){break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("expiry command reaches controlled item wait");
    if write.is_finished() {
        held.rollback().await.unwrap();
        let response = write.await.unwrap();
        let status = response.status();
        let body = json_body(response).await;
        panic!(
            "authorized command ended before item wait: status={} code={}",
            status, body["error"]["code"]
        );
    }
    let ms:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(expires).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(ms as u64 + 80)).await;
    held.commit().await.unwrap();
    let response = write.await.unwrap();
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{}", body["error"]["code"]);
    assert_eq!(body["error"]["code"], "prescription_authorization_expired");
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM medication_administrations WHERE prescription_id=$1 AND status='administered'").bind(f.source).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 0);
}
#[tokio::test]
async fn generation_item_wait_cannot_outlive_managed_authority() {
    assert_item_wait_expiry(Action::Generate).await;
}
#[tokio::test]
async fn physical_issue_item_wait_cannot_outlive_managed_authority() {
    assert_item_wait_expiry(Action::Supply).await;
}
#[tokio::test]
async fn actual_given_item_wait_cannot_outlive_managed_authority() {
    assert_item_wait_expiry(Action::Given).await;
}
async fn inventory_item_wait_expiry(catalog: bool) {
    use hms_db::admin::{create_permission_assignment, NewPermissionAssignment};
    let f = Fixture::new().await;
    let pool = f.app.db_pool().await;
    let facility = f.app.state().facility_id();
    let limited: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    grant_test_feature(&f.app, limited, FeatureKey::Inventory).await;
    grant_test_permission(&f.app, limited, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&f.app, limited, PatientDataVisibility::Demographics).await;
    let expires: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT clock_timestamp()+interval '4 seconds'")
            .fetch_one(&pool)
            .await
            .unwrap();
    create_permission_assignment(
        &pool,
        NewPermissionAssignment {
            facility_id: facility,
            grantee_user_id: limited,
            permission_code: PermissionCode::InventoryManage,
            scope_type: "facility".into(),
            scope_id: None,
            granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
            starts_at: expires - Duration::minutes(1),
            ends_at: Some(expires),
            reason_code: "temporary_inventory_cover".into(),
        },
        None,
    )
    .await
    .unwrap();
    let (token, _, _) = login(f.app.clone(), "limited@hms.local").await;
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE")
        .bind(f.item)
        .execute(&mut *held)
        .await
        .unwrap();
    let (path, body) = if catalog {
        (
            "/api/v2/inventory/catalog-edits",
            json!({"item_id":f.item,"effective_from":Utc::now().date_naive(),"code":"SYNTHETIC-CORRECTION","name":"Synthetic reviewed catalog","unit":f.unit,"reason":"Synthetic reviewed correction"}),
        )
    } else {
        (
            "/api/v2/inventory/stock-batches",
            json!({"item_id":f.item,"location_id":f.location,"batch_number":"SYNTHETIC-WAITING","quantity_received":2,"expected_unit":f.unit}),
        )
    };
    let app = f.app.clone();
    let write = tokio::spawn(async move { call(&app, &token, Method::POST, path, body).await });
    blocked(&pool, pid).await;
    let ms:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(expires).fetch_one(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(ms as u64 + 80)).await;
    held.commit().await.unwrap();
    let response = write.await.unwrap();
    let status = response.status();
    let body = json_body(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{}", body["error"]["code"]);
    assert_eq!(body["error"]["code"], "prescription_authorization_expired");
    let created:i64=sqlx::query_scalar("SELECT (SELECT count(*) FROM inventory_item_catalog_versions WHERE item_id=$1)+(SELECT count(*) FROM stock_batches WHERE item_id=$1 AND batch_number='SYNTHETIC-WAITING')").bind(f.item).fetch_one(&pool).await.unwrap();
    assert_eq!(created, 0);
}
#[tokio::test]
async fn receipt_item_wait_cannot_outlive_managed_authority() {
    inventory_item_wait_expiry(false).await;
}
#[tokio::test]
async fn catalog_item_wait_cannot_outlive_managed_authority() {
    inventory_item_wait_expiry(true).await;
}

#[tokio::test]
async fn unsupported_policy_patch_and_unreviewed_scheduled_create_are_typed_no_write_denials() {
    let f = Fixture::new().await;
    let before = hms_db::clinical::prescription_courses::get_detail(
        &f.app.db_pool().await,
        f.app.state().facility_id(),
        f.source,
    )
    .await
    .unwrap()
    .unwrap();
    let response = call(
        &f.app,
        &f.owner,
        Method::PATCH,
        format!("/api/v2/clinical/prescriptions/{}", f.source),
        json!({"scheduled_stock_policy":{"expected_stock_unit":f.unit,"stock_units_per_dose":99}}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "invalid_prescription_request"
    );
    let after = hms_db::clinical::prescription_courses::get_detail(
        &f.app.db_pool().await,
        f.app.state().facility_id(),
        f.source,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(after.snapshot_token, before.snapshot_token);
    assert_eq!(after.scheduled_stock_policy, before.scheduled_stock_policy);
    let response=call(&f.app,&f.owner,Method::POST,format!("/api/v2/patients/{}/clinical/prescriptions",before.prescription.patient_id),json!({"medication_name":"Synthetic unreviewed stock","dose":"2 tablets is not an inventory conversion","route":"oral","frequency":"daily","inventory_item_id":f.item})).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM prescriptions")
        .fetch_one(&f.app.db_pool().await)
        .await
        .unwrap();
    assert_eq!(count, 1);
}
