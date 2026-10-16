//! Patient narrative handover. Ward shift headers remain a separate workflow.
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandoverShift {
    Day,
    Evening,
    Night,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientHandoverStatus {
    Recorded,
    Voided,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandoverRevisionKind {
    Recorded,
    Amended,
    Voided,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct HandoverNarrative {
    pub patient_condition: String,
    pub ongoing_issues: String,
    pub pending_tasks: String,
    pub medication_changes: String,
    pub key_events: String,
    pub care_plan_updates: String,
    pub family_updates: String,
}
impl HandoverNarrative {
    pub fn normalized(mut self) -> Result<Self, &'static str> {
        self.patient_condition = self.patient_condition.trim().to_owned();
        if self.patient_condition.is_empty() || self.patient_condition.chars().count() > 4000 {
            return Err("invalid_handover_narrative");
        }
        for value in [
            &mut self.ongoing_issues,
            &mut self.pending_tasks,
            &mut self.medication_changes,
            &mut self.key_events,
            &mut self.care_plan_updates,
            &mut self.family_updates,
        ] {
            *value = value.trim().to_owned();
            if value.chars().count() > 2000 {
                return Err("invalid_handover_narrative");
            }
        }
        Ok(self)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreatePatientHandoverRequest {
    pub client_request_id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub shift_date: NaiveDate,
    pub shift_type: HandoverShift,
    pub intended_recipient_user_id: Option<Uuid>,
    pub narrative: HandoverNarrative,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AmendPatientHandoverRequest {
    pub client_request_id: Uuid,
    pub expected_revision: i64,
    pub shift_date: NaiveDate,
    pub shift_type: HandoverShift,
    pub intended_recipient_user_id: Option<Uuid>,
    pub narrative: HandoverNarrative,
    pub reason: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VoidPatientHandoverRequest {
    pub client_request_id: Uuid,
    pub expected_revision: i64,
    pub reason: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientHandoverListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub author_user_id: Uuid,
    pub author_display_name: String,
    pub shift_date: NaiveDate,
    pub shift_type: HandoverShift,
    pub intended_recipient_user_id: Option<Uuid>,
    pub intended_recipient_display_name: Option<String>,
    pub status: PatientHandoverStatus,
    pub revision: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientHandoverRevision {
    pub id: Uuid,
    pub handover_id: Uuid,
    pub revision: i64,
    pub kind: HandoverRevisionKind,
    pub shift_date: NaiveDate,
    pub shift_type: HandoverShift,
    pub intended_recipient_user_id: Option<Uuid>,
    pub intended_recipient_display_name: Option<String>,
    pub narrative: HandoverNarrative,
    pub reason: String,
    pub recorded_by_user_id: Uuid,
    pub recorded_by_display_name: String,
    pub recorded_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientHandoverDetail {
    #[serde(flatten)]
    pub header: PatientHandoverListItem,
    pub current: PatientHandoverRevision,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientHandoverHistoryItem {
    pub id: Uuid,
    pub handover_id: Uuid,
    pub revision: i64,
    pub kind: HandoverRevisionKind,
    pub recorded_by_user_id: Uuid,
    pub recorded_by_display_name: String,
    pub recorded_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientHandoverReceipt {
    pub client_request_id: Uuid,
    pub handover: PatientHandoverDetail,
    pub replayed: bool,
}
#[derive(Clone, Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct PatientHandoverListQuery {
    pub patient_id: Uuid,
    pub admission_case_id: Option<Uuid>,
    pub shift_date: Option<NaiveDate>,
    pub include_voided: Option<bool>,
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct PatientHandoverHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct PatientHandoverReceiptQuery {
    pub patient_id: Uuid,
}
#[derive(Clone, Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct HandoverRecipientQuery {
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub handover_id: Option<Uuid>,
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct HandoverRecipient {
    pub id: Uuid,
    pub user_id: Uuid,
    pub display_name: String,
    pub role_name: String,
    pub assigned_at: DateTime<Utc>,
}
