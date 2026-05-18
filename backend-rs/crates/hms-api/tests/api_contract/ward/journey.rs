use super::*;

#[tokio::test]
async fn ward_admission_and_nursing_workflows_are_patient_access_scoped() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);

    let created_ward_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/wards")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "TEST-WARD",
                        "name": "Test Ward"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward create succeeds");
    assert_eq!(created_ward_response.status(), StatusCode::OK);
    let created_ward_body = json_body(created_ward_response).await;
    assert_eq!(created_ward_body["data"]["code"], "TEST-WARD");
    assert_eq!(created_ward_body["data"]["name"], "Test Ward");
    assert_eq!(created_ward_body["data"]["status"], "active");
    assert_eq!(created_ward_body["data"]["active_bed_count"], 0);
    let created_ward_id = created_ward_body["data"]["id"]
        .as_str()
        .expect("created ward id exists");
    let updated_ward_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/wards/{created_ward_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "TEST-WARD-RENAMED",
                        "name": "Renamed Test Ward",
                        "status": "inactive"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward update succeeds");
    assert_eq!(updated_ward_response.status(), StatusCode::OK);
    let updated_ward_body = json_body(updated_ward_response).await;
    assert_eq!(updated_ward_body["data"]["id"], created_ward_id);
    assert_eq!(updated_ward_body["data"]["code"], "TEST-WARD-RENAMED");
    assert_eq!(updated_ward_body["data"]["name"], "Renamed Test Ward");
    assert_eq!(updated_ward_body["data"]["status"], "inactive");

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
    let ward_id = ward_body["data"][0]["id"].as_str().expect("ward id exists");

    let ward_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/{ward_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward detail succeeds");
    assert_eq!(ward_detail.status(), StatusCode::OK);
    let ward_detail_body = json_body(ward_detail).await;
    assert_eq!(ward_detail_body["data"]["id"], ward_id);

    let section_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/wards/{ward_id}/sections"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "EAST",
                        "name": "East Section"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward section create succeeds");
    assert_eq!(section_response.status(), StatusCode::OK);
    let section_body = json_body(section_response).await;
    let section_id = section_body["data"]["id"]
        .as_str()
        .expect("section id exists");

    let bed_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/wards/{ward_id}/beds"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "section_id": section_id,
                        "bed_code": "E-99"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward bed create succeeds");
    assert_eq!(bed_response.status(), StatusCode::OK);
    let bed_body = json_body(bed_response).await;
    let bed_id = bed_body["data"]["id"].as_str().expect("bed id exists");
    assert_eq!(bed_body["data"]["status"], "available");
    let updated_bed_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/wards/beds/{bed_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "section_id": section_id,
                        "bed_code": "E-100",
                        "status": "cleaning"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward bed update succeeds");
    assert_eq!(updated_bed_response.status(), StatusCode::OK);
    let updated_bed_body = json_body(updated_bed_response).await;
    assert_eq!(updated_bed_body["data"]["id"], bed_id);
    assert_eq!(updated_bed_body["data"]["bed_code"], "E-100");
    assert_eq!(updated_bed_body["data"]["status"], "cleaning");
    let updated_section_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/wards/sections/{section_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "EAST-RENAMED",
                        "name": "Renamed East Section",
                        "status": "inactive"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("ward section update succeeds");
    assert_eq!(updated_section_response.status(), StatusCode::OK);
    let updated_section_body = json_body(updated_section_response).await;
    assert_eq!(updated_section_body["data"]["id"], section_id);
    assert_eq!(updated_section_body["data"]["code"], "EAST-RENAMED");
    assert_eq!(updated_section_body["data"]["name"], "Renamed East Section");
    assert_eq!(updated_section_body["data"]["status"], "inactive");

    let bed_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/{ward_id}/beds?limit=10"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward beds list succeeds");
    assert_eq!(bed_list.status(), StatusCode::OK);
    let bed_list_body = json_body(bed_list).await;
    assert_eq!(bed_list_body["page"]["limit"], 10);

    let bed_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/beds/{bed_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward bed detail succeeds");
    assert_eq!(bed_detail.status(), StatusCode::OK);
    let bed_detail_body = json_body(bed_detail).await;
    assert_eq!(bed_detail_body["data"]["id"], bed_id);
    assert_eq!(bed_detail_body["data"]["section_id"], section_id);

    let section_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/{ward_id}/sections?limit=10"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward sections list succeeds");
    assert_eq!(section_list.status(), StatusCode::OK);
    let section_list_body = json_body(section_list).await;
    assert!(section_list_body["data"]
        .as_array()
        .expect("sections are an array")
        .iter()
        .any(|section| section["id"] == section_id));

    let section_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/sections/{section_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward section detail succeeds");
    assert_eq!(section_detail.status(), StatusCode::OK);
    let section_detail_body = json_body(section_detail).await;
    assert_eq!(section_detail_body["data"]["id"], section_id);
    assert_eq!(section_detail_body["data"]["ward_id"], ward_id);

    let section_beds = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/sections/{section_id}/beds?limit=10"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward section beds list succeeds");
    assert_eq!(section_beds.status(), StatusCode::OK);
    let section_beds_body = json_body(section_beds).await;
    assert!(section_beds_body["data"]
        .as_array()
        .expect("section beds are an array")
        .iter()
        .any(|bed| bed["id"] == bed_id));

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=2")
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
    let case_patient_id = patient_body["data"][1]["id"]
        .as_str()
        .expect("case patient id exists");

    let admission_case_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions/cases")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": case_patient_id,
                        "ward_id": ward_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("admission case create succeeds");
    assert_eq!(admission_case_response.status(), StatusCode::OK);
    let admission_case_body = json_body(admission_case_response).await;
    let admission_case_id = admission_case_body["data"]["id"]
        .as_str()
        .expect("admission case id exists");
    assert_eq!(
        admission_case_body["data"]["status"],
        "ready_for_activation"
    );

    let admission_case_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/cases/{admission_case_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission case detail succeeds");
    assert_eq!(admission_case_detail.status(), StatusCode::OK);
    let admission_case_detail_body = json_body(admission_case_detail).await;
    assert_eq!(admission_case_detail_body["data"]["id"], admission_case_id);
    assert_eq!(
        admission_case_detail_body["data"]["patient_id"],
        case_patient_id
    );

    let reserve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{admission_case_id}/reserve-bed"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "bed_id": null }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("admission bed reservation succeeds");
    assert_eq!(reserve_response.status(), StatusCode::OK);
    let reserve_body = json_body(reserve_response).await;
    assert!(reserve_body["data"]["bed_id"].is_string());

    let inactive_admission_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/{admission_case_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inactive admission detail succeeds");
    assert_eq!(inactive_admission_detail.status(), StatusCode::NOT_FOUND);

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
        .expect("admission case activation succeeds");
    assert_eq!(activate_response.status(), StatusCode::OK);
    let activate_body = json_body(activate_response).await;
    assert_eq!(activate_body["data"]["status"], "admitted");

    let active_admission_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/{admission_case_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("active admission detail succeeds");
    assert_eq!(active_admission_detail.status(), StatusCode::OK);
    let active_admission_detail_body = json_body(active_admission_detail).await;
    assert_eq!(
        active_admission_detail_body["data"]["admission_id"],
        admission_case_id
    );
    assert_eq!(
        active_admission_detail_body["data"]["patient_id"],
        case_patient_id
    );
    assert_eq!(
        active_admission_detail_body["data"]["admission_status"],
        "admitted"
    );

    let cancellable_case = app
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
        .expect("cancellable admission case create succeeds");
    assert_eq!(cancellable_case.status(), StatusCode::OK);
    let cancellable_case_body = json_body(cancellable_case).await;
    let cancellable_case_id = cancellable_case_body["data"]["id"]
        .as_str()
        .expect("cancellable admission case id exists");

    let cancel_case = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admissions/cases/{cancellable_case_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission case cancel succeeds");
    assert_eq!(cancel_case.status(), StatusCode::OK);
    let cancel_case_body = json_body(cancel_case).await;
    assert_eq!(cancel_case_body["data"]["status"], "cancelled");

    let admission_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admissions")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "ward_id": ward_id,
                        "bed_id": null
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("admission create succeeds");
    assert_eq!(admission_response.status(), StatusCode::OK);
    let admission_body = json_body(admission_response).await;
    let admission_id = admission_body["data"]["admission_id"]
        .as_str()
        .expect("admission id exists");
    assert_eq!(admission_body["data"]["admission_status"], "admitted");

    let board_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards/board?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward board succeeds");
    assert_eq!(board_response.status(), StatusCode::OK);
    let board_body = json_body(board_response).await;
    assert_eq!(board_body["data"].as_array().unwrap().len(), 1);

    let task_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/tasks")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id,
                        "task_type": "observation",
                        "due_at": "2026-05-10T11:00:00Z",
                        "assigned_to_user_id": owner_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("nursing task create succeeds");
    assert_eq!(task_response.status(), StatusCode::OK);
    let task_body = json_body(task_response).await;
    let task_id = task_body["data"]["id"].as_str().expect("task id exists");
    assert_eq!(task_body["data"]["status"], "open");

    let complete_task = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/nursing/tasks/{task_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("nursing task complete succeeds");
    assert_eq!(complete_task.status(), StatusCode::OK);
    let complete_task_body = json_body(complete_task).await;
    assert_eq!(complete_task_body["data"]["status"], "completed");

    let cancellable_task_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/tasks")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id,
                        "task_type": "observation",
                        "due_at": "2026-05-10T11:30:00Z",
                        "assigned_to_user_id": owner_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("cancellable nursing task create succeeds");
    assert_eq!(cancellable_task_response.status(), StatusCode::OK);
    let cancellable_task_body = json_body(cancellable_task_response).await;
    let cancellable_task_id = cancellable_task_body["data"]["id"]
        .as_str()
        .expect("task id exists");

    let cancel_task = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/nursing/tasks/{cancellable_task_id}/cancel"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("nursing task cancel succeeds");
    assert_eq!(cancel_task.status(), StatusCode::OK);
    let cancel_task_body = json_body(cancel_task).await;
    assert_eq!(cancel_task_body["data"]["status"], "cancelled");

    let medication_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/medication-administrations")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id,
                        "medication_name": "Paracetamol",
                        "scheduled_at": "2026-05-10T12:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("medication administration create succeeds");
    assert_eq!(medication_response.status(), StatusCode::OK);
    let medication_body = json_body(medication_response).await;
    let medication_id = medication_body["data"]["id"]
        .as_str()
        .expect("medication administration id exists");
    assert_eq!(medication_body["data"]["status"], "scheduled");

    let administer_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/nursing/medication-administrations/{medication_id}/administer"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "witness_user_id": null }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("medication administration update succeeds");
    assert_eq!(administer_response.status(), StatusCode::OK);
    let administer_body = json_body(administer_response).await;
    assert_eq!(administer_body["data"]["status"], "administered");

    let handoff_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/handoffs")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "ward_id": ward_id,
                        "to_user_id": owner_id,
                        "shift_label": "day"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("handoff create succeeds");
    assert_eq!(handoff_response.status(), StatusCode::OK);
    let handoff_body = json_body(handoff_response).await;
    let handoff_id = handoff_body["data"]["id"]
        .as_str()
        .expect("handoff id exists");

    let complete_handoff = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/nursing/handoffs/{handoff_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("handoff complete succeeds");
    assert_eq!(complete_handoff.status(), StatusCode::OK);
    let handoff_complete_body = json_body(complete_handoff).await;
    assert_eq!(handoff_complete_body["data"]["status"], "completed");

    let sheet_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/nursing/treatment-sheets")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id,
                        "sheet_date": "2026-05-10"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("treatment sheet create succeeds");
    assert_eq!(sheet_response.status(), StatusCode::OK);
    let sheet_body = json_body(sheet_response).await;
    assert_eq!(sheet_body["data"]["status"], "active");

    let discharge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/discharges")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("discharge create succeeds");
    assert_eq!(discharge_response.status(), StatusCode::OK);
    let discharge_body = json_body(discharge_response).await;
    let discharge_id = discharge_body["data"]["id"]
        .as_str()
        .expect("discharge id exists");
    assert_eq!(discharge_body["data"]["status"], "requested");

    let discharge_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/discharges/{discharge_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("discharge detail succeeds");
    assert_eq!(discharge_detail.status(), StatusCode::OK);
    let discharge_detail_body = json_body(discharge_detail).await;
    assert_eq!(discharge_detail_body["data"]["id"], discharge_id);
    assert_eq!(
        discharge_detail_body["data"]["admission_case_id"],
        admission_id
    );

    let cancel_discharge = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/discharges/{discharge_id}/cancel"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "reason": "Patient discharge plan changed"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("discharge cancel succeeds");
    assert_eq!(cancel_discharge.status(), StatusCode::OK);
    let cancel_discharge_body = json_body(cancel_discharge).await;
    assert_eq!(cancel_discharge_body["data"]["status"], "cancelled");

    let admission_after_cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/{admission_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("active admission after discharge cancellation succeeds");
    assert_eq!(admission_after_cancel.status(), StatusCode::OK);
    let admission_after_cancel_body = json_body(admission_after_cancel).await;
    assert_eq!(
        admission_after_cancel_body["data"]["admission_status"],
        "admitted"
    );

    let discharge_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/discharges")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("discharge recreate succeeds");
    assert_eq!(discharge_response.status(), StatusCode::OK);
    let discharge_body = json_body(discharge_response).await;
    assert_eq!(discharge_body["data"]["id"], discharge_id);
    assert_eq!(discharge_body["data"]["status"], "requested");

    let complete_discharge = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/discharges/{discharge_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("discharge complete succeeds");
    assert_eq!(complete_discharge.status(), StatusCode::OK);
    let complete_discharge_body = json_body(complete_discharge).await;
    assert_eq!(complete_discharge_body["data"]["status"], "completed");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/{ward_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward detail denial succeeds");
    assert_eq!(denied_detail.status(), StatusCode::FORBIDDEN);

    let bed_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/beds/{bed_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward bed detail denial succeeds");
    assert_eq!(bed_denied.status(), StatusCode::FORBIDDEN);

    let section_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/wards/sections/{section_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward section detail denial succeeds");
    assert_eq!(section_denied.status(), StatusCode::FORBIDDEN);

    let admission_case_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/cases/{admission_case_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admission case detail denial succeeds");
    assert_eq!(admission_case_denied.status(), StatusCode::FORBIDDEN);

    let active_admission_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admissions/{admission_case_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("active admission detail denial succeeds");
    assert_eq!(active_admission_denied.status(), StatusCode::FORBIDDEN);

    let discharge_denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/discharges/{discharge_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("discharge detail denial succeeds");
    assert_eq!(discharge_denied.status(), StatusCode::FORBIDDEN);

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards/board?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward board denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn ward_list_records_stable_query_metrics_without_phi_labels() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/wards?limit=1&search=Ama%20Mensah")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("ward list succeeds");
    assert_eq!(response.status(), StatusCode::OK);

    let metrics = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/metrics")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("metrics request succeeds");
    assert_eq!(metrics.status(), StatusCode::OK);
    let bytes = to_bytes(metrics.into_body(), usize::MAX)
        .await
        .expect("metrics body reads");
    let body = String::from_utf8(bytes.to_vec()).expect("metrics body is utf-8");

    assert!(body.contains("query=\"ward.admin.wards.list\""));
    assert!(body.contains("route=\"/api/v2/wards\""));
    assert!(!body.contains("Ama"));
    assert!(!body.contains("Mensah"));
}
