use axum::routing::get;
use axum::Router;

use crate::handlers::dashboard;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/dashboards/snapshot",
            get(dashboard::dashboard_snapshot),
        )
        .route("/api/v2/notifications", get(dashboard::list_notifications))
        .route(
            "/api/v2/notifications/:id/read",
            axum::routing::post(dashboard::mark_notification_read),
        )
        .route(
            "/api/v2/realtime/subscriptions",
            get(dashboard::list_realtime_subscriptions),
        )
        .route("/api/v2/realtime/ws", get(dashboard::realtime_ws))
}
