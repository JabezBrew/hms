//! Governed current inventory configuration, distinct from clinical/physical stock.
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OrdinaryInventoryItemType {
    Medication,
    Supply,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateInventoryItemRequest {
    pub client_request_id: Uuid,
    pub category_id: Uuid,
    pub code: String,
    pub name: String,
    pub unit: String,
    pub item_type: OrdinaryInventoryItemType,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryItemLifecycleRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
}
#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in=Query)]
pub struct InventoryItemAdministrationQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}
#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in=Query)]
pub struct InventoryItemHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}
#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[into_params(parameter_in=Query)]
pub struct InventoryCategoriesQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryItemCategory {
    pub id: Uuid,
    pub code: String,
    pub name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct GovernedInventoryItem {
    pub id: Uuid,
    pub category_id: Uuid,
    pub category: Option<InventoryItemCategory>,
    pub code: String,
    pub name: String,
    pub unit: String,
    pub item_type: String,
    pub controlled: bool,
    pub effective_controlled: bool,
    pub is_active: bool,
    pub version: i64,
    pub catalog_changed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InventoryItemEligibilityBlocker {
    ControlledOrUnsupported,
    OperationalReference,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryItemEligibility {
    pub unit_change_blocked_by: Option<InventoryItemEligibilityBlocker>,
    pub lifecycle_blocked_by: Option<InventoryItemEligibilityBlocker>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryItemAdministration {
    pub item: GovernedInventoryItem,
    pub eligibility: InventoryItemEligibility,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryItemProjection {
    pub code: String,
    pub name: String,
    pub unit: String,
    pub version: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryItemCorrectionRevision {
    pub id: Uuid,
    pub reviewed_effective_from: NaiveDate,
    pub recorded_at: DateTime<Utc>,
    pub before: InventoryItemProjection,
    pub after: InventoryItemProjection,
    pub projection_changed: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum InventoryItemReviewedInput {
    Create {
        client_request_id: Uuid,
        category_id: Uuid,
        code: String,
        name: String,
        unit: String,
        item_type: OrdinaryInventoryItemType,
    },
    Correct {
        client_request_id: Uuid,
        item_id: Uuid,
        expected_version: i64,
        effective_from: NaiveDate,
        code: String,
        name: String,
        unit: String,
        reason: String,
    },
    Retire {
        client_request_id: Uuid,
        item_id: Uuid,
        expected_version: i64,
    },
    Reactivate {
        client_request_id: Uuid,
        item_id: Uuid,
        expected_version: i64,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventoryItemCommandReceipt {
    pub client_request_id: Uuid,
    pub input_digest: String,
    pub reviewed_input: InventoryItemReviewedInput,
    pub recorded_by_user_id: Uuid,
    pub item: GovernedInventoryItem,
    pub changed: bool,
    pub recorded_at: DateTime<Utc>,
    pub correction_revision: Option<InventoryItemCorrectionRevision>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "source", rename_all = "snake_case", deny_unknown_fields)]
pub enum InventoryItemHistoryRow {
    LegacyDatedVersion {
        id: Uuid,
        effective_from: NaiveDate,
        effective_to: Option<NaiveDate>,
        code: String,
        name: String,
        unit: String,
        recorded_at: DateTime<Utc>,
        reason_present: bool,
    },
    GovernedCorrection {
        id: Uuid,
        reviewed_effective_from: NaiveDate,
        recorded_at: DateTime<Utc>,
        before: InventoryItemProjection,
        after: InventoryItemProjection,
        projection_changed: bool,
        reason_present: bool,
    },
}
impl InventoryItemHistoryRow {
    pub fn cursor_facts(&self) -> (DateTime<Utc>, u8, Uuid) {
        match self {
            Self::LegacyDatedVersion {
                id, recorded_at, ..
            } => (*recorded_at, 0, *id),
            Self::GovernedCorrection {
                id, recorded_at, ..
            } => (*recorded_at, 1, *id),
        }
    }
}
