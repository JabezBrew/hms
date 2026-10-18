//! Explicit referral-bound consultation starts; completion remains separate.
use crate::{
    care::{AppointmentStatus, EncounterStatus, EncounterType, VisitStatus},
    referrals::{ReferralPriority, ReferralStatus},
    ward::AdmissionStatus,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "choice", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReferralConsultationVisitChoice {
    #[serde(deserialize_with = "deserialize_no_visit")]
    NoVisit,
    ExistingVisit {
        visit_id: Uuid,
    },
}

fn deserialize_no_visit<'de, D>(deserializer: D) -> Result<(), D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Serde's internally tagged unit visitor ignores remaining fields even
    // with enum-level deny_unknown_fields. Preserve the existing wire and Rust
    // variant while requiring an actually empty body after the choice tag.
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct NoVisitFields {}
    NoVisitFields::deserialize(deserializer).map(|_| ())
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReferralConsultationSource {
    NewOutpatient {
        visit: ReferralConsultationVisitChoice,
    },
    ExistingAdmissionEncounter {
        admission_case_id: Uuid,
        encounter_id: Uuid,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReferralConsultationOverride {
    pub reason_code: String,
    pub reason_note: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReferralConsultationStartRequest {
    pub client_request_id: Uuid,
    pub expected_link_version: i64,
    pub expected_context_token: String,
    pub source: ReferralConsultationSource,
    pub restricted_record_override: Option<ReferralConsultationOverride>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReferralConsultationOverrideEvidence {
    pub reason_code: String,
    pub reason_note_present: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReferralConsultationReviewedInput {
    pub client_request_id: Uuid,
    pub expected_link_version: i64,
    pub expected_context_token: String,
    pub source: ReferralConsultationSource,
    pub restricted_record_override: Option<ReferralConsultationOverrideEvidence>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, IntoParams, Default)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ReferralConsultationContextQuery {
    pub mode: Option<String>,
    pub visit_choice: Option<String>,
    pub visit_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub encounter_id: Option<Uuid>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationReferral {
    pub status: ReferralStatus,
    pub to_service: String,
    pub priority: ReferralPriority,
    pub scheduled_appointment_id: Option<Uuid>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationEncounter {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub encounter_type: EncounterType,
    pub status: EncounterStatus,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationVisit {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub appointment_id: Option<Uuid>,
    pub clinic_id: Option<Uuid>,
    pub status: VisitStatus,
    pub checked_in_at: DateTime<Utc>,
    pub consultation_started_at: Option<DateTime<Utc>>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationAppointment {
    pub id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub status: AppointmentStatus,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationAdmission {
    pub id: Uuid,
    pub encounter_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub status: AdmissionStatus,
    pub admitted_at: DateTime<Utc>,
    pub placement_revision: i64,
    pub ward_id: Uuid,
    pub ward_name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationSelection {
    pub source: ReferralConsultationSource,
    pub restricted_override_required: bool,
    pub encounter: Option<ReferralConsultationEncounter>,
    pub visit: Option<ReferralConsultationVisit>,
    pub appointment: Option<ReferralConsultationAppointment>,
    pub admission: Option<ReferralConsultationAdmission>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationVisitTransition {
    pub visit_id: Uuid,
    pub before_status: VisitStatus,
    pub after_status: VisitStatus,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationStart {
    pub appointment_at_start: Option<ReferralConsultationAppointment>,
    pub id: Uuid,
    pub patient_id: Uuid,
    pub referral_id: Uuid,
    pub link_version: i64,
    pub source_mode: String,
    pub encounter_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub scheduled_appointment_id: Option<Uuid>,
    pub encounter_created: bool,
    pub encounter_type: EncounterType,
    pub encounter_status_at_start: EncounterStatus,
    pub encounter_started_at: DateTime<Utc>,
    pub admission_admitted_at: Option<DateTime<Utc>>,
    pub admission_placement_revision_at_start: Option<i64>,
    pub source_referral_status: ReferralStatus,
    pub resulting_referral_status: ReferralStatus,
    pub visit_transition: Option<ReferralConsultationVisitTransition>,
    pub recorded_by_user_id: Uuid,
    pub recorded_by_practitioner_profile_id: Uuid,
    pub recorded_by_display_name: String,
    pub recorded_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationPatient {
    pub id: Uuid,
    pub display_name: String,
    pub patient_code: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationContext {
    pub patient: ReferralConsultationPatient,
    pub patient_id: Uuid,
    pub referral_id: Uuid,
    pub referral: ReferralConsultationReferral,
    pub link_version: i64,
    pub context_token: String,
    pub link: Option<ReferralConsultationStart>,
    pub current_linked_encounter: Option<ReferralConsultationEncounter>,
    pub selection: Option<ReferralConsultationSelection>,
    pub can_start: bool,
    pub can_resume: bool,
    pub can_issue_start_command: bool,
    pub can_override_restricted_record: bool,
    pub unavailable_reason: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReferralConsultationStartReceipt {
    pub client_request_id: Uuid,
    pub replayed: bool,
    pub recorded_at: DateTime<Utc>,
    pub input_digest: String,
    pub reviewed_input: ReferralConsultationReviewedInput,
    pub link: ReferralConsultationStart,
}
