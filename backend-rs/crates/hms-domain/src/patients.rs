use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

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
