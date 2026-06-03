use chrono::Utc;
use hms_db::billing::{
    InvoiceListFilters, NewInvoice, NewPayment, NewPaymentReversal, PaymentListFilters,
    PspPaymentIntentFilters, PspSettlementBatchFilters, PspSettlementLineFilters,
};
use hms_domain::billing::{
    BillingDischargeClearance, BillingListQuery, CreateInvoiceRequest, CreatePaymentRequest,
    FinalizeInvoiceRequest, InvoiceListItem, InvoiceListQuery, PaymentListItem, PaymentListQuery,
    PaymentReversalLedgerEntry, PspPaymentIntentListItem, PspPaymentIntentListQuery,
    PspSettlementBatchListItem, PspSettlementBatchListQuery, PspSettlementLineListItem,
    PspSettlementLineListQuery, ReceiptListItem, ReversePaymentRequest,
};
use hms_domain::deployment::PermissionCode;
use uuid::Uuid;

use super::common;
use crate::error::ApiError;
use crate::response::{object, ListResponse, ObjectResponse};
use crate::state::AppState;

#[derive(Clone)]
pub struct FinancialWorkflowService {
    state: AppState,
}

impl FinancialWorkflowService {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_invoices(
        &self,
        ctx: &hms_access::RequestContext,
        query: InvoiceListQuery,
    ) -> Result<ListResponse<InvoiceListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        if let Some(patient_id) = query.patient_id {
            let _patient = common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::billing::list_invoices(
            self.pool(),
            self.facility_id(),
            InvoiceListFilters {
                patient_id: query.patient_id,
                search: query.search,
                status: query.status,
                date_from: query.date_from,
                date_to: query.date_to,
            },
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| ApiError::conflict("invoice_list_failed", "Invoices could not be loaded."))?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.issued_at, item.id)
        }))
    }

    pub async fn get_invoice(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<InvoiceListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let invoice = hms_db::billing::get_invoice(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| ApiError::conflict("invoice_load_failed", "Invoice could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("invoice_not_found", "Invoice was not found."))?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, invoice.patient_id).await?;

        Ok(object(invoice))
    }

    pub async fn create_invoice(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreateInvoiceRequest,
    ) -> Result<ObjectResponse<InvoiceListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingManage)?;
        common::require_positive(payload.quantity, "quantity")?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let id = Uuid::new_v4();
        let invoice = hms_db::billing::create_invoice(
            self.pool(),
            NewInvoice {
                id,
                facility_id: self.facility_id(),
                patient_id: payload.patient_id,
                service_price_id: payload.service_price_id,
                quantity: payload.quantity,
                invoice_number: format!("INV-{}", &id.simple().to_string()[..10].to_uppercase()),
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("invoice_create_failed", "Invoice could not be saved."))?;
        Ok(object(invoice))
    }

    pub async fn list_payments(
        &self,
        ctx: &hms_access::RequestContext,
        query: PaymentListQuery,
    ) -> Result<ListResponse<PaymentListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        if let Some(patient_id) = query.patient_id {
            let _patient = common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::billing::list_payments(
            self.pool(),
            self.facility_id(),
            PaymentListFilters {
                patient_id: query.patient_id,
                search: query.search,
                status: query.status,
                payment_method: query.payment_method,
                date_from: query.date_from,
                date_to: query.date_to,
            },
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| ApiError::conflict("payment_list_failed", "Payments could not be loaded."))?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.paid_at, item.id)
        }))
    }

    pub async fn list_payment_intents(
        &self,
        ctx: &hms_access::RequestContext,
        query: PspPaymentIntentListQuery,
    ) -> Result<ListResponse<PspPaymentIntentListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::billing::list_psp_payment_intents(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
            PspPaymentIntentFilters {
                status: query.status,
                search: query.search,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "payment_intent_list_failed",
                "Payment intents could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_settlement_batches(
        &self,
        ctx: &hms_access::RequestContext,
        query: PspSettlementBatchListQuery,
    ) -> Result<ListResponse<PspSettlementBatchListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::billing::list_psp_settlement_batches(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
            PspSettlementBatchFilters {
                status: query.status,
                search: query.search,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "settlement_batch_list_failed",
                "Settlement batches could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn list_settlement_lines(
        &self,
        ctx: &hms_access::RequestContext,
        batch_id: Uuid,
        query: PspSettlementLineListQuery,
    ) -> Result<ListResponse<PspSettlementLineListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::decode_page(query.cursor.as_deref(), query.limit)?;
        let rows = hms_db::billing::list_psp_settlement_lines(
            self.pool(),
            self.facility_id(),
            batch_id,
            cursor,
            page_size as i64 + 1,
            PspSettlementLineFilters {
                match_status: query.match_status,
                search: query.search,
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "settlement_line_list_failed",
                "Settlement lines could not be loaded.",
            )
        })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.created_at, item.id)
        }))
    }

    pub async fn create_payment(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreatePaymentRequest,
    ) -> Result<ObjectResponse<PaymentListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingManage)?;
        common::require_positive(payload.amount_minor, "amount_minor")?;
        common::require_invoice_patient_access(&self.state, ctx, payload.invoice_id).await?;
        let id = Uuid::new_v4();
        let payment = hms_db::billing::create_payment(
            self.pool(),
            NewPayment {
                id,
                facility_id: self.facility_id(),
                invoice_id: payload.invoice_id,
                receipt_id: Uuid::new_v4(),
                receipt_number: format!("RCT-{}", &id.simple().to_string()[..10].to_uppercase()),
                amount_minor: payload.amount_minor,
                method: payload.method,
                cash_session_id: payload.cash_session_id,
                actor_user_id: ctx.user_id,
            },
        )
        .await
        .map_err(|_| ApiError::conflict("payment_create_failed", "Payment could not be saved."))?;
        Ok(object(payment))
    }

    pub async fn finalize_invoice(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
        payload: FinalizeInvoiceRequest,
    ) -> Result<ObjectResponse<InvoiceListItem>, ApiError> {
        common::require_billing_high_risk_access(ctx, self.facility_id())?;
        let _reason = common::normalize_text(payload.approval.reason, "reason")?;
        common::require_invoice_patient_access(&self.state, ctx, id).await?;
        let invoice = hms_db::billing::finalize_invoice(
            self.pool(),
            self.facility_id(),
            id,
            ctx.user_id,
            payload.approval.supervisor_user_id,
            Utc::now(),
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "invoice_finalization_failed",
                "Invoice could not be finalized.",
            )
        })?
        .ok_or_else(|| ApiError::not_found("invoice_not_found", "Invoice was not found."))?;
        Ok(object(invoice))
    }

    pub async fn reverse_payment(
        &self,
        ctx: &hms_access::RequestContext,
        payment_id: Uuid,
        payload: ReversePaymentRequest,
    ) -> Result<ObjectResponse<PaymentReversalLedgerEntry>, ApiError> {
        common::require_billing_high_risk_access(ctx, self.facility_id())?;
        common::require_positive(payload.amount_minor, "amount_minor")?;
        let reason = common::normalize_text(payload.approval.reason, "reason")?;
        let invoice_id =
            hms_db::billing::payment_invoice_id(self.pool(), self.facility_id(), payment_id)
                .await
                .map_err(|_| {
                    ApiError::conflict("payment_load_failed", "Payment could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("payment_not_found", "Payment was not found.")
                })?;
        common::require_invoice_patient_access(&self.state, ctx, invoice_id).await?;
        let reversal = hms_db::billing::record_payment_reversal(
            self.pool(),
            NewPaymentReversal {
                id: Uuid::new_v4(),
                facility_id: self.facility_id(),
                payment_id,
                reversal_kind: payload.reversal_kind,
                amount_minor: payload.amount_minor,
                reason,
                approved_by_user_id: payload.approval.supervisor_user_id,
                recorded_by_user_id: ctx.user_id,
                reauthorized_at: Utc::now(),
                request_id: Some(ctx.request_id.clone()),
            },
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "payment_reversal_failed",
                "Payment reversal could not be recorded.",
            )
        })?;
        Ok(object(reversal))
    }

    pub async fn record_discharge_clearance(
        &self,
        ctx: &hms_access::RequestContext,
        patient_id: Uuid,
    ) -> Result<ObjectResponse<BillingDischargeClearance>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingManage)?;
        let _patient = common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        let clearance = hms_db::billing::record_discharge_billing_clearance(
            self.pool(),
            self.facility_id(),
            patient_id,
            ctx.user_id,
        )
        .await
        .map_err(|_| {
            ApiError::conflict(
                "billing_discharge_clearance_failed",
                "Billing clearance could not be recorded.",
            )
        })?;
        Ok(object(clearance))
    }

    pub async fn list_receipts(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingListQuery,
    ) -> Result<ListResponse<ReceiptListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::page_request(query)?;
        let rows = hms_db::billing::list_receipts(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| ApiError::conflict("receipt_list_failed", "Receipts could not be loaded."))?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.issued_at, item.id)
        }))
    }

    pub async fn get_receipt(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ReceiptListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let receipt = hms_db::billing::get_receipt(self.pool(), self.facility_id(), id)
            .await
            .map_err(|_| ApiError::conflict("receipt_load_failed", "Receipt could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("receipt_not_found", "Receipt was not found."))?;
        common::require_invoice_patient_access(&self.state, ctx, receipt.invoice_id).await?;

        Ok(object(receipt))
    }

    pub async fn get_receipt_by_number(
        &self,
        ctx: &hms_access::RequestContext,
        receipt_number: String,
    ) -> Result<ObjectResponse<ReceiptListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let receipt = hms_db::billing::get_receipt_by_number(
            self.pool(),
            self.facility_id(),
            &receipt_number,
        )
        .await
        .map_err(|_| ApiError::conflict("receipt_load_failed", "Receipt could not be loaded."))?
        .ok_or_else(|| ApiError::not_found("receipt_not_found", "Receipt was not found."))?;
        common::require_invoice_patient_access(&self.state, ctx, receipt.invoice_id).await?;

        Ok(object(receipt))
    }

    pub async fn get_receipt_by_payment(
        &self,
        ctx: &hms_access::RequestContext,
        payment_id: Uuid,
    ) -> Result<ObjectResponse<ReceiptListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let receipt =
            hms_db::billing::get_receipt_by_payment(self.pool(), self.facility_id(), payment_id)
                .await
                .map_err(|_| {
                    ApiError::conflict("receipt_load_failed", "Receipt could not be loaded.")
                })?
                .ok_or_else(|| {
                    ApiError::not_found("receipt_not_found", "Receipt was not found.")
                })?;
        common::require_invoice_patient_access(&self.state, ctx, receipt.invoice_id).await?;

        Ok(object(receipt))
    }
}
