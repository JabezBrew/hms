import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/features/billing/api';
import { createKeyFactory } from '@/shared/lib/queryKeys';

// Query keys
const billingKeyFactory = createKeyFactory('billing');

export const billingKeys = {
  all: billingKeyFactory.all,
  // Dashboard
  dashboard: () => [...billingKeys.all, 'dashboard'],
  dashboardMetrics: (params) => [...billingKeys.dashboard(), 'metrics', params],
  recentInvoices: (params) => [...billingKeys.dashboard(), 'recentInvoices', params],
  recentPayments: (params) => [...billingKeys.dashboard(), 'recentPayments', params],
  // Invoices
  invoices: () => [...billingKeys.all, 'invoices'],
  invoiceList: (filters) => [...billingKeys.invoices(), 'list', { filters }],
  invoiceDetail: (id) => [...billingKeys.invoices(), 'detail', id],
  patientInvoices: (patientId, params) => [...billingKeys.invoices(), 'patient', patientId, params],
  // Claims
  claims: () => [...billingKeys.all, 'claims'],
  claimList: (filters) => [...billingKeys.claims(), 'list', { filters }],
  claimDetail: (id) => [...billingKeys.claims(), 'detail', id],
  // Payments
  payments: () => [...billingKeys.all, 'payments'],
  paymentList: (filters) => [...billingKeys.payments(), 'list', { filters }],
  // PSP
  psp: () => [...billingKeys.all, 'psp'],
  paymentIntents: () => [...billingKeys.psp(), 'paymentIntents'],
  paymentIntentList: (filters) => [...billingKeys.paymentIntents(), 'list', { filters }],
  settlementBatches: () => [...billingKeys.psp(), 'settlements'],
  settlementBatchList: (filters) => [...billingKeys.settlementBatches(), 'list', { filters }],
  settlementLines: (batchId, filters) => [...billingKeys.settlementBatches(), batchId, 'lines', { filters }],
  // Cash Controls
  cash: () => [...billingKeys.all, 'cash'],
  cashSessions: () => [...billingKeys.cash(), 'sessions'],
  cashSessionList: (filters) => [...billingKeys.cashSessions(), 'list', { filters }],
  currentCashSession: () => [...billingKeys.cashSessions(), 'current'],
  cashSessionTotals: (sessionId) => [...billingKeys.cashSessions(), 'totals', sessionId],
  cashMovements: () => [...billingKeys.cash(), 'movements'],
  cashMovementList: (filters) => [...billingKeys.cashMovements(), 'list', { filters }],
  // Services
  services: () => [...billingKeys.all, 'services'],
  serviceList: (params) => [...billingKeys.services(), 'list', params],
  servicesByCategory: () => [...billingKeys.services(), 'byCategory'],
  serviceCategories: () => [...billingKeys.services(), 'categories'],
  serviceCategoryList: (params) => [...billingKeys.serviceCategories(), 'list', params],
  payerServiceCodes: () => [...billingKeys.services(), 'payerServiceCodes'],
  payerServiceCodeList: (params) => [...billingKeys.payerServiceCodes(), 'list', params],
  // Billing Rules
  billingRules: () => [...billingKeys.all, 'billingRules'],
  billingRuleList: (filters) => [...billingKeys.billingRules(), 'list', { filters }],
  billingRuleDetail: (id) => [...billingKeys.billingRules(), 'detail', id],
  // Facility Settings
  facilitySettings: () => [...billingKeys.all, 'facilitySettings'],
  facilityBillingSettings: (facilityId) => [...billingKeys.facilitySettings(), facilityId],
  activeFacilityBillingSettings: () => [...billingKeys.facilitySettings(), 'active'],
  // Insurance
  insurance: () => [...billingKeys.all, 'insurance'],
  patientInsurances: () => [...billingKeys.insurance(), 'patientInsurances'],
  patientInsuranceList: (filters) => [...billingKeys.patientInsurances(), 'list', { filters }],
  patientInsuranceDetail: (id) => [...billingKeys.patientInsurances(), 'detail', id],
  patientInsurance: (patientId, params) => [...billingKeys.insurance(), 'patient', patientId, params],
  insuranceProviders: (params) => [...billingKeys.insurance(), 'providers', params],
  insurancePlans: (params) => [...billingKeys.insurance(), 'plans', params],
  // NHIS / AR
  nhis: () => [...billingKeys.all, 'nhis'],
  nhisBatches: () => [...billingKeys.nhis(), 'batches'],
  nhisBatchList: (filters) => [...billingKeys.nhisBatches(), 'list', { filters }],
  nhisExports: () => [...billingKeys.nhis(), 'exports'],
  nhisExportJobList: (filters) => [...billingKeys.nhisExports(), 'list', { filters }],
  nhisRemittances: () => [...billingKeys.nhis(), 'remittances'],
  nhisRemittanceJobList: (filters) => [...billingKeys.nhisRemittances(), 'list', { filters }],
  nhisRemittanceLines: (jobId, filters) => [...billingKeys.nhisRemittances(), jobId, 'lines', { filters }],
  nhisMappingImports: () => [...billingKeys.nhis(), 'mappingImports'],
  nhisMappingImportJobList: (filters) => [...billingKeys.nhisMappingImports(), 'list', { filters }],
  nhisMappingImportJobDetail: (id) => [...billingKeys.nhisMappingImports(), 'detail', id],
  nhisAr: () => [...billingKeys.nhis(), 'ar'],
  nhisInsuranceAging: (params) => [...billingKeys.nhisAr(), 'insuranceAging', params],
  nhisInsuranceDso: (params) => [...billingKeys.nhisAr(), 'insuranceDso', params],
  nhisRemittanceQueue: () => [...billingKeys.nhisAr(), 'remittanceQueue'],
};

// =========================================================================
// Dashboard Queries
// =========================================================================

/**
 * Get billing dashboard metrics
 * @param {Object} params - Query parameters (facility filter)
 * @returns {Object} Query result
 */
export function useBillingDashboardMetrics(params = {}) {
  return useQuery({
    queryKey: billingKeys.dashboardMetrics(params),
    queryFn: () => billingApi.getDashboardMetrics(params),
    staleTime: 30 * 1000, // 30 seconds - dashboard data refreshes frequently
  });
}

/**
 * Get recent invoices for dashboard
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useRecentInvoices(params = {}) {
  return useQuery({
    queryKey: billingKeys.recentInvoices(params),
    queryFn: () => billingApi.getRecentInvoices(params),
    staleTime: 30 * 1000,
  });
}

/**
 * Get recent payments for dashboard
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useRecentPayments(params = {}) {
  return useQuery({
    queryKey: billingKeys.recentPayments(params),
    queryFn: () => billingApi.getRecentPayments(params),
    staleTime: 30 * 1000,
  });
}

// =========================================================================
// Invoice Queries & Mutations
// =========================================================================

/**
 * Get invoices list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useInvoices(filters = {}) {
  return useQuery({
    queryKey: billingKeys.invoiceList(filters),
    queryFn: () => billingApi.getInvoices(filters),
  });
}

/**
 * Get a single invoice by ID
 * @param {string} id - Invoice ID
 * @returns {Object} Query result
 */
export function useInvoice(id) {
  return useQuery({
    queryKey: billingKeys.invoiceDetail(id),
    queryFn: () => billingApi.getInvoice(id),
    enabled: !!id,
  });
}

/**
 * Get invoices for a specific patient
 * @param {string} patientId - Patient ID
 * @param {Object} params - Additional query parameters
 * @returns {Object} Query result
 */
export function usePatientInvoices(patientId, params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.patientInvoices(patientId, params),
    queryFn: () => billingApi.getPatientInvoices(patientId, params),
    enabled: !!patientId && enabled,
  });
}

/**
 * Create a new invoice
 * @returns {Object} Mutation result
 */
export function useCreateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => billingApi.createInvoice(data),
    onSuccess: () => {
      // Invalidate invoice lists and dashboard
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

/**
 * Update an existing invoice
 * @returns {Object} Mutation result
 */
export function useUpdateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => billingApi.updateInvoice(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: billingKeys.invoiceDetail(id) });
      const previousInvoice = queryClient.getQueryData(billingKeys.invoiceDetail(id));
      queryClient.setQueryData(billingKeys.invoiceDetail(id), (old) => ({
        ...old,
        ...data,
      }));
      return { previousInvoice, id };
    },
    onError: (err, variables, context) => {
      if (context?.previousInvoice) {
        queryClient.setQueryData(
          billingKeys.invoiceDetail(context.id),
          context.previousInvoice
        );
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.invoiceDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

/**
 * Record a payment for an invoice
 * @returns {Object} Mutation result
 */
export function useRecordPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ invoiceId, data }) => billingApi.recordPayment(invoiceId, data),
    onSuccess: (data, variables) => {
      // Invalidate the specific invoice
      queryClient.invalidateQueries({ queryKey: billingKeys.invoiceDetail(variables.invoiceId) });
      // Invalidate invoice lists
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      // Invalidate payments
      queryClient.invalidateQueries({ queryKey: billingKeys.payments() });
      // Invalidate dashboard for updated metrics
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

/**
 * Generate an insurance claim for an invoice
 * @returns {Object} Mutation result
 */
export function useGenerateClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invoiceId) => billingApi.generateClaim(invoiceId),
    onSuccess: (data, variables) => {
      // Invalidate the specific invoice
      queryClient.invalidateQueries({ queryKey: billingKeys.invoiceDetail(variables) });
      // Invalidate claims list
      queryClient.invalidateQueries({ queryKey: billingKeys.claims() });
      // Invalidate dashboard
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

// =========================================================================
// Claims Queries & Mutations
// =========================================================================

/**
 * Get claims list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useClaims(filters = {}) {
  return useQuery({
    queryKey: billingKeys.claimList(filters),
    queryFn: () => billingApi.getClaims(filters),
  });
}

/**
 * Get a single claim by ID
 * @param {string} id - Claim ID
 * @returns {Object} Query result
 */
export function useClaim(id) {
  return useQuery({
    queryKey: billingKeys.claimDetail(id),
    queryFn: () => billingApi.getClaim(id),
    enabled: !!id,
  });
}

/**
 * Update claim status
 * @returns {Object} Mutation result
 */
export function useUpdateClaimStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => billingApi.updateClaimStatus(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: billingKeys.claimDetail(id) });
      const previousClaim = queryClient.getQueryData(billingKeys.claimDetail(id));
      queryClient.setQueryData(billingKeys.claimDetail(id), (old) => ({
        ...old,
        status: data.status,
        approved_amount: data.approved_amount,
      }));
      return { previousClaim, id };
    },
    onError: (err, variables, context) => {
      if (context?.previousClaim) {
        queryClient.setQueryData(
          billingKeys.claimDetail(context.id),
          context.previousClaim
        );
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.claimDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: billingKeys.claims() });
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

// =========================================================================
// Payments Queries
// =========================================================================

/**
 * Get payments list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function usePayments(filters = {}) {
  return useQuery({
    queryKey: billingKeys.paymentList(filters),
    queryFn: () => billingApi.getPayments(filters),
  });
}

/**
 * Generate receipt for a payment
 * @returns {Object} Mutation result
 */
export function useGenerateReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paymentId) => billingApi.generateReceipt(paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.payments() });
    },
  });
}

// =========================================================================
// PSP Payment Intents
// =========================================================================

export function usePaymentIntents(filters = {}) {
  return useQuery({
    queryKey: billingKeys.paymentIntentList(filters),
    queryFn: () => billingApi.getPaymentIntents(filters),
  });
}

export function useCreatePaymentIntent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => billingApi.createPaymentIntent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.paymentIntents() });
      queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      queryClient.invalidateQueries({ queryKey: billingKeys.payments() });
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

export function useSettlementBatches(filters = {}) {
  return useQuery({
    queryKey: billingKeys.settlementBatchList(filters),
    queryFn: () => billingApi.getSettlementBatches(filters),
  });
}

export function useImportSettlement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ provider, statement_date, file }) => billingApi.importSettlement({ provider, statement_date, file }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.settlementBatches() });
    },
  });
}

export function useSettlementLines(batchId, filters = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.settlementLines(batchId, filters),
    queryFn: () => billingApi.getSettlementLines(batchId, filters),
    enabled: !!batchId && enabled,
  });
}

// =========================================================================
// Cash Controls Queries & Mutations
// =========================================================================

export function useCashSessions(filters = {}) {
  return useQuery({
    queryKey: billingKeys.cashSessionList(filters),
    queryFn: () => billingApi.getCashSessions(filters),
  });
}

export function useCurrentCashSession(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.currentCashSession(),
    queryFn: () => billingApi.getCurrentCashSession(),
    enabled,
    staleTime: 5 * 1000,
  });
}

export function useCashSessionTotals(sessionId, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.cashSessionTotals(sessionId),
    queryFn: () => billingApi.getCashSessionTotals(sessionId),
    enabled: !!sessionId && enabled,
    staleTime: 5 * 1000,
  });
}

export function useOpenCashSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => billingApi.openCashSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.cashSessions() });
      queryClient.invalidateQueries({ queryKey: billingKeys.currentCashSession() });
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

export function useCloseCashSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, data }) => billingApi.closeCashSession(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.cashSessions() });
      queryClient.invalidateQueries({ queryKey: billingKeys.currentCashSession() });
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

export function useReviewCashSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, data }) => billingApi.reviewCashSession(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.cashSessions() });
    },
  });
}

export function useCreateCashMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => billingApi.createCashMovement(data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.cashMovements() });
      queryClient.invalidateQueries({ queryKey: billingKeys.cashSessions() });
      if (variables?.session) {
        queryClient.invalidateQueries({ queryKey: billingKeys.cashSessionTotals(variables.session) });
      }
    },
  });
}

// =========================================================================
// Services Queries
// =========================================================================

/**
 * Get services list with optional filtering
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useServices(params = {}) {
  return useQuery({
    queryKey: billingKeys.serviceList(params),
    queryFn: () => billingApi.getServices(params),
    staleTime: 5 * 60 * 1000, // 5 minutes - services don't change frequently
  });
}

export function useServiceCategories(params = {}) {
  return useQuery({
    queryKey: billingKeys.serviceCategoryList(params),
    queryFn: () => billingApi.getServiceCategories(params),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateServiceCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => billingApi.createServiceCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.serviceCategories() });
    },
  });
}

export function useUpdateServiceCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => billingApi.updateServiceCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.serviceCategories() });
    },
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => billingApi.createService(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.services() });
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => billingApi.updateService(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.services() });
    },
  });
}

/**
 * Get services grouped by category
 * @returns {Object} Query result
 */
export function useServicesByCategory() {
  return useQuery({
    queryKey: billingKeys.servicesByCategory(),
    queryFn: () => billingApi.getServicesByCategory(),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePayerServiceCodes(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.payerServiceCodeList(params),
    queryFn: () => billingApi.getPayerServiceCodes(params),
    enabled,
  });
}

export function useCreatePayerServiceCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => billingApi.createPayerServiceCode(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.payerServiceCodes() });
    },
  });
}

export function useUpdatePayerServiceCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => billingApi.updatePayerServiceCode(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.payerServiceCodes() });
    },
  });
}

// =========================================================================
// Billing Rules Queries & Mutations
// =========================================================================

/**
 * Get billing rules list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useBillingRules(filters = {}) {
  return useQuery({
    queryKey: billingKeys.billingRuleList(filters),
    queryFn: () => billingApi.getBillingRules(filters),
  });
}

/**
 * Get a single billing rule by ID
 * @param {string} id - Billing rule ID
 * @returns {Object} Query result
 */
export function useBillingRule(id) {
  return useQuery({
    queryKey: billingKeys.billingRuleDetail(id),
    queryFn: () => billingApi.getBillingRule(id),
    enabled: !!id,
  });
}

/**
 * Create a new billing rule
 * @returns {Object} Mutation result
 */
export function useCreateBillingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => billingApi.createBillingRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.billingRules() });
    },
  });
}

/**
 * Update an existing billing rule
 * @returns {Object} Mutation result
 */
export function useUpdateBillingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => billingApi.updateBillingRule(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: billingKeys.billingRuleDetail(id) });
      const previousRule = queryClient.getQueryData(billingKeys.billingRuleDetail(id));
      queryClient.setQueryData(billingKeys.billingRuleDetail(id), (old) => ({
        ...old,
        ...data,
      }));
      return { previousRule, id };
    },
    onError: (err, variables, context) => {
      if (context?.previousRule) {
        queryClient.setQueryData(
          billingKeys.billingRuleDetail(context.id),
          context.previousRule
        );
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.billingRuleDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: billingKeys.billingRules() });
    },
  });
}

/**
 * Toggle billing rule active status
 * @returns {Object} Mutation result
 */
export function useToggleBillingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => billingApi.toggleBillingRule(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: billingKeys.billingRuleDetail(id) });
      const previousRule = queryClient.getQueryData(billingKeys.billingRuleDetail(id));
      if (previousRule) {
        queryClient.setQueryData(billingKeys.billingRuleDetail(id), (old) => ({
          ...old,
          is_active: !old.is_active,
        }));
      }
      return { previousRule, id };
    },
    onError: (err, variables, context) => {
      if (context?.previousRule) {
        queryClient.setQueryData(
          billingKeys.billingRuleDetail(context.id),
          context.previousRule
        );
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.billingRuleDetail(variables) });
      queryClient.invalidateQueries({ queryKey: billingKeys.billingRules() });
    },
  });
}

/**
 * Delete a billing rule
 * @returns {Object} Mutation result
 */
export function useDeleteBillingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => billingApi.deleteBillingRule(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.billingRuleDetail(variables) });
      queryClient.invalidateQueries({ queryKey: billingKeys.billingRules() });
    },
  });
}

// =========================================================================
// Facility Billing Settings Queries & Mutations
// =========================================================================

/**
 * Get facility billing settings
 * @param {string} facilityId - Facility ID
 * @returns {Object} Query result
 */
export function useFacilityBillingSettings(facilityId) {
  return useQuery({
    queryKey: billingKeys.facilityBillingSettings(facilityId),
    queryFn: () => billingApi.getFacilityBillingSettings(facilityId),
    enabled: !!facilityId,
    staleTime: 5 * 60 * 1000, // 5 minutes - settings don't change often
  });
}

/**
 * Get active facility billing settings (facility inferred from X-Facility-Code).
 * @returns {Object} Query result (array of settings rows; typically length 1)
 */
export function useActiveFacilityBillingSettings() {
  return useQuery({
    queryKey: billingKeys.activeFacilityBillingSettings(),
    queryFn: () => billingApi.getFacilityBillingSettings(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Update facility billing settings
 * @returns {Object} Mutation result
 */
export function useUpdateFacilityBillingSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => billingApi.updateFacilityBillingSettings(id, data),
    onSuccess: (data) => {
      // Invalidate facility settings cache
      if (data?.facility) {
        queryClient.invalidateQueries({
          queryKey: billingKeys.facilityBillingSettings(data.facility)
        });
      }
      queryClient.invalidateQueries({ queryKey: billingKeys.facilitySettings() });
    },
  });
}

// =========================================================================
// Insurance Queries & Mutations
// =========================================================================

/**
 * Get all patient insurance records with pagination
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function usePatientInsurances(filters = {}) {
  return useQuery({
    queryKey: billingKeys.patientInsuranceList(filters),
    queryFn: () => billingApi.getPatientInsurances(filters),
  });
}

/**
 * Get a single patient insurance by ID
 * @param {string} id - Patient insurance ID
 * @returns {Object} Query result
 */
export function usePatientInsuranceById(id) {
  return useQuery({
    queryKey: billingKeys.patientInsuranceDetail(id),
    queryFn: () => billingApi.getPatientInsuranceById(id),
    enabled: !!id,
  });
}

/**
 * Get patient insurance records for a specific patient
 * @param {string} patientId - Patient ID
 * @param {Object} params - Additional query parameters
 * @returns {Object} Query result
 */
export function usePatientInsurance(patientId, params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.patientInsurance(patientId, params),
    queryFn: () => billingApi.getPatientInsurance(patientId, params),
    enabled: !!patientId && enabled,
  });
}

/**
 * Create a new patient insurance record
 * @returns {Object} Mutation result
 */
export function useCreatePatientInsurance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => billingApi.createPatientInsurance(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.patientInsurances() });
      queryClient.invalidateQueries({ queryKey: billingKeys.insurance() });
    },
  });
}

/**
 * Update an existing patient insurance record
 * @returns {Object} Mutation result
 */
export function useUpdatePatientInsurance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => billingApi.updatePatientInsurance(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: billingKeys.patientInsuranceDetail(id) });
      const previousInsurance = queryClient.getQueryData(billingKeys.patientInsuranceDetail(id));
      queryClient.setQueryData(billingKeys.patientInsuranceDetail(id), (old) => ({
        ...old,
        ...data,
      }));
      return { previousInsurance, id };
    },
    onError: (err, variables, context) => {
      if (context?.previousInsurance) {
        queryClient.setQueryData(
          billingKeys.patientInsuranceDetail(context.id),
          context.previousInsurance
        );
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.patientInsuranceDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: billingKeys.patientInsurances() });
      queryClient.invalidateQueries({ queryKey: billingKeys.insurance() });
    },
  });
}

/**
 * Delete a patient insurance record
 * @returns {Object} Mutation result
 */
export function useDeletePatientInsurance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => billingApi.deletePatientInsurance(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.patientInsuranceDetail(variables) });
      queryClient.invalidateQueries({ queryKey: billingKeys.patientInsurances() });
      queryClient.invalidateQueries({ queryKey: billingKeys.insurance() });
    },
  });
}

/**
 * Get insurance providers
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useInsuranceProviders(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.insuranceProviders(params),
    queryFn: () => billingApi.getInsuranceProviders(params),
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes - providers don't change often
  });
}

/**
 * Get insurance plans
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useInsurancePlans(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.insurancePlans(params),
    queryFn: () => billingApi.getInsurancePlans(params),
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

// =========================================================================
// NHIS (Claim-it) + AR
// =========================================================================

export function useNhisClaimBatches(filters = {}) {
  return useQuery({
    queryKey: billingKeys.nhisBatchList(filters),
    queryFn: () => billingApi.getNhisClaimBatches(filters),
  });
}

export function useCreateNhisClaimBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => billingApi.createNhisClaimBatch(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.nhisBatches() });
      queryClient.invalidateQueries({ queryKey: billingKeys.claims() });
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

export function useLintNhisClaimBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (batchId) => billingApi.lintNhisClaimBatch(batchId),
    onSuccess: () => {
      // Lint may unlock export paths; refresh batch lists.
      queryClient.invalidateQueries({ queryKey: billingKeys.nhisBatches() });
    },
  });
}

export function useExportNhisClaimBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ batchId, data }) => billingApi.exportNhisClaimBatch(batchId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.nhisExports() });
      queryClient.invalidateQueries({ queryKey: billingKeys.nhisBatches() });
    },
  });
}

export function useNhisExportJobs(filters = {}) {
  return useQuery({
    queryKey: billingKeys.nhisExportJobList(filters),
    queryFn: () => billingApi.getNhisExportJobs(filters),
  });
}

export function useRemittanceImportJobs(filters = {}) {
  return useQuery({
    queryKey: billingKeys.nhisRemittanceJobList(filters),
    queryFn: () => billingApi.getRemittanceImportJobs(filters),
  });
}

export function useImportRemittance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payerId, file }) => billingApi.importRemittance({ payerId, file }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.nhisRemittances() });
      queryClient.invalidateQueries({ queryKey: billingKeys.nhisAr() });
      queryClient.invalidateQueries({ queryKey: billingKeys.dashboard() });
    },
  });
}

export function useRemittanceLines(jobId, filters = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.nhisRemittanceLines(jobId, filters),
    queryFn: () => billingApi.getRemittanceLines(jobId, filters),
    enabled: !!jobId && enabled,
  });
}

// =========================================================================
// NHIS Mapping Bulk Import (Preview + Apply)
// =========================================================================

export function useNhisMappingImportJobs(filters = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.nhisMappingImportJobList(filters),
    queryFn: () => billingApi.getNhisMappingImportJobs(filters),
    enabled,
  });
}

export function useNhisMappingImportJob(id, options = {}) {
  const { enabled = true, refetchInterval = false } = options;
  return useQuery({
    queryKey: billingKeys.nhisMappingImportJobDetail(id),
    queryFn: () => billingApi.getNhisMappingImportJob(id),
    enabled: !!id && enabled,
    refetchInterval,
  });
}

export function useCreateNhisMappingImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => billingApi.createNhisMappingImportJob(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.nhisMappingImports() });
    },
  });
}

export function useApplyNhisMappingImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => billingApi.applyNhisMappingImportJob(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.nhisMappingImports() });
      queryClient.invalidateQueries({ queryKey: billingKeys.payerServiceCodes() });
      queryClient.invalidateQueries({ queryKey: billingKeys.services() });
      queryClient.invalidateQueries({ queryKey: billingKeys.serviceCategories() });
    },
  });
}

export function useInsuranceAging(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.nhisInsuranceAging(params),
    queryFn: () => billingApi.getInsuranceAging(params),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useInsuranceDSO(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.nhisInsuranceDso(params),
    queryFn: () => billingApi.getInsuranceDSO(params),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useRemittanceQueue(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: billingKeys.nhisRemittanceQueue(),
    queryFn: () => billingApi.getRemittanceQueue(),
    enabled,
    staleTime: 60 * 1000,
  });
}
