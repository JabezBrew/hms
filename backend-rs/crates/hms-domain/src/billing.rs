use chrono::{DateTime, NaiveDate, Utc};
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BillingSourceType {
    Encounter,
    Visit,
    AdmissionCase,
    DischargeCase,
    Prescription,
    LabOrder,
    LabResult,
    WardRound,
    NursingTask,
    ManualCharge,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceLockReason {
    PaymentRecorded,
    ClaimCreated,
    NhisBatchExported,
    Finalized,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReversalKind {
    Void,
    Refund,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NhisArAdjustmentKind {
    Remittance,
    WriteOff,
    Adjustment,
    Reconciliation,
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
pub struct BillingListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
}

impl From<BillingListGetQuery> for BillingListQuery {
    fn from(value: BillingListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            patient_id: value.patient_id,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct InvoiceListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<InvoiceStatus>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct InvoiceListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<InvoiceStatus>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

impl From<InvoiceListGetQuery> for InvoiceListQuery {
    fn from(value: InvoiceListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            patient_id: value.patient_id,
            search: value.search,
            status: value.status,
            date_from: value.date_from,
            date_to: value.date_to,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PaymentListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<PaymentStatus>,
    pub payment_method: Option<PaymentMethod>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PaymentListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<PaymentStatus>,
    pub payment_method: Option<PaymentMethod>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

impl From<PaymentListGetQuery> for PaymentListQuery {
    fn from(value: PaymentListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            patient_id: value.patient_id,
            search: value.search,
            status: value.status,
            payment_method: value.payment_method,
            date_from: value.date_from,
            date_to: value.date_to,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct ClaimListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<ClaimStatus>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct ClaimListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<ClaimStatus>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

impl From<ClaimListGetQuery> for ClaimListQuery {
    fn from(value: ClaimListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            patient_id: value.patient_id,
            search: value.search,
            status: value.status,
            date_from: value.date_from,
            date_to: value.date_to,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct BillingRuleListQuery {
    pub limit: Option<u8>,
    pub rule_type: Option<BillingRuleType>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct CashSessionListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<CashSessionStatus>,
    pub search: Option<String>,
    pub is_flagged: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct InsuranceProviderListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct InsurancePlanListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub provider_id: Option<Uuid>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PatientInsuranceListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PatientInsuranceListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

impl From<PatientInsuranceListGetQuery> for PatientInsuranceListQuery {
    fn from(value: PatientInsuranceListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            patient_id: value.patient_id,
            search: value.search,
            is_active: value.is_active,
        }
    }
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
    pub service_id: Option<Uuid>,
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
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
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
pub struct InvoiceLockState {
    pub invoice_id: Uuid,
    pub locked_at: Option<DateTime<Utc>>,
    pub locked_reason: Option<String>,
    pub finalized_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateInvoiceRequest {
    pub patient_id: Uuid,
    pub encounter_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub admission_case_id: Option<Uuid>,
    pub service_price_id: Uuid,
    pub quantity: i64,
    pub source_type: Option<BillingSourceType>,
    pub source_id: Option<Uuid>,
    pub is_auto_generated: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PaymentListItem {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub patient_id: Uuid,
    pub patient_code: String,
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
pub struct BillingRiskApprovalRequest {
    pub supervisor_user_id: Uuid,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ReversePaymentRequest {
    pub amount_minor: i64,
    pub reversal_kind: ReversalKind,
    pub approval: BillingRiskApprovalRequest,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FinalizeInvoiceRequest {
    pub approval: BillingRiskApprovalRequest,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct CreateNhisServiceMappingRequest {
    pub payer_id: Option<Uuid>,
    pub service_id: Uuid,
    pub nhis_code: String,
    pub effective_from: NaiveDate,
    pub effective_until: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct NhisServiceMappingListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub payer_id: Option<Uuid>,
    #[serde(alias = "payer")]
    pub payer: Option<Uuid>,
    pub search: Option<String>,
    pub active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PspPaymentIntentListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PspPaymentIntentListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<String>,
    pub search: Option<String>,
}

impl From<PspPaymentIntentListGetQuery> for PspPaymentIntentListQuery {
    fn from(value: PspPaymentIntentListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            status: value.status,
            search: value.search,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PspSettlementBatchListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PspSettlementBatchListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub status: Option<String>,
    pub search: Option<String>,
}

impl From<PspSettlementBatchListGetQuery> for PspSettlementBatchListQuery {
    fn from(value: PspSettlementBatchListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            status: value.status,
            search: value.search,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PspSettlementLineListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub match_status: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct PspSettlementLineListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub match_status: Option<String>,
    pub search: Option<String>,
}

impl From<PspSettlementLineListGetQuery> for PspSettlementLineListQuery {
    fn from(value: PspSettlementLineListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            match_status: value.match_status,
            search: value.search,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct NhisExportJobListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct RemittanceLineListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub match_status: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Deserialize, IntoParams, Serialize, ToSchema)]
pub struct RemittanceLineListGetQuery {
    pub cursor: Option<String>,
    pub limit: Option<u8>,
    pub match_status: Option<String>,
    pub search: Option<String>,
}

impl From<RemittanceLineListGetQuery> for RemittanceLineListQuery {
    fn from(value: RemittanceLineListGetQuery) -> Self {
        Self {
            cursor: value.cursor,
            limit: value.limit,
            match_status: value.match_status,
            search: value.search,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RecordNhisArAdjustmentRequest {
    pub adjustment_kind: NhisArAdjustmentKind,
    pub amount_minor: i64,
    pub reason: String,
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
    pub nhis_service_mapping_id: Option<Uuid>,
    pub nhis_service_mapping_version: Option<i64>,
    pub nhis_service_code: Option<String>,
    pub payer_receivable_minor: i64,
    pub patient_liability_minor: i64,
    pub written_off_minor: i64,
    pub reconciled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PaymentReversalLedgerEntry {
    pub id: Uuid,
    pub payment_id: Uuid,
    pub invoice_id: Uuid,
    pub reversal_kind: ReversalKind,
    pub amount_minor: i64,
    pub currency: String,
    pub reason: String,
    pub approved_by_user_id: Uuid,
    pub recorded_by_user_id: Uuid,
    pub reauthorized_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NhisServiceMappingListItem {
    pub id: Uuid,
    pub payer_id: Option<Uuid>,
    pub service_id: Uuid,
    pub service_code: String,
    pub service_name: String,
    pub nhis_code: String,
    pub version_number: i64,
    pub effective_from: NaiveDate,
    pub effective_until: Option<NaiveDate>,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PspPaymentIntentListItem {
    pub id: Uuid,
    pub invoice_id: Option<Uuid>,
    pub invoice_number: Option<String>,
    pub provider: String,
    pub provider_reference: Option<String>,
    pub client_reference: Option<String>,
    pub status: String,
    pub payment_method: String,
    pub amount_minor: i64,
    pub currency: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PspSettlementBatchListItem {
    pub id: Uuid,
    pub provider: String,
    pub statement_date: Option<NaiveDate>,
    pub file_name: Option<String>,
    pub status: String,
    pub line_count: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PspSettlementLineListItem {
    pub id: Uuid,
    pub batch_id: Uuid,
    pub provider_reference: Option<String>,
    pub client_reference: Option<String>,
    pub amount_gross_minor: i64,
    pub fee_amount_minor: i64,
    pub amount_net_minor: i64,
    pub paid_at: Option<DateTime<Utc>>,
    pub status: String,
    pub match_status: String,
    pub mismatch_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NhisExportJobListItem {
    pub id: Uuid,
    pub batch_id: Uuid,
    pub batch: String,
    pub batch_number: String,
    pub status: String,
    pub checksum: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct RemittanceLineListItem {
    pub id: Uuid,
    pub import_id: Uuid,
    pub claim_number: Option<String>,
    pub invoice_number: Option<String>,
    pub paid_amount_minor: i64,
    pub paid_date: Option<NaiveDate>,
    pub match_status: String,
    pub mismatch_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NhisClaimArState {
    pub claim_id: Uuid,
    pub payer_receivable_minor: i64,
    pub patient_liability_minor: i64,
    pub written_off_minor: i64,
    pub reconciled_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct NhisArAdjustmentEntry {
    pub id: Uuid,
    pub claim_id: Uuid,
    pub adjustment_kind: NhisArAdjustmentKind,
    pub amount_minor: i64,
    pub reason: String,
    pub affects_patient_liability: bool,
    pub recorded_by_user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct BillingDischargeClearance {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub cleared: bool,
    pub outstanding_invoice_count: i64,
    pub outstanding_amount_minor: i64,
    pub currency: String,
    pub reason: String,
    pub recorded_by_user_id: Uuid,
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
    pub opened_by_display_name: Option<String>,
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
pub struct InsuranceProviderListItem {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub payer_type: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct InsurancePlanListItem {
    pub id: Uuid,
    pub provider_id: Uuid,
    pub provider_name: String,
    pub code: String,
    pub name: String,
    pub coverage_percentage: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PatientInsuranceListItem {
    pub id: Uuid,
    pub patient_id: Uuid,
    pub patient_code: String,
    pub patient_name: String,
    pub provider_id: Uuid,
    pub provider_name: String,
    pub plan_id: Uuid,
    pub plan_name: String,
    pub policy_number: String,
    pub member_id: Option<String>,
    pub subscriber_number: Option<String>,
    pub valid_from: NaiveDate,
    pub valid_until: Option<NaiveDate>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn billing_get_query_preserves_patient_filter() {
        let patient_id = Uuid::from_u128(0x100);
        let query = BillingListQuery::from(BillingListGetQuery {
            cursor: None,
            limit: Some(10),
            patient_id: Some(patient_id),
        });

        assert_eq!(query.patient_id, Some(patient_id));
    }

    #[test]
    fn invoice_get_query_preserves_patient_and_search_filters() {
        let patient_id = Uuid::from_u128(0x101);
        let query = InvoiceListQuery::from(InvoiceListGetQuery {
            cursor: None,
            limit: Some(10),
            patient_id: Some(patient_id),
            search: Some("INV".to_owned()),
            status: Some(InvoiceStatus::Issued),
            date_from: None,
            date_to: None,
        });

        assert_eq!(query.patient_id, Some(patient_id));
        assert_eq!(query.search.as_deref(), Some("INV"));
        assert!(matches!(query.status, Some(InvoiceStatus::Issued)));
    }

    #[test]
    fn billing_get_query_variants_preserve_search_filters() {
        let patient_id = Uuid::from_u128(0x102);

        let payment = PaymentListQuery::from(PaymentListGetQuery {
            cursor: None,
            limit: Some(10),
            patient_id: Some(patient_id),
            search: Some("receipt".to_owned()),
            status: None,
            payment_method: None,
            date_from: None,
            date_to: None,
        });
        assert_eq!(payment.patient_id, Some(patient_id));
        assert_eq!(payment.search.as_deref(), Some("receipt"));

        let claim = ClaimListQuery::from(ClaimListGetQuery {
            cursor: None,
            limit: Some(10),
            patient_id: Some(patient_id),
            search: Some("claim".to_owned()),
            status: None,
            date_from: None,
            date_to: None,
        });
        assert_eq!(claim.patient_id, Some(patient_id));
        assert_eq!(claim.search.as_deref(), Some("claim"));

        let insurance = PatientInsuranceListQuery::from(PatientInsuranceListGetQuery {
            cursor: None,
            limit: Some(10),
            patient_id: Some(patient_id),
            search: Some("policy".to_owned()),
            is_active: Some(true),
        });
        assert_eq!(insurance.patient_id, Some(patient_id));
        assert_eq!(insurance.search.as_deref(), Some("policy"));

        let intent = PspPaymentIntentListQuery::from(PspPaymentIntentListGetQuery {
            cursor: None,
            limit: Some(10),
            status: Some("pending".to_owned()),
            search: Some("intent".to_owned()),
        });
        assert_eq!(intent.search.as_deref(), Some("intent"));

        let batch = PspSettlementBatchListQuery::from(PspSettlementBatchListGetQuery {
            cursor: None,
            limit: Some(10),
            status: Some("open".to_owned()),
            search: Some("batch".to_owned()),
        });
        assert_eq!(batch.search.as_deref(), Some("batch"));

        let line = PspSettlementLineListQuery::from(PspSettlementLineListGetQuery {
            cursor: None,
            limit: Some(10),
            match_status: Some("matched".to_owned()),
            search: Some("line".to_owned()),
        });
        assert_eq!(line.search.as_deref(), Some("line"));

        let remittance = RemittanceLineListQuery::from(RemittanceLineListGetQuery {
            cursor: None,
            limit: Some(10),
            match_status: Some("matched".to_owned()),
            search: Some("remittance".to_owned()),
        });
        assert_eq!(remittance.search.as_deref(), Some("remittance"));
    }
}
