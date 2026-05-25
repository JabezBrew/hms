use super::*;

#[tokio::test]
async fn auth_login_refresh_logout_and_me_follow_session_contract() {
    let app = app().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "limited@hms.local").await;

    let me_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("me request succeeds");
    assert_eq!(me_response.status(), StatusCode::OK);
    let me_body = json_body(me_response).await;
    assert_eq!(me_body["data"]["password_change_required"], true);

    let profile_update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "display_name": "Limited Updated"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("profile update request succeeds");
    assert_eq!(profile_update_response.status(), StatusCode::OK);
    let profile_update_body = json_body(profile_update_response).await;
    assert_eq!(
        profile_update_body["data"]["display_name"],
        "Limited Updated"
    );

    let refresh_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie.clone())
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("refresh request succeeds");
    assert_eq!(refresh_response.status(), StatusCode::OK);
    let (rotated_cookie, rotated_csrf_token) = auth_cookies(refresh_response.headers());

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/logout")
                .header(COOKIE, rotated_cookie)
                .header("x-hms-csrf", rotated_csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("logout request succeeds");
    assert_eq!(logout_response.status(), StatusCode::OK);
    assert!(logout_response.headers().contains_key(SET_COOKIE));

    let (_, cookie, _) = login(app.clone(), "limited@hms.local").await;
    let rejected_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("csrf rejection succeeds");
    assert_eq!(rejected_refresh.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn request_context_extractor_resolves_policy_state_before_handler() {
    let app = app_with_request_context_probe().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let (response, observed_queries) = hms_observability::with_request_query_counter(async {
        app.clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/__test/request-context")
                    .header(AUTHORIZATION, auth_header.clone())
                    .header("x-request-id", "request-context-test")
                    .header("x-hms-offsite", "true")
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
    })
    .await;
    let response = response.expect("request context probe succeeds");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(observed_queries, 1);
    let body = json_body(response).await;
    assert_eq!(body["request_id"], "request-context-test");
    assert_eq!(body["facility_code"], "HMS");
    assert_eq!(body["active_profile"], "hospital");
    assert_eq!(body["offsite"], "OffsiteReadOnly");
    assert_eq!(body["reauth_fresh"], true);
    assert!(body["session_id"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
    assert!(body["enabled_features"]
        .as_array()
        .expect("features are listed")
        .contains(&json!("patients")));
    assert!(body["permissions"]
        .as_array()
        .expect("permissions are listed")
        .contains(&json!("patient.demographics.view")));
    assert!(body["patient_visibility"]
        .as_array()
        .expect("visibility is listed")
        .contains(&json!("demographics")));
    assert!(body["active_authorities"]
        .as_array()
        .expect("active authorities are listed")
        .iter()
        .any(|authority| authority["source"] == "position_appointment"
            && authority["permission_code"] == "admin.authority.manage"));

    let (cached_response, cached_observed_queries) =
        hms_observability::with_request_query_counter(async {
            app.oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/__test/request-context")
                    .header(AUTHORIZATION, auth_header)
                    .header("x-request-id", "request-context-cache-test")
                    .body(Body::empty())
                    .expect("request builds"),
            )
            .await
        })
        .await;
    let cached_response = cached_response.expect("cached request context probe succeeds");
    assert_eq!(cached_response.status(), StatusCode::OK);
    assert_eq!(cached_observed_queries, 0);

    let metrics = hms_observability::prometheus_metrics();
    assert!(metrics.contains("hms_request_context_cache_hits_total"));
    assert!(metrics.contains("hms_request_context_cache_misses_total"));
    assert!(metrics.contains("hms_request_context_hydration_db_seconds"));
    assert!(metrics.contains("route_pattern=\"/__test/request-context\""));
    assert!(metrics.contains("facility_safe=\"HMS\""));
}

#[tokio::test]
async fn logout_invalidates_warmed_request_context_cache_for_session() {
    let app = app_with_request_context_probe().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let warmed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/__test/request-context")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("warm request context succeeds");
    assert_eq!(warmed.status(), StatusCode::OK);

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/logout")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("logout request succeeds");
    assert_eq!(logout_response.status(), StatusCode::OK);

    let (rejected, observed_queries) = hms_observability::with_request_query_counter(async {
        app.oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/__test/request-context")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
    })
    .await;
    let rejected = rejected.expect("revoked-session request completes");
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(observed_queries, 1);
}

#[tokio::test]
async fn auth_me_user_cache_outlives_request_context_cache_without_db_hydration() {
    let app = app().await;
    let (access_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let warmed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("warm auth/me request succeeds");
    assert_eq!(warmed.status(), StatusCode::OK);

    tokio::time::sleep(std::time::Duration::from_secs(6)).await;

    let (cached, observed_queries) = hms_observability::with_request_query_counter(async {
        app.oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
    })
    .await;
    let cached = cached.expect("cached auth/me request succeeds");
    assert_eq!(cached.status(), StatusCode::OK);
    assert_eq!(observed_queries, 0);
}

#[tokio::test]
async fn logout_invalidates_warmed_auth_me_user_cache_for_session() {
    let app = app().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let warmed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("warm auth/me request succeeds");
    assert_eq!(warmed.status(), StatusCode::OK);

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/logout")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("logout request succeeds");
    assert_eq!(logout_response.status(), StatusCode::OK);

    let rejected = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("revoked auth/me request completes");
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn request_context_rejects_stale_permission_versions() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);

    let warmed_limited_user = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("limited cache warm request succeeds");
    assert_eq!(warmed_limited_user.status(), StatusCode::OK);

    let assignment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "dashboard.view",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "request_context_stale_permission_test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("permission assignment request succeeds");
    assert_eq!(assignment.status(), StatusCode::OK);

    let stale_access = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale permission request succeeds");
    assert_eq!(stale_access.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn active_permission_assignments_are_resolved_into_request_context_policy() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/validation-rules")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("initial validation-rules denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let assignment = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "patient.create",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "request_context_active_authority_test"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("permission assignment request succeeds");
    assert_eq!(assignment.status(), StatusCode::OK);

    let stale_limited_context = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/validation-rules")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale validation-rules request succeeds");
    assert_eq!(stale_limited_context.status(), StatusCode::UNAUTHORIZED);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let allowed = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/patients/validation-rules")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("authority-backed validation-rules request succeeds");
    assert_eq!(allowed.status(), StatusCode::OK);
}

#[tokio::test]
async fn high_risk_admin_actions_reject_stale_reauth_context() {
    let app = app().await;
    enroll_owner_test_passkey(&app).await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let stale_reauth_token = token_with_stale_reauth(&owner_token);
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {stale_reauth_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "patient.create",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "stale_reauth_rejected"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("stale reauth request succeeds");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "reauth_required");
}

#[tokio::test]
async fn privileged_admin_actions_require_passkey_enrollment() {
    let app = app().await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let limited_id = Uuid::from_u128(hms_db::provision::LIMITED_USER_ID);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/admin/permission-assignments")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "grantee_user_id": limited_id,
                        "permission_code": "patient.create",
                        "scope_type": "facility",
                        "scope_id": null,
                        "starts_at": null,
                        "ends_at": null,
                        "reason_code": "passkey_required_contract"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("passkey-required request succeeds");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "passkey_required");
}

#[tokio::test]
async fn auth_sessions_can_be_listed_and_revoked_by_owner() {
    let app = app().await;
    let (current_access_token, current_cookie, current_csrf) = login_with_password_and_device(
        app.clone(),
        "owner@hms.local",
        "ChangeMe123!",
        Some("Safari on macOS"),
    )
    .await;
    let (other_access_token, other_cookie, other_csrf) = login_with_password_and_device(
        app.clone(),
        "owner@hms.local",
        "ChangeMe123!",
        Some("Chrome on Windows"),
    )
    .await;
    let (_, third_cookie, third_csrf) = login_with_password_and_device(
        app.clone(),
        "owner@hms.local",
        "ChangeMe123!",
        Some("Safari on iOS"),
    )
    .await;
    let auth_header = format!("Bearer {current_access_token}");

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/sessions")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("session list request succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    let sessions = list_body["data"]["results"]
        .as_array()
        .expect("sessions are returned");
    assert_eq!(sessions.len(), 3);
    assert_eq!(
        sessions
            .iter()
            .filter(|session| session["is_current"] == true)
            .count(),
        1
    );
    let other_session_id = sessions
        .iter()
        .find(|session| session["device_label"] == "Chrome on Windows")
        .and_then(|session| session["id"].as_str())
        .expect("other session is present")
        .to_owned();

    let revoke_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/auth/sessions/{other_session_id}/revoke"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("session revoke request succeeds");
    assert_eq!(revoke_response.status(), StatusCode::OK);
    let revoke_body = json_body(revoke_response).await;
    assert_eq!(revoke_body["data"]["revoked"], true);

    let rejected_other_access = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {other_access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("revoked access-token request succeeds");
    assert_eq!(rejected_other_access.status(), StatusCode::UNAUTHORIZED);

    let rejected_other_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, other_cookie)
                .header("x-hms-csrf", other_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("revoked refresh request succeeds");
    assert_eq!(rejected_other_refresh.status(), StatusCode::UNAUTHORIZED);

    let revoke_others_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/sessions/revoke-all")
                .header(AUTHORIZATION, auth_header)
                .header("content-type", "application/json")
                .body(Body::from(json!({ "exclude_current": true }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("session revoke-all request succeeds");
    assert_eq!(revoke_others_response.status(), StatusCode::OK);
    let revoke_others_body = json_body(revoke_others_response).await;
    assert_eq!(revoke_others_body["data"]["revoked_count"], 1);

    let rejected_third_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, third_cookie)
                .header("x-hms-csrf", third_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("revoked refresh request succeeds");
    assert_eq!(rejected_third_refresh.status(), StatusCode::UNAUTHORIZED);

    let current_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, current_cookie)
                .header("x-hms-csrf", current_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("current refresh request succeeds");
    assert_eq!(current_refresh.status(), StatusCode::OK);
}

#[tokio::test]
async fn signed_in_password_change_rotates_sessions_and_enforces_policy() {
    let app = app().await;
    let (access_token, cookie, csrf_token) = login(app.clone(), "owner@hms.local").await;
    let auth_header = format!("Bearer {access_token}");

    let weak_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "current_password": "ChangeMe123!",
                        "new_password": "short"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("weak password request succeeds");
    assert_eq!(weak_password.status(), StatusCode::BAD_REQUEST);

    let wrong_current_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "current_password": "WrongPassword123!",
                        "new_password": "Replacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("wrong password request succeeds");
    assert_eq!(wrong_current_password.status(), StatusCode::BAD_REQUEST);

    let changed = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "current_password": "ChangeMe123!",
                        "new_password": "Replacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password change request succeeds");
    assert_eq!(changed.status(), StatusCode::OK);
    let changed_body = json_body(changed).await;
    assert_eq!(changed_body["data"]["changed"], true);

    let stale_access = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, auth_header)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale access request succeeds");
    assert_eq!(stale_access.status(), StatusCode::UNAUTHORIZED);

    let stale_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, cookie)
                .header("x-hms-csrf", csrf_token)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale refresh request succeeds");
    assert_eq!(stale_refresh.status(), StatusCode::UNAUTHORIZED);

    let old_password_login = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "owner@hms.local",
                        "password": "ChangeMe123!",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("old password login request succeeds");
    assert_eq!(old_password_login.status(), StatusCode::UNAUTHORIZED);

    let (new_access_token, _, _) =
        login_with_password(app.clone(), "owner@hms.local", "Replacement123!").await;
    assert!(!new_access_token.is_empty());
}

#[tokio::test]
async fn refresh_token_reuse_revokes_the_rotated_session_family() {
    let app = app().await;
    let (_, original_cookie, original_csrf) = login(app.clone(), "owner@hms.local").await;

    let refresh_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, original_cookie.clone())
                .header("x-hms-csrf", original_csrf.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("refresh request succeeds");
    assert_eq!(refresh_response.status(), StatusCode::OK);
    let (rotated_cookie, rotated_csrf) = auth_cookies(refresh_response.headers());

    let reused_old_token = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, original_cookie)
                .header("x-hms-csrf", original_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("reuse request succeeds");
    assert_eq!(reused_old_token.status(), StatusCode::UNAUTHORIZED);

    let family_revoked = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, rotated_cookie)
                .header("x-hms-csrf", rotated_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("family revoked request succeeds");
    assert_eq!(family_revoked.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn password_reset_is_single_use_and_revokes_existing_sessions() {
    let app = app().await;
    let (old_access_token, old_cookie, old_csrf) = login(app.clone(), "limited@hms.local").await;

    let request_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/request")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "limited@hms.local",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset request succeeds");
    assert_eq!(request_response.status(), StatusCode::OK);
    let request_body = json_body(request_response).await;
    let reset_token = request_body["data"]["debug_token"]
        .as_str()
        .expect("debug token is returned in tests")
        .to_owned();

    let weak_password = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "short"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("weak password request succeeds");
    assert_eq!(weak_password.status(), StatusCode::BAD_REQUEST);

    let request_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/request")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": "limited@hms.local",
                        "facility_code": "HMS"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset request succeeds");
    let request_body = json_body(request_response).await;
    let reset_token = request_body["data"]["debug_token"]
        .as_str()
        .expect("debug token is returned in tests")
        .to_owned();

    let complete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "Replacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("password reset complete succeeds");
    assert_eq!(complete_response.status(), StatusCode::OK);

    let stale_access = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/auth/me")
                .header(AUTHORIZATION, format!("Bearer {old_access_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale access request succeeds");
    assert_eq!(stale_access.status(), StatusCode::UNAUTHORIZED);

    let stale_refresh = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/refresh")
                .header(COOKIE, old_cookie)
                .header("x-hms-csrf", old_csrf)
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("stale refresh request succeeds");
    assert_eq!(stale_refresh.status(), StatusCode::UNAUTHORIZED);

    let reused_token = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/auth/password-reset/complete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "token": reset_token,
                        "new_password": "AnotherReplacement123!"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("token reuse request succeeds");
    assert_eq!(reused_token.status(), StatusCode::BAD_REQUEST);
}
