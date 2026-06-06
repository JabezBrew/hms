use std::ops::Deref;

use chrono::{DateTime, Duration, Utc};
use hms_domain::auth::{
    ActiveAuthority, AuthUser, AuthorityScope, AuthoritySource, ClinicalPatientAccessDecision,
    ClinicalPatientAccessEvidence, ClinicalPatientAccessReason, ClinicalPatientAccessSource,
    PatientDataVisibility,
};
use hms_domain::deployment::{DeploymentProfile, FeatureKey, PermissionCode};
use hms_domain::patients::PatientRecord;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

const HIGH_RISK_REAUTH_WINDOW_MINUTES: i64 = 15;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RequestContext {
    pub request_id: String,
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub facility_id: Uuid,
    pub facility_code: String,
    pub active_profile: DeploymentProfile,
    pub enabled_features: Vec<FeatureKey>,
    pub permissions: Vec<PermissionCode>,
    pub patient_visibility: Vec<PatientDataVisibility>,
    pub active_authorities: Vec<ActiveAuthority>,
    pub session_version: i64,
    pub permission_version: i64,
    pub offsite: OffsiteState,
    pub reauth: ReauthState,
    pub user: AuthUser,
}

impl RequestContext {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        request_id: String,
        session_id: Uuid,
        user: AuthUser,
        enabled_features: Vec<FeatureKey>,
        offsite: OffsiteState,
        reauth: ReauthState,
    ) -> Self {
        Self {
            request_id,
            user_id: user.id,
            session_id,
            facility_id: user.facility_id,
            facility_code: user.facility_code.clone(),
            active_profile: user.active_profile,
            enabled_features,
            permissions: user.permissions.clone(),
            patient_visibility: user.patient_visibility.clone(),
            active_authorities: vec![],
            session_version: user.session_version,
            permission_version: user.permission_version,
            offsite,
            reauth,
            user,
        }
    }

    pub fn auth_user(&self) -> &AuthUser {
        &self.user
    }

    pub fn with_active_authorities(mut self, active_authorities: Vec<ActiveAuthority>) -> Self {
        self.active_authorities = active_authorities;
        self
    }

    pub fn has_permission(&self, permission: PermissionCode) -> bool {
        self.permissions.contains(&permission)
    }

    pub fn has_feature(&self, feature: FeatureKey) -> bool {
        self.enabled_features.contains(&feature)
    }

    pub fn has_patient_visibility(&self, visibility: PatientDataVisibility) -> bool {
        self.patient_visibility.contains(&visibility)
    }

    pub fn authority_for_permission(
        &self,
        facility_id: Uuid,
        permission: PermissionCode,
    ) -> Option<&ActiveAuthority> {
        self.active_authorities.iter().find(|authority| {
            authority_grants_facility_permission(authority, facility_id, permission)
        })
    }
}

fn authority_grants_facility_permission(
    authority: &ActiveAuthority,
    facility_id: Uuid,
    permission: PermissionCode,
) -> bool {
    authority.facility_id == facility_id
        && authority.permission_code == Some(permission)
        && authority.scope.covers_facility()
}

impl Deref for RequestContext {
    type Target = AuthUser;

    fn deref(&self) -> &Self::Target {
        &self.user
    }
}

pub trait AccessSubject {
    fn facility_id(&self) -> Uuid;
    fn enabled_features(&self) -> &[FeatureKey];
    fn permissions(&self) -> &[PermissionCode];
    fn patient_visibility(&self) -> &[PatientDataVisibility];
    fn authority_for_permission(
        &self,
        _facility_id: Uuid,
        _permission: PermissionCode,
    ) -> Option<&ActiveAuthority> {
        None
    }

    fn has_feature(&self, feature: FeatureKey) -> bool {
        self.enabled_features().contains(&feature)
    }

    fn has_permission(&self, permission: PermissionCode) -> bool {
        self.permissions().contains(&permission)
    }

    fn has_facility_permission(&self, facility_id: Uuid, permission: PermissionCode) -> bool {
        self.has_permission(permission)
            || self
                .authority_for_permission(facility_id, permission)
                .is_some()
    }

    fn has_patient_visibility(&self, visibility: PatientDataVisibility) -> bool {
        self.patient_visibility().contains(&visibility)
    }
}

impl AccessSubject for RequestContext {
    fn facility_id(&self) -> Uuid {
        self.facility_id
    }

    fn enabled_features(&self) -> &[FeatureKey] {
        &self.enabled_features
    }

    fn permissions(&self) -> &[PermissionCode] {
        &self.permissions
    }

    fn patient_visibility(&self) -> &[PatientDataVisibility] {
        &self.patient_visibility
    }

    fn authority_for_permission(
        &self,
        facility_id: Uuid,
        permission: PermissionCode,
    ) -> Option<&ActiveAuthority> {
        RequestContext::authority_for_permission(self, facility_id, permission)
    }
}

impl AccessSubject for AuthUser {
    fn facility_id(&self) -> Uuid {
        self.facility_id
    }

    fn enabled_features(&self) -> &[FeatureKey] {
        &self.features
    }

    fn permissions(&self) -> &[PermissionCode] {
        &self.permissions
    }

    fn patient_visibility(&self) -> &[PatientDataVisibility] {
        &self.patient_visibility
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OffsiteState {
    Onsite,
    OffsiteReadOnly,
}

impl OffsiteState {
    pub fn from_header(value: Option<&str>) -> Self {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("1" | "true" | "yes" | "offsite") => Self::OffsiteReadOnly,
            _ => Self::Onsite,
        }
    }

    pub fn is_read_only(self) -> bool {
        matches!(self, Self::OffsiteReadOnly)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ReauthState {
    pub verified_at: Option<DateTime<Utc>>,
    pub required_after: DateTime<Utc>,
}

impl ReauthState {
    pub fn from_authentication_time(authenticated_at: DateTime<Utc>) -> Self {
        Self {
            verified_at: Some(authenticated_at),
            required_after: authenticated_at + Duration::minutes(HIGH_RISK_REAUTH_WINDOW_MINUTES),
        }
    }

    pub fn missing(now: DateTime<Utc>) -> Self {
        Self {
            verified_at: None,
            required_after: now,
        }
    }

    pub fn is_fresh_at(&self, now: DateTime<Utc>) -> bool {
        self.verified_at.is_some() && now <= self.required_after
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AccessError {
    #[error("missing facility context")]
    MissingFacility,
    #[error("wrong facility")]
    WrongFacility,
    #[error("feature is disabled")]
    FeatureDisabled,
    #[error("missing permission")]
    MissingPermission,
    #[error("patient access denied")]
    PatientAccessDenied,
    #[error("patient workflow access denied")]
    PatientWorkflowAccessDenied,
    #[error("billing access denied")]
    BillingAccessDenied,
    #[error("laboratory access denied")]
    LaboratoryAccessDenied,
    #[error("inventory access denied")]
    InventoryAccessDenied,
    #[error("admin authority access denied")]
    AdminAuthorityAccessDenied,
    #[error("fresh reauthentication is required")]
    ReauthRequired,
    #[error("passkey enrollment is required")]
    PasskeyRequired,
    #[error("offsite context is read only")]
    OffsiteReadOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccessDomain {
    Facility,
    Patient,
    PatientWorkflow,
    Billing,
    Laboratory,
    Inventory,
    AdminAuthority,
    Staff,
    Dashboard,
    Notification,
    Consent,
    Referral,
    Clinical,
    HighRisk,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessRequirement {
    pub domain: AccessDomain,
    pub facility_id: Option<Uuid>,
    pub feature: Option<FeatureKey>,
    pub permission: Option<PermissionCode>,
    pub patient_visibility: Option<PatientDataVisibility>,
    pub high_risk_reauth: bool,
    pub offsite_write: bool,
}

impl AccessRequirement {
    pub fn facility_permission(
        domain: AccessDomain,
        facility_id: Uuid,
        permission: PermissionCode,
    ) -> Self {
        Self {
            domain,
            facility_id: Some(facility_id),
            feature: None,
            permission: Some(permission),
            patient_visibility: None,
            high_risk_reauth: false,
            offsite_write: false,
        }
    }

    pub fn with_feature(mut self, feature: FeatureKey) -> Self {
        self.feature = Some(feature);
        self
    }

    pub fn with_patient_visibility(mut self, visibility: PatientDataVisibility) -> Self {
        self.patient_visibility = Some(visibility);
        self
    }

    pub fn high_risk_write(mut self) -> Self {
        self.high_risk_reauth = true;
        self.offsite_write = true;
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AccessGrant {
    DirectPermission(PermissionCode),
    ActiveAuthority {
        source: AuthoritySource,
        source_id: Uuid,
        permission: PermissionCode,
        scope: AuthorityScope,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessDecision {
    pub requirement: AccessRequirement,
    pub grant: Option<AccessGrant>,
}

pub fn require_auth(ctx: &RequestContext) -> Result<(), AccessError> {
    if ctx.user_id.is_nil() || ctx.session_id.is_nil() {
        Err(AccessError::MissingPermission)
    } else {
        Ok(())
    }
}

pub fn require_facility(ctx: &impl AccessSubject, facility_id: Uuid) -> Result<(), AccessError> {
    if facility_id.is_nil() {
        return Err(AccessError::MissingFacility);
    }
    if ctx.facility_id() == facility_id {
        Ok(())
    } else {
        Err(AccessError::WrongFacility)
    }
}

pub fn require_feature(ctx: &impl AccessSubject, feature: FeatureKey) -> Result<(), AccessError> {
    if ctx.has_feature(feature) {
        Ok(())
    } else {
        Err(AccessError::FeatureDisabled)
    }
}

pub fn require_permission(
    ctx: &impl AccessSubject,
    permission: PermissionCode,
) -> Result<(), AccessError> {
    if ctx.has_permission(permission) {
        Ok(())
    } else {
        Err(AccessError::MissingPermission)
    }
}

pub fn require_any_permission(
    ctx: &impl AccessSubject,
    permissions: &[PermissionCode],
) -> Result<(), AccessError> {
    if permissions
        .iter()
        .any(|permission| ctx.has_permission(*permission))
    {
        Ok(())
    } else {
        Err(AccessError::MissingPermission)
    }
}

pub fn require_facility_permission(
    ctx: &RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), AccessError> {
    evaluate_facility_permission(
        ctx,
        AccessRequirement::facility_permission(AccessDomain::Facility, facility_id, permission),
    )
    .map(|_| ())
}

pub fn require_any_facility_permission(
    ctx: &impl AccessSubject,
    facility_id: Uuid,
    permissions: &[PermissionCode],
) -> Result<(), AccessError> {
    require_facility(ctx, facility_id)?;
    if permissions
        .iter()
        .any(|permission| ctx.has_facility_permission(facility_id, *permission))
    {
        Ok(())
    } else {
        Err(AccessError::MissingPermission)
    }
}

pub fn evaluate_facility_permission(
    ctx: &RequestContext,
    requirement: AccessRequirement,
) -> Result<AccessDecision, AccessError> {
    let facility_id = requirement
        .facility_id
        .ok_or(AccessError::MissingFacility)?;
    let permission = requirement
        .permission
        .ok_or(AccessError::MissingPermission)?;

    require_auth(ctx)?;
    require_facility(ctx, facility_id)?;

    if let Some(feature) = requirement.feature {
        require_feature(ctx, feature)?;
    }

    if ctx.permissions.contains(&permission) {
        return Ok(AccessDecision {
            requirement,
            grant: Some(AccessGrant::DirectPermission(permission)),
        });
    }

    if let Some(authority) = ctx.authority_for_permission(facility_id, permission) {
        return Ok(AccessDecision {
            requirement,
            grant: Some(AccessGrant::ActiveAuthority {
                source: authority.source,
                source_id: authority.source_id,
                permission,
                scope: authority.scope.clone(),
            }),
        });
    }

    Err(AccessError::MissingPermission)
}

pub fn require_patient_access(
    ctx: &impl AccessSubject,
    patient: &PatientRecord,
    visibility: PatientDataVisibility,
) -> Result<(), AccessError> {
    require_facility(ctx, patient.facility_id)?;
    if ctx.has_patient_visibility(visibility) {
        Ok(())
    } else {
        Err(AccessError::PatientAccessDenied)
    }
}

pub fn require_patient_demographics_access(
    ctx: &impl AccessSubject,
    patient: &PatientRecord,
) -> Result<(), AccessError> {
    require_facility(ctx, patient.facility_id)?;
    if !ctx.has_facility_permission(patient.facility_id, PermissionCode::PatientDemographicsView) {
        return Err(AccessError::MissingPermission);
    }
    require_patient_access(ctx, patient, PatientDataVisibility::Demographics)
}

pub fn require_patient_workflow_access(
    ctx: &RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), AccessError> {
    if let Some(feature) = feature_for_permission(permission) {
        require_feature(ctx, feature)?;
    }
    require_auth(ctx)?;
    require_facility(ctx, facility_id)?;
    if !ctx.has_facility_permission(facility_id, permission) {
        return Err(AccessError::MissingPermission);
    }
    if !ctx.has_facility_permission(facility_id, PermissionCode::PatientDemographicsView) {
        return Err(AccessError::MissingPermission);
    }
    if ctx.has_patient_visibility(PatientDataVisibility::Demographics) {
        Ok(())
    } else {
        Err(AccessError::PatientWorkflowAccessDenied)
    }
}

fn feature_for_permission(permission: PermissionCode) -> Option<FeatureKey> {
    match permission {
        PermissionCode::PatientDemographicsView
        | PermissionCode::PatientCreate
        | PermissionCode::PatientUpdate
        | PermissionCode::ConsentManage => Some(FeatureKey::Patients),
        PermissionCode::AppointmentView | PermissionCode::AppointmentManage => {
            Some(FeatureKey::Appointments)
        }
        PermissionCode::EncounterView
        | PermissionCode::EncounterManage
        | PermissionCode::ClinicalDocumentationView
        | PermissionCode::ClinicalDocumentationManage => Some(FeatureKey::Encounters),
        PermissionCode::WardView
        | PermissionCode::WardBoardViewAll
        | PermissionCode::WardManageBeds => Some(FeatureKey::Wards),
        PermissionCode::AdmissionManage => Some(FeatureKey::Admissions),
        PermissionCode::NursingTaskManage => Some(FeatureKey::Nursing),
        PermissionCode::ReferralManage => Some(FeatureKey::Referrals),
        _ => None,
    }
}

pub fn require_billing_access(
    ctx: &RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Billing).map_err(|_| AccessError::BillingAccessDenied)?;
    require_patient_workflow_access(ctx, facility_id, permission)
        .map_err(|_| AccessError::BillingAccessDenied)
}

pub fn require_nhis_access(ctx: &RequestContext, facility_id: Uuid) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Nhis).map_err(|_| AccessError::BillingAccessDenied)?;
    require_billing_access(ctx, facility_id, PermissionCode::NhisClaimManage)
}

pub fn require_lab_access(
    ctx: &RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Laboratory)
        .map_err(|_| AccessError::LaboratoryAccessDenied)?;
    require_patient_workflow_access(ctx, facility_id, permission)
        .map_err(|_| AccessError::LaboratoryAccessDenied)
}

pub fn require_lab_list_access(ctx: &RequestContext, facility_id: Uuid) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Laboratory)
        .map_err(|_| AccessError::LaboratoryAccessDenied)?;
    require_facility(ctx, facility_id).map_err(|_| AccessError::LaboratoryAccessDenied)?;
    if !ctx.has_permission(PermissionCode::LaboratoryOrderManage)
        && !ctx.has_permission(PermissionCode::LaboratoryResultVerify)
    {
        return Err(AccessError::LaboratoryAccessDenied);
    }
    if ctx.has_patient_visibility(PatientDataVisibility::Demographics) {
        Ok(())
    } else {
        Err(AccessError::PatientWorkflowAccessDenied)
    }
}

pub fn require_inventory_access(
    ctx: &RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), AccessError> {
    let feature = match permission {
        PermissionCode::PharmacyDispense => FeatureKey::Pharmacy,
        _ => FeatureKey::Inventory,
    };
    require_feature(ctx, feature).map_err(|_| AccessError::InventoryAccessDenied)?;
    require_patient_workflow_access(ctx, facility_id, permission)
        .map_err(|_| AccessError::InventoryAccessDenied)
}

pub fn require_inventory_list_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    let feature_allowed =
        ctx.has_feature(FeatureKey::Inventory) || ctx.has_feature(FeatureKey::Pharmacy);
    let permission_allowed = [
        PermissionCode::InventoryView,
        PermissionCode::InventoryManage,
        PermissionCode::PharmacyDispense,
        PermissionCode::ControlledSubstanceManage,
    ]
    .iter()
    .any(|permission| ctx.has_permission(*permission));

    if !feature_allowed || !permission_allowed {
        return Err(AccessError::InventoryAccessDenied);
    }
    require_facility(ctx, facility_id).map_err(|_| AccessError::InventoryAccessDenied)?;
    if ctx.has_patient_visibility(PatientDataVisibility::Demographics) {
        Ok(())
    } else {
        Err(AccessError::PatientWorkflowAccessDenied)
    }
}

pub fn require_admin_authority_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Admin).map_err(|_| AccessError::AdminAuthorityAccessDenied)?;
    require_facility_permission(ctx, facility_id, PermissionCode::AdminAuthorityManage)
        .map_err(|_| AccessError::AdminAuthorityAccessDenied)
}

pub fn require_feature_entitlement_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Admin).map_err(|_| AccessError::AdminAuthorityAccessDenied)?;
    require_facility_permission(
        ctx,
        facility_id,
        PermissionCode::AdminFeatureEntitlementsManage,
    )
    .map_err(|_| AccessError::AdminAuthorityAccessDenied)
}

pub fn require_ops_dashboard_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Admin)?;
    require_facility_permission(ctx, facility_id, PermissionCode::SystemOpsView)
}

pub fn require_staff_access(ctx: &RequestContext, facility_id: Uuid) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Admin).map_err(|_| AccessError::AdminAuthorityAccessDenied)?;
    require_facility_permission(ctx, facility_id, PermissionCode::AdminStaffManage)
        .map_err(|_| AccessError::AdminAuthorityAccessDenied)
}

pub fn require_staff_directory_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    let allowed = [
        PermissionCode::AdminStaffManage,
        PermissionCode::EncounterManage,
        PermissionCode::NursingTaskManage,
        PermissionCode::ControlledSubstanceManage,
        PermissionCode::PharmacyDispense,
    ]
    .iter()
    .any(|permission| ctx.has_permission(*permission));

    if !allowed {
        return Err(AccessError::MissingPermission);
    }
    require_facility(ctx, facility_id)
}

pub fn require_dashboard_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Dashboards)?;
    require_facility_permission(ctx, facility_id, PermissionCode::DashboardView)
}

pub fn require_notification_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Dashboards)?;
    require_facility_permission(ctx, facility_id, PermissionCode::NotificationView)
}

pub fn require_consent_access(ctx: &RequestContext, facility_id: Uuid) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Patients)?;
    require_patient_workflow_access(ctx, facility_id, PermissionCode::ConsentManage)
}

pub fn require_referral_access(ctx: &RequestContext, facility_id: Uuid) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Referrals)?;
    require_patient_workflow_access(ctx, facility_id, PermissionCode::ReferralManage)
}

pub fn require_clinical_list_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Encounters)?;
    require_patient_workflow_access(ctx, facility_id, PermissionCode::ClinicalDocumentationView)
}

pub fn require_clinical_write_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Encounters)?;
    require_patient_workflow_access(
        ctx,
        facility_id,
        PermissionCode::ClinicalDocumentationManage,
    )?;
    require_offsite_write_allowed(ctx)
}

pub fn require_chronicle_read_access(
    ctx: &RequestContext,
    facility_id: Uuid,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Patients)?;
    require_feature(ctx, FeatureKey::Encounters)?;
    require_patient_workflow_access(ctx, facility_id, PermissionCode::ClinicalDocumentationView)
}

pub fn evaluate_clinical_patient_access(
    ctx: &RequestContext,
    patient: &PatientRecord,
    evidence: &ClinicalPatientAccessEvidence,
    now: DateTime<Utc>,
) -> Result<ClinicalPatientAccessDecision, AccessError> {
    require_facility(ctx, patient.facility_id)?;

    if let Some(reason) = evidence.workflow_reason {
        require_chronicle_read_access(ctx, patient.facility_id)?;
        return Ok(ClinicalPatientAccessDecision {
            source: ClinicalPatientAccessSource::Workflow,
            reason,
            read_only: ctx.offsite.is_read_only(),
        });
    }

    if let Some(grant) = evidence.break_glass_grant.as_ref() {
        if grant.facility_id == patient.facility_id
            && grant.facility_id == ctx.facility_id
            && grant.user_id == ctx.user_id
            && grant.patient_id == patient.id
            && grant.is_active_at(now)
        {
            return Ok(ClinicalPatientAccessDecision {
                source: ClinicalPatientAccessSource::BreakGlass,
                reason: ClinicalPatientAccessReason::BreakGlassEmergency,
                read_only: ctx.offsite.is_read_only(),
            });
        }
    }

    Err(AccessError::PatientAccessDenied)
}

pub fn require_high_risk_reauth(
    ctx: &RequestContext,
    now: DateTime<Utc>,
) -> Result<(), AccessError> {
    if ctx.reauth.is_fresh_at(now) {
        Ok(())
    } else {
        Err(AccessError::ReauthRequired)
    }
}

pub fn require_privileged_action_allowed(ctx: &RequestContext) -> Result<(), AccessError> {
    if ctx.user.auth_security.passkey_required && !ctx.user.auth_security.passkey_enrolled {
        Err(AccessError::PasskeyRequired)
    } else {
        Ok(())
    }
}

pub fn require_high_risk_facility_permission(
    ctx: &RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
    now: DateTime<Utc>,
) -> Result<(), AccessError> {
    evaluate_facility_permission(
        ctx,
        AccessRequirement::facility_permission(AccessDomain::HighRisk, facility_id, permission)
            .high_risk_write(),
    )?;
    require_privileged_action_allowed(ctx)?;
    require_high_risk_reauth(ctx, now)?;
    require_offsite_write_allowed(ctx)
}

pub fn require_offsite_write_allowed(ctx: &RequestContext) -> Result<(), AccessError> {
    if ctx.offsite.is_read_only() {
        Err(AccessError::OffsiteReadOnly)
    } else {
        Ok(())
    }
}

pub fn can_create_patient(ctx: &RequestContext, facility_id: Uuid) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Patients)?;
    require_facility_permission(ctx, facility_id, PermissionCode::PatientCreate)
}

pub fn can_update_patient(
    ctx: &RequestContext,
    patient: &PatientRecord,
) -> Result<(), AccessError> {
    require_feature(ctx, FeatureKey::Patients)?;
    require_patient_demographics_access(ctx, patient)?;
    require_facility_permission(ctx, patient.facility_id, PermissionCode::PatientUpdate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use hms_domain::auth::AuthSecurityState;

    fn make_ctx() -> RequestContext {
        let facility_id = Uuid::new_v4();
        let permissions = vec![
            PermissionCode::PatientDemographicsView,
            PermissionCode::PatientUpdate,
            PermissionCode::ClinicalDocumentationView,
            PermissionCode::ClinicalDocumentationManage,
            PermissionCode::BillingView,
            PermissionCode::LaboratoryOrderManage,
            PermissionCode::InventoryView,
            PermissionCode::AdminAuthorityManage,
        ];
        let user = AuthUser {
            id: Uuid::new_v4(),
            email: "doctor@hms.local".to_owned(),
            display_name: "Doctor".to_owned(),
            facility_id,
            facility_code: "HMS".to_owned(),
            active_profile: DeploymentProfile::Hospital,
            permissions: permissions.clone(),
            features: vec![],
            patient_visibility: vec![
                PatientDataVisibility::Demographics,
                PatientDataVisibility::Billing,
            ],
            session_version: 1,
            permission_version: 1,
            password_change_required: false,
            auth_security: AuthSecurityState::from_permissions(&permissions, true, 4),
        };
        RequestContext::new(
            "request-1".to_owned(),
            Uuid::new_v4(),
            user,
            vec![
                FeatureKey::Patients,
                FeatureKey::Encounters,
                FeatureKey::Billing,
                FeatureKey::Laboratory,
                FeatureKey::Inventory,
                FeatureKey::Admin,
            ],
            OffsiteState::Onsite,
            ReauthState::from_authentication_time(Utc::now()),
        )
    }

    fn patient(facility_id: Uuid) -> PatientRecord {
        PatientRecord {
            id: Uuid::new_v4(),
            facility_id,
            patient_code: "P-1".to_owned(),
            first_name: "Ama".to_owned(),
            last_name: "Mensah".to_owned(),
            date_of_birth: chrono::NaiveDate::from_ymd_opt(1990, 2, 14).unwrap(),
            sex: hms_domain::patients::Sex::Female,
            status: hms_domain::patients::PatientAdministrativeStatus::Active,
            record_status: hms_domain::patients::PatientRecordStatus::Registered,
            vital_status: hms_domain::patients::PatientVitalStatus::PresumedAlive,
            superseded_by_patient_id: None,
            record_status_reason_code: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn active_authority(
        facility_id: Uuid,
        permission_code: PermissionCode,
        scope: AuthorityScope,
    ) -> ActiveAuthority {
        ActiveAuthority {
            source: AuthoritySource::PermissionAssignment,
            source_id: Uuid::new_v4(),
            facility_id,
            permission_code: Some(permission_code),
            scope,
            starts_at: Utc::now(),
            ends_at: None,
        }
    }

    #[test]
    fn policy_matrix_covers_core_denial_reasons() {
        struct PolicyCase {
            name: &'static str,
            mutate: fn(&mut RequestContext),
            check: fn(&RequestContext) -> Result<(), AccessError>,
            expected: AccessError,
        }

        fn unchanged(_: &mut RequestContext) {}
        fn clear_patient_visibility(ctx: &mut RequestContext) {
            ctx.patient_visibility.clear();
        }
        fn disable_billing(ctx: &mut RequestContext) {
            ctx.enabled_features
                .retain(|feature| *feature != FeatureKey::Billing);
        }
        fn remove_lab_permission(ctx: &mut RequestContext) {
            ctx.permissions
                .retain(|permission| *permission != PermissionCode::LaboratoryOrderManage);
        }
        fn disable_inventory(ctx: &mut RequestContext) {
            ctx.enabled_features
                .retain(|feature| *feature != FeatureKey::Inventory);
        }
        fn remove_admin_permission(ctx: &mut RequestContext) {
            ctx.permissions
                .retain(|permission| *permission != PermissionCode::AdminAuthorityManage);
        }
        fn make_offsite(ctx: &mut RequestContext) {
            ctx.offsite = OffsiteState::OffsiteReadOnly;
        }

        fn missing_facility(ctx: &RequestContext) -> Result<(), AccessError> {
            require_facility(ctx, Uuid::nil())
        }
        fn wrong_facility(ctx: &RequestContext) -> Result<(), AccessError> {
            require_facility(ctx, Uuid::new_v4())
        }
        fn disabled_feature(ctx: &RequestContext) -> Result<(), AccessError> {
            require_feature(ctx, FeatureKey::Nursing)
        }
        fn missing_permission(ctx: &RequestContext) -> Result<(), AccessError> {
            require_permission(ctx, PermissionCode::NursingTaskManage)
        }
        fn insufficient_patient_visibility(ctx: &RequestContext) -> Result<(), AccessError> {
            require_patient_demographics_access(ctx, &patient(ctx.facility_id))
        }
        fn billing_guard(ctx: &RequestContext) -> Result<(), AccessError> {
            require_billing_access(ctx, ctx.facility_id, PermissionCode::BillingView)
        }
        fn lab_guard(ctx: &RequestContext) -> Result<(), AccessError> {
            require_lab_access(ctx, ctx.facility_id, PermissionCode::LaboratoryOrderManage)
        }
        fn inventory_guard(ctx: &RequestContext) -> Result<(), AccessError> {
            require_inventory_access(ctx, ctx.facility_id, PermissionCode::InventoryView)
        }
        fn admin_guard(ctx: &RequestContext) -> Result<(), AccessError> {
            require_admin_authority_access(ctx, ctx.facility_id)
        }
        fn high_risk_offsite_guard(ctx: &RequestContext) -> Result<(), AccessError> {
            require_high_risk_facility_permission(
                ctx,
                ctx.facility_id,
                PermissionCode::AdminAuthorityManage,
                Utc::now(),
            )
        }

        let cases = [
            PolicyCase {
                name: "missing facility",
                mutate: unchanged,
                check: missing_facility,
                expected: AccessError::MissingFacility,
            },
            PolicyCase {
                name: "wrong facility",
                mutate: unchanged,
                check: wrong_facility,
                expected: AccessError::WrongFacility,
            },
            PolicyCase {
                name: "disabled feature",
                mutate: unchanged,
                check: disabled_feature,
                expected: AccessError::FeatureDisabled,
            },
            PolicyCase {
                name: "missing permission",
                mutate: unchanged,
                check: missing_permission,
                expected: AccessError::MissingPermission,
            },
            PolicyCase {
                name: "insufficient patient visibility",
                mutate: clear_patient_visibility,
                check: insufficient_patient_visibility,
                expected: AccessError::PatientAccessDenied,
            },
            PolicyCase {
                name: "billing disabled feature",
                mutate: disable_billing,
                check: billing_guard,
                expected: AccessError::BillingAccessDenied,
            },
            PolicyCase {
                name: "laboratory missing permission",
                mutate: remove_lab_permission,
                check: lab_guard,
                expected: AccessError::LaboratoryAccessDenied,
            },
            PolicyCase {
                name: "inventory disabled feature",
                mutate: disable_inventory,
                check: inventory_guard,
                expected: AccessError::InventoryAccessDenied,
            },
            PolicyCase {
                name: "admin authority missing permission",
                mutate: remove_admin_permission,
                check: admin_guard,
                expected: AccessError::AdminAuthorityAccessDenied,
            },
            PolicyCase {
                name: "offsite high-risk write",
                mutate: make_offsite,
                check: high_risk_offsite_guard,
                expected: AccessError::OffsiteReadOnly,
            },
        ];

        for case in cases {
            let mut ctx = make_ctx();
            (case.mutate)(&mut ctx);
            assert_eq!((case.check)(&ctx), Err(case.expected), "{}", case.name);
        }
    }

    #[test]
    fn rejects_missing_and_wrong_facility() {
        let ctx = make_ctx();
        assert_eq!(
            require_facility(&ctx, Uuid::nil()),
            Err(AccessError::MissingFacility)
        );
        assert_eq!(
            require_facility(&ctx, Uuid::new_v4()),
            Err(AccessError::WrongFacility)
        );
    }

    #[test]
    fn rejects_disabled_feature_and_missing_permission() {
        let ctx = make_ctx();
        assert_eq!(
            require_feature(&ctx, FeatureKey::Nursing),
            Err(AccessError::FeatureDisabled)
        );
        assert_eq!(
            require_permission(&ctx, PermissionCode::NursingTaskManage),
            Err(AccessError::MissingPermission)
        );
    }

    #[test]
    fn rejects_insufficient_patient_visibility() {
        let mut ctx = make_ctx();
        ctx.patient_visibility.clear();
        let patient = patient(ctx.facility_id);
        assert_eq!(
            require_patient_demographics_access(&ctx, &patient),
            Err(AccessError::PatientAccessDenied)
        );
    }

    #[test]
    fn rejects_domain_specific_access() {
        let mut ctx = make_ctx();
        ctx.enabled_features
            .retain(|feature| *feature != FeatureKey::Billing);
        assert_eq!(
            require_billing_access(&ctx, ctx.facility_id, PermissionCode::BillingView),
            Err(AccessError::BillingAccessDenied)
        );

        let mut ctx = make_ctx();
        ctx.permissions
            .retain(|permission| *permission != PermissionCode::LaboratoryOrderManage);
        assert_eq!(
            require_lab_access(&ctx, ctx.facility_id, PermissionCode::LaboratoryOrderManage),
            Err(AccessError::LaboratoryAccessDenied)
        );

        let mut ctx = make_ctx();
        ctx.enabled_features
            .retain(|feature| *feature != FeatureKey::Inventory);
        assert_eq!(
            require_inventory_access(&ctx, ctx.facility_id, PermissionCode::InventoryView),
            Err(AccessError::InventoryAccessDenied)
        );

        let mut ctx = make_ctx();
        ctx.permissions
            .retain(|permission| *permission != PermissionCode::AdminAuthorityManage);
        assert_eq!(
            require_admin_authority_access(&ctx, ctx.facility_id),
            Err(AccessError::AdminAuthorityAccessDenied)
        );
    }

    #[test]
    fn rejects_missing_high_risk_reauth() {
        let mut ctx = make_ctx();
        let now = Utc::now();
        ctx.reauth = ReauthState::missing(now);
        assert_eq!(
            require_high_risk_reauth(&ctx, now),
            Err(AccessError::ReauthRequired)
        );
    }

    #[test]
    fn authorizes_admin_access_from_active_authority_scope() {
        let mut ctx = make_ctx();
        ctx.permissions
            .retain(|permission| *permission != PermissionCode::AdminAuthorityManage);
        ctx.active_authorities.push(active_authority(
            ctx.facility_id,
            PermissionCode::AdminAuthorityManage,
            AuthorityScope::facility(),
        ));

        assert_eq!(
            require_admin_authority_access(&ctx, ctx.facility_id),
            Ok(())
        );
        let decision = evaluate_facility_permission(
            &ctx,
            AccessRequirement::facility_permission(
                AccessDomain::AdminAuthority,
                ctx.facility_id,
                PermissionCode::AdminAuthorityManage,
            ),
        )
        .expect("authority grants admin permission");
        assert!(matches!(
            decision.grant,
            Some(AccessGrant::ActiveAuthority { .. })
        ));
    }

    #[test]
    fn patient_update_accepts_active_authority_scope() {
        let mut ctx = make_ctx();
        ctx.permissions
            .retain(|permission| *permission != PermissionCode::PatientUpdate);
        let patient = patient(ctx.facility_id);
        assert_eq!(
            can_update_patient(&ctx, &patient),
            Err(AccessError::MissingPermission)
        );

        ctx.active_authorities.push(active_authority(
            ctx.facility_id,
            PermissionCode::PatientUpdate,
            AuthorityScope::facility(),
        ));

        assert_eq!(can_update_patient(&ctx, &patient), Ok(()));
    }

    #[test]
    fn chronicle_read_requires_patient_and_clinical_workflow_access() {
        let ctx = make_ctx();
        assert_eq!(require_chronicle_read_access(&ctx, ctx.facility_id), Ok(()));

        let mut missing_feature = make_ctx();
        missing_feature
            .enabled_features
            .retain(|feature| *feature != FeatureKey::Encounters);
        assert_eq!(
            require_chronicle_read_access(&missing_feature, missing_feature.facility_id),
            Err(AccessError::FeatureDisabled)
        );

        let mut missing_permission = make_ctx();
        missing_permission
            .permissions
            .retain(|permission| *permission != PermissionCode::ClinicalDocumentationView);
        assert_eq!(
            require_chronicle_read_access(&missing_permission, missing_permission.facility_id),
            Err(AccessError::MissingPermission)
        );
    }

    #[test]
    fn rejects_active_authority_from_wrong_facility() {
        let mut ctx = make_ctx();
        ctx.permissions
            .retain(|permission| *permission != PermissionCode::AdminAuthorityManage);
        ctx.active_authorities.push(active_authority(
            Uuid::new_v4(),
            PermissionCode::AdminAuthorityManage,
            AuthorityScope::facility(),
        ));

        assert_eq!(
            require_admin_authority_access(&ctx, ctx.facility_id),
            Err(AccessError::AdminAuthorityAccessDenied)
        );
    }

    #[test]
    fn does_not_promote_org_unit_authority_to_facility_permission() {
        let mut ctx = make_ctx();
        ctx.permissions
            .retain(|permission| *permission != PermissionCode::AdminAuthorityManage);
        ctx.active_authorities.push(active_authority(
            ctx.facility_id,
            PermissionCode::AdminAuthorityManage,
            AuthorityScope::organization_unit(Uuid::new_v4()),
        ));

        assert_eq!(
            require_admin_authority_access(&ctx, ctx.facility_id),
            Err(AccessError::AdminAuthorityAccessDenied)
        );
    }

    #[test]
    fn authority_without_permission_code_does_not_grant_access() {
        let mut ctx = make_ctx();
        ctx.permissions
            .retain(|permission| *permission != PermissionCode::AdminAuthorityManage);
        ctx.active_authorities.push(ActiveAuthority {
            source: AuthoritySource::PermissionAssignment,
            source_id: Uuid::new_v4(),
            facility_id: ctx.facility_id,
            permission_code: None,
            scope: AuthorityScope::facility(),
            starts_at: Utc::now(),
            ends_at: None,
        });

        assert_eq!(
            require_admin_authority_access(&ctx, ctx.facility_id),
            Err(AccessError::AdminAuthorityAccessDenied)
        );
    }

    #[test]
    fn high_risk_facility_permission_requires_reauth_and_onsite_state() {
        let mut ctx = make_ctx();
        let now = Utc::now();
        ctx.reauth = ReauthState::missing(now);
        assert_eq!(
            require_high_risk_facility_permission(
                &ctx,
                ctx.facility_id,
                PermissionCode::AdminAuthorityManage,
                now,
            ),
            Err(AccessError::ReauthRequired)
        );

        let mut ctx = make_ctx();
        ctx.offsite = OffsiteState::OffsiteReadOnly;
        assert_eq!(
            require_high_risk_facility_permission(
                &ctx,
                ctx.facility_id,
                PermissionCode::AdminAuthorityManage,
                now,
            ),
            Err(AccessError::OffsiteReadOnly)
        );
    }

    #[test]
    fn high_risk_facility_permission_requires_privileged_passkey_enrollment() {
        let mut ctx = make_ctx();
        ctx.user.auth_security = AuthSecurityState::from_permissions(&ctx.permissions, false, 0);
        assert_eq!(
            require_high_risk_facility_permission(
                &ctx,
                ctx.facility_id,
                PermissionCode::AdminAuthorityManage,
                Utc::now(),
            ),
            Err(AccessError::PasskeyRequired)
        );
    }

    #[test]
    fn clinical_patient_access_separates_registry_from_chronicle_access() {
        let mut registry_only = make_ctx();
        let patient = patient(registry_only.facility_id);
        registry_only.permissions = vec![PermissionCode::PatientDemographicsView];
        registry_only.patient_visibility = vec![PatientDataVisibility::Demographics];

        assert_eq!(
            require_patient_workflow_access(
                &registry_only,
                registry_only.facility_id,
                PermissionCode::PatientDemographicsView,
            ),
            Ok(())
        );
        assert_eq!(
            evaluate_clinical_patient_access(
                &registry_only,
                &patient,
                &hms_domain::auth::ClinicalPatientAccessEvidence::default(),
                Utc::now(),
            ),
            Err(AccessError::PatientAccessDenied)
        );
    }

    #[test]
    fn clinical_patient_access_reports_workflow_source_and_read_only_state() {
        let ctx = make_ctx();
        let patient = patient(ctx.facility_id);
        let evidence = hms_domain::auth::ClinicalPatientAccessEvidence {
            workflow_reason: Some(
                hms_domain::auth::ClinicalPatientAccessReason::ActiveClinicalRelationship,
            ),
            break_glass_grant: None,
        };

        let onsite = evaluate_clinical_patient_access(&ctx, &patient, &evidence, Utc::now())
            .expect("workflow evidence grants chronicle access");
        assert_eq!(
            onsite.source,
            hms_domain::auth::ClinicalPatientAccessSource::Workflow
        );
        assert_eq!(
            onsite.reason,
            hms_domain::auth::ClinicalPatientAccessReason::ActiveClinicalRelationship
        );
        assert!(!onsite.read_only);

        let mut offsite = ctx;
        offsite.offsite = OffsiteState::OffsiteReadOnly;
        let offsite_decision =
            evaluate_clinical_patient_access(&offsite, &patient, &evidence, Utc::now())
                .expect("offsite workflow evidence grants read-only chronicle access");
        assert!(offsite_decision.read_only);
        assert_eq!(
            require_clinical_write_access(&offsite, offsite.facility_id),
            Err(AccessError::OffsiteReadOnly)
        );
    }

    #[test]
    fn clinical_patient_access_accepts_active_break_glass_grant() {
        let ctx = make_ctx();
        let patient = patient(ctx.facility_id);
        let now = Utc::now();
        let grant = hms_domain::auth::BreakGlassGrant {
            id: Uuid::new_v4(),
            facility_id: ctx.facility_id,
            user_id: ctx.user_id,
            patient_id: patient.id,
            category: hms_domain::auth::BreakGlassCategory::LifeThreateningEmergency,
            reason_text: Some("airway compromise".to_owned()),
            started_at: now,
            expires_at: now + Duration::hours(2),
            ended_at: None,
        };
        let evidence = hms_domain::auth::ClinicalPatientAccessEvidence {
            workflow_reason: None,
            break_glass_grant: Some(grant),
        };

        let decision = evaluate_clinical_patient_access(&ctx, &patient, &evidence, now)
            .expect("active break-glass grant grants chronicle access");
        assert_eq!(
            decision.source,
            hms_domain::auth::ClinicalPatientAccessSource::BreakGlass
        );
        assert_eq!(
            decision.reason,
            hms_domain::auth::ClinicalPatientAccessReason::BreakGlassEmergency
        );
        assert!(!decision.read_only);
    }
}
