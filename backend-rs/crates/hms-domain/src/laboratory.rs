use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabPriority {
    Routine,
    Urgent,
    Stat,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabOrderStatus {
    Ordered,
    SpecimenCollected,
    ResultEntered,
    Verified,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpecimenStatus {
    Collected,
    Received,
    Rejected,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabResultStatus {
    Entered,
    Verified,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LabTestCatalogItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub specimen_type: String,
    pub result_unit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LabPanelListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub test_count: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LabOrderListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub priority: LabPriority,
    pub status: LabOrderStatus,
    pub ordered_at: DateTime<Utc>,
    pub test_count: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateLabOrderRequest {
    pub patient_id: Uuid,
    #[serde(default)]
    pub test_ids: Vec<Uuid>,
    #[serde(default)]
    pub panel_ids: Vec<Uuid>,
    pub priority: LabPriority,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CancelLabOrderRequest {
    pub cancellation_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct SpecimenListItem {
    pub id: Uuid,
    pub order_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub specimen_type: String,
    pub status: SpecimenStatus,
    pub collected_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateSpecimenRequest {
    pub order_id: Uuid,
    pub specimen_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LabResultListItem {
    pub id: Uuid,
    pub order_id: Uuid,
    pub specimen_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub test_id: Uuid,
    pub test_name: String,
    pub value: String,
    pub unit: Option<String>,
    pub status: LabResultStatus,
    pub entered_at: DateTime<Utc>,
    pub verified_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateLabResultRequest {
    pub specimen_id: Uuid,
    pub test_id: Uuid,
    pub value: String,
    pub unit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryOrderListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<LabOrderStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryResultListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<LabResultStatus>,
    pub is_verified: Option<bool>,
}
