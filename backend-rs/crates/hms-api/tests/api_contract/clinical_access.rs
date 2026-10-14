use super::*;

#[tokio::test]
async fn inferred_encounter_access_ends_with_linked_visit_without_removing_authored_history() {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let patient_id = unrelated_patient(&app, &token).await;
    let notes_path = format!("/api/v2/patients/{patient_id}/clinical/notes");
    let (status, _) = request(&app, &token, Method::GET, &notes_path, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, visit) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/visits/check-in",
        json!({"patient_id": patient_id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{visit}");
    let visit_id = visit["data"]["id"].as_str().expect("visit id returns");
    let (status, linked) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/encounters",
        json!({"patient_id": patient_id, "visit_id": visit_id, "encounter_type": "outpatient"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{linked}");
    let (status, _) = request(&app, &token, Method::GET, &notes_path, json!({})).await;
    assert_eq!(status, StatusCode::OK);

    let (status, closed) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/visits/{visit_id}/checkout"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    let (status, _) = request(&app, &token, Method::GET, &notes_path, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Deriving a worklist or opening an encounter must never persist an
    // assignment that outlives the actual care workflow.
    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let contexts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_contexts WHERE patient_id = $1 AND user_id = $2",
    )
    .bind(patient_id)
    .bind(claims.sub)
    .fetch_one(&pool)
    .await
    .expect("synthetic patient contexts count returns");
    assert_eq!(contexts, 0);

    let (status, unlinked) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/encounters",
        json!({"patient_id": patient_id, "encounter_type": "outpatient"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{unlinked}");
    let encounter_id = unlinked["data"]["id"]
        .as_str()
        .expect("encounter id returns");
    let (status, _) = request(&app, &token, Method::GET, &notes_path, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, note) = request(
        &app,
        &token,
        Method::POST,
        &notes_path,
        json!({"note_type": "doctor_note", "title": "Synthetic continuity note", "body": "Synthetic content"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{note}");
    let (status, completed) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/encounters/{encounter_id}/complete"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{completed}");
    let (status, history) = request(&app, &token, Method::GET, &notes_path, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{history}");
    assert_eq!(history["data"].as_array().expect("notes return").len(), 1);
}

#[tokio::test]
async fn covering_triage_nurse_can_save_vitals_after_assessment_and_assignment_rejects_invalid_staff(
) {
    let app = app().await;
    let nurse_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for permission in [
        PermissionCode::NursingTaskManage,
        PermissionCode::ClinicalDocumentationView,
        PermissionCode::ClinicalDocumentationManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&app, nurse_id, permission).await;
    }
    grant_test_patient_visibility(&app, nurse_id, PatientDataVisibility::Demographics).await;
    for feature in [
        FeatureKey::Patients,
        FeatureKey::Encounters,
        FeatureKey::Nursing,
    ] {
        grant_test_feature(&app, nurse_id, feature).await;
    }
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let (nurse, _, _) = login(app.clone(), "limited@hms.local").await;
    let patient_id = unrelated_patient(&app, &owner).await;
    let (status, intake) = request(&app, &owner, Method::POST, "/api/v2/care-areas/emergency/intake", json!({
        "patient_id": patient_id, "acuity": "urgent", "idempotency_key": "synthetic-access-triage"
    })).await;
    assert_eq!(status, StatusCode::OK);
    let triage_id = intake["data"]["triage"]["id"]
        .as_str()
        .expect("triage id returns");
    let visit_id = Uuid::parse_str(
        intake["data"]["visit"]["id"]
            .as_str()
            .expect("visit id returns"),
    )
    .expect("visit id parses");
    let claims = access_claims(&owner);
    let pool = app.db_pool().await;
    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities (id, code, name, deployment_profile) VALUES ($1, 'SYNTHETIC_OTHER', 'Synthetic other facility', 'hospital')")
        .bind(foreign_facility).execute(&pool).await.expect("synthetic facility inserts");
    for (facility_id, active) in [(foreign_facility, true), (claims.facility_id, false)] {
        let invalid_staff = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id, facility_id, email, display_name, password_hash, is_active) VALUES ($1, $2, $3, 'Synthetic staff', 'invalid-test-only-hash', $4)")
            .bind(invalid_staff).bind(facility_id).bind(format!("{invalid_staff}@synthetic.invalid")).bind(active)
            .execute(&pool).await.expect("synthetic staff inserts");
        let (status, _) = request(
            &app,
            &owner,
            Method::POST,
            &format!("/api/v2/triage/{triage_id}/assign"),
            json!({"assigned_to_user_id": invalid_staff}),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
    }
    let notes_path = format!("/api/v2/patients/{patient_id}/clinical/notes");
    let (status, _) = request(&app, &nurse, Method::GET, &notes_path, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = request(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v2/triage/{triage_id}/assign"),
        json!({"assigned_to_user_id": claims.sub}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, assessment) = request(
        &app,
        &nurse,
        Method::POST,
        &format!("/api/v2/triage/{triage_id}/assessment"),
        json!({"acuity": "urgent", "notes": "Synthetic assessment"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{assessment}");
    assert_eq!(assessment["data"]["status"], "completed");
    assert_eq!(
        assessment["data"]["assigned_to_user_id"],
        nurse_id.to_string()
    );
    let chart_path = format!("/api/v2/patients/{patient_id}/clinical/chart-entries");
    let vital = json!({"entry_type": "temperature", "visit_id": visit_id, "measured_at": Utc::now(), "value": "37", "unit": "C"});
    let (status, _) = request(&app, &nurse, Method::POST, &chart_path, vital.clone()).await;
    assert_eq!(status, StatusCode::OK);
    sqlx::query("UPDATE visits SET status = 'checked_out' WHERE id = $1")
        .bind(visit_id)
        .execute(&pool)
        .await
        .expect("synthetic visit closes");
    let (status, _) = request(&app, &nurse, Method::POST, &chart_path, vital).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

async fn request(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    payload: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .expect("request builds"),
        )
        .await
        .expect("clinical access request returns");
    let status = response.status();
    (status, json_body(response).await)
}

async fn unrelated_patient(app: &TestApp, token: &str) -> Uuid {
    let (status, body) = request(
        app,
        token,
        Method::POST,
        "/api/v2/patients",
        json!({
            "first_name": "ScopeSynthetic", "last_name": "AccessFixture",
            "date_of_birth": "1984-11-23", "sex": "female"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    Uuid::parse_str(body["data"]["id"].as_str().expect("patient id returns")).expect("id parses")
}

#[tokio::test]
async fn unrelated_clinician_cannot_read_direct_clinical_endpoints_or_write_their_own_relationship()
{
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let patient_id = unrelated_patient(&app, &token).await;
    for suffix in [
        "chronicle",
        "clinical/notes",
        "clinical/problems",
        "clinical/allergies",
        "clinical/prescriptions",
        "clinical/chart-entries",
    ] {
        let (status, body) = request(
            &app,
            &token,
            Method::GET,
            &format!("/api/v2/patients/{patient_id}/{suffix}"),
            json!({}),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "direct access must fail: {suffix}"
        );
        assert_eq!(body["error"]["code"], "patient_access_denied");
    }
    for (suffix, payload) in [
        (
            "notes",
            json!({"note_type": "doctor_note", "title": "Synthetic note", "body": "Synthetic content"}),
        ),
        (
            "allergies",
            json!({"substance": "Synthetic substance", "severity": "mild"}),
        ),
    ] {
        let (status, _) = request(
            &app,
            &token,
            Method::POST,
            &format!("/api/v2/patients/{patient_id}/clinical/{suffix}"),
            payload,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let pool = app.db_pool().await;
    let note_count =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM clinical_notes WHERE patient_id = $1")
            .bind(patient_id)
            .fetch_one(&pool)
            .await
            .expect("note count returns");
    assert_eq!(note_count, 0);

    // A demographics edit creates a 'recent' row, which is discovery history,
    // not a care relationship and must not unlock clinical records.
    let (status, _) = request(
        &app,
        &token,
        Method::PATCH,
        &format!("/api/v2/patients/{patient_id}"),
        json!({"first_name": "ScopeSynthetic"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/patients/{patient_id}/clinical/notes"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Starting an actual care workflow establishes a clinician relationship.
    let (status, _) = request(
        &app,
        &token,
        Method::POST,
        "/api/v2/encounters",
        json!({"patient_id": patient_id, "encounter_type": "outpatient"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = request(&app, &token, Method::POST, &format!("/api/v2/patients/{patient_id}/clinical/notes"),
        json!({"note_type": "doctor_note", "title": "Assigned synthetic note", "body": "Synthetic content"})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/patients/{patient_id}/clinical/notes"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().expect("notes return").len(), 1);
    // Death ends ordinary intake, but the treating clinician still needs to
    // complete or amend the established clinical record.
    sqlx::query("UPDATE patients SET vital_status = 'deceased' WHERE id = $1")
        .bind(patient_id)
        .execute(&pool)
        .await
        .expect("synthetic death is recorded");
    let (status, _) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/patients/{patient_id}/clinical/notes"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn direct_clinical_access_accepts_audited_break_glass_and_preserves_fulfillment_safety_access(
) {
    let app = app().await;
    let (token, _, _) = login(app.clone(), "owner@hms.local").await;
    let patient_id = unrelated_patient(&app, &token).await;
    let (status, _) = request(&app, &token, Method::POST, &format!("/api/v2/patients/{patient_id}/break-glass"),
        json!({"category": "urgent_clinical_continuity", "reason_text": "Synthetic emergency contract"})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v2/patients/{patient_id}/clinical/allergies"),
        json!({"substance": "Synthetic substance", "severity": "mild"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/patients/{patient_id}/clinical/allergies"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().expect("allergies return").len(), 1);

    let (status, _) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/patients/{patient_id}/clinical/pharmacy-context"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = request(&app, &token, Method::POST,
        &format!("/api/v2/patients/{patient_id}/clinical/prescriptions"),
        json!({"medication_name": "Synthetic medication", "dose": "1 unit", "route": "oral", "frequency": "daily"})).await;
    assert_eq!(status, StatusCode::OK);

    let claims = access_claims(&token);
    let pool = app.db_pool().await;
    let audits = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_events WHERE actor_user_id = $1 AND resource_id = $2 AND event_type = 'patient.chronicle.outside_assignment_viewed'")
        .bind(claims.sub).bind(patient_id).fetch_one(&pool).await.expect("audit count returns");
    assert_eq!(audits, 1);
    // Fulfillment-only users still receive the small safety projection through
    // their own permission; they cannot retrieve general clinical notes.
    sqlx::query(
        "DELETE FROM user_permissions WHERE user_id = $1 AND permission_code IN ('clinical_documentation.view', 'clinical_documentation.manage')",
    )
    .bind(claims.sub)
    .execute(&pool)
    .await
    .expect("clinical permissions removed");
    app.state()
        .invalidate_auth_cache_for_user(claims.facility_id, claims.sub);
    let (status, _) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/patients/{patient_id}/clinical/pharmacy-context"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = request(
        &app,
        &token,
        Method::GET,
        &format!("/api/v2/patients/{patient_id}/clinical/notes"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
