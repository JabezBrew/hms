use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

/// Canonical query used by both the result cache and repository. A query below
/// two UTF-8 bytes selects personal recents; the historical byte threshold is
/// deliberately distinct from the 120-Unicode-scalar input cap.
pub fn effective_omni_query(query: Option<&str>) -> Option<String> {
    let bounded = query?.trim().chars().take(120).collect::<String>();
    // The public handler already caps before repository normalization. Apply
    // that same order here: truncation can expose trailing whitespace, so the
    // bounded value must be trimmed before testing the historical byte limit.
    // The returned value is a fixed point when the repository checks it again.
    let effective = bounded.trim();
    (effective.len() >= 2).then(|| effective.to_owned())
}

#[cfg(test)]
mod effective_query_tests {
    use super::effective_omni_query;

    #[test]
    fn bounded_whitespace_keeps_public_byte_threshold_and_is_a_fixed_point() {
        let cases = [
            (None, None),
            (Some(String::new()), None),
            (Some(" \t\n ".to_owned()), None),
            (Some(" a ".to_owned()), None),
            (Some(format!("a{}b", " ".repeat(119))), None),
            (
                Some(format!("ab{}c", " ".repeat(118))),
                Some("ab".to_owned()),
            ),
            (Some(format!("É{}b", " ".repeat(119))), Some("É".to_owned())),
            (Some(" É ".to_owned()), Some("É".to_owned())),
            (Some(" ab ".to_owned()), Some("ab".to_owned())),
            (Some("É".repeat(121)), Some("É".repeat(120))),
        ];
        for (input, expected) in cases {
            let once = effective_omni_query(input.as_deref());
            assert_eq!(once, expected);
            assert_eq!(effective_omni_query(once.as_deref()), once);
        }
    }
}

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
