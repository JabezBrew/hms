import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api, v2Request } from './v2/client';
import {
  cacheCursorForNextPage as cacheScopedCursorForNextPage,
  resolveCursorPage as resolveScopedCursorPage,
} from './v2/cursorCache';

const DEFAULT_BILLING_PAGE_SIZE = 25;

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function generateIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function minorToMajor(value) {
  return Number(value || 0) / 100;
}

function majorToMinor(value) {
  return Math.round(Number(value || 0) * 100);
}

function rethrowV2Error(error, message) {
  rethrowAbortError(error);
  throw new Error(handleV2ApiError(error, message));
}

function rustV2Unsupported(resourceName) {
  return Promise.reject(new Error(`Rust V2 does not expose ${resourceName} yet.`));
}

function adaptV2Invoice(invoice) {
  if (!invoice) {
    return invoice;
  }
  return {
    id: invoice.id,
    patient: invoice.patient_id,
    patient_id: invoice.patient_id,
    patient_mrn: invoice.patient_code,
    patient_code: invoice.patient_code,
    patient_name: invoice.patient_display_name || invoice.patient_name || invoice.patient_code || 'Unknown patient',
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    currency: invoice.currency,
    issued_at: invoice.issued_at,
    created_at: invoice.issued_at,
    gross_amount_minor: invoice.gross_amount_minor,
    paid_amount_minor: invoice.paid_amount_minor,
    balance_minor: invoice.balance_minor,
    total_amount: minorToMajor(invoice.gross_amount_minor),
    amount_paid: minorToMajor(invoice.paid_amount_minor),
    balance_due: minorToMajor(invoice.balance_minor),
  };
}

function adaptV2Payment(payment) {
  if (!payment) {
    return payment;
  }
  return {
    ...payment,
    invoice: payment.invoice_id,
    invoice_number: payment.invoice_number || payment.invoice_id,
    patient_id: payment.patient_id || null,
    patient_mrn: payment.patient_code || '',
    payment_date: payment.paid_at,
    created_at: payment.created_at || payment.paid_at,
    payment_method: payment.method,
    amount: minorToMajor(payment.amount_minor),
    patient_name: payment.patient_display_name
      || payment.patient_name
      || payment.patient_code
      || payment.receipt_number
      || 'Billing payment',
  };
}

function adaptV2Receipt(receipt) {
  if (!receipt) {
    return receipt;
  }
  return {
    ...receipt,
    payment: receipt.payment_id,
    invoice: receipt.invoice_id,
    amount: minorToMajor(receipt.amount_minor),
    receipt_date: receipt.issued_at,
    created_at: receipt.created_at || receipt.issued_at,
  };
}

function adaptV2CashSession(session) {
  if (!session) {
    return session;
  }
  return {
    ...session,
    opened_by_name: session.opened_by_display_name || session.opened_by_user_id,
    opening_float_amount: minorToMajor(session.opening_float_minor),
    expected_cash_amount: minorToMajor(session.expected_cash_minor),
    counted_cash_amount: session.counted_cash_minor === null || session.counted_cash_minor === undefined
      ? null
      : minorToMajor(session.counted_cash_minor),
    variance_amount: session.variance_minor === null || session.variance_minor === undefined
      ? null
      : minorToMajor(session.variance_minor),
    variance_cash_amount: session.variance_minor === null || session.variance_minor === undefined
      ? null
      : minorToMajor(session.variance_minor),
    is_flagged: session.variance_minor !== null
      && session.variance_minor !== undefined
      && Number(session.variance_minor) !== 0,
  };
}

function emptyPage() {
  return { count: 0, next: null, previous: null, results: [] };
}

const billingCursorCache = new Map();

const BILLING_LIST_SCOPES = Object.freeze({
  billingRules: 'billing:rules',
  cashSessions: 'billing:cash-sessions',
  claims: 'billing:claims',
  insurancePlans: 'billing:insurance-plans',
  insuranceProviders: 'billing:insurance-providers',
  invoices: 'billing:invoices',
  nhisBatches: 'billing:nhis-batches',
  nhisExports: 'billing:nhis-exports',
  patientInsurances: 'billing:patient-insurances',
  payerServiceCodes: 'billing:payer-service-codes',
  payments: 'billing:payments',
  paymentIntents: 'billing:payment-intents',
  remittanceImports: 'billing:remittance-imports',
  remittanceLines: 'billing:remittance-lines',
  serviceCatalog: 'billing:service-catalog',
  settlementBatches: 'billing:settlement-batches',
  settlementLines: 'billing:settlement-lines',
});

const V2_SERVICE_CATEGORIES = [
  'consultation',
  'laboratory',
  'pharmacy',
  'procedure',
  'admission',
  'other',
];

function resolveBillingCursorPage(scope, params = {}) {
  return resolveScopedCursorPage(billingCursorCache, scope, params);
}

function cacheBillingCursorForNextPage(scope, params, response) {
  cacheScopedCursorForNextPage(billingCursorCache, scope, params, response);
}

function v2Page(response, params = {}, mapper = (item) => item, scope = 'default') {
  if (typeof params === 'function') {
    return v2Page(response, {}, params, scope);
  }
  const results = v2List(response).map(mapper);
  const limit = normalizeLimit(params, response?.page?.limit || DEFAULT_BILLING_PAGE_SIZE);
  const resolvedPage = resolveBillingCursorPage(scope, params);
  const currentPage = resolvedPage.page;
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const knownResultCount = ((currentPage - 1) * limit) + results.length;
  cacheBillingCursorForNextPage(scope, params, response);

  return {
    count: knownResultCount + (hasNext ? 1 : 0),
    total: knownResultCount + (hasNext ? 1 : 0),
    count_exact: !hasNext,
    total_is_lower_bound: hasNext,
    page: currentPage,
    current_page: currentPage,
    requested_page: resolvedPage.requestedPage ?? currentPage,
    resolved_page: currentPage,
    cursor_missing: Boolean(resolvedPage.cursorMissing),
    page_size: limit,
    total_pages: hasNext ? currentPage + 1 : Math.max(1, currentPage),
    next: hasNext ? response.page.next_cursor : null,
    previous: currentPage > 1 ? String(currentPage - 1) : null,
    next_cursor: response?.page?.next_cursor || null,
    results,
  };
}

function v2List(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

function titleCase(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function normalizeCursor(params = {}, scope = 'default') {
  return resolveBillingCursorPage(scope, params).cursor || null;
}

function normalizePatientId(params = {}) {
  return params.patient_id || params.patient || null;
}

function addStringQueryParam(query, params, sourceKey, targetKey = sourceKey) {
  const value = params[sourceKey];
  if (value === undefined || value === null) {
    return;
  }
  const normalized = String(value).trim();
  if (normalized && normalized !== 'all') {
    query[targetKey] = normalized;
  }
}

function buildBillingListQuery(params = {}, scope = 'default') {
  const patientId = normalizePatientId(params);
  const query = {
    limit: normalizeLimit(params, 20),
    cursor: normalizeCursor(params, scope),
  };

  if (patientId) {
    query.patient_id = patientId;
  }
  addStringQueryParam(query, params, 'search');
  addStringQueryParam(query, params, 'status');
  addStringQueryParam(query, params, 'payment_method');
  addStringQueryParam(query, params, 'date_from');
  addStringQueryParam(query, params, 'date_to');
  return query;
}

function buildSafeBillingCursorQuery(params = {}, scope = 'default') {
  const query = {
    limit: normalizeLimit(params),
    cursor: normalizeCursor(params, scope),
  };
  addStringQueryParam(query, params, 'search');
  addStringQueryParam(query, params, 'status');
  addStringQueryParam(query, params, 'match_status');
  return query;
}

function addActiveQueryParam(query, params, sourceKey = 'is_active', targetKey = 'active') {
  const value = params[sourceKey];
  if (value === undefined || value === null || value === '' || value === 'all') {
    return;
  }
  query[targetKey] = value === true || value === 'true' || value === '1' || value === 'active';
}

function requiresPrivateBillingListRequest(query = {}) {
  return Boolean(query.search || query.patient_id);
}

async function requestV2SearchableCursorList({
  path,
  searchPath,
  query,
  signal,
}) {
  if (query.search) {
    return v2Request({
      method: 'POST',
      path: searchPath,
      body: query,
      signal,
    });
  }
  return v2Request({
    method: 'GET',
    path,
    query,
    signal,
  });
}

async function requestV2BillingList({
  query,
  signal,
  searchPath,
  getList,
}) {
  if (requiresPrivateBillingListRequest(query)) {
    return v2Request({
      method: 'POST',
      path: searchPath,
      body: query,
      signal,
    });
  }
  return getList({ query, signal });
}

function adaptV2Claim(claim) {
  if (!claim) {
    return claim;
  }
  return {
    ...claim,
    patient: claim.patient_id,
    patient_name: claim.patient_display_name || claim.patient_name || claim.patient_code || 'Unknown patient',
    patient_mrn: claim.patient_code,
    invoice: claim.invoice_id,
    invoice_number: claim.invoice_number || claim.invoice_id,
    insurance_provider: claim.insurance_provider || 'NHIS',
    claimed_amount: minorToMajor(claim.amount_minor),
    approved_amount: minorToMajor(claim.approved_amount_minor),
    total_amount: minorToMajor(claim.amount_minor),
    submitted_at: claim.submitted_at || null,
  };
}

function adaptV2NhisBatch(batch) {
  if (!batch) {
    return batch;
  }
  return {
    ...batch,
    batch: batch.batch_number,
    period_start: batch.period_start || batch.created_at,
    period_end: batch.period_end || batch.exported_at || batch.created_at,
    total_claimed_amount: minorToMajor(batch.total_amount_minor),
    total_amount: minorToMajor(batch.total_amount_minor),
  };
}

function adaptV2RemittanceImport(job) {
  if (!job) {
    return job;
  }
  return {
    ...job,
    created_at: job.created_at || job.imported_at,
    file_name: job.file_name || job.reference,
    payer_name: job.payer_name || job.batch_number || job.batch_id,
    total_paid: minorToMajor(job.total_paid_minor),
  };
}

function adaptV2PspPaymentIntent(intent) {
  if (!intent) {
    return intent;
  }
  return {
    ...intent,
    invoice: intent.invoice_id,
    amount: minorToMajor(intent.amount_minor),
    created_at: intent.created_at,
  };
}

function adaptV2PspSettlementBatch(batch) {
  if (!batch) {
    return batch;
  }
  return {
    ...batch,
    uploaded_at: batch.created_at,
    lines_count: batch.line_count,
  };
}

function adaptV2PspSettlementLine(line) {
  if (!line) {
    return line;
  }
  return {
    ...line,
    amount_gross: minorToMajor(line.amount_gross_minor),
    fee_amount: minorToMajor(line.fee_amount_minor),
    amount_net: minorToMajor(line.amount_net_minor),
  };
}

function adaptV2NhisExportJob(job) {
  if (!job) {
    return job;
  }
  return {
    ...job,
    batch: job.batch || job.batch_number,
  };
}

function adaptV2RemittanceLine(line) {
  if (!line) {
    return line;
  }
  return {
    ...line,
    paid_amount: minorToMajor(line.paid_amount_minor),
  };
}

function adaptV2PayerServiceCode(mapping) {
  if (!mapping) {
    return mapping;
  }
  return {
    ...mapping,
    payer: mapping.payer_id,
    service: mapping.service_id,
    external_code: mapping.nhis_code,
    is_active: mapping.active !== false,
  };
}

function adaptV2ServiceCatalogItem(item, price) {
  if (!item) {
    return item;
  }
  const priceId = price?.id || item.active_price_id || null;
  const priceAmountMinor = price?.amount_minor ?? item.active_price_amount_minor;
  const priceCurrency = price?.currency || item.active_price_currency || 'GHS';
  const active = item.active !== false && price?.active !== false;
  const amount = priceAmountMinor ? minorToMajor(priceAmountMinor) : 0;
  return {
    ...item,
    id: item.id,
    service_id: item.id,
    service_price_id: priceId,
    category: item.service_kind,
    category_name: titleCase(item.service_kind) || 'Other',
    base_price: amount,
    total_price: amount,
    price: amount,
    currency: priceCurrency,
    is_active: active,
    active,
  };
}

function serviceCatalogQuery(params = {}) {
  const query = {
    limit: normalizeLimit(params),
    cursor: normalizeCursor(params, BILLING_LIST_SCOPES.serviceCatalog),
  };
  if (params.search) {
    query.search = String(params.search).trim();
  }
  if (params.is_active !== undefined && params.is_active !== null && params.is_active !== '') {
    query.is_active = params.is_active === true || params.is_active === 'true' || params.is_active === '1';
  }
  if (params.service_id) {
    query.service_id = String(params.service_id);
  }
  return query;
}

async function getV2ServicesPage(params = {}, options = {}) {
  const catalogResponse = await v2Api.getBillingServiceCatalog({
    query: serviceCatalogQuery(params),
    signal: options.signal,
  });
  return v2Page(
    catalogResponse,
    params,
    (item) => adaptV2ServiceCatalogItem(item),
    BILLING_LIST_SCOPES.serviceCatalog,
  );
}

function v2ServiceCategoriesPage(_catalogResponse, params = {}) {
  const search = String(params.search || '').trim().toLowerCase();
  const categories = [];
  for (const serviceKind of V2_SERVICE_CATEGORIES) {
    const category = {
      id: serviceKind,
      name: titleCase(serviceKind) || 'Other',
      description: '',
      is_active: true,
    };
    if (!search || category.name.toLowerCase().includes(search)) {
      categories.push(category);
    }
  }
  return {
    ...emptyPage(),
    count: categories.length,
    results: categories,
  };
}

function emptyAgingSnapshot() {
  return { bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0, total: 0 };
}

function adaptV2DashboardSummary(response) {
  const summary = response?.data || response || {};
  return {
    revenue_today: minorToMajor(summary.revenue_today_minor),
    revenue_this_week: minorToMajor(summary.revenue_this_week_minor),
    outstanding_amount: minorToMajor(summary.outstanding_amount_minor),
    outstanding_invoices: Number(summary.outstanding_invoices || 0),
    pending_claims: Number(summary.pending_claims || 0),
    pending_claims_amount: minorToMajor(summary.pending_claims_amount_minor),
    invoices_created_today: Number(summary.invoices_created_today || 0),
    payments_received_today: Number(summary.payments_received_today || 0),
    unique_patients_billed: Number(summary.unique_patients_billed || 0),
    average_invoice_amount: minorToMajor(summary.average_invoice_amount_minor),
  };
}

function normalizeLimit(params = {}, fallback = DEFAULT_BILLING_PAGE_SIZE) {
  const rawLimit = params.limit || params.page_size || fallback;
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

async function findV2Invoice(id, options = {}) {
  const response = await v2Api.getBillingInvoiceById(
    { id },
    { signal: options.signal },
  );
  return adaptV2Invoice(response?.data || response || {});
}

async function getV2Receipt(id, options = {}) {
  const response = await v2Api.getBillingReceiptById(
    { id },
    { signal: options.signal },
  );
  return adaptV2Receipt(response?.data || response || {});
}

async function getV2ReceiptByNumber(receiptNumber, options = {}) {
  const response = await v2Api.getBillingReceiptByNumber(
    { receipt_number: receiptNumber },
    { signal: options.signal },
  );
  return adaptV2Receipt(response?.data || response || {});
}

async function getV2ReceiptByPayment(paymentId, options = {}) {
  const response = await v2Api.getBillingReceiptByPaymentId(
    { id: paymentId },
    { signal: options.signal },
  );
  return adaptV2Receipt(response?.data || response || {});
}

async function findV2Claim(id, options = {}) {
  const response = await v2Api.getNhisClaimById(
    { id },
    { signal: options.signal },
  );
  return adaptV2Claim(response?.data || response || {});
}

async function findV2BillingRule(id, options = {}) {
  const response = await v2Api.getBillingRuleById({ id }, { signal: options.signal });
  const rule = response?.data || response || {};
  return {
    ...rule,
    rule_type: rule.rule_type,
    is_active: rule.active !== false,
  };
}

/**
 * Billing API service
 *
 * Provides endpoints for:
 * - Invoices (CRUD, payments, claims)
 * - Claims management
 * - Billing rules
 * - Dashboard metrics
 * - Services and pricing
 */
export const billingApi = {
  // =========================================================================
  // Dashboard
  // =========================================================================

  /**
   * Get billing dashboard metrics
   * @param {Object} params - Query parameters
   * @param {string} params.facility - Optional facility ID filter
   * @returns {Promise<Object>} Dashboard metrics
   */
  getDashboardMetrics: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getBillingDashboardSummary(
          { signal: options.signal },
        );
        return adaptV2DashboardSummary(response);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/dashboard/metrics/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch dashboard metrics');
      }
      throw new Error(handleApiError(error, 'Failed to fetch dashboard metrics'));
    }
  },

  /**
   * Get recent invoices for dashboard
   * @param {Object} params - Query parameters
   * @param {number} params.limit - Maximum results (default: 10)
   * @param {string} params.facility - Optional facility ID filter
   * @returns {Promise<Array>} Recent invoices
   */
  getRecentInvoices: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getBillingInvoices({
          query: { limit: normalizeLimit(params, 10) },
          signal: options.signal,
        });
        return v2List(response).map(adaptV2Invoice);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/dashboard/recent_invoices/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch recent invoices');
      }
      throw new Error(handleApiError(error, 'Failed to fetch recent invoices'));
    }
  },

  /**
   * Get recent payments for dashboard
   * @param {Object} params - Query parameters
   * @param {number} params.limit - Maximum results (default: 10)
   * @param {string} params.facility - Optional facility ID filter
   * @returns {Promise<Array>} Recent payments
   */
  getRecentPayments: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getBillingPayments({
          query: { limit: normalizeLimit(params, 10) },
          signal: options.signal,
        });
        return v2List(response).map(adaptV2Payment);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/dashboard/recent_payments/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch recent payments');
      }
      throw new Error(handleApiError(error, 'Failed to fetch recent payments'));
    }
  },

  // =========================================================================
  // Invoices
  // =========================================================================

  /**
   * Get invoices with optional filtering and pagination
   * @param {Object} params - Query parameters
   * @param {string} params.status - Filter by status
   * @param {string} params.facility - Filter by facility ID
   * @param {string} params.search - Search query
   * @param {number} params.page - Page number
   * @param {number} params.page_size - Page size
   * @returns {Promise<Object>} Paginated invoices with count, next, previous, results
   */
  getInvoices: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const query = buildBillingListQuery(params, BILLING_LIST_SCOPES.invoices);
        const response = await requestV2BillingList({
          query,
          signal: options.signal || params.signal,
          searchPath: '/api/v2/billing/invoices/search',
          getList: (request) => v2Api.getBillingInvoices(request),
        });
        return v2Page(response, params, adaptV2Invoice, BILLING_LIST_SCOPES.invoices);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/invoices/${queryString ? `?${queryString}` : ''}`;
      // Use getWithPagination to preserve count, next, previous metadata
      return await apiClient.getWithPagination(endpoint, { signal: options.signal || params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch invoices');
      }
      throw new Error(handleApiError(error, 'Failed to fetch invoices'));
    }
  },

  /**
   * Get a single invoice by ID
   * @param {string} id - Invoice ID
   * @returns {Promise<Object>} Invoice data with items and payments
   */
  getInvoice: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await findV2Invoice(id, options);
      }

      return await apiClient.get(`/billing/invoices/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch invoice');
      }
      throw new Error(handleApiError(error, 'Failed to fetch invoice'));
    }
  },

  /**
   * Get invoice details for printing (logs audit trail)
   * @param {string} id - Invoice ID
   * @returns {Promise<Object>} Invoice data for printing
   */
  getInvoicePrintDetail: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const invoice = await findV2Invoice(id, options);
        return { ...invoice, items: [], payments: [] };
      }

      return await apiClient.get(`/billing/invoices/${id}/print_detail/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch invoice for printing');
      }
      throw new Error(handleApiError(error, 'Failed to fetch invoice for printing'));
    }
  },

  /**
   * Get invoices for a specific patient
   * @param {string} patientId - Patient ID
   * @param {Object} params - Additional query parameters
   * @returns {Promise<Array>} Patient invoices
   */
  getPatientInvoices: async (patientId, params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Request({
          method: 'POST',
          path: '/api/v2/billing/invoices/search',
          body: {
            limit: normalizeLimit(params),
            cursor: params.cursor || params.next_cursor,
            patient_id: patientId,
          },
          signal: options.signal || params.signal,
        });
        return Array.isArray(response?.data) ? response.data.map(adaptV2Invoice) : [];
      }

      const queryParams = { patient_id: patientId, ...params };
      const queryString = new URLSearchParams(queryParams).toString();
      return await apiClient.get(`/billing/invoices/for_patient/?${queryString}`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch patient invoices'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch patient invoices'));
    }
  },

  /**
   * Create a new invoice
   * @param {Object} data - Invoice data with items
   * @returns {Promise<Object>} Created invoice
   */
  createInvoice: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const signal = options.signal || data?.signal;
        const firstItem = (Array.isArray(data.items) ? data.items : [])
          .find((item) => item?.service || item?.service_price_id);
        if (!firstItem) {
          throw new Error('Select at least one billable service.');
        }
        let servicePriceId = firstItem.service_price_id || null;
        if (!servicePriceId) {
          const services = await getV2ServicesPage({ is_active: true }, { signal });
          servicePriceId = services.results.find((service) => service.id === firstItem.service)?.service_price_id;
        }
        if (!servicePriceId) {
          throw new Error('Selected service does not have an active Rust V2 price.');
        }
        const response = await v2Api.postBillingInvoices({
          patient_id: data.patient_id || data.patient,
          service_price_id: servicePriceId,
          quantity: Number.parseInt(String(firstItem.quantity || 1), 10) || 1,
        }, {
          signal,
        });
        return adaptV2Invoice(response?.data);
      }

      return await apiClient.post('/billing/invoices/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create invoice');
      }
      throw new Error(handleApiError(error, 'Failed to create invoice'));
    }
  },

  /**
   * Update an invoice
   * @param {string} id - Invoice ID
   * @param {Object} data - Invoice data to update
   * @returns {Promise<Object>} Updated invoice
   */
  updateInvoice: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('invoice updates');
      }

      return await apiClient.patch(`/billing/invoices/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update invoice');
      }
      throw new Error(handleApiError(error, 'Failed to update invoice'));
    }
  },

  /**
   * Record a payment for an invoice
   * @param {string} invoiceId - Invoice ID
   * @param {Object} data - Payment data
   * @param {number} data.amount - Payment amount
   * @param {string} data.payment_method - Payment method
   * @param {string} data.reference_number - Optional reference
   * @param {string} data.notes - Optional notes
   * @returns {Promise<Object>} Payment and receipt data
   */
  recordPayment: async (invoiceId, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postBillingPayments({
          invoice_id: invoiceId,
          amount_minor: data.amount_minor ?? majorToMinor(data.amount),
          method: data.method || data.payment_method || 'cash',
          cash_session_id: data.cash_session_id || null,
        }, {
          signal: options.signal || data?.signal,
        });
        return adaptV2Payment(response?.data);
      }

      return await apiClient.post(`/billing/invoices/${invoiceId}/mark_as_paid/`, data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to record payment');
      }
      throw new Error(handleApiError(error, 'Failed to record payment'));
    }
  },

  /**
   * Generate an insurance claim for an invoice
   * @param {string} invoiceId - Invoice ID
   * @returns {Promise<Object>} Created claim
   */
  generateClaim: async (invoiceId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postNhisClaims(
          { invoice_id: invoiceId },
          { signal: options.signal },
        );
        return adaptV2Claim(response?.data);
      }

      return await apiClient.post(`/billing/invoices/${invoiceId}/generate_claim/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to generate claim');
      }
      throw new Error(handleApiError(error, 'Failed to generate claim'));
    }
  },

  // =========================================================================
  // PSP Payment Intents
  // =========================================================================

  getPaymentIntents: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await requestV2SearchableCursorList({
          path: '/api/v2/billing/payment-intents',
          searchPath: '/api/v2/billing/payment-intents/search',
          query: buildSafeBillingCursorQuery(params, BILLING_LIST_SCOPES.paymentIntents),
          signal: params.signal,
        });
        return v2Page(response, params, adaptV2PspPaymentIntent, BILLING_LIST_SCOPES.paymentIntents);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/payment-intents/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch payment intents');
      }
      throw new Error(handleApiError(error, 'Failed to fetch payment intents'));
    }
  },

  createPaymentIntent: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('payment intents');
      }

      return await apiClient.post('/billing/payment-intents/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create payment intent');
      }
      throw new Error(handleApiError(error, 'Failed to create payment intent'));
    }
  },

  // =========================================================================
  // PSP Settlements (Optional Reconciliation)
  // =========================================================================

  getSettlementBatches: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await requestV2SearchableCursorList({
          path: '/api/v2/billing/settlements',
          searchPath: '/api/v2/billing/settlements/search',
          query: buildSafeBillingCursorQuery(params, BILLING_LIST_SCOPES.settlementBatches),
          signal: params.signal,
        });
        return v2Page(response, params, adaptV2PspSettlementBatch, BILLING_LIST_SCOPES.settlementBatches);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/settlements/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch settlement batches');
      }
      throw new Error(handleApiError(error, 'Failed to fetch settlement batches'));
    }
  },

  importSettlement: async ({ provider = 'hubtel', statement_date = null, file }) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('settlement imports');
      }

      const form = new FormData();
      if (provider) form.append('provider', provider);
      if (statement_date) form.append('statement_date', statement_date);
      form.append('file', file);
      return await apiClient.postForm('/billing/settlements/import/', form, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to import settlement');
      }
      throw new Error(handleApiError(error, 'Failed to import settlement'));
    }
  },

  getSettlementLines: async (batchId, params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const scope = `${BILLING_LIST_SCOPES.settlementLines}:${batchId}`;
        const response = await requestV2SearchableCursorList({
          path: `/api/v2/billing/settlements/${batchId}/lines`,
          searchPath: `/api/v2/billing/settlements/${batchId}/lines/search`,
          query: buildSafeBillingCursorQuery(params, scope),
          signal: params.signal,
        });
        return v2Page(response, params, adaptV2PspSettlementLine, scope);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/settlements/${batchId}/lines/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch settlement lines');
      }
      throw new Error(handleApiError(error, 'Failed to fetch settlement lines'));
    }
  },

  // =========================================================================
  // Cash Controls
  // =========================================================================

  getCashSessions: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getCashSessions({
          query: {
            limit: normalizeLimit(params),
            cursor: normalizeCursor(params, BILLING_LIST_SCOPES.cashSessions),
            ...(params.status && params.status !== 'all' ? { status: params.status } : {}),
            ...(params.search ? { search: String(params.search).trim() } : {}),
            ...(params.is_flagged !== undefined && params.is_flagged !== null && params.is_flagged !== ''
              ? { is_flagged: params.is_flagged === true || params.is_flagged === 'true' || params.is_flagged === '1' }
              : {}),
          },
          signal: params.signal,
        });
        return v2Page(response, params, adaptV2CashSession, BILLING_LIST_SCOPES.cashSessions);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/cash-sessions/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch cash sessions');
      }
      throw new Error(handleApiError(error, 'Failed to fetch cash sessions'));
    }
  },

  getCurrentCashSession: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getCashSessions({
          query: { status: 'open', limit: 1 },
          signal: options.signal,
        });
        const session = v2List(response).map(adaptV2CashSession)[0] || null;
        return { session };
      }

      return await apiClient.get('/billing/cash-sessions/current/');
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch current cash session');
      }
      throw new Error(handleApiError(error, 'Failed to fetch current cash session'));
    }
  },

  getCashSessionTotals: async (sessionId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getCashSessionById(
          { id: sessionId },
          { signal: options.signal },
        );
        const session = adaptV2CashSession(response?.data);
        return {
          expected_cash_amount: session?.expected_cash_amount || 0,
          opening_float_amount: session?.opening_float_amount || 0,
          counted_cash_amount: session?.counted_cash_amount ?? null,
          variance_amount: session?.variance_amount ?? null,
        };
      }

      return await apiClient.get(`/billing/cash-sessions/${sessionId}/totals/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch cash session totals');
      }
      throw new Error(handleApiError(error, 'Failed to fetch cash session totals'));
    }
  },

  openCashSession: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        let drawerId = data.drawer_id;
        if (!drawerId) {
          const drawers = v2List(await v2Api.getCashDrawers({ signal: options.signal }));
          drawerId = drawers.find((drawer) => drawer.active)?.id || drawers[0]?.id;
        }
        if (!drawerId) {
          throw new Error('No active cash drawer is configured.');
        }
        const response = await v2Api.postCashSessions(
          {
            drawer_id: drawerId,
            opening_float_minor: data.opening_float_minor ?? majorToMinor(data.opening_float_amount),
          },
          { signal: options.signal },
        );
        return adaptV2CashSession(response?.data);
      }

      return await apiClient.post('/billing/cash-sessions/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to open cash session');
      }
      throw new Error(handleApiError(error, 'Failed to open cash session'));
    }
  },

  closeCashSession: async (sessionId, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postCashSessionClose(
          { id: sessionId },
          {
            counted_cash_minor: data.counted_cash_minor ?? majorToMinor(data.counted_cash_amount),
          },
          { signal: options.signal },
        );
        return adaptV2CashSession(response?.data);
      }

      return await apiClient.post(`/billing/cash-sessions/${sessionId}/close/`, data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to close cash session');
      }
      throw new Error(handleApiError(error, 'Failed to close cash session'));
    }
  },

  reviewCashSession: async (sessionId, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('cash session review');
      }

      return await apiClient.post(`/billing/cash-sessions/${sessionId}/review/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to review cash session');
      }
      throw new Error(handleApiError(error, 'Failed to review cash session'));
    }
  },

  createCashMovement: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('cash movements');
      }

      return await apiClient.post('/billing/cash-movements/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create cash movement');
      }
      throw new Error(handleApiError(error, 'Failed to create cash movement'));
    }
  },

  // =========================================================================
  // Claims
  // =========================================================================

  /**
   * Get claims with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated claims with count, next, previous, results
   */
  getClaims: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const query = buildBillingListQuery(params, BILLING_LIST_SCOPES.claims);
        const response = await requestV2BillingList({
          query,
          signal: options.signal || params.signal,
          searchPath: '/api/v2/nhis/claims/search',
          getList: (request) => v2Api.getNhisClaims(request),
        });
        return v2Page(response, params, adaptV2Claim, BILLING_LIST_SCOPES.claims);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/claims/${queryString ? `?${queryString}` : ''}`;
      // Use getWithPagination to preserve count, next, previous metadata
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch claims');
      }
      throw new Error(handleApiError(error, 'Failed to fetch claims'));
    }
  },

  /**
   * Get a single claim by ID
   * @param {string} id - Claim ID
   * @returns {Promise<Object>} Claim data
   */
  getClaim: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await findV2Claim(id, options);
      }

      return await apiClient.get(`/billing/claims/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch claim');
      }
      throw new Error(handleApiError(error, 'Failed to fetch claim'));
    }
  },

  /**
   * Update claim status
   * @param {string} id - Claim ID
   * @param {Object} data - Status update data
   * @param {string} data.status - New status
   * @param {number} data.approved_amount - Optional approved amount
   * @param {string} data.rejection_reason - Optional rejection reason
   * @returns {Promise<Object>} Updated claim
   */
  updateClaimStatus: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('claim status updates');
      }

      return await apiClient.post(`/billing/claims/${id}/update_status/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update claim status');
      }
      throw new Error(handleApiError(error, 'Failed to update claim status'));
    }
  },

  // =========================================================================
  // NHIS (Claim-it) + AR
  // =========================================================================

  getNhisClaimBatches: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getNhisBatches({
          query: {
            limit: normalizeLimit(params, 20),
            cursor: normalizeCursor(params, BILLING_LIST_SCOPES.nhisBatches),
          },
          signal: options.signal,
        });
        return v2Page(response, params, adaptV2NhisBatch, BILLING_LIST_SCOPES.nhisBatches);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/batches/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch NHIS claim batches');
      }
      throw new Error(handleApiError(error, 'Failed to fetch NHIS claim batches'));
    }
  },

  createNhisClaimBatch: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        if (!Array.isArray(data.claim_ids) || data.claim_ids.length === 0) {
          throw new Error('Rust V2 NHIS batch creation requires selected claim IDs.');
        }
        const response = await v2Api.postNhisBatches(
          { claim_ids: data.claim_ids },
          { signal: options.signal },
        );
        return adaptV2NhisBatch(response?.data);
      }

      return await apiClient.post('/billing/nhis/batches/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create NHIS claim batch');
      }
      throw new Error(handleApiError(error, 'Failed to create NHIS claim batch'));
    }
  },

  lintNhisClaimBatch: async (batchId) => {
    try {
      if (isRustV2ApiMode()) {
        return { summary: [] };
      }

      return await apiClient.post(`/billing/nhis/batches/${batchId}/lint/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to lint NHIS claim batch'));
    }
  },

  exportNhisClaimBatch: async (batchId, data = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postNhisBatchExport(
          { id: batchId },
          { signal: options.signal },
        );
        return response?.data;
      }

      return await apiClient.post(`/billing/nhis/batches/${batchId}/export/`, data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to export NHIS claim batch');
      }
      throw new Error(handleApiError(error, 'Failed to export NHIS claim batch'));
    }
  },

  getNhisExportJobs: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Request({
          method: 'GET',
          path: '/api/v2/nhis/exports',
          query: {
            limit: normalizeLimit(params, 20),
            cursor: normalizeCursor(params, BILLING_LIST_SCOPES.nhisExports),
          },
          signal: params.signal,
        });
        return v2Page(response, params, adaptV2NhisExportJob, BILLING_LIST_SCOPES.nhisExports);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/exports/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch NHIS export jobs');
      }
      throw new Error(handleApiError(error, 'Failed to fetch NHIS export jobs'));
    }
  },

  downloadNhisExportJob: async (jobId) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('NHIS export downloads');
      }

      return await apiClient.getBlob(`/billing/nhis/exports/${jobId}/download/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to download NHIS export payload');
      }
      throw new Error(handleApiError(error, 'Failed to download NHIS export payload'));
    }
  },

  getRemittanceImportJobs: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getNhisRemittanceImports({
          query: {
            limit: normalizeLimit(params, 20),
            cursor: normalizeCursor(params, BILLING_LIST_SCOPES.remittanceImports),
          },
          signal: options.signal,
        });
        return v2Page(response, params, adaptV2RemittanceImport, BILLING_LIST_SCOPES.remittanceImports);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/remittances/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch remittance imports');
      }
      throw new Error(handleApiError(error, 'Failed to fetch remittance imports'));
    }
  },

  importRemittance: async ({ payerId, file }) => {
    try {
      if (isRustV2ApiMode()) {
        throw new Error('Rust V2 remittance imports require a structured batch remittance payload.');
      }

      const form = new FormData();
      form.append('payer', payerId);
      form.append('file', file);
      return await apiClient.postForm('/billing/nhis/remittances/import/', form, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowAbortError(error);
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to import remittance'));
    }
  },

  getRemittanceLines: async (jobId, params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const scope = `${BILLING_LIST_SCOPES.remittanceLines}:${jobId}`;
        const response = await requestV2SearchableCursorList({
          path: `/api/v2/nhis/remittance-imports/${jobId}/lines`,
          searchPath: `/api/v2/nhis/remittance-imports/${jobId}/lines/search`,
          query: buildSafeBillingCursorQuery(params, scope),
          signal: params.signal,
        });
        return v2Page(response, params, adaptV2RemittanceLine, scope);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/remittances/${jobId}/lines/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch remittance lines');
      }
      throw new Error(handleApiError(error, 'Failed to fetch remittance lines'));
    }
  },

  getInsuranceAging: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return emptyAgingSnapshot();
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/ar/insurance_aging/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch insurance aging'));
    }
  },

  getInsuranceDSO: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return { dso_days: null, total_balance: 0 };
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/ar/insurance_dso/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch insurance DSO'));
    }
  },

  getRemittanceQueue: async () => {
    try {
      if (isRustV2ApiMode()) {
        return { summary: [] };
      }

      return await apiClient.get('/billing/nhis/ar/remittance_queue/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch remittance queue'));
    }
  },

  // =========================================================================
  // Payments
  // =========================================================================

  /**
   * Get payments with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated payments with count, next, previous, results
   */
  getPayments: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const query = buildBillingListQuery(params, BILLING_LIST_SCOPES.payments);
        const response = await requestV2BillingList({
          query,
          signal: options.signal || params.signal,
          searchPath: '/api/v2/billing/payments/search',
          getList: (request) => v2Api.getBillingPayments(request),
        });
        return v2Page(response, params, adaptV2Payment, BILLING_LIST_SCOPES.payments);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/payments/${queryString ? `?${queryString}` : ''}`;
      // Use getWithPagination to preserve count, next, previous metadata
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch payments');
      }
      throw new Error(handleApiError(error, 'Failed to fetch payments'));
    }
  },

  /**
   * Generate receipt for a payment
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object>} Receipt data
   */
  generateReceipt: async (paymentId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await getV2ReceiptByPayment(paymentId, options);
      }

      return await apiClient.post(`/billing/payments/${paymentId}/generate_receipt/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to generate receipt');
      }
      throw new Error(handleApiError(error, 'Failed to generate receipt'));
    }
  },

  /**
   * Get receipt details for printing (includes invoice items)
   * @param {string} receiptId - Receipt ID
   * @returns {Promise<Object>} Full receipt data with invoice items
   */
  getReceiptPrintDetail: async (receiptId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const receipt = await getV2Receipt(receiptId, options);
        return { ...receipt, items: [] };
      }

      return await apiClient.get(`/billing/receipts/${receiptId}/print_detail/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch receipt details');
      }
      throw new Error(handleApiError(error, 'Failed to fetch receipt details'));
    }
  },

  /**
   * Get receipt by receipt number for printing
   * @param {string} receiptNumber - Receipt number
   * @returns {Promise<Object>} Full receipt data with invoice items
   */
  getReceiptByNumber: async (receiptNumber, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await getV2ReceiptByNumber(receiptNumber, options);
      }

      return await apiClient.get(`/billing/receipts/by_receipt_number/?receipt_number=${encodeURIComponent(receiptNumber)}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch receipt');
      }
      throw new Error(handleApiError(error, 'Failed to fetch receipt'));
    }
  },

  // =========================================================================
  // Services
  // =========================================================================

  getServiceCategories: async (params = {}, _options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return v2ServiceCategoriesPage(null, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/service-categories/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch service categories');
      }
      throw new Error(handleApiError(error, 'Failed to fetch service categories'));
    }
  },

  createServiceCategory: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('service category mutations');
      }

      return await apiClient.post('/billing/service-categories/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create service category');
      }
      throw new Error(handleApiError(error, 'Failed to create service category'));
    }
  },

  updateServiceCategory: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('service category mutations');
      }

      return await apiClient.patch(`/billing/service-categories/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update service category');
      }
      throw new Error(handleApiError(error, 'Failed to update service category'));
    }
  },

  /**
   * Get services with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated services
   */
  getServices: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await getV2ServicesPage(params, options);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/services/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch services');
      }
      throw new Error(handleApiError(error, 'Failed to fetch services'));
    }
  },

  createService: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('service catalog mutations');
      }

      return await apiClient.post('/billing/services/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create service');
      }
      throw new Error(handleApiError(error, 'Failed to create service'));
    }
  },

  updateService: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('service catalog mutations');
      }

      return await apiClient.patch(`/billing/services/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update service');
      }
      throw new Error(handleApiError(error, 'Failed to update service'));
    }
  },

  /**
   * Get services grouped by category
   * @returns {Promise<Array>} Services grouped by category
   */
  getServicesByCategory: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const servicesPage = await getV2ServicesPage({ is_active: true }, options);
        return servicesPage.results.reduce((groups, service) => {
          const category = service.category_name || 'Other';
          const group = groups.find((candidate) => candidate.category === category);
          if (group) {
            group.services.push(service);
          } else {
            groups.push({ category, services: [service] });
          }
          return groups;
        }, []);
      }

      return await apiClient.get('/billing/services/by_category/');
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch services by category');
      }
      throw new Error(handleApiError(error, 'Failed to fetch services by category'));
    }
  },

  // =========================================================================
  // Payer Service Code Mappings (NHIS/Other)
  // =========================================================================

  getPayerServiceCodes: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const query = {
          limit: normalizeLimit(params),
          cursor: normalizeCursor(params, BILLING_LIST_SCOPES.payerServiceCodes),
        };
        addStringQueryParam(query, params, 'search');
        addActiveQueryParam(query, params);
        if (params.payer || params.payer_id) {
          query.payer_id = params.payer || params.payer_id;
        }
        const response = await v2Request({
          method: 'GET',
          path: '/api/v2/nhis/service-mappings',
          query,
          signal: params.signal,
        });
        return v2Page(response, params, adaptV2PayerServiceCode, BILLING_LIST_SCOPES.payerServiceCodes);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/payer-service-codes/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch payer service codes');
      }
      throw new Error(handleApiError(error, 'Failed to fetch payer service codes'));
    }
  },

  createPayerServiceCode: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Request({
          method: 'POST',
          path: '/api/v2/nhis/service-mappings',
          body: {
            payer_id: data.payer_id || data.payer || null,
            service_id: data.service_id || data.service,
            nhis_code: data.nhis_code || data.external_code,
            effective_from: data.effective_from,
            effective_until: data.effective_until || null,
          },
          signal: data.signal,
        });
        return adaptV2PayerServiceCode(response?.data);
      }

      return await apiClient.post('/billing/payer-service-codes/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create payer service code');
      }
      throw new Error(handleApiError(error, 'Failed to create payer service code'));
    }
  },

  updatePayerServiceCode: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('payer service code mutations');
      }

      return await apiClient.patch(`/billing/payer-service-codes/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update payer service code');
      }
      throw new Error(handleApiError(error, 'Failed to update payer service code'));
    }
  },

  // =========================================================================
  // NHIS Mapping Bulk Import (Preview + Apply)
  // =========================================================================

  getNhisMappingImportJobs: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return emptyPage();
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/mapping-imports/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch mapping import jobs'));
    }
  },

  getNhisMappingImportJob: async (id, _options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('NHIS mapping import detail');
      }

      return await apiClient.get(`/billing/nhis/mapping-imports/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch mapping import job');
      }
      throw new Error(handleApiError(error, 'Failed to fetch mapping import job'));
    }
  },

  createNhisMappingImportJob: async ({ payer, seed_services = false, file }) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('NHIS mapping imports');
      }

      const form = new FormData();
      form.append('payer', payer);
      form.append('seed_services', seed_services ? '1' : '0');
      form.append('file', file);
      return await apiClient.postForm('/billing/nhis/mapping-imports/import/', form, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create mapping import job');
      }
      throw new Error(handleApiError(error, 'Failed to create mapping import job'));
    }
  },

  applyNhisMappingImportJob: async (id, { force = false } = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('NHIS mapping import apply');
      }

      return await apiClient.post(`/billing/nhis/mapping-imports/${id}/apply/`, { force }, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to apply mapping import job');
      }
      throw new Error(handleApiError(error, 'Failed to apply mapping import job'));
    }
  },

  // =========================================================================
  // Billing Rules
  // =========================================================================

  /**
   * Get billing rules with optional filtering
   * @param {Object} params - Query parameters
   * @param {string} params.facility - Filter by facility ID
   * @param {string} params.rule_type - Filter by rule type
   * @param {boolean} params.is_active - Filter by active status
   * @returns {Promise<Object>} Paginated billing rules with count, next, previous, results
   */
  getBillingRules: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getBillingRules({
          query: {
            limit: normalizeLimit(params),
            rule_type: params.rule_type,
            is_active: params.is_active,
          },
          signal: options.signal,
        });
        return v2Page(response, (rule) => ({
          ...rule,
          rule_type: rule.rule_type,
          is_active: rule.active !== false,
        }));
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/billing-rules/${queryString ? `?${queryString}` : ''}`;
      // Use getWithPagination to preserve count, next, previous metadata
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch billing rules');
      }
      throw new Error(handleApiError(error, 'Failed to fetch billing rules'));
    }
  },

  /**
   * Get a single billing rule by ID
   * @param {string} id - Billing rule ID
   * @returns {Promise<Object>} Billing rule data
   */
  getBillingRule: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await findV2BillingRule(id, options);
      }

      return await apiClient.get(`/billing/billing-rules/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch billing rule');
      }
      throw new Error(handleApiError(error, 'Failed to fetch billing rule'));
    }
  },

  /**
   * Create a new billing rule
   * @param {Object} data - Billing rule data
   * @returns {Promise<Object>} Created billing rule
   */
  createBillingRule: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('billing rule mutations');
      }

      return await apiClient.post('/billing/billing-rules/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create billing rule');
      }
      throw new Error(handleApiError(error, 'Failed to create billing rule'));
    }
  },

  /**
   * Update a billing rule
   * @param {string} id - Billing rule ID
   * @param {Object} data - Billing rule data to update
   * @returns {Promise<Object>} Updated billing rule
   */
  updateBillingRule: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('billing rule mutations');
      }

      return await apiClient.patch(`/billing/billing-rules/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update billing rule');
      }
      throw new Error(handleApiError(error, 'Failed to update billing rule'));
    }
  },

  /**
   * Toggle billing rule active status
   * @param {string} id - Billing rule ID
   * @returns {Promise<Object>} Updated billing rule
   */
  toggleBillingRule: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('billing rule mutations');
      }

      return await apiClient.post(`/billing/billing-rules/${id}/toggle_active/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to toggle billing rule');
      }
      throw new Error(handleApiError(error, 'Failed to toggle billing rule'));
    }
  },

  /**
   * Delete a billing rule
   * @param {string} id - Billing rule ID
   * @returns {Promise<void>}
   */
  deleteBillingRule: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('billing rule mutations');
      }

      return await apiClient.delete(`/billing/billing-rules/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to delete billing rule');
      }
      throw new Error(handleApiError(error, 'Failed to delete billing rule'));
    }
  },

  // =========================================================================
  // Facility Billing Settings
  // =========================================================================

  /**
   * Get facility billing settings
   * @param {string} facilityId - Facility ID
   * @returns {Promise<Object>} Billing settings
   */
  getFacilityBillingSettings: async (facilityId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getCashDrawers({ signal: options.signal });
        const drawers = v2List(response);
        return [
          {
            id: 'rust-v2-cash-controls',
            facility: facilityId || null,
            cash_control_enabled: drawers.some((drawer) => drawer.active),
            cash_drawer_count: drawers.length,
          },
        ];
      }

      const endpoint = facilityId
        ? `/billing/billing-settings/?facility=${facilityId}`
        : '/billing/billing-settings/';
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch billing settings');
      }
      throw new Error(handleApiError(error, 'Failed to fetch billing settings'));
    }
  },

  /**
   * Update facility billing settings
   * @param {string} id - Settings ID
   * @param {Object} data - Settings data to update
   * @returns {Promise<Object>} Updated settings
   */
  updateFacilityBillingSettings: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('facility billing settings updates');
      }

      return await apiClient.patch(`/billing/billing-settings/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update billing settings');
      }
      throw new Error(handleApiError(error, 'Failed to update billing settings'));
    }
  },

  // =========================================================================
  // Insurance
  // =========================================================================

  /**
   * Get all patient insurance records with pagination
   * @param {Object} params - Query parameters
   * @param {string} params.search - Search query
   * @param {number} params.page - Page number
   * @param {number} params.page_size - Page size
   * @returns {Promise<Object>} Paginated patient insurance records
   */
  getPatientInsurances: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const query = {
          limit: normalizeLimit(params),
          cursor: normalizeCursor(params, BILLING_LIST_SCOPES.patientInsurances),
          ...(params.patient_id ? { patient_id: params.patient_id } : {}),
          ...(params.search ? { search: String(params.search).trim() } : {}),
          ...(params.is_active !== undefined && params.is_active !== null && params.is_active !== ''
            ? { is_active: params.is_active === true || params.is_active === 'true' || params.is_active === 'active' }
            : {}),
        };
        const response = requiresPrivateBillingListRequest(query)
          ? await v2Request({
              method: 'POST',
              path: '/api/v2/billing/patient-insurances/search',
              body: query,
              signal: params.signal,
            })
          : await v2Api.getBillingPatientInsurances({
              query,
              signal: params.signal,
            });
        return v2Page(response, params, (insurance) => insurance, BILLING_LIST_SCOPES.patientInsurances);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/patient-insurances/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: params.signal });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch patient insurances');
      }
      throw new Error(handleApiError(error, 'Failed to fetch patient insurances'));
    }
  },

  /**
   * Get patient insurance records for a specific patient
   * @param {string} patientId - Patient ID
   * @param {Object} params - Additional query parameters
   * @returns {Promise<Array>} Patient insurance records
   */
  getPatientInsurance: async (patientId, params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const scope = `${BILLING_LIST_SCOPES.patientInsurances}:${patientId}`;
        const response = await v2Request({
          method: 'POST',
          path: '/api/v2/billing/patient-insurances/search',
          body: {
            limit: normalizeLimit(params),
            cursor: normalizeCursor(params, scope),
            patient_id: patientId,
          },
          signal: params.signal,
        });
        return v2Page(response, params, (insurance) => insurance, scope);
      }

      const queryParams = { patient_id: patientId, ...params };
      const queryString = new URLSearchParams(queryParams).toString();
      return await apiClient.get(`/billing/patient-insurances/for_patient/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patient insurance'));
    }
  },

  /**
   * Get a single patient insurance by ID
   * @param {string} id - Patient insurance ID
   * @returns {Promise<Object>} Patient insurance record
   */
  getPatientInsuranceById: async (id, _options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('patient insurance detail');
      }

      return await apiClient.get(`/billing/patient-insurances/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch patient insurance');
      }
      throw new Error(handleApiError(error, 'Failed to fetch patient insurance'));
    }
  },

  /**
   * Create a new patient insurance record
   * @param {Object} data - Patient insurance data
   * @param {string} data.patient - Patient ID
   * @param {string} data.plan - Insurance plan ID
   * @param {string} data.policy_number - Policy number
   * @param {string} data.valid_from - Start date (YYYY-MM-DD)
   * @param {string} data.valid_until - End date (YYYY-MM-DD, optional)
   * @param {boolean} data.is_active - Active status
   * @returns {Promise<Object>} Created patient insurance
   */
  createPatientInsurance: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('patient insurance mutations');
      }

      return await apiClient.post('/billing/patient-insurances/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create patient insurance');
      }
      throw new Error(handleApiError(error, 'Failed to create patient insurance'));
    }
  },

  /**
   * Update a patient insurance record
   * @param {string} id - Patient insurance ID
   * @param {Object} data - Patient insurance data to update
   * @returns {Promise<Object>} Updated patient insurance
   */
  updatePatientInsurance: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('patient insurance mutations');
      }

      return await apiClient.patch(`/billing/patient-insurances/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update patient insurance');
      }
      throw new Error(handleApiError(error, 'Failed to update patient insurance'));
    }
  },

  /**
   * Delete a patient insurance record
   * @param {string} id - Patient insurance ID
   * @returns {Promise<void>}
   */
  deletePatientInsurance: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('patient insurance mutations');
      }

      return await apiClient.delete(`/billing/patient-insurances/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to delete patient insurance');
      }
      throw new Error(handleApiError(error, 'Failed to delete patient insurance'));
    }
  },

  /**
   * Get insurance providers
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated insurance providers
   */
  getInsuranceProviders: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getBillingInsuranceProviders({
          query: {
            limit: normalizeLimit(params),
            cursor: normalizeCursor(params, BILLING_LIST_SCOPES.insuranceProviders),
            ...(params.search ? { search: String(params.search).trim() } : {}),
            ...(params.is_active !== undefined && params.is_active !== null && params.is_active !== ''
              ? { is_active: params.is_active === true || params.is_active === 'true' || params.is_active === 'active' }
              : {}),
          },
          signal: params.signal,
        });
        return v2Page(response, params, (provider) => provider, BILLING_LIST_SCOPES.insuranceProviders);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/insurance-providers/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch insurance providers'));
    }
  },

  /**
   * Get insurance plans
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated insurance plans
   */
  getInsurancePlans: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getBillingInsurancePlans({
          query: {
            limit: normalizeLimit(params),
            cursor: normalizeCursor(params, BILLING_LIST_SCOPES.insurancePlans),
            ...(params.provider_id || params.provider ? { provider_id: params.provider_id || params.provider } : {}),
            ...(params.search ? { search: String(params.search).trim() } : {}),
            ...(params.is_active !== undefined && params.is_active !== null && params.is_active !== ''
              ? { is_active: params.is_active === true || params.is_active === 'true' || params.is_active === 'active' }
              : {}),
          },
          signal: params.signal,
        });
        return v2Page(response, params, (plan) => plan, BILLING_LIST_SCOPES.insurancePlans);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/insurance-plans/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch insurance plans'));
    }
  },
};
