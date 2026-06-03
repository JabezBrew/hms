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
    pub category: Option<String>,
    pub specimen_type: String,
    pub result_unit: Option<String>,
    pub is_active: bool,
    pub is_system_default: bool,
    pub is_facility_modified: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LabPanelListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub is_system_default: bool,
    pub is_facility_modified: bool,
    pub test_count: i64,
    pub created_at: DateTime<Utc>,
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
    pub order_tests: Vec<LabOrderTestItem>,
    pub specimens: Vec<SpecimenListItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LabOrderTestItem {
    pub id: Uuid,
    pub test_id: Uuid,
    pub test: LabOrderTestSummary,
    pub result: Option<LabOrderTestResultSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LabOrderTestSummary {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub short_name: String,
    pub specimen_type: String,
    pub unit: Option<String>,
    pub result_unit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LabOrderTestResultSummary {
    pub id: Uuid,
    pub value: String,
    pub unit: Option<String>,
    pub status: LabResultStatus,
    pub verified_at: Option<DateTime<Utc>>,
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
    pub is_critical: bool,
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

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BulkCreateLabResultsRequest {
    pub order_id: Uuid,
    pub specimen_id: Uuid,
    pub results: Vec<BulkCreateLabResultItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BulkCreateLabResultItem {
    pub order_test_id: Option<Uuid>,
    pub test_id: Option<Uuid>,
    pub value: String,
    pub unit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BulkCreateLabResultsResponse {
    pub created_count: i64,
    pub message: String,
    pub results: Vec<LabResultListItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BulkVerifyLabResultsRequest {
    pub order_id: Option<Uuid>,
    #[serde(default)]
    pub result_ids: Vec<Uuid>,
    pub verification_notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BulkVerifyLabResultsResponse {
    pub verified_count: i64,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryCatalogQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub category: Option<String>,
    pub is_active: Option<bool>,
    pub is_system_default: Option<bool>,
    pub is_facility_modified: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryOrderListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<LabOrderStatus>,
    pub search: Option<String>,
    pub priority: Option<LabPriority>,
    pub ordering_provider: Option<Uuid>,
    pub my_orders: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryOrderListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<LabOrderStatus>,
    pub priority: Option<LabPriority>,
    pub ordering_provider: Option<Uuid>,
    pub my_orders: Option<bool>,
}

impl From<LaboratoryOrderListGetQuery> for LaboratoryOrderListQuery {
    fn from(value: LaboratoryOrderListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            status: value.status,
            search: None,
            priority: value.priority,
            ordering_provider: value.ordering_provider,
            my_orders: value.my_orders,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryResultListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<LabResultStatus>,
    pub is_verified: Option<bool>,
    pub search: Option<String>,
    pub critical_only: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct LaboratoryResultListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<LabResultStatus>,
    pub is_verified: Option<bool>,
    pub critical_only: Option<bool>,
}

impl From<LaboratoryResultListGetQuery> for LaboratoryResultListQuery {
    fn from(value: LaboratoryResultListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            status: value.status,
            is_verified: value.is_verified,
            search: None,
            critical_only: value.critical_only,
        }
    }
}
