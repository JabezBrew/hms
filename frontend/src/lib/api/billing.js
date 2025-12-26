import { apiClient, handleApiError } from '../api-client';

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
      return await apiClient.post('/billing/invoices/', data);
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
      return await apiClient.put(`/billing/invoices/${id}/`, data);
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
      return await apiClient.post(`/billing/invoices/${invoiceId}/mark_as_paid/`, data);
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
      return await apiClient.put(`/billing/billing-rules/${id}/`, data);
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
      return await apiClient.get(`/billing/billing-settings/?facility=${facilityId}`);
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
      return await apiClient.put(`/billing/billing-settings/${id}/`, data);
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
      return await apiClient.put(`/billing/patient-insurances/${id}/`, data);
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
