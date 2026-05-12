import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

const DAY_MS = 24 * 60 * 60 * 1000;

function unwrapV2List(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

function boundedLimit(value, fallback = 25) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), 100);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function daysUntilDate(dateValue) {
  if (!dateValue) {
    return null;
  }
  const [year, month, day] = String(dateValue).split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  const target = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((target - today) / DAY_MS);
}

function isExpiringWithin(batch, days) {
  const remainingDays = daysUntilDate(batch?.expires_on);
  return remainingDays !== null && remainingDays >= 0 && remainingDays <= days;
}

function adaptV2StockBatch(batch) {
  const quantity = toNumber(batch?.quantity_on_hand);
  return {
    id: batch?.item_id || batch?.id,
    batch_id: batch?.id,
    item_id: batch?.item_id,
    name: batch?.item_name || 'Inventory item',
    item_name: batch?.item_name || 'Inventory item',
    sku: batch?.batch_number || '',
    batch_number: batch?.batch_number || '',
    location_id: batch?.location_id,
    location_name: batch?.location_name,
    stock_level: quantity,
    total_stock: quantity,
    current_stock: quantity,
    quantity_on_hand: quantity,
    reorder_level: 0,
    shortfall: quantity <= 0 ? 1 : 0,
    expiry_date: batch?.expires_on || null,
    expires_on: batch?.expires_on || null,
    days_until_expiry: daysUntilDate(batch?.expires_on),
  };
}

function calculateV2DashboardMetrics({ items, batches, requisitions, grns }, params = {}) {
  const expiringDays = boundedLimit(params.days, 30);
  const lowStockCount = batches.filter((batch) => toNumber(batch?.quantity_on_hand) <= 0).length;

  return {
    total_items: items.length,
    low_stock_count: lowStockCount,
    expiring_soon_count: batches.filter((batch) => isExpiringWithin(batch, expiringDays)).length,
    expiring_count: batches.filter((batch) => isExpiringWithin(batch, expiringDays)).length,
    total_stock_value: 0,
    total_value: 0,
    pending_requisitions: requisitions.filter((item) => item?.status === 'requested').length,
    pending_grns: grns.filter((item) => item?.status === 'received').length,
    discrepancies: 0,
  };
}

function adaptV2PaginatedList(response, params = {}, adapter = (item) => item) {
  const results = Array.isArray(response?.data) ? response.data.map(adapter) : [];
  const limit = Number(response?.page?.limit || params.page_size || params.limit || results.length || 25);
  const currentPage = Number(params.page || 1);
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const estimatedTotal = response?.page
    ? ((currentPage - 1) * limit) + results.length + (hasNext ? 1 : 0)
    : results.length;

  return {
    count: estimatedTotal,
    total: estimatedTotal,
    count_exact: !hasNext,
    page: currentPage,
    page_size: limit,
    total_pages: hasNext ? currentPage + 1 : Math.max(1, currentPage),
    next: hasNext ? response.page.next_cursor : null,
    previous: currentPage > 1 ? String(currentPage - 1) : null,
    next_cursor: response?.page?.next_cursor || null,
    results,
  };
}

function emptyPaginatedList(params = {}) {
  return adaptV2PaginatedList({ data: [], meta: {} }, params);
}

function buildV2CursorQuery(params = {}, fallback = 25) {
  const query = {};
  const cursor = params.cursor || params.next_cursor;
  if (cursor) {
    query.cursor = cursor;
  }
  query.limit = boundedLimit(params.limit || params.page_size, fallback);
  return query;
}

/**
 * Inventory API service
 *
 * Provides endpoints for:
 * - Dashboard metrics and KPIs
 * - Storage locations (multi-location support)
 * - Inventory items and categories
 * - Stock movements and expiry tracking
 * - Batch recommendations (FEFO)
 * - Purchase requisitions
 * - Purchase orders
 * - Goods received notes (GRNs)
 * - Internal requisitions
 * - Standing orders
 * - Stock transfer requests
 * - Controlled substance operations
 * - Analytics and reporting
 */
export const inventoryApi = {
  // =========================================================================
  // Dashboard
  // =========================================================================

  /**
   * Get inventory dashboard metrics
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Dashboard metrics (total items, low stock, expiring, value)
   */
  getDashboardMetrics: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const [itemsResponse, batchesResponse, requisitionsResponse, grnsResponse] = await Promise.all([
          v2Api.getInventoryItems({ signal: options.signal }),
          v2Api.getStockBatches({
            query: { limit: boundedLimit(params.limit, 100) },
            signal: options.signal,
          }),
          v2Api.getStockRequisitions({
            query: { limit: boundedLimit(params.limit, 100) },
            signal: options.signal,
          }),
          v2Api.getGoodsReceivedNotes({
            query: { limit: boundedLimit(params.limit, 100) },
            signal: options.signal,
          }),
        ]);

        return calculateV2DashboardMetrics({
          items: unwrapV2List(itemsResponse),
          batches: unwrapV2List(batchesResponse),
          requisitions: unwrapV2List(requisitionsResponse),
          grns: unwrapV2List(grnsResponse),
        }, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/analytics/dashboard/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch dashboard metrics'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch dashboard metrics'));
    }
  },

  /**
   * Get low stock alerts
   * @param {Object} params - Query parameters
   * @param {number} params.limit - Maximum results (default: 10)
   * @returns {Promise<Array>} Items with low stock
   */
  getLowStockAlerts: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const limit = boundedLimit(params.limit, 10);
        const response = await v2Api.getStockBatches({
          query: { limit },
          signal: options.signal,
        });
        return unwrapV2List(response)
          .filter((batch) => toNumber(batch?.quantity_on_hand) <= 0)
          .map(adaptV2StockBatch)
          .slice(0, limit);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/items/low_stock/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch low stock alerts'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch low stock alerts'));
    }
  },

  /**
   * Get expiring items
   * @param {Object} params - Query parameters
   * @param {number} params.days - Days until expiry (default: 30)
   * @param {number} params.limit - Maximum results
   * @returns {Promise<Array>} Items expiring soon
   */
  getExpiringItems: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const limit = boundedLimit(params.limit, 10);
        const days = boundedLimit(params.days, 30);
        const response = await v2Api.getStockBatches({
          query: { limit },
          signal: options.signal,
        });
        return unwrapV2List(response)
          .filter((batch) => isExpiringWithin(batch, days))
          .map(adaptV2StockBatch)
          .slice(0, limit);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/items/expiring_soon/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch expiring items'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch expiring items'));
    }
  },

  // =========================================================================
  // Categories
  // =========================================================================

  /**
   * Get inventory categories
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} List of categories
   */
  getCategories: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getInventoryCategories();
        return unwrapV2List(response);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/categories/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch categories'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch categories'));
    }
  },

  /**
   * Get a single category by ID
   * @param {string} id - Category ID
   * @returns {Promise<Object>} Category data
   */
  getCategory: async (id) => {
    try {
      return await apiClient.get(`/inventory/categories/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch category'));
    }
  },

  /**
   * Create a new category
   * @param {Object} data - Category data
   * @returns {Promise<Object>} Created category
   */
  createCategory: async (data) => {
    try {
      return await apiClient.post('/inventory/categories/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create category'));
    }
  },

  /**
   * Update a category
   * @param {string} id - Category ID
   * @param {Object} data - Category data to update
   * @returns {Promise<Object>} Updated category
   */
  updateCategory: async (id, data) => {
    try {
      return await apiClient.patch(`/inventory/categories/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update category'));
    }
  },

  // =========================================================================
  // Suppliers
  // =========================================================================

  /**
   * Get suppliers with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated suppliers
   */
  getSuppliers: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return emptyPaginatedList(params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/suppliers/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch suppliers'));
    }
  },

  /**
   * Get a single supplier by ID
   * @param {string} id - Supplier ID
   * @returns {Promise<Object>} Supplier data
   */
  getSupplier: async (id) => {
    try {
      return await apiClient.get(`/inventory/suppliers/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch supplier'));
    }
  },

  /**
   * Create a new supplier
   * @param {Object} data - Supplier data
   * @returns {Promise<Object>} Created supplier
   */
  createSupplier: async (data) => {
    try {
      return await apiClient.post('/inventory/suppliers/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create supplier'));
    }
  },

  /**
   * Update a supplier
   * @param {string} id - Supplier ID
   * @param {Object} data - Supplier data to update
   * @returns {Promise<Object>} Updated supplier
   */
  updateSupplier: async (id, data) => {
    try {
      return await apiClient.patch(`/inventory/suppliers/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update supplier'));
    }
  },

  // =========================================================================
  // Storage Locations
  // =========================================================================

  /**
   * Get storage locations with optional filtering
   * @param {Object} params - Query parameters
   * @param {string} params.location_type - Filter by type (warehouse, pharmacy, etc.)
   * @param {string} params.parent - Filter by parent location
   * @param {boolean} params.is_active - Filter by active status
   * @returns {Promise<Object>} Paginated storage locations
   */
  getStorageLocations: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStorageLocations({
          signal: options.signal,
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/locations/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch storage locations'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch storage locations'));
    }
  },

  /**
   * Get a single storage location by ID
   * @param {string} id - Location ID
   * @returns {Promise<Object>} Location data
   */
  getStorageLocation: async (id) => {
    try {
      return await apiClient.get(`/inventory/locations/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch storage location'));
    }
  },

  /**
   * Get stock at a specific location
   * @param {string} id - Location ID
   * @returns {Promise<Array>} Stock items at location
   */
  getLocationStock: async (id) => {
    try {
      return await apiClient.get(`/inventory/locations/${id}/stock/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch location stock'));
    }
  },

  /**
   * Get locations by type
   * @param {string} type - Location type
   * @returns {Promise<Array>} Locations of specified type
   */
  getLocationsByType: async (type) => {
    try {
      return await apiClient.get(`/inventory/locations/by_type/?type=${type}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch locations by type'));
    }
  },

  /**
   * Create a new storage location
   * @param {Object} data - Location data
   * @returns {Promise<Object>} Created location
   */
  createStorageLocation: async (data) => {
    try {
      return await apiClient.post('/inventory/locations/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create storage location'));
    }
  },

  /**
   * Update a storage location
   * @param {string} id - Location ID
   * @param {Object} data - Location data to update
   * @returns {Promise<Object>} Updated location
   */
  updateStorageLocation: async (id, data) => {
    try {
      return await apiClient.patch(`/inventory/locations/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update storage location'));
    }
  },

  /**
   * Delete a storage location
   * @param {string} id - Location ID
   * @returns {Promise<void>}
   */
  deleteStorageLocation: async (id) => {
    try {
      return await apiClient.delete(`/inventory/locations/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete storage location'));
    }
  },

  // =========================================================================
  // Inventory Items
  // =========================================================================

  /**
   * Get inventory items with optional filtering and pagination
   * @param {Object} params - Query parameters
   * @param {string} params.search - Search query
   * @param {string} params.category - Filter by category ID
   * @param {string} params.supplier - Filter by supplier ID
   * @param {string} params.stock_status - Filter by status (in_stock, low_stock, out_of_stock)
   * @param {number} params.page - Page number
   * @param {number} params.page_size - Page size
   * @returns {Promise<Object>} Paginated inventory items
   */
  getInventoryItems: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getInventoryItems({
          signal: options.signal,
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/items/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch inventory items'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch inventory items'));
    }
  },

  /**
   * Get a single inventory item by ID
   * @param {string} id - Item ID
   * @returns {Promise<Object>} Item data with full details
   */
  getInventoryItem: async (id) => {
    try {
      return await apiClient.get(`/inventory/items/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch inventory item'));
    }
  },

  /**
   * Get stock movements for an item
   * @param {string} id - Item ID
   * @param {Object} params - Query parameters (page, page_size)
   * @returns {Promise<Object>} Paginated stock movements
   */
  getItemMovements: async (id, params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/items/${id}/movements/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch item movements'));
    }
  },

  /**
   * Get expiry trackers for an item
   * @param {string} id - Item ID
   * @returns {Promise<Array>} Expiry tracker entries (batches)
   */
  getItemExpiryTrackers: async (id) => {
    try {
      return await apiClient.get(`/inventory/items/${id}/expiry_trackers/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch item expiry trackers'));
    }
  },

  /**
   * Get stock by location for an item
   * @param {string} id - Item ID
   * @returns {Promise<Array>} Stock quantities by location
   */
  getItemStockByLocation: async (id) => {
    try {
      return await apiClient.get(`/inventory/items/${id}/stock_by_location/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch item stock by location'));
    }
  },

  /**
   * Create a new inventory item
   * @param {Object} data - Item data
   * @returns {Promise<Object>} Created item
   */
  createInventoryItem: async (data) => {
    try {
      return await apiClient.post('/inventory/items/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create inventory item'));
    }
  },

  /**
   * Update an inventory item
   * @param {string} id - Item ID
   * @param {Object} data - Item data to update
   * @returns {Promise<Object>} Updated item
   */
  updateInventoryItem: async (id, data) => {
    try {
      return await apiClient.patch(`/inventory/items/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update inventory item'));
    }
  },

  /**
   * Delete an inventory item
   * @param {string} id - Item ID
   * @returns {Promise<void>}
   */
  deleteInventoryItem: async (id) => {
    try {
      return await apiClient.delete(`/inventory/items/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete inventory item'));
    }
  },

  // =========================================================================
  // Stock Movements
  // =========================================================================

  /**
   * Get stock movements with optional filtering
   * @param {Object} params - Query parameters
   * @param {string} params.item - Filter by item ID
   * @param {string} params.location - Filter by location ID
   * @param {string} params.movement_type - Filter by type
   * @param {string} params.start_date - Filter by start date
   * @param {string} params.end_date - Filter by end date
   * @returns {Promise<Object>} Paginated stock movements
   */
  getStockMovements: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/movements/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch stock movements'));
    }
  },

  /**
   * Create a stock movement
   * @param {Object} data - Movement data
   * @returns {Promise<Object>} Created movement
   */
  createStockMovement: async (data) => {
    try {
      return await apiClient.post('/inventory/movements/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create stock movement'));
    }
  },

  /**
   * Bulk create stock movements
   * @param {Array} movements - Array of movement data
   * @returns {Promise<Array>} Created movements
   */
  bulkCreateStockMovements: async (movements) => {
    try {
      return await apiClient.post('/inventory/movements/bulk_create/', { movements });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create stock movements'));
    }
  },

  // =========================================================================
  // Batch Recommendations (FEFO)
  // =========================================================================

  /**
   * Get batch recommendations for an item (FEFO order)
   * @param {string} itemId - Item ID
   * @param {Object} params - Query parameters
   * @param {string} params.location - Filter by location
   * @param {number} params.quantity - Required quantity
   * @returns {Promise<Array>} Batch recommendations in FEFO order
   */
  getBatchRecommendations: async (itemId, params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/batch-recommendations/item/${itemId}/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch batch recommendations'));
    }
  },

  // =========================================================================
  // Stock Availability
  // =========================================================================

  /**
   * Check stock availability
   * @param {Object} params - Query parameters
   * @param {string} params.item - Item ID
   * @param {string} params.location - Location ID
   * @param {number} params.quantity - Required quantity
   * @returns {Promise<Object>} Availability status
   */
  checkStockAvailability: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/inventory/stock/check/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to check stock availability'));
    }
  },

  // =========================================================================
  // Expiry Trackers
  // =========================================================================

  /**
   * Get expiry trackers with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated expiry trackers
   */
  getExpiryTrackers: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/expiry-trackers/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch expiry trackers'));
    }
  },

  /**
   * Get expired batches
   * @returns {Promise<Array>} Expired batches
   */
  getExpiredBatches: async () => {
    try {
      return await apiClient.get('/inventory/expiry-trackers/expired/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch expired batches'));
    }
  },

  /**
   * Get batches expiring soon
   * @param {number} days - Days threshold (default: 30)
   * @returns {Promise<Array>} Expiring batches
   */
  getExpiringSoonBatches: async (days = 30) => {
    try {
      return await apiClient.get(`/inventory/expiry-trackers/expiring_soon/?days=${days}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch expiring batches'));
    }
  },

  /**
   * Mark batch as consumed
   * @param {string} id - Expiry tracker ID
   * @returns {Promise<Object>} Updated tracker
   */
  markBatchAsConsumed: async (id) => {
    try {
      return await apiClient.post(`/inventory/expiry-trackers/${id}/mark_as_consumed/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to mark batch as consumed'));
    }
  },

  /**
   * Mark batch as disposed
   * @param {string} id - Expiry tracker ID
   * @param {Object} data - Disposal data (reason)
   * @returns {Promise<Object>} Updated tracker
   */
  markBatchAsDisposed: async (id, data) => {
    try {
      return await apiClient.post(`/inventory/expiry-trackers/${id}/mark_as_disposed/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to mark batch as disposed'));
    }
  },

  // =========================================================================
  // Purchase Requisitions
  // =========================================================================

  /**
   * Get purchase requisitions with optional filtering
   * @param {Object} params - Query parameters
   * @param {string} params.status - Filter by status
   * @param {string} params.department - Filter by department
   * @param {string} params.priority - Filter by priority
   * @returns {Promise<Object>} Paginated requisitions
   */
  getRequisitions: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockRequisitions({
          query: buildV2CursorQuery(params, 20),
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/requisitions/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch requisitions'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch requisitions'));
    }
  },

  /**
   * Get a single requisition by ID
   * @param {string} id - Requisition ID
   * @returns {Promise<Object>} Requisition data with items
   */
  getRequisition: async (id) => {
    try {
      return await apiClient.get(`/inventory/requisitions/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch requisition'));
    }
  },

  /**
   * Create a new requisition
   * @param {Object} data - Requisition data with items
   * @returns {Promise<Object>} Created requisition
   */
  createRequisition: async (data) => {
    try {
      return await apiClient.post('/inventory/requisitions/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create requisition'));
    }
  },

  /**
   * Update a requisition
   * @param {string} id - Requisition ID
   * @param {Object} data - Requisition data to update
   * @returns {Promise<Object>} Updated requisition
   */
  updateRequisition: async (id, data) => {
    try {
      return await apiClient.patch(`/inventory/requisitions/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update requisition'));
    }
  },

  /**
   * Submit requisition for approval
   * @param {string} id - Requisition ID
   * @returns {Promise<Object>} Updated requisition
   */
  submitRequisition: async (id) => {
    try {
      return await apiClient.post(`/inventory/requisitions/${id}/submit/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to submit requisition'));
    }
  },

  /**
   * Approve a requisition
   * @param {string} id - Requisition ID
   * @returns {Promise<Object>} Updated requisition
   */
  approveRequisition: async (id) => {
    try {
      return await apiClient.post(`/inventory/requisitions/${id}/approve/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to approve requisition'));
    }
  },

  /**
   * Reject a requisition
   * @param {string} id - Requisition ID
   * @param {Object} data - Rejection data with reason
   * @returns {Promise<Object>} Updated requisition
   */
  rejectRequisition: async (id, data) => {
    try {
      return await apiClient.post(`/inventory/requisitions/${id}/reject/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to reject requisition'));
    }
  },

  /**
   * Convert requisition to purchase order
   * @param {string} id - Requisition ID
   * @param {Object} data - Conversion data (supplier)
   * @returns {Promise<Object>} Created purchase order
   */
  convertRequisitionToPO: async (id, data = {}) => {
    try {
      return await apiClient.post(`/inventory/requisitions/${id}/convert-to-po/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to convert requisition to PO'));
    }
  },

  // =========================================================================
  // Purchase Orders
  // =========================================================================

  /**
   * Get purchase orders with optional filtering
   * @param {Object} params - Query parameters
   * @param {string} params.status - Filter by status
   * @param {string} params.supplier - Filter by supplier
   * @returns {Promise<Object>} Paginated purchase orders
   */
  getPurchaseOrders: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPurchaseOrders({
          query: buildV2CursorQuery(params, 20),
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/purchase-orders/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch purchase orders'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch purchase orders'));
    }
  },

  /**
   * Get a single purchase order by ID
   * @param {string} id - Purchase order ID
   * @returns {Promise<Object>} Purchase order data with items
   */
  getPurchaseOrder: async (id) => {
    try {
      return await apiClient.get(`/inventory/purchase-orders/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch purchase order'));
    }
  },

  /**
   * Create a new purchase order
   * @param {Object} data - Purchase order data with items
   * @returns {Promise<Object>} Created purchase order
   */
  createPurchaseOrder: async (data) => {
    try {
      return await apiClient.post('/inventory/purchase-orders/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create purchase order'));
    }
  },

  /**
   * Update a purchase order
   * @param {string} id - Purchase order ID
   * @param {Object} data - Purchase order data to update
   * @returns {Promise<Object>} Updated purchase order
   */
  updatePurchaseOrder: async (id, data) => {
    try {
      return await apiClient.patch(`/inventory/purchase-orders/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update purchase order'));
    }
  },

  /**
   * Approve a purchase order
   * @param {string} id - Purchase order ID
   * @returns {Promise<Object>} Updated purchase order
   */
  approvePurchaseOrder: async (id) => {
    try {
      return await apiClient.post(`/inventory/purchase-orders/${id}/approve/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to approve purchase order'));
    }
  },

  /**
   * Send purchase order to supplier
   * @param {string} id - Purchase order ID
   * @returns {Promise<Object>} Updated purchase order
   */
  sendPurchaseOrder: async (id) => {
    try {
      return await apiClient.post(`/inventory/purchase-orders/${id}/send/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to send purchase order'));
    }
  },

  // =========================================================================
  // Goods Received Notes (GRNs)
  // =========================================================================

  /**
   * Get GRNs with optional filtering
   * @param {Object} params - Query parameters
   * @param {string} params.status - Filter by status
   * @param {string} params.purchase_order - Filter by PO
   * @returns {Promise<Object>} Paginated GRNs
   */
  getGRNs: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getGoodsReceivedNotes({
          query: buildV2CursorQuery(params, 20),
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/grns/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch GRNs'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch GRNs'));
    }
  },

  /**
   * Get a single GRN by ID
   * @param {string} id - GRN ID
   * @returns {Promise<Object>} GRN data with items
   */
  getGRN: async (id) => {
    try {
      return await apiClient.get(`/inventory/grns/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch GRN'));
    }
  },

  /**
   * Create a new GRN
   * @param {Object} data - GRN data with items
   * @returns {Promise<Object>} Created GRN
   */
  createGRN: async (data) => {
    try {
      return await apiClient.post('/inventory/grns/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create GRN'));
    }
  },

  /**
   * Update a GRN
   * @param {string} id - GRN ID
   * @param {Object} data - GRN data to update
   * @returns {Promise<Object>} Updated GRN
   */
  updateGRN: async (id, data) => {
    try {
      return await apiClient.patch(`/inventory/grns/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update GRN'));
    }
  },

  /**
   * Update a GRN item (quantities, batch info)
   * @param {string} grnId - GRN ID
   * @param {string} itemId - GRN item ID
   * @param {Object} data - Item data to update
   * @returns {Promise<Object>} Updated GRN item
   */
  updateGRNItem: async (grnId, itemId, data) => {
    try {
      return await apiClient.patch(`/inventory/grns/${grnId}/items/${itemId}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update GRN item'));
    }
  },

  /**
   * Mark GRN as inspected
   * @param {string} id - GRN ID
   * @returns {Promise<Object>} Updated GRN
   */
  inspectGRN: async (id) => {
    try {
      return await apiClient.post(`/inventory/grns/${id}/inspect/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to inspect GRN'));
    }
  },

  /**
   * Accept GRN and update inventory
   * @param {string} id - GRN ID
   * @returns {Promise<Object>} Updated GRN
   */
  acceptGRN: async (id) => {
    try {
      return await apiClient.post(`/inventory/grns/${id}/accept/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to accept GRN'));
    }
  },

  // =========================================================================
  // Internal Requisitions
  // =========================================================================

  /**
   * Get internal requisitions with optional filtering
   * @param {Object} params - Query parameters
   * @param {string} params.status - Filter by status
   * @param {string} params.requesting_location - Filter by requesting location
   * @returns {Promise<Object>} Paginated internal requisitions
   */
  getInternalRequisitions: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockRequisitions({
          query: buildV2CursorQuery(params, 20),
          signal: options.signal,
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/internal-requisitions/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch internal requisitions'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch internal requisitions'));
    }
  },

  /**
   * Get a single internal requisition by ID
   * @param {string} id - Internal requisition ID
   * @returns {Promise<Object>} Internal requisition data
   */
  getInternalRequisition: async (id, options = {}) => {
    try {
      return await apiClient.get(`/inventory/internal-requisitions/${id}/`, options);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch internal requisition'));
    }
  },

  /**
   * Create a new internal requisition
   * @param {Object} data - Internal requisition data
   * @returns {Promise<Object>} Created internal requisition
   */
  createInternalRequisition: async (data) => {
    try {
      return await apiClient.post('/inventory/internal-requisitions/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create internal requisition'));
    }
  },

  /**
   * Submit internal requisition for approval
   * @param {string} id - Internal requisition ID
   * @returns {Promise<Object>} Updated internal requisition
   */
  submitInternalRequisition: async (id) => {
    try {
      return await apiClient.post(`/inventory/internal-requisitions/${id}/submit/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to submit internal requisition'));
    }
  },

  /**
   * Approve internal requisition
   * @param {string} id - Internal requisition ID
   * @returns {Promise<Object>} Updated internal requisition
   */
  approveInternalRequisition: async (id, data) => {
    try {
      return await apiClient.post(`/inventory/internal-requisitions/${id}/approve/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to approve internal requisition'));
    }
  },

  /**
   * Reject internal requisition
   * @param {string} id - Internal requisition ID
   * @param {Object} data - Rejection data with reason
   * @returns {Promise<Object>} Updated internal requisition
   */
  rejectInternalRequisition: async (id, data) => {
    try {
      return await apiClient.post(`/inventory/internal-requisitions/${id}/reject/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to reject internal requisition'));
    }
  },

  /**
   * Fulfill internal requisition
   * @param {string} id - Internal requisition ID
   * @returns {Promise<Object>} Updated internal requisition
   */
  fulfillInternalRequisition: async (id, data) => {
    try {
      return await apiClient.post(`/inventory/internal-requisitions/${id}/fulfill/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fulfill internal requisition'));
    }
  },

  /**
   * Cancel internal requisition
   * @param {string} id - Internal requisition ID
   * @returns {Promise<Object>} Updated internal requisition
   */
  cancelInternalRequisition: async (id) => {
    try {
      return await apiClient.post(`/inventory/internal-requisitions/${id}/cancel/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel internal requisition'));
    }
  },

  // =========================================================================
  // Standing Orders
  // =========================================================================

  /**
   * Get standing orders with optional filtering
   * @param {Object} params - Query parameters
   * @param {boolean} params.is_active - Filter by active status
   * @returns {Promise<Object>} Paginated standing orders
   */
  getStandingOrders: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return emptyPaginatedList(params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/standing-orders/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch standing orders'));
    }
  },

  /**
   * Get a single standing order by ID
   * @param {string} id - Standing order ID
   * @returns {Promise<Object>} Standing order data
   */
  getStandingOrder: async (id) => {
    try {
      return await apiClient.get(`/inventory/standing-orders/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch standing order'));
    }
  },

  /**
   * Create a new standing order
   * @param {Object} data - Standing order data
   * @returns {Promise<Object>} Created standing order
   */
  createStandingOrder: async (data) => {
    try {
      return await apiClient.post('/inventory/standing-orders/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create standing order'));
    }
  },

  /**
   * Update a standing order
   * @param {string} id - Standing order ID
   * @param {Object} data - Standing order data to update
   * @returns {Promise<Object>} Updated standing order
   */
  updateStandingOrder: async (id, data) => {
    try {
      return await apiClient.patch(`/inventory/standing-orders/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update standing order'));
    }
  },

  /**
   * Generate requisition from standing order
   * @param {string} id - Standing order ID
   * @returns {Promise<Object>} Generated internal requisition
   */
  generateStandingOrder: async (id) => {
    try {
      return await apiClient.post(`/inventory/standing-orders/${id}/generate/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to generate from standing order'));
    }
  },

  /**
   * Get standing orders due for generation
   * @returns {Promise<Array>} Due standing orders
   */
  getDueStandingOrders: async () => {
    try {
      return await apiClient.get('/inventory/standing-orders/due/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch due standing orders'));
    }
  },

  /**
   * Process all due standing orders
   * @returns {Promise<Object>} Processing result
   */
  processDueStandingOrders: async () => {
    try {
      return await apiClient.post('/inventory/standing-orders/process-due/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to process due standing orders'));
    }
  },

  // =========================================================================
  // Stock Transfer Requests
  // =========================================================================

  /**
   * Get transfer requests with optional filtering
   * @param {Object} params - Query parameters
   * @param {string} params.status - Filter by status
   * @param {string} params.source_location - Filter by source
   * @param {string} params.destination_location - Filter by destination
   * @returns {Promise<Object>} Paginated transfer requests
   */
  getTransferRequests: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockTransfers({
          query: buildV2CursorQuery(params, 20),
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/transfer-requests/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch transfer requests'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch transfer requests'));
    }
  },

  /**
   * Get a single transfer request by ID
   * @param {string} id - Transfer request ID
   * @returns {Promise<Object>} Transfer request data
   */
  getTransferRequest: async (id) => {
    try {
      return await apiClient.get(`/inventory/transfer-requests/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch transfer request'));
    }
  },

  /**
   * Create a new transfer request
   * @param {Object} data - Transfer request data
   * @returns {Promise<Object>} Created transfer request
   */
  createTransferRequest: async (data) => {
    try {
      return await apiClient.post('/inventory/transfer-requests/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create transfer request'));
    }
  },

  /**
   * Approve a transfer request
   * @param {string} id - Transfer request ID
   * @returns {Promise<Object>} Updated transfer request
   */
  approveTransferRequest: async (id) => {
    try {
      return await apiClient.post(`/inventory/transfer-requests/${id}/approve/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to approve transfer request'));
    }
  },

  /**
   * Dispatch a transfer request
   * @param {string} id - Transfer request ID
   * @param {Object} data - Dispatch data (courier info, etc.)
   * @returns {Promise<Object>} Updated transfer request
   */
  dispatchTransferRequest: async (id, data = {}) => {
    try {
      return await apiClient.post(`/inventory/transfer-requests/${id}/dispatch/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to dispatch transfer request'));
    }
  },

  /**
   * Receive a transfer request
   * @param {string} id - Transfer request ID
   * @param {Object} data - Receipt data (actual quantities, notes)
   * @returns {Promise<Object>} Updated transfer request
   */
  receiveTransferRequest: async (id, data = {}) => {
    try {
      return await apiClient.post(`/inventory/transfer-requests/${id}/receive/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to receive transfer request'));
    }
  },

  /**
   * Cancel a transfer request
   * @param {string} id - Transfer request ID
   * @returns {Promise<Object>} Updated transfer request
   */
  cancelTransferRequest: async (id) => {
    try {
      return await apiClient.post(`/inventory/transfer-requests/${id}/cancel/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel transfer request'));
    }
  },

  // =========================================================================
  // Controlled Substance Registers
  // =========================================================================

  /**
   * Get controlled substance registers
   * @param {Object} params - Query parameters
   * @param {string} params.location - Filter by location
   * @param {string} params.item - Filter by item
   * @returns {Promise<Object>} Paginated registers
   */
  getControlledRegisters: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getControlledSubstanceRegister({
          query: buildV2CursorQuery(params, 20),
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/controlled-registers/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch controlled registers'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch controlled registers'));
    }
  },

  /**
   * Get a single controlled substance register
   * @param {string} id - Register ID
   * @returns {Promise<Object>} Register data
   */
  getControlledRegister: async (id) => {
    try {
      return await apiClient.get(`/inventory/controlled-registers/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch controlled register'));
    }
  },

  /**
   * Get entries for a controlled substance register
   * @param {string} id - Register ID
   * @param {Object} params - Query parameters (page, page_size)
   * @returns {Promise<Object>} Paginated entries
   */
  getControlledRegisterEntries: async (id, params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/controlled-registers/${id}/entries/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch register entries'));
    }
  },

  /**
   * Validate register balance
   * @param {string} id - Register ID
   * @returns {Promise<Object>} Validation result
   */
  validateRegisterBalance: async (id) => {
    try {
      return await apiClient.get(`/inventory/controlled-registers/${id}/validate_balance/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to validate register balance'));
    }
  },

  // =========================================================================
  // Controlled Substance Operations
  // =========================================================================

  /**
   * Dispense controlled substance
   * @param {Object} data - Dispense data
   * @param {string} data.register - Register ID
   * @param {number} data.quantity - Quantity to dispense
   * @param {string} data.patient - Patient ID
   * @param {string} data.prescription_reference - Prescription reference
   * @param {string} data.batch_number - Batch number
   * @param {string} data.witness - Witness user ID (required)
   * @returns {Promise<Object>} Created entry
   */
  dispenseControlledSubstance: async (data) => {
    try {
      return await apiClient.post('/inventory/controlled/dispense/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to dispense controlled substance'));
    }
  },

  /**
   * Record controlled substance wastage
   * @param {Object} data - Wastage data
   * @param {string} data.register - Register ID
   * @param {number} data.quantity - Quantity wasted
   * @param {string} data.reason - Wastage reason
   * @param {string} data.batch_number - Batch number
   * @param {string} data.witness - Witness user ID (required)
   * @returns {Promise<Object>} Created entry
   */
  recordControlledWastage: async (data) => {
    try {
      return await apiClient.post('/inventory/controlled/wastage/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to record wastage'));
    }
  },

  /**
   * Perform physical count of controlled substance
   * @param {Object} data - Count data
   * @param {string} data.register - Register ID
   * @param {number} data.actual_count - Actual count
   * @param {string} data.witness - Witness user ID (required)
   * @param {string} data.notes - Notes
   * @returns {Promise<Object>} Count result with discrepancy info
   */
  recordControlledCount: async (data) => {
    try {
      return await apiClient.post('/inventory/controlled/count/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to record count'));
    }
  },

  // =========================================================================
  // Controlled Substance Discrepancies
  // =========================================================================

  /**
   * Get controlled substance discrepancies
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated discrepancies
   */
  getControlledDiscrepancies: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/controlled-discrepancies/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch discrepancies'));
    }
  },

  /**
   * Get pending discrepancies
   * @returns {Promise<Array>} Pending discrepancies
   */
  getPendingDiscrepancies: async () => {
    try {
      return await apiClient.get('/inventory/controlled-discrepancies/pending/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch pending discrepancies'));
    }
  },

  /**
   * Resolve a discrepancy
   * @param {string} id - Discrepancy ID
   * @param {Object} data - Resolution data
   * @returns {Promise<Object>} Resolved discrepancy
   */
  resolveDiscrepancy: async (id, data) => {
    try {
      return await apiClient.post(`/inventory/controlled-discrepancies/${id}/resolve/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to resolve discrepancy'));
    }
  },

  /**
   * Escalate a discrepancy
   * @param {string} id - Discrepancy ID
   * @param {Object} data - Escalation data
   * @returns {Promise<Object>} Escalated discrepancy
   */
  escalateDiscrepancy: async (id, data) => {
    try {
      return await apiClient.post(`/inventory/controlled-discrepancies/${id}/escalate/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to escalate discrepancy'));
    }
  },

  // =========================================================================
  // Analytics
  // =========================================================================

  /**
   * Get consumption analytics
   * @param {Object} params - Query parameters
   * @param {string} params.start_date - Start date
   * @param {string} params.end_date - End date
   * @param {string} params.item - Filter by item
   * @param {string} params.category - Filter by category
   * @param {string} params.location - Filter by location
   * @param {string} params.period - Aggregation period (day, week, month)
   * @returns {Promise<Object>} Consumption analytics
   */
  getConsumptionAnalytics: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return {
          period: params.period || '30d',
          results: [],
          total_consumption: 0,
          total_value: 0,
        };
      }

      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/inventory/analytics/consumption/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch consumption analytics'));
    }
  },

  /**
   * Get ABC analysis
   * @param {Object} params - Query parameters
   * @param {string} params.period_days - Analysis period in days
   * @returns {Promise<Object>} ABC analysis data
   */
  getABCAnalysis: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/inventory/analytics/abc-analysis/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch ABC analysis'));
    }
  },

  /**
   * Get supplier performance metrics
   * @param {Object} params - Query parameters
   * @param {string} params.start_date - Start date
   * @param {string} params.end_date - End date
   * @param {string} params.supplier - Filter by supplier
   * @returns {Promise<Object>} Supplier performance data
   */
  getSupplierPerformance: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/inventory/analytics/supplier-performance/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch supplier performance'));
    }
  },

  /**
   * Get expiry forecast
   * @param {Object} params - Query parameters
   * @param {number} params.days - Forecast period in days
   * @returns {Promise<Object>} Expiry forecast data
   */
  getExpiryForecast: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/inventory/analytics/expiry-forecast/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch expiry forecast'));
    }
  },

  /**
   * Get stock valuation report
   * @param {Object} params - Query parameters
   * @param {string} params.location - Filter by location
   * @param {string} params.category - Filter by category
   * @returns {Promise<Object>} Stock valuation data
   */
  getStockValuation: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/inventory/analytics/stock-valuation/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch stock valuation'));
    }
  },

  /**
   * Get controlled substance activity report
   * @param {Object} params - Query parameters
   * @param {string} params.start_date - Start date
   * @param {string} params.end_date - End date
   * @param {string} params.register - Filter by register
   * @returns {Promise<Object>} Controlled substance activity
   */
  getControlledSubstanceReport: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/inventory/analytics/controlled-substances/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch controlled substance report'));
    }
  },

  // =========================================================================
  // Inventory Audits
  // =========================================================================

  /**
   * Get inventory audits
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} Paginated audits
   */
  getInventoryAudits: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/audits/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch inventory audits'));
    }
  },

  /**
   * Get a single inventory audit
   * @param {string} id - Audit ID
   * @returns {Promise<Object>} Audit data with items
   */
  getInventoryAudit: async (id) => {
    try {
      return await apiClient.get(`/inventory/audits/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch inventory audit'));
    }
  },

  /**
   * Create a new inventory audit
   * @param {Object} data - Audit data
   * @returns {Promise<Object>} Created audit
   */
  createInventoryAudit: async (data) => {
    try {
      return await apiClient.post('/inventory/audits/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create inventory audit'));
    }
  },

  /**
   * Complete an inventory audit
   * @param {string} id - Audit ID
   * @returns {Promise<Object>} Completed audit
   */
  completeInventoryAudit: async (id) => {
    try {
      return await apiClient.post(`/inventory/audits/${id}/complete_audit/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to complete audit'));
    }
  },

  /**
   * Cancel an inventory audit
   * @param {string} id - Audit ID
   * @returns {Promise<Object>} Cancelled audit
   */
  cancelInventoryAudit: async (id) => {
    try {
      return await apiClient.post(`/inventory/audits/${id}/cancel_audit/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel audit'));
    }
  },

  // =========================================================================
  // Location Stock
  // =========================================================================

  /**
   * Get stock by item across all locations
   * @param {string} itemId - Item ID
   * @returns {Promise<Array>} Stock by location
   */
  getStockByItemLocation: async (itemId) => {
    try {
      return await apiClient.get(`/inventory/location-stock/item/${itemId}/by-location/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch stock by location'));
    }
  },
};
