use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::patients::PatientContextListItem;
use crate::ward::MyWardBoardAssignment;

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
pub enum ClinicSessionOwnerType {
    Practitioner,
    Team,
    Clinic,
    Service,
    Department,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClinicSessionMode {
    FixedSlot,
    CapacityBlock,
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
    pub clinic_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub status: Option<AppointmentStatus>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AppointmentListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub date: Option<NaiveDate>,
    pub clinic_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub status: Option<AppointmentStatus>,
    pub search: Option<String>,
}

impl From<AppointmentListGetQuery> for AppointmentListQuery {
    fn from(value: AppointmentListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            date: value.date,
            clinic_id: value.clinic_id,
            practitioner_user_id: value.practitioner_user_id,
            status: value.status,
            search: value.search,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct VisitListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub clinic_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub status: Option<VisitStatus>,
    pub active_only: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct TriageListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<TriageStatus>,
    pub acuity: Option<TriageAcuity>,
    pub assigned_to_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CareAreaMyWorkResponse {
    pub generated_at: DateTime<Utc>,
    pub outpatient: CareAreaOutpatientMyWork,
    pub inpatient: CareAreaInpatientMyWork,
    pub emergency: CareAreaEmergencyMyWork,
    pub patient_context: CareAreaPatientContextMyWork,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CareAreaOutpatientMyWork {
    pub date: NaiveDate,
    pub appointments: Vec<AppointmentListItem>,
    pub has_more_appointments: bool,
    pub active_visits: Vec<VisitListItem>,
    pub has_more_active_visits: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CareAreaInpatientMyWork {
    pub assigned_wards: Vec<MyWardBoardAssignment>,
    pub primary_ward_id: Option<Uuid>,
    pub default_ward_id: Option<Uuid>,
    pub can_view_all_wards: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CareAreaEmergencyMyWork {
    pub assigned_triage: Vec<TriageListItem>,
    pub has_more_assigned_triage: bool,
    pub waiting_triage: Vec<TriageListItem>,
    pub has_more_waiting_triage: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CareAreaPatientContextMyWork {
    pub recent_patients: Vec<PatientContextListItem>,
    pub has_more_recent_patients: bool,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct EncounterListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub patient_search: Option<String>,
    pub practitioner_search: Option<String>,
    pub date: Option<NaiveDate>,
    pub status: Option<EncounterStatus>,
    pub encounter_type: Option<EncounterType>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct EncounterListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub patient_search: Option<String>,
    pub practitioner_search: Option<String>,
    pub date: Option<NaiveDate>,
    pub status: Option<EncounterStatus>,
    pub encounter_type: Option<EncounterType>,
}

impl From<EncounterListGetQuery> for EncounterListQuery {
    fn from(value: EncounterListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            patient_id: value.patient_id,
            patient_search: value.patient_search,
            practitioner_search: value.practitioner_search,
            date: value.date,
            status: value.status,
            encounter_type: value.encounter_type,
        }
    }
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
pub struct ClinicSessionListItem {
    pub id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub service_code: Option<String>,
    pub practitioner_user_id: Option<Uuid>,
    pub owner_type: ClinicSessionOwnerType,
    pub owner_id: Option<Uuid>,
    pub name: String,
    pub mode: ClinicSessionMode,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub slot_minutes: Option<i32>,
    pub capacity: i32,
    pub allow_overbooking: bool,
    pub overbook_limit: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AppointmentTypeListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub default_duration_minutes: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateClinicRequest {
    pub code: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateClinicRequest {
    pub code: Option<String>,
    pub name: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AppointmentListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub clinic_id: Option<Uuid>,
    pub clinic_session_id: Option<Uuid>,
    pub appointment_type_id: Option<Uuid>,
    pub appointment_type_name: Option<String>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub status: AppointmentStatus,
    pub cancellation_reason: Option<String>,
    pub overbook_reason: Option<String>,
    pub series_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateAppointmentRequest {
    pub patient_id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub clinic_session_id: Option<Uuid>,
    pub appointment_type_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub overbook_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateAppointmentRequest {
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CancelAppointmentRequest {
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct VisitListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub appointment_id: Option<Uuid>,
    pub encounter_id: Option<Uuid>,
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
    pub encounter_id: Option<Uuid>,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub acuity: TriageAcuity,
    pub status: TriageStatus,
    pub assigned_to_user_id: Option<Uuid>,
    pub assigned_to_name: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appointment_get_query_preserves_search_filter() {
        let query = AppointmentListQuery::from(AppointmentListGetQuery {
            cursor: None,
            limit: Some(10),
            date: None,
            clinic_id: Some(Uuid::from_u128(0x200)),
            practitioner_user_id: Some(Uuid::from_u128(0x202)),
            status: Some(AppointmentStatus::Scheduled),
            search: Some("patient".to_owned()),
        });

        assert_eq!(query.search.as_deref(), Some("patient"));
        assert_eq!(query.clinic_id, Some(Uuid::from_u128(0x200)));
        assert_eq!(query.practitioner_user_id, Some(Uuid::from_u128(0x202)));
        assert!(matches!(query.status, Some(AppointmentStatus::Scheduled)));
    }

    #[test]
    fn encounter_get_query_preserves_patient_and_search_filters() {
        let patient_id = Uuid::from_u128(0x201);
        let query = EncounterListQuery::from(EncounterListGetQuery {
            cursor: None,
            limit: Some(10),
            patient_id: Some(patient_id),
            patient_search: Some("patient".to_owned()),
            practitioner_search: Some("doctor".to_owned()),
            date: None,
            status: Some(EncounterStatus::InProgress),
            encounter_type: Some(EncounterType::Outpatient),
        });

        assert_eq!(query.patient_id, Some(patient_id));
        assert_eq!(query.patient_search.as_deref(), Some("patient"));
        assert_eq!(query.practitioner_search.as_deref(), Some("doctor"));
        assert!(matches!(query.status, Some(EncounterStatus::InProgress)));
        assert!(matches!(
            query.encounter_type,
            Some(EncounterType::Outpatient)
        ));
    }
}
