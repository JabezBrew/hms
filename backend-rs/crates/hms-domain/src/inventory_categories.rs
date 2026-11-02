//! Governed category metadata; parent pointers imply no inherited item meaning.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryCategoryParentSelection {
    pub parent_id: Uuid,
    pub expected_parent_version: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum InventoryCategoryParentChange {
    Retain,
    Clear,
    Set {
        parent_id: Uuid,
        expected_parent_version: i64,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateInventoryCategoryRequest {
    pub client_request_id: Uuid,
    pub code: String,
    pub name: String,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub description: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub parent: Option<InventoryCategoryParentSelection>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CorrectInventoryCategoryRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub name: String,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub description: Option<String>,
    pub parent_change: InventoryCategoryParentChange,
    pub reason: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryCategoryLifecycleRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
}
#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in=Query)]
pub struct InventoryCategoryAdministrationQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}
#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in=Query)]
pub struct InventoryCategoryHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryCategoryParent {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub version: i64,
    pub is_active: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct GovernedInventoryCategory {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub description: Option<String>,
    pub parent_id: Option<Uuid>,
    pub parent: Option<InventoryCategoryParent>,
    pub is_active: bool,
    pub version: i64,
    pub catalog_changed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub created_by_user_id: Option<Uuid>,
    pub updated_by_user_id: Option<Uuid>,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InventoryCategoryEligibilityBlocker {
    ItemReference,
    ChildReference,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryCategoryEligibility {
    pub lifecycle_blocked_by: Option<InventoryCategoryEligibilityBlocker>,
    pub parent_unavailable: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryCategoryAdministration {
    pub category: GovernedInventoryCategory,
    pub eligibility: InventoryCategoryEligibility,
}
/// Bounded administration metadata; descriptions and actor provenance require detail.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryCategoryAdministrationListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub version: i64,
    pub parent_id: Option<Uuid>,
    pub catalog_changed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum InventoryCategoryReviewedInput {
    Create {
        client_request_id: Uuid,
        code: String,
        name: String,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        description: Option<String>,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        parent: Option<InventoryCategoryParentSelection>,
    },
    Correct {
        client_request_id: Uuid,
        category_id: Uuid,
        expected_version: i64,
        name: String,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        description: Option<String>,
        parent_change: InventoryCategoryParentChange,
        reason: String,
    },
    Retire {
        client_request_id: Uuid,
        category_id: Uuid,
        expected_version: i64,
    },
    Reactivate {
        client_request_id: Uuid,
        category_id: Uuid,
        expected_version: i64,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryCategoryCommandReceipt {
    pub client_request_id: Uuid,
    pub input_digest: String,
    pub reviewed_input: InventoryCategoryReviewedInput,
    pub recorded_by_user_id: Uuid,
    pub category: GovernedInventoryCategory,
    pub changed: bool,
    pub recorded_at: DateTime<Utc>,
    pub before: Option<GovernedInventoryCategory>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryCategoryHistoryRow {
    pub id: Uuid,
    pub action: String,
    pub recorded_at: DateTime<Utc>,
    pub before_version: Option<i64>,
    pub after_version: i64,
    pub name_changed: bool,
    pub description_changed: bool,
    pub parent_changed: bool,
    pub active_changed: bool,
}

fn required_nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}
