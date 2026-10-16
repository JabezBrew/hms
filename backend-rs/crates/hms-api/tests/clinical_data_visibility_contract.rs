mod support;
use support::*;

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
async fn set_visibility(app: &TestApp, visibility: Option<PatientDataVisibility>) -> String {
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    sqlx::query(
        "DELETE FROM user_patient_visibility WHERE user_id=$1 AND visibility<>'demographics'",
    )
    .bind(owner)
    .execute(&app.db_pool().await)
    .await
    .unwrap();
    if let Some(value) = visibility {
        grant_test_patient_visibility(app, owner, value).await;
    } else {
        sqlx::query("UPDATE users SET permission_version=permission_version+1 WHERE id=$1")
            .bind(owner)
            .execute(&app.db_pool().await)
            .await
            .unwrap();
    }
    login(app.clone(), "owner@hms.local").await.0
}
async fn saved(app: &TestApp, token: &str, path: String, payload: Value) -> Value {
    let response = call(app, token, Method::POST, path, payload).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "explicit full-clinical fixture must save"
    );
    json_body(response).await["data"].clone()
}
async fn denied(app: &TestApp, token: &str, method: Method, path: String, payload: Value) {
    let response = call(app, token, method, path, payload).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(!json_body(response)
        .await
        .to_string()
        .contains("SYNTHETIC-PROTECTED"));
}
struct Fixture {
    app: TestApp,
    patient: Uuid,
    prescription: Uuid,
    note: Uuid,
    allergy: Uuid,
    problem: Uuid,
}
async fn fixture() -> Fixture {
    let app = app().await;
    let token = set_visibility(&app, Some(PatientDataVisibility::FullClinical)).await;
    let patient = sqlx::query_scalar("SELECT id FROM patients WHERE facility_id=$1 LIMIT 1")
        .bind(app.state().facility_id())
        .fetch_one(&app.db_pool().await)
        .await
        .unwrap();
    let prefix = format!("/api/v2/patients/{patient}/clinical");
    let prescription=saved(&app,&token,format!("{prefix}/prescriptions"),json!({"medication_name":"SYNTHETIC-PROTECTED-MEDICATION","dose":"1 tablet","route":"oral","frequency":"daily","instructions":"SYNTHETIC-PROTECTED-INSTRUCTIONS","reason":"SYNTHETIC-PROTECTED-REASON"})).await;
    let note=saved(&app,&token,format!("{prefix}/notes"),json!({"note_type":"doctor_note","title":"Synthetic review","body":"SYNTHETIC-PROTECTED-NARRATIVE"})).await;
    let allergy=saved(&app,&token,format!("{prefix}/allergies"),json!({"substance":"SYNTHETIC-PROTECTED-ALLERGY","reaction":"Synthetic reaction","severity":"mild"})).await;
    let problem = saved(
        &app,
        &token,
        format!("{prefix}/problems"),
        json!({"label":"SYNTHETIC-PROTECTED-PROBLEM"}),
    )
    .await;
    saved(
        &app,
        &token,
        format!("{prefix}/chart-entries"),
        json!({"entry_type":"pulse","measured_at":Utc::now(),"value":"80","unit":"beats/min"}),
    )
    .await;
    Fixture {
        app,
        patient,
        prescription: Uuid::parse_str(prescription["id"].as_str().unwrap()).unwrap(),
        note: Uuid::parse_str(note["id"].as_str().unwrap()).unwrap(),
        allergy: Uuid::parse_str(allergy["id"].as_str().unwrap()).unwrap(),
        problem: Uuid::parse_str(problem["id"].as_str().unwrap()).unwrap(),
    }
}

#[tokio::test]
async fn demographics_and_workflow_permissions_do_not_expose_or_mutate_clinical_data() {
    let f = fixture().await;
    let token = set_visibility(&f.app, None).await;
    let before_allergies: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_allergies WHERE patient_id=$1")
            .bind(f.patient)
            .fetch_one(&f.app.db_pool().await)
            .await
            .unwrap();
    for collection in [
        "prescriptions",
        "notes",
        "allergies",
        "problems",
        "chart-entries",
    ] {
        denied(
            &f.app,
            &token,
            Method::GET,
            format!("/api/v2/patients/{}/clinical/{collection}", f.patient),
            Value::Null,
        )
        .await;
    }
    for (collection, id) in [
        ("prescriptions", f.prescription),
        ("notes", f.note),
        ("allergies", f.allergy),
        ("problems", f.problem),
    ] {
        denied(
            &f.app,
            &token,
            Method::GET,
            format!("/api/v2/clinical/{collection}/{id}"),
            Value::Null,
        )
        .await;
    }
    denied(
        &f.app,
        &token,
        Method::PATCH,
        format!("/api/v2/clinical/prescriptions/{}", f.prescription),
        json!({"status":"stopped"}),
    )
    .await;
    denied(
        &f.app,
        &token,
        Method::POST,
        format!("/api/v2/patients/{}/clinical/allergies", f.patient),
        json!({"substance":"SYNTHETIC-PROTECTED-NOT-SAVED","severity":"mild"}),
    )
    .await;
    denied(
        &f.app,
        &token,
        Method::POST,
        format!("/api/v2/clinical/notes/{}/versions", f.note),
        json!({"body":"SYNTHETIC-PROTECTED-NOT-SAVED"}),
    )
    .await;
    // The original source and allergy count remain unchanged after denied writes.
    let pool = f.app.db_pool().await;
    let status: String = sqlx::query_scalar("SELECT status FROM prescriptions WHERE id=$1")
        .bind(f.prescription)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "active");
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_allergies WHERE patient_id=$1")
            .bind(f.patient)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, before_allergies);
    let version: i64 = sqlx::query_scalar("SELECT version FROM clinical_notes WHERE id=$1")
        .bind(f.note)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(version, 1);
    denied(
        &f.app,
        &token,
        Method::GET,
        format!("/api/v2/patients/{}/chronicle", f.patient),
        Value::Null,
    )
    .await;
}

#[tokio::test]
async fn summary_visibility_allows_lean_reads_but_not_full_notes_history_or_writes() {
    let f = fixture().await;
    let token = set_visibility(&f.app, Some(PatientDataVisibility::ClinicalSummary)).await;
    for collection in [
        "prescriptions",
        "notes",
        "allergies",
        "problems",
        "chart-entries",
    ] {
        let response = call(
            &f.app,
            &token,
            Method::GET,
            format!("/api/v2/patients/{}/clinical/{collection}", f.patient),
            Value::Null,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert!(!body.to_string().contains("SYNTHETIC-PROTECTED-NARRATIVE"));
        assert!(!body
            .to_string()
            .contains("SYNTHETIC-PROTECTED-INSTRUCTIONS"));
    }
    denied(
        &f.app,
        &token,
        Method::GET,
        format!("/api/v2/clinical/notes/{}", f.note),
        Value::Null,
    )
    .await;
    denied(
        &f.app,
        &token,
        Method::GET,
        format!("/api/v2/clinical/notes/{}/versions", f.note),
        Value::Null,
    )
    .await;
    denied(
        &f.app,
        &token,
        Method::GET,
        format!("/api/v2/clinical/prescriptions/{}", f.prescription),
        Value::Null,
    )
    .await;
    denied(
        &f.app,
        &token,
        Method::PATCH,
        format!("/api/v2/clinical/prescriptions/{}", f.prescription),
        json!({"status":"stopped"}),
    )
    .await;
    denied(&f.app,&token,Method::POST,format!("/api/v2/patients/{}/clinical/notes",f.patient),json!({"note_type":"doctor_note","title":"Synthetic denied note","body":"SYNTHETIC-PROTECTED-NOT-SAVED"})).await;
    let response = call(
        &f.app,
        &token,
        Method::GET,
        format!("/api/v2/patients/{}/chronicle", f.patient),
        Value::Null,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let summary = json_body(response).await;
    assert_eq!(
        summary["data"]["permissions"]["can_view_full_clinical"],
        false
    );
    assert_eq!(summary["data"]["permissions"]["can_add_note"], false);
    assert_eq!(summary["data"]["permissions"]["can_record_vitals"], false);
    assert_eq!(summary["data"]["permissions"]["can_prescribe"], false);
    assert!(!summary
        .to_string()
        .contains("SYNTHETIC-PROTECTED-NARRATIVE"));
    assert!(!summary
        .to_string()
        .contains("SYNTHETIC-PROTECTED-INSTRUCTIONS"));
    denied(
        &f.app,
        &token,
        Method::GET,
        format!(
            "/api/v2/patients/{}/chronicle/ward-rounds/current",
            f.patient
        ),
        Value::Null,
    )
    .await;
    let token = set_visibility(&f.app, Some(PatientDataVisibility::FullClinical)).await;
    let full = call(
        &f.app,
        &token,
        Method::GET,
        format!("/api/v2/clinical/notes/{}", f.note),
        Value::Null,
    )
    .await;
    assert_eq!(full.status(), StatusCode::OK);
    assert_eq!(
        json_body(full).await["data"]["body"],
        "SYNTHETIC-PROTECTED-NARRATIVE"
    );
}

#[tokio::test]
async fn purpose_specific_context_requires_its_data_class_and_feature_without_granting_full_record()
{
    let f = fixture().await;
    let full_token = set_visibility(&f.app, Some(PatientDataVisibility::FullClinical)).await;
    let tests = call(
        &f.app,
        &full_token,
        Method::GET,
        "/api/v2/laboratory/test-catalog?limit=1",
        Value::Null,
    )
    .await;
    assert_eq!(tests.status(), StatusCode::OK);
    let test_id = json_body(tests).await["data"][0]["id"].clone();
    let order = saved(
        &f.app,
        &full_token,
        "/api/v2/laboratory/orders".into(),
        json!({"patient_id": f.patient,"test_ids":[test_id],"priority":"routine"}),
    )
    .await;
    let laboratory_order = order["id"].as_str().unwrap();
    let pharmacy = format!("/api/v2/patients/{}/clinical/pharmacy-context", f.patient);
    let laboratory = format!("/api/v2/laboratory/orders/{laboratory_order}/clinical-context");
    let token = set_visibility(&f.app, None).await;
    denied(&f.app, &token, Method::GET, pharmacy.clone(), Value::Null).await;
    denied(&f.app, &token, Method::GET, laboratory.clone(), Value::Null).await;
    for (visibility, allowed, other) in [
        (
            PatientDataVisibility::Prescription,
            pharmacy.clone(),
            laboratory.clone(),
        ),
        (
            PatientDataVisibility::Laboratory,
            laboratory,
            pharmacy.clone(),
        ),
    ] {
        let token = set_visibility(&f.app, Some(visibility)).await;
        assert_eq!(
            call(&f.app, &token, Method::GET, allowed, Value::Null)
                .await
                .status(),
            StatusCode::OK
        );
        denied(&f.app, &token, Method::GET, other, Value::Null).await;
        denied(
            &f.app,
            &token,
            Method::GET,
            format!("/api/v2/clinical/notes/{}", f.note),
            Value::Null,
        )
        .await;
        denied(
            &f.app,
            &token,
            Method::GET,
            format!("/api/v2/patients/{}/clinical/prescriptions", f.patient),
            Value::Null,
        )
        .await;
    }
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    sqlx::query("DELETE FROM user_features WHERE user_id=$1 AND feature_key='pharmacy'")
        .bind(owner)
        .execute(&f.app.db_pool().await)
        .await
        .unwrap();
    let token = set_visibility(&f.app, Some(PatientDataVisibility::FullClinical)).await;
    denied(&f.app, &token, Method::GET, pharmacy, Value::Null).await;
}

#[tokio::test]
async fn chronicle_vitals_action_uses_nursing_authority_independently_of_note_authority() {
    let f = fixture().await;
    let owner = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let pool = f.app.db_pool().await;
    sqlx::query("DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='clinical_documentation.manage'")
        .bind(owner)
        .execute(&pool)
        .await
        .unwrap();
    let token = set_visibility(&f.app, Some(PatientDataVisibility::FullClinical)).await;
    let response = call(
        &f.app,
        &token,
        Method::GET,
        format!("/api/v2/patients/{}/chronicle", f.patient),
        Value::Null,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let permissions = &body["data"]["permissions"];
    assert_eq!(permissions["can_view_full_clinical"], true);
    assert_eq!(permissions["can_record_vitals"], true);
    assert_eq!(permissions["can_add_note"], false);
    assert_eq!(permissions["can_prescribe"], false);

    sqlx::query(
        "DELETE FROM user_permissions WHERE user_id=$1 AND permission_code='nursing.task.manage'",
    )
    .bind(owner)
    .execute(&pool)
    .await
    .unwrap();
    let token = set_visibility(&f.app, Some(PatientDataVisibility::FullClinical)).await;
    let response = call(
        &f.app,
        &token,
        Method::GET,
        format!("/api/v2/patients/{}/chronicle", f.patient),
        Value::Null,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["data"]["permissions"]["can_record_vitals"],
        false
    );
}

#[tokio::test]
async fn patient_visibility_is_not_required_to_manage_nonpatient_template_configuration() {
    let app = app().await;
    let token = set_visibility(&app, None).await;
    let payload = json!({"title":"Synthetic configuration","note_type":"doctor_note","body_template":"Synthetic configurable template"});
    let template = saved(
        &app,
        &token,
        "/api/v2/clinical/note-templates".into(),
        payload,
    )
    .await;
    let id = template["id"].as_str().unwrap();
    let response = call(
        &app,
        &token,
        Method::GET,
        format!("/api/v2/clinical/note-templates/{id}"),
        Value::Null,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let response = call(
        &app,
        &token,
        Method::PATCH,
        format!("/api/v2/clinical/note-templates/{id}"),
        json!({"title":"Synthetic reviewed configuration"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let response = call(
        &app,
        &token,
        Method::DELETE,
        format!("/api/v2/clinical/note-templates/{id}"),
        Value::Null,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}
