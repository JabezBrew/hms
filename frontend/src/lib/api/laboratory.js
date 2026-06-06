/**
 * Laboratory API service
 */
import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api, v2Request } from './v2/client';
import {
  cacheCursorForNextPage as cacheScopedCursorForNextPage,
  resolveCursorPage as resolveScopedCursorPage,
} from './v2/cursorCache';

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function rethrowV2Error(error, message) {
  rethrowAbortError(error);
  throw new Error(handleV2ApiError(error, message));
}

const labCursorCache = new Map();

function resolveCursorPage(scope, params = {}) {
  return resolveScopedCursorPage(labCursorCache, `laboratory:${scope}`, params, ['expand']);
}

function getCursorForParams(scope, params = {}) {
  return resolveCursorPage(scope, params).cursor;
}

function cacheCursorForNextPage(scope, params, response) {
  cacheScopedCursorForNextPage(labCursorCache, `laboratory:${scope}`, params, response, ['expand']);
}

function normalizeV2Limit(params = {}, fallback = 25) {
  const rawLimit = params.limit || params.page_size || fallback;
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function mapOrderStatusToV2(status) {
  const normalized = String(status || '').toLowerCase();
  const aliases = {
    submitted: 'ordered',
    ordered: 'ordered',
    collected: 'specimen_collected',
    specimen_collected: 'specimen_collected',
    received: 'specimen_collected',
    processing: 'result_entered',
    result_entered: 'result_entered',
    completed: 'verified',
    verified: 'verified',
    cancelled: 'cancelled',
  };
  return aliases[normalized] || undefined;
}

function mapOrderStatusFromV2(status) {
  const normalized = String(status || '').toLowerCase();
  const aliases = {
    ordered: 'ordered',
    specimen_collected: 'collected',
    result_entered: 'processing',
    verified: 'completed',
    cancelled: 'cancelled',
  };
  return aliases[normalized] || normalized;
}

function testPlaceholders(orderId, testCount) {
  const safeCount = Math.max(0, Number.parseInt(testCount, 10) || 0);
  return Array.from({ length: safeCount }, (_, index) => ({
    id: `${orderId}-test-${index + 1}`,
    test: {
      id: `${orderId}-test-${index + 1}`,
      name: safeCount === 1 ? 'Ordered test' : `Ordered test ${index + 1}`,
    },
    result: null,
  }));
}

function adaptV2LabOrder(item = {}) {
  const patientCode = item.patient_code || '';
  const orderNumber = item.order_number || String(item.id || '').slice(0, 8).toUpperCase();
  const patientName = item.patient_display_name || item.patient_name || patientCode || 'Unknown patient';
  const status = mapOrderStatusFromV2(item.status);

  return {
    ...item,
    v2_status: item.status,
    status,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_mrn: patientCode,
    patient_name: patientName,
    patient_details: {
      id: item.patient_id,
      medical_record_number: patientCode,
      user_details: {
        full_name: patientName,
      },
    },
    order_number: orderNumber,
    created_at: item.ordered_at,
    ordered_at: item.ordered_at,
    tests_count: item.test_count ?? 0,
    order_tests: item.order_tests || testPlaceholders(item.id, item.test_count),
    specimens: Array.isArray(item.specimens)
      ? item.specimens.map(adaptV2LabSpecimen)
      : [],
  };
}

function adaptV2LabResult(item = {}) {
  const patientCode = item.patient_code || '';
  const orderNumber = item.order_number || String(item.order_id || '').slice(0, 8).toUpperCase();
  const patientName = item.patient_display_name || item.patient_name || patientCode || 'Unknown patient';
  const isVerified = Boolean(item.verified_at) || item.status === 'verified';

  return {
    ...item,
    order: item.order_id,
    specimen: item.specimen_id,
    patient: item.patient_id,
    patient_mrn: patientCode,
    patient_name: patientName,
    order_number: orderNumber,
    test_name: item.test_name,
    is_verified: isVerified,
    patient_details: {
      id: item.patient_id,
      medical_record_number: patientCode,
      user_details: {
        full_name: patientName,
      },
    },
    test_details: {
      id: item.test_id,
      name: item.test_name,
    },
    order_test: {
      order: item.order_id,
      test: item.test_id,
    },
  };
}

function adaptV2PaginatedResponse(scope, response, params = {}, adapter) {
  const limit = Number(response?.page?.limit || normalizeV2Limit(params));
  const resolvedPage = resolveCursorPage(scope, params);
  const currentPage = resolvedPage.page;
  const results = Array.isArray(response?.data) ? response.data.map(adapter) : [];
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const estimatedTotal = ((currentPage - 1) * limit) + results.length + (hasNext ? 1 : 0);

  cacheCursorForNextPage(scope, params, response);

  return {
    count: estimatedTotal,
    total: estimatedTotal,
    count_exact: !hasNext,
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

function buildV2LabOrderQuery(params = {}) {
  const query = { limit: normalizeV2Limit(params) };
  const cursor = getCursorForParams('orders', params);
  const status = mapOrderStatusToV2(params.status);
  if (cursor) query.cursor = cursor;
  if (status) query.status = status;
  if (params.search) query.search = String(params.search).trim();
  if (params.priority) query.priority = params.priority;
  if (params.ordering_provider) query.ordering_provider = params.ordering_provider;
  if (params.my_orders !== undefined && params.my_orders !== null) {
    query.my_orders = params.my_orders === true || params.my_orders === 'true';
  }
  return query;
}

function buildV2LabResultQuery(params = {}) {
  const query = { limit: normalizeV2Limit(params) };
  const cursor = getCursorForParams('results', params);
  if (cursor) query.cursor = cursor;
  if (params.status) query.status = params.status;
  if (params.is_verified !== undefined && params.is_verified !== null) {
    query.is_verified = params.is_verified;
  }
  if (params.search) query.search = String(params.search).trim();
  if (params.critical_only !== undefined && params.critical_only !== null) {
    query.critical_only = params.critical_only === true || params.critical_only === 'true';
  }
  return query;
}

function buildV2LabSpecimenQuery(params = {}) {
  const query = { limit: normalizeV2Limit(params) };
  const cursor = getCursorForParams('specimens', params);
  if (cursor) query.cursor = cursor;
  return query;
}

function buildV2LabCatalogQuery(scope, params = {}) {
  const query = { limit: normalizeV2Limit(params, 24) };
  const cursor = getCursorForParams(scope, params);
  if (cursor) query.cursor = cursor;
  if (params.search) query.search = String(params.search).trim();
  if (params.category && params.category !== 'all') query.category = params.category;
  if (params.is_active !== undefined && params.is_active !== null) {
    query.is_active = params.is_active === true || params.is_active === 'true';
  }
  if (params.is_system_default !== undefined && params.is_system_default !== null) {
    query.is_system_default = params.is_system_default === true || params.is_system_default === 'true';
  }
  if (params.is_facility_modified !== undefined && params.is_facility_modified !== null) {
    query.is_facility_modified = params.is_facility_modified === true || params.is_facility_modified === 'true';
  }
  return query;
}

async function requestV2LabOrders(params = {}, options = {}) {
  const query = buildV2LabOrderQuery(params);
  if (query.search) {
    return v2Request({
      method: 'POST',
      path: '/api/v2/laboratory/orders/search',
      body: query,
      signal: options.signal,
    });
  }
  return v2Api.getLaboratoryOrders({
    query,
    signal: options.signal,
  });
}

async function requestV2LabResults(params = {}, options = {}) {
  const query = buildV2LabResultQuery(params);
  if (query.search) {
    return v2Request({
      method: 'POST',
      path: '/api/v2/laboratory/results/search',
      body: query,
      signal: options.signal,
    });
  }
  return v2Api.getLaboratoryResults({
    query,
    signal: options.signal,
  });
}

function pickEntityId(value) {
  if (value && typeof value === 'object') {
    return value.id || value.value || null;
  }
  return value || null;
}

function pickEntityIds(value) {
  const items = Array.isArray(value) ? value : [];
  return items.flatMap((item) => {
    const id = pickEntityId(item);
    return id ? [id] : [];
  });
}

function rustV2Unsupported(contractName) {
  return Promise.reject(new Error(`${contractName} is unavailable in Rust V2 mode.`));
}

function v2Object(response, adapter = (item) => item) {
  return adapter(response?.data || {});
}

function adaptV2LabSpecimen(item = {}) {
  return {
    ...item,
    order: item.order_id,
    patient: item.patient_id,
    patient_mrn: item.patient_code,
    collected_date: item.collected_at,
  };
}

function buildV2LabOrderPayload(data = {}) {
  return {
    patient_id: pickEntityId(data.patient_id ?? data.patient),
    encounter_id: pickEntityId(data.encounter_id ?? data.encounter) || undefined,
    visit_id: pickEntityId(data.visit_id ?? data.visit) || undefined,
    test_ids: pickEntityIds(data.test_ids ?? data.tests),
    panel_ids: pickEntityIds(data.panel_ids ?? data.panels),
    priority: data.priority || 'routine',
  };
}

function buildV2SpecimenPayload(data = {}) {
  return {
    order_id: pickEntityId(data.order_id ?? data.order),
    specimen_type: data.specimen_type || data.type || 'sample',
  };
}

function buildV2LabResultPayload(data = {}) {
  return {
    specimen_id: pickEntityId(data.specimen_id ?? data.specimen),
    test_id: pickEntityId(data.test_id ?? data.test),
    value: String(data.value ?? data.result_value ?? ''),
    unit: data.unit ?? null,
  };
}

function buildV2BulkLabResultsPayload(data = {}) {
  return {
    order_id: pickEntityId(data.order_id ?? data.order),
    specimen_id: pickEntityId(data.specimen_id ?? data.specimen),
    results: (data.results || []).map((item = {}) => {
      const orderTestId = pickEntityId(item.order_test_id ?? item.order_test ?? item.test);
      return {
        order_test_id: orderTestId,
        test_id: pickEntityId(item.test_id ?? item.test) || orderTestId,
        value: String(item.value ?? item.result_value ?? ''),
        unit: item.unit ?? null,
      };
    }),
  };
}

export const laboratoryApi = {
  // ========== Lab Tests ==========

  /**
   * Get all lab tests with optional filtering
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} List of lab tests
   */
  getLabTests: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getLaboratoryTestCatalog({
          query: buildV2LabCatalogQuery('test-catalog', params),
          signal: options.signal,
        });
        return adaptV2PaginatedResponse('test-catalog', response, params, (item) => item);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/tests/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab tests');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab tests'));
    }
  },

  getLabTest: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getLaboratoryTestCatalogById({ id }, {
          signal: options.signal,
        });
        return v2Object(response);
      }

      return await apiClient.get(`/laboratory/tests/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab test');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab test'));
    }
  },

  /**
   * Create a custom lab test
   * @param {Object} data - Test data
   * @returns {Promise<Object>} Created test
   */
  createLabTest: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory catalog mutation contract');
      }

      return await apiClient.post('/laboratory/tests/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create lab test'));
    }
  },

  /**
   * Update a lab test
   * @param {string} id - Test ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated test
   */
  updateLabTest: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory catalog mutation contract');
      }

      return await apiClient.patch(`/laboratory/tests/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update lab test'));
    }
  },

  /**
   * Customize a lab test's facility-specific values
   * @param {string} id - Test ID
   * @param {Object} data - Customization data (price, reference_ranges, tat_hours, is_active)
   * @returns {Promise<Object>} Updated test
   */
  customizeLabTest: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory catalog mutation contract');
      }

      return await apiClient.post(`/laboratory/tests/${id}/customize/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to customize lab test'));
    }
  },

  /**
   * Reset a lab test to system defaults
   * @param {string} id - Test ID
   * @returns {Promise<Object>} Reset test
   */
  resetLabTestToDefaults: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory catalog mutation contract');
      }

      return await apiClient.post(`/laboratory/tests/${id}/reset_to_defaults/`, { confirm: true });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to reset lab test'));
    }
  },

  /**
   * Delete a custom lab test (only works for non-system tests)
   * @param {string} id - Test ID
   * @returns {Promise<void>}
   */
  deleteLabTest: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory catalog mutation contract');
      }

      return await apiClient.delete(`/laboratory/tests/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete lab test'));
    }
  },

  // ========== Lab Panels ==========

  getLabPanels: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getLaboratoryPanels({
          query: buildV2LabCatalogQuery('panels', params),
          signal: options.signal,
        });
        return adaptV2PaginatedResponse('panels', response, params, (item) => item);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/panels/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab panels');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab panels'));
    }
  },

  getLabPanel: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getLaboratoryPanelById({ id }, {
          signal: options.signal,
        });
        return v2Object(response);
      }

      return await apiClient.get(`/laboratory/panels/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab panel');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab panel'));
    }
  },

  /**
   * Create a custom lab panel
   * @param {Object} data - Panel data
   * @returns {Promise<Object>} Created panel
   */
  createLabPanel: async (data) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory panel mutation contract');
      }

      return await apiClient.post('/laboratory/panels/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create lab panel'));
    }
  },

  /**
   * Update a lab panel
   * @param {string} id - Panel ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated panel
   */
  updateLabPanel: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory panel mutation contract');
      }

      return await apiClient.patch(`/laboratory/panels/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update lab panel'));
    }
  },

  /**
   * Customize a lab panel's facility-specific values
   * @param {string} id - Panel ID
   * @param {Object} data - Customization data (price, is_active)
   * @returns {Promise<Object>} Updated panel
   */
  customizeLabPanel: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory panel mutation contract');
      }

      return await apiClient.post(`/laboratory/panels/${id}/customize/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to customize lab panel'));
    }
  },

  /**
   * Reset a lab panel to system defaults
   * @param {string} id - Panel ID
   * @returns {Promise<Object>} Reset panel
   */
  resetLabPanelToDefaults: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory panel mutation contract');
      }

      return await apiClient.post(`/laboratory/panels/${id}/reset_to_defaults/`, { confirm: true });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to reset lab panel'));
    }
  },

  /**
   * Delete a custom lab panel (only works for non-system panels)
   * @param {string} id - Panel ID
   * @returns {Promise<void>}
   */
  deleteLabPanel: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory panel mutation contract');
      }

      return await apiClient.delete(`/laboratory/panels/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete lab panel'));
    }
  },

  // ========== Lab Orders ==========

  getLabOrders: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await requestV2LabOrders(params, options);
        return adaptV2PaginatedResponse('orders', response, params, adaptV2LabOrder);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/orders/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab orders');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab orders'));
    }
  },

  getLabOrdersPaginated: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await requestV2LabOrders(params, options);
        return adaptV2PaginatedResponse('orders', response, params, adaptV2LabOrder);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/orders/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab orders');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab orders'));
    }
  },

  getLabOrder: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getLaboratoryOrderById({ id }, {
          signal: options.signal,
        });
        return v2Object(response, adaptV2LabOrder);
      }

      return await apiClient.get(`/laboratory/orders/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab order');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab order'));
    }
  },

  createLabOrder: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryOrders(
          buildV2LabOrderPayload(data),
          { signal: options.signal || data?.signal },
        );
        return v2Object(response, adaptV2LabOrder);
      }

      return await apiClient.post('/laboratory/orders/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create lab order');
      }
      throw new Error(handleApiError(error, 'Failed to create lab order'));
    }
  },

  updateLabOrder: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory order mutation contract');
      }

      return await apiClient.patch(`/laboratory/orders/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update lab order'));
    }
  },

  submitLabOrder: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryOrderSubmit({ id }, {
          signal: options.signal,
        });
        return v2Object(response, adaptV2LabOrder);
      }

      return await apiClient.post(`/laboratory/orders/${id}/submit/`, {});
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to submit lab order');
      }
      throw new Error(handleApiError(error, 'Failed to submit lab order'));
    }
  },

  collectLabOrder: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryOrderCollect({ id }, {
          signal: options.signal,
        });
        return v2Object(response, adaptV2LabOrder);
      }

      return await apiClient.post(`/laboratory/orders/${id}/collect/`, {});
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to mark order as collected');
      }
      throw new Error(handleApiError(error, 'Failed to mark order as collected'));
    }
  },

  receiveLabOrder: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory order status contract');
      }

      return await apiClient.post(`/laboratory/orders/${id}/receive/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to receive order'));
    }
  },

  startProcessingLabOrder: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryOrderStartProcessing({ id }, {
          signal: options.signal,
        });
        return v2Object(response, adaptV2LabOrder);
      }

      return await apiClient.post(`/laboratory/orders/${id}/start_processing/`, {});
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to start processing');
      }
      throw new Error(handleApiError(error, 'Failed to start processing'));
    }
  },

  completeLabOrder: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        return rustV2Unsupported('/api/v2 laboratory order status contract');
      }

      return await apiClient.post(`/laboratory/orders/${id}/complete/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to complete order'));
    }
  },

  cancelLabOrder: async (id, cancellationReason, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryOrderCancel(
          { id },
          { cancellation_reason: cancellationReason || null },
          { signal: options.signal },
        );
        return v2Object(response, adaptV2LabOrder);
      }

      return await apiClient.post(`/laboratory/orders/${id}/cancel/`, {
        cancellation_reason: cancellationReason,
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to cancel order');
      }
      throw new Error(handleApiError(error, 'Failed to cancel order'));
    }
  },

  // ========== Lab Specimens ==========

  getLabSpecimens: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getLaboratorySpecimens({
          query: buildV2LabSpecimenQuery(params),
          signal: options.signal,
        });
        return adaptV2PaginatedResponse('specimens', response, params, adaptV2LabSpecimen);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/specimens/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch specimens');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch specimens'));
    }
  },

  getLabSpecimen: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getLaboratorySpecimenById({ id }, {
          signal: options.signal,
        });
        return v2Object(response, adaptV2LabSpecimen);
      }

      return await apiClient.get(`/laboratory/specimens/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch specimen');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch specimen'));
    }
  },

  createLabSpecimen: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratorySpecimens(
          buildV2SpecimenPayload(data),
          { signal: options.signal || data?.signal },
        );
        return v2Object(response, adaptV2LabSpecimen);
      }

      return await apiClient.post('/laboratory/specimens/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create specimen');
      }
      throw new Error(handleApiError(error, 'Failed to create specimen'));
    }
  },

  receiveLabSpecimen: async (id, data = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratorySpecimenReceive({ id }, {
          signal: options.signal || data?.signal,
        });
        return v2Object(response, adaptV2LabSpecimen);
      }

      return await apiClient.post(`/laboratory/specimens/${id}/receive/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to receive specimen');
      }
      throw new Error(handleApiError(error, 'Failed to receive specimen'));
    }
  },

  // ========== Lab Results ==========

  getLabResults: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await requestV2LabResults(params, options);
        return adaptV2PaginatedResponse('results', response, params, adaptV2LabResult);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/results/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab results');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab results'));
    }
  },

  getLabResultsPaginated: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await requestV2LabResults(params, options);
        return adaptV2PaginatedResponse('results', response, params, adaptV2LabResult);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/laboratory/results/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab results');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab results'));
    }
  },

  getLabResult: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getLaboratoryResultById({ id }, {
          signal: options.signal,
        });
        return v2Object(response, adaptV2LabResult);
      }

      return await apiClient.get(`/laboratory/results/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch lab result');
      }
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch lab result'));
    }
  },

  createLabResult: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryResults(
          buildV2LabResultPayload(data),
          { signal: options.signal || data?.signal },
        );
        return v2Object(response, adaptV2LabResult);
      }

      return await apiClient.post('/laboratory/results/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create lab result');
      }
      throw new Error(handleApiError(error, 'Failed to create lab result'));
    }
  },

  verifyLabResult: async (id, verificationNotes = '', options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryResultVerify({ id }, {
          signal: options.signal,
        });
        return v2Object(response, adaptV2LabResult);
      }

      return await apiClient.post(`/laboratory/results/${id}/verify/`, {
        verification_notes: verificationNotes,
      });
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to verify result');
      }
      throw new Error(handleApiError(error, 'Failed to verify result'));
    }
  },

  /**
   * Create multiple lab results in bulk
   * @param {Object} data - Bulk result data
   * @param {string} data.order_id - Lab order ID
   * @param {string} data.specimen_id - Specimen ID
   * @param {Array} data.results - Array of result items
   * @returns {Promise<Object>} Created results response
   */
  bulkCreateResults: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryResultBulkCreate(
          buildV2BulkLabResultsPayload(data),
          { signal: options.signal || data?.signal },
        );
        return response?.data || {};
      }

      return await apiClient.post('/laboratory/results/bulk/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to save lab results');
      }
      throw new Error(handleApiError(error, 'Failed to save lab results'));
    }
  },

  /**
   * Verify multiple lab results in bulk
   * @param {Object} data - Bulk verify data
   * @param {Array} data.result_ids - Array of result IDs to verify (optional if order_id provided)
   * @param {string} data.order_id - Order ID to verify all results (optional if result_ids provided)
   * @param {string} data.verification_notes - Optional notes
   * @returns {Promise<Object>} Verification response
   */
  bulkVerifyResults: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postLaboratoryResultBulkVerify({
          order_id: pickEntityId(data?.order_id ?? data?.order) || null,
          result_ids: pickEntityIds(data?.result_ids ?? data?.results),
          verification_notes: data?.verification_notes || null,
        }, {
          signal: options.signal || data?.signal,
        });
        return response?.data || {};
      }

      return await apiClient.post('/laboratory/results/bulk-verify/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to verify lab results');
      }
      throw new Error(handleApiError(error, 'Failed to verify lab results'));
    }
  },
};
