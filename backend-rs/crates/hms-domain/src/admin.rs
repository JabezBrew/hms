use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::deployment::{FeatureKey, PermissionCode};

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AdminListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AuditEventListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub category: Option<String>,
    pub action: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub ordering: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AuditEventListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub category: Option<String>,
    pub action: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub ordering: Option<String>,
}

impl From<AuditEventListGetQuery> for AuditEventListQuery {
    fn from(value: AuditEventListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            search: value.search,
            category: value.category,
            action: value.action,
            start_date: value.start_date,
            end_date: value.end_date,
            ordering: value.ordering,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct OrganizationUnitListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub unit_type: Option<OrgUnitType>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct StaffListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub practitioners_only: Option<bool>,
    pub department: Option<String>,
    pub position: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct StaffFilterFacetQuery {
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PractitionerListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct AdminLimitQuery {
    pub limit: Option<u8>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OrgUnitType {
    Facility,
    Department,
    Clinic,
    Ward,
    Service,
    Administrative,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PositionStatus {
    Active,
    Inactive,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityAppointmentStatus {
    Active,
    Revoked,
    Expired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PermissionAssignmentStatus {
    Active,
    Revoked,
    Expired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CommitteeStatus {
    Active,
    Inactive,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DelegationStatus {
    Active,
    Revoked,
    Expired,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OrganizationUnitListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub unit_type: OrgUnitType,
    pub parent_unit_id: Option<Uuid>,
    pub parent_unit_name: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateOrganizationUnitRequest {
    pub code: String,
    pub name: String,
    pub unit_type: OrgUnitType,
    pub parent_unit_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PositionTemplateListItem {
    pub id: Uuid,
    pub code: String,
    pub title: String,
    pub description: String,
    pub permission_codes: Vec<PermissionCode>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePositionTemplateRequest {
    pub code: String,
    pub title: String,
    pub description: String,
    pub permission_codes: Vec<PermissionCode>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PositionListItem {
    pub id: Uuid,
    pub code: String,
    pub title: String,
    pub org_unit_id: Uuid,
    pub org_unit_name: String,
    pub template_id: Option<Uuid>,
    pub status: PositionStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePositionRequest {
    pub code: String,
    pub title: String,
    pub org_unit_id: Uuid,
    pub template_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AuthorityAppointmentListItem {
    pub id: Uuid,
    pub position_id: Uuid,
    pub position_title: String,
    pub user_id: Uuid,
    pub user_display_name: String,
    pub appointment_type: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub status: AuthorityAppointmentStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateAuthorityAppointmentRequest {
    pub position_id: Uuid,
    pub user_id: Uuid,
    pub appointment_type: String,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PermissionAssignmentListItem {
    pub id: Uuid,
    pub grantee_user_id: Uuid,
    pub grantee_display_name: String,
    pub permission_code: PermissionCode,
    pub scope_type: String,
    pub scope_id: Option<Uuid>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub status: PermissionAssignmentStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FeatureEntitlementListItem {
    pub feature: FeatureKey,
    pub enabled: bool,
    pub profile_default: bool,
    pub override_enabled: Option<bool>,
    pub updated_at: Option<DateTime<Utc>>,
    pub updated_by_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateFeatureEntitlementRequest {
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PractitionerProfileSummary {
    pub id: Uuid,
    pub license_number: String,
    pub specialization: String,
    pub qualification: String,
    pub fhir_practitioner_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StaffListItem {
    pub id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub employee_id: String,
    pub department: String,
    pub position: String,
    pub hire_date: NaiveDate,
    pub is_active: bool,
    pub password_change_required: bool,
    pub session_version: i64,
    pub permission_version: i64,
    pub practitioner_profile: Option<PractitionerProfileSummary>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StaffDirectoryItem {
    pub user_id: Uuid,
    pub display_name: String,
    pub email: String,
    pub employee_id: String,
    pub department: String,
    pub position: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StaffFilterFacetOption {
    pub value: String,
    pub label: String,
    pub count: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StaffFilterFacets {
    pub departments: Vec<StaffFilterFacetOption>,
    pub positions: Vec<StaffFilterFacetOption>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PractitionerListItem {
    pub id: Uuid,
    pub staff_id: Uuid,
    pub user_id: Uuid,
    pub display_name: String,
    pub employee_id: String,
    pub license_number: String,
    pub specialization: String,
    pub qualification: String,
    pub fhir_practitioner_id: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpsertPractitionerProfileRequest {
    pub license_number: String,
    pub specialization: String,
    pub qualification: String,
    pub fhir_practitioner_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateStaffRequest {
    pub email: String,
    pub display_name: String,
    pub department: String,
    pub position: String,
    pub hire_date: NaiveDate,
    pub practitioner_profile: Option<UpsertPractitionerProfileRequest>,
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub employee_id: Option<String>,
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub temporary_password: Option<String>,
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub temp_password: Option<String>,
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub password: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct UpdateStaffRequest {
    pub display_name: Option<String>,
    pub department: Option<String>,
    pub position: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePermissionAssignmentRequest {
    pub grantee_user_id: Uuid,
    pub permission_code: PermissionCode,
    pub scope_type: String,
    pub scope_id: Option<Uuid>,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub reason_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CommitteeListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub mandate: String,
    pub status: CommitteeStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateCommitteeRequest {
    pub code: String,
    pub name: String,
    pub mandate: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DelegationListItem {
    pub id: Uuid,
    pub delegator_user_id: Uuid,
    pub delegator_display_name: String,
    pub delegate_user_id: Uuid,
    pub delegate_display_name: String,
    pub permission_code: PermissionCode,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub status: DelegationStatus,
    pub reason: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateDelegationRequest {
    pub delegator_user_id: Uuid,
    pub delegate_user_id: Uuid,
    pub permission_code: PermissionCode,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AuditEventListItem {
    pub id: Uuid,
    pub actor_user_id: Option<Uuid>,
    pub actor_display_name: Option<String>,
    pub request_id: Option<String>,
    pub event_type: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub occurred_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_event_get_query_preserves_search_filter() {
        let query = AuditEventListQuery::from(AuditEventListGetQuery {
            cursor: None,
            limit: Some(10),
            search: Some("delegation".to_owned()),
            category: Some("ADMIN".to_owned()),
            action: Some("CREATE".to_owned()),
            start_date: None,
            end_date: None,
            ordering: None,
        });

        assert_eq!(query.search.as_deref(), Some("delegation"));
        assert_eq!(query.category.as_deref(), Some("ADMIN"));
        assert_eq!(query.action.as_deref(), Some("CREATE"));
    }
}
