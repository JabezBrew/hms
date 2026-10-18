//! Governed organization maintenance. Membership and clinical access are separate.
use crate::admin::{OrgUnitType, OrganizationUnitListItem};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RenameOrganizationUnitRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OrganizationUnitLifecycleRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum OrganizationUnitReviewedInput {
    Create {
        client_request_id: Uuid,
        code: String,
        name: String,
        unit_type: OrgUnitType,
        parent_unit_id: Option<Uuid>,
    },
    Rename {
        client_request_id: Uuid,
        unit_id: Uuid,
        expected_version: i64,
        name: String,
    },
    Retire {
        client_request_id: Uuid,
        unit_id: Uuid,
        expected_version: i64,
    },
    Reactivate {
        client_request_id: Uuid,
        unit_id: Uuid,
        expected_version: i64,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OrganizationUnitCommandReceipt {
    pub client_request_id: Uuid,
    pub input_digest: String,
    pub reviewed_input: OrganizationUnitReviewedInput,
    pub recorded_by_user_id: Uuid,
    pub unit: OrganizationUnitListItem,
    pub changed: bool,
    pub recorded_at: DateTime<Utc>,
}
