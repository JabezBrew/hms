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

/// Prescribing catalog projection. Deliberately excludes procurement and stock details.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct MedicationCatalogItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub unit: String,
    pub controlled: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct MedicationCatalogQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
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
    pub prn_policy: Option<PrnPolicy>,
    pub id: Uuid,
    pub patient_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub discharge_case_id: Option<Uuid>,
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

/// Explicit prescriber safety limits. No defaults are inferred from free-text dosage.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PrnPolicyRequest {
    pub expected_stock_unit: String,
    pub minimum_interval_hours: u8,
    pub maximum_doses_per_24_hours: u8,
    pub indication: String,
    pub stock_units_per_dose: i64,
}

impl PrnPolicyRequest {
    pub fn normalized(mut self) -> Result<Self, &'static str> {
        self.indication = self.indication.trim().to_owned();
        if ![4, 6, 8, 12, 24].contains(&self.minimum_interval_hours)
            || self.maximum_doses_per_24_hours == 0
            || self.maximum_doses_per_24_hours > 24 / self.minimum_interval_hours
            || self.indication.is_empty()
            || self.indication.chars().count() > 500
            || self.expected_stock_unit.trim().is_empty()
            || self.expected_stock_unit.chars().count() > 100
            || self.stock_units_per_dose <= 0
            || self.stock_units_per_dose > 9_007_199_254_740_991
        {
            return Err("invalid_prn_policy");
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct PrnPolicy {
    pub minimum_interval_hours: u8,
    pub maximum_doses_per_24_hours: u8,
    pub indication: String,
    pub stock_units_per_dose: i64,
    /// Inventory unit captured when prescribing, never supplied by the client.
    pub stock_unit: String,
}

impl PrnPolicy {
    pub fn from_request(limits: PrnPolicyRequest, stock_unit: String) -> Self {
        Self {
            minimum_interval_hours: limits.minimum_interval_hours,
            maximum_doses_per_24_hours: limits.maximum_doses_per_24_hours,
            indication: limits.indication,
            stock_units_per_dose: limits.stock_units_per_dose,
            stock_unit,
        }
    }
    pub fn as_request(&self) -> PrnPolicyRequest {
        PrnPolicyRequest {
            expected_stock_unit: self.stock_unit.clone(),
            minimum_interval_hours: self.minimum_interval_hours,
            maximum_doses_per_24_hours: self.maximum_doses_per_24_hours,
            indication: self.indication.clone(),
            stock_units_per_dose: self.stock_units_per_dose,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePrescriptionRequest {
    pub instructions: Option<String>,
    pub reason: Option<String>,
    pub prn_policy: Option<PrnPolicyRequest>,
    pub medication_name: String,
    pub dose: String,
    pub route: Option<String>,
    pub frequency: String,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub discharge_case_id: Option<Uuid>,
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

/// Full clinical detail; deliberately excluded from medication list/summary DTOs.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PrescriptionDetail {
    #[serde(flatten)]
    pub prescription: PrescriptionListItem,
    pub instructions: String,
    pub reason: String,
    pub updated_at: DateTime<Utc>,
    pub prescribed_by_user_id: Option<Uuid>,
    pub snapshot_token: String,
    pub stock_unit: Option<String>,
    pub has_generated_course: bool,
    pub provenance: Option<PrescriptionCourseProvenance>,
    pub successor_prescription_id: Option<Uuid>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PrescriptionCourseRelation {
    Renewal,
    Replacement,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PrescriptionCourseProvenance {
    pub source_prescription_id: Uuid,
    pub relation: PrescriptionCourseRelation,
    pub change_reason: String,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by_user_id: Uuid,
}

/// A new course is a fully reviewed prescription, never a copy with defaults.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NewPrescriptionCourseRequest {
    pub client_request_id: Uuid,
    pub expected_snapshot_token: String,
    pub relation: PrescriptionCourseRelation,
    pub change_reason: String,
    pub medication_name: String,
    pub dose: String,
    pub route: String,
    pub frequency: String,
    pub instructions: String,
    pub reason: String,
    pub start_date: NaiveDate,
    pub duration_days: Option<i32>,
    pub first_dose_at: Option<DateTime<Utc>>,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub inventory_item_id: Option<Uuid>,
    pub expected_stock_unit: Option<String>,
    pub prn_policy: Option<PrnPolicyRequest>,
}

impl NewPrescriptionCourseRequest {
    pub fn normalized(mut self) -> Result<Self, &'static str> {
        self.medication_name = self.medication_name.trim().to_owned();
        self.dose = self.dose.trim().to_owned();
        self.route = self.route.trim().to_owned();
        self.frequency = self.frequency.trim().to_owned();
        self.instructions = self.instructions.trim().to_owned();
        self.reason = self.reason.trim().to_owned();
        self.change_reason = self.change_reason.trim().to_owned();
        self.expected_stock_unit = self.expected_stock_unit.map(|v| v.trim().to_owned());
        self.prn_policy = self
            .prn_policy
            .map(PrnPolicyRequest::normalized)
            .transpose()?;
        if self.client_request_id.is_nil()
            || self.expected_snapshot_token.len() != 64
            || !self
                .expected_snapshot_token
                .bytes()
                .all(|v| v.is_ascii_hexdigit())
            || [
                (&self.medication_name, 160),
                (&self.dose, 120),
                (&self.route, 120),
                (&self.frequency, 120),
                (&self.change_reason, 2000),
            ]
            .into_iter()
            .any(|(value, max)| value.is_empty() || value.chars().count() > max)
            || self.instructions.chars().count() > 4000
            || self.reason.chars().count() > 2000
            || self.duration_days.is_some_and(|days| days <= 0)
            || self.first_dose_at.is_some_and(|first| {
                first < self.start_date.and_hms_opt(0, 0, 0).unwrap().and_utc()
            })
            || self.inventory_item_id.is_some() != self.expected_stock_unit.is_some()
            || self
                .expected_stock_unit
                .as_ref()
                .is_some_and(|unit| unit.is_empty() || unit.chars().count() > 100)
            || self.frequency.eq_ignore_ascii_case("prn") != self.prn_policy.is_some()
            || self.prn_policy.as_ref().is_some_and(|policy| {
                self.inventory_item_id.is_none()
                    || Some(policy.expected_stock_unit.as_str())
                        != self.expected_stock_unit.as_deref()
            })
        {
            return Err("invalid_prescription_course");
        }
        if let Some(days) = self.duration_days {
            self.start_date
                .checked_add_days(chrono::Days::new(days as u64))
                .ok_or("invalid_prescription_course")?;
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NewPrescriptionCourseReceipt {
    pub client_request_id: Uuid,
    pub source_prescription_id: Uuid,
    pub source_status_before: PrescriptionStatus,
    pub source_status_after: PrescriptionStatus,
    pub relation: PrescriptionCourseRelation,
    pub prescription: PrescriptionDetail,
    pub recorded_at: DateTime<Utc>,
    pub replayed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdatePrescriptionDocumentationRequest {
    pub client_request_id: Uuid,
    pub expected_snapshot_token: String,
    pub instructions: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PrescriptionDocumentationReceipt {
    pub client_request_id: Uuid,
    pub prescription: PrescriptionDetail,
    pub replayed: bool,
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
