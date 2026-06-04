use super::*;

#[tokio::test]
async fn prescription_mar_generation_creates_interval_doses_and_pharmacy_queue() {
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
        .expect("patient id exists");

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
        .expect("admission case id exists");

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

    let items_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/items?limit=20")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("inventory item list succeeds");
    assert_eq!(items_response.status(), StatusCode::OK);
    let items_body = json_body(items_response).await;
    let items = items_body["data"].as_array().expect("items array exists");
    let item_id = items
        .iter()
        .find(|item| item["controlled"] == false)
        .and_then(|item| item["id"].as_str())
        .expect("normal inventory item exists");
    let wrong_item_id = items
        .iter()
        .filter_map(|item| item["id"].as_str())
        .find(|candidate| *candidate != item_id)
        .expect("second inventory item exists");

    let prescription_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/prescriptions"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "medication_name": "Amoxicillin",
                        "dose": "500 mg",
                        "route": "oral",
                        "frequency": "bid",
                        "inventory_item_id": item_id,
                        "start_date": "2026-06-04",
                        "duration_days": 2,
                        "first_dose_at": "2026-06-04T10:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("prescription create succeeds");
    assert_eq!(prescription_response.status(), StatusCode::OK);
    let prescription_body = json_body(prescription_response).await;
    let prescription_id = prescription_body["data"]["id"]
        .as_str()
        .expect("prescription id exists");

    let generate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/clinical/prescriptions/{prescription_id}/generate-mar"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "days": 2,
                        "first_dose_at": "2026-06-04T10:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("MAR generation succeeds");
    assert_eq!(generate_response.status(), StatusCode::OK);
    let generate_body = json_body(generate_response).await;
    assert_eq!(generate_body["data"]["created_count"], 4);
    assert_eq!(generate_body["data"]["requested_dose_count"], 4);
    assert!(generate_body["data"]["pharmacy_fulfillment_id"].is_string());

    let duplicate_generate = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/clinical/prescriptions/{prescription_id}/generate-mar"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "days": 2,
                        "first_dose_at": "2026-06-04T10:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("duplicate MAR generation succeeds");
    assert_eq!(duplicate_generate.status(), StatusCode::OK);
    let duplicate_body = json_body(duplicate_generate).await;
    assert_eq!(duplicate_body["data"]["created_count"], 0);
    assert_eq!(duplicate_body["data"]["existing_count"], 4);

    let shifted_generate = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/clinical/prescriptions/{prescription_id}/generate-mar"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "days": 2,
                        "first_dose_at": "2026-06-04T11:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("shifted MAR generation returns a response");
    assert_eq!(shifted_generate.status(), StatusCode::CONFLICT);

    let mar_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/nursing/medication-administrations?limit=10&admission_case_id={admission_case_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("MAR list succeeds");
    assert_eq!(mar_response.status(), StatusCode::OK);
    let mar_body = json_body(mar_response).await;
    assert_eq!(mar_body["data"].as_array().expect("MAR list").len(), 4);
    assert_eq!(mar_body["data"][0]["scheduled_at"], "2026-06-04T10:00:00Z");
    assert_eq!(mar_body["data"][1]["scheduled_at"], "2026-06-04T22:00:00Z");
    assert_eq!(mar_body["data"][2]["scheduled_at"], "2026-06-05T10:00:00Z");
    assert_eq!(mar_body["data"][3]["scheduled_at"], "2026-06-05T22:00:00Z");
    assert_eq!(mar_body["data"][0]["frequency"], "bid");
    assert_eq!(mar_body["data"][0]["is_dispensed"], false);

    let queue_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/pharmacy/dispensing-queue?limit=10")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("pharmacy queue succeeds");
    assert_eq!(queue_response.status(), StatusCode::OK);
    let queue_body = json_body(queue_response).await;
    assert_eq!(queue_body["data"].as_array().expect("queue list").len(), 1);
    assert_eq!(queue_body["data"][0]["medication_name"], "Amoxicillin");
    assert_eq!(queue_body["data"][0]["requested_dose_count"], 4);
    assert_eq!(queue_body["data"][0]["next_due_at"], "2026-06-04T10:00:00Z");
    let fulfillment_id = queue_body["data"][0]["id"]
        .as_str()
        .expect("fulfillment id exists");

    let locations_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/inventory/storage-locations?limit=20")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("location list succeeds");
    assert_eq!(locations_response.status(), StatusCode::OK);
    let locations_body = json_body(locations_response).await;
    let location_id = locations_body["data"]
        .as_array()
        .expect("locations array exists")
        .iter()
        .find(|location| location["code"] == "PHARM")
        .and_then(|location| location["id"].as_str())
        .expect("pharmacy location exists");

    let batch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/inventory/stock-batches")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": item_id,
                        "location_id": location_id,
                        "batch_number": "MAR-FULFILL-001",
                        "expires_on": "2027-01-31",
                        "quantity_received": 10
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stock batch create succeeds");
    assert_eq!(batch_response.status(), StatusCode::OK);
    let batch_body = json_body(batch_response).await;
    assert_eq!(batch_body["data"]["quantity_on_hand"], 10);

    let wrong_item_dispense = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/pharmacy/dispensing-queue/{fulfillment_id}/dispense"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": wrong_item_id,
                        "location_id": location_id,
                        "quantity": 1
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("wrong item dispense returns a response");
    assert_eq!(wrong_item_dispense.status(), StatusCode::BAD_REQUEST);

    let dispense_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/pharmacy/dispensing-queue/{fulfillment_id}/dispense"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "item_id": item_id,
                        "location_id": location_id,
                        "quantity": 4
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("fulfillment dispense succeeds");
    assert_eq!(dispense_response.status(), StatusCode::OK);
    let dispense_body = json_body(dispense_response).await;
    assert_eq!(dispense_body["data"]["dispensed_dose_count"], 4);
    assert_eq!(dispense_body["data"]["remaining_dose_count"], 0);
    assert_eq!(dispense_body["data"]["fulfillment"]["status"], "dispensed");

    let dispensed_mar_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/nursing/medication-administrations?limit=10&admission_case_id={admission_case_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("dispensed MAR list succeeds");
    assert_eq!(dispensed_mar_response.status(), StatusCode::OK);
    let dispensed_mar_body = json_body(dispensed_mar_response).await;
    assert!(dispensed_mar_body["data"]
        .as_array()
        .expect("MAR list")
        .iter()
        .all(|entry| entry["is_dispensed"] == true));

    let prn_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/prescriptions"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "medication_name": "Salbutamol",
                        "dose": "2 puffs",
                        "route": "inhaled",
                        "frequency": "prn"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("PRN prescription create succeeds");
    assert_eq!(prn_response.status(), StatusCode::OK);
    let prn_body = json_body(prn_response).await;
    let prn_prescription_id = prn_body["data"]["id"]
        .as_str()
        .expect("PRN prescription id exists");

    let prn_generate = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/clinical/prescriptions/{prn_prescription_id}/generate-mar"
                ))
                .header(AUTHORIZATION, auth_header)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "admission_case_id": admission_case_id,
                        "days": 2,
                        "first_dose_at": "2026-06-04T10:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("PRN generation succeeds");
    assert_eq!(prn_generate.status(), StatusCode::OK);
    let prn_generate_body = json_body(prn_generate).await;
    assert_eq!(prn_generate_body["data"]["created_count"], 0);
    assert_eq!(prn_generate_body["data"]["skipped_reason"], "prn");
    assert!(prn_generate_body["data"]["pharmacy_fulfillment_id"].is_null());
}

#[tokio::test]
async fn clinical_documentation_stays_patient_scoped_and_chronicle_ready() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let patient_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients?limit=20")
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
    let other_patient_id = patient_body["data"]
        .as_array()
        .expect("patients are returned")
        .iter()
        .filter_map(|patient| patient["id"].as_str())
        .find(|candidate| *candidate != patient_id)
        .expect("second patient id exists");
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
    let wrong_patient_note = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/patients/{other_patient_id}/clinical/notes"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "note_type": "doctor_note",
                        "title": "Wrong encounter",
                        "body": "Should not attach to another patient's encounter.",
                        "encounter_id": encounter_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("wrong-patient note request completes");
    assert_eq!(wrong_patient_note.status(), StatusCode::BAD_REQUEST);

    let templates = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/clinical/note-templates?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("template list succeeds");
    assert_eq!(templates.status(), StatusCode::OK);
    let templates_body = json_body(templates).await;
    assert_eq!(templates_body["page"]["limit"], 1);
    assert_eq!(templates_body["data"][0]["title"], "Allied Health Note");
    assert_eq!(templates_body["data"][0]["note_type"], "allied_health_note");

    let template_create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/clinical/note-templates")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Ward Round Note",
                        "note_type": "doctor_note",
                        "body_template": "Subjective\\nObjective\\nAssessment\\nPlan"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("template create succeeds");
    assert_eq!(template_create.status(), StatusCode::OK);
    let template_create_body = json_body(template_create).await;
    let template_id = template_create_body["data"]["id"]
        .as_str()
        .expect("template id exists");
    assert_eq!(template_create_body["data"]["title"], "Ward Round Note");
    assert_eq!(template_create_body["data"]["is_active"], true);

    let template_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/note-templates/{template_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("template detail succeeds");
    assert_eq!(template_detail.status(), StatusCode::OK);
    let template_detail_body = json_body(template_detail).await;
    assert_eq!(template_detail_body["data"]["id"], template_id);
    assert_eq!(template_detail_body["data"]["title"], "Ward Round Note");

    let template_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/note-templates/{template_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Updated Ward Round Note",
                        "body_template": "Updated SOAP structure"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("template update succeeds");
    assert_eq!(template_update.status(), StatusCode::OK);
    let template_update_body = json_body(template_update).await;
    assert_eq!(
        template_update_body["data"]["title"],
        "Updated Ward Round Note"
    );
    assert_eq!(
        template_update_body["data"]["body_template"],
        "Updated SOAP structure"
    );

    let template_delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v2/clinical/note-templates/{template_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("template delete succeeds");
    assert_eq!(template_delete.status(), StatusCode::OK);
    let template_delete_body = json_body(template_delete).await;
    assert_eq!(template_delete_body["data"]["is_active"], false);

    let templates_after_delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/clinical/note-templates")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("template list after delete succeeds");
    assert_eq!(templates_after_delete.status(), StatusCode::OK);
    let templates_after_delete_body = json_body(templates_after_delete).await;
    assert!(!templates_after_delete_body["data"]
        .as_array()
        .expect("template list is an array")
        .iter()
        .any(|template| template["id"] == template_id));

    let note_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/patients/{patient_id}/clinical/notes"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "note_type": "nursing_note",
                        "title": "Review note",
                        "body": "History recorded. Assessment and plan captured.",
                        "encounter_id": encounter_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("clinical note create succeeds");
    assert_eq!(note_response.status(), StatusCode::OK);
    let note_body = json_body(note_response).await;
    let note_id = note_body["data"]["id"]
        .as_str()
        .expect("clinical note id exists");
    assert_eq!(note_body["data"]["status"], "draft");
    assert_eq!(note_body["data"]["note_type"], "nursing_note");
    assert_eq!(note_body["data"]["encounter_id"], encounter_id);

    let note_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/notes/{note_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical note detail succeeds");
    assert_eq!(note_detail.status(), StatusCode::OK);
    let note_detail_body = json_body(note_detail).await;
    assert_eq!(note_detail_body["data"]["id"], note_id);
    assert_eq!(note_detail_body["data"]["encounter_id"], encounter_id);
    assert_eq!(
        note_detail_body["data"]["body"],
        "History recorded. Assessment and plan captured."
    );

    let notes = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/notes?limit=1"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical note list succeeds");
    assert_eq!(notes.status(), StatusCode::OK);
    let notes_body = json_body(notes).await;
    assert_eq!(notes_body["data"].as_array().unwrap().len(), 1);
    assert_eq!(notes_body["page"]["limit"], 1);

    let encounter_notes = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/notes?limit=10&encounter_id={encounter_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("encounter-scoped clinical note list succeeds");
    assert_eq!(encounter_notes.status(), StatusCode::OK);
    let encounter_notes_body = json_body(encounter_notes).await;
    assert!(encounter_notes_body["data"]
        .as_array()
        .expect("encounter notes are returned")
        .iter()
        .any(|entry| entry["id"] == note_id && entry["encounter_id"] == encounter_id));

    let timeline = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/chronicle/timeline?limit=20&encounter_id={encounter_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("chronicle timeline succeeds");
    assert_eq!(timeline.status(), StatusCode::OK);
    let timeline_body = json_body(timeline).await;
    let timeline_entry = timeline_body["data"]
        .as_array()
        .expect("timeline entries are returned")
        .iter()
        .find(|entry| entry["id"] == note_id)
        .expect("created nursing note appears in Chronicle timeline");
    assert_eq!(timeline_entry["type"], "nursing_note");
    assert_eq!(timeline_entry["encounter_id"], encounter_id);
    assert_eq!(timeline_entry["data"]["note_type"], "nursing_note");

    let version_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/clinical/notes/{note_id}/versions"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "body": "Updated assessment and plan." }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("clinical note version create succeeds");
    assert_eq!(version_response.status(), StatusCode::OK);
    let version_body = json_body(version_response).await;
    assert_eq!(version_body["data"]["version"], 2);

    let versions = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/notes/{note_id}/versions"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical note version list succeeds");
    assert_eq!(versions.status(), StatusCode::OK);
    let versions_body = json_body(versions).await;
    assert_eq!(versions_body["data"].as_array().unwrap().len(), 2);

    let problem = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/patients/{patient_id}/clinical/problems"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "label": "Hypertension",
                        "onset_date": "2025-01-10"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("problem create succeeds");
    assert_eq!(problem.status(), StatusCode::OK);
    let problem_body = json_body(problem).await;
    assert_eq!(problem_body["data"]["status"], "active");
    let problem_id = problem_body["data"]["id"]
        .as_str()
        .expect("problem id exists");

    let problem_status = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/clinical/problems/{problem_id}/status"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "status": "resolved" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("problem status update succeeds");
    assert_eq!(problem_status.status(), StatusCode::OK);
    let problem_status_body = json_body(problem_status).await;
    assert_eq!(problem_status_body["data"]["status"], "resolved");

    let problem_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/problems/{problem_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("problem detail succeeds");
    assert_eq!(problem_detail.status(), StatusCode::OK);
    let problem_detail_body = json_body(problem_detail).await;
    assert_eq!(problem_detail_body["data"]["id"], problem_id);

    let problem_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/problems/{problem_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "label": "Essential hypertension",
                        "onset_date": "2026-01-05",
                        "status": "active"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("problem update succeeds");
    assert_eq!(problem_update.status(), StatusCode::OK);
    let problem_update_body = json_body(problem_update).await;
    assert_eq!(
        problem_update_body["data"]["label"],
        "Essential hypertension"
    );
    assert_eq!(problem_update_body["data"]["status"], "active");

    let problem_link = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/clinical/problem-links")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "problem_id": problem_id,
                        "clinical_note_id": note_id
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("problem link create succeeds");
    assert_eq!(problem_link.status(), StatusCode::OK);
    let problem_link_body = json_body(problem_link).await;
    let problem_link_id = problem_link_body["data"]["id"]
        .as_str()
        .expect("problem link id exists");
    assert_eq!(problem_link_body["data"]["problem_id"], problem_id);
    assert_eq!(problem_link_body["data"]["artifact_kind"], "clinical_note");
    assert_eq!(problem_link_body["data"]["artifact_id"], note_id);

    let problem_links = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/clinical/problem-links?clinical_note_id={note_id}"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("problem link list succeeds");
    assert_eq!(problem_links.status(), StatusCode::OK);
    let problem_links_body = json_body(problem_links).await;
    assert_eq!(problem_links_body["data"][0]["id"], problem_link_id);

    let allergy = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/patients/{patient_id}/clinical/allergies"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "substance": "Penicillin",
                        "reaction": "Rash",
                        "severity": "moderate"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("allergy create succeeds");
    assert_eq!(allergy.status(), StatusCode::OK);
    let allergy_body = json_body(allergy).await;
    let allergy_id = allergy_body["data"]["id"].as_str().expect("allergy id");
    assert_eq!(allergy_body["data"]["status"], "active");

    let allergy_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/allergies/{allergy_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("allergy detail succeeds");
    assert_eq!(allergy_detail.status(), StatusCode::OK);
    let allergy_detail_body = json_body(allergy_detail).await;
    assert_eq!(allergy_detail_body["data"]["substance"], "Penicillin");

    let prescription = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/prescriptions"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "medication_name": "Amlodipine",
                        "dose": "5 mg",
                        "frequency": "daily"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("prescription create succeeds");
    assert_eq!(prescription.status(), StatusCode::OK);
    let prescription_body = json_body(prescription).await;
    let prescription_id = prescription_body["data"]["id"]
        .as_str()
        .expect("prescription id");
    assert_eq!(prescription_body["data"]["status"], "active");

    let prescription_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/clinical/prescriptions/{prescription_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("prescription detail succeeds");
    assert_eq!(prescription_detail.status(), StatusCode::OK);
    let prescription_detail_body = json_body(prescription_detail).await;
    assert_eq!(
        prescription_detail_body["data"]["medication_name"],
        "Amlodipine"
    );

    let pharmacy_context = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/pharmacy-context"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("pharmacy clinical context succeeds");
    assert_eq!(pharmacy_context.status(), StatusCode::OK);
    let pharmacy_context_body = json_body(pharmacy_context).await;
    assert_eq!(
        pharmacy_context_body["data"]["active_problems"][0]["label"],
        "Essential hypertension"
    );
    assert_eq!(
        pharmacy_context_body["data"]["active_allergies"][0]["substance"],
        "Penicillin"
    );
    assert_eq!(
        pharmacy_context_body["data"]["order_relevant_medications"][0]["medication_name"],
        "Amlodipine"
    );

    let chart_entry = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/chart-entries"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "entry_type": "blood_pressure",
                        "measured_at": "2026-05-10T14:00:00Z",
                        "value": "130/82",
                        "unit": "mmHg"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("chart entry create succeeds");
    assert_eq!(chart_entry.status(), StatusCode::OK);
    let chart_entry_body = json_body(chart_entry).await;
    assert_eq!(chart_entry_body["data"]["entry_type"], "blood_pressure");

    for path in [
        format!("/api/v2/patients/{patient_id}/clinical/problems?limit=1"),
        format!("/api/v2/patients/{patient_id}/clinical/allergies?limit=1"),
        format!("/api/v2/patients/{patient_id}/clinical/prescriptions?limit=1"),
        format!("/api/v2/patients/{patient_id}/clinical/chart-entries?limit=1"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(path)
                    .header(AUTHORIZATION, auth_header.clone())
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("clinical list succeeds");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"].as_array().unwrap().len(), 1);
        assert_eq!(body["page"]["limit"], 1);
    }

    for path in [
        format!("/api/v2/patients/{patient_id}/chronicle"),
        format!("/api/v2/patients/{patient_id}/chronicle/print"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(path)
                    .header(AUTHORIZATION, auth_header.clone())
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
            .expect("chronicle summary succeeds");
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["data"]["patient"]["id"], patient_id);
        assert_eq!(body["data"]["notes"][0]["title"], "Review note");
        assert_eq!(
            body["data"]["problems"][0]["label"],
            "Essential hypertension"
        );
        assert_eq!(body["data"]["allergies"][0]["substance"], "Penicillin");
        assert_eq!(
            body["data"]["prescriptions"][0]["medication_name"],
            "Amlodipine"
        );
        assert_eq!(body["data"]["chart_entries"][0]["value"], "130/82");
    }

    let allergy_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/allergies/{allergy_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "substance": "Latex",
                        "reaction": "Wheezing",
                        "severity": "severe"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("allergy update succeeds");
    assert_eq!(allergy_update.status(), StatusCode::OK);
    let allergy_update_body = json_body(allergy_update).await;
    assert_eq!(allergy_update_body["data"]["substance"], "Latex");
    assert_eq!(allergy_update_body["data"]["severity"], "severe");

    let allergy_deactivate = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v2/clinical/allergies/{allergy_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("allergy deactivate succeeds");
    assert_eq!(allergy_deactivate.status(), StatusCode::OK);
    let allergy_deactivate_body = json_body(allergy_deactivate).await;
    assert_eq!(allergy_deactivate_body["data"]["status"], "inactive");

    let prescription_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/prescriptions/{prescription_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "dose": "10 mg",
                        "frequency": "twice daily",
                        "status": "stopped"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("prescription update succeeds");
    assert_eq!(prescription_update.status(), StatusCode::OK);
    let prescription_update_body = json_body(prescription_update).await;
    assert_eq!(prescription_update_body["data"]["dose"], "10 mg");
    assert_eq!(prescription_update_body["data"]["frequency"], "twice daily");
    assert_eq!(prescription_update_body["data"]["status"], "stopped");

    let prescription_hold = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/prescriptions/{prescription_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "status": "on_hold" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("prescription hold succeeds");
    assert_eq!(prescription_hold.status(), StatusCode::OK);
    let prescription_hold_body = json_body(prescription_hold).await;
    assert_eq!(prescription_hold_body["data"]["status"], "on_hold");

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v2/patients/{patient_id}/clinical/notes?limit=1"
                ))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let denied_summary = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/patients/{patient_id}/chronicle"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("chronicle summary denial succeeds");
    assert_eq!(denied_summary.status(), StatusCode::FORBIDDEN);

    let denied_problem_status = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/clinical/problems/{problem_id}/status"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "status": "active" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("clinical problem status denial succeeds");
    assert_eq!(denied_problem_status.status(), StatusCode::FORBIDDEN);

    let denied_problem_update = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/clinical/problems/{problem_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "label": "Denied" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("clinical problem update denial succeeds");
    assert_eq!(denied_problem_update.status(), StatusCode::FORBIDDEN);

    let denied_problem_link = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v2/clinical/problem-links/{problem_link_id}"))
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinical problem link denial succeeds");
    assert_eq!(denied_problem_link.status(), StatusCode::FORBIDDEN);

    let problem_link_delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri(format!("/api/v2/clinical/problem-links/{problem_link_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("problem link delete succeeds");
    assert_eq!(problem_link_delete.status(), StatusCode::OK);
}
