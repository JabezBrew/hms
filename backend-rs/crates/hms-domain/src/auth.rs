use chrono::{DateTime, Utc};
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthoritySource {
    PositionAppointment,
    PermissionAssignment,
    Delegation,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AuthorityScope {
    pub scope_type: String,
    pub scope_id: Option<Uuid>,
}

impl AuthorityScope {
    pub fn facility() -> Self {
        Self {
            scope_type: "facility".to_owned(),
            scope_id: None,
        }
    }

    pub fn organization_unit(unit_id: Uuid) -> Self {
        Self {
            scope_type: "organization_unit".to_owned(),
            scope_id: Some(unit_id),
        }
    }

    pub fn covers_facility(&self) -> bool {
        self.scope_type == "facility" && self.scope_id.is_none()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct ActiveAuthority {
    pub source: AuthoritySource,
    pub source_id: Uuid,
    pub facility_id: Uuid,
    pub permission_code: Option<PermissionCode>,
    pub scope: AuthorityScope,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
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
