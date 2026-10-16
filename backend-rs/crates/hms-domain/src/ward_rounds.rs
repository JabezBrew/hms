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
    pub position: Option<i32>,
    #[serde(default)]
    pub reviewed_targets: Vec<WardRoundReviewedTarget>,
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WardRoundTargetType {
    Prescription,
    LabTest,
    LabPanel,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct WardRoundPrescriptionReview {
    pub medication_name: String,
    pub dose: String,
    pub route: String,
    pub frequency: String,
    pub status: crate::clinical::PrescriptionStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct WardRoundReviewedTarget {
    pub resource_type: WardRoundTargetType,
    pub resource_id: Uuid,
    pub display_name: String,
    pub code: Option<String>,
    pub selected: bool,
    pub prescription: Option<WardRoundPrescriptionReview>,
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
    pub signed_by_user_id: Option<Uuid>,
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
#[serde(deny_unknown_fields)]
pub struct CommitWardRoundRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CommitWardRoundResponse {
    pub ward_round: WardRoundDetail,
    pub created_artifacts: Vec<WardRoundArtifactSummary>,
}

/// A complete reviewed draft, persisted atomically rather than as independent action writes.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SaveWardRoundDraftRequest {
    pub client_request_id: Uuid,
    pub ward_round_id: Option<Uuid>,
    /// Zero creates a new draft; an existing draft requires its exact positive version.
    pub expected_version: i64,
    pub admission_case_id: Uuid,
    #[serde(deserialize_with = "reviewed_sections")]
    pub note_sections: WardRoundNoteSections,
    pub rendered_note: Option<String>,
    pub actions: Vec<WardRoundDraftActionInput>,
}

fn reviewed_sections<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<WardRoundNoteSections, D::Error> {
    // Keep historical output deserialization permissive; strictness applies to new commands only.
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Reviewed {
        interval_history: Option<String>,
        examination: Option<String>,
        assessment: Option<String>,
        plan: Option<String>,
        #[serde(default)]
        clinical_readiness_blockers: Vec<String>,
    }
    let value = Reviewed::deserialize(deserializer)?;
    Ok(WardRoundNoteSections {
        interval_history: value.interval_history,
        examination: value.examination,
        assessment: value.assessment,
        plan: value.plan,
        clinical_readiness_blockers: value.clinical_readiness_blockers,
    })
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema, utoipa::IntoParams)]
#[serde(deny_unknown_fields)]
pub struct WardRoundCurrentQuery {
    pub admission_case_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundWorkspace {
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub admission_status: crate::ward::AdmissionStatus,
    pub ward_id: Uuid,
    pub permissions: WardRoundPermissions,
    pub ward_round: Option<WardRoundDetail>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(
    tag = "action_type",
    content = "payload",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum WardRoundDraftActionInput {
    Prescription(WardRoundPrescriptionCommand),
    LabOrder(WardRoundLabOrderInput),
    NursingTask(WardRoundNursingTaskInput),
    DischargeRequest(WardRoundDischargeInput),
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum WardRoundPrescriptionCommand {
    Start(WardRoundScheduledPrescriptionInput),
    Status(WardRoundPrescriptionStatusInput),
}

/// Stock-linked and PRN prescribing use the full prescription panel, with its reviewed policies.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WardRoundScheduledPrescriptionInput {
    pub medication_name: String,
    pub dose: String,
    pub route: String,
    pub frequency: String,
    pub instructions: String,
    pub reason: String,
    pub start_date: chrono::NaiveDate,
    pub duration_days: Option<i32>,
    pub first_dose_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WardRoundPrescriptionStatusInput {
    pub prescription_id: Uuid,
    pub expected_snapshot_token: String,
    pub status: crate::clinical::PrescriptionStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WardRoundLabOrderInput {
    pub test_ids: Vec<Uuid>,
    pub panel_ids: Vec<Uuid>,
    pub priority: LabPriority,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WardRoundNursingTaskInput {
    pub title: String,
    pub instruction: String,
    pub due_at: DateTime<Utc>,
    pub task_type: NursingTaskType,
    pub assigned_to_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WardRoundDischargeInput {}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WardRoundCommandOperation {
    SavedDraft,
    Committed,
}

/// Immutable original command result. Current state/permissions require a separate fresh GET.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardRoundCommandReceipt {
    pub client_request_id: Uuid,
    pub operation: WardRoundCommandOperation,
    pub replayed: bool,
    pub ward_round: WardRoundDetail,
    pub created_artifacts: Vec<WardRoundArtifactSummary>,
}
