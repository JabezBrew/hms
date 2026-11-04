//! Governed availability observations; these are not definition revisions.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabCatalogKind {
    Test,
    Panel,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LaboratoryCatalogAction {
    SetAvailability,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LaboratoryCatalogOrderingBlocker {
    Inactive,
    EmptyPanel,
    UnavailableMembers,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LaboratoryCatalogOrdering {
    pub is_orderable: bool,
    pub blocked_by: Option<LaboratoryCatalogOrderingBlocker>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LaboratoryCatalogAdministrationListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub version: i64,
    pub catalog_changed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LaboratoryTestAdministrationDefinition {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub category: Option<String>,
    pub specimen_type: String,
    pub result_unit: Option<String>,
    pub is_active: bool,
    pub is_system_default: bool,
    pub is_facility_modified: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i64,
    pub catalog_changed_at: Option<DateTime<Utc>>,
    pub catalog_changed_by_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LaboratoryPanelAdministrationDefinition {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub is_system_default: bool,
    pub is_facility_modified: bool,
    pub test_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i64,
    pub catalog_changed_at: Option<DateTime<Utc>>,
    pub catalog_changed_by_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LaboratoryCatalogAdministration {
    Test {
        definition: LaboratoryTestAdministrationDefinition,
        ordering: LaboratoryCatalogOrdering,
    },
    Panel {
        definition: LaboratoryPanelAdministrationDefinition,
        ordering: LaboratoryCatalogOrdering,
    },
}

impl LaboratoryCatalogAdministration {
    pub fn id(&self) -> Uuid {
        match self {
            Self::Test { definition, .. } => definition.id,
            Self::Panel { definition, .. } => definition.id,
        }
    }
    pub fn version(&self) -> i64 {
        match self {
            Self::Test { definition, .. } => definition.version,
            Self::Panel { definition, .. } => definition.version,
        }
    }
    pub fn is_active(&self) -> bool {
        match self {
            Self::Test { definition, .. } => definition.is_active,
            Self::Panel { definition, .. } => definition.is_active,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SetLaboratoryAvailabilityRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub is_active: bool,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LaboratoryCatalogReviewedInput {
    pub action: LaboratoryCatalogAction,
    pub subject_kind: LabCatalogKind,
    pub subject_id: Uuid,
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub is_active: bool,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LaboratoryCatalogCommandReceipt {
    pub command_id: Uuid,
    pub client_request_id: Uuid,
    pub input_digest: String,
    pub reviewed_input: LaboratoryCatalogReviewedInput,
    pub subject: LaboratoryCatalogAdministration,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by_user_id: Uuid,
    pub changed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct LaboratoryCatalogHistoryItem {
    pub id: Uuid,
    pub action: LaboratoryCatalogAction,
    pub recorded_at: DateTime<Utc>,
    pub before_version: i64,
    pub after_version: i64,
    pub before_is_active: bool,
    pub after_is_active: bool,
    pub changed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct LaboratoryTestAdministrationQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub category: Option<String>,
    pub is_active: Option<bool>,
    pub is_system_default: Option<bool>,
    pub is_facility_modified: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct LaboratoryPanelAdministrationQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub is_system_default: Option<bool>,
    pub is_facility_modified: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct LaboratoryCatalogHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
