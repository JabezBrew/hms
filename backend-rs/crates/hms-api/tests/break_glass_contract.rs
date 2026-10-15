mod support;
use axum::response::Response;
use support::*;

async fn emergency_request(
    app: &TestApp,
    bearer: Option<&str>,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Response {
    let mut request = Request::builder().method(method).uri(path);
    if let Some(bearer) = bearer {
        request = request.header(AUTHORIZATION, bearer);
    }
    app.clone()
        .oneshot(
            request
                .header("content-type", "application/json")
                .body(
                    body.map(|value| Body::from(value.to_string()))
                        .unwrap_or_else(Body::empty),
                )
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn current_emergency_grant_is_minimal_actor_scoped_and_authorized() {
    let app = app().await;
    let pool = app.db_pool().await;
    let facility_id = Uuid::from_u128(hms_db::provision::FACILITY_ID);
    let owner_id = Uuid::from_u128(hms_db::provision::OWNER_USER_ID);
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    let patient_id: Uuid =
        sqlx::query_scalar("SELECT id FROM patients WHERE facility_id = $1 LIMIT 1")
            .bind(facility_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let path = format!("/api/v2/patients/{patient_id}/break-glass");
    assert_eq!(
        emergency_request(&app, None, Method::GET, &path, None)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );

    grant_test_permission(&app, owner_id, PermissionCode::PatientBreakGlassInvoke).await;
    let owner = Actor::login(&app, "owner@hms.local").await;
    let initial = emergency_request(&app, Some(&owner.bearer()), Method::GET, &path, None).await;
    assert_eq!(initial.status(), StatusCode::OK);
    assert_eq!(json_body(initial).await["data"], json!({ "grant": null }));

    let limited = Actor::login(&app, "limited@hms.local").await;
    assert_eq!(
        emergency_request(&app, Some(&limited.bearer()), Method::GET, &path, None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    grant_test_permission(&app, limited_id, PermissionCode::PatientBreakGlassInvoke).await;
    sqlx::query("UPDATE users SET password_change_required = FALSE WHERE id = $1")
        .bind(limited_id)
        .execute(&pool)
        .await
        .unwrap();
    let limited = Actor::login(&app, "limited@hms.local").await;
    assert_eq!(
        emergency_request(&app, Some(&limited.bearer()), Method::GET, &path, None)
            .await
            .status(),
        StatusCode::FORBIDDEN,
        "dedicated permission alone cannot disclose patient-associated grant status"
    );
    grant_test_permission(&app, limited_id, PermissionCode::PatientDemographicsView).await;
    let limited = Actor::login(&app, "limited@hms.local").await;
    assert_eq!(
        emergency_request(&app, Some(&limited.bearer()), Method::GET, &path, None)
            .await
            .status(),
        StatusCode::FORBIDDEN,
        "demographic visibility is required as well as permission"
    );
    grant_test_patient_visibility(&app, limited_id, PatientDataVisibility::Demographics).await;
    let limited = Actor::login(&app, "limited@hms.local").await;

    let stale = token_with_stale_reauth(&owner.bearer().trim_start_matches("Bearer "));
    let stale_response = emergency_request(
        &app,
        Some(&format!("Bearer {stale}")),
        Method::POST,
        &path,
        Some(json!({ "category": "urgent_clinical_continuity" })),
    )
    .await;
    assert_eq!(stale_response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(stale_response).await["error"]["code"],
        "reauth_required"
    );
    let created = emergency_request(&app, Some(&owner.bearer()), Method::POST, &path,
        Some(json!({ "category": "urgent_clinical_continuity", "reason_text": "Synthetic urgent handover" }))).await;
    assert_eq!(created.status(), StatusCode::OK);
    let created = json_body(created).await;
    let current = emergency_request(&app, Some(&owner.bearer()), Method::GET, &path, None).await;
    assert_eq!(current.status(), StatusCode::OK);
    let current = json_body(current).await;
    let grant = current["data"]["grant"].as_object().unwrap();
    assert_eq!(grant.len(), 2);
    assert_eq!(current["data"]["grant"]["id"], created["data"]["id"]);
    assert_eq!(
        current["data"]["grant"]["expires_at"],
        created["data"]["expires_at"]
    );
    assert!(grant.get("reason_text").is_none());
    assert!(grant.get("patient_id").is_none());
    assert!(grant.get("user_id").is_none());
    let other_actor =
        emergency_request(&app, Some(&limited.bearer()), Method::GET, &path, None).await;
    assert_eq!(other_actor.status(), StatusCode::OK);
    assert_eq!(json_body(other_actor).await["data"]["grant"], Value::Null);

    let end_path = format!("{path}/end");
    let other_end =
        emergency_request(&app, Some(&limited.bearer()), Method::POST, &end_path, None).await;
    assert_eq!(other_end.status(), StatusCode::OK);
    assert_eq!(json_body(other_end).await["data"]["ended_count"], 0);
    let ended = emergency_request(&app, Some(&owner.bearer()), Method::POST, &end_path, None).await;
    assert_eq!(ended.status(), StatusCode::OK);
    assert_eq!(json_body(ended).await["data"]["ended_count"], 1);
    let current = emergency_request(&app, Some(&owner.bearer()), Method::GET, &path, None).await;
    assert_eq!(json_body(current).await["data"]["grant"], Value::Null);

    // Future and elapsed courses cannot restore an active status after reload.
    for start in [
        Utc::now() - Duration::hours(3),
        Utc::now() + Duration::hours(1),
    ] {
        sqlx::query("INSERT INTO patient_break_glass_grants (id,facility_id,user_id,patient_id,category,started_at,expires_at) VALUES ($1,$2,$3,$4,'other_emergency',$5,$6)")
            .bind(Uuid::new_v4()).bind(facility_id).bind(owner_id).bind(patient_id)
            .bind(start).bind(start + Duration::hours(2)).execute(&pool).await.unwrap();
    }
    let current = emergency_request(&app, Some(&owner.bearer()), Method::GET, &path, None).await;
    assert_eq!(json_body(current).await["data"]["grant"], Value::Null);

    for (record_status, vital_status) in
        [("restricted", "presumed_alive"), ("registered", "deceased")]
    {
        sqlx::query("UPDATE patients SET record_status = $2, vital_status = $3 WHERE id = $1")
            .bind(patient_id)
            .bind(record_status)
            .bind(vital_status)
            .execute(&pool)
            .await
            .unwrap();
        let current =
            emergency_request(&app, Some(&owner.bearer()), Method::GET, &path, None).await;
        assert_eq!(current.status(), StatusCode::OK);
        assert_eq!(json_body(current).await["data"], json!({ "grant": null }));
        let denied = emergency_request(
            &app,
            Some(&owner.bearer()),
            Method::POST,
            &path,
            Some(json!({ "category": "other_emergency" })),
        )
        .await;
        assert_eq!(denied.status(), StatusCode::CONFLICT);
        assert_eq!(
            json_body(denied).await["error"]["code"],
            "break_glass_patient_not_active"
        );
    }

    let foreign_facility = Uuid::new_v4();
    sqlx::query("INSERT INTO facilities (id, code, name, deployment_profile) SELECT $1, 'breakglass-other', 'Synthetic other facility', deployment_profile FROM facilities WHERE id = $2")
        .bind(foreign_facility).bind(facility_id).execute(&pool).await.unwrap();
    let foreign_patient = Uuid::new_v4();
    sqlx::query("INSERT INTO patients (id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) SELECT $1,$2,'SYNTHETIC-OTHER',first_name,last_name,date_of_birth,sex,status FROM patients WHERE id = $3")
        .bind(foreign_patient).bind(foreign_facility).bind(patient_id).execute(&pool).await.unwrap();
    for inaccessible in [foreign_patient, Uuid::new_v4()] {
        let response = emergency_request(
            &app,
            Some(&owner.bearer()),
            Method::GET,
            &format!("/api/v2/patients/{inaccessible}/break-glass"),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let emergency_patient = Uuid::new_v4();
    sqlx::query("INSERT INTO patients (id,facility_id,patient_code,first_name,last_name,date_of_birth,sex,status) SELECT $1,$2,'SYNTHETIC-EMERGENCY-SOURCE',first_name,last_name,date_of_birth,sex,'active' FROM patients WHERE id = $3")
        .bind(emergency_patient).bind(facility_id).bind(patient_id).execute(&pool).await.unwrap();
    let emergency_path = format!("/api/v2/patients/{emergency_patient}/break-glass");
    let granted = emergency_request(
        &app,
        Some(&owner.bearer()),
        Method::POST,
        &emergency_path,
        Some(json!({ "category": "urgent_clinical_continuity" })),
    )
    .await;
    assert_eq!(granted.status(), StatusCode::OK);
    let chronicle_path = format!("/api/v2/patients/{emergency_patient}/chronicle");
    for _ in 0..2 {
        let chronicle = emergency_request(
            &app,
            Some(&owner.bearer()),
            Method::GET,
            &chronicle_path,
            None,
        )
        .await;
        assert_eq!(chronicle.status(), StatusCode::OK);
        assert_eq!(
            json_body(chronicle).await["data"]["access_source"],
            "break_glass"
        );
    }
    let ended = emergency_request(
        &app,
        Some(&owner.bearer()),
        Method::POST,
        &format!("{emergency_path}/end"),
        None,
    )
    .await;
    assert_eq!(ended.status(), StatusCode::OK);
    let after_end = emergency_request(
        &app,
        Some(&owner.bearer()),
        Method::GET,
        &chronicle_path,
        None,
    )
    .await;
    assert_eq!(
        after_end.status(),
        StatusCode::FORBIDDEN,
        "cached startup cannot bypass a revoked grant"
    );
}
