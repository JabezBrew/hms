import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

const patientCursorCache = new Map();

function hashForCache(value) {
  let hash = 0;
  const input = JSON.stringify(value);
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}

function cursorCacheKey(params = {}) {
  const scope = { ...(params || {}) };
  delete scope.page;
  delete scope.cursor;
  delete scope.next_cursor;
  return hashForCache(scope);
}

function cacheCursorForNextPage(params, response) {
  const currentPage = Number(params?.page || 1);
  const nextCursor = response?.page?.next_cursor;
  if (!nextCursor) {
    return;
  }
  patientCursorCache.set(`${cursorCacheKey(params)}:${currentPage + 1}`, nextCursor);
}

function getCursorForParams(params = {}) {
  if (params.cursor || params.next_cursor) {
    return params.cursor || params.next_cursor;
  }
  const page = Number(params.page || 1);
  if (page <= 1) {
    return undefined;
  }
  return patientCursorCache.get(`${cursorCacheKey(params)}:${page}`);
}

function birthYearToDate(value) {
  if (!value) {
    return null;
  }
  return `${String(value).padStart(4, '0')}-01-01`;
}

function adaptV2PatientListItem(patient) {
  return {
    id: patient.id,
    created_at: patient.created_at,
    medical_record_number: patient.patient_code,
    name: patient.display_name,
    date_of_birth: birthYearToDate(patient.birth_year),
    gender: patient.sex,
    patient_location: null,
    active_clinic_names: [],
    registry_status: patient.status,
  };
}

function adaptV2PatientDetail(patient) {
  if (!patient) {
    return patient;
  }
  return {
    id: patient.id,
    medical_record_number: patient.patient_code,
    mrn: patient.patient_code,
    first_name: patient.first_name,
    last_name: patient.last_name,
    name: patient.display_name,
    date_of_birth: patient.date_of_birth,
    gender: patient.sex,
    registry_status: patient.status,
    created_at: patient.created_at,
    updated_at: patient.updated_at,
    local_data: {
      id: patient.id,
      medical_record_number: patient.patient_code,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      gender: patient.sex,
    },
  };
}

function adaptV2PatientListResponse(response, params = {}) {
  const limit = Number(response?.page?.limit || params.page_size || params.limit || 25);
  const currentPage = Number(params.page || 1);
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptV2PatientListItem)
    : [];
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const estimatedTotal = ((currentPage - 1) * limit) + results.length + (hasNext ? 1 : 0);

  cacheCursorForNextPage(params, response);

  return {
    results,
    page: currentPage,
    page_size: limit,
    count: estimatedTotal,
    total: estimatedTotal,
    count_exact: false,
    next: hasNext ? response.page.next_cursor : null,
    previous: currentPage > 1 ? String(currentPage - 1) : null,
    next_cursor: response?.page?.next_cursor || null,
  };
}

function getV2PatientListQuery(params = {}) {
  const limit = Number(params.page_size || params.limit || 25);
  const query = {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25,
  };
  const search = typeof params === 'string' ? params : (params.query || params.search);
  if (search) {
    query.search = search;
  }
  const cursor = getCursorForParams(params);
  if (cursor) {
    query.cursor = cursor;
  }
  return query;
}

/**
 * Patients API service
 */
export const patientsApi = {
  /**
   * Get all patients with optional filtering
   * Returns most recently registered patients first with pagination
   * @param {Object} params - Query parameters for filtering (page, page_size, etc.)
   * @returns {Promise<Object>} Paginated list of patients
   */
  getPatients: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatients({ query: getV2PatientListQuery(params) });
        return adaptV2PatientListResponse(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/users/patients/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch patients'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch patients'));
    }
  },

  /**
   * Get a single patient by ID (includes FHIR data)
   * @param {string} id - Patient ID
   * @returns {Promise<Object>} Patient data with local_data and fhir_data
   */
  getPatient: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientById({ id });
        return adaptV2PatientDetail(response?.data);
      }
      return await apiClient.get(`/patients/${id}/get_patient/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch patient'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch patient'));
    }
  },

  /**
   * Get patient demographics only (lightweight, no FHIR)
   * @param {string} id - Patient ID
   * @returns {Promise<Object>} Patient demographics data
   */
  getPatientDemographics: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientById({ id });
        return adaptV2PatientDetail(response?.data);
      }
      return await apiClient.get(`/patients/${id}/demographics/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch patient demographics'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch patient demographics'));
    }
  },

  /**
   * Create a new patient
   * @param {Object} data - Patient data
   * @returns {Promise<Object>} Created patient data
   */
  createPatient: async (data) => {
    try {
      return await apiClient.post('/patients/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create patient'));
    }
  },

  /**
   * Update a patient's demographics
   * @param {string} id - Patient ID
   * @param {Object} data - Patient data to update (wrap in local_data for backend)
   * @returns {Promise<Object>} Updated patient data
   */
  updatePatient: async (id, data) => {
    try {
      return await apiClient.put(`/patients/${id}/update_patient/`, { local_data: data });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update patient'));
    }
  },

  /**
   * Delete a patient
   * @param {string} id - Patient ID
   * @returns {Promise<void>}
   */
  deletePatient: async (id) => {
    try {
      return await apiClient.delete(`/patients/${id}/delete_patient/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete patient'));
    }
  },

  /**
   * Get patient medical history
   * @param {string} id - Patient ID
   * @returns {Promise<Array>} Medical history data
   */
  getPatientHistory: async (id) => {
    try {
      return await apiClient.get(`/patients/${id}/history/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch patient history'));
    }
  },

  /**
   * Search patients
   * @param {string} query - Search query
   * @returns {Promise<Array>} List of matching patients
   */
  searchPatients: async (params, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const queryParams = typeof params === 'string' ? { query: params } : params;
        const response = await v2Api.getPatients({
          query: getV2PatientListQuery(queryParams),
          signal: options.signal,
        });
        return adaptV2PatientListResponse(response, queryParams).results;
      }

      // Handle both string (legacy) and object params
      const queryParams = typeof params === 'string' ? { query: params } : params;
      const queryString = new URLSearchParams(queryParams).toString();
      const endpoint = `/patients/search/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint, options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to search patients'));
      }
      throw new Error(handleApiError(error, 'Failed to search patients'));
    }
  },

  /**
   * Search patients and preserve pagination metadata.
   * @param {Object|string} params - Search parameters
   * @returns {Promise<Object>} Search response with results + paging metadata
   */
  searchPatientsWithMeta: async (params, options = {}) => {
    try {
      const queryParams = typeof params === 'string' ? { query: params } : params;
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatients({
          query: getV2PatientListQuery(queryParams),
          signal: options.signal,
        });
        return adaptV2PatientListResponse(response, queryParams);
      }

      const queryString = new URLSearchParams(queryParams).toString();
      const endpoint = `/patients/search/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to search patients'));
      }
      throw new Error(handleApiError(error, 'Failed to search patients'));
    }
  },

  /**
   * Get recent patients
   * @param {Object} params - Query parameters
   * @param {number} params.limit - Maximum number of results (default: 10, max: 20)
   * @returns {Promise<Array>} List of recent patients
   */
  getRecentPatients: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/patients/recent/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch recent patients'));
    }
  },

  /**
   * Request break-glass access for a patient
   * @param {string} id - Patient ID
   * @param {Object} data - Break-glass payload (reason, scope)
   * @returns {Promise<Object>} Break-glass response
   */
  requestBreakGlass: async (id, data) => {
    return apiClient.post(`/patients/${id}/break-glass/`, data);
  },

  /**
   * Get context-specific patients based on user role
   * Returns ward patients for nurses, appointments for doctors, etc.
   * @param {Object} params - Query parameters (e.g., ward for nurses)
   * @returns {Promise<Object>} Context patients with metadata
   */
  getContextPatients: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/dashboards/my-context-patients/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch context patients'));
    }
  },

  /**
   * Register a new patient
   * @param {Object} data - Patient registration data
   * @returns {Promise<Object>} Registered patient data
   */
  registerPatient: async (data) => {
    try {
      return await apiClient.post('/patients/register/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to register patient'));
    }
  },

  /**
   * Update a patient with FHIR data
   * @param {string} id - Patient ID
   * @param {Object} data - Patient data with FHIR information
   * @returns {Promise<Object>} Updated patient data
   */
  updatePatientWithFHIR: async (id, data) => {
    try {
      return await apiClient.put(`/patients/${id}/update_patient/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update patient'));
    }
  },

  /**
   * Get patient registration validation rules
   * @returns {Promise<Array>} Validation rules
   */
  getValidationRules: async () => {
    try {
      return await apiClient.get('/patients/validation-rules/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch validation rules'));
    }
  },
};
