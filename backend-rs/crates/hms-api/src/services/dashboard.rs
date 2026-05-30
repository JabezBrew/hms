use std::collections::HashMap;

use base64::Engine;
use chrono::{DateTime, Utc};
use hms_db::dashboard::{self, NotificationCursor};
use hms_domain::capabilities::{deployment_capabilities_from_features, ALL_FEATURES};
use hms_domain::dashboard::{
    AdminCapacityQuery, AdminCapacitySummary, DashboardSnapshot, MarkNotificationReadRequest,
    NotificationCounts, NotificationListItem, NotificationListQuery, RealtimeChannelKind,
    RealtimeMessage, RealtimeSubscribeQuery, RealtimeSubscription,
};
use hms_domain::deployment::{FeatureKey, PermissionCode};
use hms_events::RealtimeDeltaEnvelope;
use serde_json::json;
use sha2::Digest;
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

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn dashboard_snapshot(
        &self,
        ctx: &hms_access::RequestContext,
    ) -> Result<ObjectResponse<DashboardSnapshot>, ApiError> {
        require_dashboard_access(ctx, self.facility_id())?;
        let capabilities = deployment_capabilities_for_context(ctx);
        let projection = self
            .state
            .dashboard_projection(ctx, capabilities.navigation)
            .await
            .map_err(|_| {
                ApiError::conflict(
                    "dashboard_snapshot_failed",
                    "Dashboard snapshot could not be loaded.",
                )
            })?;

        let refresh_queued =
            if projection.is_stale && self.state.claim_dashboard_projection_refresh_enqueue(ctx) {
                match dashboard::queue_dashboard_projection_refresh(
                    self.pool(),
                    self.facility_id(),
                    ctx.active_profile,
                )
                .await
                {
                    Ok(queue) => queue.queued,
                    Err(error) => {
                        tracing::warn!(%error, "dashboard projection refresh enqueue failed");
                        false
                    }
                }
            } else {
                false
            };

        let mut snapshot = projection
            .snapshot
            .unwrap_or_else(|| empty_dashboard_snapshot(ctx));
        snapshot.metrics = role_allowed_metrics(snapshot.metrics, ctx);

        Ok(ObjectResponse {
            data: snapshot,
            meta: json!({
                "generated_at": projection.generated_at,
                "is_stale": projection.is_stale,
                "refresh_queued": refresh_queued,
                "ttl_seconds": dashboard::DASHBOARD_PROJECTION_TTL_SECONDS,
            }),
        })
    }

    pub async fn admin_capacity_summary(
        &self,
        ctx: &hms_access::RequestContext,
        query: AdminCapacityQuery,
    ) -> Result<ObjectResponse<AdminCapacitySummary>, ApiError> {
        require_dashboard_access(ctx, self.facility_id())?;
        let limit = query
            .limit
            .unwrap_or(DEFAULT_CAPACITY_LIMIT)
            .clamp(1, MAX_CAPACITY_LIMIT) as i64;
        let summary = dashboard::admin_capacity_summary(self.pool(), self.facility_id(), limit)
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
        require_notification_access(ctx, self.facility_id())?;
        let (cursor, page_size, unread_only) = notification_page_request(query)?;
        let rows = dashboard::list_notifications(
            self.pool(),
            self.facility_id(),
            ctx.user_id,
            cursor,
            unread_only,
            page_size as i64 + 1,
        )
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
        require_notification_access(ctx, self.facility_id())?;
        let counts = dashboard::notification_counts(self.pool(), self.facility_id(), ctx.user_id)
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
        require_notification_access(ctx, self.facility_id())?;
        let notification = dashboard::mark_notification_read(
            self.pool(),
            self.facility_id(),
            ctx.user_id,
            id,
            payload.read,
        )
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
        if require_dashboard_access(ctx, self.facility_id()).is_ok() {
            subscriptions.push(subscription(
                self.facility_id(),
                RealtimeChannelKind::Dashboard,
            ));
        }
        if require_notification_access(ctx, self.facility_id()).is_ok() {
            subscriptions.push(subscription(
                self.facility_id(),
                RealtimeChannelKind::Notifications,
            ));
        }
        if require_ward_board_realtime_access(ctx, self.facility_id()).is_ok() {
            subscriptions.push(subscription(
                self.facility_id(),
                RealtimeChannelKind::WardBoard,
            ));
        }
        if require_laboratory_realtime_access(ctx, self.facility_id()).is_ok() {
            subscriptions.push(subscription(
                self.facility_id(),
                RealtimeChannelKind::Laboratory,
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
        require_realtime_access(ctx, self.facility_id(), channel_kind)?;
        let channel_name = realtime_channel_name(self.facility_id(), channel_kind);
        let occurred_at = Utc::now();
        let payload = serde_json::to_value(initial_realtime_delta(
            self.facility_id(),
            channel_kind,
            occurred_at,
        )?)
        .map_err(|_| ApiError::conflict("realtime_delta_failed", "Realtime delta failed."))?;

        Ok(PreparedRealtimeStream {
            user_id: ctx.user_id,
            channel_kind,
            channel_name: channel_name.clone(),
            message: RealtimeMessage {
                message_type: "delta".to_owned(),
                channel_name,
                generated_at: occurred_at,
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
        dashboard::audit_realtime_open(
            self.pool(),
            self.facility_id(),
            user_id,
            channel_name,
            channel_kind_key(channel_kind),
        )
        .await
        .ok()
    }

    pub async fn audit_realtime_close(&self, subscription_id: Uuid) {
        let _ = dashboard::audit_realtime_close(self.pool(), subscription_id).await;
    }
}

impl AppState {
    pub fn dashboard_service(&self) -> DashboardService {
        DashboardService::new(self.clone())
    }
}

fn subscription(facility_id: Uuid, channel_kind: RealtimeChannelKind) -> RealtimeSubscription {
    let (feature, permission) = match channel_kind {
        RealtimeChannelKind::Dashboard => (FeatureKey::Dashboards, PermissionCode::DashboardView),
        RealtimeChannelKind::Notifications => {
            (FeatureKey::Dashboards, PermissionCode::NotificationView)
        }
        RealtimeChannelKind::WardBoard => (FeatureKey::Wards, PermissionCode::WardView),
        RealtimeChannelKind::Laboratory => (
            FeatureKey::Laboratory,
            PermissionCode::LaboratoryOrderManage,
        ),
    };
    RealtimeSubscription {
        channel_name: realtime_channel_name(facility_id, channel_kind),
        channel_kind,
        feature,
        permission,
    }
}

fn deployment_capabilities_for_context(
    ctx: &hms_access::RequestContext,
) -> hms_domain::capabilities::DeploymentCapabilities {
    let features: HashMap<_, _> = ALL_FEATURES
        .into_iter()
        .map(|feature| (feature, ctx.enabled_features.contains(&feature)))
        .collect();
    deployment_capabilities_from_features(
        ctx.active_profile,
        ctx.facility_id,
        &ctx.facility_code,
        features,
    )
}

fn empty_dashboard_snapshot(ctx: &hms_access::RequestContext) -> DashboardSnapshot {
    DashboardSnapshot {
        id: Uuid::nil(),
        deployment_profile: ctx.active_profile,
        generated_at: DateTime::<Utc>::from(std::time::UNIX_EPOCH),
        metrics: Vec::new(),
        navigation: deployment_capabilities_for_context(ctx).navigation,
    }
}

fn role_allowed_metrics(
    metrics: Vec<hms_domain::dashboard::DashboardMetric>,
    ctx: &hms_access::RequestContext,
) -> Vec<hms_domain::dashboard::DashboardMetric> {
    metrics
        .into_iter()
        .filter(|metric| {
            ctx.enabled_features.contains(&metric.feature)
                && ctx.permissions.contains(&metric.permission)
        })
        .collect()
}

fn realtime_channel_name(facility_id: Uuid, channel_kind: RealtimeChannelKind) -> String {
    let digest = sha2::Sha256::digest(facility_id.as_bytes());
    let scope = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&digest[..9]);
    format!("facility:{scope}:{}", channel_kind_key(channel_kind))
}

fn channel_kind_key(channel_kind: RealtimeChannelKind) -> &'static str {
    match channel_kind {
        RealtimeChannelKind::Dashboard => "dashboard",
        RealtimeChannelKind::Notifications => "notifications",
        RealtimeChannelKind::WardBoard => "ward_board",
        RealtimeChannelKind::Laboratory => "laboratory",
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
        RealtimeChannelKind::WardBoard => require_ward_board_realtime_access(ctx, facility_id),
        RealtimeChannelKind::Laboratory => require_laboratory_realtime_access(ctx, facility_id),
    }
}

fn initial_realtime_delta(
    facility_id: Uuid,
    channel_kind: RealtimeChannelKind,
    occurred_at: DateTime<Utc>,
) -> Result<RealtimeDeltaEnvelope, ApiError> {
    let (event_type, entity_type, changed_fields) = match channel_kind {
        RealtimeChannelKind::Dashboard => (
            "dashboard.projection_freshness",
            "dashboard_projection",
            vec!["generated_at"],
        ),
        RealtimeChannelKind::Notifications => (
            "notifications.summary_updated",
            "notification_summary",
            vec!["unread"],
        ),
        RealtimeChannelKind::WardBoard => (
            "ward_board.projection_freshness",
            "ward_board_projection",
            vec!["generated_at", "open_task_count", "queue_status"],
        ),
        RealtimeChannelKind::Laboratory => (
            "laboratory.order_status_summary_updated",
            "laboratory_order_summary",
            vec!["status_counts"],
        ),
    };
    RealtimeDeltaEnvelope::try_new(
        event_type,
        facility_id,
        entity_type,
        facility_id,
        occurred_at.timestamp_millis(),
        changed_fields,
        occurred_at,
    )
    .map_err(|_| ApiError::conflict("realtime_delta_failed", "Realtime delta failed."))
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

fn require_ward_board_realtime_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_patient_workflow_access(ctx, facility_id, PermissionCode::WardView).map_err(
        |error| match error {
            hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
                "patient_access_denied",
                "You do not have access to ward board realtime updates.",
            ),
            hms_access::AccessError::MissingPermission => ApiError::forbidden(
                "permission_denied",
                "You do not have permission to view ward board realtime updates.",
            ),
            other => ApiError::from(other),
        },
    )
}

fn require_laboratory_realtime_access(
    ctx: &hms_access::RequestContext,
    facility_id: Uuid,
) -> Result<(), ApiError> {
    hms_access::require_lab_list_access(ctx, facility_id).map_err(|error| match error {
        hms_access::AccessError::LaboratoryAccessDenied
        | hms_access::AccessError::MissingPermission => ApiError::forbidden(
            "permission_denied",
            "You do not have permission to view laboratory realtime updates.",
        ),
        hms_access::AccessError::PatientWorkflowAccessDenied => ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to laboratory realtime updates.",
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
