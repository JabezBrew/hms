mod support;
use support::*;

async fn prescribing_app() -> TestApp {
    let app = app().await;
    grant_test_patient_visibility(
        &app,
        Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
        PatientDataVisibility::FullClinical,
    )
    .await;
    app
}

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
async fn patient(app: &TestApp) -> Uuid {
    sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(app.state().facility_id())
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap()
}
async fn create(app: &TestApp, token: &str) -> Value {
    let patient = patient(app).await;
    let response=call(app,token,Method::POST,format!("/api/v2/patients/{patient}/clinical/prescriptions"),json!({"medication_name":"Synthetic prescribing review","dose":"1 tablet","route":"oral","frequency":"daily","instructions":"Synthetic protected instructions","reason":"Synthetic protected indication","duration_days":7,"start_date":Utc::now().date_naive()})).await;
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await["data"].clone()
}
fn new_course(source: &Value, relation: &str) -> Value {
    json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":source["snapshot_token"],"relation":relation,"change_reason":"Synthetic explicit course decision","medication_name":"Synthetic new reviewed medication","dose":"2 tablets","route":"oral","frequency":"bid","instructions":"Synthetic successor instructions","reason":"Synthetic successor indication","start_date":Utc::now().date_naive(),"duration_days":4,"first_dose_at":null,"encounter_id":null,"visit_id":null,"inventory_item_id":null,"expected_stock_unit":null,"prn_policy":null})
}

#[tokio::test]
async fn real_prescription_detail_persists_documentation_without_widening_lists_or_summary() {
    let app = prescribing_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let source = create(&app, &token).await;
    let id = source["id"].as_str().unwrap();
    let patient = source["patient_id"].as_str().unwrap();
    assert_eq!(source["instructions"], "Synthetic protected instructions");
    assert_eq!(source["reason"], "Synthetic protected indication");
    assert_eq!(source["has_generated_course"], false);
    assert!(source["snapshot_token"]
        .as_str()
        .is_some_and(|value| value.len() == 64));
    let detail = json_body(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{id}"),
            Value::Null,
        )
        .await,
    )
    .await;
    assert_eq!(detail["data"], source);
    let list = json_body(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/patients/{patient}/clinical/prescriptions"),
            Value::Null,
        )
        .await,
    )
    .await;
    assert!(list["data"][0].get("instructions").is_none());
    assert!(list["data"][0].get("reason").is_none());
    let chronicle = json_body(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/patients/{patient}/chronicle"),
            Value::Null,
        )
        .await,
    )
    .await;
    assert!(!chronicle
        .to_string()
        .contains("Synthetic protected instructions"));
    assert!(!chronicle
        .to_string()
        .contains("Synthetic protected indication"));
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        call(
            &app,
            &limited,
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{id}"),
            Value::Null
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    let foreign = Uuid::new_v4();
    assert_eq!(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{foreign}"),
            Value::Null
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn explicit_documentation_patch_uses_uuid_and_source_token_with_persisted_lookup_receipt() {
    let app = prescribing_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let source = create(&app, &token).await;
    let id = source["id"].as_str().unwrap();
    let key = Uuid::new_v4();
    let request = json!({"client_request_id":key,"expected_snapshot_token":source["snapshot_token"],"instructions":"Synthetic revised instructions","reason":"Synthetic revised indication"});
    let response = call(
        &app,
        &token,
        Method::PATCH,
        format!("/api/v2/clinical/prescriptions/{id}/documentation"),
        request.clone(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let saved = json_body(response).await;
    assert_eq!(
        saved["data"]["prescription"]["instructions"],
        request["instructions"]
    );
    let replay = json_body(
        call(
            &app,
            &token,
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{id}/documentation"),
            request.clone(),
        )
        .await,
    )
    .await;
    assert_eq!(replay["data"]["replayed"], true);
    assert_eq!(
        replay["data"]["prescription"],
        saved["data"]["prescription"]
    );
    let lookup = call(
        &app,
        &token,
        Method::GET,
        format!("/api/v2/clinical/prescriptions/{id}/documentation/requests/{key}"),
        Value::Null,
    )
    .await;
    assert_eq!(lookup.status(), StatusCode::OK);
    assert_eq!(
        json_body(lookup).await["data"]["prescription"],
        saved["data"]["prescription"]
    );
    let mut stale = request;
    stale["client_request_id"] = json!(Uuid::new_v4());
    assert_eq!(
        call(
            &app,
            &token,
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{id}/documentation"),
            stale
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn real_replacement_and_terminal_renewal_have_distinct_source_lifecycle_and_receipt_semantics(
) {
    let app = prescribing_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let source = create(&app, &token).await;
    let id = source["id"].as_str().unwrap();
    let request = new_course(&source, "replacement");
    let response = call(
        &app,
        &token,
        Method::POST,
        format!("/api/v2/clinical/prescriptions/{id}/new-course"),
        request.clone(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let saved = json_body(response).await;
    assert_eq!(saved["data"]["source_status_before"], "active");
    assert_eq!(saved["data"]["source_status_after"], "stopped");
    assert_eq!(saved["data"]["prescription"]["status"], "active");
    assert_eq!(
        saved["data"]["prescription"]["provenance"]["source_prescription_id"],
        source["id"]
    );
    let key = request["client_request_id"].as_str().unwrap();
    let receipt = json_body(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{id}/new-course/requests/{key}"),
            Value::Null,
        )
        .await,
    )
    .await;
    assert_eq!(receipt["data"]["replayed"], true);
    assert_eq!(
        receipt["data"]["prescription"],
        saved["data"]["prescription"]
    );
    let closed = json_body(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{id}"),
            Value::Null,
        )
        .await,
    )
    .await["data"]
        .clone();
    assert_eq!(closed["status"], "stopped");
    assert_eq!(
        call(
            &app,
            &token,
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{id}"),
            json!({"status":"active"})
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    let duplicate = call(
        &app,
        &token,
        Method::POST,
        format!("/api/v2/clinical/prescriptions/{id}/new-course"),
        new_course(&closed, "renewal"),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(duplicate).await["error"]["code"],
        "prescription_successor_exists"
    );
    let other = create(&app, &token).await;
    let other_id = other["id"].as_str().unwrap();
    assert_eq!(
        call(
            &app,
            &token,
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{other_id}"),
            json!({"status":"completed"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    let completed = json_body(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{other_id}"),
            Value::Null,
        )
        .await,
    )
    .await["data"]
        .clone();
    let renewed = call(
        &app,
        &token,
        Method::POST,
        format!("/api/v2/clinical/prescriptions/{other_id}/new-course"),
        new_course(&completed, "renewal"),
    )
    .await;
    assert_eq!(renewed.status(), StatusCode::OK);
    assert_eq!(
        json_body(renewed).await["data"]["source_status_after"],
        "completed"
    );
}

#[tokio::test]
async fn unknown_course_write_has_no_definite_success_and_exact_retry_can_recover() {
    let app = prescribing_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let source = create(&app, &token).await;
    let id = source["id"].as_str().unwrap();
    let request = new_course(&source, "replacement");
    let pool = app.db_pool().await;
    sqlx::raw_sql("CREATE FUNCTION reject_prescription_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='prescription.course.created' THEN RAISE EXCEPTION 'synthetic audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_prescription_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_prescription_audit();").execute(&pool).await.unwrap();
    let failed = call(
        &app,
        &token,
        Method::POST,
        format!("/api/v2/clinical/prescriptions/{id}/new-course"),
        request.clone(),
    )
    .await;
    assert_eq!(failed.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(failed).await["error"]["code"],
        "prescription_action_unconfirmed"
    );
    let current = json_body(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{id}"),
            Value::Null,
        )
        .await,
    )
    .await;
    assert_eq!(current["data"]["status"], "active");
    sqlx::query("DROP TRIGGER reject_prescription_audit ON audit_events")
        .execute(&pool)
        .await
        .unwrap();
    let saved = call(
        &app,
        &token,
        Method::POST,
        format!("/api/v2/clinical/prescriptions/{id}/new-course"),
        request,
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
}

#[derive(Clone, Copy)]
enum WaitingWrite {
    Documentation,
    NewCourse,
    Create,
}
async fn assert_expiring_prescribing_grant_cannot_finish(kind: WaitingWrite) {
    use hms_db::admin::{create_permission_assignment, NewPermissionAssignment};
    let app = prescribing_app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let source = create(&app, &owner).await;
    let source_id = Uuid::parse_str(source["id"].as_str().unwrap()).unwrap();
    let limited: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    grant_test_feature(&app, limited, FeatureKey::Encounters).await;
    grant_test_permission(&app, limited, PermissionCode::ClinicalDocumentationView).await;
    grant_test_permission(&app, limited, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::FullClinical).await;
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
            permission_code: PermissionCode::ClinicalDocumentationManage,
            scope_type: "facility".into(),
            scope_id: None,
            granted_by_user_id: Uuid::from_u128(hms_db::provision::OWNER_USER_ID),
            starts_at: expires - Duration::minutes(1),
            ends_at: Some(expires),
            reason_code: "temporary_prescribing_cover".into(),
        },
        None,
    )
    .await
    .unwrap();
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let authorized = call(
        &app,
        &token,
        Method::GET,
        format!("/api/v2/clinical/prescriptions/{source_id}"),
        Value::Null,
    )
    .await;
    let authorized_status = authorized.status();
    let authorized_body = json_body(authorized).await;
    assert_eq!(
        authorized_status,
        StatusCode::OK,
        "{}",
        authorized_body["error"]["code"]
    );
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    let (method, path, body) = match kind {
        WaitingWrite::Documentation => {
            sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
                .bind(source_id)
                .execute(&mut *held)
                .await
                .unwrap();
            (
                Method::PATCH,
                format!("/api/v2/clinical/prescriptions/{source_id}/documentation"),
                json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":source["snapshot_token"],"instructions":"Synthetic waiting instructions","reason":"Synthetic waiting indication"}),
            )
        }
        WaitingWrite::NewCourse => {
            sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
                .bind(source_id)
                .execute(&mut *held)
                .await
                .unwrap();
            (
                Method::POST,
                format!("/api/v2/clinical/prescriptions/{source_id}/new-course"),
                new_course(&source, "replacement"),
            )
        }
        WaitingWrite::Create => {
            let item:Uuid=sqlx::query_scalar("SELECT id FROM inventory_items WHERE facility_id=$1 AND is_active AND item_type='medication' LIMIT 1").bind(facility).fetch_one(&pool).await.unwrap();
            sqlx::query("SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE")
                .bind(item)
                .execute(&mut *held)
                .await
                .unwrap();
            (
                Method::POST,
                format!(
                    "/api/v2/patients/{}/clinical/prescriptions",
                    source["patient_id"].as_str().unwrap()
                ),
                json!({"medication_name":"Synthetic waiting prescription","dose":"1 tablet","route":"oral","frequency":"daily","inventory_item_id":item,"instructions":"Synthetic waiting instructions","reason":"Synthetic waiting indication"}),
            )
        }
    };
    let pending_app = app.clone();
    let pending = tokio::spawn(async move { call(&pending_app, &token, method, path, body).await });
    tokio::time::timeout(std::time::Duration::from_secs(2),async{loop{let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(&pool).await.unwrap();if waiting{break;}assert!(!pending.is_finished(),"authorized write must reach the held production row");tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("prescribing write reaches real lock while authority is live");
    let remaining:i64=sqlx::query_scalar("SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp()))*1000))::bigint").bind(expires).fetch_one(&pool).await.unwrap();
    assert!(remaining > 0);
    tokio::time::sleep(std::time::Duration::from_millis(remaining as u64 + 100)).await;
    held.commit().await.unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(3), pending)
        .await
        .unwrap()
        .unwrap();
    let status = response.status();
    let error = json_body(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{}", error["error"]["code"]);
    assert_eq!(error["error"]["code"], "prescription_authorization_expired");
    let rows:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM prescriptions),(SELECT count(*) FROM prescription_commands),(SELECT count(*) FROM prescription_course_provenance)").fetch_one(&pool).await.unwrap();
    assert_eq!(rows, (1, 0, 0));
    let current = hms_db::clinical::get_prescription(&pool, facility, source_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        current.status,
        hms_domain::clinical::PrescriptionStatus::Active
    );
}
#[tokio::test]
async fn waiting_documentation_cannot_outlive_managed_prescribing_authority() {
    assert_expiring_prescribing_grant_cannot_finish(WaitingWrite::Documentation).await;
}
#[tokio::test]
async fn waiting_replacement_cannot_outlive_managed_prescribing_authority() {
    assert_expiring_prescribing_grant_cannot_finish(WaitingWrite::NewCourse).await;
}
#[tokio::test]
async fn waiting_basic_create_cannot_outlive_managed_prescribing_authority() {
    assert_expiring_prescribing_grant_cannot_finish(WaitingWrite::Create).await;
}

#[tokio::test]
async fn waiting_replacement_cannot_use_a_session_revoked_through_the_real_http_lifecycle() {
    let app = prescribing_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&token);
    let source = create(&app, &token).await;
    let id = Uuid::parse_str(source["id"].as_str().unwrap()).unwrap();
    let pool = app.db_pool().await;
    let (second, _, _) = login(app.clone(), "owner@hms.local").await;
    let mut held = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *held)
        .await
        .unwrap();
    sqlx::query("SELECT id FROM prescriptions WHERE id=$1 FOR UPDATE")
        .bind(id)
        .execute(&mut *held)
        .await
        .unwrap();
    let pending_app = app.clone();
    let body = new_course(&source, "replacement");
    let pending = tokio::spawn(async move {
        call(
            &pending_app,
            &token,
            Method::POST,
            format!("/api/v2/clinical/prescriptions/{id}/new-course"),
            body,
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(2),async{loop{let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))").bind(pid).fetch_one(&pool).await.unwrap();if waiting{break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
    let revoked = call(
        &app,
        &second,
        Method::POST,
        format!("/api/v2/auth/sessions/{}/revoke", claims.session_id),
        Value::Null,
    )
    .await;
    assert_eq!(revoked.status(), StatusCode::OK);
    assert_eq!(json_body(revoked).await["data"]["revoked"], true);
    held.commit().await.unwrap();
    let response = pending.await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "prescription_actor_invalid"
    );
    assert_eq!(
        hms_db::clinical::get_prescription(&pool, app.state().facility_id(), id)
            .await
            .unwrap()
            .unwrap()
            .status,
        hms_domain::clinical::PrescriptionStatus::Active
    );
}

#[tokio::test]
async fn strict_new_course_shape_errors_are_typed_bad_requests_without_any_write() {
    let app = prescribing_app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let source = create(&app, &token).await;
    let id = source["id"].as_str().unwrap();
    let mut missing = new_course(&source, "replacement");
    missing.as_object_mut().unwrap().remove("route");
    let response = call(
        &app,
        &token,
        Method::POST,
        format!("/api/v2/clinical/prescriptions/{id}/new-course"),
        missing,
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "invalid_prescription_request"
    );
    let response=call(&app,&token,Method::PATCH,format!("/api/v2/clinical/prescriptions/{id}/documentation"),json!({"client_request_id":Uuid::new_v4(),"expected_snapshot_token":source["snapshot_token"],"instructions":"Synthetic bounded text","reason":"Synthetic reason","unsupported_private_field":"Synthetic private value"})).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "invalid_prescription_request");
    assert!(!body.to_string().contains("Synthetic private value"));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM prescriptions")
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn demographics_only_clinician_cannot_read_or_write_expanded_prescription_detail() {
    let app = prescribing_app().await;
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let source = create(&app, &owner).await;
    let id = source["id"].as_str().unwrap();
    let patient = source["patient_id"].as_str().unwrap();
    let pool = app.db_pool().await;
    let limited: Uuid = sqlx::query_scalar(
        "SELECT id FROM users WHERE facility_id=$1 AND email='limited@hms.local'",
    )
    .bind(app.state().facility_id())
    .fetch_one(&pool)
    .await
    .unwrap();
    grant_test_feature(&app, limited, FeatureKey::Encounters).await;
    for permission in [
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::ClinicalDocumentationManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&app, limited, permission).await;
    }
    grant_test_patient_visibility(&app, limited, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let key = Uuid::new_v4();
    for (method, path, body) in [
        (
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{id}"),
            Value::Null,
        ),
        (
            Method::POST,
            format!("/api/v2/patients/{patient}/clinical/prescriptions"),
            json!({"medication_name":"Synthetic restricted create","dose":"1 tablet","route":"oral","frequency":"daily","instructions":"Synthetic protected instructions"}),
        ),
        (
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{id}/documentation"),
            json!({"client_request_id":key,"expected_snapshot_token":source["snapshot_token"],"instructions":"Synthetic restricted edit","reason":"Synthetic restricted indication"}),
        ),
        (
            Method::POST,
            format!("/api/v2/clinical/prescriptions/{id}/new-course"),
            new_course(&source, "replacement"),
        ),
        (
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{id}/documentation/requests/{key}"),
            Value::Null,
        ),
        (
            Method::GET,
            format!("/api/v2/clinical/prescriptions/{id}/new-course/requests/{key}"),
            Value::Null,
        ),
    ] {
        let response = call(&app, &token, method, path, body).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body = json_body(response).await;
        assert_eq!(body["error"]["code"], "patient_access_denied");
        assert!(!body.to_string().contains("Synthetic protected"));
    }
    assert_eq!(
        call(
            &app,
            &token,
            Method::GET,
            format!("/api/v2/patients/{patient}/clinical/prescriptions"),
            Value::Null
        )
        .await
        .status(),
        StatusCode::OK
    );
    // Existing lean lifecycle PATCH retains its established authorization shape.
    assert_eq!(
        call(
            &app,
            &token,
            Method::PATCH,
            format!("/api/v2/clinical/prescriptions/{id}"),
            json!({"status":"on_hold"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM prescriptions),(SELECT count(*) FROM prescription_commands),(SELECT count(*) FROM prescription_course_provenance)").fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 0, 0));
}
