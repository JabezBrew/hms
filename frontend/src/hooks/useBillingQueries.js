import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/lib/api/billing';

// Query keys
export const billingKeys = {
  all: ['billing'],
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
  // Services
  services: () => [...billingKeys.all, 'services'],
  serviceList: (params) => [...billingKeys.services(), 'list', params],
  servicesByCategory: () => [...billingKeys.services(), 'byCategory'],
  // Billing Rules
  billingRules: () => [...billingKeys.all, 'billingRules'],
  billingRuleList: (filters) => [...billingKeys.billingRules(), 'list', { filters }],
  billingRuleDetail: (id) => [...billingKeys.billingRules(), 'detail', id],
  // Facility Settings
  facilitySettings: () => [...billingKeys.all, 'facilitySettings'],
  facilityBillingSettings: (facilityId) => [...billingKeys.facilitySettings(), facilityId],
  // Insurance
  insurance: () => [...billingKeys.all, 'insurance'],
  patientInsurances: () => [...billingKeys.insurance(), 'patientInsurances'],
  patientInsuranceList: (filters) => [...billingKeys.patientInsurances(), 'list', { filters }],
  patientInsuranceDetail: (id) => [...billingKeys.patientInsurances(), 'detail', id],
  patientInsurance: (patientId, params) => [...billingKeys.insurance(), 'patient', patientId, params],
  insuranceProviders: (params) => [...billingKeys.insurance(), 'providers', params],
  insurancePlans: (params) => [...billingKeys.insurance(), 'plans', params],
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
