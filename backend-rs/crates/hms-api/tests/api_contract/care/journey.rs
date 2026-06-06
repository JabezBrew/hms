use super::*;

#[tokio::test]
async fn care_area_intake_resolves_identity_without_changing_patient_record_status() {
    let app = app().await;
    let owner = Actor::login(&app, "owner@hms.local").await;

    let patient_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/patients",
            json!({
                "first_name": "Intake",
                "last_name": "Contractprobe",
                "date_of_birth": "1992-04-12",
                "sex": "female"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let patient_id = patient_body["data"]["id"]
        .as_str()
        .expect("patient id exists")
        .to_owned();
    assert_eq!(patient_body["data"]["record_status"], "registered");
    assert_eq!(patient_body["data"]["vital_status"], "presumed_alive");

    let clinics_body = assert_json_status(
        api_get(app.clone(), &owner, "/api/v2/clinics?limit=1").await,
        StatusCode::OK,
    )
    .await;
    let clinic_id = clinics_body["data"][0]["id"]
        .as_str()
        .expect("clinic id exists")
        .to_owned();

    let outpatient_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/outpatient/intake",
            json!({
                "patient_id": patient_id,
                "clinic_id": clinic_id,
                "idempotency_key": "care-intake-contract-opd"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let visit_id = outpatient_body["data"]["visit"]["id"]
        .as_str()
        .expect("outpatient visit id exists")
        .to_owned();
    assert_eq!(outpatient_body["data"]["patient_id"], patient_id);
    assert_eq!(outpatient_body["data"]["visit"]["clinic_id"], clinic_id);
    assert_eq!(outpatient_body["data"]["visit"]["status"], "waiting");

    let repeated_outpatient_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/outpatient/intake",
            json!({
                "patient_id": patient_id,
                "clinic_id": clinic_id,
                "idempotency_key": "care-intake-contract-opd"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(repeated_outpatient_body["data"]["visit"]["id"], visit_id);

    let contexts_body = assert_json_status(
        api_get(
            app.clone(),
            &owner,
            format!("/api/v2/patients/{patient_id}/current-contexts"),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(contexts_body["data"]["patient_id"], patient_id);
    assert!(contexts_body["data"]["outpatient"]
        .as_array()
        .expect("outpatient contexts are listed")
        .iter()
        .any(|item| item["visit_id"] == visit_id && item["clinic_id"] == clinic_id));

    let checkout_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            format!("/api/v2/visits/{visit_id}/checkout"),
            json!({}),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(checkout_body["data"]["status"], "checked_out");

    let patient_after_checkout = assert_json_status(
        api_get(
            app.clone(),
            &owner,
            format!("/api/v2/patients/{patient_id}"),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        patient_after_checkout["data"]["record_status"],
        "registered"
    );
    assert_eq!(
        patient_after_checkout["data"]["vital_status"],
        "presumed_alive"
    );

    let emergency_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/emergency/intake",
            json!({
                "patient_id": patient_id,
                "clinic_id": clinic_id,
                "acuity": "urgent",
                "idempotency_key": "care-intake-contract-ed"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let triage_id = emergency_body["data"]["triage"]["id"]
        .as_str()
        .expect("triage id exists")
        .to_owned();
    assert_eq!(emergency_body["data"]["triage"]["status"], "waiting");
    assert_eq!(emergency_body["data"]["triage"]["acuity"], "urgent");

    let triage_assessment = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            format!("/api/v2/triage/{triage_id}/assessment"),
            json!({
                "acuity": "urgent",
                "notes": "Synthetic contract note."
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(triage_assessment["data"]["status"], "completed");

    let patient_after_emergency_completion = assert_json_status(
        api_get(
            app.clone(),
            &owner,
            format!("/api/v2/patients/{patient_id}"),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        patient_after_emergency_completion["data"]["record_status"],
        "registered"
    );
    assert_eq!(
        patient_after_emergency_completion["data"]["vital_status"],
        "presumed_alive"
    );

    let second_emergency_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/emergency/intake",
            json!({
                "patient_id": patient_id,
                "clinic_id": clinic_id,
                "acuity": "urgent",
                "idempotency_key": "care-intake-contract-ed-after-complete"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_ne!(second_emergency_body["data"]["triage"]["id"], triage_id);
    assert_eq!(second_emergency_body["data"]["triage"]["status"], "waiting");

    let wards_body = assert_json_status(
        api_get(app.clone(), &owner, "/api/v2/wards?limit=1").await,
        StatusCode::OK,
    )
    .await;
    let ward_id = wards_body["data"][0]["id"]
        .as_str()
        .expect("ward id exists")
        .to_owned();
    let second_ward_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/wards",
            json!({
                "code": "INTAKE-XFER",
                "name": "Intake Transfer Probe"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let second_ward_id = second_ward_body["data"]["id"]
        .as_str()
        .expect("second ward id exists")
        .to_owned();
    let inpatient_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/inpatient/intake",
            json!({
                "patient_id": patient_id,
                "ward_id": ward_id,
                "idempotency_key": "care-intake-contract-ipd"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let admission_case_id = inpatient_body["data"]["admission_case"]["id"]
        .as_str()
        .expect("admission case id exists")
        .to_owned();
    assert_eq!(inpatient_body["data"]["patient_id"], patient_id);
    assert_eq!(inpatient_body["data"]["admission_case"]["ward_id"], ward_id);
    assert_eq!(
        inpatient_body["data"]["admission_case"]["status"],
        "ready_for_activation"
    );

    let repeated_inpatient_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/inpatient/intake",
            json!({
                "patient_id": patient_id,
                "ward_id": ward_id,
                "idempotency_key": "care-intake-contract-ipd"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        repeated_inpatient_body["data"]["admission_case"]["id"],
        admission_case_id
    );

    let cross_ward_inpatient_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/inpatient/intake",
            json!({
                "patient_id": patient_id,
                "ward_id": second_ward_id,
                "idempotency_key": "care-intake-contract-ipd-second-ward"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        cross_ward_inpatient_body["data"]["admission_case"]["id"],
        admission_case_id
    );
    assert_eq!(
        cross_ward_inpatient_body["data"]["admission_case"]["ward_id"],
        ward_id
    );
}

#[tokio::test]
async fn care_area_intake_blocks_special_patient_records() {
    let app = app().await;
    let owner = Actor::login(&app, "owner@hms.local").await;

    let deceased_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/patients",
            json!({
                "first_name": "Deceased",
                "last_name": "Intakeprobe",
                "date_of_birth": "1942-11-05",
                "sex": "male"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let deceased_patient_id = deceased_body["data"]["id"]
        .as_str()
        .expect("deceased patient id exists")
        .to_owned();
    let patched_deceased = assert_json_status(
        api_patch_json(
            app.clone(),
            &owner,
            format!("/api/v2/patients/{deceased_patient_id}"),
            json!({
                "vital_status": "deceased",
                "status_reason_code": "contract_test"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(patched_deceased["data"]["record_status"], "registered");
    assert_eq!(patched_deceased["data"]["vital_status"], "deceased");

    let deceased_intake = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/emergency/intake",
            json!({
                "patient_id": deceased_patient_id,
                "acuity": "urgent",
                "idempotency_key": "deceased-intake-contract"
            }),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        deceased_intake["error"]["code"],
        "patient_deceased_intake_blocked"
    );

    let restricted_body = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/patients",
            json!({
                "first_name": "Restricted",
                "last_name": "Intakeprobe",
                "date_of_birth": "1980-08-03",
                "sex": "female"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    let restricted_patient_id = restricted_body["data"]["id"]
        .as_str()
        .expect("restricted patient id exists")
        .to_owned();
    let patched_restricted = assert_json_status(
        api_patch_json(
            app.clone(),
            &owner,
            format!("/api/v2/patients/{restricted_patient_id}"),
            json!({
                "record_status": "restricted",
                "status_reason_code": "contract_test"
            }),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(patched_restricted["data"]["record_status"], "restricted");
    assert_eq!(patched_restricted["data"]["vital_status"], "presumed_alive");

    let clinics_body = assert_json_status(
        api_get(app.clone(), &owner, "/api/v2/clinics?limit=1").await,
        StatusCode::OK,
    )
    .await;
    let clinic_id = clinics_body["data"][0]["id"]
        .as_str()
        .expect("clinic id exists")
        .to_owned();

    let restricted_intake = assert_json_status(
        api_post_json(
            app.clone(),
            &owner,
            "/api/v2/care-areas/outpatient/intake",
            json!({
                "patient_id": restricted_patient_id,
                "clinic_id": clinic_id,
                "idempotency_key": "restricted-intake-contract"
            }),
        )
        .await,
        StatusCode::CONFLICT,
    )
    .await;
    assert_eq!(
        restricted_intake["error"]["code"],
        "patient_restricted_intake_blocked"
    );
}

#[tokio::test]
async fn care_workflows_use_cursor_lists_and_patient_scoped_access() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);

    let clinics = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/clinics?limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinics list succeeds");
    assert_eq!(clinics.status(), StatusCode::OK);
    let clinics_body = json_body(clinics).await;
    assert_eq!(clinics_body["page"]["limit"], 10);
    assert_eq!(clinics_body["data"][0]["code"], "general");
    assert_eq!(clinics_body["data"][0]["name"], "General Clinic");
    assert_eq!(clinics_body["data"][0]["is_active"], true);
    let clinic_id = clinics_body["data"][0]["id"]
        .as_str()
        .expect("clinic id exists");

    let appointment_types = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/appointment-types?limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("appointment types list succeeds");
    assert_eq!(appointment_types.status(), StatusCode::OK);
    let appointment_types_body = json_body(appointment_types).await;
    assert_eq!(appointment_types_body["page"]["limit"], 10);
    assert_eq!(appointment_types_body["data"][0]["code"], "general");
    assert_eq!(appointment_types_body["data"][0]["name"], "General");
    assert_eq!(
        appointment_types_body["data"][0]["default_duration_minutes"],
        30
    );

    let clinic_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinics/{clinic_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinic detail succeeds");
    assert_eq!(clinic_detail.status(), StatusCode::OK);
    let clinic_detail_body = json_body(clinic_detail).await;
    assert_eq!(clinic_detail_body["data"]["id"], clinic_id);
    assert_eq!(clinic_detail_body["data"]["code"], "general");
    assert_eq!(clinic_detail_body["data"]["name"], "General Clinic");

    let created_clinic = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/clinics")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "dermatology",
                        "name": "Dermatology"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("clinic create succeeds");
    assert_eq!(created_clinic.status(), StatusCode::OK);
    let created_clinic_body = json_body(created_clinic).await;
    let managed_clinic_id = created_clinic_body["data"]["id"]
        .as_str()
        .expect("managed clinic id exists");
    assert_eq!(created_clinic_body["data"]["code"], "dermatology");
    assert_eq!(created_clinic_body["data"]["name"], "Dermatology");
    assert_eq!(created_clinic_body["data"]["is_active"], true);

    let updated_clinic = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinics/{managed_clinic_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Skin Clinic",
                        "is_active": false
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("clinic update succeeds");
    assert_eq!(updated_clinic.status(), StatusCode::OK);
    let updated_clinic_body = json_body(updated_clinic).await;
    assert_eq!(updated_clinic_body["data"]["id"], managed_clinic_id);
    assert_eq!(updated_clinic_body["data"]["name"], "Skin Clinic");
    assert_eq!(updated_clinic_body["data"]["is_active"], false);

    let deleted_clinic = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v2/clinics/{managed_clinic_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinic delete succeeds");
    assert_eq!(deleted_clinic.status(), StatusCode::OK);
    let deleted_clinic_body = json_body(deleted_clinic).await;
    assert_eq!(deleted_clinic_body["data"]["id"], managed_clinic_id);
    assert_eq!(deleted_clinic_body["data"]["is_active"], false);

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
        .expect("patient id exists");

    let appointment_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/appointments")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "starts_at": "2026-05-10T10:00:00Z",
                        "ends_at": "2026-05-10T10:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("appointment create succeeds");
    assert_eq!(appointment_response.status(), StatusCode::OK);
    let appointment_body = json_body(appointment_response).await;
    let appointment_id = appointment_body["data"]["id"]
        .as_str()
        .expect("appointment id exists");
    assert_eq!(appointment_body["data"]["status"], "scheduled");

    let appointment_detail = app
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
    assert_eq!(appointment_detail.status(), StatusCode::OK);
    let appointment_detail_body = json_body(appointment_detail).await;
    assert_eq!(appointment_detail_body["data"]["id"], appointment_id);
    assert_eq!(appointment_detail_body["data"]["patient_id"], patient_id);

    let appointment_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/appointments/{appointment_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "starts_at": "2026-05-10T11:00:00Z",
                        "ends_at": "2026-05-10T11:45:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("appointment update succeeds");
    assert_eq!(appointment_update.status(), StatusCode::OK);
    let appointment_update_body = json_body(appointment_update).await;
    assert_eq!(
        appointment_update_body["data"]["starts_at"],
        "2026-05-10T11:00:00Z"
    );

    let appointments = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/appointments?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("appointments list succeeds");
    assert_eq!(appointments.status(), StatusCode::OK);
    let appointments_body = json_body(appointments).await;
    assert_eq!(appointments_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(appointments_body["page"]["limit"], 1);

    let off_date_appointment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/appointments")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "starts_at": "2026-05-09T09:00:00Z",
                        "ends_at": "2026-05-09T09:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("off-date appointment create succeeds");
    assert_eq!(off_date_appointment.status(), StatusCode::OK);
    let off_date_appointment_body = json_body(off_date_appointment).await;
    let off_date_appointment_id = off_date_appointment_body["data"]["id"]
        .as_str()
        .expect("off-date appointment id exists");

    let date_filtered_appointments = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/appointments?date=2026-05-10&limit=20")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("date-filtered appointments list succeeds");
    assert_eq!(date_filtered_appointments.status(), StatusCode::OK);
    let date_filtered_body = json_body(date_filtered_appointments).await;
    let date_filtered_items = date_filtered_body["data"]
        .as_array()
        .expect("date-filtered appointments are listed");
    assert!(date_filtered_items
        .iter()
        .any(|item| item["id"] == appointment_id));
    assert!(!date_filtered_items
        .iter()
        .any(|item| item["id"] == off_date_appointment_id));
    assert!(date_filtered_items.iter().all(|item| item["starts_at"]
        .as_str()
        .expect("starts_at is a string")
        .starts_with("2026-05-10")));

    let today = Utc::now().date_naive();
    let practitioner_appointment_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/appointments")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "practitioner_user_id": owner_id,
                        "starts_at": format!("{today}T09:00:00Z"),
                        "ends_at": format!("{today}T09:30:00Z")
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("practitioner appointment create succeeds");
    assert_eq!(practitioner_appointment_response.status(), StatusCode::OK);
    let practitioner_appointment_body = json_body(practitioner_appointment_response).await;
    let practitioner_appointment_id = practitioner_appointment_body["data"]["id"]
        .as_str()
        .expect("practitioner appointment id exists");

    let practitioner_filtered_appointments = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/appointments?date={today}&practitioner_user_id={owner_id}&limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner-filtered appointments list succeeds");
    assert_eq!(practitioner_filtered_appointments.status(), StatusCode::OK);
    let practitioner_filtered_body = json_body(practitioner_filtered_appointments).await;
    assert!(practitioner_filtered_body["data"]
        .as_array()
        .expect("practitioner appointments listed")
        .iter()
        .any(|item| item["id"] == practitioner_appointment_id));

    let other_practitioner_appointments = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/appointments?date={today}&practitioner_user_id={}&limit=10",
                    Uuid::new_v4()
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("other practitioner appointments list succeeds");
    assert_eq!(other_practitioner_appointments.status(), StatusCode::OK);
    let other_practitioner_body = json_body(other_practitioner_appointments).await;
    assert_eq!(
        other_practitioner_body["data"]
            .as_array()
            .expect("other practitioner appointments are listed")
            .len(),
        0
    );

    let appointment_to_cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/appointments")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "starts_at": "2026-05-10T12:00:00Z",
                        "ends_at": "2026-05-10T12:30:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancel appointment create succeeds");
    assert_eq!(appointment_to_cancel.status(), StatusCode::OK);
    let appointment_to_cancel_body = json_body(appointment_to_cancel).await;
    let appointment_to_cancel_id = appointment_to_cancel_body["data"]["id"]
        .as_str()
        .expect("cancel appointment id exists");

    let visit_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/visits/check-in")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "appointment_id": appointment_id,
                        "clinic_id": clinic_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("visit check-in succeeds");
    assert_eq!(visit_response.status(), StatusCode::OK);
    let visit_body = json_body(visit_response).await;
    let visit_id = visit_body["data"]["id"].as_str().expect("visit id exists");
    assert_eq!(visit_body["data"]["status"], "waiting");
    assert_eq!(visit_body["data"]["clinic_id"], clinic_id);

    for (path, expected_status) in [
        (format!("/api/v2/visits/{visit_id}/call"), "called"),
        (
            format!("/api/v2/visits/{visit_id}/start-consultation"),
            "in_consultation",
        ),
        (format!("/api/v2/visits/{visit_id}/hold"), "on_hold"),
        (
            format!("/api/v2/visits/{visit_id}/ready-checkout"),
            "ready_checkout",
        ),
        (format!("/api/v2/visits/{visit_id}/checkout"), "checked_out"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(path)
                    .header(AUTHORIZATION, auth_header.clone())
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("visit update succeeds");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["status"], expected_status);
    }

    let visits = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/visits?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("visits list succeeds");
    assert_eq!(visits.status(), StatusCode::OK);
    let visits_body = json_body(visits).await;
    assert_eq!(visits_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(visits_body["data"][0]["clinic_id"], clinic_id);

    let filtered_visits = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/visits?limit=10&clinic_id={clinic_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinic-filtered visits list succeeds");
    assert_eq!(filtered_visits.status(), StatusCode::OK);
    let filtered_visits_body = json_body(filtered_visits).await;
    assert_eq!(filtered_visits_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(filtered_visits_body["data"][0]["id"], visit_id);

    let active_visits = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/visits?limit=10&clinic_id={clinic_id}&active_only=true"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("active clinic visits list succeeds");
    assert_eq!(active_visits.status(), StatusCode::OK);
    let active_visits_body = json_body(active_visits).await;
    assert_eq!(active_visits_body["data"].as_array().unwrap().len(), 0);

    let other_clinic_visits = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/visits?limit=10&clinic_id={}",
                    Uuid::new_v4()
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("other clinic visits list succeeds");
    assert_eq!(other_clinic_visits.status(), StatusCode::OK);
    let other_clinic_visits_body = json_body(other_clinic_visits).await;
    assert_eq!(
        other_clinic_visits_body["data"].as_array().unwrap().len(),
        0
    );

    let no_show_visit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/visits/check-in")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "clinic_id": clinic_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("no-show visit check-in succeeds");
    assert_eq!(no_show_visit.status(), StatusCode::OK);
    let no_show_visit_body = json_body(no_show_visit).await;
    let no_show_visit_id = no_show_visit_body["data"]["id"]
        .as_str()
        .expect("no-show visit id exists");
    let no_show_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/visits/{no_show_visit_id}/no-show"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("visit no-show succeeds");
    assert_eq!(no_show_response.status(), StatusCode::OK);
    let no_show_body = json_body(no_show_response).await;
    assert_eq!(no_show_body["data"]["status"], "no_show");

    let triage_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/triage")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "visit_id": visit_id,
                        "acuity": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("triage create succeeds");
    assert_eq!(triage_response.status(), StatusCode::OK);
    let triage_body = json_body(triage_response).await;
    let triage_id = triage_body["data"]["id"]
        .as_str()
        .expect("triage id exists");
    assert_eq!(triage_body["data"]["status"], "waiting");

    let triage_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/triage/{triage_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("triage detail succeeds");
    assert_eq!(triage_detail.status(), StatusCode::OK);
    let triage_detail_body = json_body(triage_detail).await;
    assert_eq!(triage_detail_body["data"]["id"], triage_id);
    assert_eq!(triage_detail_body["data"]["patient_id"], patient_id);
    assert!(triage_detail_body["data"]["encounter_id"].is_null());

    let triage_assign = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/triage/{triage_id}/assign"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "assigned_to_user_id": owner_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("triage assignment succeeds");
    assert_eq!(triage_assign.status(), StatusCode::OK);
    let triage_assign_body = json_body(triage_assign).await;
    assert_eq!(triage_assign_body["data"]["status"], "assigned");
    assert_eq!(
        triage_assign_body["data"]["assigned_to_user_id"],
        owner_id.to_string()
    );
    assert!(triage_assign_body["data"]["assigned_to_name"].is_string());

    let assigned_triage = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/triage?assigned_to_user_id={owner_id}&limit=10"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("assigned triage list succeeds");
    assert_eq!(assigned_triage.status(), StatusCode::OK);
    let assigned_triage_body = json_body(assigned_triage).await;
    assert!(assigned_triage_body["data"]
        .as_array()
        .expect("assigned triage rows exist")
        .iter()
        .any(|item| item["id"] == triage_id));

    let assessment_visit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/visits/check-in")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "clinic_id": clinic_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("assessment visit check-in succeeds");
    assert_eq!(assessment_visit.status(), StatusCode::OK);
    let assessment_visit_body = json_body(assessment_visit).await;
    let assessment_visit_id = assessment_visit_body["data"]["id"]
        .as_str()
        .expect("assessment visit id exists");

    let assessment_triage = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/triage")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "visit_id": assessment_visit_id,
                        "acuity": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("assessment triage create succeeds");
    assert_eq!(assessment_triage.status(), StatusCode::OK);
    let assessment_triage_body = json_body(assessment_triage).await;
    let assessment_triage_id = assessment_triage_body["data"]["id"]
        .as_str()
        .expect("assessment triage id exists");

    let triage_assessment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/triage/{assessment_triage_id}/assessment"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "acuity": "emergency",
                        "notes": "Chest pain and diaphoresis."
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("triage assessment succeeds");
    assert_eq!(triage_assessment.status(), StatusCode::OK);
    let triage_assessment_body = json_body(triage_assessment).await;
    assert_eq!(triage_assessment_body["data"]["status"], "completed");
    assert_eq!(triage_assessment_body["data"]["acuity"], "emergency");
    assert_eq!(
        triage_assessment_body["data"]["triage_notes"],
        "Chest pain and diaphoresis."
    );

    let completed_triage_assign = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/triage/{assessment_triage_id}/assign"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "assigned_to_user_id": owner_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("completed triage assignment is rejected");
    assert_eq!(completed_triage_assign.status(), StatusCode::CONFLICT);

    let cancellable_visit = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/visits/check-in")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "clinic_id": clinic_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable visit check-in succeeds");
    assert_eq!(cancellable_visit.status(), StatusCode::OK);
    let cancellable_visit_body = json_body(cancellable_visit).await;
    let cancellable_visit_id = cancellable_visit_body["data"]["id"]
        .as_str()
        .expect("visit id exists");

    let cancellable_triage = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/triage")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "visit_id": cancellable_visit_id,
                        "acuity": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable triage create succeeds");
    assert_eq!(cancellable_triage.status(), StatusCode::OK);
    let cancellable_triage_body = json_body(cancellable_triage).await;
    let cancellable_triage_id = cancellable_triage_body["data"]["id"]
        .as_str()
        .expect("triage id exists");

    let triage_cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/triage/{cancellable_triage_id}/cancel"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("triage cancellation succeeds");
    assert_eq!(triage_cancel.status(), StatusCode::OK);
    let triage_cancel_body = json_body(triage_cancel).await;
    assert_eq!(triage_cancel_body["data"]["status"], "cancelled");

    let cancelled_triage_assign = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/triage/{cancellable_triage_id}/assign"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "assigned_to_user_id": owner_id }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancelled triage assignment is rejected");
    assert_eq!(cancelled_triage_assign.status(), StatusCode::CONFLICT);

    let encounter_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/encounters")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "visit_id": visit_id,
                        "encounter_type": "outpatient"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("encounter create succeeds");
    assert_eq!(encounter_response.status(), StatusCode::OK);
    let encounter_body = json_body(encounter_response).await;
    let encounter_id = encounter_body["data"]["id"]
        .as_str()
        .expect("encounter id exists");
    assert_eq!(encounter_body["data"]["status"], "in_progress");

    let visit_with_encounter = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/visits/{visit_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("visit detail with encounter succeeds");
    assert_eq!(visit_with_encounter.status(), StatusCode::OK);
    let visit_with_encounter_body = json_body(visit_with_encounter).await;
    assert_eq!(
        visit_with_encounter_body["data"]["encounter_id"],
        encounter_id
    );

    let triage_with_encounter = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/triage/{triage_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("triage detail with encounter succeeds");
    assert_eq!(triage_with_encounter.status(), StatusCode::OK);
    let triage_with_encounter_body = json_body(triage_with_encounter).await;
    assert_eq!(
        triage_with_encounter_body["data"]["encounter_id"],
        encounter_id
    );

    let my_work = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/care-areas/my-work")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("my work summary succeeds");
    assert_eq!(my_work.status(), StatusCode::OK);
    let my_work_body = json_body(my_work).await;
    assert!(my_work_body["data"]["outpatient"]["appointments"]
        .as_array()
        .expect("my work outpatient appointments are listed")
        .iter()
        .any(|item| item["id"] == practitioner_appointment_id));
    assert!(my_work_body["data"]["emergency"]["assigned_triage"]
        .as_array()
        .expect("my work assigned triage is listed")
        .iter()
        .any(|item| item["id"] == triage_id && item["encounter_id"] == encounter_id));
    assert!(!my_work_body["data"]["emergency"]["assigned_triage"]
        .as_array()
        .expect("my work assigned triage is listed")
        .iter()
        .any(|item| item["id"] == assessment_triage_id));
    assert!(my_work_body["data"]["inpatient"]["assigned_wards"].is_array());
    assert!(my_work_body["data"]["patient_context"]["recent_patients"].is_array());

    let encounter_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/encounters/{encounter_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounter detail succeeds");
    assert_eq!(encounter_detail.status(), StatusCode::OK);
    let encounter_detail_body = json_body(encounter_detail).await;
    assert_eq!(encounter_detail_body["data"]["patient_id"], patient_id);

    let encounter_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/encounters/{encounter_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "encounter_type": "emergency"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("encounter update succeeds");
    assert_eq!(encounter_update.status(), StatusCode::OK);
    let encounter_update_body = json_body(encounter_update).await;
    assert_eq!(encounter_update_body["data"]["encounter_type"], "emergency");

    let care_team = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/encounters/{encounter_id}/care-team"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "user_id": owner_id,
                        "role": "primary_clinician"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("care-team assignment succeeds");
    assert_eq!(care_team.status(), StatusCode::OK);

    let care_team_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/encounters/{encounter_id}/care-team"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("care-team list succeeds");
    assert_eq!(care_team_list.status(), StatusCode::OK);
    let care_team_body = json_body(care_team_list).await;
    assert_eq!(care_team_body["data"].as_array().unwrap().len(), 1);

    let complete = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/encounters/{encounter_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounter complete succeeds");
    assert_eq!(complete.status(), StatusCode::OK);
    let complete_body = json_body(complete).await;
    assert_eq!(complete_body["data"]["status"], "completed");

    let encounters = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/encounters?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounters list succeeds");
    assert_eq!(encounters.status(), StatusCode::OK);

    let patient_encounters = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/encounters?limit=10&patient_id={patient_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient encounters list succeeds");
    assert_eq!(patient_encounters.status(), StatusCode::OK);
    let patient_encounters_body = json_body(patient_encounters).await;
    assert_eq!(patient_encounters_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(patient_encounters_body["data"][0]["patient_id"], patient_id);

    let missing_patient_id = Uuid::new_v4();
    let missing_patient_encounters = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/encounters?limit=10&patient_id={missing_patient_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("missing patient encounter list succeeds");
    assert_eq!(missing_patient_encounters.status(), StatusCode::NOT_FOUND);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied_patient_encounters = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/encounters?limit=10&patient_id={patient_id}"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("patient encounter list denial succeeds");
    assert_eq!(denied_patient_encounters.status(), StatusCode::FORBIDDEN);

    let denied_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/appointments/{appointment_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("appointment detail denial succeeds");
    assert_eq!(denied_detail.status(), StatusCode::FORBIDDEN);

    let denied_encounter_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/encounters/{encounter_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounter detail denial succeeds");
    assert_eq!(denied_encounter_detail.status(), StatusCode::FORBIDDEN);

    let cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/appointments/{appointment_to_cancel_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "reason": "Patient requested cancellation" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("appointment cancel succeeds");
    assert_eq!(cancel.status(), StatusCode::OK);
    let cancel_body = json_body(cancel).await;
    assert_eq!(cancel_body["data"]["status"], "cancelled");

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/appointments?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("care list denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let denied_my_work = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/care-areas/my-work")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("my work denial succeeds");
    assert_eq!(denied_my_work.status(), StatusCode::FORBIDDEN);
}
