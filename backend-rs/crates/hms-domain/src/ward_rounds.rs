use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::laboratory::LabPriority;
use crate::ward::NursingTaskType;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WardRoundStatus {
    Draft,
    Committed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WardRoundActionType {
    Prescription,
    LabOrder,
    NursingTask,
    DischargeRequest,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WardRoundActionStatus {
    Draft,
    Committed,
    Cancelled,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct WardRoundNoteSections {
    pub interval_history: Option<String>,
    pub examination: Option<String>,
    pub assessment: Option<String>,
    pub plan: Option<String>,
    #[serde(default)]
    pub clinical_readiness_blockers: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct WardRoundReviewRail {
    #[serde(default)]
    pub active_medication_count: i64,
    #[serde(default)]
    pub open_lab_order_count: i64,
    #[serde(default)]
    pub open_nursing_task_count: i64,
    #[serde(default)]
    pub discharge_blocker_count: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct WardRoundActionCounts {
    #[serde(default)]
    pub draft: i64,
    #[serde(default)]
    pub committed: i64,
    #[serde(default)]
    pub cancelled: i64,
    #[serde(default)]
    pub prescriptions: i64,
    #[serde(default)]
    pub lab_orders: i64,
    #[serde(default)]
    pub nursing_tasks: i64,
    #[serde(default)]
    pub discharge_requests: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundArtifactSummary {
    pub resource_type: String,
    pub resource_id: Uuid,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundPermissions {
    pub can_view: bool,
    pub can_edit_draft: bool,
    pub can_commit: bool,
    pub can_add_prescription: bool,
    pub can_order_labs: bool,
    pub can_create_nursing_task: bool,
    pub can_request_discharge: bool,
    pub read_only: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundActionItem {
    pub id: Uuid,
    pub ward_round_id: Uuid,
    pub action_type: WardRoundActionType,
    pub status: WardRoundActionStatus,
    pub title: Option<String>,
    pub instruction: Option<String>,
    pub payload: JsonValue,
    pub committed_resource_type: Option<String>,
    pub committed_resource_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundDetail {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub status: WardRoundStatus,
    pub version: i64,
    pub note_sections: WardRoundNoteSections,
    pub review_rail: WardRoundReviewRail,
    pub rendered_note: Option<String>,
    pub action_counts: WardRoundActionCounts,
    pub permissions: WardRoundPermissions,
    pub actions: Vec<WardRoundActionItem>,
    pub artifacts: Vec<WardRoundArtifactSummary>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub signed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateWardRoundRequest {
    pub admission_case_id: Option<Uuid>,
    pub note_sections: Option<WardRoundNoteSections>,
    pub rendered_note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateWardRoundRequest {
    pub expected_version: i64,
    pub note_sections: Option<WardRoundNoteSections>,
    pub rendered_note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateWardRoundActionRequest {
    pub action_type: WardRoundActionType,
    pub title: Option<String>,
    pub instruction: Option<String>,
    pub payload: JsonValue,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateWardRoundActionRequest {
    pub title: Option<String>,
    pub instruction: Option<String>,
    pub payload: Option<JsonValue>,
    pub status: Option<WardRoundActionStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundPrescriptionPayload {
    pub prescription_id: Option<Uuid>,
    pub medication_name: Option<String>,
    pub dose: Option<String>,
    pub frequency: Option<String>,
    pub status: Option<crate::clinical::PrescriptionStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundLabOrderPayload {
    #[serde(default)]
    pub test_ids: Vec<Uuid>,
    #[serde(default)]
    pub panel_ids: Vec<Uuid>,
    pub priority: Option<LabPriority>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundNursingTaskPayload {
    pub title: String,
    pub instruction: String,
    pub due_at: DateTime<Utc>,
    pub task_type: Option<NursingTaskType>,
    pub assigned_to_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct WardRoundDischargeRequestPayload {
    pub requested: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CommitWardRoundRequest {
    pub expected_version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CommitWardRoundResponse {
    pub ward_round: WardRoundDetail,
    pub created_artifacts: Vec<WardRoundArtifactSummary>,
}
