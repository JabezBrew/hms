use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WardStatus {
    Active,
    Inactive,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BedStatus {
    Available,
    Reserved,
    Occupied,
    Cleaning,
    Closed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionStatus {
    ReadyForActivation,
    Admitted,
    DischargePending,
    Discharged,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DischargeStatus {
    Requested,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NursingTaskType {
    WardRound,
    Observation,
    Medication,
    Handoff,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NursingTaskStatus {
    Open,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MedicationAdministrationStatus {
    Scheduled,
    Administered,
    Held,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HandoffStatus {
    Draft,
    Completed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentSheetStatus {
    Active,
    Closed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NursingAlertSeverity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NursingAlertStatus {
    Open,
    Acknowledged,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MonitoringEventKind {
    Observation,
    Escalation,
    Rounding,
    DeviceCheck,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WardStockRequestStatus {
    Requested,
    Approved,
    Fulfilled,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub status: WardStatus,
    pub active_bed_count: i64,
    pub occupied_bed_count: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardSectionListItem {
    pub id: Uuid,
    pub ward_id: Uuid,
    pub code: String,
    pub name: String,
    pub status: WardStatus,
    pub active_bed_count: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BedListItem {
    pub id: Uuid,
    pub ward_id: Uuid,
    pub section_id: Option<Uuid>,
    pub bed_code: String,
    pub status: BedStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateWardSectionRequest {
    pub code: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateBedRequest {
    pub section_id: Option<Uuid>,
    pub bed_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardBoardItem {
    pub admission_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub bed_id: Option<Uuid>,
    pub bed_code: Option<String>,
    pub admission_status: AdmissionStatus,
    pub admitted_at: DateTime<Utc>,
    pub open_nursing_task_count: i64,
    pub due_medication_count: i64,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct WardBoardQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub ward_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmissionCaseListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub bed_id: Option<Uuid>,
    pub bed_code: Option<String>,
    pub status: AdmissionStatus,
    pub created_at: DateTime<Utc>,
    pub admitted_at: Option<DateTime<Utc>>,
    pub discharged_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdmitPatientRequest {
    pub patient_id: Uuid,
    pub ward_id: Uuid,
    pub bed_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateAdmissionCaseRequest {
    pub patient_id: Uuid,
    pub ward_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReserveAdmissionBedRequest {
    pub bed_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateDischargeRequest {
    pub admission_case_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DischargeCaseListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub status: DischargeStatus,
    pub requested_at: DateTime<Utc>,
    pub discharged_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NursingTaskListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub task_type: NursingTaskType,
    pub status: NursingTaskStatus,
    pub due_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateNursingTaskRequest {
    pub admission_case_id: Uuid,
    pub task_type: NursingTaskType,
    pub due_at: DateTime<Utc>,
    pub assigned_to_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct MedicationAdministrationListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub medication_name: String,
    pub scheduled_at: DateTime<Utc>,
    pub administered_at: Option<DateTime<Utc>>,
    pub status: MedicationAdministrationStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ScheduleMedicationAdministrationRequest {
    pub admission_case_id: Uuid,
    pub medication_name: String,
    pub scheduled_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AdministerMedicationRequest {
    pub witness_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct HandoffListItem {
    pub id: Uuid,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub from_user_id: Uuid,
    pub to_user_id: Uuid,
    pub shift_label: String,
    pub status: HandoffStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateHandoffRequest {
    pub ward_id: Uuid,
    pub to_user_id: Uuid,
    pub shift_label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentSheetListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub sheet_date: NaiveDate,
    pub status: TreatmentSheetStatus,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateTreatmentSheetRequest {
    pub admission_case_id: Uuid,
    pub sheet_date: NaiveDate,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientVitalsListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub recorded_at: DateTime<Utc>,
    pub temperature_c: Option<f32>,
    pub systolic_bp: Option<i32>,
    pub diastolic_bp: Option<i32>,
    pub pulse: Option<i32>,
    pub respiratory_rate: Option<i32>,
    pub oxygen_saturation: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct PatientVitalsListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub hours: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePatientVitalsRequest {
    pub admission_case_id: Uuid,
    pub recorded_at: DateTime<Utc>,
    pub temperature_c: Option<f32>,
    pub systolic_bp: Option<i32>,
    pub diastolic_bp: Option<i32>,
    pub pulse: Option<i32>,
    pub respiratory_rate: Option<i32>,
    pub oxygen_saturation: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NursingAlertListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub severity: NursingAlertSeverity,
    pub title: String,
    pub status: NursingAlertStatus,
    pub created_at: DateTime<Utc>,
    pub acknowledged_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateNursingAlertRequest {
    pub admission_case_id: Uuid,
    pub severity: NursingAlertSeverity,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct MonitoringEventListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub event_kind: MonitoringEventKind,
    pub summary: String,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateMonitoringEventRequest {
    pub admission_case_id: Uuid,
    pub event_kind: MonitoringEventKind,
    pub summary: String,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FluidBalanceListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub recorded_at: DateTime<Utc>,
    pub intake_ml: i32,
    pub output_ml: i32,
    pub net_ml: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateFluidBalanceEntryRequest {
    pub admission_case_id: Uuid,
    pub recorded_at: DateTime<Utc>,
    pub intake_ml: i32,
    pub output_ml: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct WardStockRequestListItem {
    pub id: Uuid,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub requested_item: String,
    pub quantity_requested: i32,
    pub status: WardStockRequestStatus,
    pub requested_at: DateTime<Utc>,
    pub approved_at: Option<DateTime<Utc>>,
    pub fulfilled_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateWardStockRequestRequest {
    pub ward_id: Uuid,
    pub requested_item: String,
    pub quantity_requested: i32,
}
