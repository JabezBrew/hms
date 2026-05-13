use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ServiceKind {
    Consultation,
    Laboratory,
    Pharmacy,
    Procedure,
    Admission,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BillingRuleType {
    CashRequired,
    NhisCovered,
    CoPay,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceStatus {
    Issued,
    PartiallyPaid,
    Paid,
    Void,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    Cash,
    MobileMoney,
    Card,
    BankTransfer,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PaymentStatus {
    Recorded,
    Void,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Draft,
    Ready,
    Submitted,
    Remitted,
    Rejected,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NhisBatchStatus {
    Draft,
    Exported,
    Submitted,
    Remitted,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RemittanceImportStatus {
    Imported,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CashSessionStatus {
    Open,
    Closed,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct BillingListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct CashSessionListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<CashSessionStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ServiceCatalogItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub service_kind: ServiceKind,
    pub active: bool,
    pub active_price_id: Option<Uuid>,
    pub active_price_amount_minor: Option<i64>,
    pub active_price_currency: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ServicePriceListItem {
    pub id: Uuid,
    pub service_id: Uuid,
    pub service_code: String,
    pub service_name: String,
    pub amount_minor: i64,
    pub currency: String,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct ServiceCatalogQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BillingRuleListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub rule_type: BillingRuleType,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BillingDashboardSummary {
    pub revenue_today_minor: i64,
    pub revenue_this_week_minor: i64,
    pub outstanding_amount_minor: i64,
    pub outstanding_invoices: i64,
    pub pending_claims: i64,
    pub pending_claims_amount_minor: i64,
    pub invoices_created_today: i64,
    pub payments_received_today: i64,
    pub unique_patients_billed: i64,
    pub average_invoice_amount_minor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct InvoiceListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub invoice_number: String,
    pub status: InvoiceStatus,
    pub gross_amount_minor: i64,
    pub paid_amount_minor: i64,
    pub balance_minor: i64,
    pub currency: String,
    pub issued_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateInvoiceRequest {
    pub patient_id: Uuid,
    pub service_price_id: Uuid,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PaymentListItem {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub receipt_number: String,
    pub amount_minor: i64,
    pub currency: String,
    pub method: PaymentMethod,
    pub status: PaymentStatus,
    pub paid_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreatePaymentRequest {
    pub invoice_id: Uuid,
    pub amount_minor: i64,
    pub method: PaymentMethod,
    pub cash_session_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReceiptListItem {
    pub id: Uuid,
    pub payment_id: Uuid,
    pub invoice_id: Uuid,
    pub receipt_number: String,
    pub amount_minor: i64,
    pub currency: String,
    pub issued_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ClaimListItem {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub claim_number: String,
    pub status: ClaimStatus,
    pub amount_minor: i64,
    pub currency: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateClaimRequest {
    pub invoice_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NhisBatchListItem {
    pub id: Uuid,
    pub batch_number: String,
    pub status: NhisBatchStatus,
    pub claim_count: i64,
    pub total_amount_minor: i64,
    pub currency: String,
    pub exported_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateNhisBatchRequest {
    pub claim_ids: Vec<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NhisBatchExport {
    pub batch_id: Uuid,
    pub batch_number: String,
    pub export_format: String,
    pub claim_count: i64,
    pub total_amount_minor: i64,
    pub checksum: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RemittanceImportListItem {
    pub id: Uuid,
    pub batch_id: Uuid,
    pub reference: String,
    pub status: RemittanceImportStatus,
    pub total_paid_minor: i64,
    pub currency: String,
    pub imported_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateRemittanceImportRequest {
    pub batch_id: Uuid,
    pub reference: String,
    pub total_paid_minor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CashDrawerListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CashSessionListItem {
    pub id: Uuid,
    pub drawer_id: Uuid,
    pub drawer_code: String,
    pub opened_by_user_id: Uuid,
    pub status: CashSessionStatus,
    pub opening_float_minor: i64,
    pub expected_cash_minor: i64,
    pub counted_cash_minor: Option<i64>,
    pub variance_minor: Option<i64>,
    pub currency: String,
    pub opened_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct OpenCashSessionRequest {
    pub drawer_id: Uuid,
    pub opening_float_minor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CloseCashSessionRequest {
    pub counted_cash_minor: i64,
}
