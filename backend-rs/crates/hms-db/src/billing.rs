use chrono::{DateTime, Utc};
use hms_domain::billing::{
    BillingRuleListItem, BillingRuleType, CashDrawerListItem, CashSessionListItem,
    CashSessionStatus, ClaimListItem, ClaimStatus, InvoiceListItem, InvoiceStatus, NhisBatchExport,
    NhisBatchListItem, NhisBatchStatus, PaymentListItem, PaymentMethod, PaymentStatus,
    ReceiptListItem, RemittanceImportListItem, RemittanceImportStatus, ServiceCatalogItem,
    ServiceKind, ServicePriceListItem,
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

pub async fn list_service_catalog(
    pool: &PgPool,
    facility_id: Uuid,
) -> anyhow::Result<Vec<ServiceCatalogItem>> {
    let rows = sqlx::query_as::<_, ServiceRow>(
        r#"
        SELECT id, code, name, service_kind, active
        FROM service_catalog
        WHERE facility_id = $1
        ORDER BY code ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
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
) -> anyhow::Result<Vec<BillingRuleListItem>> {
    let rows = sqlx::query_as::<_, BillingRuleRow>(
        r#"
        SELECT id, code, name, rule_type, active
        FROM billing_rules
        WHERE facility_id = $1
        ORDER BY code ASC
        LIMIT 100
        "#,
    )
    .bind(facility_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(rule_from_row).collect()
}

pub async fn list_invoices(
    pool: &PgPool,
    facility_id: Uuid,
    patient_id: Option<Uuid>,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<InvoiceListItem>> {
    let mut query = invoice_query();
    query.push(" WHERE invoices.facility_id = ");
    query.push_bind(facility_id);
    if let Some(patient_id) = patient_id {
        query.push(" AND invoices.patient_id = ");
        query.push_bind(patient_id);
    }
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

pub async fn list_payments(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<PaymentListItem>> {
    let mut query = payment_query();
    query.push(" WHERE payments.facility_id = ");
    query.push_bind(facility_id);
    apply_cursor(&mut query, "payments.paid_at", "payments.id", cursor);
    query.push(" ORDER BY payments.paid_at DESC, payments.id DESC LIMIT ");
    query.push_bind(limit);
    let rows = query.build_query_as::<PaymentRow>().fetch_all(pool).await?;
    rows.into_iter().map(payment_from_row).collect()
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
            updated_at = now()
        WHERE facility_id = $3 AND id = $4
        "#,
    )
    .bind(paid_amount)
    .bind(codec::encode(status)?)
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

pub async fn list_claims(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<ClaimListItem>> {
    let mut query = claim_query();
    query.push(" WHERE nhis_claims.facility_id = ");
    query.push_bind(facility_id);
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
    let invoice = sqlx::query_as::<_, InvoiceContextRow>(
        r#"
        SELECT patient_id, gross_amount_minor, paid_amount_minor, currency
        FROM invoices
        WHERE facility_id = $1 AND id = $2
        "#,
    )
    .bind(claim.facility_id)
    .bind(claim.invoice_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("invoice was not found"))?;

    sqlx::query(
        r#"
        INSERT INTO nhis_claims (
            id, facility_id, invoice_id, patient_id, claim_number, status,
            amount_minor, currency, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
    .bind(claim.actor_user_id)
    .execute(pool)
    .await?;

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
    facility_id: Uuid,
    batch_id: Uuid,
) -> anyhow::Result<Option<NhisBatchExport>> {
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
    .execute(pool)
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
    .execute(pool)
    .await?;

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

pub async fn list_cash_sessions(
    pool: &PgPool,
    facility_id: Uuid,
    cursor: Option<BillingCursor>,
    limit: i64,
) -> anyhow::Result<Vec<CashSessionListItem>> {
    let mut query = cash_session_query();
    query.push(" WHERE cash_sessions.facility_id = ");
    query.push_bind(facility_id);
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
        INNER JOIN patients ON patients.id = invoices.patient_id
        "#,
    )
}

fn payment_query() -> QueryBuilder<'static, Postgres> {
    QueryBuilder::new(
        r#"
        SELECT id, invoice_id, receipt_number, amount_minor, currency, method, status, paid_at
        FROM payments
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
               nhis_claims.created_at
        FROM nhis_claims
        INNER JOIN patients ON patients.id = nhis_claims.patient_id
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
    query.push(" WHERE facility_id = ");
    query.push_bind(facility_id);
    query.push(" AND id = ");
    query.push_bind(id);
    query
        .build_query_as::<PaymentRow>()
        .fetch_optional(pool)
        .await?
        .map(payment_from_row)
        .transpose()
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

fn service_from_row(row: ServiceRow) -> anyhow::Result<ServiceCatalogItem> {
    Ok(ServiceCatalogItem {
        id: row.id,
        code: row.code,
        name: row.name,
        service_kind: codec::decode::<ServiceKind>(&row.service_kind)?,
        active: row.active,
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
        created_at: row.created_at,
    })
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
