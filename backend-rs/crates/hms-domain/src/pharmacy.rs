use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PharmacyFulfillmentStatus {
    Pending,
    PartiallyDispensed,
    Dispensed,
    Rejected,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct PharmacyQueueQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub status: Option<PharmacyFulfillmentStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PharmacyQueueItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub admission_case_id: Uuid,
    pub prescription_id: Uuid,
    pub medication_course_id: Uuid,
    pub medication_name: String,
    pub dose: String,
    pub route: String,
    pub frequency: String,
    pub status: PharmacyFulfillmentStatus,
    pub coverage_start: DateTime<Utc>,
    pub coverage_end: DateTime<Utc>,
    pub next_due_at: Option<DateTime<Utc>>,
    pub overdue_count: i64,
    pub requested_dose_count: i64,
    pub dispensed_dose_count: i64,
    pub inventory_item_id: Option<Uuid>,
    pub dispensing_location_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DispensePharmacyFulfillmentRequest {
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PharmacyFulfillmentDispenseResult {
    pub fulfillment: PharmacyQueueItem,
    pub dispensed_dose_count: i64,
    pub remaining_dose_count: i64,
}
