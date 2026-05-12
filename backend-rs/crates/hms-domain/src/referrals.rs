use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
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

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub to_service: String,
    pub priority: ReferralPriority,
    pub status: ReferralStatus,
    pub sla_due_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
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
