use super::*;

#[tokio::test]
async fn ward_hot_list_clamps_limit_and_metrics_exclude_phi_values() {
    let app = app().await;
    let owner = Actor::login(&app, "owner@hms.local").await;
    let phi_search = "Ama%20Mensah%20MRN-GA-0001";

    let response = api_get(
        app.clone(),
        &owner,
        format!("/api/v2/wards?limit=250&search={phi_search}"),
    )
    .await;
    let body = assert_json_status(response, StatusCode::OK).await;
    assert_cursor_page(&body, 100);
    let payload_size = body.to_string().len();
    assert!(
        payload_size < 64 * 1024,
        "ward hot-list payload grew to {payload_size} bytes"
    );

    let metrics_response = api_get(app.clone(), &owner, "/api/v2/metrics").await;
    assert_eq!(metrics_response.status(), StatusCode::OK);
    let metrics = text_body(metrics_response).await;
    assert!(metrics.contains("route=\"/api/v2/wards\""), "{metrics}");
    assert_phi_absent(&metrics, &["Ama", "Mensah", "MRN-GA-0001"]);
}
