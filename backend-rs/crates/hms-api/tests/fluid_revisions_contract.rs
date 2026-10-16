mod support;
use axum::http::{header::CONTENT_TYPE, Response};
use support::*;
async fn call(
    app: TestApp,
    token: &str,
    method: &str,
    path: String,
    body: Option<Value>,
) -> Response<Body> {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
        .unwrap();
    app.oneshot(request).await.unwrap()
}
#[tokio::test]
async fn fluid_revision_routes_preserve_paired_evidence_and_enforce_context_access() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let admission = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
    let key = Uuid::new_v4();
    let observed = (Utc::now() - chrono::Duration::minutes(1)).to_rfc3339();
    let payload = json!({"client_request_id":key,"admission_case_id":admission,"values":{"recorded_at":observed,"intake_ml":400,"output_ml":100,"metadata":{"intake_category":"oral","output_category":"urine","notes":"Synthetic observation"}}});
    let response = call(
        app.clone(),
        &token,
        "POST",
        "/api/v2/nursing/fluid-observations".into(),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let first = json_body(response).await;
    let id = first["data"]["entry_id"].as_str().unwrap();
    let again = call(
        app.clone(),
        &token,
        "POST",
        "/api/v2/nursing/fluid-observations".into(),
        Some(payload.clone()),
    )
    .await;
    let again = json_body(again).await;
    assert_eq!(first["data"]["entry_id"], again["data"]["entry_id"]);
    assert_eq!(again["data"]["replayed"], true);
    let correction = json!({"client_request_id":Uuid::new_v4(),"reason":"Synthetic volume correction","replacement":{"recorded_at":observed,"intake_ml":600,"output_ml":100,"metadata":{"intake_category":"oral","output_category":"urine"}}});
    let response = call(
        app.clone(),
        &token,
        "POST",
        format!("/api/v2/nursing/fluid-observations/{id}/corrections"),
        Some(correction.clone()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let corrected = json_body(response).await;
    let old = call(
        app.clone(),
        &token,
        "GET",
        format!("/api/v2/nursing/fluid-observations/{id}"),
        None,
    )
    .await;
    let old = json_body(old).await;
    assert_eq!(old["data"]["values"]["intake_ml"], 400);
    assert_eq!(old["data"]["values"]["output_ml"], 100);
    assert_eq!(old["data"]["current"], false);
    let summary=call(app.clone(),&token,"GET",format!("/api/v2/nursing/fluid-observations/summary?patient_id={patient}&admission_case_id={admission}"),None).await;
    assert_eq!(summary.status(), StatusCode::OK);
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM fluid_balance_entries WHERE id=$1 OR root_entry_id=$1",
    )
    .bind(Uuid::parse_str(id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 2);
    let stale = call(
        app.clone(),
        &token,
        "POST",
        format!("/api/v2/nursing/fluid-observations/{id}/void"),
        Some(json!({"client_request_id":Uuid::new_v4(),"reason":"Stale request"})),
    )
    .await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let history = call(
        app.clone(),
        &token,
        "GET",
        format!("/api/v2/nursing/fluid-observations/{id}/history?limit=1"),
        None,
    )
    .await;
    let history = json_body(history).await;
    assert_eq!(history["data"].as_array().unwrap().len(), 1);
    assert_eq!(history["page"]["has_next"], true);
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    for path in [
        format!("/api/v2/nursing/fluid-observations/{id}"),
        format!("/api/v2/nursing/fluid-observations/{id}/history"),
        format!("/api/v2/nursing/fluid-monitoring/assessment?admission_case_id={admission}"),
    ] {
        assert_eq!(
            call(app.clone(), &limited, "GET", path, None)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    let mismatch = call(
        app.clone(),
        &token,
        "GET",
        format!(
            "/api/v2/nursing/fluid-observations?patient_id={}&admission_case_id={admission}",
            Uuid::new_v4()
        ),
        None,
    )
    .await;
    assert_eq!(mismatch.status(), StatusCode::BAD_REQUEST);
    let mut typo = correction;
    typo["reasonn"] = json!("typo");
    let new_id = corrected["data"]["entry_id"].as_str().unwrap();
    assert_eq!(
        call(
            app.clone(),
            &token,
            "POST",
            format!("/api/v2/nursing/fluid-observations/{new_id}/corrections"),
            Some(typo)
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let voided = call(
        app.clone(),
        &token,
        "POST",
        format!("/api/v2/nursing/fluid-observations/{new_id}/void"),
        Some(json!({"client_request_id":Uuid::new_v4(),"reason":"Synthetic preserved void"})),
    )
    .await;
    assert_eq!(voided.status(), StatusCode::OK);
    let listing=call(app.clone(),&token,"GET",format!("/api/v2/nursing/fluid-observations?patient_id={patient}&admission_case_id={admission}&include_closed=true&limit=1"),None).await;
    assert_eq!(listing.status(), StatusCode::OK);
    let listing = json_body(listing).await;
    assert_eq!(listing["data"].as_array().unwrap().len(), 1);
    assert_eq!(listing["data"][0]["id"], new_id);
    assert_eq!(listing["data"][0]["current"], false);
    assert_eq!(listing["data"][0]["closed_by_action"], "voided");
}
#[tokio::test]
async fn rules_are_facility_admin_only_and_persistence_failure_is_explicitly_unconfirmed() {
    let app = app().await;
    let pool = app.db_pool().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    let rules = json!({"client_request_id":Uuid::new_v4(),"expected_version":0,"reason":"Synthetic reviewed policy","values":{"min_daily_intake_target":1500,"max_daily_output_threshold":3000,"negative_balance_alert_threshold":-500,"positive_balance_alert_threshold":2000,"enable_intake_alerts":false,"enable_output_alerts":false,"enable_balance_alerts":false}});
    assert_eq!(
        call(
            app.clone(),
            &limited,
            "POST",
            "/api/v2/nursing/fluid-monitoring/rules".into(),
            Some(rules.clone())
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    let saved = call(
        app.clone(),
        &token,
        "POST",
        "/api/v2/nursing/fluid-monitoring/rules".into(),
        Some(rules),
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
    let facility = app.state().facility_id();
    let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let admission = Uuid::new_v4();
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO fluid_balance_entries(id,facility_id,patient_id,admission_case_id,recorded_at,intake_ml,output_ml) VALUES($1,$2,$3,$4,now()-interval '1 minute',100,0)").bind(id).bind(facility).bind(patient).bind(admission).execute(&pool).await.unwrap();
    sqlx::raw_sql("CREATE FUNCTION fail_fluid_http_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fluid.observation.voided' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_fluid_http_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_fluid_http_audit();").execute(&pool).await.unwrap();
    let response = call(
        app.clone(),
        &token,
        "POST",
        format!("/api/v2/nursing/fluid-observations/{id}/void"),
        Some(json!({"client_request_id":Uuid::new_v4(),"reason":"Synthetic void"})),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "fluid_write_unconfirmed"
    );
    let assess = call(
        app.clone(),
        &token,
        "GET",
        format!("/api/v2/nursing/fluid-monitoring/assessment?admission_case_id={admission}"),
        None,
    )
    .await;
    assert_eq!(assess.status(), StatusCode::OK);
}

#[tokio::test]
async fn fluid_create_cannot_bypass_the_nursing_feature_with_only_a_permission() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, user, PermissionCode::NursingTaskManage).await;
    grant_test_permission(&app, user, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let ward: Uuid = sqlx::query_scalar("SELECT id FROM wards WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(facility)
        .fetch_one(&pool)
        .await
        .unwrap();
    let admission = Uuid::new_v4();
    sqlx::query("INSERT INTO admission_cases(id,facility_id,patient_id,ward_id,status) VALUES($1,$2,$3,$4,'admitted')").bind(admission).bind(facility).bind(patient).bind(ward).execute(&pool).await.unwrap();
    let payload = json!({"client_request_id":Uuid::new_v4(),"admission_case_id":admission,"values":{"recorded_at":(Utc::now()-Duration::minutes(1)).to_rfc3339(),"intake_ml":100,"output_ml":0,"metadata":{"intake_category":"oral"}}});
    assert_eq!(
        call(
            app.clone(),
            &token,
            "POST",
            "/api/v2/nursing/fluid-observations".into(),
            Some(payload)
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fluid_balance_entries WHERE admission_case_id=$1")
            .bind(admission)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 0);
}
