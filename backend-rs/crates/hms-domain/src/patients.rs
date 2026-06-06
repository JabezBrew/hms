use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::ward::AdmissionStatus;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientAdministrativeStatus {
    Active,
    Inactive,
    Deceased,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientRecordStatus {
    Registered,
    Restricted,
    EnteredInError,
    Superseded,
}

impl PatientRecordStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Restricted => "restricted",
            Self::EnteredInError => "entered_in_error",
            Self::Superseded => "superseded",
        }
    }
}

impl std::fmt::Display for PatientRecordStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientVitalStatus {
    PresumedAlive,
    Deceased,
    Unknown,
}

impl PatientVitalStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PresumedAlive => "presumed_alive",
            Self::Deceased => "deceased",
            Self::Unknown => "unknown",
        }
    }
}

impl std::fmt::Display for PatientVitalStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

pub const LEGACY_INACTIVE_UNREVIEWED_REASON: &str = "legacy_inactive_unreviewed";

pub fn identity_for_legacy_status(
    status: PatientAdministrativeStatus,
) -> (
    PatientRecordStatus,
    PatientVitalStatus,
    Option<&'static str>,
) {
    match status {
        PatientAdministrativeStatus::Active => (
            PatientRecordStatus::Registered,
            PatientVitalStatus::PresumedAlive,
            None,
        ),
        PatientAdministrativeStatus::Inactive => (
            PatientRecordStatus::Restricted,
            PatientVitalStatus::PresumedAlive,
            Some(LEGACY_INACTIVE_UNREVIEWED_REASON),
        ),
        PatientAdministrativeStatus::Deceased => (
            PatientRecordStatus::Registered,
            PatientVitalStatus::Deceased,
            None,
        ),
    }
}

pub fn legacy_status_for_identity(
    record_status: PatientRecordStatus,
    vital_status: PatientVitalStatus,
) -> PatientAdministrativeStatus {
    match (record_status, vital_status) {
        (_, PatientVitalStatus::Deceased) => PatientAdministrativeStatus::Deceased,
        (PatientRecordStatus::Registered, _) => PatientAdministrativeStatus::Active,
        _ => PatientAdministrativeStatus::Inactive,
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientContextKind {
    Assigned,
    Recent,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Sex {
    Female,
    Male,
    Other,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientRecord {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_code: String,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: NaiveDate,
    pub sex: Sex,
    /// Compatibility output only. New workflow decisions should use
    /// record_status and vital_status separately.
    pub status: PatientAdministrativeStatus,
    pub record_status: PatientRecordStatus,
    pub vital_status: PatientVitalStatus,
    pub superseded_by_patient_id: Option<Uuid>,
    pub record_status_reason_code: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl PatientRecord {
    pub fn display_name(&self) -> String {
        format!("{} {}", self.first_name, self.last_name)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientListItem {
    pub id: Uuid,
    pub patient_code: String,
    pub display_name: String,
    pub sex: Sex,
    pub date_of_birth: NaiveDate,
    pub birth_year: i32,
    pub patient_location: Option<String>,
    /// Compatibility output only.
    pub status: PatientAdministrativeStatus,
    pub record_status: PatientRecordStatus,
    pub vital_status: PatientVitalStatus,
    pub superseded_by_patient_id: Option<Uuid>,
    pub record_status_reason_code: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientContextListItem {
    pub id: Uuid,
    pub patient_code: String,
    pub display_name: String,
    pub sex: Sex,
    pub birth_year: i32,
    /// Compatibility output only.
    pub status: PatientAdministrativeStatus,
    pub record_status: PatientRecordStatus,
    pub vital_status: PatientVitalStatus,
    pub superseded_by_patient_id: Option<Uuid>,
    pub context_kind: PatientContextKind,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientRegistrationValidationRule {
    pub id: Uuid,
    pub field_name: String,
    pub validation_regex: Option<String>,
    pub validation_message: String,
    pub is_required: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&PatientRecord> for PatientListItem {
    fn from(value: &PatientRecord) -> Self {
        Self {
            id: value.id,
            patient_code: value.patient_code.clone(),
            display_name: value.display_name(),
            sex: value.sex.clone(),
            date_of_birth: value.date_of_birth,
            birth_year: value
                .date_of_birth
                .format("%Y")
                .to_string()
                .parse()
                .unwrap_or_default(),
            patient_location: None,
            status: value.status.clone(),
            record_status: value.record_status,
            vital_status: value.vital_status,
            superseded_by_patient_id: value.superseded_by_patient_id,
            record_status_reason_code: value.record_status_reason_code.clone(),
            created_at: value.created_at,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientDetail {
    pub id: Uuid,
    pub patient_code: String,
    pub first_name: String,
    pub last_name: String,
    pub display_name: String,
    pub date_of_birth: NaiveDate,
    pub sex: Sex,
    /// Compatibility output only.
    pub status: PatientAdministrativeStatus,
    pub record_status: PatientRecordStatus,
    pub vital_status: PatientVitalStatus,
    pub superseded_by_patient_id: Option<Uuid>,
    pub record_status_reason_code: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<&PatientRecord> for PatientDetail {
    fn from(value: &PatientRecord) -> Self {
        Self {
            id: value.id,
            patient_code: value.patient_code.clone(),
            first_name: value.first_name.clone(),
            last_name: value.last_name.clone(),
            display_name: value.display_name(),
            date_of_birth: value.date_of_birth,
            sex: value.sex.clone(),
            status: value.status.clone(),
            record_status: value.record_status,
            vital_status: value.vital_status,
            superseded_by_patient_id: value.superseded_by_patient_id,
            record_status_reason_code: value.record_status_reason_code.clone(),
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PatientListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub patient_id: Option<Uuid>,
    /// Compatibility filter. Prefer record_status and vital_status.
    pub status: Option<PatientAdministrativeStatus>,
    pub record_status: Option<PatientRecordStatus>,
    pub vital_status: Option<PatientVitalStatus>,
    pub admission_start: Option<NaiveDate>,
    pub admission_end: Option<NaiveDate>,
    #[serde(alias = "ward")]
    pub ward_id: Option<Uuid>,
    pub admission_status: Option<AdmissionStatus>,
    pub attending_id: Option<Uuid>,
    pub age_min: Option<u16>,
    pub age_max: Option<u16>,
    pub include_total: Option<bool>,
    pub ordering: Option<String>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PatientListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub patient_id: Option<Uuid>,
    /// Compatibility filter. Prefer record_status and vital_status.
    pub status: Option<PatientAdministrativeStatus>,
    pub record_status: Option<PatientRecordStatus>,
    pub vital_status: Option<PatientVitalStatus>,
    pub admission_start: Option<NaiveDate>,
    pub admission_end: Option<NaiveDate>,
    #[serde(alias = "ward")]
    pub ward_id: Option<Uuid>,
    pub admission_status: Option<AdmissionStatus>,
    pub attending_id: Option<Uuid>,
    pub age_min: Option<u16>,
    pub age_max: Option<u16>,
    pub include_total: Option<bool>,
    pub ordering: Option<String>,
}

impl From<PatientListGetQuery> for PatientListQuery {
    fn from(value: PatientListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            search: value.search,
            patient_id: value.patient_id,
            status: value.status,
            record_status: value.record_status,
            vital_status: value.vital_status,
            admission_start: value.admission_start,
            admission_end: value.admission_end,
            ward_id: value.ward_id,
            admission_status: value.admission_status,
            attending_id: value.attending_id,
            age_min: value.age_min,
            age_max: value.age_max,
            include_total: value.include_total,
            ordering: value.ordering,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PatientContextListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub patient_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PatientContextListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub patient_id: Option<Uuid>,
}

impl From<PatientContextListGetQuery> for PatientContextListQuery {
    fn from(value: PatientContextListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            search: value.search,
            patient_id: value.patient_id,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePatientRequest {
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: NaiveDate,
    pub sex: Sex,
    #[serde(default)]
    pub duplicate_review: Option<DuplicateReviewSubmission>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdatePatientRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub sex: Option<Sex>,
    /// Compatibility input. Prefer record_status and vital_status.
    pub status: Option<PatientAdministrativeStatus>,
    pub record_status: Option<PatientRecordStatus>,
    pub vital_status: Option<PatientVitalStatus>,
    pub superseded_by_patient_id: Option<Uuid>,
    pub status_reason_code: Option<String>,
    pub status_reason_note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateReviewDecision {
    NewDistinctPatient,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DuplicateReviewSubmission {
    pub lookup_id: Uuid,
    pub decision: DuplicateReviewDecision,
    pub reason_code: String,
    pub reason_note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientIdentityLookupRequest {
    pub patient_code: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub sex: Option<Sex>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientIdentityMatchStrength {
    Strong,
    Possible,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientIdentityCandidate {
    pub patient_id: Uuid,
    pub patient_code: String,
    pub display_name: String,
    pub date_of_birth: NaiveDate,
    pub sex: Sex,
    pub record_status: PatientRecordStatus,
    pub vital_status: PatientVitalStatus,
    pub superseded_by_patient_id: Option<Uuid>,
    pub match_strength: PatientIdentityMatchStrength,
    pub match_reasons: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientIdentityLookupResponse {
    pub lookup_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub candidates: Vec<PatientIdentityCandidate>,
    pub strong_duplicate_found: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientCurrentContexts {
    pub patient_id: Uuid,
    pub outpatient: Vec<PatientCurrentOutpatientContext>,
    pub inpatient: Vec<PatientCurrentInpatientContext>,
    pub emergency: Vec<PatientCurrentEmergencyContext>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientCurrentOutpatientContext {
    pub visit_id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub clinic_name: Option<String>,
    pub status: String,
    pub checked_in_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientCurrentInpatientContext {
    pub admission_case_id: Uuid,
    pub ward_id: Option<Uuid>,
    pub ward_name: Option<String>,
    pub bed_id: Option<Uuid>,
    pub bed_label: Option<String>,
    pub status: AdmissionStatus,
    pub admitted_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientCurrentEmergencyContext {
    pub visit_id: Uuid,
    pub triage_id: Option<Uuid>,
    pub location_id: Option<Uuid>,
    pub status: String,
    pub acuity: Option<String>,
    pub checked_in_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patient_list_get_query_preserves_filter_and_ordering_fields() {
        let patient_id = Uuid::from_u128(0x400);
        let query = PatientListQuery::from(PatientListGetQuery {
            cursor: Some("cursor".to_owned()),
            limit: Some(10),
            search: Some("Sortorderprobe".to_owned()),
            patient_id: Some(patient_id),
            status: Some(PatientAdministrativeStatus::Active),
            record_status: Some(PatientRecordStatus::Registered),
            vital_status: Some(PatientVitalStatus::PresumedAlive),
            admission_start: None,
            admission_end: None,
            ward_id: None,
            admission_status: None,
            attending_id: None,
            age_min: Some(18),
            age_max: Some(99),
            include_total: Some(true),
            ordering: Some("name".to_owned()),
        });

        assert_eq!(query.search.as_deref(), Some("Sortorderprobe"));
        assert_eq!(query.patient_id, Some(patient_id));
        assert_eq!(query.record_status, Some(PatientRecordStatus::Registered));
        assert_eq!(query.vital_status, Some(PatientVitalStatus::PresumedAlive));
        assert_eq!(query.ordering.as_deref(), Some("name"));
        assert_eq!(query.age_min, Some(18));
        assert_eq!(query.age_max, Some(99));
        assert_eq!(query.include_total, Some(true));
    }

    #[test]
    fn patient_context_get_query_preserves_patient_and_search_filters() {
        let patient_id = Uuid::from_u128(0x401);
        let query = PatientContextListQuery::from(PatientContextListGetQuery {
            cursor: None,
            limit: Some(5),
            search: Some("context".to_owned()),
            patient_id: Some(patient_id),
        });

        assert_eq!(query.search.as_deref(), Some("context"));
        assert_eq!(query.patient_id, Some(patient_id));
    }
}
