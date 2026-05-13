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

function minorToMajor(value) {
  return toNumber(value) / 100;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function rustV2Unsupported(contractName) {
  return Promise.reject(new Error(`${contractName} is unavailable in Rust V2 mode.`));
}

function pickEntityId(value) {
  if (value && typeof value === 'object') {
    return value.id || value.value || null;
  }
  return value || null;
}

function positiveInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
  return parsed;
}

function nonNegativeInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be zero or greater.`);
  }
  return parsed;
}

function v2Object(response) {
  return response?.data || {};
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

function adaptV2LocationStock(row) {
  const quantity = toNumber(row?.quantity_on_hand);
  return {
    id: row?.location_id,
    item_id: row?.item_id,
    location_id: row?.location_id,
    location_name: row?.location_name || 'Storage location',
    name: row?.location_name || 'Storage location',
    quantity_on_hand: quantity,
    quantity,
    available_quantity: quantity,
    reserved_quantity: 0,
  };
}

function adaptV2StorageLocationStock(row) {
  const quantity = toNumber(row?.quantity_on_hand);
  return {
    ...row,
    id: row?.item_id,
    item: row?.item_id,
    item_id: row?.item_id,
    item_name: row?.item_name || 'Inventory item',
    name: row?.item_name || 'Inventory item',
    location_id: row?.location_id,
    location_name: row?.location_name || 'Storage location',
    quantity_on_hand: quantity,
    quantity,
    available_quantity: quantity,
    reserved_quantity: 0,
    batch_count: toNumber(row?.batch_count),
    earliest_expiry: row?.earliest_expiry || null,
    expiry_date: row?.earliest_expiry || null,
    last_received_at: row?.last_received_at || null,
  };
}

function adaptV2ControlledEntry(entry) {
  return {
    ...entry,
    entry_type: entry?.entry_type || entry?.movement_type,
    type: entry?.entry_type || entry?.movement_type,
    quantity: toNumber(entry?.quantity ?? entry?.quantity_delta),
    balance_before: toNumber(entry?.balance_before),
    balance_after: toNumber(entry?.balance_after),
    witness: entry?.witness_user_id || null,
  };
}

function adaptV2ControlledRegister(register) {
  const currentBalance = toNumber(register?.current_balance ?? register?.balance_after ?? register?.balance_on_hand);
  return {
    ...register,
    current_balance: currentBalance,
    balance_on_hand: currentBalance,
    location_name: register?.location_name || 'Storage location',
    unit_of_measure: register?.unit_of_measure || register?.unit || 'units',
    entry_count: toNumber(register?.entry_count),
    total_dispensed: toNumber(register?.total_dispensed),
    total_received: toNumber(register?.total_received),
    total_wastage: toNumber(register?.total_wastage),
    has_discrepancy: Boolean(register?.has_discrepancy),
    discrepancy_count: toNumber(register?.discrepancy_count),
  };
}

function adaptV2ControlledDiscrepancy(entry, registerId) {
  const discrepancyAmount = toNumber(entry?.quantity ?? entry?.quantity_delta);
  return {
    id: entry?.id,
    controlled_register: registerId,
    register: registerId,
    status: 'pending',
    expected_balance: toNumber(entry?.balance_before),
    actual_count: toNumber(entry?.balance_after),
    discrepancy_amount: discrepancyAmount,
    notes: entry?.notes || null,
    created_at: entry?.created_at || null,
  };
}

function adaptV2Requisition(requisition) {
  const status = requisition?.status === 'requested' ? 'pending' : requisition?.status;
  return {
    ...requisition,
    status,
    requested_by_name: requisition?.requested_by_name || requisition?.created_by_name || 'HMS V2',
    items_count: toNumber(requisition?.items_count),
  };
}

function adaptV2InternalRequisition(requisition) {
  const adapted = adaptV2Requisition(requisition);
  return {
    ...adapted,
    status: ['requested', 'pending'].includes(requisition?.status)
      ? 'pending_approval'
      : adapted.status,
  };
}

function adaptV2PurchaseOrder(order) {
  return {
    ...order,
    supplier: order?.supplier_name || order?.supplier || null,
    supplier_display: order?.supplier_name || order?.supplier || 'Supplier',
    items_count: toNumber(order?.items_count),
  };
}

function normalizeV2GrnStatus(status) {
  if (status === 'received') {
    return 'pending_inspection';
  }
  return status;
}

function adaptV2GoodsReceivedNote(grn) {
  const status = normalizeV2GrnStatus(grn?.status);
  const receivedAt = grn?.received_at || grn?.created_at || null;
  return {
    ...grn,
    status,
    purchase_order: grn?.purchase_order_id || grn?.purchase_order || null,
    received_date: grn?.received_date || (receivedAt ? String(receivedAt).slice(0, 10) : null),
    created_at: grn?.created_at || receivedAt,
    items: Array.isArray(grn?.items) ? grn.items : [],
    grn_items: Array.isArray(grn?.grn_items) ? grn.grn_items : [],
  };
}

function adaptV2DashboardSummary(response) {
  const summary = v2Object(response);
  return {
    total_items: toNumber(summary.total_items),
    low_stock_count: toNumber(summary.low_stock_count),
    expiring_soon_count: toNumber(summary.expiring_soon_count),
    expiring_count: toNumber(summary.expiring_count),
    total_stock_value: minorToMajor(summary.total_stock_value_minor),
    total_value: minorToMajor(summary.total_value_minor),
    pending_requisitions: toNumber(summary.pending_requisitions),
    pending_grns: toNumber(summary.pending_grns),
    discrepancies: toNumber(summary.discrepancies),
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

function buildV2InventoryItemsQuery(params = {}) {
  const query = {};
  if (params.search) {
    query.search = params.search;
  }
  if (params.category) {
    query.category = params.category;
  }
  if (params.location) {
    query.location = params.location;
  }
  if (params.status || params.stock_status) {
    query.status = params.status || params.stock_status;
  }
  Object.assign(query, buildV2CursorQuery(params, 24));
  return query;
}

function buildV2SuppliersQuery(params = {}) {
  const query = {};
  if (params.search) {
    query.search = String(params.search).trim();
  }
  if (params.is_active !== undefined) {
    query.is_active = params.is_active;
  }
  Object.assign(query, buildV2CursorQuery(params, 25));
  return query;
}

function buildV2StockRequisitionPayload(data = {}) {
  return {
    requesting_location_id: pickEntityId(data.requesting_location_id ?? data.requesting_location ?? data.location),
  };
}

function buildV2PurchaseOrderPayload(data = {}) {
  const supplierName = data.supplier_name || data.supplier?.name || data.supplier || data.vendor_name;
  return {
    supplier_name: String(supplierName || '').trim(),
  };
}

function buildV2GoodsReceivedNotePayload(data = {}) {
  return {
    purchase_order_id: pickEntityId(data.purchase_order_id ?? data.purchase_order ?? data.po),
  };
}

function buildV2StockTransferPayload(data = {}) {
  return {
    item_id: pickEntityId(data.item_id ?? data.item),
    from_location_id: pickEntityId(data.from_location_id ?? data.from_location ?? data.source_location),
    to_location_id: pickEntityId(data.to_location_id ?? data.to_location ?? data.destination_location),
    quantity: positiveInteger(data.quantity, 'quantity'),
  };
}

function buildV2ControlledMovementPayload(data = {}, movementType, direction) {
  const quantity = positiveInteger(data.quantity ?? data.quantity_delta ?? data.actual_count, 'quantity');
  return {
    item_id: pickEntityId(data.item_id ?? data.item),
    location_id: pickEntityId(data.location_id ?? data.location),
    movement_type: movementType,
    quantity_delta: direction * quantity,
    witness_user_id: pickEntityId(data.witness_user_id ?? data.witness) || null,
  };
}

function buildV2ControlledCountPayload(data = {}) {
  return {
    actual_count: nonNegativeInteger(data.actual_count ?? data.count, 'actual_count'),
    witness_user_id: pickEntityId(data.witness_user_id ?? data.witness ?? data.witness_id) || null,
    notes: data.notes || null,
  };
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
        const response = await v2Api.getInventoryDashboardSummary({
          query: { expiring_within_days: boundedLimit(params.days, 30) },
          signal: options.signal,
        });
        return adaptV2DashboardSummary(response);
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory category detail contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory category mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory category mutation contract');
      }

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
  getSuppliers: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getInventorySuppliers({
          query: buildV2SuppliersQuery(params),
          signal: options.signal,
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/suppliers/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch suppliers'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 supplier contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 supplier contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 supplier contract');
      }

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
          query: buildV2CursorQuery(params),
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
  getStorageLocation: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStorageLocationById({ id }, {
          signal: options.signal,
        });
        return v2Object(response);
      }

      return await apiClient.get(`/inventory/locations/${id}/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch storage location'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch storage location'));
    }
  },

  /**
   * Get stock at a specific location
   * @param {string} id - Location ID
   * @returns {Promise<Array>} Stock items at location
   */
  getLocationStock: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStorageLocationStock({ id }, {
          query: {
            limit: boundedLimit(options.page_size || options.limit || 25),
            ...(options.cursor ? { cursor: options.cursor } : {}),
          },
          signal: options.signal,
        });
        return unwrapV2List(response).map(adaptV2StorageLocationStock);
      }

      return await apiClient.get(`/inventory/locations/${id}/stock/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch location stock'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStorageLocations();
        return unwrapV2List(response).filter((location) => (
          location.location_type === type || location.type === type
        ));
      }

      return await apiClient.get(`/inventory/locations/by_type/?type=${type}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch locations by type'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 storage location mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 storage location mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 storage location mutation contract');
      }

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
          query: buildV2InventoryItemsQuery(params),
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
  getInventoryItem: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getInventoryItemById({ id }, {
          signal: options.signal,
        });
        return v2Object(response);
      }

      return await apiClient.get(`/inventory/items/${id}/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch inventory item'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getInventoryItemStockMovements({ id }, {
          query: buildV2CursorQuery(params, 50),
          signal: params.signal,
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/items/${id}/movements/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch item movements'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch item movements'));
    }
  },

  /**
   * Get expiry trackers for an item
   * @param {string} id - Item ID
   * @returns {Promise<Array>} Expiry tracker entries (batches)
   */
  getItemExpiryTrackers: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getInventoryItemStockBatches({ id }, {
          query: { limit: boundedLimit(options.limit || options.page_size, 25) },
          signal: options.signal,
        });
        return unwrapV2List(response).map((batch) => ({
          ...adaptV2StockBatch(batch),
          id: batch?.id || batch?.item_id,
        }));
      }

      return await apiClient.get(`/inventory/items/${id}/expiry_trackers/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch item expiry trackers'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch item expiry trackers'));
    }
  },

  /**
   * Get stock by location for an item
   * @param {string} id - Item ID
   * @returns {Promise<Array>} Stock quantities by location
   */
  getItemStockByLocation: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getInventoryItemStockByLocation({ id }, {
          signal: options.signal,
        });
        return unwrapV2List(response).map(adaptV2LocationStock);
      }

      return await apiClient.get(`/inventory/items/${id}/stock_by_location/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch item stock by location'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory item mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory item mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory item mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockMovements({
          query: buildV2CursorQuery(params, 20),
        });
        return adaptV2PaginatedList(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/movements/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch stock movements'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock movement mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock movement mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 batch recommendation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock availability contract');
      }

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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockBatches({
          query: buildV2CursorQuery(params, 20),
        });
        return adaptV2PaginatedList(response, params, adaptV2StockBatch);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/expiry-trackers/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch expiry trackers'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch expiry trackers'));
    }
  },

  /**
   * Get expired batches
   * @returns {Promise<Array>} Expired batches
   */
  getExpiredBatches: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockBatches({
          query: { expired: true, limit: boundedLimit(options.limit || options.page_size, 20) },
          signal: options.signal,
        });
        return unwrapV2List(response).map(adaptV2StockBatch);
      }

      return await apiClient.get('/inventory/expiry-trackers/expired/');
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch expired batches'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch expired batches'));
    }
  },

  /**
   * Get batches expiring soon
   * @param {number} days - Days threshold (default: 30)
   * @returns {Promise<Array>} Expiring batches
   */
  getExpiringSoonBatches: async (days = 30, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const thresholdDays = boundedLimit(days, 30);
        const response = await v2Api.getStockBatches({
          query: {
            expiring_within_days: thresholdDays,
            limit: boundedLimit(options.limit || options.page_size, 20),
          },
          signal: options.signal,
        });
        return unwrapV2List(response).map(adaptV2StockBatch);
      }

      return await apiClient.get(`/inventory/expiry-trackers/expiring_soon/?days=${days}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch expiring batches'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 expiry tracker action contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 expiry tracker action contract');
      }

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
        return adaptV2PaginatedList(response, params, adaptV2Requisition);
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
  getRequisition: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockRequisitionById({ id }, {
          signal: options.signal,
        });
        return adaptV2Requisition(v2Object(response));
      }

      return await apiClient.get(`/inventory/requisitions/${id}/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitions(buildV2StockRequisitionPayload(data));
        return adaptV2Requisition(v2Object(response));
      }

      return await apiClient.post('/inventory/requisitions/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create requisition'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock requisition mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitionSubmit({ id });
        return adaptV2Requisition(v2Object(response));
      }

      return await apiClient.post(`/inventory/requisitions/${id}/submit/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to submit requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitionApprove({ id });
        return adaptV2Requisition(v2Object(response));
      }

      return await apiClient.post(`/inventory/requisitions/${id}/approve/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to approve requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitionReject(
          { id },
          { reason: data?.reason || data?.rejection_reason || '' }
        );
        return adaptV2Requisition(v2Object(response));
      }

      return await apiClient.post(`/inventory/requisitions/${id}/reject/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to reject requisition'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock requisition action contract');
      }

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
        return adaptV2PaginatedList(response, params, adaptV2PurchaseOrder);
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
  getPurchaseOrder: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPurchaseOrderById({ id }, {
          signal: options.signal,
        });
        return adaptV2PurchaseOrder(v2Object(response));
      }

      return await apiClient.get(`/inventory/purchase-orders/${id}/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch purchase order'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postPurchaseOrders(buildV2PurchaseOrderPayload(data));
        return adaptV2PurchaseOrder(v2Object(response));
      }

      return await apiClient.post('/inventory/purchase-orders/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create purchase order'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 purchase order mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postPurchaseOrderApprove({ id });
        return adaptV2PurchaseOrder(v2Object(response));
      }

      return await apiClient.post(`/inventory/purchase-orders/${id}/approve/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to approve purchase order'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postPurchaseOrderSend({ id });
        return adaptV2PurchaseOrder(v2Object(response));
      }

      return await apiClient.post(`/inventory/purchase-orders/${id}/send/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to send purchase order'));
      }
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
        return adaptV2PaginatedList(response, params, adaptV2GoodsReceivedNote);
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
  getGRN: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getGoodsReceivedNoteById({ id }, {
          signal: options.signal,
        });
        return adaptV2GoodsReceivedNote(v2Object(response));
      }

      return await apiClient.get(`/inventory/grns/${id}/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch GRN'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postGoodsReceivedNotes(buildV2GoodsReceivedNotePayload(data));
        return adaptV2GoodsReceivedNote(v2Object(response));
      }

      return await apiClient.post('/inventory/grns/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create GRN'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 goods received note mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 goods received note item mutation contract');
      }

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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postGoodsReceivedNoteInspect({ id });
        return adaptV2GoodsReceivedNote(v2Object(response));
      }

      return await apiClient.post(`/inventory/grns/${id}/inspect/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to inspect GRN'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postGoodsReceivedNoteAccept({ id });
        return adaptV2GoodsReceivedNote(v2Object(response));
      }

      return await apiClient.post(`/inventory/grns/${id}/accept/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to accept GRN'));
      }
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
        return adaptV2PaginatedList(response, params, adaptV2InternalRequisition);
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockRequisitionById({ id }, {
          signal: options.signal,
        });
        return adaptV2InternalRequisition(v2Object(response));
      }

      return await apiClient.get(`/inventory/internal-requisitions/${id}/`, options);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch internal requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitions(buildV2StockRequisitionPayload(data));
        return adaptV2InternalRequisition(v2Object(response));
      }

      return await apiClient.post('/inventory/internal-requisitions/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create internal requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitionSubmit({ id });
        return adaptV2InternalRequisition(v2Object(response));
      }

      return await apiClient.post(`/inventory/internal-requisitions/${id}/submit/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to submit internal requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitionApprove({ id });
        return adaptV2InternalRequisition(v2Object(response));
      }

      return await apiClient.post(`/inventory/internal-requisitions/${id}/approve/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to approve internal requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitionReject(
          { id },
          { reason: data?.reason || data?.rejection_reason || '' }
        );
        return adaptV2InternalRequisition(v2Object(response));
      }

      return await apiClient.post(`/inventory/internal-requisitions/${id}/reject/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to reject internal requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitionFulfill({ id });
        return adaptV2InternalRequisition(v2Object(response));
      }

      return await apiClient.post(`/inventory/internal-requisitions/${id}/fulfill/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fulfill internal requisition'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockRequisitionCancel({ id });
        return adaptV2InternalRequisition(v2Object(response));
      }

      return await apiClient.post(`/inventory/internal-requisitions/${id}/cancel/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to cancel internal requisition'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 standing order contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 standing order contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 standing order contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 standing order contract');
      }

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
      if (isRustV2ApiMode()) {
        return [];
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 standing order contract');
      }

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
  getTransferRequest: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getStockTransferById({ id }, {
          signal: options.signal,
        });
        return v2Object(response);
      }

      return await apiClient.get(`/inventory/transfer-requests/${id}/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch transfer request'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postStockTransfers(buildV2StockTransferPayload(data));
        return v2Object(response);
      }

      return await apiClient.post('/inventory/transfer-requests/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create transfer request'));
      }
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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock transfer action contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock transfer action contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock transfer action contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 stock transfer action contract');
      }

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
        return adaptV2PaginatedList(response, params, adaptV2ControlledRegister);
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
  getControlledRegister: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getControlledSubstanceRegisterById({ id }, {
          signal: options.signal,
        });
        return adaptV2ControlledRegister(v2Object(response));
      }

      return await apiClient.get(`/inventory/controlled-registers/${id}/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch controlled register'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getControlledSubstanceRegisterEntries({ id }, {
          query: buildV2CursorQuery(params, 20),
          signal: params.signal,
        });
        return adaptV2PaginatedList(response, params, adaptV2ControlledEntry);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/inventory/controlled-registers/${id}/entries/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch register entries'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch register entries'));
    }
  },

  /**
   * Validate register balance
   * @param {string} id - Register ID
   * @returns {Promise<Object>} Validation result
   */
  validateRegisterBalance: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getControlledSubstanceRegisterBalanceValidation({ id }, {
          signal: options.signal,
        });
        return v2Object(response);
      }

      return await apiClient.get(`/inventory/controlled-registers/${id}/validate_balance/`);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to validate register balance'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postControlledSubstanceRegister(
          buildV2ControlledMovementPayload(data, 'dispense', -1),
        );
        return v2Object(response);
      }

      return await apiClient.post('/inventory/controlled/dispense/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to dispense controlled substance'));
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postControlledSubstanceRegister(
          buildV2ControlledMovementPayload(data, 'adjustment', -1),
        );
        return v2Object(response);
      }

      return await apiClient.post('/inventory/controlled/wastage/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to record wastage'));
      }
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
  recordControlledCount: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const id = pickEntityId(data.register_id ?? data.register);
        const response = await v2Api.postControlledSubstanceRegisterCounts(
          { id },
          buildV2ControlledCountPayload(data),
          { signal: options.signal || data.signal },
        );
        return v2Object(response);
      }

      return await apiClient.post('/inventory/controlled/count/', data);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to record count'));
      }
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
  getControlledDiscrepancies: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const registerId = pickEntityId(params.register_id ?? params.register);
        if (!registerId) {
          return emptyPaginatedList(params);
        }
        const response = await v2Api.getControlledSubstanceRegisterEntries({ id: registerId }, {
          query: buildV2CursorQuery(params),
          signal: options.signal || params.signal,
        });
        return adaptV2PaginatedList({
          ...response,
          data: unwrapV2List(response)
            .filter((entry) => entry?.entry_type === 'count' && toNumber(entry?.quantity) !== 0)
            .map((entry) => adaptV2ControlledDiscrepancy(entry, registerId)),
        }, params);
      }

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
      if (isRustV2ApiMode()) {
        return [];
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 controlled substance discrepancy action contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 controlled substance discrepancy action contract');
      }

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
      if (isRustV2ApiMode()) {
        return { period_days: params.period_days || 30, results: [] };
      }

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
      if (isRustV2ApiMode()) {
        return { suppliers: [], results: [] };
      }

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
      if (isRustV2ApiMode()) {
        const days = boundedLimit(params.days, 30);
        const response = await v2Api.getStockBatches({
          query: {
            expiring_within_days: days,
            limit: boundedLimit(params.limit || params.page_size, 20),
          },
          signal: params.signal,
        });
        return {
          days,
          results: unwrapV2List(response).map(adaptV2StockBatch),
        };
      }

      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/inventory/analytics/expiry-forecast/?${queryString}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch expiry forecast'));
      }
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
      if (isRustV2ApiMode()) {
        return { total_value: 0, results: [] };
      }

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
      if (isRustV2ApiMode()) {
        return { results: [], total_movements: 0 };
      }

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
      if (isRustV2ApiMode()) {
        return emptyPaginatedList(params);
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory audit contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory audit contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory audit contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory audit contract');
      }

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
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 inventory item stock-by-location contract');
      }

      return await apiClient.get(`/inventory/location-stock/item/${itemId}/by-location/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch stock by location'));
    }
  },
};
