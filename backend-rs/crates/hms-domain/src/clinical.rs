use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::patients::PatientDetail;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClinicalNoteStatus {
    Draft,
    Signed,
    Amended,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClinicalNoteType {
    DoctorNote,
    NursingNote,
    AlliedHealthNote,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProblemStatus {
    Active,
    Resolved,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProblemArtifactKind {
    ClinicalNote,
    Prescription,
    LabOrder,
    Encounter,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AllergySeverity {
    Mild,
    Moderate,
    Severe,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AllergyStatus {
    Active,
    Inactive,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PrescriptionStatus {
    Active,
    OnHold,
    Stopped,
    Completed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChartEntryType {
    Temperature,
    Pulse,
    RespiratoryRate,
    BloodPressure,
    OxygenSaturation,
    Weight,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteTemplate {
    pub id: Uuid,
    pub title: String,
    pub note_type: ClinicalNoteType,
    pub body_template: String,
    pub is_active: bool,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct ClinicalNoteTemplateListQuery {
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct ClinicalNoteListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub encounter_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateClinicalNoteTemplateRequest {
    pub title: String,
    pub note_type: ClinicalNoteType,
    pub body_template: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateClinicalNoteTemplateRequest {
    pub title: Option<String>,
    pub note_type: Option<ClinicalNoteType>,
    pub body_template: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub note_type: ClinicalNoteType,
    pub title: String,
    pub status: ClinicalNoteStatus,
    pub version: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteDetail {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub note_type: ClinicalNoteType,
    pub title: String,
    pub body: String,
    pub status: ClinicalNoteStatus,
    pub version: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateClinicalNoteRequest {
    pub note_type: ClinicalNoteType,
    pub title: String,
    pub body: String,
    pub encounter_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteVersion {
    pub id: Uuid,
    pub note_id: Uuid,
    pub version: i64,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateClinicalNoteVersionRequest {
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ProblemListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub label: String,
    pub status: ProblemStatus,
    pub onset_date: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct ProblemArtifactLinkQuery {
    pub clinical_note_id: Option<Uuid>,
    pub prescription_id: Option<Uuid>,
    pub lab_order_id: Option<Uuid>,
    pub encounter_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ProblemArtifactLinkRequest {
    pub problem_id: Uuid,
    pub clinical_note_id: Option<Uuid>,
    pub prescription_id: Option<Uuid>,
    pub lab_order_id: Option<Uuid>,
    pub encounter_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ProblemArtifactLinkItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub problem_id: Uuid,
    pub artifact_kind: ProblemArtifactKind,
    pub artifact_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PharmacyClinicalContext {
    pub patient_id: Uuid,
    pub active_problems: Vec<ProblemListItem>,
    pub active_allergies: Vec<AllergyListItem>,
    pub order_relevant_medications: Vec<PrescriptionListItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LaboratoryClinicalContext {
    pub order_id: Uuid,
    pub patient_id: Uuid,
    pub linked_problems: Vec<ProblemListItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateProblemRequest {
    pub label: String,
    pub onset_date: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ChangeProblemStatusRequest {
    pub status: ProblemStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateProblemRequest {
    pub label: Option<String>,
    pub onset_date: Option<NaiveDate>,
    pub status: Option<ProblemStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AllergyListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub substance: String,
    pub reaction: Option<String>,
    pub severity: AllergySeverity,
    pub status: AllergyStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateAllergyRequest {
    pub substance: String,
    pub reaction: Option<String>,
    pub severity: AllergySeverity,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateAllergyRequest {
    pub substance: Option<String>,
    pub reaction: Option<String>,
    pub severity: Option<AllergySeverity>,
    pub status: Option<AllergyStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PrescriptionListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub medication_name: String,
    pub dose: String,
    pub route: String,
    pub frequency: String,
    pub inventory_item_id: Option<Uuid>,
    pub start_date: Option<NaiveDate>,
    pub duration_days: Option<i32>,
    pub first_dose_at: Option<DateTime<Utc>>,
    pub status: PrescriptionStatus,
    pub prescribed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePrescriptionRequest {
    pub medication_name: String,
    pub dose: String,
    pub route: Option<String>,
    pub frequency: String,
    pub inventory_item_id: Option<Uuid>,
    pub start_date: Option<NaiveDate>,
    pub duration_days: Option<i32>,
    pub first_dose_at: Option<DateTime<Utc>>,
    pub generate_mar: Option<bool>,
    pub admission_case_id: Option<Uuid>,
    pub mar_days: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdatePrescriptionRequest {
    pub medication_name: Option<String>,
    pub dose: Option<String>,
    pub route: Option<String>,
    pub frequency: Option<String>,
    pub inventory_item_id: Option<Uuid>,
    pub start_date: Option<NaiveDate>,
    pub duration_days: Option<i32>,
    pub first_dose_at: Option<DateTime<Utc>>,
    pub status: Option<PrescriptionStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct GenerateMedicationAdministrationRequest {
    pub admission_case_id: Uuid,
    pub days: Option<u8>,
    pub first_dose_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct GenerateMedicationAdministrationResponse {
    pub prescription_id: Uuid,
    pub medication_course_id: Uuid,
    pub pharmacy_fulfillment_id: Option<Uuid>,
    pub created_count: i64,
    pub existing_count: i64,
    pub requested_dose_count: i64,
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
    pub skipped_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ChartEntryListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub entry_type: ChartEntryType,
    pub measured_at: DateTime<Utc>,
    pub value: String,
    pub unit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateChartEntryRequest {
    pub entry_type: ChartEntryType,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub measured_at: DateTime<Utc>,
    pub value: String,
    pub unit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientChronicleSummary {
    pub patient: PatientDetail,
    pub generated_at: DateTime<Utc>,
    pub notes: Vec<ClinicalNoteListItem>,
    pub problems: Vec<ProblemListItem>,
    pub allergies: Vec<AllergyListItem>,
    pub prescriptions: Vec<PrescriptionListItem>,
    pub chart_entries: Vec<ChartEntryListItem>,
}
