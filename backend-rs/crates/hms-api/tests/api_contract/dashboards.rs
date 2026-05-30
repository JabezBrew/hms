use super::*;

#[tokio::test]
async fn dashboards_notifications_and_realtime_are_profile_aware_and_phi_safe() {
    let app = app().await;
    let (owner_token, _, _) = login(app.clone(), "owner@hms.local").await;
    let (limited_token, _, _) = login(app.clone(), "limited@hms.local").await;

    let denied = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/dashboards/snapshot")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("dashboard denial succeeds");
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let snapshot = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/dashboards/snapshot")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("dashboard snapshot succeeds");
    assert_eq!(snapshot.status(), StatusCode::OK);
    let snapshot_body = json_body(snapshot).await;
    assert_eq!(snapshot_body["data"]["deployment_profile"], "hospital");
    assert!(snapshot_body["data"]["metrics"].is_array());
    assert!(snapshot_body["data"]["navigation"]["groups"].is_array());
    assert!(snapshot_body["meta"]["generated_at"].is_null());
    assert_eq!(snapshot_body["meta"]["is_stale"], true);
    assert_eq!(snapshot_body["meta"]["refresh_queued"], true);
    assert_eq!(
        snapshot_body["meta"]["ttl_seconds"],
        hms_db::dashboard::DASHBOARD_PROJECTION_TTL_SECONDS
    );
    assert!(!snapshot_body.to_string().contains("P-10001"));

    let capacity = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/dashboards/admin-v2/capacity?limit=8")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("admin capacity summary succeeds");
    assert_eq!(capacity.status(), StatusCode::OK);
    let capacity_body = json_body(capacity).await;
    assert!(
        capacity_body["data"]["summary"]["ward_count"]
            .as_i64()
            .expect("ward count is numeric")
            > 0
    );
    assert!(
        capacity_body["data"]["summary"]["high_occupancy_wards"]
            .as_i64()
            .expect("high occupancy count is numeric")
            >= 0
    );
    assert!(capacity_body["data"]["wait_time"]["median_minutes"].is_i64());
    assert!(capacity_body["data"]["wards"]
        .as_array()
        .expect("ward capacity details are array")
        .iter()
        .all(|ward| ward["ward_id"].is_string()
            && ward["ward_name"].is_string()
            && ward["total_beds"].is_i64()
            && ward["occupied_beds"].is_i64()
            && ward["available_beds"].is_i64()
            && ward["occupancy_pct"].is_number()));
    assert!(!capacity_body.to_string().contains("P-10001"));

    let notification_counts = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/notifications/counts")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("notification counts succeeds");
    assert_eq!(notification_counts.status(), StatusCode::OK);
    let notification_counts_body = json_body(notification_counts).await;
    assert_eq!(notification_counts_body["data"]["unread"], 1);
    assert_eq!(notification_counts_body["data"]["action_required"], 0);
    assert_eq!(notification_counts_body["data"]["total"], 1);

    let notifications = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/notifications?limit=5&unread_only=true")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("notification list succeeds");
    assert_eq!(notifications.status(), StatusCode::OK);
    let notifications_body = json_body(notifications).await;
    let notification_id = notifications_body["data"][0]["id"]
        .as_str()
        .expect("seed notification exists");
    assert_eq!(
        notifications_body["data"][0]["title"],
        "HMS V2 foundation ready"
    );
    assert!(!notifications_body.to_string().contains("P-10001"));

    let read = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/v2/notifications/{notification_id}/read"))
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "read": true }).to_string()))
                .expect("request builds"),
        )
        .await
        .expect("notification read succeeds");
    assert_eq!(read.status(), StatusCode::OK);
    let read_body = json_body(read).await;
    assert!(read_body["data"]["read_at"].is_string());

    let subscriptions = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/realtime/subscriptions")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("subscriptions list succeeds");
    assert_eq!(subscriptions.status(), StatusCode::OK);
    let subscriptions_body = json_body(subscriptions).await;
    let channel_names: Vec<_> = subscriptions_body["data"]
        .as_array()
        .expect("subscriptions are array")
        .iter()
        .filter_map(|subscription| subscription["channel_name"].as_str())
        .collect();
    assert!(channel_names
        .iter()
        .any(|name| name.ends_with(":dashboard")));
    assert!(channel_names
        .iter()
        .any(|name| name.ends_with(":ward_board")));
    assert!(channel_names
        .iter()
        .any(|name| name.ends_with(":laboratory")));
    let facility_id = Uuid::from_u128(hms_db::provision::FACILITY_ID).to_string();
    assert!(channel_names
        .iter()
        .all(|name| !name.contains(&facility_id)));
    assert!(!subscriptions_body.to_string().contains("P-10001"));
    assert!(!subscriptions_body.to_string().contains("patient"));

    let limited_subscriptions = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v2/realtime/subscriptions")
                .header(AUTHORIZATION, format!("Bearer {limited_token}"))
                .body(Body::empty())
                .expect("request builds"),
        )
        .await
        .expect("limited subscriptions list succeeds");
    assert_eq!(limited_subscriptions.status(), StatusCode::OK);
    let limited_body = json_body(limited_subscriptions).await;
    assert!(limited_body["data"]
        .as_array()
        .expect("limited subscriptions are array")
        .is_empty());
}

#[tokio::test]
async fn dashboard_snapshot_hot_path_uses_cache_and_refresh_gate() {
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
        "dashboard-cache-test".to_owned(),
        claims.session_id,
        user.clone(),
        user.features.clone(),
        hms_access::OffsiteState::Onsite,
        hms_access::ReauthState::from_authentication_time(Utc::now()),
    );
    let navigation = hms_domain::deployment::NavigationManifest { groups: vec![] };

    let (first, first_queries) = hms_observability::with_request_query_counter(async {
        app.state()
            .dashboard_projection(&ctx, navigation.clone())
            .await
    })
    .await;
    let first = first.expect("first dashboard projection succeeds");
    assert!(
        first_queries > 0,
        "first stale dashboard projection should touch the database"
    );
    assert!(first.is_stale);
    assert!(app.state().claim_dashboard_projection_refresh_enqueue(&ctx));
    assert!(!app.state().claim_dashboard_projection_refresh_enqueue(&ctx));

    let (second, second_queries) = hms_observability::with_request_query_counter(async {
        app.state().dashboard_projection(&ctx, navigation).await
    })
    .await;
    let second = second.expect("cached dashboard projection succeeds");
    assert!(second.is_stale);
    assert_eq!(
        second_queries, 0,
        "hot stale dashboard projection reads should not repeat DB reads"
    );
}
