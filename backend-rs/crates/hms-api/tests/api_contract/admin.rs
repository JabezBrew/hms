use super::*;
use hms_api::config::{AccountSetupDeliveryConfig, AccountSetupDeliveryMode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

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
    assert!(!body["data"]["permissions"]
        .as_array()
        .expect("permissions are listed")
        .contains(&json!("system.ops.view")));

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

    let legacy_secret_payload = app
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
                        "temporary_password": "ValidTempPass123!",
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
        .expect("legacy secret-bearing staff create request is rejected");
    let legacy_secret_payload_body =
        assert_json_status(legacy_secret_payload, StatusCode::BAD_REQUEST).await;
    assert_eq!(
        legacy_secret_payload_body["error"]["code"],
        "staff_onboarding_server_managed"
    );

    let stale_reauth_token = token_with_stale_reauth(&access_token);
    let stale_create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/staff")
                .header(AUTHORIZATION, format!("Bearer {stale_reauth_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "stale.create@hms.local",
                        "display_name": "Stale Create",
                        "department": "Clinical",
                        "position": "Ward Clerk",
                        "hire_date": "2026-05-10"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stale reauth staff create request succeeds");
    let stale_create_body = assert_json_status(stale_create_response, StatusCode::FORBIDDEN).await;
    assert_eq!(stale_create_body["error"]["code"], "reauth_required");

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
    let employee_id = create_body["data"]["employee_id"]
        .as_str()
        .expect("generated employee id exists");
    assert!(employee_id.starts_with("EMP-HMS-"));
    assert_eq!(employee_id.rsplit('-').next().unwrap_or("").len(), 7);
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
    let staff_user_uuid = Uuid::parse_str(&staff_user_id).expect("staff user id is uuid");
    let db_pool = app.db_pool().await;
    let setup_token_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(staff_user_uuid)
    .fetch_one(&db_pool)
    .await
    .expect("setup token count query succeeds");
    assert_eq!(setup_token_count, 1);
    let setup_event_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM domain_events WHERE event_type = 'admin.staff_account_setup_requested' AND aggregate_id = $1",
    )
    .bind(staff_user_uuid)
    .fetch_one(&db_pool)
    .await
    .expect("setup event count query succeeds");
    assert_eq!(setup_event_count, 1);
    let setup_delivery = app
        .state()
        .latest_test_account_setup_delivery(
            staff_user_uuid,
            AccountSetupDeliveryPurpose::StaffAccountSetup,
        )
        .expect("test sink receives staff setup delivery");
    assert_eq!(setup_delivery.email, "akosua.clinician@hms.local");
    assert!(setup_delivery
        .setup_url
        .contains("/reset-password/confirm?token="));
    let complete_setup_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": setup_delivery.token,
                        "new_password": "NewStaffPass123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("staff setup completion succeeds");
    assert_eq!(complete_setup_response.status(), StatusCode::OK);
    let (staff_access_token, staff_cookie_header, staff_csrf_token) = login_with_password(
        app.clone(),
        "akosua.clinician@hms.local",
        "NewStaffPass123!",
    )
    .await;
    let warm_staff_auth = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {staff_access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("staff auth/me warm request succeeds");
    assert_eq!(warm_staff_auth.status(), StatusCode::OK);

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
    let active_token_count_after_reset = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(staff_user_uuid)
    .fetch_one(&db_pool)
    .await
    .expect("active token count after reset query succeeds");
    assert_eq!(active_token_count_after_reset, 1);
    let stale_staff_auth = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {staff_access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale staff auth/me request succeeds");
    assert_eq!(stale_staff_auth.status(), StatusCode::UNAUTHORIZED);
    let stale_staff_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, staff_cookie_header)
                .header("x-hms-csrf", staff_csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale staff refresh request succeeds");
    assert_eq!(stale_staff_refresh.status(), StatusCode::UNAUTHORIZED);
    let reset_delivery = app
        .state()
        .latest_test_account_setup_delivery(
            staff_user_uuid,
            AccountSetupDeliveryPurpose::StaffPasswordReset,
        )
        .expect("test sink receives staff reset delivery");
    let complete_reset_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_delivery.token,
                        "new_password": "ReplacementStaffPass123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("staff reset completion succeeds");
    assert_eq!(complete_reset_response.status(), StatusCode::OK);
    let (replacement_access_token, _, _) = login_with_password(
        app.clone(),
        "akosua.clinician@hms.local",
        "ReplacementStaffPass123!",
    )
    .await;
    assert!(!replacement_access_token.is_empty());

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

#[tokio::test]
async fn staff_create_cleans_up_when_setup_delivery_fails() {
    let webhook_url = scripted_account_setup_webhook_url(vec![500, 204]).await;
    let database =
        Arc::new(hms_db::test_support::TestDatabase::create().expect("test database is available"));
    let mut config = Config::for_tests_with_database_url(database.database_url().to_owned());
    config.account_setup_delivery = AccountSetupDeliveryConfig {
        mode: AccountSetupDeliveryMode::Webhook,
        webhook_url: Some(webhook_url),
        public_app_url: Some("http://localhost".to_owned()),
        timeout: std::time::Duration::from_millis(500),
    };
    let app = app_with_config(config, database).await;
    enroll_owner_test_passkey(&app).await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");
    let payload = json!({
        "email": "delivery.failure@hms.local",
        "display_name": "Delivery Failure",
        "department": "Clinical",
        "position": "Ward Clerk",
        "hire_date": "2026-06-08"
    });

    let failed_create = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/staff")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .header("x-request-id", "staff-create-delivery-failure-test")
                .body(Body::from(payload.to_string()))
                .expect("request builds"),
        )
        .await
        .expect("failed delivery staff create request succeeds");
    let failed_body = assert_json_status(failed_create, StatusCode::CONFLICT).await;
    assert_eq!(
        failed_body["error"]["code"],
        "staff_account_setup_delivery_failed"
    );

    let db_pool = app.db_pool().await;
    let failed_user_count =
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users WHERE email = $1")
            .bind("delivery.failure@hms.local")
            .fetch_one(&db_pool)
            .await
            .expect("failed delivery user cleanup query succeeds");
    assert_eq!(failed_user_count, 0);
    let failed_token_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM password_reset_tokens token
        JOIN users account ON account.id = token.user_id
        WHERE account.email = $1
        "#,
    )
    .bind("delivery.failure@hms.local")
    .fetch_one(&db_pool)
    .await
    .expect("failed delivery token cleanup query succeeds");
    assert_eq!(failed_token_count, 0);
    let failed_setup_event_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM domain_events WHERE event_type = 'admin.staff_account_setup_requested'",
    )
    .fetch_one(&db_pool)
    .await
    .expect("failed delivery event cleanup query succeeds");
    assert_eq!(failed_setup_event_count, 0);
    let compensated_audit_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM audit_events WHERE event_type = 'admin.staff.create_delivery_compensated'",
    )
    .fetch_one(&db_pool)
    .await
    .expect("failed delivery compensation audit query succeeds");
    assert_eq!(compensated_audit_count, 1);

    let retry_create = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/staff")
                .header(AUTHORIZATION, auth_header)
                .header("content-type", "application/json")
                .header("x-request-id", "staff-create-delivery-retry-test")
                .body(Body::from(payload.to_string()))
                .expect("request builds"),
        )
        .await
        .expect("retry staff create request succeeds");
    let retry_status = retry_create.status();
    let retry_body = json_body(retry_create).await;
    assert_eq!(retry_status, StatusCode::OK, "{retry_body}");
    assert_eq!(retry_body["data"]["email"], "delivery.failure@hms.local");
    assert!(retry_body["data"]["employee_id"]
        .as_str()
        .expect("generated employee id exists")
        .starts_with("EMP-HMS-"));
}

async fn scripted_account_setup_webhook_url(statuses: Vec<u16>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test webhook binds");
    let addr = listener.local_addr().expect("test webhook addr exists");
    tokio::spawn(async move {
        for status in statuses {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer).await;
            let reason = if (200..300).contains(&status) {
                "OK"
            } else {
                "Internal Server Error"
            };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            );
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });
    format!("http://{addr}/account-setup")
}
