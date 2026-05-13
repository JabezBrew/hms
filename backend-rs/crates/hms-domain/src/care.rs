use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AppointmentStatus {
    Scheduled,
    CheckedIn,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum VisitStatus {
    Waiting,
    Called,
    InTriage,
    Triaged,
    InConsultation,
    OnHold,
    ReadyCheckout,
    CheckedOut,
    NoShow,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TriageAcuity {
    Routine,
    Urgent,
    Emergency,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TriageStatus {
    Waiting,
    Assigned,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EncounterStatus {
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EncounterType {
    Outpatient,
    Emergency,
    Triage,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CareTeamRole {
    PrimaryClinician,
    Nurse,
    Consultant,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct CursorListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AppointmentListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub date: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct VisitListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub clinic_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct TriageListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<TriageStatus>,
    pub acuity: Option<TriageAcuity>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct EncounterListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AppointmentListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub status: AppointmentStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateAppointmentRequest {
    pub patient_id: Uuid,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateAppointmentRequest {
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct VisitListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub appointment_id: Option<Uuid>,
    pub clinic_id: Option<Uuid>,
    pub status: VisitStatus,
    pub checked_in_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CheckInVisitRequest {
    pub patient_id: Uuid,
    pub appointment_id: Option<Uuid>,
    pub clinic_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TriageListItem {
    pub id: Uuid,
    pub visit_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub acuity: TriageAcuity,
    pub status: TriageStatus,
    pub triage_notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateTriageRequest {
    pub visit_id: Uuid,
    pub acuity: TriageAcuity,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AssignTriageRequest {
    pub assigned_to_user_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TriageAssessmentRequest {
    pub acuity: Option<TriageAcuity>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct EncounterListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub visit_id: Option<Uuid>,
    pub encounter_type: EncounterType,
    pub status: EncounterStatus,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateEncounterRequest {
    pub patient_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub encounter_type: EncounterType,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateEncounterRequest {
    pub visit_id: Option<Uuid>,
    pub encounter_type: Option<EncounterType>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CareTeamAssignment {
    pub id: Uuid,
    pub encounter_id: Uuid,
    pub user_id: Uuid,
    pub role: CareTeamRole,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateCareTeamAssignmentRequest {
    pub user_id: Uuid,
    pub role: CareTeamRole,
}
