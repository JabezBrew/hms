use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::deployment::{DeploymentProfile, FeatureKey, NavigationManifest, PermissionCode};

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DashboardSnapshot {
    pub id: Uuid,
    pub deployment_profile: DeploymentProfile,
    pub generated_at: DateTime<Utc>,
    pub metrics: Vec<DashboardMetric>,
    pub navigation: NavigationManifest,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DashboardMetric {
    pub key: String,
    pub label: String,
    pub value: i64,
    pub feature: FeatureKey,
    pub permission: PermissionCode,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdminCapacitySummary {
    pub summary: AdminCapacityCounts,
    pub wait_time: AdminCapacityWaitTime,
    pub wards: Vec<AdminCapacityWard>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdminCapacityCounts {
    pub ward_count: i64,
    pub high_occupancy_wards: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdminCapacityWaitTime {
    pub median_minutes: i64,
    pub p95_minutes: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdminCapacityWard {
    pub ward_id: Uuid,
    pub ward_name: String,
    pub total_beds: i64,
    pub occupied_beds: i64,
    pub available_beds: i64,
    pub occupancy_pct: f64,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AdminCapacityQuery {
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct NotificationListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub unread_only: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationPriority {
    Low,
    Normal,
    High,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NotificationListItem {
    pub id: Uuid,
    pub notification_type: String,
    pub title: String,
    pub body: String,
    pub priority: NotificationPriority,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct MarkNotificationReadRequest {
    pub read: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RealtimeSubscription {
    pub channel_name: String,
    pub channel_kind: RealtimeChannelKind,
    pub feature: FeatureKey,
    pub permission: PermissionCode,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeChannelKind {
    Dashboard,
    Notifications,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct RealtimeSubscribeQuery {
    pub channel_kind: Option<RealtimeChannelKind>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RealtimeMessage {
    pub message_type: String,
    pub channel_name: String,
    pub generated_at: DateTime<Utc>,
    pub payload: serde_json::Value,
}
