//! Reviewed immediate same-episode ward and bed movement.
use crate::ward::{AdmissionStatus, BedStatus};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionPlacementOrigin {
    Activation,
    Move,
    LegacyCurrentObservation,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionMoveTaskPolicy {
    RouteAllClearAssignees,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionMoveUnavailableReason {
    SourceInactive,
    SourceInconsistent,
    TooManyOpenTasks,
    NursingAuthorityRequired,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct AdmissionPlacementLabels {
    pub ward_id: Uuid,
    pub ward_name: String,
    pub bed_id: Uuid,
    pub bed_code: String,
    pub section_id: Option<Uuid>,
    pub section_name: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct AdmissionPlacementSnapshot {
    pub id: Uuid,
    pub placement_revision: i64,
    pub labels: AdmissionPlacementLabels,
    pub started_at: DateTime<Utc>,
    pub origin: AdmissionPlacementOrigin,
    pub legacy_unknown_prefix: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct AdmissionMoveEpisode {
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub admitted_at: DateTime<Utc>,
    pub status: AdmissionStatus,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionPlacementContext {
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub admitted_at: Option<DateTime<Utc>>,
    pub status: AdmissionStatus,
    pub placement_revision: i64,
    pub placement_token: String,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub bed_id: Option<Uuid>,
    pub bed_code: Option<String>,
    pub current_placement: Option<AdmissionPlacementSnapshot>,
    pub placement_history_partial: bool,
    pub placement_known_from: Option<DateTime<Utc>>,
    pub open_task_count: i64,
    pub assigned_open_task_count: i64,
    pub max_open_tasks: u16,
    pub task_membership_token: Option<String>,
    pub source_cleaning_minutes: i32,
    pub can_move: bool,
    pub unavailable_reason: Option<AdmissionMoveUnavailableReason>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionMoveDestination {
    #[serde(flatten)]
    pub labels: AdmissionPlacementLabels,
    pub candidate_token: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AdmissionMoveRequest {
    pub client_request_id: Uuid,
    pub expected_placement_token: String,
    pub destination_bed_id: Uuid,
    pub expected_destination_token: String,
    pub expected_task_membership_token: String,
    pub task_policy: AdmissionMoveTaskPolicy,
    pub reason: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct AdmissionMoveTaskResult {
    pub open_task_count: i64,
    pub routed_task_count: i64,
    pub cleared_assignee_count: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct AdmissionMoveBedRelease {
    pub status: BedStatus,
    pub cleaning_minutes: i32,
    pub cleaning_due_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct AdmissionMoveHistoryItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub placement_revision: i64,
    pub moved_at: DateTime<Utc>,
    pub recorded_by_user_id: Uuid,
    pub recorded_by_display_name: String,
    pub source: AdmissionPlacementLabels,
    pub destination: AdmissionPlacementLabels,
    pub routed_task_count: i64,
    pub cleared_assignee_count: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct AdmissionMoveDetail {
    #[serde(flatten)]
    pub history: AdmissionMoveHistoryItem,
    pub episode: AdmissionMoveEpisode,
    pub source_placement: AdmissionPlacementSnapshot,
    pub destination_placement: AdmissionPlacementSnapshot,
    pub reason: String,
    pub task_policy: AdmissionMoveTaskPolicy,
    pub task_result: AdmissionMoveTaskResult,
    pub source_bed_release: AdmissionMoveBedRelease,
    pub placement_history_partial: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionMoveReceipt {
    pub client_request_id: Uuid,
    pub replayed: bool,
    pub recorded_at: DateTime<Utc>,
    pub reviewed_input: AdmissionMoveRequest,
    pub movement: AdmissionMoveDetail,
}
#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AdmissionMoveDestinationQuery {
    pub ward_id: Option<Uuid>,
    pub search: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AdmissionMoveHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
