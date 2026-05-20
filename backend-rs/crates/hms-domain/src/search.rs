use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SearchResourceType {
    Patients,
    Wards,
    Encounters,
    Appointments,
    Admissions,
    Staff,
    Visits,
    Clinics,
    Laboratory,
    Billing,
    Inventory,
    Referrals,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OmniSearchRequest {
    pub q: Option<String>,
    pub types: Option<Vec<SearchResourceType>>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OmniSearchResponse {
    pub query: String,
    pub types: Vec<SearchResourceType>,
    pub limit: u8,
    pub groups: OmniSearchGroups,
    pub index_status: Vec<SearchIndexStatus>,
    pub took_ms: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct OmniSearchGroups {
    pub recent_patients: Vec<OmniSearchItem>,
    pub patients: Vec<OmniSearchItem>,
    pub wards: Vec<OmniSearchItem>,
    pub encounters: Vec<OmniSearchItem>,
    pub appointments: Vec<OmniSearchItem>,
    pub admissions: Vec<OmniSearchItem>,
    pub staff: Vec<OmniSearchItem>,
    pub visits: Vec<OmniSearchItem>,
    pub clinics: Vec<OmniSearchItem>,
    pub laboratory: Vec<OmniSearchItem>,
    pub billing: Vec<OmniSearchItem>,
    pub inventory: Vec<OmniSearchItem>,
    pub referrals: Vec<OmniSearchItem>,
}

impl OmniSearchGroups {
    pub fn push(&mut self, item: OmniSearchItem) {
        match item.resource_type {
            SearchResourceType::Patients => self.patients.push(item),
            SearchResourceType::Wards => self.wards.push(item),
            SearchResourceType::Encounters => self.encounters.push(item),
            SearchResourceType::Appointments => self.appointments.push(item),
            SearchResourceType::Admissions => self.admissions.push(item),
            SearchResourceType::Staff => self.staff.push(item),
            SearchResourceType::Visits => self.visits.push(item),
            SearchResourceType::Clinics => self.clinics.push(item),
            SearchResourceType::Laboratory => self.laboratory.push(item),
            SearchResourceType::Billing => self.billing.push(item),
            SearchResourceType::Inventory => self.inventory.push(item),
            SearchResourceType::Referrals => self.referrals.push(item),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OmniSearchItem {
    pub id: Uuid,
    pub resource_type: SearchResourceType,
    pub title: String,
    pub subtitle: Option<String>,
    pub route_path: String,
    pub patient_id: Option<Uuid>,
    pub patient_code: Option<String>,
    pub patient_name: Option<String>,
    pub patient_date_of_birth: Option<NaiveDate>,
    pub status_label: Option<String>,
    pub occurred_at: Option<DateTime<Utc>>,
    pub metadata: Value,
    pub score: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct SearchIndexStatus {
    pub resource_type: SearchResourceType,
    pub status: SearchIndexState,
    pub indexed_count: i64,
    pub last_backfilled_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SearchIndexState {
    Ready,
    Rebuilding,
    Stale,
    Failed,
    Empty,
}
