use super::*;

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
    assert_eq!(templates_body["data"][0]["title"], "General Clinical Note");

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
                        "note_type": "ward_round",
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
                        "note_type": "general",
                        "title": "Review note",
                        "body": "History recorded. Assessment and plan captured."
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
}
