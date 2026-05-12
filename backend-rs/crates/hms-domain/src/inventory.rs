use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InventoryItemType {
    Medication,
    Supply,
    ControlledSubstance,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StockMovementType {
    Receipt,
    Adjustment,
    TransferOut,
    TransferIn,
    Dispense,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Requested,
    Completed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RequisitionStatus {
    Requested,
    Pending,
    Approved,
    Fulfilled,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PurchaseOrderStatus {
    Draft,
    Approved,
    Ordered,
    Closed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GoodsReceivedStatus {
    Received,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ControlledMovementType {
    Receipt,
    Dispense,
    Adjustment,
    Count,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DispenseStatus {
    Dispensed,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct InventoryCategoryListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct InventoryItemListItem {
    pub id: Uuid,
    pub category_id: Uuid,
    pub category_name: String,
    pub code: String,
    pub sku: String,
    pub name: String,
    pub item_type: InventoryItemType,
    pub unit: String,
    pub unit_of_measure: String,
    pub controlled: bool,
    pub is_controlled: bool,
    pub total_stock: i64,
    pub nearest_expiry: Option<NaiveDate>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StorageLocationListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StockBatchListItem {
    pub id: Uuid,
    pub item_id: Uuid,
    pub item_name: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub batch_number: String,
    pub expires_on: Option<NaiveDate>,
    pub quantity_on_hand: i64,
    pub received_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateStockBatchRequest {
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub batch_number: String,
    pub expires_on: Option<NaiveDate>,
    pub quantity_received: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StockMovementListItem {
    pub id: Uuid,
    pub item_id: Uuid,
    pub item_name: String,
    pub location_id: Uuid,
    pub movement_type: StockMovementType,
    pub quantity: i64,
    pub balance_after: i64,
    pub reason: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct InventoryItemStockLocationItem {
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub location_name: String,
    pub quantity_on_hand: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StorageLocationStockItem {
    pub item_id: Uuid,
    pub item_name: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub quantity_on_hand: i64,
    pub batch_count: i64,
    pub earliest_expiry: Option<NaiveDate>,
    pub last_received_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StockTransferListItem {
    pub id: Uuid,
    pub item_id: Uuid,
    pub item_name: String,
    pub from_location_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: i64,
    pub status: TransferStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateStockTransferRequest {
    pub item_id: Uuid,
    pub from_location_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct StockRequisitionListItem {
    pub id: Uuid,
    pub requesting_location_id: Uuid,
    pub requesting_location_name: String,
    pub status: RequisitionStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateStockRequisitionRequest {
    pub requesting_location_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PurchaseOrderListItem {
    pub id: Uuid,
    pub supplier_name: String,
    pub status: PurchaseOrderStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePurchaseOrderRequest {
    pub supplier_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct GoodsReceivedNoteListItem {
    pub id: Uuid,
    pub purchase_order_id: Uuid,
    pub supplier_name: String,
    pub status: GoodsReceivedStatus,
    pub received_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateGoodsReceivedNoteRequest {
    pub purchase_order_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ControlledSubstanceRegisterItem {
    pub id: Uuid,
    pub item_id: Uuid,
    pub item_name: String,
    pub location_id: Uuid,
    pub location_name: String,
    pub movement_type: ControlledMovementType,
    pub quantity_delta: i64,
    pub balance_after: i64,
    pub current_balance: i64,
    pub unit_of_measure: String,
    pub entry_count: i64,
    pub total_dispensed: i64,
    pub total_received: i64,
    pub total_wastage: i64,
    pub has_discrepancy: bool,
    pub discrepancy_count: i64,
    pub witness_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ControlledSubstanceRegisterEntryItem {
    pub id: Uuid,
    pub entry_number: i64,
    pub entry_type: ControlledMovementType,
    pub quantity: i64,
    pub balance_before: i64,
    pub balance_after: i64,
    pub witness_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ControlledSubstanceBalanceValidation {
    pub register_id: Uuid,
    pub current_balance: i64,
    pub computed_balance: i64,
    pub valid: bool,
    pub checked_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateControlledSubstanceMovementRequest {
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub movement_type: ControlledMovementType,
    pub quantity_delta: i64,
    pub witness_user_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateControlledSubstanceCountRequest {
    pub actual_count: i64,
    pub witness_user_id: Option<Uuid>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PharmacyDispenseListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub item_id: Uuid,
    pub item_name: String,
    pub location_id: Uuid,
    pub quantity: i64,
    pub status: DispenseStatus,
    pub dispensed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePharmacyDispenseRequest {
    pub patient_id: Uuid,
    pub item_id: Uuid,
    pub location_id: Uuid,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct InventoryListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, IntoParams, ToSchema)]
pub struct InventoryItemsQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub category: Option<Uuid>,
    pub location: Option<Uuid>,
    pub status: Option<String>,
}
