mod support;
use support::*;

#[tokio::test]
async fn dashboard_snapshot_miss_returns_stale_metadata_and_queues_projection_refresh() {
    let app = app().await;
    let owner = Actor::login(&app, "owner@hms.local").await;

    let body = assert_json_status(
        api_get(app, &owner, "/api/v2/dashboards/snapshot").await,
        StatusCode::OK,
    )
    .await;

    assert_eq!(body["data"]["deployment_profile"], "hospital");
    assert!(body["data"]["metrics"].is_array());
    assert!(body["data"]["navigation"]["groups"].is_array());
    assert!(body["meta"]["generated_at"].is_null());
    assert_eq!(body["meta"]["is_stale"], true);
    assert_eq!(body["meta"]["refresh_queued"], true);
    assert_eq!(
        body["meta"]["ttl_seconds"],
        hms_db::dashboard::DASHBOARD_PROJECTION_TTL_SECONDS
    );
    assert_phi_absent(&body.to_string(), &["P-10001"]);
}
