use super::*;

#[tokio::test]
async fn nursing_observations_alerts_fluids_and_stock_requests_are_patient_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient list succeeds");
    assert_eq!(patient_response.status(), StatusCode::OK);
    let patient_body = json_body(patient_response).await;
    let patient_id = patient_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists")
        .to_owned();

    let ward_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward list succeeds");
    assert_eq!(ward_response.status(), StatusCode::OK);
    let ward_body = json_body(ward_response).await;
    let ward_id = ward_body["data"][0]["id"]
        .as_str()
        .expect("ward id exists")
        .to_owned();

    let admission_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions/cases")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "ward_id": ward_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("admission case create succeeds");
    assert_eq!(admission_response.status(), StatusCode::OK);
    let admission_body = json_body(admission_response).await;
    let admission_case_id = admission_body["data"]["id"]
        .as_str()
        .expect("admission id exists")
        .to_owned();

    let activate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{admission_case_id}/activate"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission activation succeeds");
    assert_eq!(activate_response.status(), StatusCode::OK);

    let recent_vitals_recorded_at = Utc::now() - Duration::hours(1);
    let stale_vitals_recorded_at = Utc::now() - Duration::hours(72);

    let vitals_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/vitals")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "recorded_at": recent_vitals_recorded_at.to_rfc3339(),
                        "temperature_c": 37.5,
                        "systolic_bp": 120,
                        "diastolic_bp": 80,
                        "pulse": 88,
                        "respiratory_rate": 18,
                        "oxygen_saturation": 98
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("vitals create succeeds");
    assert_eq!(vitals_response.status(), StatusCode::OK);
    let vitals_body = json_body(vitals_response).await;
    assert_eq!(vitals_body["data"]["temperature_c"], 37.5);

    let stale_vitals_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/vitals")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "recorded_at": stale_vitals_recorded_at.to_rfc3339(),
                        "temperature_c": 36.8,
                        "systolic_bp": 118,
                        "diastolic_bp": 76,
                        "pulse": 72,
                        "respiratory_rate": 16,
                        "oxygen_saturation": 99
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stale vitals create succeeds");
    assert_eq!(stale_vitals_response.status(), StatusCode::OK);

    let vitals_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/nursing/vitals?limit=10&patient_id={patient_id}&admission_case_id={admission_case_id}&hours=48"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("vitals list succeeds");
    assert_eq!(vitals_list.status(), StatusCode::OK);
    let vitals_list_body = json_body(vitals_list).await;
    assert_eq!(vitals_list_body["page"]["limit"], 10);
    assert_eq!(vitals_list_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        vitals_list_body["data"][0]["patient_id"].as_str().unwrap(),
        patient_id
    );

    let alert_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/alerts")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "severity": "high",
                        "title": "High fever watch"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("alert create succeeds");
    assert_eq!(alert_response.status(), StatusCode::OK);
    let alert_body = json_body(alert_response).await;
    assert_eq!(alert_body["data"]["status"], "open");
    let alert_id = alert_body["data"]["id"].as_str().expect("alert id exists");

    let acknowledge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/nursing/alerts/{alert_id}/acknowledge"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("alert acknowledge succeeds");
    assert_eq!(acknowledge_response.status(), StatusCode::OK);
    let acknowledge_body = json_body(acknowledge_response).await;
    assert_eq!(acknowledge_body["data"]["status"], "acknowledged");

    let monitoring_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/monitoring-events")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "event_kind": "observation",
                        "summary": "Hourly observation completed",
                        "recorded_at": "2026-05-10T09:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("monitoring event create succeeds");
    assert_eq!(monitoring_response.status(), StatusCode::OK);

    let fluid_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/fluid-balance")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "recorded_at": "2026-05-10T10:00:00Z",
                        "intake_ml": 500,
                        "output_ml": 150
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("fluid balance create succeeds");
    assert_eq!(fluid_response.status(), StatusCode::OK);
    let fluid_body = json_body(fluid_response).await;
    assert_eq!(fluid_body["data"]["net_ml"], 350);

    let stock_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/ward-stock-requests")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "ward_id": ward_id,
                        "requested_item": "IV cannula",
                        "quantity_requested": 10
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock request create succeeds");
    assert_eq!(stock_response.status(), StatusCode::OK);
    let stock_body = json_body(stock_response).await;
    let stock_request_id = stock_body["data"]["id"]
        .as_str()
        .expect("stock request id exists");
    assert_eq!(stock_body["data"]["status"], "requested");

    let approve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/nursing/ward-stock-requests/{stock_request_id}/approve"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock approve succeeds");
    assert_eq!(approve_response.status(), StatusCode::OK);
    let approve_body = json_body(approve_response).await;
    assert_eq!(approve_body["data"]["status"], "approved");

    let fulfill_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/nursing/ward-stock-requests/{stock_request_id}/fulfill"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stock fulfill succeeds");
    assert_eq!(fulfill_response.status(), StatusCode::OK);
    let fulfill_body = json_body(fulfill_response).await;
    assert_eq!(fulfill_body["data"]["status"], "fulfilled");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/nursing/vitals?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("nursing denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
