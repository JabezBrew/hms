use axum::extract::{Path, Query, State};
use axum::Json;
use hms_domain::billing::{
    BillingDashboardSummary, BillingDischargeClearance, BillingListQuery, BillingRuleListItem,
    BillingRuleListQuery, CashDrawerListItem, CashSessionListItem, CashSessionListQuery,
    ClaimListItem, CloseCashSessionRequest, CreateClaimRequest, CreateInvoiceRequest,
    CreateNhisBatchRequest, CreateNhisServiceMappingRequest, CreatePaymentRequest,
    CreateRemittanceImportRequest, FinalizeInvoiceRequest, InvoiceListItem, NhisArAdjustmentEntry,
    NhisBatchExport, NhisBatchListItem, NhisClaimArState, NhisServiceMappingListItem,
    OpenCashSessionRequest, PaymentListItem, PaymentReversalLedgerEntry, ReceiptListItem,
    RecordNhisArAdjustmentRequest, RemittanceImportListItem, ReversePaymentRequest,
    ServiceCatalogItem, ServiceCatalogQuery, ServicePriceListItem,
};
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{ListResponse, ObjectResponse};
use crate::state::AppState;

#[utoipa::path(get, path = "/api/v2/billing/service-catalog", operation_id = "getBillingServiceCatalog", tag = "billing", security(("bearerAuth" = [])), params(ServiceCatalogQuery), responses((status = 200, body = ListResponse<ServiceCatalogItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_service_catalog(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<ServiceCatalogQuery>,
) -> Result<Json<ListResponse<ServiceCatalogItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .catalog()
            .list_service_catalog(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/service-prices", operation_id = "getBillingServicePrices", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<ServicePriceListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_service_prices(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ListResponse<ServicePriceListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .catalog()
            .list_service_prices(&user)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/rules", operation_id = "getBillingRules", tag = "billing", security(("bearerAuth" = [])), params(BillingRuleListQuery), responses((status = 200, body = ListResponse<BillingRuleListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_billing_rules(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BillingRuleListQuery>,
) -> Result<Json<ListResponse<BillingRuleListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .catalog()
            .list_billing_rules(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/rules/{id}", operation_id = "getBillingRuleById", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Billing rule ID")), responses((status = 200, body = ObjectResponse<BillingRuleListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_billing_rule(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<BillingRuleListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .catalog()
            .get_billing_rule(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/dashboard-summary", operation_id = "getBillingDashboardSummary", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ObjectResponse<BillingDashboardSummary>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn dashboard_summary(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ObjectResponse<BillingDashboardSummary>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .overview()
            .dashboard_summary(&user)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/invoices", operation_id = "getBillingInvoices", tag = "billing", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<InvoiceListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_invoices(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<InvoiceListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .list_invoices(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/invoices/{id}", operation_id = "getBillingInvoiceById", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Invoice id")), responses((status = 200, body = ObjectResponse<InvoiceListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_invoice(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<InvoiceListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .get_invoice(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/billing/invoices", operation_id = "postBillingInvoices", tag = "billing", security(("bearerAuth" = [])), request_body = CreateInvoiceRequest, responses((status = 200, body = ObjectResponse<InvoiceListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_invoice(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateInvoiceRequest>,
) -> Result<Json<ObjectResponse<InvoiceListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .create_invoice(&user, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/billing/invoices/{id}/finalize", operation_id = "postBillingInvoiceFinalize", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Invoice id")), request_body = FinalizeInvoiceRequest, responses((status = 200, body = ObjectResponse<InvoiceListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn finalize_invoice(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<FinalizeInvoiceRequest>,
) -> Result<Json<ObjectResponse<InvoiceListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .finalize_invoice(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/payments", operation_id = "getBillingPayments", tag = "billing", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<PaymentListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_payments(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<PaymentListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .list_payments(&user, query)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/billing/payments", operation_id = "postBillingPayments", tag = "billing", security(("bearerAuth" = [])), request_body = CreatePaymentRequest, responses((status = 200, body = ObjectResponse<PaymentListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_payment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreatePaymentRequest>,
) -> Result<Json<ObjectResponse<PaymentListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .create_payment(&user, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/billing/payments/{id}/reverse", operation_id = "postBillingPaymentReverse", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Payment id")), request_body = ReversePaymentRequest, responses((status = 200, body = ObjectResponse<PaymentReversalLedgerEntry>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn reverse_payment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<ReversePaymentRequest>,
) -> Result<Json<ObjectResponse<PaymentReversalLedgerEntry>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .reverse_payment(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/billing/discharge-clearances/{patient_id}", operation_id = "postBillingDischargeClearance", tag = "billing", security(("bearerAuth" = [])), params(("patient_id" = Uuid, Path, description = "Patient id")), responses((status = 200, body = ObjectResponse<BillingDischargeClearance>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn record_discharge_clearance(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(patient_id): Path<Uuid>,
) -> Result<Json<ObjectResponse<BillingDischargeClearance>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .record_discharge_clearance(&user, patient_id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/receipts", operation_id = "getBillingReceipts", tag = "billing", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<ReceiptListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_receipts(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<ReceiptListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .list_receipts(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/receipts/{id}", operation_id = "getBillingReceiptById", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Receipt id")), responses((status = 200, body = ObjectResponse<ReceiptListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_receipt(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ReceiptListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .get_receipt(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/receipts/by-number/{receipt_number}", operation_id = "getBillingReceiptByNumber", tag = "billing", security(("bearerAuth" = [])), params(("receipt_number" = String, Path, description = "Receipt number")), responses((status = 200, body = ObjectResponse<ReceiptListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_receipt_by_number(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(receipt_number): Path<String>,
) -> Result<Json<ObjectResponse<ReceiptListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .get_receipt_by_number(&user, receipt_number)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/payments/{id}/receipt", operation_id = "getBillingReceiptByPaymentId", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Payment id")), responses((status = 200, body = ObjectResponse<ReceiptListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_receipt_by_payment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ReceiptListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .financial_workflow()
            .get_receipt_by_payment(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/cash-drawers", operation_id = "getCashDrawers", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<CashDrawerListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_cash_drawers(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ListResponse<CashDrawerListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .cash_control()
            .list_cash_drawers(&user)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/cash-sessions", operation_id = "getCashSessions", tag = "billing", security(("bearerAuth" = [])), params(CashSessionListQuery), responses((status = 200, body = ListResponse<CashSessionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_cash_sessions(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<CashSessionListQuery>,
) -> Result<Json<ListResponse<CashSessionListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .cash_control()
            .list_cash_sessions(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/billing/cash-sessions/{id}", operation_id = "getCashSessionById", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Cash session id")), responses((status = 200, body = ObjectResponse<CashSessionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_cash_session(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<CashSessionListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .cash_control()
            .get_cash_session(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/billing/cash-sessions", operation_id = "postCashSessions", tag = "billing", security(("bearerAuth" = [])), request_body = OpenCashSessionRequest, responses((status = 200, body = ObjectResponse<CashSessionListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn open_cash_session(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<OpenCashSessionRequest>,
) -> Result<Json<ObjectResponse<CashSessionListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .cash_control()
            .open_cash_session(&user, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/billing/cash-sessions/{id}/close", operation_id = "postCashSessionClose", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Cash session id")), request_body = CloseCashSessionRequest, responses((status = 200, body = ObjectResponse<CashSessionListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn close_cash_session(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CloseCashSessionRequest>,
) -> Result<Json<ObjectResponse<CashSessionListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .cash_control()
            .close_cash_session(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/nhis/claims", operation_id = "getNhisClaims", tag = "nhis", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<ClaimListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_claims(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<ClaimListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .list_claims(&user, query)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/nhis/claims/{id}", operation_id = "getNhisClaimById", tag = "nhis", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "NHIS claim id")), responses((status = 200, body = ObjectResponse<ClaimListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_claim(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<ClaimListItem>>, ApiError> {
    Ok(Json(
        state.billing_services().nhis().get_claim(&user, id).await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/nhis/claims", operation_id = "postNhisClaims", tag = "nhis", security(("bearerAuth" = [])), request_body = CreateClaimRequest, responses((status = 200, body = ObjectResponse<ClaimListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_claim(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateClaimRequest>,
) -> Result<Json<ObjectResponse<ClaimListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .create_claim(&user, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/nhis/service-mappings", operation_id = "postNhisServiceMappings", tag = "nhis", security(("bearerAuth" = [])), request_body = CreateNhisServiceMappingRequest, responses((status = 200, body = ObjectResponse<NhisServiceMappingListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn create_nhis_service_mapping(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateNhisServiceMappingRequest>,
) -> Result<Json<ObjectResponse<NhisServiceMappingListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .create_service_mapping(&user, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/nhis/claims/{id}/ar-state", operation_id = "getNhisClaimArState", tag = "nhis", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "NHIS claim id")), responses((status = 200, body = ObjectResponse<NhisClaimArState>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn get_claim_ar_state(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NhisClaimArState>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .get_claim_ar_state(&user, id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/nhis/claims/{id}/ar-adjustments", operation_id = "postNhisClaimArAdjustment", tag = "nhis", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "NHIS claim id")), request_body = RecordNhisArAdjustmentRequest, responses((status = 200, body = ObjectResponse<NhisArAdjustmentEntry>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse), (status = 409, body = ApiErrorResponse)))]
pub async fn record_claim_ar_adjustment(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<RecordNhisArAdjustmentRequest>,
) -> Result<Json<ObjectResponse<NhisArAdjustmentEntry>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .record_claim_ar_adjustment(&user, id, payload)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/nhis/batches", operation_id = "getNhisBatches", tag = "nhis", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<NhisBatchListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_batches(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<NhisBatchListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .list_batches(&user, query)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/nhis/batches", operation_id = "postNhisBatches", tag = "nhis", security(("bearerAuth" = [])), request_body = CreateNhisBatchRequest, responses((status = 200, body = ObjectResponse<NhisBatchListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_batch(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateNhisBatchRequest>,
) -> Result<Json<ObjectResponse<NhisBatchListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .create_batch(&user, payload)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/nhis/batches/{id}/export", operation_id = "postNhisBatchExport", tag = "nhis", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "NHIS batch id")), responses((status = 200, body = ObjectResponse<NhisBatchExport>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn export_batch(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NhisBatchExport>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .export_batch(&user, id)
            .await?,
    ))
}

#[utoipa::path(get, path = "/api/v2/nhis/remittance-imports", operation_id = "getNhisRemittanceImports", tag = "nhis", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<RemittanceImportListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_remittance_imports(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<RemittanceImportListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .list_remittance_imports(&user, query)
            .await?,
    ))
}

#[utoipa::path(post, path = "/api/v2/nhis/remittance-imports", operation_id = "postNhisRemittanceImports", tag = "nhis", security(("bearerAuth" = [])), request_body = CreateRemittanceImportRequest, responses((status = 200, body = ObjectResponse<RemittanceImportListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_remittance_import(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<CreateRemittanceImportRequest>,
) -> Result<Json<ObjectResponse<RemittanceImportListItem>>, ApiError> {
    Ok(Json(
        state
            .billing_services()
            .nhis()
            .create_remittance_import(&user, payload)
            .await?,
    ))
}
