//! Governed storage metadata. Used-location closeout and physical stock are separate.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StorageLocationType {
    Store,
    Pharmacy,
    Ward,
    Warehouse,
    Department,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StorageTemperatureZone {
    Ambient,
    Cold,
    Frozen,
    Controlled,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateStorageLocationRequest {
    pub client_request_id: Uuid,
    pub code: String,
    pub name: String,
    pub location_type: StorageLocationType,
    pub temperature_zone: StorageTemperatureZone,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RenameStorageLocationRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StorageLocationLifecycleRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum StorageLocationReviewedInput {
    Create {
        client_request_id: Uuid,
        code: String,
        name: String,
        location_type: StorageLocationType,
        temperature_zone: StorageTemperatureZone,
    },
    Rename {
        client_request_id: Uuid,
        location_id: Uuid,
        expected_version: i64,
        name: String,
    },
    Retire {
        client_request_id: Uuid,
        location_id: Uuid,
        expected_version: i64,
    },
    Reactivate {
        client_request_id: Uuid,
        location_id: Uuid,
        expected_version: i64,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct GovernedStorageLocation {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    // Historical classifications remain readable even if outside new-create choices.
    pub location_type: String,
    pub temperature_zone: String,
    pub is_active: bool,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StorageLocationCommandReceipt {
    pub client_request_id: Uuid,
    pub input_digest: String,
    pub reviewed_input: StorageLocationReviewedInput,
    pub recorded_by_user_id: Uuid,
    pub location: GovernedStorageLocation,
    pub changed: bool,
    pub recorded_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct StorageLocationAdministrationQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub location_type: Option<String>,
    pub temperature_zone: Option<String>,
}
