use super::*;

#[tokio::test]
async fn referrals_sla_and_clinic_waitlist_are_patient_access_scoped() {
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

    let referral_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/referrals")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "to_service": "Medicine",
                        "priority": "urgent",
                        "reason": "Medical review"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("referral create succeeds");
    assert_eq!(referral_response.status(), StatusCode::OK);
    let referral_body = json_body(referral_response).await;
    assert_eq!(referral_body["data"]["status"], "sent");
    assert_eq!(referral_body["data"]["reason"], "Medical review");
    assert!(referral_body["data"]["sla_due_at"].is_string());
    let referral_id = referral_body["data"]["id"]
        .as_str()
        .expect("referral id exists");

    let accept_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/referrals/{referral_id}/accept"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "acceptance_notes": "Accepted for same-day review" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("referral accept succeeds");
    assert_eq!(accept_response.status(), StatusCode::OK);
    let accept_body = json_body(accept_response).await;
    assert_eq!(accept_body["data"]["status"], "accepted");
    assert_eq!(
        accept_body["data"]["acceptance_notes"],
        "Accepted for same-day review"
    );

    let detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/referrals/{referral_id}"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral detail succeeds");
    assert_eq!(detail_response.status(), StatusCode::OK);
    let detail_body = json_body(detail_response).await;
    assert_eq!(detail_body["data"]["id"], referral_id);

    let sla_state_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/v2/referrals/{referral_id}/sla-state"))
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral SLA state succeeds");
    assert_eq!(sla_state_response.status(), StatusCode::OK);
    let sla_state_body = json_body(sla_state_response).await;
    assert_eq!(sla_state_body["data"]["referral_id"], referral_id);
    assert_eq!(sla_state_body["data"]["status"], "accepted");

    let complete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/referrals/{referral_id}/complete"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "specialist_notes": "Specialist review completed",
                        "recommendations": "Continue current treatment"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("referral complete succeeds");
    assert_eq!(complete_response.status(), StatusCode::OK);
    let complete_body = json_body(complete_response).await;
    assert_eq!(complete_body["data"]["status"], "completed");
    assert_eq!(
        complete_body["data"]["specialist_notes"],
        "Specialist review completed"
    );

    let decline_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/referrals")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "to_service": "Surgery",
                        "priority": "routine",
                        "reason": "Surgical review"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("decline referral create succeeds");
    assert_eq!(decline_response.status(), StatusCode::OK);
    let decline_body = json_body(decline_response).await;
    let decline_referral_id = decline_body["data"]["id"]
        .as_str()
        .expect("decline referral id exists");
    let declined_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/referrals/{decline_referral_id}/decline"))
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "decline_reason": "Needs orthopedics instead" }).to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("referral decline succeeds");
    assert_eq!(declined_response.status(), StatusCode::OK);
    let declined_body = json_body(declined_response).await;
    assert_eq!(declined_body["data"]["status"], "declined");
    assert_eq!(
        declined_body["data"]["decline_reason"],
        "Needs orthopedics instead"
    );

    let sla_dashboard_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/referrals/sla-dashboard")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral SLA dashboard succeeds");
    assert_eq!(sla_dashboard_response.status(), StatusCode::OK);
    let sla_dashboard_body = json_body(sla_dashboard_response).await;
    assert!(sla_dashboard_body["data"]["risk_summary"]["total"]
        .as_i64()
        .is_some());

    let waitlist_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/referrals/clinic-waitlist")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "patient_id": patient_id,
                        "service": "Medicine",
                        "priority": "urgent"
                    })
                    .to_string(),
                ))
                .expect("request builds"),
        )
        .await
        .expect("waitlist create succeeds");
    assert_eq!(waitlist_response.status(), StatusCode::OK);
    let waitlist_body = json_body(waitlist_response).await;
    assert_eq!(waitlist_body["data"]["status"], "waiting");

    let offer_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v2/referrals/clinic-waitlist/offer-next")
                .header(AUTHORIZATION, auth_header.clone())
                .header("content-type", "application/json")
                .body(Body::from(json!({ "service": "Medicine" }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("offer next succeeds");
    assert_eq!(offer_response.status(), StatusCode::OK);
    let offer_body = json_body(offer_response).await;
    assert_eq!(offer_body["data"]["status"], "offered");

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/referrals?limit=1")
                .header(AUTHORIZATION, auth_header.clone())
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral list succeeds");
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = json_body(list_response).await;
    assert_eq!(list_body["page"]["limit"], 1);

    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;
    let denied = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/referrals?limit=1")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("referral denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
}
