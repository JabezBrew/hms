use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentProfile {
    ChpsCompound,
    HealthCenter,
    Clinic,
    Hospital,
    DistrictHospital,
    RegionalHospital,
    TeachingHospital,
    HospitalNetwork,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum FeatureKey {
    Patients,
    Appointments,
    Encounters,
    Billing,
    Nhis,
    Wards,
    Admissions,
    Nursing,
    Laboratory,
    Pharmacy,
    Inventory,
    Referrals,
    Dashboards,
    Admin,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, ToSchema)]
pub enum PermissionCode {
    #[serde(rename = "auth.me.view")]
    AuthMeView,
    #[serde(rename = "system.deployment_capabilities.view")]
    SystemDeploymentCapabilitiesView,
    #[serde(rename = "patient.demographics.view")]
    PatientDemographicsView,
    #[serde(rename = "patient.create")]
    PatientCreate,
    #[serde(rename = "patient.update")]
    PatientUpdate,
    #[serde(rename = "patient.break_glass.invoke")]
    PatientBreakGlassInvoke,
    #[serde(rename = "appointment.view")]
    AppointmentView,
    #[serde(rename = "appointment.manage")]
    AppointmentManage,
    #[serde(rename = "encounter.view")]
    EncounterView,
    #[serde(rename = "encounter.manage")]
    EncounterManage,
    #[serde(rename = "ward.view")]
    WardView,
    #[serde(rename = "ward.manage_beds")]
    WardManageBeds,
    #[serde(rename = "admission.manage")]
    AdmissionManage,
    #[serde(rename = "nursing.task.manage")]
    NursingTaskManage,
    #[serde(rename = "clinical_documentation.view")]
    ClinicalDocumentationView,
    #[serde(rename = "clinical_documentation.manage")]
    ClinicalDocumentationManage,
    #[serde(rename = "laboratory.order.manage")]
    LaboratoryOrderManage,
    #[serde(rename = "laboratory.result.verify")]
    LaboratoryResultVerify,
    #[serde(rename = "inventory.view")]
    InventoryView,
    #[serde(rename = "inventory.manage")]
    InventoryManage,
    #[serde(rename = "controlled_substance.manage")]
    ControlledSubstanceManage,
    #[serde(rename = "pharmacy.dispense")]
    PharmacyDispense,
    #[serde(rename = "billing.view")]
    BillingView,
    #[serde(rename = "billing.manage")]
    BillingManage,
    #[serde(rename = "nhis.claim.manage")]
    NhisClaimManage,
    #[serde(rename = "referral.manage")]
    ReferralManage,
    #[serde(rename = "consent.manage")]
    ConsentManage,
    #[serde(rename = "admin.authority.manage")]
    AdminAuthorityManage,
    #[serde(rename = "admin.feature_entitlements.manage")]
    AdminFeatureEntitlementsManage,
    #[serde(rename = "admin.staff.manage")]
    AdminStaffManage,
    #[serde(rename = "dashboard.view")]
    DashboardView,
    #[serde(rename = "notification.view")]
    NotificationView,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NavigationGroup {
    pub key: String,
    pub label: String,
    pub items: Vec<NavigationItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NavigationItem {
    pub key: String,
    pub label: String,
    pub path: String,
    pub feature: FeatureKey,
    pub permission: PermissionCode,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NavigationManifest {
    pub groups: Vec<NavigationGroup>,
}
