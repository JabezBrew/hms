use crate::deployment::PermissionCode;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AccessGrantKind {
    PermissionAssignment,
    Delegation,
    AuthorityAppointment,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AccessGrantListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub kind: Option<AccessGrantKind>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AccessGrantListItem {
    pub id: Uuid,
    pub kind: AccessGrantKind,
    pub user_id: Uuid,
    pub display_name: String,
    pub permission_code: Option<PermissionCode>,
    pub position_title: Option<String>,
    pub scope_type: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub status: String,
    pub revoked_at: Option<DateTime<Utc>>,
    pub reconciliation_required: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LegacyPermissionReconciliation {
    RetainIndependent,
    RemoveHistoricalCopy,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RevokeAccessGrantRequest {
    pub reconciliation: Option<LegacyPermissionReconciliation>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AccessGrantRevocation {
    pub id: Uuid,
    pub kind: AccessGrantKind,
    pub user_id: Uuid,
    pub status: String,
    pub revoked_at: DateTime<Utc>,
    pub independent_access_retained: bool,
    pub effective_permission_remaining: Option<bool>,
}
