mod support;
use support::*;

async fn context(app: &TestApp) -> (Uuid, Uuid) {
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
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
    (patient, admission)
}
async fn post(app: &TestApp, token: &str, path: String, value: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn dose(app: &TestApp, token: &str, admission: Uuid, future: bool) -> Uuid {
    let scheduled = Utc::now()
        + if future {
            chrono::Duration::hours(5)
        } else {
            chrono::Duration::hours(-1)
        };
    let response=post(app,token,"/api/v2/nursing/medication-administrations".to_owned(),json!({"admission_case_id":admission,"medication_name":"Synthetic medication","dose":"1 tablet","route":"oral","frequency":"daily","scheduled_at":scheduled})).await;
    assert_eq!(response.status(), StatusCode::OK);
    Uuid::parse_str(json_body(response).await["data"]["id"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn explicit_dose_outcomes_preserve_reason_evidence_and_never_claim_nonadministration_was_given(
) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (patient, admission) = context(&app).await;
    for status in ["missed", "refused", "held"] {
        let id = dose(&app, &token, admission, false).await;
        let path = format!("/api/v2/nursing/medication-administrations/{id}/outcome");
        let body = json!({"status":status,"reason_not_given":"Synthetic reason","administration_notes":"Synthetic observation"});
        let response = post(&app, &token, path.clone(), body.clone()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let saved = json_body(response).await;
        assert_eq!(saved["data"]["status"], status);
        assert!(saved["data"]["administered_at"].is_null());
        assert!(saved["data"]["outcome_recorded_at"].is_string());
        assert_eq!(saved["data"]["reason_not_given"], "Synthetic reason");
        assert_eq!(saved["data"]["prescription_held"], false);
        let replay = post(&app, &token, path.clone(), body).await;
        assert_eq!(replay.status(), StatusCode::OK);
        assert_eq!(
            json_body(replay).await["data"]["outcome_recorded_at"],
            saved["data"]["outcome_recorded_at"]
        );
        assert_eq!(
            post(&app, &token, path, json!({"status":"administered"}))
                .await
                .status(),
            StatusCode::CONFLICT
        );
        let list=app.clone().oneshot(Request::builder().uri(format!("/api/v2/nursing/medication-administrations?patient_id={patient}&status={status}")).header(AUTHORIZATION,format!("Bearer {token}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(list.status(), StatusCode::OK);
        let list = json_body(list).await;
        assert_eq!(list["data"].as_array().unwrap().len(), 1);
        assert_eq!(list["data"][0]["id"], id.to_string());
        assert_eq!(
            list["data"][0]["administration_notes"],
            "Synthetic observation"
        );
    }
    let id = dose(&app, &token, admission, false).await;
    let old = post(
        &app,
        &token,
        format!("/api/v2/nursing/medication-administrations/{id}/administer"),
        json!({"witness_user_id":null}),
    )
    .await;
    assert_eq!(
        old.status(),
        StatusCode::OK,
        "manual unlinked compatibility remains supported"
    );
    assert_eq!(json_body(old).await["data"]["status"], "administered");
}

#[tokio::test]
async fn outcome_route_requires_explicit_typed_decision_valid_reason_and_patient_permissions() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (_, admission) = context(&app).await;
    let id = dose(&app, &token, admission, false).await;
    let path = format!("/api/v2/nursing/medication-administrations/{id}/outcome");
    for body in [
        json!({}),
        json!({"stauts":"refused"}),
        json!({"status":"scheduled"}),
        json!({"status":"refused","reason_not_given":"Synthetic","typo":true}),
    ] {
        assert!(post(&app, &token, path.clone(), body)
            .await
            .status()
            .is_client_error());
    }
    for reason in ["", "   "] {
        assert_eq!(
            post(
                &app,
                &token,
                path.clone(),
                json!({"status":"refused","reason_not_given":reason})
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let future = dose(&app, &token, admission, true).await;
    assert_eq!(
        post(
            &app,
            &token,
            format!("/api/v2/nursing/medication-administrations/{future}/outcome"),
            json!({"status":"missed","reason_not_given":"Synthetic reason"})
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(
            &app,
            &token,
            path.clone(),
            json!({"status":"administered","witness_user_id":Uuid::new_v4()})
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    let (limited, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        post(
            &app,
            &limited,
            path.clone(),
            json!({"status":"refused","reason_not_given":"Synthetic reason"})
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post(
            &app,
            &token,
            format!(
                "/api/v2/nursing/medication-administrations/{}/outcome",
                Uuid::new_v4()
            ),
            json!({"status":"refused","reason_not_given":"Synthetic reason"})
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"status":"refused","reason_not_given":"Synthetic reason"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn source_based_administration_requires_supply_but_refusal_does_not_invent_it() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (patient, admission) = context(&app).await;
    let pool = app.db_pool().await;
    let facility = app.state().facility_id();
    let actor: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE facility_id=$1 AND email='owner@hms.local'")
            .bind(facility)
            .fetch_one(&pool)
            .await
            .unwrap();
    let item: Uuid = sqlx::query_scalar(
        "SELECT id FROM inventory_items WHERE facility_id=$1 AND NOT controlled LIMIT 1",
    )
    .bind(facility)
    .fetch_one(&pool)
    .await
    .unwrap();
    let prescription = Uuid::new_v4();
    let start = Utc::now() - chrono::Duration::hours(1);
    hms_db::clinical::create_prescription(
        &pool,
        hms_db::clinical::NewPrescription {
            id: prescription,
            facility_id: facility,
            patient_id: patient,
            encounter_id: None,
            visit_id: None,
            discharge_case_id: None,
            medication_name: "Synthetic sourced medication".to_owned(),
            dose: "1 tablet".to_owned(),
            route: "oral".to_owned(),
            frequency: "daily".to_owned(),
            inventory_item_id: Some(item),
            start_date: Some(start.date_naive()),
            duration_days: Some(1),
            first_dose_at: Some(start),
            actor_user_id: actor,
        },
    )
    .await
    .unwrap();
    let generated = hms_db::pharmacy::generate_mar_for_prescription(
        &pool,
        hms_db::pharmacy::GenerateMarCommand {
            facility_id: facility,
            prescription_id: prescription,
            admission_case_id: admission,
            days: 1,
            first_dose_at: Some(start),
            actor_user_id: actor,
        },
    )
    .await
    .unwrap();
    let id: Uuid = sqlx::query_scalar(
        "SELECT id FROM medication_administrations WHERE prescription_id=$1 LIMIT 1",
    )
    .bind(prescription)
    .fetch_one(&pool)
    .await
    .unwrap();
    let path = format!("/api/v2/nursing/medication-administrations/{id}/outcome");
    assert_eq!(
        post(&app, &token, path.clone(), json!({"status":"administered"}))
            .await
            .status(),
        StatusCode::CONFLICT
    );
    let refused = post(
        &app,
        &token,
        path,
        json!({"status":"refused","reason_not_given":"Synthetic reason"}),
    )
    .await;
    assert_eq!(refused.status(), StatusCode::OK);
    let refused = json_body(refused).await;
    assert_eq!(refused["data"]["status"], "refused");
    assert_eq!(refused["data"]["is_dispensed"], false);
    assert!(refused["data"]["administered_at"].is_null());
    let supply:(i32,i32,String)=sqlx::query_as("SELECT requested_dose_count,dispensed_dose_count,status FROM pharmacy_fulfillments WHERE id=$1").bind(generated.pharmacy_fulfillment_id).fetch_one(&pool).await.unwrap();
    assert_eq!(supply, (0, 0, "cancelled".to_owned()));
}

#[tokio::test]
async fn generic_storage_failures_report_an_uncertain_outcome_without_leaking_or_inviting_a_different_decision(
) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (_, admission) = context(&app).await;
    let id = dose(&app, &token, admission, false).await;
    let pool = app.db_pool().await;
    sqlx::query("CREATE FUNCTION reject_api_outcome_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='nursing.medication_outcome.recorded' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$").execute(&pool).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_api_outcome_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_api_outcome_audit()").execute(&pool).await.unwrap();
    let result = post(
        &app,
        &token,
        format!("/api/v2/nursing/medication-administrations/{id}/outcome"),
        json!({"status":"refused","reason_not_given":"Synthetic reason"}),
    )
    .await;
    assert_eq!(result.status(), StatusCode::CONFLICT);
    let body = json_body(result).await;
    assert_eq!(body["error"]["code"], "medication_outcome_unconfirmed");
    assert!(!body.to_string().contains("synthetic audit failure"));
    let status: String =
        sqlx::query_scalar("SELECT status FROM medication_administrations WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        status, "scheduled",
        "the transaction still rolls back on a known precommit failure"
    );
}
