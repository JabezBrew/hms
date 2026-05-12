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
    Fulfilled,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PurchaseOrderStatus {
    Draft,
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
    pub code: String,
    pub name: String,
    pub item_type: InventoryItemType,
    pub unit: String,
    pub controlled: bool,
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
    pub movement_type: ControlledMovementType,
    pub quantity_delta: i64,
    pub balance_after: i64,
    pub witness_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
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
