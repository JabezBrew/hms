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
    pub auth_security: AuthSecurityState,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AuthSecurityState {
    pub privileged_user: bool,
    pub passkey_required: bool,
    pub passkey_enrolled: bool,
    pub privileged_actions_allowed: bool,
    pub recovery_codes_remaining: i64,
}

impl AuthSecurityState {
    pub fn from_permissions(
        permissions: &[PermissionCode],
        passkey_enrolled: bool,
        recovery_codes_remaining: i64,
    ) -> Self {
        let privileged_user = permissions.iter().any(is_privileged_permission);
        let passkey_required = privileged_user;
        Self {
            privileged_user,
            passkey_required,
            passkey_enrolled,
            privileged_actions_allowed: !passkey_required || passkey_enrolled,
            recovery_codes_remaining: recovery_codes_remaining.max(0),
        }
    }
}

pub fn is_privileged_permission(permission: &PermissionCode) -> bool {
    matches!(
        permission,
        PermissionCode::AdminAuthorityManage
            | PermissionCode::AdminFeatureEntitlementsManage
            | PermissionCode::AdminStaffManage
            | PermissionCode::ControlledSubstanceManage
            | PermissionCode::LaboratoryResultVerify
            | PermissionCode::BillingManage
            | PermissionCode::NhisClaimManage
            | PermissionCode::ConsentManage
            | PermissionCode::PatientBreakGlassInvoke
    )
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

pub const BREAK_GLASS_PERMISSION_CODE: &str = "patient.break_glass.invoke";
pub const BREAK_GLASS_GRANT_TTL_HOURS: i64 = 2;
pub const BREAK_GLASS_MAX_ACTIVE_GRANTS_PER_USER: i64 = 3;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BreakGlassCategory {
    LifeThreateningEmergency,
    PatientUnconsciousOrUnidentified,
    HandoverOrAssignmentGap,
    UrgentClinicalContinuity,
    OtherEmergency,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct BreakGlassGrant {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub user_id: Uuid,
    pub patient_id: Uuid,
    pub category: BreakGlassCategory,
    pub reason_text: Option<String>,
    pub started_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

impl BreakGlassGrant {
    pub fn is_active_at(&self, now: DateTime<Utc>) -> bool {
        self.ended_at.is_none() && self.started_at <= now && now < self.expires_at
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StartBreakGlassGrantRequest {
    pub category: BreakGlassCategory,
    pub reason_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct EndBreakGlassGrantsResponse {
    pub ended_count: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BreakGlassGrantDenialReason {
    MissingDedicatedPermission,
    PatientNotActive,
    ReauthRequired,
    ActiveGrantAlreadyExists,
    TooManyActiveGrants,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BreakGlassGrantOutcome {
    Granted(BreakGlassGrant),
    Denied(BreakGlassGrantDenialReason),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClinicalPatientAccessSource {
    Workflow,
    BreakGlass,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClinicalPatientAccessReason {
    ActiveClinicalRelationship,
    WardOrTeamAssignment,
    ClinicSessionAssignment,
    ReferralOwnership,
    DepartmentOrUnitAuthority,
    ExplicitPatientAccessGrant,
    BreakGlassEmergency,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct ClinicalPatientAccessEvidence {
    pub workflow_reason: Option<ClinicalPatientAccessReason>,
    pub break_glass_grant: Option<BreakGlassGrant>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ClinicalPatientAccessDecision {
    pub source: ClinicalPatientAccessSource,
    pub reason: ClinicalPatientAccessReason,
    pub read_only: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deployment::PermissionCode;

    #[test]
    fn privileged_security_state_blocks_actions_until_passkey_enrolled() {
        let state =
            AuthSecurityState::from_permissions(&[PermissionCode::AdminStaffManage], false, 0);

        assert!(state.privileged_user);
        assert!(state.passkey_required);
        assert!(!state.passkey_enrolled);
        assert!(!state.privileged_actions_allowed);

        let enrolled =
            AuthSecurityState::from_permissions(&[PermissionCode::AdminStaffManage], true, 4);

        assert!(enrolled.privileged_actions_allowed);
        assert_eq!(enrolled.recovery_codes_remaining, 4);
    }

    #[test]
    fn non_privileged_security_state_does_not_require_passkey() {
        let state = AuthSecurityState::from_permissions(&[PermissionCode::DashboardView], false, 0);

        assert!(!state.privileged_user);
        assert!(!state.passkey_required);
        assert!(state.privileged_actions_allowed);
    }
}
