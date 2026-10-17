use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReferralPriority {
    Routine,
    Urgent,
    Emergency,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReferralStatus {
    Sent,
    Accepted,
    Scheduled,
    Declined,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClinicWaitlistStatus {
    Waiting,
    Offered,
    Promoted,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct ReferralListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<ReferralStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub to_service: String,
    pub priority: ReferralPriority,
    pub status: ReferralStatus,
    pub reason: Option<String>,
    pub acceptance_notes: Option<String>,
    pub decline_reason: Option<String>,
    pub specialist_notes: Option<String>,
    pub recommendations: Option<String>,
    pub scheduled_appointment_id: Option<Uuid>,
    pub sla_due_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateReferralRequest {
    pub patient_id: Uuid,
    pub to_service: String,
    pub priority: ReferralPriority,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicWaitlistEntryListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub service: String,
    pub priority: ReferralPriority,
    pub status: ClinicWaitlistStatus,
    pub created_at: DateTime<Utc>,
    pub offered_at: Option<DateTime<Utc>>,
    pub promoted_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub scheduled_appointment_id: Option<Uuid>,
    pub cancellation_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateClinicWaitlistEntryRequest {
    pub patient_id: Uuid,
    pub service: String,
    pub priority: ReferralPriority,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OfferNextClinicWaitlistEntryRequest {
    pub service: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ScheduleReferralAppointmentRequest {
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub session_id: Option<Uuid>,
    pub service_id: Option<Uuid>,
    pub clinic_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub overbook_reason: Option<String>,
    pub manual_booking_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PromoteClinicWaitlistEntryRequest {
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub session_id: Option<Uuid>,
    pub service_id: Option<Uuid>,
    pub clinic_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub overbook_reason: Option<String>,
    pub manual_booking_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CancelClinicWaitlistEntryRequest {
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AcceptReferralRequest {
    pub acceptance_notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DeclineReferralRequest {
    pub decline_reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CompleteReferralRequest {
    pub specialist_notes: String,
    pub recommendations: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralSlaState {
    pub referral_id: Uuid,
    pub status: ReferralStatus,
    pub sla_due_at: DateTime<Utc>,
    pub breached: bool,
    pub due_in_minutes: i64,
    pub risk_level: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralSlaRiskSummary {
    pub total: i64,
    pub open: i64,
    pub breached: i64,
    pub due_soon: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralSlaDashboard {
    pub risk_summary: ReferralSlaRiskSummary,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReferralResponseCommandKind {
    SaveDraft,
    Complete,
    Amend,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReferralResponseVersionKind {
    LegacyObserved,
    DraftSaved,
    Completed,
    Amended,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReferralResponseCommandRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub expected_context_token: String,
    pub operation: ReferralResponseCommandKind,
    pub specialist_notes: String,
    pub recommendations: String,
    pub amendment_reason: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, ToSchema)]
pub struct ReferralResponseHistoryItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub referral_id: Uuid,
    pub version: i64,
    pub operation: ReferralResponseVersionKind,
    pub status: ReferralStatus,
    pub to_service: String,
    pub priority: ReferralPriority,
    pub completed_at: Option<DateTime<Utc>>,
    pub recorded_by_user_id: Option<Uuid>,
    pub recorded_by_display_name: Option<String>,
    pub recorded_at: DateTime<Utc>,
    pub imported_legacy: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, ToSchema)]
pub struct ReferralResponseRevision {
    #[serde(flatten)]
    pub history: ReferralResponseHistoryItem,
    // New governed writes are strings. Legacy observation may retain unknown/null content.
    pub specialist_notes: Option<String>,
    pub recommendations: Option<String>,
    pub amendment_reason: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralResponseContext {
    pub patient_id: Uuid,
    pub referral_id: Uuid,
    pub to_service: String,
    pub priority: ReferralPriority,
    pub created_at: DateTime<Utc>,
    pub status: ReferralStatus,
    pub version: i64,
    pub context_token: String,
    pub scheduled_appointment_id: Option<Uuid>,
    pub completed_at: Option<DateTime<Utc>>,
    pub response: Option<ReferralResponseRevision>,
    pub can_save_draft: bool,
    pub can_complete: bool,
    pub can_amend: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralResponseReceipt {
    pub client_request_id: Uuid,
    pub operation: ReferralResponseVersionKind,
    pub replayed: bool,
    pub recorded_at: DateTime<Utc>,
    pub response: ReferralResponseRevision,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReferralResponseHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
