use axum::extract::ws::{Message, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::require_permission;
use hms_db::dashboard::NotificationCursor;
use hms_domain::auth::AuthUser;
use hms_domain::dashboard::{
    AdminCapacityQuery, AdminCapacitySummary, DashboardSnapshot, MarkNotificationReadRequest,
    NotificationListItem, NotificationListQuery, RealtimeChannelKind, RealtimeMessage,
    RealtimeSubscribeQuery, RealtimeSubscription,
};
use hms_domain::deployment::{FeatureKey, PermissionCode};
use serde_json::json;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const DEFAULT_CAPACITY_LIMIT: u8 = 8;
const MAX_CAPACITY_LIMIT: u8 = 25;

#[utoipa::path(get, path = "/api/v2/dashboards/snapshot", operation_id = "getDashboardSnapshot", tag = "dashboards", security(("bearerAuth" = [])), responses((status = 200, body = ObjectResponse<DashboardSnapshot>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn dashboard_snapshot(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ObjectResponse<DashboardSnapshot>>, ApiError> {
    require_dashboard_access(&user, state.facility_id())?;
    let snapshot = state.dashboard_snapshot().await.map_err(|_| {
        ApiError::conflict(
            "dashboard_snapshot_failed",
            "Dashboard snapshot could not be loaded.",
        )
    })?;
    Ok(Json(object(snapshot)))
}

#[utoipa::path(get, path = "/api/v2/dashboards/admin-v2/capacity", operation_id = "getAdminDashboardV2Capacity", tag = "dashboards", security(("bearerAuth" = [])), params(AdminCapacityQuery), responses((status = 200, body = ObjectResponse<AdminCapacitySummary>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn admin_capacity_summary(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<AdminCapacityQuery>,
) -> Result<Json<ObjectResponse<AdminCapacitySummary>>, ApiError> {
    require_dashboard_access(&user, state.facility_id())?;
    let limit = query
        .limit
        .unwrap_or(DEFAULT_CAPACITY_LIMIT)
        .clamp(1, MAX_CAPACITY_LIMIT) as i64;
    let summary = state.admin_capacity_summary(limit).await.map_err(|_| {
        ApiError::conflict(
            "admin_capacity_summary_failed",
            "Admin capacity summary could not be loaded.",
        )
    })?;
    Ok(Json(object(summary)))
}

#[utoipa::path(get, path = "/api/v2/notifications", operation_id = "getNotifications", tag = "notifications", security(("bearerAuth" = [])), params(NotificationListQuery), responses((status = 200, body = ListResponse<NotificationListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_notifications(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<NotificationListQuery>,
) -> Result<Json<ListResponse<NotificationListItem>>, ApiError> {
    require_notification_access(&user, state.facility_id())?;
    let (cursor, page_size, unread_only) = notification_page_request(query)?;
    let rows = state
        .list_notifications(user.id, cursor, unread_only, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "notification_list_failed",
                "Notifications could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/notifications/{id}/read", operation_id = "postNotificationRead", tag = "notifications", security(("bearerAuth" = [])), request_body = MarkNotificationReadRequest, responses((status = 200, body = ObjectResponse<NotificationListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn mark_notification_read(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<MarkNotificationReadRequest>,
) -> Result<Json<ObjectResponse<NotificationListItem>>, ApiError> {
    require_notification_access(&user, state.facility_id())?;
    let notification = state
        .mark_notification_read(user.id, id, payload.read)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "notification_update_failed",
                "Notification could not be updated.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("notification_not_found", "Notification was not found.")
        })?;
    Ok(Json(object(notification)))
}

#[utoipa::path(get, path = "/api/v2/realtime/subscriptions", operation_id = "getRealtimeSubscriptions", tag = "realtime", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<RealtimeSubscription>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_realtime_subscriptions(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<RealtimeSubscription>>, ApiError> {
    let mut subscriptions = Vec::new();
    if require_dashboard_access(&user, state.facility_id()).is_ok() {
        subscriptions.push(subscription(&state, RealtimeChannelKind::Dashboard));
    }
    if require_notification_access(&user, state.facility_id()).is_ok() {
        subscriptions.push(subscription(&state, RealtimeChannelKind::Notifications));
    }
    Ok(Json(list(
        subscriptions,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: 10,
        },
    )))
}

pub async fn realtime_ws(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<RealtimeSubscribeQuery>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, ApiError> {
    let channel_kind = query.channel_kind.unwrap_or(RealtimeChannelKind::Dashboard);
    require_realtime_access(&user, state.facility_id(), channel_kind)?;
    let channel_name = state.realtime_channel_name(channel_kind);
    Ok(ws.on_upgrade(move |mut socket| async move {
        let subscription_id = state
            .audit_realtime_open(user.id, &channel_name, channel_kind)
            .await
            .ok();
        let payload = match channel_kind {
            RealtimeChannelKind::Dashboard => json!({ "status": "snapshot_available" }),
            RealtimeChannelKind::Notifications => json!({ "status": "notification_stream_ready" }),
        };
        let message = RealtimeMessage {
            message_type: "snapshot".to_owned(),
            channel_name: channel_name.clone(),
            generated_at: Utc::now(),
            payload,
        };
        if let Ok(serialized) = serde_json::to_string(&message) {
            let _ = socket.send(Message::Text(serialized)).await;
        }
        if let Some(subscription_id) = subscription_id {
            let _ = state.audit_realtime_close(subscription_id).await;
        }
    }))
}

fn subscription(state: &AppState, channel_kind: RealtimeChannelKind) -> RealtimeSubscription {
    let (feature, permission) = match channel_kind {
        RealtimeChannelKind::Dashboard => (FeatureKey::Dashboards, PermissionCode::DashboardView),
        RealtimeChannelKind::Notifications => {
            (FeatureKey::Dashboards, PermissionCode::NotificationView)
        }
    };
    RealtimeSubscription {
        channel_name: state.realtime_channel_name(channel_kind),
        channel_kind,
        feature,
        permission,
    }
}

fn require_realtime_access(
    user: &AuthUser,
    facility_id: Uuid,
    channel_kind: RealtimeChannelKind,
) -> Result<(), ApiError> {
    match channel_kind {
        RealtimeChannelKind::Dashboard => require_dashboard_access(user, facility_id),
        RealtimeChannelKind::Notifications => require_notification_access(user, facility_id),
    }
}

fn require_dashboard_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_permission(user, PermissionCode::DashboardView).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view dashboards.",
        )
    })?;
    require_facility(user, facility_id)
}

fn require_notification_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_permission(user, PermissionCode::NotificationView).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view notifications.",
        )
    })?;
    require_facility(user, facility_id)
}

fn require_facility(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    if user.facility_id != facility_id {
        return Err(ApiError::forbidden(
            "permission_denied",
            "You do not have access to this facility.",
        ));
    }
    Ok(())
}

fn notification_page_request(
    query: NotificationListQuery,
) -> Result<(Option<NotificationCursor>, u8, bool), ApiError> {
    let page_size = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = query.cursor.map(decode_cursor).transpose()?;
    Ok((cursor, page_size, query.unread_only.unwrap_or(false)))
}

fn page_response<T>(
    mut rows: Vec<T>,
    page_size: u8,
    cursor_for: impl Fn(&T) -> String,
) -> ListResponse<T> {
    let has_next = rows.len() > page_size as usize;
    if has_next {
        rows.truncate(page_size as usize);
    }
    let next_cursor = if has_next {
        rows.last().map(cursor_for)
    } else {
        None
    };
    list(
        rows,
        PageInfo {
            next_cursor,
            has_next,
            limit: page_size,
        },
    )
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    format!("{}:{}", occurred_at.timestamp_micros(), id)
}

fn decode_cursor(value: String) -> Result<NotificationCursor, ApiError> {
    let (micros, id) = value
        .split_once(':')
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let occurred_at = DateTime::<Utc>::from_timestamp_micros(micros)
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let id = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    Ok(NotificationCursor { occurred_at, id })
}
