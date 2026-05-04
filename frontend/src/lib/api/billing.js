import { apiClient, handleApiError } from '../api-client';

function generateIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (_e) {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  getDashboardMetrics: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/dashboard/metrics/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
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
  getRecentInvoices: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/dashboard/recent_invoices/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
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
  getRecentPayments: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/dashboard/recent_payments/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
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
  getInvoices: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/invoices/${queryString ? `?${queryString}` : ''}`;
      // Use getWithPagination to preserve count, next, previous metadata
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch invoices'));
    }
  },

  /**
   * Get a single invoice by ID
   * @param {string} id - Invoice ID
   * @returns {Promise<Object>} Invoice data with items and payments
   */
  getInvoice: async (id) => {
    try {
      return await apiClient.get(`/billing/invoices/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch invoice'));
    }
  },

  /**
   * Get invoice details for printing (logs audit trail)
   * @param {string} id - Invoice ID
   * @returns {Promise<Object>} Invoice data for printing
   */
  getInvoicePrintDetail: async (id) => {
    try {
      return await apiClient.get(`/billing/invoices/${id}/print_detail/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch invoice for printing'));
    }
  },

  /**
   * Get invoices for a specific patient
   * @param {string} patientId - Patient ID
   * @param {Object} params - Additional query parameters
   * @returns {Promise<Array>} Patient invoices
   */
  getPatientInvoices: async (patientId, params = {}) => {
    try {
      const queryParams = { patient_id: patientId, ...params };
      const queryString = new URLSearchParams(queryParams).toString();
      return await apiClient.get(`/billing/invoices/for_patient/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patient invoices'));
    }
  },

  /**
   * Create a new invoice
   * @param {Object} data - Invoice data with items
   * @returns {Promise<Object>} Created invoice
   */
  createInvoice: async (data) => {
    try {
      return await apiClient.post('/billing/invoices/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
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
      return await apiClient.patch(`/billing/invoices/${id}/`, data);
    } catch (error) {
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
  recordPayment: async (invoiceId, data) => {
    try {
      return await apiClient.post(`/billing/invoices/${invoiceId}/mark_as_paid/`, data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to record payment'));
    }
  },

  /**
   * Generate an insurance claim for an invoice
   * @param {string} invoiceId - Invoice ID
   * @returns {Promise<Object>} Created claim
   */
  generateClaim: async (invoiceId) => {
    try {
      return await apiClient.post(`/billing/invoices/${invoiceId}/generate_claim/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to generate claim'));
    }
  },

  // =========================================================================
  // PSP Payment Intents
  // =========================================================================

  getPaymentIntents: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/payment-intents/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch payment intents'));
    }
  },

  createPaymentIntent: async (data) => {
    try {
      return await apiClient.post('/billing/payment-intents/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create payment intent'));
    }
  },

  // =========================================================================
  // PSP Settlements (Optional Reconciliation)
  // =========================================================================

  getSettlementBatches: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/settlements/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch settlement batches'));
    }
  },

  importSettlement: async ({ provider = 'hubtel', statement_date = null, file }) => {
    try {
      const form = new FormData();
      if (provider) form.append('provider', provider);
      if (statement_date) form.append('statement_date', statement_date);
      form.append('file', file);
      return await apiClient.postForm('/billing/settlements/import/', form, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to import settlement'));
    }
  },

  getSettlementLines: async (batchId, params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/settlements/${batchId}/lines/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch settlement lines'));
    }
  },

  // =========================================================================
  // Cash Controls
  // =========================================================================

  getCashSessions: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/cash-sessions/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch cash sessions'));
    }
  },

  getCurrentCashSession: async () => {
    try {
      return await apiClient.get('/billing/cash-sessions/current/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch current cash session'));
    }
  },

  getCashSessionTotals: async (sessionId) => {
    try {
      return await apiClient.get(`/billing/cash-sessions/${sessionId}/totals/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch cash session totals'));
    }
  },

  openCashSession: async (data) => {
    try {
      return await apiClient.post('/billing/cash-sessions/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to open cash session'));
    }
  },

  closeCashSession: async (sessionId, data) => {
    try {
      return await apiClient.post(`/billing/cash-sessions/${sessionId}/close/`, data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to close cash session'));
    }
  },

  reviewCashSession: async (sessionId, data) => {
    try {
      return await apiClient.post(`/billing/cash-sessions/${sessionId}/review/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to review cash session'));
    }
  },

  createCashMovement: async (data) => {
    try {
      return await apiClient.post('/billing/cash-movements/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
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
  getClaims: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/claims/${queryString ? `?${queryString}` : ''}`;
      // Use getWithPagination to preserve count, next, previous metadata
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch claims'));
    }
  },

  /**
   * Get a single claim by ID
   * @param {string} id - Claim ID
   * @returns {Promise<Object>} Claim data
   */
  getClaim: async (id) => {
    try {
      return await apiClient.get(`/billing/claims/${id}/`);
    } catch (error) {
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
      return await apiClient.post(`/billing/claims/${id}/update_status/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update claim status'));
    }
  },

  // =========================================================================
  // NHIS (Claim-it) + AR
  // =========================================================================

  getNhisClaimBatches: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/batches/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch NHIS claim batches'));
    }
  },

  createNhisClaimBatch: async (data) => {
    try {
      return await apiClient.post('/billing/nhis/batches/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create NHIS claim batch'));
    }
  },

  lintNhisClaimBatch: async (batchId) => {
    try {
      return await apiClient.post(`/billing/nhis/batches/${batchId}/lint/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to lint NHIS claim batch'));
    }
  },

  exportNhisClaimBatch: async (batchId, data = {}) => {
    try {
      return await apiClient.post(`/billing/nhis/batches/${batchId}/export/`, data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to export NHIS claim batch'));
    }
  },

  getNhisExportJobs: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/exports/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch NHIS export jobs'));
    }
  },

  downloadNhisExportJob: async (jobId) => {
    try {
      return await apiClient.getBlob(`/billing/nhis/exports/${jobId}/download/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to download NHIS export payload'));
    }
  },

  getRemittanceImportJobs: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/remittances/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch remittance imports'));
    }
  },

  importRemittance: async ({ payerId, file }) => {
    try {
      const form = new FormData();
      form.append('payer', payerId);
      form.append('file', file);
      return await apiClient.postForm('/billing/nhis/remittances/import/', form, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to import remittance'));
    }
  },

  getRemittanceLines: async (jobId, params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/remittances/${jobId}/lines/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch remittance lines'));
    }
  },

  getInsuranceAging: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/ar/insurance_aging/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch insurance aging'));
    }
  },

  getInsuranceDSO: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/ar/insurance_dso/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch insurance DSO'));
    }
  },

  getRemittanceQueue: async () => {
    try {
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
  getPayments: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/payments/${queryString ? `?${queryString}` : ''}`;
      // Use getWithPagination to preserve count, next, previous metadata
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch payments'));
    }
  },

  /**
   * Generate receipt for a payment
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object>} Receipt data
   */
  generateReceipt: async (paymentId) => {
    try {
      return await apiClient.post(`/billing/payments/${paymentId}/generate_receipt/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to generate receipt'));
    }
  },

  /**
   * Get receipt details for printing (includes invoice items)
   * @param {string} receiptId - Receipt ID
   * @returns {Promise<Object>} Full receipt data with invoice items
   */
  getReceiptPrintDetail: async (receiptId) => {
    try {
      return await apiClient.get(`/billing/receipts/${receiptId}/print_detail/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch receipt details'));
    }
  },

  /**
   * Get receipt by receipt number for printing
   * @param {string} receiptNumber - Receipt number
   * @returns {Promise<Object>} Full receipt data with invoice items
   */
  getReceiptByNumber: async (receiptNumber) => {
    try {
      return await apiClient.get(`/billing/receipts/by_receipt_number/?receipt_number=${encodeURIComponent(receiptNumber)}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch receipt'));
    }
  },

  // =========================================================================
  // Services
  // =========================================================================

  getServiceCategories: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/service-categories/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch service categories'));
    }
  },

  createServiceCategory: async (data) => {
    try {
      return await apiClient.post('/billing/service-categories/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create service category'));
    }
  },

  updateServiceCategory: async (id, data) => {
    try {
      return await apiClient.patch(`/billing/service-categories/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update service category'));
    }
  },

  /**
   * Get services with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated services
   */
  getServices: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/services/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch services'));
    }
  },

  createService: async (data) => {
    try {
      return await apiClient.post('/billing/services/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create service'));
    }
  },

  updateService: async (id, data) => {
    try {
      return await apiClient.patch(`/billing/services/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update service'));
    }
  },

  /**
   * Get services grouped by category
   * @returns {Promise<Array>} Services grouped by category
   */
  getServicesByCategory: async () => {
    try {
      return await apiClient.get('/billing/services/by_category/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch services by category'));
    }
  },

  // =========================================================================
  // Payer Service Code Mappings (NHIS/Other)
  // =========================================================================

  getPayerServiceCodes: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/payer-service-codes/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch payer service codes'));
    }
  },

  createPayerServiceCode: async (data) => {
    try {
      return await apiClient.post('/billing/payer-service-codes/', data, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create payer service code'));
    }
  },

  updatePayerServiceCode: async (id, data) => {
    try {
      return await apiClient.patch(`/billing/payer-service-codes/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update payer service code'));
    }
  },

  // =========================================================================
  // NHIS Mapping Bulk Import (Preview + Apply)
  // =========================================================================

  getNhisMappingImportJobs: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/nhis/mapping-imports/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch mapping import jobs'));
    }
  },

  getNhisMappingImportJob: async (id) => {
    try {
      return await apiClient.get(`/billing/nhis/mapping-imports/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch mapping import job'));
    }
  },

  createNhisMappingImportJob: async ({ payer, seed_services = false, file }) => {
    try {
      const form = new FormData();
      form.append('payer', payer);
      form.append('seed_services', seed_services ? '1' : '0');
      form.append('file', file);
      return await apiClient.postForm('/billing/nhis/mapping-imports/import/', form, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create mapping import job'));
    }
  },

  applyNhisMappingImportJob: async (id, { force = false } = {}) => {
    try {
      return await apiClient.post(`/billing/nhis/mapping-imports/${id}/apply/`, { force }, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });
    } catch (error) {
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
  getBillingRules: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/billing-rules/${queryString ? `?${queryString}` : ''}`;
      // Use getWithPagination to preserve count, next, previous metadata
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch billing rules'));
    }
  },

  /**
   * Get a single billing rule by ID
   * @param {string} id - Billing rule ID
   * @returns {Promise<Object>} Billing rule data
   */
  getBillingRule: async (id) => {
    try {
      return await apiClient.get(`/billing/billing-rules/${id}/`);
    } catch (error) {
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
      return await apiClient.post('/billing/billing-rules/', data);
    } catch (error) {
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
      return await apiClient.patch(`/billing/billing-rules/${id}/`, data);
    } catch (error) {
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
      return await apiClient.post(`/billing/billing-rules/${id}/toggle_active/`);
    } catch (error) {
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
      return await apiClient.delete(`/billing/billing-rules/${id}/`);
    } catch (error) {
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
  getFacilityBillingSettings: async (facilityId) => {
    try {
      const endpoint = facilityId
        ? `/billing/billing-settings/?facility=${facilityId}`
        : '/billing/billing-settings/';
      return await apiClient.get(endpoint);
    } catch (error) {
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
      return await apiClient.patch(`/billing/billing-settings/${id}/`, data);
    } catch (error) {
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
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/patient-insurances/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
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
  getPatientInsuranceById: async (id) => {
    try {
      return await apiClient.get(`/billing/patient-insurances/${id}/`);
    } catch (error) {
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
      return await apiClient.post('/billing/patient-insurances/', data);
    } catch (error) {
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
      return await apiClient.patch(`/billing/patient-insurances/${id}/`, data);
    } catch (error) {
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
      return await apiClient.delete(`/billing/patient-insurances/${id}/`);
    } catch (error) {
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
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/billing/insurance-plans/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch insurance plans'));
    }
  },
};
