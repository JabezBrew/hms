use axum::extract::ws::{Message, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use hms_domain::dashboard::{
    AdminCapacityQuery, AdminCapacitySummary, DashboardSnapshot, MarkNotificationReadRequest,
    NotificationCounts, NotificationListItem, NotificationListQuery, RealtimeSubscribeQuery,
    RealtimeSubscription,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(get, path = "/api/v2/dashboards/snapshot", operation_id = "getDashboardSnapshot", tag = "dashboards", security(("bearerAuth" = [])), responses((status = 200, body = ObjectResponse<DashboardSnapshot>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn dashboard_snapshot(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ObjectResponse<DashboardSnapshot>>, ApiError> {
    Ok(Json(
        state.dashboard_service().dashboard_snapshot(&user).await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/dashboards/admin-v2/capacity", operation_id = "getAdminDashboardV2Capacity", tag = "dashboards", security(("bearerAuth" = [])), params(AdminCapacityQuery), responses((status = 200, body = ObjectResponse<AdminCapacitySummary>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn admin_capacity_summary(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<AdminCapacityQuery>,
) -> Result<Json<ObjectResponse<AdminCapacitySummary>>, ApiError> {
    Ok(Json(
        state
            .dashboard_service()
            .admin_capacity_summary(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/notifications", operation_id = "getNotifications", tag = "notifications", security(("bearerAuth" = [])), params(NotificationListQuery), responses((status = 200, body = ListResponse<NotificationListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_notifications(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<NotificationListQuery>,
) -> Result<Json<ListResponse<NotificationListItem>>, ApiError> {
    Ok(Json(
        state
            .dashboard_service()
            .list_notifications(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/notifications/counts", operation_id = "getNotificationCounts", tag = "notifications", security(("bearerAuth" = [])), responses((status = 200, body = ObjectResponse<NotificationCounts>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn notification_counts(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ObjectResponse<NotificationCounts>>, ApiError> {
    Ok(Json(
        state.dashboard_service().notification_counts(&user).await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/notifications/{id}/read", operation_id = "postNotificationRead", tag = "notifications", security(("bearerAuth" = [])), request_body = MarkNotificationReadRequest, responses((status = 200, body = ObjectResponse<NotificationListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn mark_notification_read(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<MarkNotificationReadRequest>,
) -> Result<Json<ObjectResponse<NotificationListItem>>, ApiError> {
    Ok(Json(
        state
            .dashboard_service()
            .mark_notification_read(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/realtime/subscriptions", operation_id = "getRealtimeSubscriptions", tag = "realtime", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<RealtimeSubscription>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_realtime_subscriptions(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ListResponse<RealtimeSubscription>>, ApiError> {
    Ok(Json(
        state.dashboard_service().list_realtime_subscriptions(&user),
    ))
}

pub async fn realtime_ws(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<RealtimeSubscribeQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, ApiError> {
    let dashboard = state.dashboard_service();
    let stream = dashboard.prepare_realtime_stream(&user, query)?;
    Ok(ws.on_upgrade(move |mut socket| async move {
        let subscription_id = dashboard
            .audit_realtime_open(stream.user_id, &stream.channel_name, stream.channel_kind)
            .await;
        if let Ok(serialized) = serde_json::to_string(&stream.message) {
            let _ = socket.send(Message::Text(serialized)).await;
        }
        if let Some(subscription_id) = subscription_id {
            dashboard.audit_realtime_close(subscription_id).await;
        }
    }))
}
