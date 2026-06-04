use chrono::{DateTime, NaiveDate, Utc};
use hms_domain::billing::{
    BillingDashboardSummary, BillingDischargeClearance, BillingRuleListItem, BillingRuleType,
    CashDrawerListItem, CashSessionListItem, CashSessionStatus, ClaimListItem, ClaimStatus,
    InsurancePlanListItem, InsuranceProviderListItem, InvoiceListItem, InvoiceLockReason,
    InvoiceLockState, InvoiceStatus, NhisArAdjustmentEntry, NhisArAdjustmentKind, NhisBatchExport,
    NhisBatchListItem, NhisBatchStatus, NhisClaimArState, NhisExportJobListItem,
    NhisServiceMappingListItem, PatientInsuranceListItem, PaymentListItem, PaymentMethod,
    PaymentReversalLedgerEntry, PaymentStatus, PspPaymentIntentListItem,
    PspSettlementBatchListItem, PspSettlementLineListItem, ReceiptListItem,
    RemittanceImportListItem, RemittanceImportStatus, RemittanceLineListItem, ReversalKind,
    ServiceCatalogItem, ServiceKind, ServicePriceListItem,
};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::codec;
use crate::PgPool;

#[derive(Clone, Debug)]
pub struct BillingCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Clone, Debug)]
pub struct InvoiceContext {
    pub id: Uuid,
    pub patient_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct ClaimContext {
    pub id: Uuid,
    pub patient_id: Uuid,
}

#[derive(Clone, Debug, Default)]
pub struct ServiceCatalogFilters {
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub service_id: Option<Uuid>,
}

#[derive(Clone, Debug, Default)]
pub struct BillingRuleFilters {
    pub rule_type: Option<BillingRuleType>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct InvoiceListFilters {
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<InvoiceStatus>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Clone, Debug, Default)]
pub struct PaymentListFilters {
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<PaymentStatus>,
    pub payment_method: Option<PaymentMethod>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Clone, Debug, Default)]
pub struct ClaimListFilters {
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub status: Option<ClaimStatus>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Clone, Debug)]
pub struct NewInvoice {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub patient_id: Uuid,
    pub service_price_id: Uuid,
    pub quantity: i64,
    pub invoice_number: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewPayment {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub invoice_id: Uuid,
    pub receipt_id: Uuid,
    pub receipt_number: String,
    pub amount_minor: i64,
    pub method: PaymentMethod,
    pub cash_session_id: Option<Uuid>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, Default)]
pub struct CashSessionFilters {
    pub status: Option<CashSessionStatus>,
    pub search: Option<String>,
    pub is_flagged: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct InsuranceProviderFilters {
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct InsurancePlanFilters {
    pub provider_id: Option<Uuid>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct PatientInsuranceFilters {
    pub patient_id: Option<Uuid>,
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub search_sensitive_identifiers: bool,
}

#[derive(Clone, Debug, Default)]
pub struct NhisServiceMappingFilters {
    pub payer_id: Option<Uuid>,
    pub search: Option<String>,
    pub active: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct PspPaymentIntentFilters {
    pub status: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct PspSettlementBatchFilters {
    pub status: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct PspSettlementLineFilters {
    pub match_status: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct RemittanceLineFilters {
    pub match_status: Option<String>,
    pub search: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewClaim {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub invoice_id: Uuid,
    pub claim_number: String,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewNhisBatch {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub batch_number: String,
    pub claim_ids: Vec<Uuid>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewRemittanceImport {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub batch_id: Uuid,
    pub reference: String,
    pub total_paid_minor: i64,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewPaymentReversal {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub payment_id: Uuid,
    pub reversal_kind: ReversalKind,
    pub amount_minor: i64,
    pub reason: String,
    pub approved_by_user_id: Uuid,
    pub recorded_by_user_id: Uuid,
    pub reauthorized_at: DateTime<Utc>,
    pub request_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NhisBatchExportCommand {
    pub facility_id: Uuid,
    pub batch_id: Uuid,
    pub actor_user_id: Uuid,
    pub request_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewNhisServiceMapping {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub payer_id: Option<Uuid>,
    pub service_id: Uuid,
    pub nhis_code: String,
    pub effective_from: NaiveDate,
    pub effective_until: Option<NaiveDate>,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewNhisArAdjustment {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub claim_id: Uuid,
    pub adjustment_kind: NhisArAdjustmentKind,
    pub amount_minor: i64,
    pub reason: String,
    pub recorded_by_user_id: Uuid,
}

#[derive(Clone, Debug)]
pub struct NewCashSession {
    pub id: Uuid,
    pub facility_id: Uuid,
    pub drawer_id: Uuid,
    pub opening_float_minor: i64,
    pub actor_user_id: Uuid,
}

#[derive(Clone, Debug, FromRow)]
struct ServiceRow {
    id: Uuid,
    code: String,
    name: String,
    service_kind: String,
    active: bool,
    active_price_id: Option<Uuid>,
    active_price_amount_minor: Option<i64>,
    active_price_currency: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ServicePriceRow {
    id: Uuid,
    service_id: Uuid,
    service_code: String,
    service_name: String,
    amount_minor: i64,
    currency: String,
    active: bool,
}

#[derive(Clone, Debug, FromRow)]
struct BillingRuleRow {
    id: Uuid,
    code: String,
    name: String,
    rule_type: String,
    active: bool,
}

#[derive(Clone, Debug, FromRow)]
struct BillingDashboardSummaryRow {
    revenue_today_minor: i64,
    revenue_this_week_minor: i64,
    outstanding_amount_minor: i64,
    outstanding_invoices: i64,
    pending_claims: i64,
    pending_claims_amount_minor: i64,
    invoices_created_today: i64,
    payments_received_today: i64,
    unique_patients_billed: i64,
    average_invoice_amount_minor: i64,
}

#[derive(Clone, Debug, FromRow)]
struct InvoiceRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    invoice_number: String,
    status: String,
    gross_amount_minor: i64,
    paid_amount_minor: i64,
    currency: String,
    issued_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PaymentRow {
    id: Uuid,
    invoice_id: Uuid,
    invoice_number: String,
    patient_id: Uuid,
    patient_code: String,
    receipt_number: String,
    amount_minor: i64,
    currency: String,
    method: String,
    status: String,
    paid_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ReceiptRow {
    id: Uuid,
    payment_id: Uuid,
    invoice_id: Uuid,
    receipt_number: String,
    amount_minor: i64,
    currency: String,
    issued_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ClaimRow {
    id: Uuid,
    invoice_id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    claim_number: String,
    status: String,
    amount_minor: i64,
    currency: String,
    nhis_service_mapping_id: Option<Uuid>,
    nhis_service_mapping_version: Option<i64>,
    nhis_service_code: Option<String>,
    payer_receivable_minor: i64,
    patient_liability_minor: i64,
    written_off_minor: i64,
    reconciled_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct BatchRow {
    id: Uuid,
    batch_number: String,
    status: String,
    claim_count: i64,
    total_amount_minor: i64,
    currency: String,
    exported_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct RemittanceRow {
    id: Uuid,
    batch_id: Uuid,
    reference: String,
    status: String,
    total_paid_minor: i64,
    currency: String,
    imported_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct CashDrawerRow {
    id: Uuid,
    code: String,
    name: String,
    active: bool,
}

#[derive(Clone, Debug, FromRow)]
struct CashSessionRow {
    id: Uuid,
    drawer_id: Uuid,
    drawer_code: String,
    opened_by_user_id: Uuid,
    opened_by_display_name: Option<String>,
    status: String,
    opening_float_minor: i64,
    expected_cash_minor: i64,
    counted_cash_minor: Option<i64>,
    variance_minor: Option<i64>,
    currency: String,
    opened_at: DateTime<Utc>,
    closed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct InsuranceProviderRow {
    id: Uuid,
    code: String,
    name: String,
    payer_type: String,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct InsurancePlanRow {
    id: Uuid,
    provider_id: Uuid,
    provider_name: String,
    code: String,
    name: String,
    coverage_percentage: i32,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PatientInsuranceRow {
    id: Uuid,
    patient_id: Uuid,
    patient_code: String,
    patient_name: String,
    provider_id: Uuid,
    provider_name: String,
    plan_id: Uuid,
    plan_name: String,
    policy_number: String,
    member_id: Option<String>,
    subscriber_number: Option<String>,
    valid_from: NaiveDate,
    valid_until: Option<NaiveDate>,
    is_active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PriceContextRow {
    service_name: String,
    amount_minor: i64,
    currency: String,
}

#[derive(Clone, Debug, FromRow)]
struct InvoiceContextRow {
    patient_id: Uuid,
    gross_amount_minor: i64,
    paid_amount_minor: i64,
    currency: String,
}

#[derive(Clone, Debug, FromRow)]
struct ClaimAmountRow {
    id: Uuid,
    amount_minor: i64,
    currency: String,
}

#[derive(Clone, Debug, FromRow)]
struct BatchExportRow {
    batch_number: String,
    claim_count: i64,
    total_amount_minor: i64,
}

#[derive(Clone, Debug, FromRow)]
struct InvoiceLockStateRow {
    invoice_id: Uuid,
    locked_at: Option<DateTime<Utc>>,
    locked_reason: Option<String>,
    finalized_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct PaymentReversalRow {
    id: Uuid,
    payment_id: Uuid,
    invoice_id: Uuid,
    reversal_kind: String,
    amount_minor: i64,
    currency: String,
    reason: String,
    approved_by_user_id: Uuid,
    recorded_by_user_id: Uuid,
    reauthorized_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PaymentReversalContextRow {
    invoice_id: Uuid,
    amount_minor: i64,
    reversed_amount_minor: i64,
    currency: String,
}

#[derive(Clone, Debug, FromRow)]
struct NhisServiceMappingRow {
    id: Uuid,
    payer_id: Option<Uuid>,
    service_id: Uuid,
    service_code: String,
    service_name: String,
    nhis_code: String,
    version_number: i64,
    effective_from: NaiveDate,
    effective_until: Option<NaiveDate>,
    active: bool,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PspPaymentIntentRow {
    id: Uuid,
    invoice_id: Option<Uuid>,
    invoice_number: Option<String>,
    provider: String,
    provider_reference: Option<String>,
    client_reference: Option<String>,
    status: String,
    payment_method: String,
    amount_minor: i64,
    currency: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PspSettlementBatchRow {
    id: Uuid,
    provider: String,
    statement_date: Option<NaiveDate>,
    file_name: Option<String>,
    status: String,
    line_count: i64,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct PspSettlementLineRow {
    id: Uuid,
    batch_id: Uuid,
    provider_reference: Option<String>,
    client_reference: Option<String>,
    amount_gross_minor: i64,
    fee_amount_minor: i64,
    amount_net_minor: i64,
    paid_at: Option<DateTime<Utc>>,
    status: String,
    match_status: String,
    mismatch_reason: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct NhisExportJobRow {
    id: Uuid,
    batch_id: Uuid,
    batch_number: String,
    status: String,
    checksum: Option<String>,
    created_at: DateTime<Utc>,
    expires_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct RemittanceLineRow {
    id: Uuid,
    import_id: Uuid,
    claim_number: Option<String>,
    invoice_number: Option<String>,
    paid_amount_minor: i64,
    paid_date: Option<NaiveDate>,
    match_status: String,
    mismatch_reason: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct ClaimMappingContextRow {
    mapping_id: Option<Uuid>,
    version_number: Option<i64>,
    nhis_code: Option<String>,
}

#[derive(Clone, Debug, FromRow)]
struct NhisClaimArStateRow {
    claim_id: Uuid,
    payer_receivable_minor: i64,
    patient_liability_minor: i64,
    written_off_minor: i64,
    reconciled_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
struct NhisArAdjustmentRow {
    id: Uuid,
    claim_id: Uuid,
    adjustment_kind: String,
    amount_minor: i64,
    reason: String,
    affects_patient_liability: bool,
    recorded_by_user_id: Uuid,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow)]
struct BillingDischargeClearanceRow {
    id: Uuid,
    patient_id: Uuid,
    cleared: bool,
    outstanding_invoice_count: i64,
    outstanding_amount_minor: i64,
    currency: String,
    reason: String,
    recorded_by_user_id: Uuid,
    created_at: DateTime<Utc>,
}

pub async fn list_service_catalog(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: ServiceCatalogFilters,
) -> anyhow::Result<Vec<ServiceCatalogItem>> {
    let mut query = QueryBuilder::new(
        r#"
        WITH service_page AS MATERIALIZED (
            SELECT service_catalog.id,
                   service_catalog.facility_id,
                   service_catalog.code,
                   service_catalog.name,
                   service_catalog.service_kind,
                   service_catalog.active,
                   service_catalog.created_at
            FROM service_catalog
            WHERE service_catalog.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(is_active) = filters.is_active {
        query.push(" AND service_catalog.active = ");
        query.push_bind(is_active);
    }
    if let Some(service_id) = filters.service_id {
        query.push(" AND service_catalog.id = ");
        query.push_bind(service_id);
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (service_catalog.name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR service_catalog.code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR service_catalog.service_kind ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(
        &mut query,
        "service_catalog.created_at",
        "service_catalog.id",
        cursor,
    );
    query.push(
        r#"
            ORDER BY service_catalog.created_at DESC, service_catalog.id DESC
            LIMIT
        "#,
    );
    query.push_bind(limit);
    query.push(
        r#"
        )
        SELECT service_page.id,
               service_page.code,
               service_page.name,
               service_page.service_kind,
               service_page.active,
               active_prices.id AS active_price_id,
               active_prices.amount_minor AS active_price_amount_minor,
               active_prices.currency AS active_price_currency,
               service_page.created_at
        FROM service_page
        LEFT JOIN LATERAL (
            SELECT service_prices.id, service_prices.amount_minor, service_prices.currency
            FROM service_prices
            WHERE service_prices.facility_id = service_page.facility_id
              AND service_prices.service_id = service_page.id
              AND service_prices.active = TRUE
            ORDER BY service_prices.created_at DESC, service_prices.id DESC
            LIMIT 1
        ) active_prices ON TRUE
        "#,
    );
    query.push(" ORDER BY service_page.created_at DESC, service_page.id DESC");
    let rows = query.build_query_as::<ServiceRow>().fetch_all(pool).await?;
    rows.into_iter().map(service_from_row).collect()
}

pub async fn list_service_prices(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<ServicePriceListItem>> {
    let rows = sqlx::query_as::<_, ServicePriceRow>(
        r#"
        SELECT service_prices.id,
               service_prices.service_id,
               service_catalog.code AS service_code,
               service_catalog.name AS service_name,
               service_prices.amount_minor,
               service_prices.currency,
               service_prices.active
        FROM service_prices
        INNER JOIN service_catalog ON service_catalog.id = service_prices.service_id
        WHERE service_prices.facility_id = $1
        ORDER BY service_catalog.code ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(price_from_row).collect())
}

pub async fn list_billing_rules(
    pool: &PgPool,
    facility_id: Uuid,
    filters: BillingRuleFilters,
    limit: i64,
) -> anyhow::Result<Vec<BillingRuleListItem>> {
    let mut query = QueryBuilder::new(
        "SELECT id, code, name, rule_type, active
         FROM billing_rules
         WHERE facility_id = ",
    );
    query.push_bind(facility_id);
    if let Some(rule_type) = filters.rule_type {
        query.push(" AND rule_type = ");
        query.push_bind(codec::encode(rule_type)?);
    }
    if let Some(is_active) = filters.is_active {
        query.push(" AND active = ");
        query.push_bind(is_active);
    }
    query.push(" ORDER BY code ASC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<BillingRuleRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(rule_from_row).collect()
}

pub async fn get_billing_rule(
    pool: &PgPool,
    facility_id: Uuid,
    rule_id: Uuid,
) -> anyhow::Result<Option<BillingRuleListItem>> {
    let row = sqlx::query_as::<_, BillingRuleRow>(
        r#"
        SELECT id, code, name, rule_type, active
        FROM billing_rules
        WHERE facility_id = $1 AND id = $2
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .bind(rule_id)
    .fetch_optional(pool)
    .await?;
    row.map(rule_from_row).transpose()
}

pub async fn billing_dashboard_summary(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<BillingDashboardSummary> {
    let payment_recorded = codec::encode(PaymentStatus::Recorded)?;
    let invoice_void = codec::encode(InvoiceStatus::Void)?;
    let claim_draft = codec::encode(ClaimStatus::Draft)?;
    let claim_ready = codec::encode(ClaimStatus::Ready)?;
    let claim_submitted = codec::encode(ClaimStatus::Submitted)?;

    let row = sqlx::query_as::<_, BillingDashboardSummaryRow>(
        r#"
        WITH bounds AS (
            SELECT date_trunc('day', now()) AS today_start,
                   date_trunc('day', now()) + INTERVAL '1 day' AS tomorrow_start,
                   date_trunc('day', now()) - INTERVAL '6 days' AS week_start,
                   now() AS current_time
        ),
        invoice_metrics AS (
            SELECT COALESCE(SUM(gross_amount_minor - paid_amount_minor)
                       FILTER (WHERE gross_amount_minor > paid_amount_minor), 0)::BIGINT
                       AS outstanding_amount_minor,
                   (COUNT(*) FILTER (WHERE gross_amount_minor > paid_amount_minor))::BIGINT
                       AS outstanding_invoices,
                   (COUNT(*) FILTER (
                       WHERE issued_at >= bounds.today_start
                         AND issued_at < bounds.tomorrow_start
                   ))::BIGINT AS invoices_created_today,
                   (COUNT(DISTINCT patient_id) FILTER (
                       WHERE issued_at >= bounds.today_start
                         AND issued_at < bounds.tomorrow_start
                   ))::BIGINT AS unique_patients_billed,
                   COALESCE(ROUND(AVG(gross_amount_minor))::BIGINT, 0)::BIGINT
                       AS average_invoice_amount_minor
            FROM invoices
            CROSS JOIN bounds
            WHERE facility_id = $1
              AND status <> $3
        ),
        payment_metrics AS (
            SELECT COALESCE(SUM(amount_minor) FILTER (
                       WHERE paid_at >= bounds.today_start
                         AND paid_at < bounds.tomorrow_start
                         AND paid_at <= bounds.current_time
                   ), 0)::BIGINT AS revenue_today_minor,
                   COALESCE(SUM(amount_minor) FILTER (
                       WHERE paid_at >= bounds.week_start
                         AND paid_at <= bounds.current_time
                   ), 0)::BIGINT AS revenue_this_week_minor,
                   (COUNT(*) FILTER (
                       WHERE paid_at >= bounds.today_start
                         AND paid_at < bounds.tomorrow_start
                         AND paid_at <= bounds.current_time
                   ))::BIGINT AS payments_received_today
            FROM payments
            CROSS JOIN bounds
            WHERE facility_id = $1
              AND status = $2
        ),
        claim_metrics AS (
            SELECT COUNT(*)::BIGINT AS pending_claims,
                   COALESCE(SUM(amount_minor), 0)::BIGINT AS pending_claims_amount_minor
            FROM nhis_claims
            WHERE facility_id = $1
              AND status IN ($4, $5, $6)
        )
        SELECT payment_metrics.revenue_today_minor,
               payment_metrics.revenue_this_week_minor,
               invoice_metrics.outstanding_amount_minor,
               invoice_metrics.outstanding_invoices,
               claim_metrics.pending_claims,
               claim_metrics.pending_claims_amount_minor,
               invoice_metrics.invoices_created_today,
               payment_metrics.payments_received_today,
               invoice_metrics.unique_patients_billed,
               invoice_metrics.average_invoice_amount_minor
        FROM invoice_metrics
        CROSS JOIN payment_metrics
        CROSS JOIN claim_metrics
        "#,
    )
    .bind(facility_id)
    .bind(payment_recorded)
    .bind(invoice_void)
    .bind(claim_draft)
    .bind(claim_ready)
    .bind(claim_submitted)
    .fetch_one(pool)
    .await?;

    Ok(BillingDashboardSummary {
        revenue_today_minor: row.revenue_today_minor,
        revenue_this_week_minor: row.revenue_this_week_minor,
        outstanding_amount_minor: row.outstanding_amount_minor,
        outstanding_invoices: row.outstanding_invoices,
        pending_claims: row.pending_claims,
        pending_claims_amount_minor: row.pending_claims_amount_minor,
        invoices_created_today: row.invoices_created_today,
        payments_received_today: row.payments_received_today,
        unique_patients_billed: row.unique_patients_billed,
        average_invoice_amount_minor: row.average_invoice_amount_minor,
    })
}

pub async fn list_invoices(
    pool: &PgPool,
    facility_id: Uuid,
    filters: InvoiceListFilters,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<InvoiceListItem>> {
    let mut query = invoice_query();
    query.push(" WHERE invoices.facility_id = ");
    query.push_bind(facility_id);
    push_invoice_filters(&mut query, filters)?;
    apply_cursor(&mut query, "invoices.issued_at", "invoices.id", cursor);
    query.push(" ORDER BY invoices.issued_at DESC, invoices.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<InvoiceRow>().fetch_all(pool).await?;
    rows.into_iter().map(invoice_from_row).collect()
}

pub async fn create_invoice(pool: &PgPool, invoice: NewInvoice) -> anyhow::Result<InvoiceListItem> {
    let price = sqlx::query_as::<_, PriceContextRow>(
        r#"
        SELECT service_catalog.name AS service_name,
               service_prices.amount_minor,
               service_prices.currency
        FROM service_prices
        INNER JOIN service_catalog ON service_catalog.id = service_prices.service_id
        WHERE service_prices.facility_id = $1
          AND service_prices.id = $2
          AND service_prices.active = TRUE
          AND service_catalog.active = TRUE
        "#,
    )
    .bind(invoice.facility_id)
    .bind(invoice.service_price_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("service price was not found"))?;
    let line_amount = price
        .amount_minor
        .checked_mul(invoice.quantity)
        .ok_or_else(|| anyhow::anyhow!("invoice amount overflow"))?;

    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO invoices (
            id, facility_id, patient_id, invoice_number, status, gross_amount_minor,
            paid_amount_minor, currency, issued_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)
        "#,
    )
    .bind(invoice.id)
    .bind(invoice.facility_id)
    .bind(invoice.patient_id)
    .bind(&invoice.invoice_number)
    .bind(codec::encode(InvoiceStatus::Issued)?)
    .bind(line_amount)
    .bind(&price.currency)
    .bind(invoice.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO invoice_lines (
            id, facility_id, invoice_id, service_price_id, description, quantity,
            unit_amount_minor, line_amount_minor, currency
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(invoice.facility_id)
    .bind(invoice.id)
    .bind(invoice.service_price_id)
    .bind(&price.service_name)
    .bind(invoice.quantity)
    .bind(price.amount_minor)
    .bind(line_amount)
    .bind(&price.currency)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_invoice_by_id(pool, invoice.facility_id, invoice.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created invoice was not found"))
}

pub async fn invoice_context(
    pool: &PgPool,
    facility_id: Uuid,
    invoice_id: Uuid,
) -> anyhow::Result<Option<InvoiceContext>> {
    let row = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT id, patient_id FROM invoices WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(invoice_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id, patient_id)| InvoiceContext { id, patient_id }))
}

pub async fn invoice_lock_state(
    pool: &PgPool,
    facility_id: Uuid,
    invoice_id: Uuid,
) -> anyhow::Result<Option<InvoiceLockState>> {
    let row = sqlx::query_as::<_, InvoiceLockStateRow>(
        r#"
        SELECT id AS invoice_id, locked_at, locked_reason, finalized_at
        FROM invoices
        WHERE facility_id = $1 AND id = $2
          AND locked_at IS NOT NULL
        "#,
    )
    .bind(facility_id)
    .bind(invoice_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(invoice_lock_state_from_row))
}

pub async fn list_payments(
    pool: &PgPool,
    facility_id: Uuid,
    filters: PaymentListFilters,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PaymentListItem>> {
    let mut query = payment_query();
    query.push(" WHERE payments.facility_id = ");
    query.push_bind(facility_id);
    push_payment_filters(&mut query, filters)?;
    apply_cursor(&mut query, "payments.paid_at", "payments.id", cursor);
    query.push(" ORDER BY payments.paid_at DESC, payments.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<PaymentRow>().fetch_all(pool).await?;
    rows.into_iter().map(payment_from_row).collect()
}

pub async fn payment_invoice_id(
    pool: &PgPool,
    facility_id: Uuid,
    payment_id: Uuid,
) -> anyhow::Result<Option<Uuid>> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT invoice_id FROM payments WHERE facility_id = $1 AND id = $2",
    )
    .bind(facility_id)
    .bind(payment_id)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
}

pub async fn create_payment(pool: &PgPool, payment: NewPayment) -> anyhow::Result<PaymentListItem> {
    let mut transaction = pool.begin().await?;
    let invoice = sqlx::query_as::<_, InvoiceContextRow>(
        r#"
        SELECT patient_id, gross_amount_minor, paid_amount_minor, currency
        FROM invoices
        WHERE facility_id = $1 AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(payment.facility_id)
    .bind(payment.invoice_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| anyhow::anyhow!("invoice was not found"))?;
    let balance = invoice.gross_amount_minor - invoice.paid_amount_minor;
    if payment.amount_minor <= 0 || payment.amount_minor > balance {
        anyhow::bail!("payment amount is invalid for invoice balance");
    }

    if matches!(payment.method, PaymentMethod::Cash) {
        let Some(cash_session_id) = payment.cash_session_id else {
            anyhow::bail!("cash session is required for cash payments");
        };
        let open = sqlx::query_as::<_, (Uuid,)>(
            r#"
            SELECT id
            FROM cash_sessions
            WHERE facility_id = $1 AND id = $2 AND status = $3
            "#,
        )
        .bind(payment.facility_id)
        .bind(cash_session_id)
        .bind(codec::encode(CashSessionStatus::Open)?)
        .fetch_optional(&mut *transaction)
        .await?;
        if open.is_none() {
            anyhow::bail!("cash session is not open");
        }
    }

    sqlx::query(
        r#"
        INSERT INTO payments (
            id, facility_id, invoice_id, cash_session_id, receipt_number, amount_minor,
            currency, method, status, recorded_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(payment.id)
    .bind(payment.facility_id)
    .bind(payment.invoice_id)
    .bind(payment.cash_session_id)
    .bind(&payment.receipt_number)
    .bind(payment.amount_minor)
    .bind(&invoice.currency)
    .bind(codec::encode(payment.method)?)
    .bind(codec::encode(PaymentStatus::Recorded)?)
    .bind(payment.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO receipts (
            id, facility_id, payment_id, invoice_id, receipt_number, amount_minor, currency
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(payment.receipt_id)
    .bind(payment.facility_id)
    .bind(payment.id)
    .bind(payment.invoice_id)
    .bind(&payment.receipt_number)
    .bind(payment.amount_minor)
    .bind(&invoice.currency)
    .execute(&mut *transaction)
    .await?;

    let paid_amount = invoice.paid_amount_minor + payment.amount_minor;
    let status = if paid_amount >= invoice.gross_amount_minor {
        InvoiceStatus::Paid
    } else {
        InvoiceStatus::PartiallyPaid
    };
    sqlx::query(
        r#"
        UPDATE invoices
        SET paid_amount_minor = $1,
            status = $2,
            locked_at = COALESCE(locked_at, now()),
            locked_reason = COALESCE(locked_reason, $3),
            updated_at = now()
        WHERE facility_id = $4 AND id = $5
        "#,
    )
    .bind(paid_amount)
    .bind(codec::encode(status)?)
    .bind(codec::encode(InvoiceLockReason::PaymentRecorded)?)
    .bind(payment.facility_id)
    .bind(payment.invoice_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_payment_by_id(pool, payment.facility_id, payment.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created payment was not found"))
}

pub async fn list_receipts(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ReceiptListItem>> {
    let mut query = receipt_query();
    query.push(" WHERE receipts.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(&mut query, "receipts.issued_at", "receipts.id", cursor);
    query.push(" ORDER BY receipts.issued_at DESC, receipts.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<ReceiptRow>().fetch_all(pool).await?;
    Ok(rows.into_iter().map(receipt_from_row).collect())
}

pub async fn get_receipt(
    pool: &PgPool,
    facility_id: Uuid,
    receipt_id: Uuid,
) -> anyhow::Result<Option<ReceiptListItem>> {
    fetch_receipt_by_id(pool, facility_id, receipt_id).await
}

pub async fn get_receipt_by_number(
    pool: &PgPool,
    facility_id: Uuid,
    receipt_number: &str,
) -> anyhow::Result<Option<ReceiptListItem>> {
    fetch_receipt_by_number(pool, facility_id, receipt_number).await
}

pub async fn get_receipt_by_payment(
    pool: &PgPool,
    facility_id: Uuid,
    payment_id: Uuid,
) -> anyhow::Result<Option<ReceiptListItem>> {
    fetch_receipt_by_payment(pool, facility_id, payment_id).await
}

pub async fn list_claims(
    pool: &PgPool,
    facility_id: Uuid,
    filters: ClaimListFilters,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ClaimListItem>> {
    let mut query = claim_query();
    query.push(" WHERE nhis_claims.facility_id = ");
    query.push_bind(facility_id);
    push_claim_filters(&mut query, filters)?;
    apply_cursor(
        &mut query,
        "nhis_claims.created_at",
        "nhis_claims.id",
        cursor,
    );
    query.push(" ORDER BY nhis_claims.created_at DESC, nhis_claims.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<ClaimRow>().fetch_all(pool).await?;
    rows.into_iter().map(claim_from_row).collect()
}

pub async fn get_claim(
    pool: &PgPool,
    facility_id: Uuid,
    claim_id: Uuid,
) -> anyhow::Result<Option<ClaimListItem>> {
    fetch_claim_by_id(pool, facility_id, claim_id).await
}

pub async fn create_claim(pool: &PgPool, claim: NewClaim) -> anyhow::Result<ClaimListItem> {
    let mut transaction = pool.begin().await?;
    let invoice = sqlx::query_as::<_, InvoiceContextRow>(
        r#"
        SELECT patient_id, gross_amount_minor, paid_amount_minor, currency
        FROM invoices
        WHERE facility_id = $1 AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(claim.facility_id)
    .bind(claim.invoice_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| anyhow::anyhow!("invoice was not found"))?;
    let mapping =
        claim_mapping_context(&mut transaction, claim.facility_id, claim.invoice_id).await?;

    sqlx::query(
        r#"
        INSERT INTO nhis_claims (
            id, facility_id, invoice_id, patient_id, claim_number, status,
            amount_minor, currency, nhis_service_mapping_id, nhis_service_mapping_version,
            nhis_service_code, payer_receivable_minor, patient_liability_minor, written_off_minor,
            created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, $13)
        "#,
    )
    .bind(claim.id)
    .bind(claim.facility_id)
    .bind(claim.invoice_id)
    .bind(invoice.patient_id)
    .bind(&claim.claim_number)
    .bind(codec::encode(ClaimStatus::Draft)?)
    .bind(invoice.gross_amount_minor)
    .bind(&invoice.currency)
    .bind(mapping.mapping_id)
    .bind(mapping.version_number)
    .bind(mapping.nhis_code)
    .bind(invoice.gross_amount_minor)
    .bind(claim.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    lock_invoice_in_transaction(
        &mut transaction,
        claim.facility_id,
        claim.invoice_id,
        InvoiceLockReason::ClaimCreated,
    )
    .await?;

    transaction.commit().await?;
    fetch_claim_by_id(pool, claim.facility_id, claim.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created claim was not found"))
}

pub async fn claim_contexts(
    pool: &PgPool,
    facility_id: Uuid,
    claim_ids: &[Uuid],
) -> anyhow::Result<Vec<ClaimContext>> {
    if claim_ids.is_empty() {
        return Ok(vec![]);
    }
    let rows = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"
        SELECT id, patient_id
        FROM nhis_claims
        WHERE facility_id = $1 AND id = ANY($2)
        "#,
    )
    .bind(facility_id)
    .bind(claim_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, patient_id)| ClaimContext { id, patient_id })
        .collect())
}

pub async fn list_nhis_batches(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<NhisBatchListItem>> {
    let mut query = batch_query();
    query.push(" WHERE nhis_batches.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(
        &mut query,
        "nhis_batches.created_at",
        "nhis_batches.id",
        cursor,
    );
    query.push(" ORDER BY nhis_batches.created_at DESC, nhis_batches.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<BatchRow>().fetch_all(pool).await?;
    rows.into_iter().map(batch_from_row).collect()
}

pub async fn create_nhis_batch(
    pool: &PgPool,
    batch: NewNhisBatch,
) -> anyhow::Result<NhisBatchListItem> {
    if batch.claim_ids.is_empty() || batch.claim_ids.len() > 100 {
        anyhow::bail!("claim set is invalid");
    }

    let mut transaction = pool.begin().await?;
    let claim_rows = sqlx::query_as::<_, ClaimAmountRow>(
        r#"
        SELECT id, amount_minor, currency
        FROM nhis_claims
        WHERE facility_id = $1 AND id = ANY($2)
        FOR UPDATE
        "#,
    )
    .bind(batch.facility_id)
    .bind(&batch.claim_ids)
    .fetch_all(&mut *transaction)
    .await?;
    if claim_rows.len() != batch.claim_ids.len() {
        anyhow::bail!("one or more claims were not found");
    }
    let currency = claim_rows
        .first()
        .map(|row| row.currency.clone())
        .unwrap_or_else(|| "GHS".to_owned());
    if claim_rows.iter().any(|row| row.currency != currency) {
        anyhow::bail!("mixed-currency claim batches are not supported");
    }
    let total_amount_minor = claim_rows.iter().map(|row| row.amount_minor).sum::<i64>();
    let claim_count = i64::try_from(claim_rows.len())?;

    sqlx::query(
        r#"
        INSERT INTO nhis_batches (
            id, facility_id, batch_number, status, claim_count, total_amount_minor,
            currency, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(batch.id)
    .bind(batch.facility_id)
    .bind(&batch.batch_number)
    .bind(codec::encode(NhisBatchStatus::Draft)?)
    .bind(claim_count)
    .bind(total_amount_minor)
    .bind(&currency)
    .bind(batch.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    for claim in &claim_rows {
        sqlx::query(
            r#"
            INSERT INTO nhis_batch_claims (batch_id, claim_id, facility_id)
            VALUES ($1, $2, $3)
            "#,
        )
        .bind(batch.id)
        .bind(claim.id)
        .bind(batch.facility_id)
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query(
        r#"
        UPDATE nhis_claims
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2 AND id = ANY($3)
        "#,
    )
    .bind(codec::encode(ClaimStatus::Ready)?)
    .bind(batch.facility_id)
    .bind(&batch.claim_ids)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_batch_by_id(pool, batch.facility_id, batch.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created NHIS batch was not found"))
}

pub async fn export_nhis_batch(
    pool: &PgPool,
    command: NhisBatchExportCommand,
) -> anyhow::Result<Option<NhisBatchExport>> {
    let facility_id = command.facility_id;
    let batch_id = command.batch_id;
    let row = sqlx::query_as::<_, BatchExportRow>(
        r#"
        SELECT batch_number, claim_count, total_amount_minor
        FROM nhis_batches
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(batch_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };

    let checksum = export_checksum(
        batch_id,
        &row.batch_number,
        row.claim_count,
        row.total_amount_minor,
    );
    let mut transaction = pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE nhis_batches
        SET status = $1,
            export_checksum = $2,
            exported_at = COALESCE(exported_at, now())
        WHERE facility_id = $3 AND id = $4
        "#,
    )
    .bind(codec::encode(NhisBatchStatus::Exported)?)
    .bind(&checksum)
    .bind(facility_id)
    .bind(batch_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE nhis_claims
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND id IN (
              SELECT claim_id
              FROM nhis_batch_claims
              WHERE facility_id = $2 AND batch_id = $3
          )
        "#,
    )
    .bind(codec::encode(ClaimStatus::Submitted)?)
    .bind(facility_id)
    .bind(batch_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        UPDATE invoices
        SET locked_at = COALESCE(locked_at, now()),
            locked_reason = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND id IN (
              SELECT nhis_claims.invoice_id
              FROM nhis_claims
              INNER JOIN nhis_batch_claims
                ON nhis_batch_claims.claim_id = nhis_claims.id
               AND nhis_batch_claims.facility_id = nhis_claims.facility_id
              WHERE nhis_claims.facility_id = $2
                AND nhis_batch_claims.batch_id = $3
          )
        "#,
    )
    .bind(codec::encode(InvoiceLockReason::NhisBatchExported)?)
    .bind(facility_id)
    .bind(batch_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO audit_events (
            id,
            facility_id,
            actor_user_id,
            request_id,
            event_type,
            resource_type,
            resource_id,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(facility_id)
    .bind(command.actor_user_id)
    .bind(command.request_id)
    .bind("billing.nhis_batch.exported")
    .bind("nhis_batch")
    .bind(batch_id)
    .bind(serde_json::json!({
        "severity": "high",
        "claim_count": row.claim_count,
        "total_amount_minor": row.total_amount_minor,
        "export_format": "nhis_v2_baseline_json"
    }))
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(Some(NhisBatchExport {
        batch_id,
        batch_number: row.batch_number,
        export_format: "nhis_v2_baseline_json".to_owned(),
        claim_count: row.claim_count,
        total_amount_minor: row.total_amount_minor,
        checksum,
    }))
}

pub async fn list_remittance_imports(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<RemittanceImportListItem>> {
    let mut query = remittance_query();
    query.push(" WHERE remittance_imports.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(
        &mut query,
        "remittance_imports.imported_at",
        "remittance_imports.id",
        cursor,
    );
    query.push(" ORDER BY remittance_imports.imported_at DESC, remittance_imports.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<RemittanceRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(remittance_from_row).collect()
}

pub async fn create_remittance_import(
    pool: &PgPool,
    import: NewRemittanceImport,
) -> anyhow::Result<RemittanceImportListItem> {
    let mut transaction = pool.begin().await?;
    let batch = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, currency FROM nhis_batches WHERE facility_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(import.facility_id)
    .bind(import.batch_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| anyhow::anyhow!("NHIS batch was not found"))?;

    sqlx::query(
        r#"
        INSERT INTO remittance_imports (
            id, facility_id, batch_id, reference, status, total_paid_minor, currency,
            imported_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(import.id)
    .bind(import.facility_id)
    .bind(import.batch_id)
    .bind(&import.reference)
    .bind(codec::encode(RemittanceImportStatus::Imported)?)
    .bind(import.total_paid_minor)
    .bind(&batch.1)
    .bind(import.actor_user_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query("UPDATE nhis_batches SET status = $1 WHERE facility_id = $2 AND id = $3")
        .bind(codec::encode(NhisBatchStatus::Remitted)?)
        .bind(import.facility_id)
        .bind(import.batch_id)
        .execute(&mut *transaction)
        .await?;

    sqlx::query(
        r#"
        UPDATE nhis_claims
        SET status = $1,
            updated_at = now()
        WHERE facility_id = $2
          AND id IN (
              SELECT claim_id
              FROM nhis_batch_claims
              WHERE facility_id = $2 AND batch_id = $3
          )
        "#,
    )
    .bind(codec::encode(ClaimStatus::Remitted)?)
    .bind(import.facility_id)
    .bind(import.batch_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_remittance_by_id(pool, import.facility_id, import.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created remittance import was not found"))
}

pub async fn finalize_invoice(
    pool: &PgPool,
    facility_id: Uuid,
    invoice_id: Uuid,
    actor_user_id: Uuid,
    approval_user_id: Uuid,
    reauthorized_at: DateTime<Utc>,
) -> anyhow::Result<Option<InvoiceListItem>> {
    if actor_user_id == approval_user_id {
        anyhow::bail!("billing finalization requires supervisor approval");
    }
    let result = sqlx::query(
        r#"
        UPDATE invoices
        SET locked_at = COALESCE(locked_at, now()),
            locked_reason = $1,
            finalized_at = COALESCE(finalized_at, now()),
            finalized_by_user_id = $2,
            finalized_approval_user_id = $3,
            finalized_reauthorized_at = $4,
            updated_at = now()
        WHERE facility_id = $5 AND id = $6
        "#,
    )
    .bind(codec::encode(InvoiceLockReason::Finalized)?)
    .bind(actor_user_id)
    .bind(approval_user_id)
    .bind(reauthorized_at)
    .bind(facility_id)
    .bind(invoice_id)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Ok(None);
    }
    fetch_invoice_by_id(pool, facility_id, invoice_id).await
}

pub async fn record_payment_reversal(
    pool: &PgPool,
    reversal: NewPaymentReversal,
) -> anyhow::Result<PaymentReversalLedgerEntry> {
    if reversal.approved_by_user_id == reversal.recorded_by_user_id {
        anyhow::bail!("payment reversal requires supervisor approval");
    }
    if reversal.amount_minor <= 0 {
        anyhow::bail!("payment reversal amount must be positive");
    }
    let reversal_kind = codec::encode(reversal.reversal_kind)?;
    let audit_event_type = match reversal.reversal_kind {
        ReversalKind::Refund => "billing.payment_refund.recorded",
        ReversalKind::Void => "billing.payment_void.recorded",
    };
    let mut transaction = pool.begin().await?;
    let payment = sqlx::query_as::<_, PaymentReversalContextRow>(
        r#"
        SELECT payments.invoice_id,
               payments.amount_minor,
               COALESCE((
                   SELECT SUM(payment_reversal_ledger.amount_minor)
                   FROM payment_reversal_ledger
                   WHERE payment_reversal_ledger.facility_id = payments.facility_id
                     AND payment_reversal_ledger.payment_id = payments.id
               ), 0)::BIGINT
                   AS reversed_amount_minor,
               payments.currency
        FROM payments
        WHERE payments.facility_id = $1 AND payments.id = $2
        FOR UPDATE
        "#,
    )
    .bind(reversal.facility_id)
    .bind(reversal.payment_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| anyhow::anyhow!("payment was not found"))?;
    let remaining_reversible = payment.amount_minor - payment.reversed_amount_minor;
    if reversal.amount_minor > remaining_reversible {
        anyhow::bail!("payment reversal exceeds unreversed payment amount");
    }

    sqlx::query(
        r#"
        INSERT INTO payment_reversal_ledger (
            id, facility_id, payment_id, invoice_id, reversal_kind, amount_minor, currency,
            reason, approved_by_user_id, recorded_by_user_id, reauthorized_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        "#,
    )
    .bind(reversal.id)
    .bind(reversal.facility_id)
    .bind(reversal.payment_id)
    .bind(payment.invoice_id)
    .bind(&reversal_kind)
    .bind(reversal.amount_minor)
    .bind(&payment.currency)
    .bind(&reversal.reason)
    .bind(reversal.approved_by_user_id)
    .bind(reversal.recorded_by_user_id)
    .bind(reversal.reauthorized_at)
    .execute(&mut *transaction)
    .await?;

    let total_reversed = payment.reversed_amount_minor + reversal.amount_minor;
    if total_reversed >= payment.amount_minor {
        sqlx::query(
            r#"
            UPDATE payments
            SET status = $1
            WHERE facility_id = $2 AND id = $3
            "#,
        )
        .bind(codec::encode(PaymentStatus::Void)?)
        .bind(reversal.facility_id)
        .bind(reversal.payment_id)
        .execute(&mut *transaction)
        .await?;
    }
    sqlx::query(
        r#"
        UPDATE invoices
        SET paid_amount_minor = GREATEST(paid_amount_minor - $1, 0),
            status = CASE
                WHEN GREATEST(paid_amount_minor - $1, 0) = 0 THEN $2
                WHEN GREATEST(paid_amount_minor - $1, 0) >= gross_amount_minor THEN $3
                ELSE $4
            END,
            updated_at = now()
        WHERE facility_id = $5 AND id = $6
        "#,
    )
    .bind(reversal.amount_minor)
    .bind(codec::encode(InvoiceStatus::Issued)?)
    .bind(codec::encode(InvoiceStatus::Paid)?)
    .bind(codec::encode(InvoiceStatus::PartiallyPaid)?)
    .bind(reversal.facility_id)
    .bind(payment.invoice_id)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO audit_events (
            id,
            facility_id,
            actor_user_id,
            request_id,
            event_type,
            resource_type,
            resource_id,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(reversal.facility_id)
    .bind(reversal.recorded_by_user_id)
    .bind(reversal.request_id)
    .bind(audit_event_type)
    .bind("payment")
    .bind(reversal.payment_id)
    .bind(serde_json::json!({
        "severity": "high",
        "reversal_id": reversal.id,
        "reversal_kind": reversal_kind,
        "amount_minor": reversal.amount_minor,
        "supervisor_approved": true
    }))
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_payment_reversal_by_id(pool, reversal.facility_id, reversal.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created payment reversal was not found"))
}

pub async fn payment_reversal_ledger(
    pool: &PgPool,
    facility_id: Uuid,
    payment_id: Uuid,
) -> anyhow::Result<Vec<PaymentReversalLedgerEntry>> {
    let rows = sqlx::query_as::<_, PaymentReversalRow>(
        r#"
        SELECT id, payment_id, invoice_id, reversal_kind, amount_minor, currency, reason,
               approved_by_user_id, recorded_by_user_id, reauthorized_at, created_at
        FROM payment_reversal_ledger
        WHERE facility_id = $1 AND payment_id = $2
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(facility_id)
    .bind(payment_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(payment_reversal_from_row).collect()
}

pub async fn create_nhis_service_mapping(
    pool: &PgPool,
    mapping: NewNhisServiceMapping,
) -> anyhow::Result<NhisServiceMappingListItem> {
    let service_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM service_catalog
            WHERE facility_id = $1
              AND id = $2
        )
        "#,
    )
    .bind(mapping.facility_id)
    .bind(mapping.service_id)
    .fetch_one(pool)
    .await?;
    if !service_exists {
        anyhow::bail!("NHIS service mapping references a service outside the facility");
    }

    if let Some(payer_id) = mapping.payer_id {
        let payer_exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM insurance_providers
                WHERE facility_id = $1
                  AND id = $2
            )
            "#,
        )
        .bind(mapping.facility_id)
        .bind(payer_id)
        .fetch_one(pool)
        .await?;
        if !payer_exists {
            anyhow::bail!("NHIS service mapping references a payer outside the facility");
        }
    }

    let version_number = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COALESCE(MAX(version_number), 0) + 1
        FROM nhis_service_mappings
        WHERE facility_id = $1
          AND service_id = $2
          AND payer_id IS NOT DISTINCT FROM $3
        "#,
    )
    .bind(mapping.facility_id)
    .bind(mapping.service_id)
    .bind(mapping.payer_id)
    .fetch_one(pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO nhis_service_mappings (
            id, facility_id, payer_id, service_id, nhis_code, version_number, effective_from,
            effective_until, active, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)
        "#,
    )
    .bind(mapping.id)
    .bind(mapping.facility_id)
    .bind(mapping.payer_id)
    .bind(mapping.service_id)
    .bind(&mapping.nhis_code)
    .bind(version_number)
    .bind(mapping.effective_from)
    .bind(mapping.effective_until)
    .bind(mapping.actor_user_id)
    .execute(pool)
    .await?;
    fetch_nhis_service_mapping_by_id(pool, mapping.facility_id, mapping.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created NHIS mapping was not found"))
}

pub async fn list_nhis_service_mappings(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: NhisServiceMappingFilters,
) -> anyhow::Result<Vec<NhisServiceMappingListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT nhis_service_mappings.id,
               nhis_service_mappings.payer_id,
               nhis_service_mappings.service_id,
               service_catalog.code AS service_code,
               service_catalog.name AS service_name,
               nhis_service_mappings.nhis_code,
               nhis_service_mappings.version_number,
               nhis_service_mappings.effective_from,
               nhis_service_mappings.effective_until,
               nhis_service_mappings.active,
               nhis_service_mappings.created_at
        FROM nhis_service_mappings
        INNER JOIN service_catalog
          ON service_catalog.id = nhis_service_mappings.service_id
         AND service_catalog.facility_id = nhis_service_mappings.facility_id
        WHERE nhis_service_mappings.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(payer_id) = filters.payer_id {
        query.push(" AND nhis_service_mappings.payer_id = ");
        query.push_bind(payer_id);
    }
    if let Some(active) = filters.active {
        query.push(" AND nhis_service_mappings.active = ");
        query.push_bind(active);
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (nhis_service_mappings.nhis_code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR service_catalog.code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR service_catalog.name ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(
        &mut query,
        "nhis_service_mappings.created_at",
        "nhis_service_mappings.id",
        cursor,
    );
    query.push(
        " ORDER BY nhis_service_mappings.created_at DESC, nhis_service_mappings.id DESC LIMIT ",
    );
    query.push_bind(limit);
    let rows = query
        .build_query_as::<NhisServiceMappingRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(nhis_service_mapping_from_row)
        .collect())
}

pub async fn list_psp_payment_intents(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: PspPaymentIntentFilters,
) -> anyhow::Result<Vec<PspPaymentIntentListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT psp_payment_intents.id,
               psp_payment_intents.invoice_id,
               invoices.invoice_number,
               psp_payment_intents.provider,
               psp_payment_intents.provider_reference,
               psp_payment_intents.client_reference,
               psp_payment_intents.status,
               psp_payment_intents.payment_method,
               psp_payment_intents.amount_minor,
               psp_payment_intents.currency,
               psp_payment_intents.created_at
        FROM psp_payment_intents
        LEFT JOIN invoices
          ON invoices.id = psp_payment_intents.invoice_id
         AND invoices.facility_id = psp_payment_intents.facility_id
        WHERE psp_payment_intents.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(status) = filters
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        query.push(" AND psp_payment_intents.status = ");
        query.push_bind(status.to_owned());
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        let lower_pattern = pattern.to_lowercase();
        query.push(" AND (psp_payment_intents.provider_reference ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR psp_payment_intents.client_reference ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR lower(invoices.invoice_number) LIKE ");
        query.push_bind(lower_pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(
        &mut query,
        "psp_payment_intents.created_at",
        "psp_payment_intents.id",
        cursor,
    );
    query.push(" ORDER BY psp_payment_intents.created_at DESC, psp_payment_intents.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PspPaymentIntentRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(psp_payment_intent_from_row).collect())
}

pub async fn list_psp_settlement_batches(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: PspSettlementBatchFilters,
) -> anyhow::Result<Vec<PspSettlementBatchListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT id, provider, statement_date, file_name, status, line_count, created_at
        FROM psp_settlement_batches
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(status) = filters
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        query.push(" AND status = ");
        query.push_bind(status.to_owned());
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (file_name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR provider ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PspSettlementBatchRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(psp_settlement_batch_from_row)
        .collect())
}

pub async fn list_psp_settlement_lines(
    pool: &PgPool,
    facility_id: Uuid,
    batch_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: PspSettlementLineFilters,
) -> anyhow::Result<Vec<PspSettlementLineListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT id, batch_id, provider_reference, client_reference, amount_gross_minor,
               fee_amount_minor, amount_net_minor, paid_at, status, match_status,
               mismatch_reason, created_at
        FROM psp_settlement_lines
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND batch_id = ");
    query.push_bind(batch_id);
    if let Some(match_status) = filters
        .match_status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        query.push(" AND match_status = ");
        query.push_bind(match_status.to_owned());
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (provider_reference ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR client_reference ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PspSettlementLineRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(psp_settlement_line_from_row).collect())
}

pub async fn list_nhis_export_jobs(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<NhisExportJobListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT id,
               id AS batch_id,
               batch_number,
               CASE WHEN status = 'exported' THEN 'ready' ELSE status END AS status,
               export_checksum AS checksum,
               exported_at AS created_at,
               exported_at + INTERVAL '7 days' AS expires_at
        FROM nhis_batches
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND exported_at IS NOT NULL");
    apply_cursor(&mut query, "exported_at", "id", cursor);
    query.push(" ORDER BY exported_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<NhisExportJobRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(nhis_export_job_from_row).collect())
}

pub async fn list_remittance_lines(
    pool: &PgPool,
    facility_id: Uuid,
    import_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: RemittanceLineFilters,
) -> anyhow::Result<Vec<RemittanceLineListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT id, import_id, claim_number, invoice_number, paid_amount_minor,
               paid_date, match_status, mismatch_reason, created_at
        FROM remittance_import_lines
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    query.push(" AND import_id = ");
    query.push_bind(import_id);
    if let Some(match_status) = filters
        .match_status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        query.push(" AND match_status = ");
        query.push_bind(match_status.to_owned());
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (claim_number ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR invoice_number ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<RemittanceLineRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(remittance_line_from_row).collect())
}

pub async fn record_nhis_ar_adjustment(
    pool: &PgPool,
    adjustment: NewNhisArAdjustment,
) -> anyhow::Result<NhisArAdjustmentEntry> {
    if adjustment.amount_minor <= 0 {
        anyhow::bail!("NHIS AR adjustment amount must be positive");
    }
    let mut transaction = pool.begin().await?;
    let claim = sqlx::query_as::<_, NhisClaimArStateRow>(
        r#"
        SELECT id AS claim_id, payer_receivable_minor, patient_liability_minor,
               written_off_minor, reconciled_at
        FROM nhis_claims
        WHERE facility_id = $1 AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(adjustment.facility_id)
    .bind(adjustment.claim_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| anyhow::anyhow!("NHIS claim was not found"))?;

    let (payer_delta, patient_delta, written_off_delta, reconciled) =
        match adjustment.adjustment_kind {
            NhisArAdjustmentKind::Remittance | NhisArAdjustmentKind::Reconciliation => (
                -adjustment.amount_minor,
                0,
                0,
                matches!(
                    adjustment.adjustment_kind,
                    NhisArAdjustmentKind::Reconciliation
                ),
            ),
            NhisArAdjustmentKind::WriteOff => {
                (-adjustment.amount_minor, 0, adjustment.amount_minor, false)
            }
            NhisArAdjustmentKind::Adjustment => (-adjustment.amount_minor, 0, 0, false),
        };
    if claim.payer_receivable_minor + payer_delta < 0 {
        anyhow::bail!("NHIS AR adjustment exceeds payer receivable");
    }
    let affects_patient_liability = patient_delta != 0;

    sqlx::query(
        r#"
        INSERT INTO nhis_claim_ar_adjustments (
            id, facility_id, claim_id, adjustment_kind, amount_minor, reason,
            affects_patient_liability, recorded_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(adjustment.id)
    .bind(adjustment.facility_id)
    .bind(adjustment.claim_id)
    .bind(codec::encode(adjustment.adjustment_kind)?)
    .bind(adjustment.amount_minor)
    .bind(&adjustment.reason)
    .bind(affects_patient_liability)
    .bind(adjustment.recorded_by_user_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"
        UPDATE nhis_claims
        SET payer_receivable_minor = payer_receivable_minor + $1,
            patient_liability_minor = patient_liability_minor + $2,
            written_off_minor = written_off_minor + $3,
            reconciled_at = CASE WHEN $4 THEN now() ELSE reconciled_at END,
            updated_at = now()
        WHERE facility_id = $5 AND id = $6
        "#,
    )
    .bind(payer_delta)
    .bind(patient_delta)
    .bind(written_off_delta)
    .bind(reconciled)
    .bind(adjustment.facility_id)
    .bind(adjustment.claim_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    fetch_nhis_ar_adjustment_by_id(pool, adjustment.facility_id, adjustment.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created NHIS AR adjustment was not found"))
}

pub async fn nhis_claim_ar_state(
    pool: &PgPool,
    facility_id: Uuid,
    claim_id: Uuid,
) -> anyhow::Result<Option<NhisClaimArState>> {
    let row = sqlx::query_as::<_, NhisClaimArStateRow>(
        r#"
        SELECT id AS claim_id, payer_receivable_minor, patient_liability_minor,
               written_off_minor, reconciled_at
        FROM nhis_claims
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(claim_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(nhis_claim_ar_state_from_row))
}

pub async fn record_discharge_billing_clearance(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Uuid,
    actor_user_id: Uuid,
) -> anyhow::Result<BillingDischargeClearance> {
    let outstanding = sqlx::query_as::<_, (i64, i64, String)>(
        r#"
        SELECT COUNT(*)::BIGINT AS outstanding_invoice_count,
               COALESCE(SUM(gross_amount_minor - paid_amount_minor), 0)::BIGINT
                   AS outstanding_amount_minor,
               COALESCE(MAX(currency), 'GHS') AS currency
        FROM invoices
        WHERE facility_id = $1
          AND patient_id = $2
          AND status <> $3
          AND gross_amount_minor > paid_amount_minor
        "#,
    )
    .bind(facility_id)
    .bind(patient_id)
    .bind(codec::encode(InvoiceStatus::Void)?)
    .fetch_one(pool)
    .await?;
    let id = Uuid::new_v4();
    let cleared = outstanding.0 == 0 && outstanding.1 == 0;
    let reason = if cleared {
        "billing_clearance_granted"
    } else {
        "billing_clearance_blocked_outstanding_balance"
    };
    sqlx::query(
        r#"
        INSERT INTO billing_discharge_clearances (
            id, facility_id, patient_id, cleared, outstanding_invoice_count,
            outstanding_amount_minor, currency, reason, recorded_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(id)
    .bind(facility_id)
    .bind(patient_id)
    .bind(cleared)
    .bind(outstanding.0)
    .bind(outstanding.1)
    .bind(&outstanding.2)
    .bind(reason)
    .bind(actor_user_id)
    .execute(pool)
    .await?;
    fetch_discharge_clearance_by_id(pool, facility_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created billing clearance was not found"))
}

pub async fn list_cash_drawers(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<CashDrawerListItem>> {
    let rows = sqlx::query_as::<_, CashDrawerRow>(
        r#"
        SELECT id, code, name, active
        FROM cash_drawers
        WHERE facility_id = $1
        ORDER BY code ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(drawer_from_row).collect())
}

pub async fn list_insurance_providers(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: InsuranceProviderFilters,
) -> anyhow::Result<Vec<InsuranceProviderListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT id, code, name, payer_type, is_active, created_at
        FROM insurance_providers
        WHERE facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(is_active) = filters.is_active {
        query.push(" AND is_active = ");
        query.push_bind(is_active);
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR payer_type ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(&mut query, "created_at", "id", cursor);
    query.push(" ORDER BY created_at DESC, id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<InsuranceProviderRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(insurance_provider_from_row).collect())
}

pub async fn list_insurance_plans(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: InsurancePlanFilters,
) -> anyhow::Result<Vec<InsurancePlanListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT insurance_plans.id,
               insurance_plans.provider_id,
               insurance_providers.name AS provider_name,
               insurance_plans.code,
               insurance_plans.name,
               insurance_plans.coverage_percentage,
               insurance_plans.is_active,
               insurance_plans.created_at
        FROM insurance_plans
        INNER JOIN insurance_providers
            ON insurance_providers.id = insurance_plans.provider_id
           AND insurance_providers.facility_id = insurance_plans.facility_id
        WHERE insurance_plans.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(provider_id) = filters.provider_id {
        query.push(" AND insurance_plans.provider_id = ");
        query.push_bind(provider_id);
    }
    if let Some(is_active) = filters.is_active {
        query.push(" AND insurance_plans.is_active = ");
        query.push_bind(is_active);
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (insurance_plans.code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR insurance_plans.name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR insurance_providers.name ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(
        &mut query,
        "insurance_plans.created_at",
        "insurance_plans.id",
        cursor,
    );
    query.push(" ORDER BY insurance_plans.created_at DESC, insurance_plans.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<InsurancePlanRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(insurance_plan_from_row).collect())
}

pub async fn list_patient_insurances(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: PatientInsuranceFilters,
) -> anyhow::Result<Vec<PatientInsuranceListItem>> {
    let mut query = QueryBuilder::new(
        r#"
        SELECT patient_insurances.id,
               patient_insurances.patient_id,
               patients.patient_code,
               patients.first_name || ' ' || patients.last_name AS patient_name,
               insurance_providers.id AS provider_id,
               insurance_providers.name AS provider_name,
               insurance_plans.id AS plan_id,
               insurance_plans.name AS plan_name,
               patient_insurances.policy_number,
               patient_insurances.member_id,
               patient_insurances.subscriber_number,
               patient_insurances.valid_from,
               patient_insurances.valid_until,
               patient_insurances.is_active,
               patient_insurances.created_at
        FROM patient_insurances
        INNER JOIN patients
            ON patients.id = patient_insurances.patient_id
           AND patients.facility_id = patient_insurances.facility_id
        INNER JOIN insurance_plans
            ON insurance_plans.id = patient_insurances.plan_id
           AND insurance_plans.facility_id = patient_insurances.facility_id
        INNER JOIN insurance_providers
            ON insurance_providers.id = insurance_plans.provider_id
           AND insurance_providers.facility_id = patient_insurances.facility_id
        WHERE patient_insurances.facility_id =
        "#,
    );
    query.push_bind(facility_id);
    if let Some(patient_id) = filters.patient_id {
        query.push(" AND patient_insurances.patient_id = ");
        query.push_bind(patient_id);
    }
    if let Some(is_active) = filters.is_active {
        query.push(" AND patient_insurances.is_active = ");
        query.push_bind(is_active);
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (");
        push_patient_search_subquery(
            &mut query,
            "patient_insurances.patient_id",
            "patient_insurances.facility_id",
            pattern.to_lowercase(),
        );
        if filters.search_sensitive_identifiers {
            query.push(" OR patient_insurances.policy_number ILIKE ");
            query.push_bind(pattern.clone());
            query.push(" ESCAPE '\\' OR patient_insurances.member_id ILIKE ");
            query.push_bind(pattern.clone());
            query.push(" ESCAPE '\\' OR patient_insurances.subscriber_number ILIKE ");
            query.push_bind(pattern.clone());
            query.push(" ESCAPE '\\'");
        }
        query.push(" OR insurance_providers.name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR insurance_plans.name ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    apply_cursor(
        &mut query,
        "patient_insurances.created_at",
        "patient_insurances.id",
        cursor,
    );
    query.push(" ORDER BY patient_insurances.created_at DESC, patient_insurances.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<PatientInsuranceRow>()
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(patient_insurance_from_row).collect())
}

pub async fn list_cash_sessions(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
    filters: CashSessionFilters,
) -> anyhow::Result<Vec<CashSessionListItem>> {
    let mut query = cash_session_query();
    query.push(" WHERE cash_sessions.facility_id = ");
    query.push_bind(facility_id);
    apply_cash_session_filters(&mut query, &filters)?;
    apply_cursor(
        &mut query,
        "cash_sessions.opened_at",
        "cash_sessions.id",
        cursor,
    );
    query.push(" ORDER BY cash_sessions.opened_at DESC, cash_sessions.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query
        .build_query_as::<CashSessionRow>()
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(cash_session_from_row).collect()
}

fn apply_cash_session_filters(
    query: &mut QueryBuilder<Postgres>,
    filters: &CashSessionFilters,
) -> anyhow::Result<()> {
    if let Some(status) = filters.status {
        query.push(" AND cash_sessions.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        query.push(" AND (cash_drawers.code ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR cash_drawers.name ILIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\' OR users.display_name ILIKE ");
        query.push_bind(pattern);
        query.push(" ESCAPE '\\')");
    }
    if let Some(is_flagged) = filters.is_flagged {
        if is_flagged {
            query.push(" AND cash_sessions.variance_minor IS NOT NULL AND cash_sessions.variance_minor <> 0");
        } else {
            query.push(
                " AND (cash_sessions.variance_minor IS NULL OR cash_sessions.variance_minor = 0)",
            );
        }
    }
    Ok(())
}

pub async fn get_cash_session(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<CashSessionListItem>> {
    fetch_cash_session_by_id(pool, facility_id, id).await
}

pub async fn open_cash_session(
    pool: &PgPool,
    session: NewCashSession,
) -> anyhow::Result<CashSessionListItem> {
    sqlx::query(
        r#"
        INSERT INTO cash_sessions (
            id, facility_id, drawer_id, opened_by_user_id, status, opening_float_minor, currency
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'GHS')
        "#,
    )
    .bind(session.id)
    .bind(session.facility_id)
    .bind(session.drawer_id)
    .bind(session.actor_user_id)
    .bind(codec::encode(CashSessionStatus::Open)?)
    .bind(session.opening_float_minor)
    .execute(pool)
    .await?;

    fetch_cash_session_by_id(pool, session.facility_id, session.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created cash session was not found"))
}

pub async fn close_cash_session(
    pool: &PgPool,
    facility_id: Uuid,
    session_id: Uuid,
    counted_cash_minor: i64,
    actor_user_id: Uuid,
) -> anyhow::Result<Option<CashSessionListItem>> {
    let mut transaction = pool.begin().await?;
    let session = sqlx::query_as::<_, (Uuid, i64)>(
        r#"
        SELECT id,
               opening_float_minor
               + COALESCE((
                    SELECT SUM(amount_minor)
                    FROM payments
                    WHERE payments.facility_id = cash_sessions.facility_id
                      AND payments.cash_session_id = cash_sessions.id
                      AND payments.status = $1
                      AND payments.method = $2
               )::bigint, 0) AS expected_cash_minor
        FROM cash_sessions
        WHERE facility_id = $3 AND id = $4 AND status = $5
        FOR UPDATE
        "#,
    )
    .bind(codec::encode(PaymentStatus::Recorded)?)
    .bind(codec::encode(PaymentMethod::Cash)?)
    .bind(facility_id)
    .bind(session_id)
    .bind(codec::encode(CashSessionStatus::Open)?)
    .fetch_optional(&mut *transaction)
    .await?;

    let Some((_id, expected_cash_minor)) = session else {
        return Ok(None);
    };
    let variance = counted_cash_minor - expected_cash_minor;
    sqlx::query(
        r#"
        UPDATE cash_sessions
        SET status = $1,
            counted_cash_minor = $2,
            variance_minor = $3,
            closed_by_user_id = $4,
            closed_at = now()
        WHERE facility_id = $5 AND id = $6
        "#,
    )
    .bind(codec::encode(CashSessionStatus::Closed)?)
    .bind(counted_cash_minor)
    .bind(variance)
    .bind(actor_user_id)
    .bind(facility_id)
    .bind(session_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    fetch_cash_session_by_id(pool, facility_id, session_id).await
}

async fn lock_invoice_in_transaction(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    invoice_id: Uuid,
    reason: InvoiceLockReason,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        UPDATE invoices
        SET locked_at = COALESCE(locked_at, now()),
            locked_reason = COALESCE(locked_reason, $1),
            updated_at = now()
        WHERE facility_id = $2 AND id = $3
        "#,
    )
    .bind(codec::encode(reason)?)
    .bind(facility_id)
    .bind(invoice_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn claim_mapping_context(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    facility_id: Uuid,
    invoice_id: Uuid,
) -> anyhow::Result<ClaimMappingContextRow> {
    let mapping = sqlx::query_as::<_, ClaimMappingContextRow>(
        r#"
        SELECT nhis_service_mappings.id AS mapping_id,
               nhis_service_mappings.version_number,
               nhis_service_mappings.nhis_code
        FROM invoice_lines
        INNER JOIN service_prices ON service_prices.id = invoice_lines.service_price_id
        INNER JOIN nhis_service_mappings
          ON nhis_service_mappings.facility_id = invoice_lines.facility_id
         AND nhis_service_mappings.service_id = service_prices.service_id
         AND nhis_service_mappings.active = TRUE
         AND nhis_service_mappings.effective_from <= CURRENT_DATE
         AND (
             nhis_service_mappings.effective_until IS NULL
             OR nhis_service_mappings.effective_until > CURRENT_DATE
         )
        WHERE invoice_lines.facility_id = $1
          AND invoice_lines.invoice_id = $2
        ORDER BY nhis_service_mappings.effective_from DESC,
                 nhis_service_mappings.version_number DESC,
                 nhis_service_mappings.id DESC
        LIMIT 1
        "#,
    )
    .bind(facility_id)
    .bind(invoice_id)
    .fetch_optional(&mut **transaction)
    .await?;
    Ok(mapping.unwrap_or(ClaimMappingContextRow {
        mapping_id: None,
        version_number: None,
        nhis_code: None,
    }))
}

fn invoice_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT invoices.id,
               invoices.patient_id,
               patients.patient_code,
               invoices.invoice_number,
               invoices.status,
               invoices.gross_amount_minor,
               invoices.paid_amount_minor,
               invoices.currency,
               invoices.issued_at
        FROM invoices
        INNER JOIN patients
            ON patients.id = invoices.patient_id
           AND patients.facility_id = invoices.facility_id
        "#,
    )
}

fn payment_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT payments.id,
               payments.invoice_id,
               invoices.invoice_number,
               invoices.patient_id,
               patients.patient_code,
               payments.receipt_number,
               payments.amount_minor,
               payments.currency,
               payments.method,
               payments.status,
               payments.paid_at
        FROM payments
        INNER JOIN invoices
            ON invoices.id = payments.invoice_id
           AND invoices.facility_id = payments.facility_id
        INNER JOIN patients
            ON patients.id = invoices.patient_id
           AND patients.facility_id = payments.facility_id
        "#,
    )
}

fn receipt_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT id, payment_id, invoice_id, receipt_number, amount_minor, currency, issued_at
        FROM receipts
        "#,
    )
}

fn claim_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT nhis_claims.id,
               nhis_claims.invoice_id,
               nhis_claims.patient_id,
               patients.patient_code,
               nhis_claims.claim_number,
               nhis_claims.status,
               nhis_claims.amount_minor,
               nhis_claims.currency,
               nhis_claims.nhis_service_mapping_id,
               nhis_claims.nhis_service_mapping_version,
               nhis_claims.nhis_service_code,
               nhis_claims.payer_receivable_minor,
               nhis_claims.patient_liability_minor,
               nhis_claims.written_off_minor,
               nhis_claims.reconciled_at,
               nhis_claims.created_at
        FROM nhis_claims
        INNER JOIN invoices
            ON invoices.id = nhis_claims.invoice_id
           AND invoices.facility_id = nhis_claims.facility_id
        INNER JOIN patients
            ON patients.id = nhis_claims.patient_id
           AND patients.facility_id = nhis_claims.facility_id
        "#,
    )
}

fn batch_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT id, batch_number, status, claim_count, total_amount_minor, currency, exported_at, created_at
        FROM nhis_batches
        "#,
    )
}

fn remittance_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT id, batch_id, reference, status, total_paid_minor, currency, imported_at
        FROM remittance_imports
        "#,
    )
}

fn cash_session_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT cash_sessions.id,
               cash_sessions.drawer_id,
               cash_drawers.code AS drawer_code,
               cash_sessions.opened_by_user_id,
               users.display_name AS opened_by_display_name,
               cash_sessions.status,
               cash_sessions.opening_float_minor,
               cash_sessions.opening_float_minor
               + COALESCE((
                    SELECT SUM(amount_minor)
                    FROM payments
                    WHERE payments.facility_id = cash_sessions.facility_id
                      AND payments.cash_session_id = cash_sessions.id
                      AND payments.status = 'recorded'
                      AND payments.method = 'cash'
               )::bigint, 0) AS expected_cash_minor,
               cash_sessions.counted_cash_minor,
               cash_sessions.variance_minor,
               cash_sessions.currency,
               cash_sessions.opened_at,
               cash_sessions.closed_at
        FROM cash_sessions
        INNER JOIN cash_drawers ON cash_drawers.id = cash_sessions.drawer_id
            AND cash_drawers.facility_id = cash_sessions.facility_id
        LEFT JOIN users ON users.id = cash_sessions.opened_by_user_id
        "#,
    )
}

async fn fetch_invoice_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<InvoiceListItem>> {
    let mut query = invoice_query();
    query.push(" WHERE invoices.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND invoices.id = ");
    query.push_bind(id);
    query
        .build_query_as::<InvoiceRow>()
        .fetch_optional(pool)
        .await?
        .map(invoice_from_row)
        .transpose()
}

pub async fn get_invoice(
    pool: &PgPool,
    facility_id: Uuid,
    invoice_id: Uuid,
) -> anyhow::Result<Option<InvoiceListItem>> {
    fetch_invoice_by_id(pool, facility_id, invoice_id).await
}

async fn fetch_payment_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PaymentListItem>> {
    let mut query = payment_query();
    query.push(" WHERE payments.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND payments.id = ");
    query.push_bind(id);
    query
        .build_query_as::<PaymentRow>()
        .fetch_optional(pool)
        .await?
        .map(payment_from_row)
        .transpose()
}

async fn fetch_receipt_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<ReceiptListItem>> {
    let mut query = receipt_query();
    query.push(" WHERE receipts.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND receipts.id = ");
    query.push_bind(id);
    Ok(query
        .build_query_as::<ReceiptRow>()
        .fetch_optional(pool)
        .await?
        .map(receipt_from_row))
}

async fn fetch_receipt_by_number(
    pool: &PgPool,
    facility_id: Uuid,
    receipt_number: &str,
) -> anyhow::Result<Option<ReceiptListItem>> {
    let mut query = receipt_query();
    query.push(" WHERE receipts.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND receipts.receipt_number = ");
    query.push_bind(receipt_number.to_owned());
    Ok(query
        .build_query_as::<ReceiptRow>()
        .fetch_optional(pool)
        .await?
        .map(receipt_from_row))
}

async fn fetch_receipt_by_payment(
    pool: &PgPool,
    facility_id: Uuid,
    payment_id: Uuid,
) -> anyhow::Result<Option<ReceiptListItem>> {
    let mut query = receipt_query();
    query.push(" WHERE receipts.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND receipts.payment_id = ");
    query.push_bind(payment_id);
    Ok(query
        .build_query_as::<ReceiptRow>()
        .fetch_optional(pool)
        .await?
        .map(receipt_from_row))
}

async fn fetch_claim_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<ClaimListItem>> {
    let mut query = claim_query();
    query.push(" WHERE nhis_claims.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND nhis_claims.id = ");
    query.push_bind(id);
    query
        .build_query_as::<ClaimRow>()
        .fetch_optional(pool)
        .await?
        .map(claim_from_row)
        .transpose()
}

async fn fetch_payment_reversal_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<PaymentReversalLedgerEntry>> {
    let row = sqlx::query_as::<_, PaymentReversalRow>(
        r#"
        SELECT id, payment_id, invoice_id, reversal_kind, amount_minor, currency, reason,
               approved_by_user_id, recorded_by_user_id, reauthorized_at, created_at
        FROM payment_reversal_ledger
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(payment_reversal_from_row).transpose()
}

async fn fetch_nhis_service_mapping_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<NhisServiceMappingListItem>> {
    let row = sqlx::query_as::<_, NhisServiceMappingRow>(
        r#"
        SELECT nhis_service_mappings.id,
               nhis_service_mappings.payer_id,
               nhis_service_mappings.service_id,
               service_catalog.code AS service_code,
               service_catalog.name AS service_name,
               nhis_service_mappings.nhis_code,
               nhis_service_mappings.version_number,
               nhis_service_mappings.effective_from,
               nhis_service_mappings.effective_until,
               nhis_service_mappings.active,
               nhis_service_mappings.created_at
        FROM nhis_service_mappings
        INNER JOIN service_catalog
          ON service_catalog.id = nhis_service_mappings.service_id
         AND service_catalog.facility_id = nhis_service_mappings.facility_id
        WHERE nhis_service_mappings.facility_id = $1
          AND nhis_service_mappings.id = $2
        "#,
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(nhis_service_mapping_from_row))
}

async fn fetch_nhis_ar_adjustment_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<NhisArAdjustmentEntry>> {
    let row = sqlx::query_as::<_, NhisArAdjustmentRow>(
        r#"
        SELECT id, claim_id, adjustment_kind, amount_minor, reason,
               affects_patient_liability, recorded_by_user_id, created_at
        FROM nhis_claim_ar_adjustments
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(nhis_ar_adjustment_from_row).transpose()
}

async fn fetch_discharge_clearance_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<BillingDischargeClearance>> {
    let row = sqlx::query_as::<_, BillingDischargeClearanceRow>(
        r#"
        SELECT id, patient_id, cleared, outstanding_invoice_count, outstanding_amount_minor,
               currency, reason, recorded_by_user_id, created_at
        FROM billing_discharge_clearances
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(facility_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(discharge_clearance_from_row))
}

async fn fetch_batch_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<NhisBatchListItem>> {
    let mut query = batch_query();
    query.push(" WHERE facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND id = ");
    query.push_bind(id);
    query
        .build_query_as::<BatchRow>()
        .fetch_optional(pool)
        .await?
        .map(batch_from_row)
        .transpose()
}

async fn fetch_remittance_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<RemittanceImportListItem>> {
    let mut query = remittance_query();
    query.push(" WHERE facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND id = ");
    query.push_bind(id);
    query
        .build_query_as::<RemittanceRow>()
        .fetch_optional(pool)
        .await?
        .map(remittance_from_row)
        .transpose()
}

async fn fetch_cash_session_by_id(
    pool: &PgPool,
    facility_id: Uuid,
    id: Uuid,
) -> anyhow::Result<Option<CashSessionListItem>> {
    let mut query = cash_session_query();
    query.push(" WHERE cash_sessions.facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND cash_sessions.id = ");
    query.push_bind(id);
    query
        .build_query_as::<CashSessionRow>()
        .fetch_optional(pool)
        .await?
        .map(cash_session_from_row)
        .transpose()
}

fn apply_cursor(
    query: &mut QueryBuilder<'static, Postgres>,
    timestamp_column: &'static str,
    id_column: &'static str,
    cursor: Option<BillingCursor>,
) {
    if let Some(cursor) = cursor {
        query.push(" AND (");
        query.push(timestamp_column);
        query.push(", ");
        query.push(id_column);
        query.push(") < (");
        query.push_bind(cursor.occurred_at);
        query.push(", ");
        query.push_bind(cursor.id);
        query.push(")");
    }
}

fn push_invoice_filters(
    query: &mut QueryBuilder<'static, Postgres>,
    filters: InvoiceListFilters,
) -> anyhow::Result<()> {
    if let Some(patient_id) = filters.patient_id {
        query.push(" AND invoices.patient_id = ");
        query.push_bind(patient_id);
    }
    if let Some(status) = filters.status {
        query.push(" AND invoices.status = ");
        query.push_bind(codec::encode(status)?);
    }
    push_timestamp_range(
        query,
        "invoices.issued_at",
        filters.date_from,
        filters.date_to,
    );
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        push_billing_search_filter(
            query,
            &["invoices.invoice_number"],
            "invoices.patient_id",
            "invoices.facility_id",
            pattern,
        );
    }
    Ok(())
}

fn push_payment_filters(
    query: &mut QueryBuilder<'static, Postgres>,
    filters: PaymentListFilters,
) -> anyhow::Result<()> {
    if let Some(patient_id) = filters.patient_id {
        query.push(" AND invoices.patient_id = ");
        query.push_bind(patient_id);
    }
    if let Some(status) = filters.status {
        query.push(" AND payments.status = ");
        query.push_bind(codec::encode(status)?);
    }
    if let Some(method) = filters.payment_method {
        query.push(" AND payments.method = ");
        query.push_bind(codec::encode(method)?);
    }
    push_timestamp_range(
        query,
        "payments.paid_at",
        filters.date_from,
        filters.date_to,
    );
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        push_billing_search_filter(
            query,
            &["payments.receipt_number", "invoices.invoice_number"],
            "invoices.patient_id",
            "invoices.facility_id",
            pattern,
        );
    }
    Ok(())
}

fn push_claim_filters(
    query: &mut QueryBuilder<'static, Postgres>,
    filters: ClaimListFilters,
) -> anyhow::Result<()> {
    if let Some(patient_id) = filters.patient_id {
        query.push(" AND nhis_claims.patient_id = ");
        query.push_bind(patient_id);
    }
    if let Some(status) = filters.status {
        query.push(" AND nhis_claims.status = ");
        query.push_bind(codec::encode(status)?);
    }
    push_timestamp_range(
        query,
        "nhis_claims.created_at",
        filters.date_from,
        filters.date_to,
    );
    if let Some(pattern) = like_contains_pattern(filters.search.as_deref()) {
        push_billing_search_filter(
            query,
            &["nhis_claims.claim_number", "invoices.invoice_number"],
            "nhis_claims.patient_id",
            "nhis_claims.facility_id",
            pattern,
        );
    }
    Ok(())
}

fn push_timestamp_range(
    query: &mut QueryBuilder<'static, Postgres>,
    timestamp_column: &'static str,
    date_from: Option<NaiveDate>,
    date_to: Option<NaiveDate>,
) {
    if let Some(date_from) = date_from {
        query.push(" AND ");
        query.push(timestamp_column);
        query.push(" >= ");
        query.push_bind(start_of_day_utc(date_from));
    }
    if let Some(date_to) = date_to.and_then(|date| date.succ_opt()) {
        query.push(" AND ");
        query.push(timestamp_column);
        query.push(" < ");
        query.push_bind(start_of_day_utc(date_to));
    }
}

fn push_billing_search_filter(
    query: &mut QueryBuilder<'static, Postgres>,
    expressions: &[&'static str],
    patient_id_expression: &'static str,
    facility_expression: &'static str,
    pattern: String,
) {
    let pattern = pattern.to_lowercase();
    query.push(" AND (");
    for (index, expression) in expressions.iter().enumerate() {
        if index > 0 {
            query.push(" OR ");
        }
        query.push("lower(");
        query.push(*expression);
        query.push(") LIKE ");
        query.push_bind(pattern.clone());
        query.push(" ESCAPE '\\'");
    }
    if !expressions.is_empty() {
        query.push(" OR ");
    }
    push_patient_search_subquery(query, patient_id_expression, facility_expression, pattern);
    query.push(")");
}

fn push_patient_search_subquery(
    query: &mut QueryBuilder<'static, Postgres>,
    patient_id_expression: &'static str,
    facility_expression: &'static str,
    pattern: String,
) {
    query.push(patient_id_expression);
    query.push(
        r#" IN (
            SELECT search_patients.id
            FROM patients AS search_patients
            WHERE search_patients.facility_id = "#,
    );
    query.push(facility_expression);
    query.push(
        r#"
              AND lower(search_patients.patient_code || ' ' || search_patients.first_name || ' ' || search_patients.last_name) LIKE "#,
    );
    query.push_bind(pattern);
    query.push(" ESCAPE '\\')");
}

fn start_of_day_utc(date: NaiveDate) -> DateTime<Utc> {
    DateTime::<Utc>::from_naive_utc_and_offset(
        date.and_hms_opt(0, 0, 0).expect("midnight is valid"),
        Utc,
    )
}

fn like_contains_pattern(search: Option<&str>) -> Option<String> {
    let search = search?.trim();
    if search.is_empty() {
        return None;
    }
    let mut escaped = String::with_capacity(search.len());
    for ch in search.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '%' => escaped.push_str("\\%"),
            '_' => escaped.push_str("\\_"),
            _ => escaped.push(ch),
        }
    }
    Some(format!("%{escaped}%"))
}

fn service_from_row(row: ServiceRow) -> anyhow::Result<ServiceCatalogItem> {
    Ok(ServiceCatalogItem {
        id: row.id,
        code: row.code,
        name: row.name,
        service_kind: codec::decode::<ServiceKind>(&row.service_kind)?,
        active: row.active,
        active_price_id: row.active_price_id,
        active_price_amount_minor: row.active_price_amount_minor,
        active_price_currency: row.active_price_currency,
        created_at: row.created_at,
    })
}

fn price_from_row(row: ServicePriceRow) -> ServicePriceListItem {
    ServicePriceListItem {
        id: row.id,
        service_id: row.service_id,
        service_code: row.service_code,
        service_name: row.service_name,
        amount_minor: row.amount_minor,
        currency: row.currency,
        active: row.active,
    }
}

fn rule_from_row(row: BillingRuleRow) -> anyhow::Result<BillingRuleListItem> {
    Ok(BillingRuleListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        rule_type: codec::decode::<BillingRuleType>(&row.rule_type)?,
        active: row.active,
    })
}

fn invoice_from_row(row: InvoiceRow) -> anyhow::Result<InvoiceListItem> {
    Ok(InvoiceListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        invoice_number: row.invoice_number,
        status: codec::decode::<InvoiceStatus>(&row.status)?,
        gross_amount_minor: row.gross_amount_minor,
        paid_amount_minor: row.paid_amount_minor,
        balance_minor: row.gross_amount_minor - row.paid_amount_minor,
        currency: row.currency,
        issued_at: row.issued_at,
    })
}

fn payment_from_row(row: PaymentRow) -> anyhow::Result<PaymentListItem> {
    Ok(PaymentListItem {
        id: row.id,
        invoice_id: row.invoice_id,
        invoice_number: row.invoice_number,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        receipt_number: row.receipt_number,
        amount_minor: row.amount_minor,
        currency: row.currency,
        method: codec::decode::<PaymentMethod>(&row.method)?,
        status: codec::decode::<PaymentStatus>(&row.status)?,
        paid_at: row.paid_at,
    })
}

fn receipt_from_row(row: ReceiptRow) -> ReceiptListItem {
    ReceiptListItem {
        id: row.id,
        payment_id: row.payment_id,
        invoice_id: row.invoice_id,
        receipt_number: row.receipt_number,
        amount_minor: row.amount_minor,
        currency: row.currency,
        issued_at: row.issued_at,
    }
}

fn claim_from_row(row: ClaimRow) -> anyhow::Result<ClaimListItem> {
    Ok(ClaimListItem {
        id: row.id,
        invoice_id: row.invoice_id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        claim_number: row.claim_number,
        status: codec::decode::<ClaimStatus>(&row.status)?,
        amount_minor: row.amount_minor,
        currency: row.currency,
        nhis_service_mapping_id: row.nhis_service_mapping_id,
        nhis_service_mapping_version: row.nhis_service_mapping_version,
        nhis_service_code: row.nhis_service_code,
        payer_receivable_minor: row.payer_receivable_minor,
        patient_liability_minor: row.patient_liability_minor,
        written_off_minor: row.written_off_minor,
        reconciled_at: row.reconciled_at,
        created_at: row.created_at,
    })
}

fn invoice_lock_state_from_row(row: InvoiceLockStateRow) -> InvoiceLockState {
    InvoiceLockState {
        invoice_id: row.invoice_id,
        locked_at: row.locked_at,
        locked_reason: row.locked_reason,
        finalized_at: row.finalized_at,
    }
}

fn payment_reversal_from_row(
    row: PaymentReversalRow,
) -> anyhow::Result<PaymentReversalLedgerEntry> {
    Ok(PaymentReversalLedgerEntry {
        id: row.id,
        payment_id: row.payment_id,
        invoice_id: row.invoice_id,
        reversal_kind: codec::decode::<ReversalKind>(&row.reversal_kind)?,
        amount_minor: row.amount_minor,
        currency: row.currency,
        reason: row.reason,
        approved_by_user_id: row.approved_by_user_id,
        recorded_by_user_id: row.recorded_by_user_id,
        reauthorized_at: row.reauthorized_at,
        created_at: row.created_at,
    })
}

fn nhis_service_mapping_from_row(row: NhisServiceMappingRow) -> NhisServiceMappingListItem {
    NhisServiceMappingListItem {
        id: row.id,
        payer_id: row.payer_id,
        service_id: row.service_id,
        service_code: row.service_code,
        service_name: row.service_name,
        nhis_code: row.nhis_code,
        version_number: row.version_number,
        effective_from: row.effective_from,
        effective_until: row.effective_until,
        active: row.active,
        created_at: row.created_at,
    }
}

fn psp_payment_intent_from_row(row: PspPaymentIntentRow) -> PspPaymentIntentListItem {
    PspPaymentIntentListItem {
        id: row.id,
        invoice_id: row.invoice_id,
        invoice_number: row.invoice_number,
        provider: row.provider,
        provider_reference: row.provider_reference,
        client_reference: row.client_reference,
        status: row.status,
        payment_method: row.payment_method,
        amount_minor: row.amount_minor,
        currency: row.currency,
        created_at: row.created_at,
    }
}

fn psp_settlement_batch_from_row(row: PspSettlementBatchRow) -> PspSettlementBatchListItem {
    PspSettlementBatchListItem {
        id: row.id,
        provider: row.provider,
        statement_date: row.statement_date,
        file_name: row.file_name,
        status: row.status,
        line_count: row.line_count,
        created_at: row.created_at,
    }
}

fn psp_settlement_line_from_row(row: PspSettlementLineRow) -> PspSettlementLineListItem {
    PspSettlementLineListItem {
        id: row.id,
        batch_id: row.batch_id,
        provider_reference: row.provider_reference,
        client_reference: row.client_reference,
        amount_gross_minor: row.amount_gross_minor,
        fee_amount_minor: row.fee_amount_minor,
        amount_net_minor: row.amount_net_minor,
        paid_at: row.paid_at,
        status: row.status,
        match_status: row.match_status,
        mismatch_reason: row.mismatch_reason,
        created_at: row.created_at,
    }
}

fn nhis_export_job_from_row(row: NhisExportJobRow) -> NhisExportJobListItem {
    NhisExportJobListItem {
        id: row.id,
        batch_id: row.batch_id,
        batch: row.batch_number.clone(),
        batch_number: row.batch_number,
        status: row.status,
        checksum: row.checksum,
        created_at: row.created_at,
        expires_at: row.expires_at,
    }
}

fn remittance_line_from_row(row: RemittanceLineRow) -> RemittanceLineListItem {
    RemittanceLineListItem {
        id: row.id,
        import_id: row.import_id,
        claim_number: row.claim_number,
        invoice_number: row.invoice_number,
        paid_amount_minor: row.paid_amount_minor,
        paid_date: row.paid_date,
        match_status: row.match_status,
        mismatch_reason: row.mismatch_reason,
        created_at: row.created_at,
    }
}

fn nhis_claim_ar_state_from_row(row: NhisClaimArStateRow) -> NhisClaimArState {
    NhisClaimArState {
        claim_id: row.claim_id,
        payer_receivable_minor: row.payer_receivable_minor,
        patient_liability_minor: row.patient_liability_minor,
        written_off_minor: row.written_off_minor,
        reconciled_at: row.reconciled_at,
    }
}

fn nhis_ar_adjustment_from_row(row: NhisArAdjustmentRow) -> anyhow::Result<NhisArAdjustmentEntry> {
    Ok(NhisArAdjustmentEntry {
        id: row.id,
        claim_id: row.claim_id,
        adjustment_kind: codec::decode::<NhisArAdjustmentKind>(&row.adjustment_kind)?,
        amount_minor: row.amount_minor,
        reason: row.reason,
        affects_patient_liability: row.affects_patient_liability,
        recorded_by_user_id: row.recorded_by_user_id,
        created_at: row.created_at,
    })
}

fn discharge_clearance_from_row(row: BillingDischargeClearanceRow) -> BillingDischargeClearance {
    BillingDischargeClearance {
        id: row.id,
        patient_id: row.patient_id,
        cleared: row.cleared,
        outstanding_invoice_count: row.outstanding_invoice_count,
        outstanding_amount_minor: row.outstanding_amount_minor,
        currency: row.currency,
        reason: row.reason,
        recorded_by_user_id: row.recorded_by_user_id,
        created_at: row.created_at,
    }
}

fn batch_from_row(row: BatchRow) -> anyhow::Result<NhisBatchListItem> {
    Ok(NhisBatchListItem {
        id: row.id,
        batch_number: row.batch_number,
        status: codec::decode::<NhisBatchStatus>(&row.status)?,
        claim_count: row.claim_count,
        total_amount_minor: row.total_amount_minor,
        currency: row.currency,
        exported_at: row.exported_at,
        created_at: row.created_at,
    })
}

fn remittance_from_row(row: RemittanceRow) -> anyhow::Result<RemittanceImportListItem> {
    Ok(RemittanceImportListItem {
        id: row.id,
        batch_id: row.batch_id,
        reference: row.reference,
        status: codec::decode::<RemittanceImportStatus>(&row.status)?,
        total_paid_minor: row.total_paid_minor,
        currency: row.currency,
        imported_at: row.imported_at,
    })
}

fn drawer_from_row(row: CashDrawerRow) -> CashDrawerListItem {
    CashDrawerListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        active: row.active,
    }
}

fn cash_session_from_row(row: CashSessionRow) -> anyhow::Result<CashSessionListItem> {
    Ok(CashSessionListItem {
        id: row.id,
        drawer_id: row.drawer_id,
        drawer_code: row.drawer_code,
        opened_by_user_id: row.opened_by_user_id,
        opened_by_display_name: row.opened_by_display_name,
        status: codec::decode::<CashSessionStatus>(&row.status)?,
        opening_float_minor: row.opening_float_minor,
        expected_cash_minor: row.expected_cash_minor,
        counted_cash_minor: row.counted_cash_minor,
        variance_minor: row.variance_minor,
        currency: row.currency,
        opened_at: row.opened_at,
        closed_at: row.closed_at,
    })
}

fn insurance_provider_from_row(row: InsuranceProviderRow) -> InsuranceProviderListItem {
    InsuranceProviderListItem {
        id: row.id,
        code: row.code,
        name: row.name,
        payer_type: row.payer_type,
        is_active: row.is_active,
        created_at: row.created_at,
    }
}

fn insurance_plan_from_row(row: InsurancePlanRow) -> InsurancePlanListItem {
    InsurancePlanListItem {
        id: row.id,
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        code: row.code,
        name: row.name,
        coverage_percentage: row.coverage_percentage,
        is_active: row.is_active,
        created_at: row.created_at,
    }
}

fn patient_insurance_from_row(row: PatientInsuranceRow) -> PatientInsuranceListItem {
    PatientInsuranceListItem {
        id: row.id,
        patient_id: row.patient_id,
        patient_code: row.patient_code,
        patient_name: row.patient_name,
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        plan_id: row.plan_id,
        plan_name: row.plan_name,
        policy_number: row.policy_number,
        member_id: row.member_id,
        subscriber_number: row.subscriber_number,
        valid_from: row.valid_from,
        valid_until: row.valid_until,
        is_active: row.is_active,
        created_at: row.created_at,
    }
}

fn export_checksum(
    batch_id: Uuid,
    batch_number: &str,
    claim_count: i64,
    total_amount_minor: i64,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(batch_id.as_bytes());
    hasher.update(batch_number.as_bytes());
    hasher.update(claim_count.to_be_bytes());
    hasher.update(total_amount_minor.to_be_bytes());
    format!("{:x}", hasher.finalize())
}
