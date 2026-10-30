//! Governed scheduling defaults. Metadata changes never retime booked care.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateAppointmentTypeRequest {
    pub client_request_id: Uuid,
    pub code: String,
    pub name: String,
    pub default_duration_minutes: i32,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateAppointmentTypeMetadataRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub name: String,
    pub default_duration_minutes: i32,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AppointmentTypeLifecycleRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum AppointmentTypeReviewedInput {
    Create {
        client_request_id: Uuid,
        code: String,
        name: String,
        default_duration_minutes: i32,
    },
    Metadata {
        client_request_id: Uuid,
        service_id: Uuid,
        expected_version: i64,
        name: String,
        default_duration_minutes: i32,
    },
    Retire {
        client_request_id: Uuid,
        service_id: Uuid,
        expected_version: i64,
    },
    Reactivate {
        client_request_id: Uuid,
        service_id: Uuid,
        expected_version: i64,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct GovernedAppointmentType {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub default_duration_minutes: i32,
    pub is_active: bool,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AppointmentTypeCommandReceipt {
    pub client_request_id: Uuid,
    pub input_digest: String,
    pub reviewed_input: AppointmentTypeReviewedInput,
    pub recorded_by_user_id: Uuid,
    pub service: GovernedAppointmentType,
    pub changed: bool,
    pub recorded_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct AppointmentTypeAdministrationQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}
