//! Governed supplier metadata; purchase-order names are separate observations.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateInventorySupplierRequest {
    pub client_request_id: Uuid,
    pub code: String,
    pub name: String,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub contact_name: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub phone: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub email: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub address: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CorrectInventorySupplierRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
    pub name: String,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub contact_name: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub phone: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub email: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub address: Option<String>,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventorySupplierLifecycleRequest {
    pub client_request_id: Uuid,
    pub expected_version: i64,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in=Query)]
pub struct InventorySupplierAdministrationQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in=Query)]
pub struct InventorySupplierHistoryQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}

/// Exact authorized current metadata. Historical unknown provenance stays null.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct GovernedInventorySupplier {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub contact_name: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub phone: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub email: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub address: Option<String>,
    pub is_active: bool,
    pub version: i64,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub catalog_changed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub created_by_user_id: Option<Uuid>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub updated_by_user_id: Option<Uuid>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InventorySupplierEligibilityBlocker {
    ItemReference,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventorySupplierEligibility {
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub lifecycle_blocked_by: Option<InventorySupplierEligibilityBlocker>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventorySupplierAdministration {
    pub supplier: GovernedInventorySupplier,
    pub eligibility: InventorySupplierEligibility,
}

/// Directory metadata contains no contact/address values or actor attribution.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventorySupplierAdministrationListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub version: i64,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub catalog_changed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum InventorySupplierReviewedInput {
    Create {
        client_request_id: Uuid,
        code: String,
        name: String,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        contact_name: Option<String>,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        phone: Option<String>,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        email: Option<String>,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        address: Option<String>,
    },
    Correct {
        client_request_id: Uuid,
        supplier_id: Uuid,
        expected_version: i64,
        name: String,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        contact_name: Option<String>,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        phone: Option<String>,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        email: Option<String>,
        #[serde(deserialize_with = "required_nullable")]
        #[schema(required = true)]
        address: Option<String>,
        reason: String,
    },
    Retire {
        client_request_id: Uuid,
        supplier_id: Uuid,
        expected_version: i64,
    },
    Reactivate {
        client_request_id: Uuid,
        supplier_id: Uuid,
        expected_version: i64,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventorySupplierCommandReceipt {
    pub client_request_id: Uuid,
    pub input_digest: String,
    pub reviewed_input: InventorySupplierReviewedInput,
    pub recorded_by_user_id: Uuid,
    pub supplier: GovernedInventorySupplier,
    pub changed: bool,
    pub recorded_at: DateTime<Utc>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub before: Option<GovernedInventorySupplier>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InventorySupplierHistoryRow {
    pub id: Uuid,
    pub action: String,
    pub recorded_at: DateTime<Utc>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub before_version: Option<i64>,
    pub after_version: i64,
    pub name_changed: bool,
    pub contact_name_changed: bool,
    pub phone_changed: bool,
    pub email_changed: bool,
    pub address_changed: bool,
    pub active_changed: bool,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}
