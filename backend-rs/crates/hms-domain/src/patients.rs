use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::ward::AdmissionStatus;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientAdministrativeStatus {
    Active,
    Inactive,
    Deceased,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientContextKind {
    Assigned,
    Recent,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
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
    pub status: PatientAdministrativeStatus,
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
    pub birth_year: i32,
    pub patient_location: Option<String>,
    pub status: PatientAdministrativeStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientContextListItem {
    pub id: Uuid,
    pub patient_code: String,
    pub display_name: String,
    pub sex: Sex,
    pub birth_year: i32,
    pub status: PatientAdministrativeStatus,
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
            birth_year: value
                .date_of_birth
                .format("%Y")
                .to_string()
                .parse()
                .unwrap_or_default(),
            patient_location: None,
            status: value.status.clone(),
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
    pub status: PatientAdministrativeStatus,
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
    pub status: Option<PatientAdministrativeStatus>,
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
    pub status: Option<PatientAdministrativeStatus>,
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
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdatePatientRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub sex: Option<Sex>,
    pub status: Option<PatientAdministrativeStatus>,
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
