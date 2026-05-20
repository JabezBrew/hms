use axum::routing::get;
use axum::Router;

use crate::handlers::billing;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v2/billing/service-catalog",
            get(billing::list_service_catalog),
        )
        .route(
            "/api/v2/billing/service-prices",
            get(billing::list_service_prices),
        )
        .route("/api/v2/billing/rules", get(billing::list_billing_rules))
        .route("/api/v2/billing/rules/:id", get(billing::get_billing_rule))
        .route(
            "/api/v2/billing/dashboard-summary",
            get(billing::dashboard_summary),
        )
        .route(
            "/api/v2/billing/invoices",
            get(billing::list_invoices).post(billing::create_invoice),
        )
        .route("/api/v2/billing/invoices/:id", get(billing::get_invoice))
        .route(
            "/api/v2/billing/invoices/:id/finalize",
            axum::routing::post(billing::finalize_invoice),
        )
        .route(
            "/api/v2/billing/payments",
            get(billing::list_payments).post(billing::create_payment),
        )
        .route(
            "/api/v2/billing/payments/:id/reverse",
            axum::routing::post(billing::reverse_payment),
        )
        .route(
            "/api/v2/billing/payments/:id/receipt",
            get(billing::get_receipt_by_payment),
        )
        .route(
            "/api/v2/billing/discharge-clearances/:patient_id",
            axum::routing::post(billing::record_discharge_clearance),
        )
        .route("/api/v2/billing/receipts", get(billing::list_receipts))
        .route("/api/v2/billing/receipts/:id", get(billing::get_receipt))
        .route(
            "/api/v2/billing/receipts/by-number/:receipt_number",
            get(billing::get_receipt_by_number),
        )
        .route(
            "/api/v2/billing/cash-drawers",
            get(billing::list_cash_drawers),
        )
        .route(
            "/api/v2/billing/cash-sessions",
            get(billing::list_cash_sessions).post(billing::open_cash_session),
        )
        .route(
            "/api/v2/billing/cash-sessions/:id",
            get(billing::get_cash_session),
        )
        .route(
            "/api/v2/billing/cash-sessions/:id/close",
            axum::routing::post(billing::close_cash_session),
        )
        .route(
            "/api/v2/nhis/claims",
            get(billing::list_claims).post(billing::create_claim),
        )
        .route("/api/v2/nhis/claims/:id", get(billing::get_claim))
        .route(
            "/api/v2/nhis/claims/:id/ar-state",
            get(billing::get_claim_ar_state),
        )
        .route(
            "/api/v2/nhis/claims/:id/ar-adjustments",
            axum::routing::post(billing::record_claim_ar_adjustment),
        )
        .route(
            "/api/v2/nhis/service-mappings",
            axum::routing::post(billing::create_nhis_service_mapping),
        )
        .route(
            "/api/v2/nhis/batches",
            get(billing::list_batches).post(billing::create_batch),
        )
        .route(
            "/api/v2/nhis/batches/:id/export",
            axum::routing::post(billing::export_batch),
        )
        .route(
            "/api/v2/nhis/remittance-imports",
            get(billing::list_remittance_imports).post(billing::create_remittance_import),
        )
}
