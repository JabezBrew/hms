use std::ops::Deref;

use chrono::{DateTime, Duration, Utc};
use hms_domain::auth::{AuthUser, PatientDataVisibility};
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

    pub fn has_permission(&self, permission: PermissionCode) -> bool {
        self.permissions.contains(&permission)
    }

    pub fn has_feature(&self, feature: FeatureKey) -> bool {
        self.enabled_features.contains(&feature)
    }

    pub fn has_patient_visibility(&self, visibility: PatientDataVisibility) -> bool {
        self.patient_visibility.contains(&visibility)
    }
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

    fn has_feature(&self, feature: FeatureKey) -> bool {
        self.enabled_features().contains(&feature)
    }

    fn has_permission(&self, permission: PermissionCode) -> bool {
        self.permissions().contains(&permission)
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
    #[error("offsite context is read only")]
    OffsiteReadOnly,
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
    require_auth(ctx)?;
    require_facility(ctx, facility_id)?;
    require_permission(ctx, permission)
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
    require_permission(ctx, PermissionCode::PatientDemographicsView)?;
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
    require_facility_permission(ctx, facility_id, permission)?;
    require_permission(ctx, PermissionCode::PatientDemographicsView)?;
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
        PermissionCode::WardView | PermissionCode::WardManageBeds => Some(FeatureKey::Wards),
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
    )
}

pub fn require_chronicle_read_access(ctx: &RequestContext) -> Result<(), AccessError> {
    require_permission(ctx, PermissionCode::PatientDemographicsView)?;
    require_permission(ctx, PermissionCode::ClinicalDocumentationView)
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
    require_permission(ctx, PermissionCode::PatientUpdate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ctx() -> RequestContext {
        let facility_id = Uuid::new_v4();
        let user = AuthUser {
            id: Uuid::new_v4(),
            email: "doctor@hms.local".to_owned(),
            display_name: "Doctor".to_owned(),
            facility_id,
            facility_code: "HMS".to_owned(),
            active_profile: DeploymentProfile::Hospital,
            permissions: vec![
                PermissionCode::PatientDemographicsView,
                PermissionCode::BillingView,
                PermissionCode::LaboratoryOrderManage,
                PermissionCode::InventoryView,
                PermissionCode::AdminAuthorityManage,
            ],
            features: vec![],
            patient_visibility: vec![
                PatientDataVisibility::Demographics,
                PatientDataVisibility::Billing,
            ],
            session_version: 1,
            permission_version: 1,
            password_change_required: false,
        };
        RequestContext::new(
            "request-1".to_owned(),
            Uuid::new_v4(),
            user,
            vec![
                FeatureKey::Patients,
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
            created_at: Utc::now(),
            updated_at: Utc::now(),
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
}
