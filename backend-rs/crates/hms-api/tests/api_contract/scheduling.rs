use super::*;

#[tokio::test]
async fn scheduling_sessions_are_backend_authoritative_and_arrivals_create_visits() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let services = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/scheduling/services?limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("services list succeeds");
    assert_eq!(services.status(), StatusCode::OK);
    let services_body = json_body(services).await;
    let service_id = services_body["data"][0]["id"]
        .as_str()
        .expect("service id exists");
    assert_eq!(services_body["data"][0]["code"], "general");

    let invalid_service = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/services")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "bad-duration",
                        "name": "Bad duration",
                        "default_duration_minutes": 0
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("invalid service duration is handled");
    assert_eq!(invalid_service.status(), StatusCode::BAD_REQUEST);

    let clinics = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/clinics?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinics list succeeds");
    assert_eq!(clinics.status(), StatusCode::OK);
    let clinics_body = json_body(clinics).await;
    let clinic_id = clinics_body["data"][0]["id"]
        .as_str()
        .expect("clinic id exists");

    let unknown_service_id = Uuid::new_v4();
    let invalid_session_service = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/sessions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "clinic_id": clinic_id,
                        "owner_type": "clinic",
                        "owner_id": clinic_id,
                        "name": "Invalid service block",
                        "mode": "capacity_block",
                        "starts_at": "2026-06-01T08:00:00Z",
                        "ends_at": "2026-06-01T12:00:00Z",
                        "capacity": 1,
                        "allowed_service_ids": [unknown_service_id]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("invalid session service is handled");
    assert_eq!(invalid_session_service.status(), StatusCode::BAD_REQUEST);

    let patients = app
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
    assert_eq!(patients.status(), StatusCode::OK);
    let patients_body = json_body(patients).await;
    let patient_id = patients_body["data"][0]["id"]
        .as_str()
        .expect("patient id exists");

    let session = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/sessions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "clinic_id": clinic_id,
                        "service_code": "general",
                        "owner_type": "clinic",
                        "owner_id": clinic_id,
                        "name": "General OPD morning block",
                        "mode": "capacity_block",
                        "starts_at": "2026-06-02T08:00:00Z",
                        "ends_at": "2026-06-02T12:00:00Z",
                        "capacity": 1,
                        "allow_overbooking": true,
                        "overbook_limit": 1,
                        "allowed_service_ids": [service_id]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("session create succeeds");
    assert_eq!(session.status(), StatusCode::OK);
    let session_body = json_body(session).await;
    let session_id = session_body["data"]["id"]
        .as_str()
        .expect("session id exists");
    assert_eq!(session_body["data"]["mode"], "capacity_block");
    assert_eq!(session_body["data"]["remaining_capacity"], 1);

    let availability = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/scheduling/availability?start_date=2026-06-02&clinic_id={clinic_id}&service_id={service_id}&limit=20"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("availability succeeds");
    assert_eq!(availability.status(), StatusCode::OK);
    let availability_body = json_body(availability).await;
    assert_eq!(
        availability_body["data"]["slots"][0]["session_id"],
        session_id
    );
    assert_eq!(availability_body["data"]["slots"][0]["status"], "free");
    assert_eq!(
        availability_body["data"]["slots"][0]["capacity"]["remaining"],
        1
    );

    let constrained_session_without_service = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/appointments/book")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "session_id": session_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-02T08:00:00Z",
                        "ends_at": "2026-06-02T08:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("constrained session booking denial succeeds");
    assert_eq!(
        constrained_session_without_service.status(),
        StatusCode::CONFLICT
    );

    let appointment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/appointments/book")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service_id": service_id,
                        "session_id": session_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-02T08:00:00Z",
                        "ends_at": "2026-06-02T08:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("booking succeeds");
    assert_eq!(appointment.status(), StatusCode::OK);
    let appointment_body = json_body(appointment).await;
    let appointment_id = appointment_body["data"]["appointment"]["id"]
        .as_str()
        .expect("appointment id exists");
    assert_eq!(
        appointment_body["data"]["appointment"]["clinic_session_id"],
        session_id
    );

    let capacity_block_without_overbook_reason = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/appointments/book")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service_id": service_id,
                        "session_id": session_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-02T09:00:00Z",
                        "ends_at": "2026-06-02T09:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("booking denial succeeds");
    assert_eq!(
        capacity_block_without_overbook_reason.status(),
        StatusCode::CONFLICT
    );

    let overbooked = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/appointments/book")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service_id": service_id,
                        "session_id": session_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-02T09:00:00Z",
                        "ends_at": "2026-06-02T09:30:00Z",
                        "overbook_reason": "Clinician approved urgent review"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("overbooking succeeds");
    assert_eq!(overbooked.status(), StatusCode::OK);
    let overbooked_body = json_body(overbooked).await;
    assert_eq!(
        overbooked_body["data"]["appointment"]["overbook_reason"],
        "Clinician approved urgent review"
    );

    let manual_without_reason = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/appointments/book")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service_id": service_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-03T10:00:00Z",
                        "ends_at": "2026-06-03T10:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("manual denial succeeds");
    assert_eq!(manual_without_reason.status(), StatusCode::BAD_REQUEST);

    let manual_with_unknown_service = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/appointments/book")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service_id": unknown_service_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-03T10:00:00Z",
                        "ends_at": "2026-06-03T10:30:00Z",
                        "manual_booking_reason": "Walk-in fallback approved by front desk lead"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("manual unknown service denial succeeds");
    assert_eq!(
        manual_with_unknown_service.status(),
        StatusCode::BAD_REQUEST
    );

    let manual = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/appointments/book")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service_id": service_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-03T10:00:00Z",
                        "ends_at": "2026-06-03T10:30:00Z",
                        "manual_booking_reason": "Walk-in fallback approved by front desk lead"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("manual booking succeeds");
    assert_eq!(manual.status(), StatusCode::OK);

    let arrival = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/scheduling/appointments/{appointment_id}/arrive"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "clinic_id": clinic_id }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("arrival succeeds");
    assert_eq!(arrival.status(), StatusCode::OK);
    let arrival_body = json_body(arrival).await;
    assert_eq!(arrival_body["data"]["appointment_id"], appointment_id);
    assert_eq!(arrival_body["data"]["status"], "waiting");

    let appointment_after_arrival = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/appointments/{appointment_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("appointment detail succeeds");
    assert_eq!(appointment_after_arrival.status(), StatusCode::OK);
    let appointment_after_arrival_body = json_body(appointment_after_arrival).await;
    assert_eq!(
        appointment_after_arrival_body["data"]["status"],
        "checked_in"
    );

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/scheduling/sessions?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("limited scheduling list denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
