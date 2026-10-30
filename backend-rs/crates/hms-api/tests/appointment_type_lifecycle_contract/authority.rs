use super::*;
const PASSWORD: &str = "Synthetic23!CurrentPassword";
async fn ordinary() -> (TestApp, String) {
    let app = app().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    for permission in [
        PermissionCode::AppointmentView,
        PermissionCode::AppointmentManage,
        PermissionCode::PatientDemographicsView,
    ] {
        grant_test_permission(&app, user, permission).await;
    }
    grant_test_feature(&app, user, FeatureKey::Appointments).await;
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    let first = raw_password_login(&app, "limited@hms.local", "ChangeMe123!", None).await;
    assert_eq!(first.status(), StatusCode::OK);
    let first = json_body(first).await;
    let first_token = first["data"]["access_token"].as_str().unwrap();
    let changed = fixture_json_post(
        &app,
        Some(first_token),
        "/api/v2/auth/password",
        json!({"current_password":"ChangeMe123!","new_password":PASSWORD}),
    )
    .await;
    assert_eq!(changed.status(), StatusCode::OK);
    let (token, _, _) = login_with_password(app.clone(), "limited@hms.local", PASSWORD).await;
    (app, token)
}
#[tokio::test]
async fn ordinary_scheduling_manager_renews_actual_password_without_admin_or_factor_then_maintains_types(
) {
    let (app, token) = ordinary().await;
    let pool = app.db_pool().await;
    let claims = access_claims(&token);
    let before = effects(&app).await;
    sqlx::query("UPDATE refresh_sessions SET password_verified_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1").bind(claims.session_id).execute(&pool).await.unwrap();
    let stale = token_with_stale_reauth(&token);
    let input = create_input("SYNTH23ORDINARY");
    assert_eq!(
        request(
            &app,
            &stale,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(input.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(effects(&app).await, before);
    let response = fixture_json_post(
        &app,
        Some(&stale),
        "/api/v2/auth/reauthenticate",
        json!({"current_password":PASSWORD}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!response.headers().contains_key(SET_COOKIE));
    let result = json_body(response).await;
    let result = &result["data"];
    assert_eq!(result["user"]["auth_security"]["passkey_required"], false);
    assert_eq!(result["user"]["auth_security"]["passkey_enrolled"], false);
    assert!(result["user"]["auth_security"]["session_assurance"]["method"].is_null());
    assert!(!result["user"]["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v.as_str().is_some_and(|v| v.starts_with("admin."))));
    let fresh = result["access_token"].as_str().unwrap();
    assert_eq!(access_claims(fresh).session_id, claims.session_id);
    let (s, receipt) = request(
        &app,
        fresh,
        Method::POST,
        "/api/v2/scheduling/services",
        Some(input),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        receipt["data"]["recorded_by_user_id"],
        claims.sub.to_string()
    );
    let (owner, _, _) = login(app.clone(), "owner@hms.local").await;
    let key = receipt["data"]["client_request_id"].as_str().unwrap();
    let before = effects(&app).await;
    assert_eq!(
        request(
            &app,
            &owner,
            Method::GET,
            &format!("/api/v2/scheduling/services/commands/{key}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(effects(&app).await, before);
}
#[tokio::test]
async fn demographics_visibility_and_deployed_feature_are_independent_of_manage_permission() {
    let app = app().await;
    let user = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);
    grant_test_permission(&app, user, PermissionCode::AppointmentManage).await;
    grant_test_feature(&app, user, FeatureKey::Appointments).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    let before = effects(&app).await;
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(create_input("SYNTH23DENY"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(effects(&app).await, before);
    grant_test_permission(&app, user, PermissionCode::PatientDemographicsView).await;
    grant_test_patient_visibility(&app, user, PatientDataVisibility::Demographics).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    create(&app, &token, "SYNTH23DEMOS").await;
    let pool = app.db_pool().await;
    sqlx::query("INSERT INTO facility_feature_entitlements(facility_id,feature_key,enabled)VALUES($1,'appointments',false)ON CONFLICT(facility_id,feature_key)DO UPDATE SET enabled=false").bind(app.state().facility_id()).execute(&pool).await.unwrap();
    let before = effects(&app).await;
    let (token, _, _) = login(app.clone(), "limited@hms.local").await;
    assert_eq!(
        request(
            &app,
            &token,
            Method::POST,
            "/api/v2/scheduling/services",
            Some(create_input("SYNTH23FEATUREOFF"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(effects(&app).await, before);
}
