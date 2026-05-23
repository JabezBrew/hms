use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::deployment::{
    DeploymentProfile, FeatureKey, NavigationGroup, NavigationItem, NavigationManifest,
    PermissionCode,
};

pub const ALL_PROFILES: [DeploymentProfile; 8] = [
    DeploymentProfile::ChpsCompound,
    DeploymentProfile::HealthCenter,
    DeploymentProfile::Clinic,
    DeploymentProfile::Hospital,
    DeploymentProfile::DistrictHospital,
    DeploymentProfile::RegionalHospital,
    DeploymentProfile::TeachingHospital,
    DeploymentProfile::HospitalNetwork,
];

pub const ALL_FEATURES: [FeatureKey; 14] = [
    FeatureKey::Patients,
    FeatureKey::Appointments,
    FeatureKey::Encounters,
    FeatureKey::Billing,
    FeatureKey::Nhis,
    FeatureKey::Wards,
    FeatureKey::Admissions,
    FeatureKey::Nursing,
    FeatureKey::Laboratory,
    FeatureKey::Pharmacy,
    FeatureKey::Inventory,
    FeatureKey::Referrals,
    FeatureKey::Dashboards,
    FeatureKey::Admin,
];

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DeploymentCapabilities {
    pub deployment_profile: DeploymentProfile,
    pub profile_label: String,
    pub facility_id: Uuid,
    pub facility_code: String,
    pub features: HashMap<FeatureKey, bool>,
    pub capabilities: HashMap<String, bool>,
    pub permissions: Vec<PermissionCode>,
    pub terminology: HashMap<String, String>,
    pub navigation: NavigationManifest,
}

pub fn deployment_capabilities(
    profile: DeploymentProfile,
    facility_id: Uuid,
    facility_code: &str,
) -> DeploymentCapabilities {
    let features = feature_flags_for_profile(profile);
    deployment_capabilities_from_features(profile, facility_id, facility_code, features)
}

pub fn deployment_capabilities_from_features(
    profile: DeploymentProfile,
    facility_id: Uuid,
    facility_code: &str,
    features: HashMap<FeatureKey, bool>,
) -> DeploymentCapabilities {
    let mut permissions = base_permissions();
    permissions.extend(permissions_for_features(&features));
    DeploymentCapabilities {
        deployment_profile: profile,
        profile_label: profile_label(profile).to_owned(),
        facility_id,
        facility_code: facility_code.to_owned(),
        features: features.clone(),
        capabilities: operational_capabilities_for_profile(profile),
        permissions,
        terminology: terminology_for_profile(profile),
        navigation: navigation_for_features(&features),
    }
}

fn operational_capabilities_for_profile(profile: DeploymentProfile) -> HashMap<String, bool> {
    let mut capabilities = HashMap::new();
    let multi_facility = matches!(profile, DeploymentProfile::HospitalNetwork);
    capabilities.insert("facility_switcher".to_owned(), multi_facility);
    capabilities.insert("multi_facility_mode".to_owned(), multi_facility);
    capabilities.insert(
        "outpatient_requires_active_clinic_schedule".to_owned(),
        false,
    );
    capabilities
}

pub fn enabled_features_for_profile(profile: DeploymentProfile) -> Vec<FeatureKey> {
    feature_flags_for_profile(profile)
        .into_iter()
        .filter_map(|(feature, enabled)| enabled.then_some(feature))
        .collect()
}

pub fn permissions_for_profile(profile: DeploymentProfile) -> Vec<PermissionCode> {
    let mut permissions = base_permissions();
    let features = feature_flags_for_profile(profile);
    permissions.extend(permissions_for_features(&features));
    permissions
}

fn base_permissions() -> Vec<PermissionCode> {
    vec![
        PermissionCode::AuthMeView,
        PermissionCode::SystemDeploymentCapabilitiesView,
        PermissionCode::PatientDemographicsView,
        PermissionCode::PatientCreate,
        PermissionCode::PatientUpdate,
    ]
}

fn permissions_for_features(features: &HashMap<FeatureKey, bool>) -> Vec<PermissionCode> {
    let mut permissions = Vec::new();
    if enabled(&features, FeatureKey::Patients) {
        permissions.push(PermissionCode::ConsentManage);
        permissions.push(PermissionCode::PatientBreakGlassInvoke);
    }
    if enabled(&features, FeatureKey::Appointments) {
        permissions.extend([
            PermissionCode::AppointmentView,
            PermissionCode::AppointmentManage,
        ]);
    }
    if enabled(&features, FeatureKey::Encounters) {
        permissions.extend([
            PermissionCode::EncounterView,
            PermissionCode::EncounterManage,
        ]);
    }
    if enabled(&features, FeatureKey::Wards) {
        permissions.extend([PermissionCode::WardView, PermissionCode::WardManageBeds]);
    }
    if enabled(&features, FeatureKey::Admissions) {
        permissions.push(PermissionCode::AdmissionManage);
    }
    if enabled(&features, FeatureKey::Nursing) {
        permissions.push(PermissionCode::NursingTaskManage);
    }
    if enabled(&features, FeatureKey::Encounters) {
        permissions.extend([
            PermissionCode::ClinicalDocumentationView,
            PermissionCode::ClinicalDocumentationManage,
        ]);
    }
    if enabled(&features, FeatureKey::Laboratory) {
        permissions.extend([
            PermissionCode::LaboratoryOrderManage,
            PermissionCode::LaboratoryResultVerify,
        ]);
    }
    if enabled(&features, FeatureKey::Inventory) {
        permissions.extend([
            PermissionCode::InventoryView,
            PermissionCode::InventoryManage,
        ]);
    }
    if enabled(&features, FeatureKey::Pharmacy) {
        permissions.push(PermissionCode::PharmacyDispense);
    }
    if enabled(&features, FeatureKey::Inventory) && enabled(&features, FeatureKey::Pharmacy) {
        permissions.push(PermissionCode::ControlledSubstanceManage);
    }
    if enabled(&features, FeatureKey::Billing) {
        permissions.extend([PermissionCode::BillingView, PermissionCode::BillingManage]);
    }
    if enabled(&features, FeatureKey::Nhis) {
        permissions.push(PermissionCode::NhisClaimManage);
    }
    if enabled(&features, FeatureKey::Referrals) {
        permissions.push(PermissionCode::ReferralManage);
    }
    if enabled(&features, FeatureKey::Admin) {
        permissions.push(PermissionCode::AdminAuthorityManage);
        permissions.push(PermissionCode::AdminFeatureEntitlementsManage);
        permissions.push(PermissionCode::AdminStaffManage);
        permissions.push(PermissionCode::SystemOpsView);
    }
    if enabled(&features, FeatureKey::Dashboards) {
        permissions.push(PermissionCode::DashboardView);
        permissions.push(PermissionCode::NotificationView);
    }

    permissions
}

pub fn feature_flags_for_profile(profile: DeploymentProfile) -> HashMap<FeatureKey, bool> {
    let enabled_features: &[FeatureKey] = match profile {
        DeploymentProfile::ChpsCompound => &[
            FeatureKey::Patients,
            FeatureKey::Appointments,
            FeatureKey::Encounters,
            FeatureKey::Pharmacy,
            FeatureKey::Inventory,
            FeatureKey::Referrals,
            FeatureKey::Dashboards,
        ],
        DeploymentProfile::HealthCenter | DeploymentProfile::Clinic => &[
            FeatureKey::Patients,
            FeatureKey::Appointments,
            FeatureKey::Encounters,
            FeatureKey::Billing,
            FeatureKey::Nhis,
            FeatureKey::Laboratory,
            FeatureKey::Pharmacy,
            FeatureKey::Inventory,
            FeatureKey::Referrals,
            FeatureKey::Dashboards,
            FeatureKey::Admin,
        ],
        DeploymentProfile::Hospital
        | DeploymentProfile::DistrictHospital
        | DeploymentProfile::RegionalHospital
        | DeploymentProfile::TeachingHospital
        | DeploymentProfile::HospitalNetwork => &ALL_FEATURES,
    };

    ALL_FEATURES
        .into_iter()
        .map(|feature| (feature, enabled_features.contains(&feature)))
        .collect()
}

fn navigation_for_features(features: &HashMap<FeatureKey, bool>) -> NavigationManifest {
    let mut groups = Vec::new();

    if enabled(features, FeatureKey::Patients) {
        groups.push(NavigationGroup {
            key: "registry".to_owned(),
            label: "Registry".to_owned(),
            items: vec![
                nav_item(
                    "patients",
                    "Patients",
                    "/v2/patients",
                    FeatureKey::Patients,
                    PermissionCode::PatientDemographicsView,
                ),
                nav_item(
                    "consents",
                    "Consents",
                    "/v2/consents",
                    FeatureKey::Patients,
                    PermissionCode::ConsentManage,
                ),
            ],
        });
    }

    let mut care_items = Vec::new();
    if enabled(features, FeatureKey::Appointments) {
        care_items.push(nav_item(
            "appointments",
            "Appointments",
            "/v2/appointments",
            FeatureKey::Appointments,
            PermissionCode::AppointmentView,
        ));
    }
    if enabled(features, FeatureKey::Encounters) {
        care_items.push(nav_item(
            "encounters",
            "Encounters",
            "/v2/encounters",
            FeatureKey::Encounters,
            PermissionCode::EncounterView,
        ));
    }
    if enabled(features, FeatureKey::Referrals) {
        care_items.push(nav_item(
            "referrals",
            "Referrals",
            "/v2/referrals",
            FeatureKey::Referrals,
            PermissionCode::ReferralManage,
        ));
    }
    if !care_items.is_empty() {
        groups.push(NavigationGroup {
            key: "care".to_owned(),
            label: "Care".to_owned(),
            items: care_items,
        });
    }

    let mut inpatient_items = Vec::new();
    if enabled(features, FeatureKey::Wards) {
        inpatient_items.push(nav_item(
            "wards",
            "Wards",
            "/v2/wards",
            FeatureKey::Wards,
            PermissionCode::WardView,
        ));
    }
    if enabled(features, FeatureKey::Admissions) {
        inpatient_items.push(nav_item(
            "admissions",
            "Admissions",
            "/v2/admissions",
            FeatureKey::Admissions,
            PermissionCode::AdmissionManage,
        ));
    }
    if enabled(features, FeatureKey::Nursing) {
        inpatient_items.push(nav_item(
            "nursing",
            "Nursing",
            "/v2/nursing",
            FeatureKey::Nursing,
            PermissionCode::NursingTaskManage,
        ));
    }
    if !inpatient_items.is_empty() {
        groups.push(NavigationGroup {
            key: "inpatient".to_owned(),
            label: "Inpatient".to_owned(),
            items: inpatient_items,
        });
    }

    let mut operations_items = Vec::new();
    if enabled(features, FeatureKey::Laboratory) {
        operations_items.push(nav_item(
            "laboratory",
            "Laboratory",
            "/v2/laboratory",
            FeatureKey::Laboratory,
            PermissionCode::LaboratoryOrderManage,
        ));
    }
    if enabled(features, FeatureKey::Pharmacy) {
        operations_items.push(nav_item(
            "pharmacy",
            "Pharmacy",
            "/v2/pharmacy",
            FeatureKey::Pharmacy,
            PermissionCode::PharmacyDispense,
        ));
    }
    if enabled(features, FeatureKey::Inventory) {
        operations_items.push(nav_item(
            "inventory",
            "Inventory",
            "/v2/inventory",
            FeatureKey::Inventory,
            PermissionCode::InventoryView,
        ));
    }
    if !operations_items.is_empty() {
        groups.push(NavigationGroup {
            key: "operations".to_owned(),
            label: "Operations".to_owned(),
            items: operations_items,
        });
    }

    let mut finance_items = Vec::new();
    if enabled(features, FeatureKey::Billing) {
        finance_items.push(nav_item(
            "billing",
            "Billing",
            "/v2/billing",
            FeatureKey::Billing,
            PermissionCode::BillingView,
        ));
    }
    if enabled(features, FeatureKey::Nhis) {
        finance_items.push(nav_item(
            "nhis",
            "NHIS",
            "/v2/nhis",
            FeatureKey::Nhis,
            PermissionCode::NhisClaimManage,
        ));
    }
    if !finance_items.is_empty() {
        groups.push(NavigationGroup {
            key: "finance".to_owned(),
            label: "Finance".to_owned(),
            items: finance_items,
        });
    }

    if enabled(features, FeatureKey::Admin) {
        groups.push(NavigationGroup {
            key: "admin".to_owned(),
            label: "Admin".to_owned(),
            items: vec![
                nav_item(
                    "authority",
                    "Authority",
                    "/v2/admin/authority",
                    FeatureKey::Admin,
                    PermissionCode::AdminAuthorityManage,
                ),
                nav_item(
                    "staff",
                    "Staff",
                    "/v2/admin/staff",
                    FeatureKey::Admin,
                    PermissionCode::AdminStaffManage,
                ),
            ],
        });
    }

    NavigationManifest { groups }
}

fn terminology_for_profile(profile: DeploymentProfile) -> HashMap<String, String> {
    let service_line_label = match profile {
        DeploymentProfile::TeachingHospital => "Sub-BMC",
        DeploymentProfile::RegionalHospital | DeploymentProfile::Hospital => "Directorate",
        _ => "Service Line",
    };

    [("service_line".to_owned(), service_line_label.to_owned())]
        .into_iter()
        .collect()
}

pub fn profile_label(profile: DeploymentProfile) -> &'static str {
    match profile {
        DeploymentProfile::ChpsCompound => "CHPS Compound",
        DeploymentProfile::HealthCenter => "Health Center",
        DeploymentProfile::Clinic => "Clinic",
        DeploymentProfile::Hospital => "Hospital",
        DeploymentProfile::DistrictHospital => "District Hospital",
        DeploymentProfile::RegionalHospital => "Regional Hospital",
        DeploymentProfile::TeachingHospital => "Teaching Hospital",
        DeploymentProfile::HospitalNetwork => "Hospital Network",
    }
}

fn nav_item(
    key: &str,
    label: &str,
    path: &str,
    feature: FeatureKey,
    permission: PermissionCode,
) -> NavigationItem {
    NavigationItem {
        key: key.to_owned(),
        label: label.to_owned(),
        path: path.to_owned(),
        feature,
        permission,
    }
}

fn enabled(features: &HashMap<FeatureKey, bool>, feature: FeatureKey) -> bool {
    features.get(&feature).copied().unwrap_or(false)
}
