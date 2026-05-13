import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '@/features/inventory/api';
import { hasMeaningfulQueryParams, immutableMetadataQueryOptions } from '@/lib/react-query';
import { createKeyFactory } from '@/shared/lib/queryKeys';

// Query keys
const inventoryKeyFactory = createKeyFactory('inventory');

export const inventoryKeys = {
  all: inventoryKeyFactory.all,

  // Dashboard
  dashboard: () => [...inventoryKeys.all, 'dashboard'],
  dashboardMetrics: (params) => [...inventoryKeys.dashboard(), 'metrics', params],
  lowStockAlerts: (params) => [...inventoryKeys.dashboard(), 'lowStock', params],
  expiringItems: (params) => [...inventoryKeys.dashboard(), 'expiring', params],

  // Categories
  categories: () => [...inventoryKeys.all, 'categories'],
  categoryList: (params) => [...inventoryKeys.categories(), 'list', params],
  categoryDetail: (id) => [...inventoryKeys.categories(), 'detail', id],

  // Suppliers
  suppliers: () => [...inventoryKeys.all, 'suppliers'],
  supplierList: (filters) => [...inventoryKeys.suppliers(), 'list', { filters }],
  supplierDetail: (id) => [...inventoryKeys.suppliers(), 'detail', id],

  // Storage Locations
  locations: () => [...inventoryKeys.all, 'locations'],
  locationList: (filters) => [...inventoryKeys.locations(), 'list', { filters }],
  locationDetail: (id) => [...inventoryKeys.locations(), 'detail', id],
  locationStock: (id) => [...inventoryKeys.locations(), 'stock', id],
  locationsByType: (type) => [...inventoryKeys.locations(), 'byType', type],

  // Inventory Items
  items: () => [...inventoryKeys.all, 'items'],
  itemList: (filters) => [...inventoryKeys.items(), 'list', { filters }],
  itemDetail: (id) => [...inventoryKeys.items(), 'detail', id],
  itemMovements: (id, params) => [...inventoryKeys.items(), 'movements', id, params],
  itemExpiryTrackers: (id) => [...inventoryKeys.items(), 'expiryTrackers', id],
  itemStockByLocation: (id) => [...inventoryKeys.items(), 'stockByLocation', id],

  // Stock Movements
  movements: () => [...inventoryKeys.all, 'movements'],
  movementList: (filters) => [...inventoryKeys.movements(), 'list', { filters }],

  // Batch Recommendations
  batchRecommendations: (itemId, params) => [...inventoryKeys.all, 'batchRecommendations', itemId, params],

  // Expiry Trackers
  expiryTrackers: () => [...inventoryKeys.all, 'expiryTrackers'],
  expiryTrackerList: (filters) => [...inventoryKeys.expiryTrackers(), 'list', { filters }],
  expiredBatches: () => [...inventoryKeys.expiryTrackers(), 'expired'],
  expiringSoonBatches: (days) => [...inventoryKeys.expiryTrackers(), 'expiringSoon', days],

  // Purchase Requisitions
  requisitions: () => [...inventoryKeys.all, 'requisitions'],
  requisitionList: (filters) => [...inventoryKeys.requisitions(), 'list', { filters }],
  requisitionDetail: (id) => [...inventoryKeys.requisitions(), 'detail', id],

  // Purchase Orders
  purchaseOrders: () => [...inventoryKeys.all, 'purchaseOrders'],
  purchaseOrderList: (filters) => [...inventoryKeys.purchaseOrders(), 'list', { filters }],
  purchaseOrderDetail: (id) => [...inventoryKeys.purchaseOrders(), 'detail', id],

  // GRNs
  grns: () => [...inventoryKeys.all, 'grns'],
  grnList: (filters) => [...inventoryKeys.grns(), 'list', { filters }],
  grnDetail: (id) => [...inventoryKeys.grns(), 'detail', id],

  // Internal Requisitions
  internalRequisitions: () => [...inventoryKeys.all, 'internalRequisitions'],
  internalRequisitionList: (filters) => [...inventoryKeys.internalRequisitions(), 'list', { filters }],
  internalRequisitionDetail: (id) => [...inventoryKeys.internalRequisitions(), 'detail', id],

  // Standing Orders
  standingOrders: () => [...inventoryKeys.all, 'standingOrders'],
  standingOrderList: (filters) => [...inventoryKeys.standingOrders(), 'list', { filters }],
  standingOrderDetail: (id) => [...inventoryKeys.standingOrders(), 'detail', id],
  dueStandingOrders: () => [...inventoryKeys.standingOrders(), 'due'],

  // Transfer Requests
  transferRequests: () => [...inventoryKeys.all, 'transferRequests'],
  transferRequestList: (filters) => [...inventoryKeys.transferRequests(), 'list', { filters }],
  transferRequestDetail: (id) => [...inventoryKeys.transferRequests(), 'detail', id],

  // Controlled Substances
  controlledRegisters: () => [...inventoryKeys.all, 'controlledRegisters'],
  controlledRegisterList: (filters) => [...inventoryKeys.controlledRegisters(), 'list', { filters }],
  controlledRegisterDetail: (id) => [...inventoryKeys.controlledRegisters(), 'detail', id],
  controlledRegisterEntries: (id, params) => [...inventoryKeys.controlledRegisters(), 'entries', id, params],

  // Controlled Discrepancies
  controlledDiscrepancies: () => [...inventoryKeys.all, 'controlledDiscrepancies'],
  controlledDiscrepancyList: (filters) => [...inventoryKeys.controlledDiscrepancies(), 'list', { filters }],
  pendingDiscrepancies: () => [...inventoryKeys.controlledDiscrepancies(), 'pending'],

  // Analytics
  analytics: () => [...inventoryKeys.all, 'analytics'],
  consumptionAnalytics: (params) => [...inventoryKeys.analytics(), 'consumption', params],
  abcAnalysis: (params) => [...inventoryKeys.analytics(), 'abcAnalysis', params],
  supplierPerformance: (params) => [...inventoryKeys.analytics(), 'supplierPerformance', params],
  expiryForecast: (params) => [...inventoryKeys.analytics(), 'expiryForecast', params],
  stockValuation: (params) => [...inventoryKeys.analytics(), 'stockValuation', params],
  controlledSubstanceReport: (params) => [...inventoryKeys.analytics(), 'controlledSubstances', params],

  // Inventory Audits
  audits: () => [...inventoryKeys.all, 'audits'],
  auditList: (filters) => [...inventoryKeys.audits(), 'list', { filters }],
  auditDetail: (id) => [...inventoryKeys.audits(), 'detail', id],
};

// =========================================================================
// Dashboard Queries
// =========================================================================

/**
 * Get inventory dashboard metrics
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useInventoryDashboardMetrics(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.dashboardMetrics(params),
    queryFn: ({ signal }) => inventoryApi.getDashboardMetrics(params, { signal }),
    staleTime: 30 * 1000, // 30 seconds - dashboard refreshes frequently
  });
}

/**
 * Get low stock alerts
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useLowStockAlerts(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.lowStockAlerts(params),
    queryFn: ({ signal }) => inventoryApi.getLowStockAlerts(params, { signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get expiring items
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useExpiringItems(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.expiringItems(params),
    queryFn: ({ signal }) => inventoryApi.getExpiringItems(params, { signal }),
    staleTime: 30 * 1000,
  });
}

// =========================================================================
// Categories Queries & Mutations
// =========================================================================

/**
 * Get inventory categories
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useInventoryCategories(params = {}) {
  const shouldUseImmutableCache = !hasMeaningfulQueryParams(params);
  return useQuery({
    queryKey: inventoryKeys.categoryList(params),
    queryFn: () => inventoryApi.getCategories(params),
    ...(shouldUseImmutableCache ? immutableMetadataQueryOptions() : {}),
  });
}

/**
 * Get a single category
 * @param {string} id - Category ID
 * @returns {Object} Query result
 */
export function useInventoryCategory(id) {
  return useQuery({
    queryKey: inventoryKeys.categoryDetail(id),
    queryFn: () => inventoryApi.getCategory(id),
    enabled: !!id,
  });
}

/**
 * Create a new category
 * @returns {Object} Mutation result
 */
export function useCreateInventoryCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.categories() });
    },
  });
}

/**
 * Update a category
 * @returns {Object} Mutation result
 */
export function useUpdateInventoryCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.updateCategory(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.categoryDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.categories() });
    },
  });
}

// =========================================================================
// Suppliers Queries & Mutations
// =========================================================================

/**
 * Get suppliers list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useSuppliers(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.supplierList(filters),
    queryFn: ({ signal }) => inventoryApi.getSuppliers(filters, { signal }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get a single supplier
 * @param {string} id - Supplier ID
 * @returns {Object} Query result
 */
export function useSupplier(id) {
  return useQuery({
    queryKey: inventoryKeys.supplierDetail(id),
    queryFn: () => inventoryApi.getSupplier(id),
    enabled: !!id,
  });
}

/**
 * Create a new supplier
 * @returns {Object} Mutation result
 */
export function useCreateSupplier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createSupplier(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.suppliers() });
    },
  });
}

/**
 * Update a supplier
 * @returns {Object} Mutation result
 */
export function useUpdateSupplier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.updateSupplier(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.supplierDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.suppliers() });
    },
  });
}

// =========================================================================
// Storage Locations Queries & Mutations
// =========================================================================

/**
 * Get storage locations list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useStorageLocations(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.locationList(filters),
    queryFn: ({ signal }) => inventoryApi.getStorageLocations(filters, { signal }),
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Get a single storage location
 * @param {string} id - Location ID
 * @returns {Object} Query result
 */
export function useStorageLocation(id) {
  return useQuery({
    queryKey: inventoryKeys.locationDetail(id),
    queryFn: ({ signal }) => inventoryApi.getStorageLocation(id, { signal }),
    enabled: !!id,
  });
}

/**
 * Get stock at a specific location
 * @param {string} id - Location ID
 * @returns {Object} Query result
 */
export function useLocationStock(id) {
  return useQuery({
    queryKey: inventoryKeys.locationStock(id),
    queryFn: ({ signal }) => inventoryApi.getLocationStock(id, { signal }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

/**
 * Get locations by type
 * @param {string} type - Location type
 * @returns {Object} Query result
 */
export function useLocationsByType(type) {
  return useQuery({
    queryKey: inventoryKeys.locationsByType(type),
    queryFn: () => inventoryApi.getLocationsByType(type),
    enabled: !!type,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Create a new storage location
 * @returns {Object} Mutation result
 */
export function useCreateStorageLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createStorageLocation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
    },
  });
}

/**
 * Update a storage location
 * @returns {Object} Mutation result
 */
export function useUpdateStorageLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.updateStorageLocation(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locationDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
    },
  });
}

/**
 * Delete a storage location
 * @returns {Object} Mutation result
 */
export function useDeleteStorageLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.deleteStorageLocation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
    },
  });
}

// =========================================================================
// Inventory Items Queries & Mutations
// =========================================================================

/**
 * Get inventory items list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useInventoryItems(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.itemList(filters),
    queryFn: ({ signal }) => inventoryApi.getInventoryItems(filters, { signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get a single inventory item
 * @param {string} id - Item ID
 * @returns {Object} Query result
 */
export function useInventoryItem(id) {
  return useQuery({
    queryKey: inventoryKeys.itemDetail(id),
    queryFn: ({ signal }) => inventoryApi.getInventoryItem(id, { signal }),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get stock movements for an item
 * @param {string} id - Item ID
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useItemMovements(id, params = {}) {
  return useQuery({
    queryKey: inventoryKeys.itemMovements(id, params),
    queryFn: ({ signal }) => inventoryApi.getItemMovements(id, { ...params, signal }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

/**
 * Get expiry trackers for an item
 * @param {string} id - Item ID
 * @returns {Object} Query result
 */
export function useItemExpiryTrackers(id) {
  return useQuery({
    queryKey: inventoryKeys.itemExpiryTrackers(id),
    queryFn: ({ signal }) => inventoryApi.getItemExpiryTrackers(id, { signal }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/**
 * Get stock by location for an item
 * @param {string} id - Item ID
 * @returns {Object} Query result
 */
export function useItemStockByLocation(id) {
  return useQuery({
    queryKey: inventoryKeys.itemStockByLocation(id),
    queryFn: ({ signal }) => inventoryApi.getItemStockByLocation(id, { signal }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

/**
 * Create a new inventory item
 * @returns {Object} Mutation result
 */
export function useCreateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createInventoryItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Update an inventory item
 * @returns {Object} Mutation result
 */
export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.updateInventoryItem(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: inventoryKeys.itemDetail(id) });
      const previousItem = queryClient.getQueryData(inventoryKeys.itemDetail(id));
      queryClient.setQueryData(inventoryKeys.itemDetail(id), (old) => ({
        ...old,
        ...data,
      }));
      return { previousItem, id };
    },
    onError: (err, variables, context) => {
      if (context?.previousItem) {
        queryClient.setQueryData(
          inventoryKeys.itemDetail(context.id),
          context.previousItem
        );
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.itemDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
    },
  });
}

/**
 * Delete an inventory item
 * @returns {Object} Mutation result
 */
export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.deleteInventoryItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

// =========================================================================
// Stock Movements Queries & Mutations
// =========================================================================

/**
 * Get stock movements list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useStockMovements(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.movementList(filters),
    queryFn: ({ signal }) => inventoryApi.getStockMovements({ ...filters, signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Create a stock movement
 * @returns {Object} Mutation result
 */
export function useCreateStockMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createStockMovement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Bulk create stock movements
 * @returns {Object} Mutation result
 */
export function useBulkCreateStockMovements() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (movements) => inventoryApi.bulkCreateStockMovements(movements),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

// =========================================================================
// Batch Recommendations
// =========================================================================

/**
 * Get batch recommendations for an item (FEFO order)
 * @param {string} itemId - Item ID
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useBatchRecommendations(itemId, params = {}) {
  return useQuery({
    queryKey: inventoryKeys.batchRecommendations(itemId, params),
    queryFn: () => inventoryApi.getBatchRecommendations(itemId, params),
    enabled: !!itemId,
    staleTime: 30 * 1000,
  });
}

// =========================================================================
// Expiry Trackers Queries & Mutations
// =========================================================================

/**
 * Get expiry trackers list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useExpiryTrackers(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.expiryTrackerList(filters),
    queryFn: () => inventoryApi.getExpiryTrackers(filters),
    staleTime: 60 * 1000,
  });
}

/**
 * Get expired batches
 * @returns {Object} Query result
 */
export function useExpiredBatches() {
  return useQuery({
    queryKey: inventoryKeys.expiredBatches(),
    queryFn: ({ signal }) => inventoryApi.getExpiredBatches({ signal }),
    staleTime: 60 * 1000,
  });
}

/**
 * Get batches expiring soon
 * @param {number} days - Days threshold
 * @returns {Object} Query result
 */
export function useExpiringSoonBatches(days = 30) {
  return useQuery({
    queryKey: inventoryKeys.expiringSoonBatches(days),
    queryFn: ({ signal }) => inventoryApi.getExpiringSoonBatches(days, { signal }),
    staleTime: 60 * 1000,
  });
}

/**
 * Mark batch as consumed
 * @returns {Object} Mutation result
 */
export function useMarkBatchAsConsumed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.markBatchAsConsumed(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.expiryTrackers() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
    },
  });
}

/**
 * Mark batch as disposed
 * @returns {Object} Mutation result
 */
export function useMarkBatchAsDisposed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.markBatchAsDisposed(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.expiryTrackers() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });
    },
  });
}

// =========================================================================
// Purchase Requisitions Queries & Mutations
// =========================================================================

/**
 * Get purchase requisitions list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useRequisitions(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.requisitionList(filters),
    queryFn: ({ signal }) => inventoryApi.getRequisitions({ ...filters, signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get a single requisition
 * @param {string} id - Requisition ID
 * @returns {Object} Query result
 */
export function useRequisition(id) {
  return useQuery({
    queryKey: inventoryKeys.requisitionDetail(id),
    queryFn: ({ signal }) => inventoryApi.getRequisition(id, { signal }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/**
 * Create a new requisition
 * @returns {Object} Mutation result
 */
export function useCreateRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createRequisition(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitions() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Update a requisition
 * @returns {Object} Mutation result
 */
export function useUpdateRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.updateRequisition(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitionDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitions() });
    },
  });
}

/**
 * Submit requisition for approval
 * @returns {Object} Mutation result
 */
export function useSubmitRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.submitRequisition(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitionDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitions() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Approve a requisition
 * @returns {Object} Mutation result
 */
export function useApproveRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.approveRequisition(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: inventoryKeys.requisitionDetail(id) });
      const previousRequisition = queryClient.getQueryData(inventoryKeys.requisitionDetail(id));
      if (previousRequisition) {
        queryClient.setQueryData(inventoryKeys.requisitionDetail(id), (old) => ({
          ...old,
          status: 'approved',
        }));
      }
      return { previousRequisition, id };
    },
    onError: (err, variables, context) => {
      if (context?.previousRequisition) {
        queryClient.setQueryData(
          inventoryKeys.requisitionDetail(context.id),
          context.previousRequisition
        );
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitionDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitions() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Reject a requisition
 * @returns {Object} Mutation result
 */
export function useRejectRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.rejectRequisition(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitionDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitions() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Convert requisition to purchase order
 * @returns {Object} Mutation result
 */
export function useConvertRequisitionToPO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.convertRequisitionToPO(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitionDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.requisitions() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrders() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

// =========================================================================
// Purchase Orders Queries & Mutations
// =========================================================================

/**
 * Get purchase orders list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function usePurchaseOrders(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.purchaseOrderList(filters),
    queryFn: ({ signal }) => inventoryApi.getPurchaseOrders({ ...filters, signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get a single purchase order
 * @param {string} id - Purchase order ID
 * @returns {Object} Query result
 */
export function usePurchaseOrder(id) {
  return useQuery({
    queryKey: inventoryKeys.purchaseOrderDetail(id),
    queryFn: ({ signal }) => inventoryApi.getPurchaseOrder(id, { signal }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/**
 * Create a new purchase order
 * @returns {Object} Mutation result
 */
export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createPurchaseOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrders() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Update a purchase order
 * @returns {Object} Mutation result
 */
export function useUpdatePurchaseOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.updatePurchaseOrder(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrderDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrders() });
    },
  });
}

/**
 * Approve a purchase order
 * @returns {Object} Mutation result
 */
export function useApprovePurchaseOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.approvePurchaseOrder(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: inventoryKeys.purchaseOrderDetail(id) });
      const previousPO = queryClient.getQueryData(inventoryKeys.purchaseOrderDetail(id));
      if (previousPO) {
        queryClient.setQueryData(inventoryKeys.purchaseOrderDetail(id), (old) => ({
          ...old,
          status: 'approved',
        }));
      }
      return { previousPO, id };
    },
    onError: (err, variables, context) => {
      if (context?.previousPO) {
        queryClient.setQueryData(
          inventoryKeys.purchaseOrderDetail(context.id),
          context.previousPO
        );
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrderDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrders() });
    },
  });
}

/**
 * Send purchase order to supplier
 * @returns {Object} Mutation result
 */
export function useSendPurchaseOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.sendPurchaseOrder(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrderDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrders() });
    },
  });
}

// =========================================================================
// GRNs Queries & Mutations
// =========================================================================

/**
 * Get GRNs list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useGRNs(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.grnList(filters),
    queryFn: ({ signal }) => inventoryApi.getGRNs({ ...filters, signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get a single GRN
 * @param {string} id - GRN ID
 * @returns {Object} Query result
 */
export function useGRN(id) {
  return useQuery({
    queryKey: inventoryKeys.grnDetail(id),
    queryFn: ({ signal }) => inventoryApi.getGRN(id, { signal }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/**
 * Create a new GRN
 * @returns {Object} Mutation result
 */
export function useCreateGRN() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createGRN(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.grns() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrders() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Update a GRN
 * @returns {Object} Mutation result
 */
export function useUpdateGRN() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.updateGRN(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.grnDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.grns() });
    },
  });
}

/**
 * Update a GRN item
 * @returns {Object} Mutation result
 */
export function useUpdateGRNItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ grnId, itemId, data }) => inventoryApi.updateGRNItem(grnId, itemId, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.grnDetail(variables.grnId) });
    },
  });
}

/**
 * Inspect a GRN
 * @returns {Object} Mutation result
 */
export function useInspectGRN() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.inspectGRN(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.grnDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.grns() });
    },
  });
}

/**
 * Accept a GRN
 * @returns {Object} Mutation result
 */
export function useAcceptGRN() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.acceptGRN(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.grnDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.grns() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.expiryTrackers() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrders() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

// =========================================================================
// Internal Requisitions Queries & Mutations
// =========================================================================

/**
 * Get internal requisitions list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useInternalRequisitions(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.internalRequisitionList(filters),
    queryFn: ({ signal }) => inventoryApi.getInternalRequisitions(filters, { signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get a single internal requisition
 * @param {string} id - Internal requisition ID
 * @returns {Object} Query result
 */
export function useInternalRequisition(id) {
  return useQuery({
    queryKey: inventoryKeys.internalRequisitionDetail(id),
    queryFn: ({ signal }) => inventoryApi.getInternalRequisition(id, { signal }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/**
 * Create a new internal requisition
 * @returns {Object} Mutation result
 */
export function useCreateInternalRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createInternalRequisition(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Submit internal requisition for approval
 * @returns {Object} Mutation result
 */
export function useSubmitInternalRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.submitInternalRequisition(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitionDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
    },
  });
}

/**
 * Approve internal requisition
 * @returns {Object} Mutation result
 */
export function useApproveInternalRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables) => {
      const id = typeof variables === 'object' ? variables.id : variables;
      const data = typeof variables === 'object' ? variables.data : undefined;
      return inventoryApi.approveInternalRequisition(id, data);
    },
    onSuccess: (data, variables) => {
      const id = typeof variables === 'object' ? variables.id : variables;
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitionDetail(id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
    },
  });
}

/**
 * Reject internal requisition
 * @returns {Object} Mutation result
 */
export function useRejectInternalRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.rejectInternalRequisition(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitionDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
    },
  });
}

/**
 * Fulfill internal requisition
 * @returns {Object} Mutation result
 */
export function useFulfillInternalRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables) => {
      const id = typeof variables === 'object' ? variables.id : variables;
      const data = typeof variables === 'object' ? variables.data : undefined;
      return inventoryApi.fulfillInternalRequisition(id, data);
    },
    onSuccess: (data, variables) => {
      const id = typeof variables === 'object' ? variables.id : variables;
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitionDetail(id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });
    },
  });
}

/**
 * Cancel internal requisition
 * @returns {Object} Mutation result
 */
export function useCancelInternalRequisition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.cancelInternalRequisition(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitionDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
    },
  });
}

// =========================================================================
// Standing Orders Queries & Mutations
// =========================================================================

/**
 * Get standing orders list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useStandingOrders(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.standingOrderList(filters),
    queryFn: () => inventoryApi.getStandingOrders(filters),
    staleTime: 60 * 1000,
  });
}

/**
 * Get a single standing order
 * @param {string} id - Standing order ID
 * @returns {Object} Query result
 */
export function useStandingOrder(id) {
  return useQuery({
    queryKey: inventoryKeys.standingOrderDetail(id),
    queryFn: () => inventoryApi.getStandingOrder(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get due standing orders
 * @returns {Object} Query result
 */
export function useDueStandingOrders() {
  return useQuery({
    queryKey: inventoryKeys.dueStandingOrders(),
    queryFn: () => inventoryApi.getDueStandingOrders(),
    staleTime: 60 * 1000,
  });
}

/**
 * Create a new standing order
 * @returns {Object} Mutation result
 */
export function useCreateStandingOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createStandingOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.standingOrders() });
    },
  });
}

/**
 * Update a standing order
 * @returns {Object} Mutation result
 */
export function useUpdateStandingOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.updateStandingOrder(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.standingOrderDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.standingOrders() });
    },
  });
}

/**
 * Generate requisition from standing order
 * @returns {Object} Mutation result
 */
export function useGenerateStandingOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.generateStandingOrder(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.standingOrderDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.standingOrders() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
    },
  });
}

/**
 * Process all due standing orders
 * @returns {Object} Mutation result
 */
export function useProcessDueStandingOrders() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => inventoryApi.processDueStandingOrders(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.standingOrders() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.internalRequisitions() });
    },
  });
}

// =========================================================================
// Transfer Requests Queries & Mutations
// =========================================================================

/**
 * Get transfer requests list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useTransferRequests(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.transferRequestList(filters),
    queryFn: ({ signal }) => inventoryApi.getTransferRequests({ ...filters, signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get a single transfer request
 * @param {string} id - Transfer request ID
 * @returns {Object} Query result
 */
export function useTransferRequest(id) {
  return useQuery({
    queryKey: inventoryKeys.transferRequestDetail(id),
    queryFn: ({ signal }) => inventoryApi.getTransferRequest(id, { signal }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/**
 * Create a new transfer request
 * @returns {Object} Mutation result
 */
export function useCreateTransferRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createTransferRequest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequests() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Approve a transfer request
 * @returns {Object} Mutation result
 */
export function useApproveTransferRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.approveTransferRequest(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequestDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequests() });
    },
  });
}

/**
 * Dispatch a transfer request
 * @returns {Object} Mutation result
 */
export function useDispatchTransferRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.dispatchTransferRequest(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequestDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequests() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });
    },
  });
}

/**
 * Receive a transfer request
 * @returns {Object} Mutation result
 */
export function useReceiveTransferRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.receiveTransferRequest(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequestDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequests() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });
    },
  });
}

/**
 * Cancel a transfer request
 * @returns {Object} Mutation result
 */
export function useCancelTransferRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.cancelTransferRequest(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequestDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.transferRequests() });
    },
  });
}

// =========================================================================
// Controlled Substance Registers Queries & Mutations
// =========================================================================

/**
 * Get controlled substance registers list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useControlledRegisters(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.controlledRegisterList(filters),
    queryFn: ({ signal }) => inventoryApi.getControlledRegisters({ ...filters, signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get a single controlled substance register
 * @param {string} id - Register ID
 * @returns {Object} Query result
 */
export function useControlledRegister(id) {
  return useQuery({
    queryKey: inventoryKeys.controlledRegisterDetail(id),
    queryFn: ({ signal }) => inventoryApi.getControlledRegister(id, { signal }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

/**
 * Get entries for a controlled substance register
 * @param {string} id - Register ID
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useControlledRegisterEntries(id, params = {}) {
  return useQuery({
    queryKey: inventoryKeys.controlledRegisterEntries(id, params),
    queryFn: ({ signal }) => inventoryApi.getControlledRegisterEntries(id, { ...params, signal }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

/**
 * Validate register balance
 * @param {string} id - Register ID
 * @returns {Object} Query result
 */
export function useValidateRegisterBalance(id, options = {}) {
  return useQuery({
    queryKey: [...inventoryKeys.controlledRegisterDetail(id), 'validation'],
    queryFn: ({ signal }) => inventoryApi.validateRegisterBalance(id, { signal }),
    enabled: !!id && options.enabled !== false,
    staleTime: 0, // Always fresh for validation
  });
}

// =========================================================================
// Controlled Substance Operations Mutations
// =========================================================================

/**
 * Dispense controlled substance
 * @returns {Object} Mutation result
 */
export function useDispenseControlledSubstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.dispenseControlledSubstance(data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledRegisterDetail(variables.register) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledRegisters() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
    },
  });
}

/**
 * Record controlled substance wastage
 * @returns {Object} Mutation result
 */
export function useRecordControlledWastage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.recordControlledWastage(data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledRegisterDetail(variables.register) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledRegisters() });
    },
  });
}

/**
 * Perform physical count of controlled substance
 * @returns {Object} Mutation result
 */
export function useRecordControlledCount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.recordControlledCount(data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledRegisterDetail(variables.register) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledRegisters() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledDiscrepancies() });
    },
  });
}

// =========================================================================
// Controlled Substance Discrepancies Queries & Mutations
// =========================================================================

/**
 * Get controlled substance discrepancies list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useControlledDiscrepancies(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.controlledDiscrepancyList(filters),
    queryFn: ({ signal }) => inventoryApi.getControlledDiscrepancies(filters, { signal }),
    staleTime: 30 * 1000,
  });
}

/**
 * Get pending discrepancies
 * @returns {Object} Query result
 */
export function usePendingDiscrepancies() {
  return useQuery({
    queryKey: inventoryKeys.pendingDiscrepancies(),
    queryFn: () => inventoryApi.getPendingDiscrepancies(),
    staleTime: 30 * 1000,
  });
}

/**
 * Resolve a discrepancy
 * @returns {Object} Mutation result
 */
export function useResolveDiscrepancy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.resolveDiscrepancy(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledDiscrepancies() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledRegisters() });
    },
  });
}

/**
 * Escalate a discrepancy
 * @returns {Object} Mutation result
 */
export function useEscalateDiscrepancy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => inventoryApi.escalateDiscrepancy(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.controlledDiscrepancies() });
    },
  });
}

// =========================================================================
// Analytics Queries
// =========================================================================

/**
 * Get consumption analytics
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useConsumptionAnalytics(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.consumptionAnalytics(params),
    queryFn: () => inventoryApi.getConsumptionAnalytics(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Get ABC analysis
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useABCAnalysis(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.abcAnalysis(params),
    queryFn: () => inventoryApi.getABCAnalysis(params),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Get supplier performance metrics
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useSupplierPerformance(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.supplierPerformance(params),
    queryFn: () => inventoryApi.getSupplierPerformance(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get expiry forecast
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useExpiryForecast(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.expiryForecast(params),
    queryFn: () => inventoryApi.getExpiryForecast(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get stock valuation report
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useStockValuation(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.stockValuation(params),
    queryFn: () => inventoryApi.getStockValuation(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get controlled substance activity report
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useControlledSubstanceReport(params = {}) {
  return useQuery({
    queryKey: inventoryKeys.controlledSubstanceReport(params),
    queryFn: () => inventoryApi.getControlledSubstanceReport(params),
    staleTime: 5 * 60 * 1000,
  });
}

// =========================================================================
// Inventory Audits Queries & Mutations
// =========================================================================

/**
 * Get inventory audits list
 * @param {Object} filters - Query parameters
 * @returns {Object} Query result
 */
export function useInventoryAudits(filters = {}) {
  return useQuery({
    queryKey: inventoryKeys.auditList(filters),
    queryFn: () => inventoryApi.getInventoryAudits(filters),
    staleTime: 60 * 1000,
  });
}

/**
 * Get a single inventory audit
 * @param {string} id - Audit ID
 * @returns {Object} Query result
 */
export function useInventoryAudit(id) {
  return useQuery({
    queryKey: inventoryKeys.auditDetail(id),
    queryFn: () => inventoryApi.getInventoryAudit(id),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/**
 * Create a new inventory audit
 * @returns {Object} Mutation result
 */
export function useCreateInventoryAudit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inventoryApi.createInventoryAudit(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.audits() });
    },
  });
}

/**
 * Complete an inventory audit
 * @returns {Object} Mutation result
 */
export function useCompleteInventoryAudit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.completeInventoryAudit(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.auditDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.audits() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements() });
    },
  });
}

/**
 * Cancel an inventory audit
 * @returns {Object} Mutation result
 */
export function useCancelInventoryAudit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => inventoryApi.cancelInventoryAudit(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.auditDetail(variables) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.audits() });
    },
  });
}
