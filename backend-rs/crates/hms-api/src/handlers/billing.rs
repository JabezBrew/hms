use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_db::billing::{BillingCursor, BillingRuleFilters, CashSessionFilters};
use hms_domain::billing::{
    BillingDashboardSummary, BillingListQuery, BillingRuleListItem, BillingRuleListQuery,
    CashDrawerListItem, CashSessionListItem, CashSessionListQuery, ClaimListItem,
    CloseCashSessionRequest, CreateClaimRequest, CreateInvoiceRequest, CreateNhisBatchRequest,
    CreatePaymentRequest, CreateRemittanceImportRequest, InvoiceListItem, NhisBatchExport,
    NhisBatchListItem, OpenCashSessionRequest, PaymentListItem, ReceiptListItem,
    RemittanceImportListItem, ServiceCatalogItem, ServiceCatalogQuery, ServicePriceListItem,
};
use hms_domain::deployment::PermissionCode;
use serde_json::json;
use uuid::Uuid;

use crate::cursor_list;
use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::RequestContext;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;

#[utoipa::path(get, path = "/api/v2/billing/service-catalog", operation_id = "getBillingServiceCatalog", tag = "billing", security(("bearerAuth" = [])), params(ServiceCatalogQuery), responses((status = 200, body = ListResponse<ServiceCatalogItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_service_catalog(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<ServiceCatalogQuery>,
) -> Result<Json<ListResponse<ServiceCatalogItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let (cursor, page_size) = decode_page(query.cursor.as_deref(), query.limit)?;
    let filters = hms_db::billing::ServiceCatalogFilters {
        search: query.search.clone(),
        is_active: query.is_active,
    };
    let rows = state
        .list_service_catalog(cursor, page_size as i64 + 1, filters)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "service_catalog_failed",
                "Service catalog could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/billing/service-prices", operation_id = "getBillingServicePrices", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<ServicePriceListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_service_prices(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ListResponse<ServicePriceListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    Ok(Json(static_list(
        state.list_service_prices().await.map_err(|_| {
            ApiError::conflict(
                "service_price_failed",
                "Service prices could not be loaded.",
            )
        })?,
    )))
}

#[utoipa::path(get, path = "/api/v2/billing/rules", operation_id = "getBillingRules", tag = "billing", security(("bearerAuth" = [])), params(BillingRuleListQuery), responses((status = 200, body = ListResponse<BillingRuleListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_billing_rules(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<BillingRuleListQuery>,
) -> Result<Json<ListResponse<BillingRuleListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let page_size = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let rules = state
        .list_billing_rules(
            BillingRuleFilters {
                rule_type: query.rule_type,
                is_active: query.is_active,
            },
            page_size as i64,
        )
        .await
        .map_err(|_| {
            ApiError::conflict("billing_rule_failed", "Billing rules could not be loaded.")
        })?;
    Ok(Json(list(
        rules,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: page_size,
        },
    )))
}

#[utoipa::path(get, path = "/api/v2/billing/rules/{id}", operation_id = "getBillingRuleById", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Billing rule ID")), responses((status = 200, body = ObjectResponse<BillingRuleListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_billing_rule(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<BillingRuleListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let rule = state
        .get_billing_rule(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "billing_rule_load_failed",
                "Billing rule could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("billing_rule_not_found", "Billing rule was not found.")
        })?;
    Ok(Json(object(rule)))
}

#[utoipa::path(get, path = "/api/v2/billing/dashboard-summary", operation_id = "getBillingDashboardSummary", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ObjectResponse<BillingDashboardSummary>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn dashboard_summary(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
) -> Result<Json<ObjectResponse<BillingDashboardSummary>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let summary = state.billing_dashboard_summary().await.map_err(|_| {
        ApiError::conflict(
            "billing_dashboard_summary_failed",
            "Billing dashboard summary could not be loaded.",
        )
    })?;
    Ok(Json(object(summary)))
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
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    Ok(Json(static_list(state.list_cash_drawers().await.map_err(
        |_| {
            ApiError::conflict(
                "cash_drawer_list_failed",
                "Cash drawers could not be loaded.",
            )
        },
    )?)))
}

#[utoipa::path(get, path = "/api/v2/billing/cash-sessions", operation_id = "getCashSessions", tag = "billing", security(("bearerAuth" = [])), params(CashSessionListQuery), responses((status = 200, body = ListResponse<CashSessionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_cash_sessions(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Query(query): Query<CashSessionListQuery>,
) -> Result<Json<ListResponse<CashSessionListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let (cursor, page_size, filters) = cash_session_page_request(query)?;
    let rows = state
        .list_cash_sessions(cursor, page_size as i64 + 1, filters)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "cash_session_list_failed",
                "Cash sessions could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.opened_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/billing/cash-sessions/{id}", operation_id = "getCashSessionById", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Cash session id")), responses((status = 200, body = ObjectResponse<CashSessionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_cash_session(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<CashSessionListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let session = state
        .get_cash_session(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "cash_session_detail_failed",
                "Cash session could not be loaded.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("cash_session_not_found", "Cash session was not found.")
        })?;
    Ok(Json(object(session)))
}

#[utoipa::path(post, path = "/api/v2/billing/cash-sessions", operation_id = "postCashSessions", tag = "billing", security(("bearerAuth" = [])), request_body = OpenCashSessionRequest, responses((status = 200, body = ObjectResponse<CashSessionListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn open_cash_session(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Json(payload): Json<OpenCashSessionRequest>,
) -> Result<Json<ObjectResponse<CashSessionListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingManage)?;
    require_non_negative(payload.opening_float_minor, "opening_float_minor")?;
    let session = state
        .open_cash_session(payload.drawer_id, payload.opening_float_minor, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "cash_session_open_failed",
                "Cash session could not be opened.",
            )
        })?;
    Ok(Json(object(session)))
}

#[utoipa::path(post, path = "/api/v2/billing/cash-sessions/{id}/close", operation_id = "postCashSessionClose", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Cash session id")), request_body = CloseCashSessionRequest, responses((status = 200, body = ObjectResponse<CashSessionListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn close_cash_session(
    State(state): State<AppState>,
    RequestContext(user): RequestContext,
    Path(id): Path<Uuid>,
    Json(payload): Json<CloseCashSessionRequest>,
) -> Result<Json<ObjectResponse<CashSessionListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingManage)?;
    require_non_negative(payload.counted_cash_minor, "counted_cash_minor")?;
    let session = state
        .close_cash_session(id, payload, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "cash_session_close_failed",
                "Cash session could not be closed.",
            )
        })?
        .ok_or_else(|| {
            ApiError::not_found("cash_session_not_found", "Open cash session was not found.")
        })?;
    Ok(Json(object(session)))
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

fn require_billing_access(
    user: &hms_access::RequestContext,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    hms_access::require_billing_access(user, facility_id, permission).map_err(|_| {
        ApiError::forbidden(
            "permission_denied",
            "You do not have permission for this billing action.",
        )
    })
}

fn cash_session_page_request(
    query: CashSessionListQuery,
) -> Result<(Option<BillingCursor>, u8, CashSessionFilters), ApiError> {
    let (cursor, limit) = decode_page(query.cursor.as_deref(), query.limit)?;
    Ok((
        cursor,
        limit,
        CashSessionFilters {
            status: query.status,
        },
    ))
}

fn decode_page(
    cursor: Option<&str>,
    limit: Option<u8>,
) -> Result<(Option<BillingCursor>, u8), ApiError> {
    let page = cursor_list::page_request(
        cursor,
        limit,
        DEFAULT_LIMIT,
        MAX_LIMIT,
        |occurred_at, id| BillingCursor { occurred_at, id },
    )?;
    Ok((page.cursor, page.limit))
}

fn static_list<T>(items: Vec<T>) -> ListResponse<T> {
    cursor_list::static_list(items, MAX_LIMIT)
}

fn page_response<T, F>(rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    cursor_list::page_response(rows, page_size, cursor_for)
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    cursor_list::encode_cursor(occurred_at, id)
}

fn require_non_negative(value: i64, field: &'static str) -> Result<(), ApiError> {
    if value < 0 {
        return Err(validation_error(field, "This value cannot be negative."));
    }
    Ok(())
}

fn validation_error(field: &'static str, message: &'static str) -> ApiError {
    let mut error = ApiError::bad_request("invalid_billing_request", "Billing request is invalid.");
    error.details = json!({ field: [message] });
    error
}
