use hms_db::billing::{NewInvoice, NewPayment};
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

    fn facility_id(&self) -> Uuid {
        self.state.facility_id()
    }

    fn pool(&self) -> &hms_db::PgPool {
        self.state.db_pool()
    }

    pub async fn list_invoices(
        &self,
        ctx: &hms_access::RequestContext,
        query: BillingListQuery,
    ) -> Result<ListResponse<InvoiceListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let patient_id = query.patient_id;
        if let Some(patient_id) = patient_id {
            let _patient = common::load_patient_for_access(&self.state, ctx, patient_id).await?;
        }
        let (cursor, page_size) = common::page_request(query)?;
        let rows = hms_db::billing::list_invoices(
            self.pool(),
            self.facility_id(),
            patient_id,
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
        query: BillingListQuery,
    ) -> Result<ListResponse<PaymentListItem>, ApiError> {
        common::require_billing_access(ctx, self.facility_id(), PermissionCode::BillingView)?;
        let (cursor, page_size) = common::page_request(query)?;
        let rows = hms_db::billing::list_payments(
            self.pool(),
            self.facility_id(),
            cursor,
            page_size as i64 + 1,
        )
        .await
        .map_err(|_| ApiError::conflict("payment_list_failed", "Payments could not be loaded."))?;
        Ok(common::page_response(rows, page_size, |item| {
            common::encode_cursor(item.paid_at, item.id)
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
