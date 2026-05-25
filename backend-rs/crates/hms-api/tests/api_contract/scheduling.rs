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

    let unknown_clinic_id = Uuid::new_v4();
    let invalid_session_clinic = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/sessions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "clinic_id": unknown_clinic_id,
                        "owner_type": "clinic",
                        "owner_id": unknown_clinic_id,
                        "name": "Unknown clinic block",
                        "mode": "capacity_block",
                        "starts_at": "2026-06-01T08:00:00Z",
                        "ends_at": "2026-06-01T12:00:00Z",
                        "capacity": 1
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("unknown clinic session is handled");
    assert_eq!(invalid_session_clinic.status(), StatusCode::BAD_REQUEST);

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
    let session_slot = availability_body["data"]["slots"]
        .as_array()
        .expect("availability slots are an array")
        .iter()
        .find(|slot| slot["session_id"] == session_id)
        .expect("created session slot is returned");
    assert_eq!(session_slot["status"], "free");
    assert_eq!(session_slot["capacity"]["remaining"], 1);

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

    let practitioner_user_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let unknown_practitioner_user_id = Uuid::new_v4();
    let invalid_session_practitioner = app
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
                        "practitioner_user_id": unknown_practitioner_user_id,
                        "owner_type": "practitioner",
                        "owner_id": unknown_practitioner_user_id,
                        "name": "Unknown practitioner block",
                        "mode": "capacity_block",
                        "starts_at": "2026-06-04T08:00:00Z",
                        "ends_at": "2026-06-04T12:00:00Z",
                        "capacity": 1,
                        "allowed_service_ids": [service_id]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("unknown practitioner session is handled");
    assert_eq!(
        invalid_session_practitioner.status(),
        StatusCode::BAD_REQUEST
    );

    let practitioner_session = app
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
                        "practitioner_user_id": practitioner_user_id,
                        "owner_type": "practitioner",
                        "owner_id": practitioner_user_id,
                        "name": "Practitioner exception block",
                        "mode": "capacity_block",
                        "starts_at": "2026-06-04T08:00:00Z",
                        "ends_at": "2026-06-04T12:00:00Z",
                        "capacity": 1,
                        "allowed_service_ids": [service_id]
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("practitioner session create succeeds");
    assert_eq!(practitioner_session.status(), StatusCode::OK);
    let practitioner_session_body = json_body(practitioner_session).await;
    let practitioner_session_id = practitioner_session_body["data"]["id"]
        .as_str()
        .expect("practitioner session id exists");

    let invalid_exception_scope = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/exceptions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "starts_at": "2026-06-04T09:00:00Z",
                        "ends_at": "2026-06-04T10:00:00Z",
                        "reason": "Missing exception target"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("missing exception target is handled");
    assert_eq!(invalid_exception_scope.status(), StatusCode::BAD_REQUEST);

    let invalid_exception_session = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/exceptions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "session_id": Uuid::new_v4(),
                        "starts_at": "2026-06-04T09:00:00Z",
                        "ends_at": "2026-06-04T10:00:00Z",
                        "reason": "Unknown session"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("unknown session exception is handled");
    assert_eq!(invalid_exception_session.status(), StatusCode::BAD_REQUEST);

    let exception = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/scheduling/exceptions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "practitioner_user_id": practitioner_user_id,
                        "starts_at": "2026-06-04T09:00:00Z",
                        "ends_at": "2026-06-04T10:00:00Z",
                        "reason": "Practitioner unavailable"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("exception create succeeds");
    assert_eq!(exception.status(), StatusCode::OK);
    let exception_body = json_body(exception).await;
    let exception_id = exception_body["data"]["id"]
        .as_str()
        .expect("exception id exists");

    let exception_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/scheduling/exceptions?start_date=2026-06-04&end_date=2026-06-04&practitioner_user_id={practitioner_user_id}&limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("exception list succeeds");
    assert_eq!(exception_list.status(), StatusCode::OK);
    let exception_list_body = json_body(exception_list).await;
    let listed_exception = exception_list_body["data"]
        .as_array()
        .expect("exception data is an array")
        .iter()
        .find(|item| item["id"] == exception_id)
        .expect("created exception is listed");
    assert_eq!(listed_exception["reason"], "Practitioner unavailable");

    let unavailable = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/scheduling/availability?start_date=2026-06-04&practitioner_user_id={practitioner_user_id}&limit=20"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("exception availability succeeds");
    assert_eq!(unavailable.status(), StatusCode::OK);
    let unavailable_body = json_body(unavailable).await;
    let practitioner_slot = unavailable_body["data"]["slots"]
        .as_array()
        .expect("availability slots are an array")
        .iter()
        .find(|slot| slot["session_id"] == practitioner_session_id)
        .expect("practitioner session slot is returned");
    assert_eq!(practitioner_slot["status"], "busy-unavailable");

    let practitioner_exception_booking = app
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
                        "session_id": practitioner_session_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-04T09:15:00Z",
                        "ends_at": "2026-06-04T09:45:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("practitioner exception booking denial succeeds");
    assert_eq!(
        practitioner_exception_booking.status(),
        StatusCode::CONFLICT
    );

    let practitioner_appointment = app
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
                        "session_id": practitioner_session_id,
                        "clinic_id": clinic_id,
                        "starts_at": "2026-06-04T10:15:00Z",
                        "ends_at": "2026-06-04T10:45:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("practitioner session booking succeeds");
    assert_eq!(practitioner_appointment.status(), StatusCode::OK);
    let practitioner_appointment_body = json_body(practitioner_appointment).await;
    assert_eq!(
        practitioner_appointment_body["data"]["appointment"]["practitioner_user_id"],
        practitioner_user_id.to_string()
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
