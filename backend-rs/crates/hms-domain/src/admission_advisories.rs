//! Nonblocking admission follow-up. System activation/intake blockers remain separate.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionAdvisoryType {
    PharmacyMedRec,
    BaselineLabFollowup,
    InfectionControl,
    Dietary,
    SocialWork,
    Transport,
    Documents,
    Other,
}
impl AdmissionAdvisoryType {
    pub const ALL: [Self; 8] = [
        Self::PharmacyMedRec,
        Self::BaselineLabFollowup,
        Self::InfectionControl,
        Self::Dietary,
        Self::SocialWork,
        Self::Transport,
        Self::Documents,
        Self::Other,
    ];
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionAdvisoryPhase {
    PreActivation,
    PostActivation,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionAdvisoryStatus {
    Pending,
    Completed,
    AcknowledgedUnresolved,
    Cancelled,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionAdvisoryDecision {
    Completed,
    AcknowledgedUnresolved,
    Cancelled,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionAdvisoryDecisionSource {
    Manual,
    AdmissionCaseCancelled,
    AdmissionDischarged,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionAdvisorySystemReason {
    AdmissionCaseCancelled,
    AdmissionDischarged,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct AdmissionAdvisoryCaseQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub include_closed: Option<bool>,
    pub status: Option<crate::ward::AdmissionStatus>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionAdvisoryCase {
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub current_ward_id: Uuid,
    pub current_ward_name: String,
    pub admission_status: crate::ward::AdmissionStatus,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionAdvisoryListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub captured_ward_id: Uuid,
    pub task_type: AdmissionAdvisoryType,
    pub phase: AdmissionAdvisoryPhase,
    pub status: AdmissionAdvisoryStatus,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub decided_at: Option<DateTime<Utc>>,
    pub can_complete: bool,
    pub can_acknowledge_unresolved: bool,
    pub can_cancel: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct AdmissionAdvisoryCounts {
    pub pending: u8,
    pub completed: u8,
    pub acknowledged_unresolved: u8,
    pub cancelled: u8,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionAdvisoryContext {
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub admission_status: crate::ward::AdmissionStatus,
    pub current_ward_id: Uuid,
    pub current_ward_name: String,
    pub context_token: String,
    pub can_create: bool,
    pub can_complete: bool,
    pub can_acknowledge_unresolved: bool,
    pub can_cancel: bool,
    pub available_types: Vec<AdmissionAdvisoryType>,
    pub advisories: Vec<AdmissionAdvisoryListItem>,
    pub counts_by_status: AdmissionAdvisoryCounts,
    pub complete: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionAdvisoryDecisionRecord {
    pub status: AdmissionAdvisoryStatus,
    pub reason: Option<String>,
    pub source: AdmissionAdvisoryDecisionSource,
    pub system_reason_code: Option<AdmissionAdvisorySystemReason>,
    pub recorded_by_user_id: Uuid,
    pub recorded_by_display_name: String,
    pub recorded_at: DateTime<Utc>,
    pub ward_id: Uuid,
    pub ward_name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionAdvisoryDetail {
    #[serde(flatten)]
    pub summary: AdmissionAdvisoryListItem,
    pub captured_ward_name: String,
    pub notes: String,
    pub created_by_user_id: Uuid,
    pub created_by_display_name: String,
    pub decision: Option<AdmissionAdvisoryDecisionRecord>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateAdmissionAdvisoryRequest {
    pub client_request_id: Uuid,
    pub expected_context_token: String,
    pub task_type: AdmissionAdvisoryType,
    pub notes: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DecideAdmissionAdvisoryRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub expected_context_token: String,
    pub decision: AdmissionAdvisoryDecision,
    pub reason: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionAdvisoryOperation {
    Created,
    Decided,
}
/// Original command evidence. Read fresh context before enabling later decisions.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionAdvisoryReceipt {
    pub client_request_id: Uuid,
    pub operation: AdmissionAdvisoryOperation,
    pub replayed: bool,
    pub advisory: AdmissionAdvisoryDetail,
    pub recorded_at: DateTime<Utc>,
}
