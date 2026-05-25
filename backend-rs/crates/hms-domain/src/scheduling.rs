use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::care::AppointmentListItem;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BookableUnitType {
    Facility,
    Practitioner,
    Team,
    Clinic,
    Service,
    Department,
    Resource,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BookableSessionMode {
    FixedSlot,
    CapacityBlock,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct SchedulingListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct BookableSessionListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub date: Option<NaiveDate>,
    pub clinic_id: Option<Uuid>,
    pub service_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AvailabilityQuery {
    pub start_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub clinic_id: Option<Uuid>,
    pub service_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BookableServiceListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub default_duration_minutes: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateBookableServiceRequest {
    pub code: String,
    pub name: String,
    pub default_duration_minutes: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BookableSessionListItem {
    pub id: Uuid,
    pub clinic_id: Option<Uuid>,
    pub service_code: Option<String>,
    pub practitioner_user_id: Option<Uuid>,
    pub owner_type: BookableUnitType,
    pub owner_id: Option<Uuid>,
    pub name: String,
    pub mode: BookableSessionMode,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub slot_minutes: Option<i32>,
    pub capacity: i32,
    pub booked_count: i64,
    pub remaining_capacity: i64,
    pub allow_overbooking: bool,
    pub overbook_limit: i32,
    pub overbook_remaining: i64,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateBookableSessionRequest {
    pub clinic_id: Option<Uuid>,
    pub service_code: Option<String>,
    pub practitioner_user_id: Option<Uuid>,
    pub owner_type: BookableUnitType,
    pub owner_id: Option<Uuid>,
    pub name: String,
    pub mode: BookableSessionMode,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub slot_minutes: Option<i32>,
    pub capacity: i32,
    pub allow_overbooking: Option<bool>,
    pub overbook_limit: Option<i32>,
    pub allowed_service_ids: Option<Vec<Uuid>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CancelBookableSessionRequest {
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AvailabilitySlot {
    pub id: String,
    pub session_id: Uuid,
    pub session_name: String,
    pub clinic_id: Option<Uuid>,
    pub service_code: Option<String>,
    pub practitioner_user_id: Option<Uuid>,
    pub owner_type: BookableUnitType,
    pub owner_id: Option<Uuid>,
    pub mode: BookableSessionMode,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub status: String,
    pub capacity: SlotCapacity,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct SlotCapacity {
    pub max: i32,
    pub booked: i64,
    pub remaining: i64,
    pub overbook_remaining: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AvailabilityResponse {
    pub slots: Vec<AvailabilitySlot>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BookAppointmentRequest {
    pub patient_id: Uuid,
    pub service_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
    pub clinic_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub overbook_reason: Option<String>,
    pub manual_booking_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct SchedulingExceptionRequest {
    pub session_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct SchedulingExceptionListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub session_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct SchedulingExceptionItem {
    pub id: Uuid,
    pub session_id: Option<Uuid>,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub reason: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ArriveAppointmentRequest {
    pub clinic_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BookAppointmentResponse {
    pub appointment: AppointmentListItem,
}
