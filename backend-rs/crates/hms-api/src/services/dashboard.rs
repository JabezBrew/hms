use chrono::{DateTime, Utc};
use hms_db::dashboard::NotificationCursor;
use hms_domain::dashboard::{
    AdminCapacityQuery, AdminCapacitySummary, DashboardSnapshot, MarkNotificationReadRequest,
    NotificationCounts, NotificationListItem, NotificationListQuery, RealtimeChannelKind,
    RealtimeMessage, RealtimeSubscribeQuery, RealtimeSubscription,
};
use hms_domain::deployment::{FeatureKey, PermissionCode};
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::ApiError;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const DEFAULT_CAPACITY_LIMIT: u8 = 8;
const MAX_CAPACITY_LIMIT: u8 = 25;

#[derive(Clone)]
pub struct DashboardService {
    state: AppState,
}

pub struct PreparedRealtimeStream {
    pub user_id: Uuid,
    pub channel_kind: RealtimeChannelKind,
    pub channel_name: String,
    pub message: RealtimeMessage,
}

impl DashboardService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub async fn dashboard_snapshot(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<DashboardSnapshot>, ApiError> {
        require_dashboard_access(ctx, self.state.facility_id())?;
        let snapshot = self.state.dashboard_snapshot().await.map_err(|_| {
            ApiError::conflict(
                "dashboard_snapshot_failed",
                "Dashboard snapshot could not be loaded.",
            )
        })?;

        Ok(object(snapshot))
    }

    pub async fn admin_capacity_summary(
        &self,
        ctx: &hms_access::RequestContext,
        query: AdminCapacityQuery,
    ) -> Result<ObjectResponse<AdminCapacitySummary>, ApiError> {
        require_dashboard_access(ctx, self.state.facility_id())?;
        let limit = query
            .limit
            .unwrap_or(DEFAULT_CAPACITY_LIMIT)
            .clamp(1, MAX_CAPACITY_LIMIT) as i64;
        let summary = self
            .state
            .admin_capacity_summary(limit)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "admin_capacity_summary_failed",
                    "Admin capacity summary could not be loaded.",
                )
            })?;

        Ok(object(summary))
    }

    pub async fn list_notifications(
        &self,
        ctx: &hms_access::RequestContext,
        query: NotificationListQuery,
    ) -> Result<ListResponse<NotificationListItem>, ApiError> {
        require_notification_access(ctx, self.state.facility_id())?;
        let (cursor, page_size, unread_only) = notification_page_request(query)?;
        let rows = self
            .state
            .list_notifications(ctx.user_id, cursor, unread_only, page_size as i64 + 1)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "notification_list_failed",
                    "Notifications could not be loaded.",
                )
            })?;

        Ok(page_response(rows, page_size, |item| {
            encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn notification_counts(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<NotificationCounts>, ApiError> {
        require_notification_access(ctx, self.state.facility_id())?;
        let counts = self
            .state
            .notification_counts(ctx.user_id)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "notification_counts_failed",
                    "Notification counts could not be loaded.",
                )
            })?;

        Ok(object(counts))
    }

    pub async fn mark_notification_read(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: MarkNotificationReadRequest,
    ) -> Result<ObjectResponse<NotificationListItem>, ApiError> {
        require_notification_access(ctx, self.state.facility_id())?;
        let notification = self
            .state
            .mark_notification_read(ctx.user_id, id, payload.read)
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

        Ok(object(notification))
    }

    pub fn list_realtime_subscriptions(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> ListResponse<RealtimeSubscription> {
        let mut subscriptions = Vec::new();
        if require_dashboard_access(ctx, self.state.facility_id()).is_ok() {
            subscriptions.push(subscription(&self.state, RealtimeChannelKind::Dashboard));
        }
        if require_notification_access(ctx, self.state.facility_id()).is_ok() {
            subscriptions.push(subscription(
                &self.state,
                RealtimeChannelKind::Notifications,
            ));
        }

        list(
            subscriptions,
            PageInfo {
                next_cursor: None,
                has_next: false,
                limit: 10,
            },
        )
    }

    pub fn prepare_realtime_stream(
        &self,
        ctx: &hms_access::RequestContext,
        query: RealtimeSubscribeQuery,
    ) -> Result<PreparedRealtimeStream, ApiError> {
        let channel_kind = query.channel_kind.unwrap_or(RealtimeChannelKind::Dashboard);
        require_realtime_access(ctx, self.state.facility_id(), channel_kind)?;
        let channel_name = self.state.realtime_channel_name(channel_kind);
        let payload = match channel_kind {
            RealtimeChannelKind::Dashboard => json!({ "status": "snapshot_available" }),
            RealtimeChannelKind::Notifications => json!({ "status": "notification_stream_ready" }),
        };

        Ok(PreparedRealtimeStream {
            user_id: ctx.user_id,
            channel_kind,
            channel_name: channel_name.clone(),
            message: RealtimeMessage {
                message_type: "snapshot".to_owned(),
                channel_name,
                generated_at: Utc::now(),
                payload,
            },
        })
    }

    pub async fn audit_realtime_open(
        &self,
        user_id: Uuid,
        channel_name: &str,
        channel_kind: RealtimeChannelKind,
    ) -> Option<Uuid> {
        self.state
            .audit_realtime_open(user_id, channel_name, channel_kind)
            .await
            .ok()
    }

    pub async fn audit_realtime_close(&self, subscription_id: Uuid) {
        let _ = self.state.audit_realtime_close(subscription_id).await;
    }
}

impl AppState {
    pub fn dashboard_service(&self) -> DashboardService {
        DashboardService::new(self.clone())
    }
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
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
    channel_kind: RealtimeChannelKind,
) -> Result<(), ApiError> {
    match channel_kind {
        RealtimeChannelKind::Dashboard => require_dashboard_access(ctx, facility_id),
        RealtimeChannelKind::Notifications => require_notification_access(ctx, facility_id),
    }
}

fn require_dashboard_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_dashboard_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::MissingPermission => ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view dashboards.",
        ),
        other => ApiError::from(other),
    })
}

fn require_notification_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_notification_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::MissingPermission => ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view notifications.",
        ),
        other => ApiError::from(other),
    })
}

fn notification_page_request(
    query: NotificationListQuery,
) -> Result<(Option<NotificationCursor>, u8, bool), ApiError> {
    let page = cursor_list::page_request(
        query.cursor.as_deref(),
        query.limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| NotificationCursor { occurred_at, id },
    )?;
    Ok((page.cursor, page.limit, query.unread_only.unwrap_or(false)))
}

fn page_response<T>(
    rows: Vec<T>,
    page_size: u8,
    cursor_for: impl Fn(&T) -> String,
) -> ListResponse<T> {
    cursor_list::page_response(rows, page_size, cursor_for)
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
}
