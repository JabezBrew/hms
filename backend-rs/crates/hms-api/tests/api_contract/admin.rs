use super::*;

#[tokio::test]
async fn deployment_capabilities_are_permission_gated() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("capabilities request succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"]["deployment_profile"], "hospital");
    assert_eq!(body["data"]["features"]["patients"], true);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("capabilities denial succeeds");

    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let body = json_body(denied).await;
    assert_eq!(body["error"]["code"], "permission_denied");
    assert!(body["request_id"].is_string());

    let clinic_database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut clinic_config =
        Config::for_tests_with_database_url(clinic_database.database_url().to_owned());
    clinic_config.deployment_profile = DeploymentProfile::Clinic;
    let clinic_app = app_with_config(clinic_config, clinic_database).await;
    let (clinic_token, _, _) = login(clinic_app.clone(), "owner@hms.local").await;
    let clinic_response = clinic_app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, format!("Bearer {clinic_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("clinic capabilities request succeeds");

    let clinic_status = clinic_response.status();
    let clinic_body = json_body(clinic_response).await;
    assert_eq!(clinic_status, StatusCode::OK, "{clinic_body}");
    assert_eq!(clinic_body["data"]["deployment_profile"], "clinic");
    assert_eq!(clinic_body["data"]["features"]["patients"], true);
    assert_eq!(clinic_body["data"]["features"]["wards"], false);
}

#[tokio::test]
async fn feature_entitlements_are_admin_scoped_and_reflected_in_capabilities() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let features_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/features")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("feature list succeeds");
    assert_eq!(features_response.status(), StatusCode::OK);
    let features_body = json_body(features_response).await;
    assert!(features_body["data"]
        .as_array()
        .expect("features are listed")
        .iter()
        .any(|item| item["feature"] == "nursing" && item["enabled"] == true));

    let update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri("/api/v2/admin/features/nursing")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "feature-entitlement-test")
                .body(Body::from(json!({ "enabled": false }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("feature update succeeds");
    assert_eq!(update_response.status(), StatusCode::OK);
    let update_body = json_body(update_response).await;
    assert_eq!(update_body["data"]["feature"], "nursing");
    assert_eq!(update_body["data"]["enabled"], false);
    assert_eq!(update_body["data"]["override_enabled"], false);

    let capabilities_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("capabilities request succeeds");
    assert_eq!(capabilities_response.status(), StatusCode::OK);
    let capabilities_body = json_body(capabilities_response).await;
    assert_eq!(capabilities_body["data"]["features"]["nursing"], false);

    let disabled_feature_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/nursing/tasks?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("disabled feature request succeeds");
    assert_eq!(disabled_feature_response.status(), StatusCode::FORBIDDEN);
    let disabled_feature_body = json_body(disabled_feature_response).await;
    assert_eq!(disabled_feature_body["error"]["code"], "feature_disabled");

    let delete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri("/api/v2/admin/features/nursing")
                .header(AUTHORIZATION, auth_header.clone())
                .header("x-request-id", "feature-entitlement-delete-test")
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("feature delete succeeds");
    assert_eq!(delete_response.status(), StatusCode::OK);
    let delete_body = json_body(delete_response).await;
    assert_eq!(delete_body["data"]["feature"], "nursing");
    assert_eq!(delete_body["data"]["enabled"], true);
    assert!(delete_body["data"]["override_enabled"].is_null());

    let restored_capabilities_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/system/deployment-capabilities")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("restored capabilities request succeeds");
    assert_eq!(restored_capabilities_response.status(), StatusCode::OK);
    let restored_capabilities_body = json_body(restored_capabilities_response).await;
    assert_eq!(
        restored_capabilities_body["data"]["features"]["nursing"],
        true
    );

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/features")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("feature entitlement denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn staff_management_is_admin_scoped_and_practitioner_ready() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let initial_list = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/staff?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff list succeeds");
    assert_eq!(initial_list.status(), StatusCode::OK);
    let initial_body = json_body(initial_list).await;
    assert_eq!(initial_body["page"]["limit"], 1);

    let directory_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/staff/directory?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff directory succeeds");
    assert_eq!(directory_response.status(), StatusCode::OK);
    let directory_body = json_body(directory_response).await;
    assert_eq!(directory_body["page"]["limit"], 1);

    let weak_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/staff")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "weak.staff@hms.local",
                        "display_name": "Weak Staff",
                        "temporary_password": "short",
                        "employee_id": "EMP-HMS-2026-WEAK",
                        "department": "Clinical",
                        "position": "Nurse",
                        "hire_date": "2026-05-10"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("weak staff create succeeds");
    assert_eq!(weak_password.status(), StatusCode::BAD_REQUEST);

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/staff")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "staff-create-test")
                .body(Body::from(
                    json!({
                        "email": "akosua.clinician@hms.local",
                        "display_name": "Akosua Clinician",
                        "temporary_password": "Temporary123!",
                        "employee_id": "EMP-HMS-2026-0001",
                        "department": "Clinical",
                        "position": "Medical Officer",
                        "hire_date": "2026-05-10",
                        "practitioner_profile": {
                            "license_number": "MDC/RN/0001",
                            "specialization": "Internal Medicine",
                            "qualification": "MBChB",
                            "fhir_practitioner_id": null
                        }
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("staff create succeeds");
    let create_status = create_response.status();
    let create_body = json_body(create_response).await;
    assert_eq!(create_status, StatusCode::OK, "{create_body}");
    assert_eq!(create_body["data"]["email"], "akosua.clinician@hms.local");
    assert_eq!(create_body["data"]["password_change_required"], true);
    assert_eq!(
        create_body["data"]["practitioner_profile"]["license_number"],
        "MDC/RN/0001"
    );
    let staff_id = create_body["data"]["id"]
        .as_str()
        .expect("staff id exists")
        .to_owned();
    let staff_user_id = create_body["data"]["user_id"]
        .as_str()
        .expect("staff user id exists")
        .to_owned();

    let populated_directory = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/staff/directory?limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("populated staff directory succeeds");
    assert_eq!(populated_directory.status(), StatusCode::OK);
    let populated_directory_body = json_body(populated_directory).await;
    let directory_items = populated_directory_body["data"]
        .as_array()
        .expect("directory data is an array");
    let created_directory_item = directory_items
        .iter()
        .find(|item| item["user_id"] == staff_user_id)
        .expect("created staff appears in directory");
    assert_eq!(created_directory_item["display_name"], "Akosua Clinician");
    assert!(created_directory_item["password_change_required"].is_null());

    let detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/staff/{staff_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff detail succeeds");
    assert_eq!(detail_response.status(), StatusCode::OK);

    let update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!("/api/v2/admin/staff/{staff_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "staff-update-test")
                .body(Body::from(
                    json!({
                        "display_name": "Akosua Updated",
                        "department": "Emergency",
                        "position": "Emergency Physician"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("staff update succeeds");
    assert_eq!(update_response.status(), StatusCode::OK);
    let update_body = json_body(update_response).await;
    assert_eq!(update_body["data"]["display_name"], "Akosua Updated");
    assert_eq!(update_body["data"]["department"], "Emergency");
    assert_eq!(update_body["data"]["position"], "Emergency Physician");

    let profile_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PUT)
                .uri(format!(
                    "/api/v2/admin/staff/{staff_id}/practitioner-profile"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "license_number": "MDC/RN/0002",
                        "specialization": "Emergency Medicine",
                        "qualification": "MBChB, MWACP",
                        "fhir_practitioner_id": "Practitioner/hms-0002"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("practitioner profile upsert succeeds");
    assert_eq!(profile_response.status(), StatusCode::OK);
    let profile_body = json_body(profile_response).await;
    assert_eq!(
        profile_body["data"]["practitioner_profile"]["specialization"],
        "Emergency Medicine"
    );

    let practitioners_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/practitioners?limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner list succeeds");
    assert_eq!(practitioners_response.status(), StatusCode::OK);
    let practitioners_body = json_body(practitioners_response).await;
    let practitioner = practitioners_body["data"]
        .as_array()
        .expect("practitioners listed")
        .iter()
        .find(|item| item["staff_id"] == staff_id && item["license_number"] == "MDC/RN/0002")
        .expect("created practitioner is listed");
    let practitioner_id = practitioner["id"]
        .as_str()
        .expect("practitioner id exists")
        .to_owned();

    let practitioner_detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/practitioners/{practitioner_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner detail succeeds");
    assert_eq!(practitioner_detail_response.status(), StatusCode::OK);
    let practitioner_detail = json_body(practitioner_detail_response).await;
    assert_eq!(practitioner_detail["data"]["id"], practitioner_id);
    assert_eq!(practitioner_detail["data"]["staff_id"], staff_id);
    assert_eq!(practitioner_detail["data"]["license_number"], "MDC/RN/0002");

    let searched_staff_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/staff?search=akosua&is_active=true&practitioners_only=true&limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff search succeeds");
    assert_eq!(searched_staff_response.status(), StatusCode::OK);
    let searched_staff = json_body(searched_staff_response).await;
    let searched_staff_data = searched_staff["data"]
        .as_array()
        .expect("searched staff data is array");
    assert_eq!(searched_staff_data.len(), 1);
    assert_eq!(searched_staff_data[0]["id"], staff_id);
    assert!(searched_staff_data[0]["practitioner_profile"].is_object());

    let searched_practitioners_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/practitioners?search=MDC%2FRN%2F0002&is_active=true&limit=5")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner search succeeds");
    assert_eq!(searched_practitioners_response.status(), StatusCode::OK);
    let searched_practitioners = json_body(searched_practitioners_response).await;
    let searched_practitioners_data = searched_practitioners["data"]
        .as_array()
        .expect("searched practitioners data is array");
    assert_eq!(searched_practitioners_data.len(), 1);
    assert_eq!(searched_practitioners_data[0]["id"], practitioner_id);

    let practitioner_by_staff_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/admin/practitioners/{staff_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("practitioner by staff detail succeeds");
    assert_eq!(practitioner_by_staff_response.status(), StatusCode::OK);
    let practitioner_by_staff = json_body(practitioner_by_staff_response).await;
    assert_eq!(practitioner_by_staff["data"]["id"], practitioner_id);
    assert_eq!(practitioner_by_staff["data"]["staff_id"], staff_id);

    let reset_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/v2/admin/staff/{staff_id}/force-password-reset"
                ))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("force reset succeeds");
    assert_eq!(reset_response.status(), StatusCode::OK);
    let reset_body = json_body(reset_response).await;
    assert_eq!(reset_body["data"]["password_change_required"], true);

    let deactivate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/admin/staff/{staff_id}/deactivate"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("deactivate succeeds");
    assert_eq!(deactivate_response.status(), StatusCode::OK);
    let deactivate_body = json_body(deactivate_response).await;
    assert_eq!(deactivate_body["data"]["is_active"], false);

    let reactivate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/admin/staff/{staff_id}/reactivate"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("reactivate succeeds");
    assert_eq!(reactivate_response.status(), StatusCode::OK);
    let reactivate_body = json_body(reactivate_response).await;
    assert_eq!(reactivate_body["data"]["is_active"], true);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/admin/staff?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let directory_denied = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/staff/directory?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff directory denial succeeds");
    assert_eq!(directory_denied.status(), StatusCode::FORBIDDEN);
}
