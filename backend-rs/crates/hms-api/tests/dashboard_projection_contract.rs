mod support;
use support::*;

#[tokio::test]
async fn dashboard_snapshot_miss_returns_stale_metadata_and_queues_projection_refresh() {
    let app = app().await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let claims = access_claims(&owner_token);
    let user = app
        .state()
        .auth_user_for_claims(&claims)
        .await
        .expect("auth user lookup succeeds")
        .expect("auth user exists");
    let ctx = hms_access::RequestContext::new(
        "dashboard-projection-contract".to_owned(),
        claims.session_id,
        user.clone(),
        user.features.clone(),
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(chrono::Utc::now()),
    );

    let (response, observed_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .dashboard_service()
            .dashboard_snapshot(&ctx)
            .await
    })
    .await;
    let response = response.expect("dashboard snapshot succeeds");
    let body = serde_json::to_value(response).expect("dashboard snapshot serializes");

    assert_eq!(body["data"]["deployment_profile"], "hospital");
    assert!(body["data"]["metrics"].is_array());
    assert!(body["data"]["navigation"]["groups"].is_array());
    assert!(body["meta"]["generated_at"].is_null());
    assert_eq!(body["meta"]["is_stale"], true);
    assert_eq!(body["meta"]["refresh_queued"], true);
    assert_eq!(
        observed_queries, 1,
        "dashboard snapshot should not await the async refresh enqueue write"
    );
    assert_eq!(
        body["meta"]["ttl_seconds"],
        hms_db::dashboard::DASHBOARD_PROJECTION_TTL_SECONDS
    );
    assert_phi_absent(&body.to_string(), &["P-10001"]);
}
