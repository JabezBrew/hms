//! Line-backed recurring stock requests, distinct from historical order metadata.
use crate::inventory::{RequisitionStatus, StandingOrderStatus};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TemplateFrequency {
    Daily,
    Weekly,
    Biweekly,
    Monthly,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StandingTemplateItemInput {
    pub item_id: Uuid,
    pub quantity: i64,
    pub expected_unit: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateStandingTemplateRequest {
    pub name: String,
    pub requesting_location_id: Uuid,
    pub fulfilling_location_id: Uuid,
    pub frequency: TemplateFrequency,
    pub next_run_on: NaiveDate,
    pub monthly_day: Option<u8>,
    pub notes: Option<String>,
    pub items: Vec<StandingTemplateItemInput>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateStandingTemplateRequest {
    pub expected_version: i64,
    pub template: CreateStandingTemplateRequest,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StandingTemplateStatusRequest {
    pub expected_version: i64,
    pub status: StandingOrderStatus,
}
#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct StandingTemplateListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub status: Option<StandingOrderStatus>,
    pub due_only: Option<bool>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StandingTemplateListItem {
    pub id: Uuid,
    pub name: String,
    pub requesting_location_id: Uuid,
    pub requesting_location_name: String,
    pub fulfilling_location_id: Uuid,
    pub fulfilling_location_name: String,
    pub frequency: TemplateFrequency,
    pub status: StandingOrderStatus,
    pub next_run_on: NaiveDate,
    pub monthly_day: Option<i32>,
    pub version: i64,
    pub line_count: i32,
    pub last_requisition_id: Option<Uuid>,
    pub last_generated_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StandingTemplateItem {
    pub id: Uuid,
    pub item_id: Uuid,
    pub item_code: String,
    pub item_name: String,
    pub unit: String,
    pub quantity: i64,
    pub current_unit: String,
    pub requires_unit_review: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StandingTemplateDetail {
    #[serde(flatten)]
    pub summary: StandingTemplateListItem,
    pub notes: Option<String>,
    pub items: Vec<StandingTemplateItem>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct GenerateStandingTemplateRequest {
    pub scheduled_for: NaiveDate,
    pub expected_version: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StandingRequestAction {
    pub expected_source_version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RequisitionReviewItem {
    pub id: Uuid,
    pub item_id: Uuid,
    pub item_code: String,
    pub item_name: String,
    pub unit: String,
    pub quantity_requested: i64,
    pub quantity_issued: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RequisitionReview {
    pub id: Uuid,
    pub requesting_location_id: Uuid,
    pub requesting_location_name: String,
    pub fulfilling_location_id: Uuid,
    pub fulfilling_location_name: String,
    pub status: RequisitionStatus,
    pub source_template_id: Uuid,
    pub template_version: i64,
    pub scheduled_for: NaiveDate,
    pub created_at: DateTime<Utc>,
    pub approved_at: Option<DateTime<Utc>>,
    pub approved_by_user_id: Option<Uuid>,
    pub fulfilled_at: Option<DateTime<Utc>>,
    pub fulfilled_by_user_id: Option<Uuid>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub items: Vec<RequisitionReviewItem>,
}
