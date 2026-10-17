//! Explicit generated admission courses; dose demand is distinct from physical stock.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

pub const MAX_TREATMENT_WINDOW_DAYS: i64 = 31;
pub const MAX_TREATMENT_WINDOW_DOSES: usize = 512;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentCourseStatus {
    Active,
    OnHold,
    Stopped,
    Completed,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentCourseKind {
    Scheduled,
    Prn,
    Once,
    Unrecognized,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentSupplyKind {
    InitialGeneration,
    PrnAggregate,
    ScheduledWindow,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentCoverage {
    GeneratedCoursesOnly,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentUnavailableReason {
    NetworkWriteUnavailable,
    AdmissionInactive,
    PermissionDenied,
    CourseTerminal,
    SourceNotActive,
    SourceChanged,
    StockPolicyReviewRequired,
    StockItemNotActionable,
    StockUnitChanged,
    UnsupportedSchedule,
    WindowElapsed,
    GenerationBoundaryUnavailable,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentStockTotalUnavailableReason {
    MissingEvidence,
    MixedUnits,
    QuantityOverflow,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct TreatmentCourseListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<TreatmentCourseStatus>,
    pub source_status: Option<crate::clinical::PrescriptionStatus>,
    pub kind: Option<TreatmentCourseKind>,
}
#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct TreatmentCourseDoseQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<crate::ward::MedicationAdministrationStatus>,
    pub is_dispensed: Option<bool>,
    pub scheduled_from: Option<DateTime<Utc>>,
    pub scheduled_before: Option<DateTime<Utc>>,
    pub request_id: Option<Uuid>,
}
#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct TreatmentCourseSupplyQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<crate::pharmacy::PharmacyFulfillmentStatus>,
    pub kind: Option<TreatmentSupplyKind>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCoursesContext {
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub admission_status: crate::ward::AdmissionStatus,
    pub current_ward_id: Uuid,
    pub current_ward_name: String,
    pub context_token: String,
    pub can_view: bool,
    pub can_manage_courses: bool,
    pub management_unavailable_reason: Option<TreatmentUnavailableReason>,
    pub generated_course_count: i64,
    pub coverage: TreatmentCoverage,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCourseListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub prescription_id: Uuid,
    pub kind: TreatmentCourseKind,
    pub status: TreatmentCourseStatus,
    pub source_status: crate::clinical::PrescriptionStatus,
    pub medication_name: String,
    pub dose: String,
    pub route: String,
    pub frequency: String,
    pub inventory_item_id: Option<Uuid>,
    pub first_dose_at: DateTime<Utc>,
    pub generation_window_start: DateTime<Utc>,
    pub generation_window_end: DateTime<Utc>,
    pub scheduled_through: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub has_local_stop: bool,
    pub has_reviewed_stock_policy: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCourseCounts {
    pub generated_scheduled_doses: i64,
    pub requested_prn_doses: i64,
    pub supplied_doses: i64,
    pub given_doses: i64,
    pub awaiting_supply_doses: i64,
    pub supplied_pending_doses: i64,
    pub missed_doses: i64,
    pub refused_doses: i64,
    pub held_doses: i64,
    pub explicit_non_given_doses: i64,
    pub unrecorded_held_doses: i64,
    pub issued_stock_quantity: Option<i64>,
    pub issued_stock_unit: Option<String>,
    pub issued_stock_unrecorded_doses: i64,
    pub stock_total_unavailable_reason: Option<TreatmentStockTotalUnavailableReason>,
    pub days_of_supply: Option<f64>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCourseDetail {
    pub summary: TreatmentCourseListItem,
    pub source_token: String,
    pub course_token: String,
    pub context_token: String,
    pub source_instructions: String,
    pub source_reason: String,
    pub source_matches_course: bool,
    pub scheduled_stock_policy: Option<crate::clinical::ScheduledStockPolicy>,
    pub prn_policy: Option<crate::clinical::PrnPolicy>,
    pub stock_item_name: Option<String>,
    pub stock_item_code: Option<String>,
    pub stock_item_current_unit: Option<String>,
    pub counts: TreatmentCourseCounts,
    pub local_stop: Option<TreatmentCourseStopEvidence>,
    pub can_stop_course: bool,
    pub can_request_schedule_window: bool,
    pub stop_unavailable_reason: Option<TreatmentUnavailableReason>,
    pub window_unavailable_reason: Option<TreatmentUnavailableReason>,
    pub supply_window_constraints: Option<TreatmentWindowConstraints>,
}
/// Current server bounds, not a preview of exact new dose membership.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentWindowConstraints {
    pub scheduled_from: DateTime<Utc>,
    pub scheduled_before_max: DateTime<Utc>,
    pub maximum_new_doses: u16,
}
/// Immutable original membership, separate from the dose's current outcome/supply state.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentDoseMembership {
    pub medication_administration_id: Uuid,
    pub scheduled_at: DateTime<Utc>,
    pub dose_sequence: Option<i32>,
    pub pharmacy_fulfillment_id: Option<Uuid>,
    pub status_at_command: crate::ward::MedicationAdministrationStatus,
    pub was_dispensed: bool,
    pub scheduled_stock_policy: Option<crate::clinical::ScheduledStockPolicy>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCourseDose {
    pub id: Uuid,
    pub scheduled_at: DateTime<Utc>,
    pub dose_sequence: Option<i32>,
    pub status: crate::ward::MedicationAdministrationStatus,
    pub is_dispensed: bool,
    pub prescription_held: bool,
    pub pharmacy_fulfillment_id: Option<Uuid>,
    pub prn_request_id: Option<Uuid>,
    pub prn_indication: Option<String>,
    pub dispensed_stock_quantity: Option<i64>,
    pub dispensed_stock_unit: Option<String>,
    pub dispensed_at: Option<DateTime<Utc>>,
    pub administered_at: Option<DateTime<Utc>>,
    pub reason_not_given: Option<String>,
    pub administration_notes: Option<String>,
    pub outcome_recorded_at: Option<DateTime<Utc>>,
    pub outcome_recorded_by_user_id: Option<Uuid>,
    pub outcome_recorded_by_display_name: Option<String>,
    pub local_stop_id: Option<Uuid>,
    pub original_request_membership: Option<TreatmentDoseMembership>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCourseSupplyWindow {
    pub id: Uuid,
    pub kind: TreatmentSupplyKind,
    pub status: crate::pharmacy::PharmacyFulfillmentStatus,
    pub coverage_start: DateTime<Utc>,
    pub coverage_end: DateTime<Utc>,
    pub requested_dose_count: i64,
    pub dispensed_dose_count: i64,
    pub remaining_scheduled_unsupplied_dose_count: i64,
    pub created_at: DateTime<Utc>,
    pub dispensed_at: Option<DateTime<Utc>>,
    pub inventory_item_id: Option<Uuid>,
    pub dispensing_location_id: Option<Uuid>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StopTreatmentCourseRequest {
    pub client_request_id: Uuid,
    pub expected_source_token: String,
    pub expected_course_token: String,
    pub expected_context_token: String,
    pub reason: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTreatmentSupplyWindowRequest {
    pub client_request_id: Uuid,
    pub expected_source_token: String,
    pub expected_course_token: String,
    pub expected_context_token: String,
    pub expected_scheduled_through: DateTime<Utc>,
    pub scheduled_before: DateTime<Utc>,
    pub note: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCourseStopEvidence {
    pub id: Uuid,
    pub reason: String,
    pub recorded_by_user_id: Uuid,
    pub recorded_by_display_name: String,
    pub recorded_at: DateTime<Utc>,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub source_status_at_stop: crate::clinical::PrescriptionStatus,
    pub retired_pending_dose_count: i64,
    pub cancelled_fulfillment_count: i64,
    pub retired_dose_membership_token: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCreatedDose {
    pub id: Uuid,
    pub scheduled_at: DateTime<Utc>,
    pub dose_sequence: i32,
    pub scheduled_stock_policy: crate::clinical::ScheduledStockPolicy,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentSupplyWindowEvidence {
    pub previous_scheduled_through: DateTime<Utc>,
    pub scheduled_through: DateTime<Utc>,
    pub fulfillment_id: Uuid,
    pub created_dose_count: i64,
    #[schema(min_items = 1, max_items = 512)]
    pub created_doses: Vec<TreatmentCreatedDose>,
    pub scheduled_stock_policy: crate::clinical::ScheduledStockPolicy,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct TreatmentCourseReceiptMetadata {
    pub client_request_id: Uuid,
    pub replayed: bool,
    pub patient_id: Uuid,
    pub admission_case_id: Uuid,
    pub prescription_id: Uuid,
    pub course_id: Uuid,
    pub recorded_by_user_id: Uuid,
    pub recorded_by_display_name: String,
    pub recorded_at: DateTime<Utc>,
}
/// Original command evidence; fresh context/detail govern future actions.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum TreatmentCourseReceipt {
    Stopped {
        #[serde(flatten)]
        metadata: TreatmentCourseReceiptMetadata,
        reviewed_input: StopTreatmentCourseRequest,
        result: TreatmentCourseStopEvidence,
    },
    SupplyWindowCreated {
        #[serde(flatten)]
        metadata: TreatmentCourseReceiptMetadata,
        reviewed_input: CreateTreatmentSupplyWindowRequest,
        result: TreatmentSupplyWindowEvidence,
    },
}
