use crate::care::AppointmentStatus;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AppointmentSeriesOccurrence {
    pub session_id: Uuid,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub overbook_reason: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateAppointmentSeriesRequest {
    pub client_request_id: Uuid,
    pub patient_id: Uuid,
    pub clinic_id: Uuid,
    pub service_id: Uuid,
    pub occurrences: Vec<AppointmentSeriesOccurrence>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CancelFutureAppointmentsRequest {
    pub client_request_id: Uuid,
    pub expected_snapshot_token: String,
    pub reason: String,
}
#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AppointmentSeriesListQuery {
    pub patient_id: Uuid,
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AppointmentSeriesListItem {
    pub id: Uuid,
    pub clinic_id: Uuid,
    pub clinic_name: String,
    pub service_id: Uuid,
    pub service_name: String,
    pub occurrence_count: i32,
    pub scheduled_count: i64,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AppointmentSeriesMember {
    pub id: Uuid,
    pub clinic_session_id: Uuid,
    pub practitioner_user_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub status: AppointmentStatus,
    pub cancellation_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AppointmentSeriesDetail {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_display_name: String,
    pub clinic_id: Uuid,
    pub clinic_name: String,
    pub service_id: Uuid,
    pub service_name: String,
    pub snapshot_token: String,
    pub occurrence_count: i32,
    pub created_at: DateTime<Utc>,
    pub appointments: Vec<AppointmentSeriesMember>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AppointmentSeriesCancellationReceipt {
    pub series: AppointmentSeriesDetail,
    pub cutoff_at: DateTime<Utc>,
    pub cancelled_appointment_ids: Vec<Uuid>,
    pub retained_appointment_ids: Vec<Uuid>,
    pub cancelled_count: i32,
}
