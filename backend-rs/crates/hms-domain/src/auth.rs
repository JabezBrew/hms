use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::deployment::{DeploymentProfile, FeatureKey, PermissionCode};

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub facility_id: Uuid,
    pub facility_code: String,
    pub active_profile: DeploymentProfile,
    pub permissions: Vec<PermissionCode>,
    pub features: Vec<FeatureKey>,
    pub patient_visibility: Vec<PatientDataVisibility>,
    pub session_version: i64,
    pub permission_version: i64,
    pub password_change_required: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateAuthProfileRequest {
    pub display_name: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatientDataVisibility {
    None,
    Demographics,
    OperationalSummary,
    ClinicalSummary,
    FullClinical,
    Laboratory,
    Prescription,
    Billing,
    Audit,
    DeIdentified,
}
