use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
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
pub enum ProblemStatus {
    Active,
    Resolved,
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

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PrescriptionStatus {
    Active,
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
    pub note_type: String,
    pub body_template: String,
    pub is_active: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateClinicalNoteTemplateRequest {
    pub title: String,
    pub note_type: String,
    pub body_template: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateClinicalNoteTemplateRequest {
    pub title: Option<String>,
    pub note_type: Option<String>,
    pub body_template: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub note_type: String,
    pub title: String,
    pub status: ClinicalNoteStatus,
    pub version: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClinicalNoteDetail {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub note_type: String,
    pub title: String,
    pub body: String,
    pub status: ClinicalNoteStatus,
    pub version: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateClinicalNoteRequest {
    pub note_type: String,
    pub title: String,
    pub body: String,
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
    pub frequency: String,
    pub status: PrescriptionStatus,
    pub prescribed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePrescriptionRequest {
    pub medication_name: String,
    pub dose: String,
    pub frequency: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdatePrescriptionRequest {
    pub medication_name: Option<String>,
    pub dose: Option<String>,
    pub frequency: Option<String>,
    pub status: Option<PrescriptionStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ChartEntryListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub entry_type: ChartEntryType,
    pub measured_at: DateTime<Utc>,
    pub value: String,
    pub unit: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateChartEntryRequest {
    pub entry_type: ChartEntryType,
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
