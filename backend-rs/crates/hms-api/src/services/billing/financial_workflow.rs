use hms_domain::billing::{
    BillingListQuery, CreateInvoiceRequest, CreatePaymentRequest, InvoiceListItem, PaymentListItem,
    ReceiptListItem,
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

    pub async fn list_invoices(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingListQuery,
    ) -> Result<ListResponse<InvoiceListItem>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let patient_id = query.patient_id;
        if let Some(patient_id) = patient_id {
            let _patient = common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let (cursor, page_size) = common::page_request(query)?;
        let rows = self
            .state
            .list_billing_invoices(patient_id, cursor, page_size as i64 + 1)
            .await
            .map_err(|_| {
                ApiError::conflict("invoice_list_failed", "Invoices could not be loaded.")
            })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.issued_at, item.id)
        }))
    }

    pub async fn get_invoice(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<InvoiceListItem>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let invoice = self
            .state
            .get_billing_invoice(id)
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
        common::require_billing_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::BillingManage,
        )?;
        common::require_positive(payload.quantity, "quantity")?;
        let _patient =
            common::load_patient_for_access(&self.state, ctx, payload.patient_id).await?;
        let invoice = self
            .state
            .create_billing_invoice(
                payload.patient_id,
                payload.service_price_id,
                payload.quantity,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict("invoice_create_failed", "Invoice could not be saved.")
            })?;
        Ok(object(invoice))
    }

    pub async fn list_payments(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingListQuery,
    ) -> Result<ListResponse<PaymentListItem>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::page_request(query)?;
        let rows = self
            .state
            .list_billing_payments(cursor, page_size as i64 + 1)
            .await
            .map_err(|_| {
                ApiError::conflict("payment_list_failed", "Payments could not be loaded.")
            })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.paid_at, item.id)
        }))
    }

    pub async fn create_payment(
        &self,
        ctx: &hms_access::RequestContext,
        payload: CreatePaymentRequest,
    ) -> Result<ObjectResponse<PaymentListItem>, ApiError> {
        common::require_billing_access(
            ctx,
            self.state.facility_id(),
            PermissionCode::BillingManage,
        )?;
        common::require_positive(payload.amount_minor, "amount_minor")?;
        common::require_invoice_patient_access(&self.state, ctx, payload.invoice_id).await?;
        let payment = self
            .state
            .create_billing_payment(
                payload.invoice_id,
                payload.amount_minor,
                payload.method,
                payload.cash_session_id,
                ctx.user_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict("payment_create_failed", "Payment could not be saved.")
            })?;
        Ok(object(payment))
    }

    pub async fn list_receipts(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingListQuery,
    ) -> Result<ListResponse<ReceiptListItem>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::page_request(query)?;
        let rows = self
            .state
            .list_billing_receipts(cursor, page_size as i64 + 1)
            .await
            .map_err(|_| {
                ApiError::conflict("receipt_list_failed", "Receipts could not be loaded.")
            })?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.issued_at, item.id)
        }))
    }

    pub async fn get_receipt(
        &self,
        ctx: &hms_access::RequestContext,
        id: Uuid,
    ) -> Result<ObjectResponse<ReceiptListItem>, ApiError> {
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let receipt = self
            .state
            .get_billing_receipt(id)
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
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let receipt = self
            .state
            .get_billing_receipt_by_number(&receipt_number)
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
        common::require_billing_access(ctx, self.state.facility_id(), PermissionCode::BillingView)?;
        let receipt = self
            .state
            .get_billing_receipt_by_payment(payment_id)
            .await
            .map_err(|_| ApiError::conflict("receipt_load_failed", "Receipt could not be loaded."))?
            .ok_or_else(|| ApiError::not_found("receipt_not_found", "Receipt was not found."))?;
        common::require_invoice_patient_access(&self.state, ctx, receipt.invoice_id).await?;

        Ok(object(receipt))
    }
}
