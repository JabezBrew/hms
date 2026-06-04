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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DischargeStatus {
    Requested,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DischargeBlockerKind {
    DischargeSummary,
    NursingRelease,
    PharmacyClearance,
    BillingClearance,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DischargeBlockerStatus {
    Pending,
    Completed,
    Held,
    Overridden,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DischargeBlocker {
    pub id: String,
    pub blocker_type: DischargeBlockerKind,
    pub status: DischargeBlockerStatus,
    pub blocking: bool,
    pub workflow_label: String,
    pub workflow_path: String,
    pub hold_reason: Option<String>,
    pub override_reason: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub requires_reauth_for_override: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DischargeInvoiceSummary {
    pub invoice_count: i64,
    pub patient_balance_due: String,
    pub patient_balance_due_minor: i64,
    pub currency: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DischargeWorkflowAction {
    pub label: String,
    pub path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NursingTaskType {
    WardRound,
    Observation,
    Medication,
    Handoff,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize, ToSchema)]
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
pub struct CreateWardRequest {
    pub code: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateWardRequest {
    pub code: Option<String>,
    pub name: Option<String>,
    pub status: Option<WardStatus>,
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
pub struct UpdateWardSectionRequest {
    pub code: Option<String>,
    pub name: Option<String>,
    pub status: Option<WardStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateBedRequest {
    pub section_id: Option<Uuid>,
    pub bed_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateBedRequest {
    pub section_id: Option<Uuid>,
    pub bed_code: Option<String>,
    pub status: Option<BedStatus>,
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
    pub active_alert_count: i64,
    pub critical_alert_count: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WardBoardMonitoringFilter {
    Critical,
    Alerts,
    Tasks,
    Results,
    Discharge,
    MyWork,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct WardListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct WardBoardQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub ward_id: Option<Uuid>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub monitoring_filter: Option<WardBoardMonitoringFilter>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct WardBoardGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub ward_id: Option<Uuid>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub monitoring_filter: Option<WardBoardMonitoringFilter>,
}

impl From<WardBoardGetQuery> for WardBoardQuery {
    fn from(value: WardBoardGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            ward_id: value.ward_id,
            patient_id: value.patient_id,
            search: value.search,
            monitoring_filter: value.monitoring_filter,
        }
    }
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
pub struct CancelDischargeRequest {
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RecordNursingReleaseRequest {
    pub education: String,
    pub instructions: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DischargeBlockerActionRequest {
    pub blocker_type: DischargeBlockerKind,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DischargeCaseListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub status: DischargeStatus,
    pub requested_at: DateTime<Utc>,
    pub discharged_at: Option<DateTime<Utc>>,
    pub blockers: Vec<DischargeBlocker>,
    pub invoice_summary: DischargeInvoiceSummary,
    pub schedule_follow_up_action: DischargeWorkflowAction,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NursingTaskListItem {
    pub id: Uuid,
    pub admission_case_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub task_type: NursingTaskType,
    pub title: Option<String>,
    pub instruction: Option<String>,
    pub status: NursingTaskStatus,
    pub due_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateNursingTaskRequest {
    pub admission_case_id: Uuid,
    pub task_type: NursingTaskType,
    pub due_at: DateTime<Utc>,
    pub assigned_to_user_id: Option<Uuid>,
    pub title: Option<String>,
    pub instruction: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ward_board_get_query_preserves_patient_and_search_filters() {
        let ward_id = Uuid::from_u128(0x300);
        let patient_id = Uuid::from_u128(0x301);
        let query = WardBoardQuery::from(WardBoardGetQuery {
            cursor: None,
            limit: Some(10),
            ward_id: Some(ward_id),
            patient_id: Some(patient_id),
            search: Some("monitor".to_owned()),
            monitoring_filter: Some(WardBoardMonitoringFilter::Alerts),
        });

        assert_eq!(query.ward_id, Some(ward_id));
        assert_eq!(query.patient_id, Some(patient_id));
        assert_eq!(query.search.as_deref(), Some("monitor"));
        assert!(matches!(
            query.monitoring_filter,
            Some(WardBoardMonitoringFilter::Alerts)
        ));
    }
}
