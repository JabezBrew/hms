use super::*;

#[tokio::test]
async fn consent_grants_are_patient_access_scoped_and_revocable() {
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
        .expect("patient id exists")
        .to_owned();

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/consents")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "scope": "referral_coordination",
                        "purpose": "Specialist referral coordination",
                        "expires_at": "2026-06-10T00:00:00Z"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("consent create succeeds");
    assert_eq!(create_response.status(), StatusCode::OK);
    let create_body = json_body(create_response).await;
    assert_eq!(create_body["data"]["status"], "active");
    assert_eq!(create_body["data"]["scope"], "referral_coordination");
    let consent_id = create_body["data"]["id"]
        .as_str()
        .expect("consent id exists");

    let revoke_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/consents/{consent_id}/revoke"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("consent revoke succeeds");
    assert_eq!(revoke_response.status(), StatusCode::OK);
    let revoke_body = json_body(revoke_response).await;
    assert_eq!(revoke_body["data"]["status"], "revoked");
    assert!(revoke_body["data"]["revoked_at"].is_string());

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/consents?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("consent list succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    assert_eq!(list_body["page"]["limit"], 1);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/consents?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("consent denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
