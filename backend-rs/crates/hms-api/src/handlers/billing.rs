use std::collections::HashSet;

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use hms_access::{require_patient_demographics_access, require_permission};
use hms_db::billing::BillingCursor;
use hms_domain::auth::AuthUser;
use hms_domain::billing::{
    BillingListQuery, BillingRuleListItem, CashDrawerListItem, CashSessionListItem, ClaimListItem,
    CloseCashSessionRequest, CreateClaimRequest, CreateInvoiceRequest, CreateNhisBatchRequest,
    CreatePaymentRequest, CreateRemittanceImportRequest, InvoiceListItem, NhisBatchExport,
    NhisBatchListItem, OpenCashSessionRequest, PaymentListItem, ReceiptListItem,
    RemittanceImportListItem, ServiceCatalogItem, ServicePriceListItem,
};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use serde_json::json;
use uuid::Uuid;

use crate::error::{ApiError, ApiErrorResponse};
use crate::extractors::AuthenticatedUser;
use crate::response::{list, object, ListResponse, ObjectResponse, PageInfo};
use crate::state::AppState;

const DEFAULT_LIMIT: u8 = 25;
const MAX_LIMIT: u8 = 100;
const MAX_TEXT_LEN: usize = 160;

#[utoipa::path(get, path = "/api/v2/billing/service-catalog", operation_id = "getBillingServiceCatalog", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<ServiceCatalogItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_service_catalog(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<ServiceCatalogItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    Ok(Json(static_list(
        state.list_service_catalog().await.map_err(|_| {
            ApiError::conflict(
                "service_catalog_failed",
                "Service catalog could not be loaded.",
            )
        })?,
    )))
}

#[utoipa::path(get, path = "/api/v2/billing/service-prices", operation_id = "getBillingServicePrices", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<ServicePriceListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_service_prices(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
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

#[utoipa::path(get, path = "/api/v2/billing/rules", operation_id = "getBillingRules", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<BillingRuleListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_billing_rules(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
) -> Result<Json<ListResponse<BillingRuleListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    Ok(Json(static_list(
        state.list_billing_rules().await.map_err(|_| {
            ApiError::conflict("billing_rule_failed", "Billing rules could not be loaded.")
        })?,
    )))
}

#[utoipa::path(get, path = "/api/v2/billing/invoices", operation_id = "getBillingInvoices", tag = "billing", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<InvoiceListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_invoices(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<InvoiceListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let patient_id = query.patient_id;
    if let Some(patient_id) = patient_id {
        let _patient = load_patient_for_access(&state, &user, patient_id).await?;
    }
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_billing_invoices(patient_id, cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("invoice_list_failed", "Invoices could not be loaded."))?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.issued_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/billing/invoices/{id}", operation_id = "getBillingInvoiceById", tag = "billing", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "Invoice id")), responses((status = 200, body = ObjectResponse<InvoiceListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn get_invoice(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<InvoiceListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let invoice = state
        .get_billing_invoice(id)
        .await
        .map_err(|_| ApiError::conflict("invoice_load_failed", "Invoice could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("invoice_not_found", "Invoice was not found."))?;
    let _patient = load_patient_for_access(&state, &user, invoice.patient_id).await?;

    Ok(Json(object(invoice)))
}

#[utoipa::path(post, path = "/api/v2/billing/invoices", operation_id = "postBillingInvoices", tag = "billing", security(("bearerAuth" = [])), request_body = CreateInvoiceRequest, responses((status = 200, body = ObjectResponse<InvoiceListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_invoice(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateInvoiceRequest>,
) -> Result<Json<ObjectResponse<InvoiceListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingManage)?;
    require_positive(payload.quantity, "quantity")?;
    let _patient = load_patient_for_access(&state, &user, payload.patient_id).await?;
    let invoice = state
        .create_billing_invoice(
            payload.patient_id,
            payload.service_price_id,
            payload.quantity,
            user.id,
        )
        .await
        .map_err(|_| ApiError::conflict("invoice_create_failed", "Invoice could not be saved."))?;
    Ok(Json(object(invoice)))
}

#[utoipa::path(get, path = "/api/v2/billing/payments", operation_id = "getBillingPayments", tag = "billing", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<PaymentListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_payments(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<PaymentListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_billing_payments(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("payment_list_failed", "Payments could not be loaded."))?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.paid_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/billing/payments", operation_id = "postBillingPayments", tag = "billing", security(("bearerAuth" = [])), request_body = CreatePaymentRequest, responses((status = 200, body = ObjectResponse<PaymentListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_payment(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreatePaymentRequest>,
) -> Result<Json<ObjectResponse<PaymentListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingManage)?;
    require_positive(payload.amount_minor, "amount_minor")?;
    let invoice = state
        .billing_invoice_context(payload.invoice_id)
        .await
        .map_err(|_| ApiError::conflict("invoice_load_failed", "Invoice could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("invoice_not_found", "Invoice was not found."))?;
    let _patient = load_patient_for_access(&state, &user, invoice.patient_id).await?;
    let payment = state
        .create_billing_payment(
            payload.invoice_id,
            payload.amount_minor,
            payload.method,
            payload.cash_session_id,
            user.id,
        )
        .await
        .map_err(|_| ApiError::conflict("payment_create_failed", "Payment could not be saved."))?;
    Ok(Json(object(payment)))
}

#[utoipa::path(get, path = "/api/v2/billing/receipts", operation_id = "getBillingReceipts", tag = "billing", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<ReceiptListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_receipts(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<ReceiptListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_billing_receipts(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("receipt_list_failed", "Receipts could not be loaded."))?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.issued_at, item.id)
    })))
}

#[utoipa::path(get, path = "/api/v2/billing/cash-drawers", operation_id = "getCashDrawers", tag = "billing", security(("bearerAuth" = [])), responses((status = 200, body = ListResponse<CashDrawerListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_cash_drawers(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
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

#[utoipa::path(get, path = "/api/v2/billing/cash-sessions", operation_id = "getCashSessions", tag = "billing", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<CashSessionListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_cash_sessions(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<CashSessionListItem>>, ApiError> {
    require_billing_access(&user, state.facility_id(), PermissionCode::BillingView)?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_cash_sessions(cursor, page_size as i64 + 1)
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

#[utoipa::path(post, path = "/api/v2/billing/cash-sessions", operation_id = "postCashSessions", tag = "billing", security(("bearerAuth" = [])), request_body = OpenCashSessionRequest, responses((status = 200, body = ObjectResponse<CashSessionListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn open_cash_session(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
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
    AuthenticatedUser(user): AuthenticatedUser,
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
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<ClaimListItem>>, ApiError> {
    require_nhis_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_nhis_claims(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| ApiError::conflict("claim_list_failed", "Claims could not be loaded."))?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/nhis/claims", operation_id = "postNhisClaims", tag = "nhis", security(("bearerAuth" = [])), request_body = CreateClaimRequest, responses((status = 200, body = ObjectResponse<ClaimListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_claim(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateClaimRequest>,
) -> Result<Json<ObjectResponse<ClaimListItem>>, ApiError> {
    require_nhis_access(&user, state.facility_id())?;
    let invoice = state
        .billing_invoice_context(payload.invoice_id)
        .await
        .map_err(|_| ApiError::conflict("invoice_load_failed", "Invoice could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("invoice_not_found", "Invoice was not found."))?;
    let _patient = load_patient_for_access(&state, &user, invoice.patient_id).await?;
    let claim = state
        .create_nhis_claim(payload.invoice_id, user.id)
        .await
        .map_err(|_| ApiError::conflict("claim_create_failed", "Claim could not be saved."))?;
    Ok(Json(object(claim)))
}

#[utoipa::path(get, path = "/api/v2/nhis/batches", operation_id = "getNhisBatches", tag = "nhis", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<NhisBatchListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_batches(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<NhisBatchListItem>>, ApiError> {
    require_nhis_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_nhis_batches(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nhis_batch_list_failed",
                "NHIS batches could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.created_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/nhis/batches", operation_id = "postNhisBatches", tag = "nhis", security(("bearerAuth" = [])), request_body = CreateNhisBatchRequest, responses((status = 200, body = ObjectResponse<NhisBatchListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_batch(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateNhisBatchRequest>,
) -> Result<Json<ObjectResponse<NhisBatchListItem>>, ApiError> {
    require_nhis_access(&user, state.facility_id())?;
    validate_claim_ids(&payload.claim_ids)?;
    let contexts = state
        .nhis_claim_contexts(&payload.claim_ids)
        .await
        .map_err(|_| ApiError::conflict("claim_load_failed", "Claims could not be loaded."))?;
    if contexts.len() != payload.claim_ids.len() {
        return Err(ApiError::not_found(
            "claim_not_found",
            "One or more claims were not found.",
        ));
    }
    for context in contexts {
        let _patient = load_patient_for_access(&state, &user, context.patient_id).await?;
    }
    let batch = state
        .create_nhis_batch(payload.claim_ids, user.id)
        .await
        .map_err(|_| {
            ApiError::conflict("nhis_batch_create_failed", "NHIS batch could not be saved.")
        })?;
    Ok(Json(object(batch)))
}

#[utoipa::path(post, path = "/api/v2/nhis/batches/{id}/export", operation_id = "postNhisBatchExport", tag = "nhis", security(("bearerAuth" = [])), params(("id" = Uuid, Path, description = "NHIS batch id")), responses((status = 200, body = ObjectResponse<NhisBatchExport>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn export_batch(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ObjectResponse<NhisBatchExport>>, ApiError> {
    require_nhis_access(&user, state.facility_id())?;
    let exported = state
        .export_nhis_batch(id)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "nhis_batch_export_failed",
                "NHIS batch could not be exported.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("nhis_batch_not_found", "NHIS batch was not found."))?;
    Ok(Json(object(exported)))
}

#[utoipa::path(get, path = "/api/v2/nhis/remittance-imports", operation_id = "getNhisRemittanceImports", tag = "nhis", security(("bearerAuth" = [])), params(BillingListQuery), responses((status = 200, body = ListResponse<RemittanceImportListItem>), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse)))]
pub async fn list_remittance_imports(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Query(query): Query<BillingListQuery>,
) -> Result<Json<ListResponse<RemittanceImportListItem>>, ApiError> {
    require_nhis_access(&user, state.facility_id())?;
    let (cursor, page_size) = page_request(query)?;
    let rows = state
        .list_remittance_imports(cursor, page_size as i64 + 1)
        .await
        .map_err(|_| {
            ApiError::conflict(
                "remittance_list_failed",
                "Remittance imports could not be loaded.",
            )
        })?;
    Ok(Json(page_response(rows, page_size, |item| {
        encode_cursor(item.imported_at, item.id)
    })))
}

#[utoipa::path(post, path = "/api/v2/nhis/remittance-imports", operation_id = "postNhisRemittanceImports", tag = "nhis", security(("bearerAuth" = [])), request_body = CreateRemittanceImportRequest, responses((status = 200, body = ObjectResponse<RemittanceImportListItem>), (status = 400, body = ApiErrorResponse), (status = 401, body = ApiErrorResponse), (status = 403, body = ApiErrorResponse), (status = 404, body = ApiErrorResponse)))]
pub async fn create_remittance_import(
    State(state): State<AppState>,
    AuthenticatedUser(user): AuthenticatedUser,
    Json(payload): Json<CreateRemittanceImportRequest>,
) -> Result<Json<ObjectResponse<RemittanceImportListItem>>, ApiError> {
    require_nhis_access(&user, state.facility_id())?;
    require_positive(payload.total_paid_minor, "total_paid_minor")?;
    let reference = normalize_text(payload.reference, "reference")?;
    let remittance = state
        .create_remittance_import(
            payload.batch_id,
            reference,
            payload.total_paid_minor,
            user.id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "remittance_create_failed",
                "Remittance import could not be saved.",
            )
        })?;
    Ok(Json(object(remittance)))
}

async fn load_patient_for_access(
    state: &AppState,
    user: &AuthUser,
    patient_id: Uuid,
) -> Result<PatientRecord, ApiError> {
    let patient = state
        .get_patient(patient_id)
        .await
        .map_err(|_| ApiError::conflict("patient_load_failed", "Patient could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("patient_not_found", "Patient was not found."))?;
    require_patient_demographics_access(user, &patient).map_err(|_| {
        ApiError::forbidden(
            "patient_access_denied",
            "You do not have access to this patient.",
        )
    })?;
    Ok(patient)
}

fn require_billing_access(
    user: &AuthUser,
    facility_id: Uuid,
    permission: PermissionCode,
) -> Result<(), ApiError> {
    require_permission(user, permission)
        .and_then(|_| require_permission(user, PermissionCode::PatientDemographicsView))
        .map_err(|_| {
            ApiError::forbidden(
                "permission_denied",
                "You do not have permission for this billing action.",
            )
        })?;
    if user.facility_id == facility_id {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "permission_denied",
            "You do not have permission for this billing action.",
        ))
    }
}

fn require_nhis_access(user: &AuthUser, facility_id: Uuid) -> Result<(), ApiError> {
    require_billing_access(user, facility_id, PermissionCode::NhisClaimManage)
}

fn page_request(query: BillingListQuery) -> Result<(Option<BillingCursor>, u8), ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = query
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(decode_cursor)
        .transpose()?;
    Ok((cursor, limit))
}

fn static_list<T>(items: Vec<T>) -> ListResponse<T> {
    list(
        items,
        PageInfo {
            next_cursor: None,
            has_next: false,
            limit: MAX_LIMIT,
        },
    )
}

fn page_response<T, F>(mut rows: Vec<T>, page_size: u8, cursor_for: F) -> ListResponse<T>
where
    F: Fn(&T) -> String,
{
    let has_next = rows.len() > page_size as usize;
    if has_next {
        rows.truncate(page_size as usize);
    }
    let next_cursor = if has_next {
        rows.last().map(cursor_for)
    } else {
        None
    };
    list(
        rows,
        PageInfo {
            next_cursor,
            has_next,
            limit: page_size,
        },
    )
}

fn encode_cursor(occurred_at: DateTime<Utc>, id: Uuid) -> String {
    format!("{}:{}", occurred_at.timestamp_micros(), id)
}

fn decode_cursor(value: &str) -> Result<BillingCursor, ApiError> {
    let (micros, id) = value
        .split_once(':')
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let micros = micros
        .parse::<i64>()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let occurred_at = DateTime::<Utc>::from_timestamp_micros(micros)
        .ok_or_else(|| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    let id = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_cursor", "Cursor is invalid."))?;
    Ok(BillingCursor { occurred_at, id })
}

fn validate_claim_ids(claim_ids: &[Uuid]) -> Result<(), ApiError> {
    if claim_ids.is_empty() {
        return Err(validation_error(
            "claim_ids",
            "At least one claim is required.",
        ));
    }
    if claim_ids.len() > MAX_LIMIT as usize {
        return Err(validation_error(
            "claim_ids",
            "Too many claims were supplied.",
        ));
    }
    let unique = claim_ids.iter().collect::<HashSet<_>>();
    if unique.len() != claim_ids.len() {
        return Err(validation_error(
            "claim_ids",
            "Duplicate claims are not allowed.",
        ));
    }
    Ok(())
}

fn normalize_text(value: String, field: &'static str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation_error(field, "This field is required."));
    }
    if value.chars().count() > MAX_TEXT_LEN {
        return Err(validation_error(field, "This field is too long."));
    }
    Ok(value.to_owned())
}

fn require_positive(value: i64, field: &'static str) -> Result<(), ApiError> {
    if value <= 0 {
        return Err(validation_error(
            field,
            "This value must be greater than zero.",
        ));
    }
    Ok(())
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
