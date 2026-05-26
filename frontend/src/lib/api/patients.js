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

function adaptV2PatientListAdmission(admission) {
  if (!admission) {
    return null;
  }
  return {
    ...admission,
    id: admission.admission_id || admission.id,
    admission_id: admission.admission_id || admission.id,
    ward_name: admission.ward_name || null,
    bed_code: admission.bed_code || admission.bed_number || null,
    bed_number: admission.bed_number || admission.bed_code || null,
  };
}

function adaptV2PatientListItem(patient) {
  const activeAdmission = adaptV2PatientListAdmission(
    patient.active_admission || patient.active_context?.admission,
  );
  const wardName = patient.ward_name || patient.current_ward || activeAdmission?.ward_name || null;
  const bedCode = patient.bed_code || patient.bed_number || patient.current_bed || activeAdmission?.bed_code || null;

  return {
    id: patient.id,
    created_at: patient.created_at,
    medical_record_number: patient.patient_code,
    name: patient.display_name,
    date_of_birth: birthYearToDate(patient.birth_year),
    gender: patient.sex,
    patient_location: patient.patient_location || null,
    active_clinic_names: Array.isArray(patient.active_clinic_names) ? patient.active_clinic_names : [],
    active_admission: activeAdmission,
    ward_name: wardName,
    bed_code: bedCode,
    current_ward: wardName,
    current_bed: bedCode,
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
  const knownResultCount = ((currentPage - 1) * limit) + results.length;

  cacheCursorForNextPage(params, response);

  return {
    results,
    page: currentPage,
    page_size: limit,
    count: knownResultCount,
    total: knownResultCount,
    count_exact: !hasNext,
    total_is_lower_bound: hasNext,
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
  const status = normalizePatientStatus(params.status || params.registry_scope);
  if (status) {
    query.status = status;
  }
  const cursor = getCursorForParams(params);
  if (cursor) {
    query.cursor = cursor;
  }
  return query;
}

function compactDefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

function normalizeDateOnly(value) {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 10) : undefined;
}

function normalizePatientSex(value) {
  if (!value) {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['female', 'f'].includes(normalized)) {
    return 'female';
  }
  if (['male', 'm'].includes(normalized)) {
    return 'male';
  }
  if (['other', 'unknown'].includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function normalizePatientStatus(value) {
  if (!value) {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['active', 'inactive', 'deceased'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'admitted' || normalized === 'registered') {
    return 'active';
  }
  if (normalized === 'discharged') {
    return 'inactive';
  }
  return undefined;
}

function pickPatientPayloadSource(data = {}) {
  const localData = data?.local_data || {};
  return {
    ...(localData.user_details || {}),
    ...(localData.user || {}),
    ...localData,
    ...data,
  };
}

function normalizeCreatePatientPayload(data = {}) {
  const source = pickPatientPayloadSource(data);
  const payload = {
    first_name: String(source.first_name || '').trim(),
    last_name: String(source.last_name || '').trim(),
    date_of_birth: normalizeDateOnly(source.date_of_birth || source.birth_date),
    sex: normalizePatientSex(source.sex || source.gender) || 'unknown',
  };

  if (!payload.first_name || !payload.last_name || !payload.date_of_birth) {
    throw new Error('First name, last name, and date of birth are required to register a patient in Rust V2');
  }

  return payload;
}

function normalizeUpdatePatientPayload(data = {}) {
  const source = pickPatientPayloadSource(data);
  return compactDefined({
    first_name: source.first_name ? String(source.first_name).trim() : undefined,
    last_name: source.last_name ? String(source.last_name).trim() : undefined,
    date_of_birth: normalizeDateOnly(source.date_of_birth || source.birth_date),
    sex: normalizePatientSex(source.sex || source.gender),
    status: normalizePatientStatus(source.status || source.registry_status),
  });
}

function adaptV2PatientContextListItem(patient) {
  return {
    id: patient.id,
    updated_at: patient.updated_at,
    created_at: patient.updated_at,
    medical_record_number: patient.patient_code,
    name: patient.display_name,
    date_of_birth: birthYearToDate(patient.birth_year),
    gender: patient.sex,
    patient_location: null,
    active_clinic_names: [],
    registry_status: patient.status,
    context_kind: patient.context_kind,
  };
}

function adaptV2ContextPatientsResponse(response, params = {}) {
  const limit = Number(response?.page?.limit || params.limit || 10);
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptV2PatientContextListItem)
    : [];
  return {
    results,
    count: results.length + (response?.page?.has_next ? 1 : 0),
    next: response?.page?.next_cursor || null,
    previous: null,
    next_cursor: response?.page?.next_cursor || null,
    page_size: limit,
  };
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
  getPatients: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatients({
          query: getV2PatientListQuery(params),
          signal: options.signal,
        });
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
  getPatient: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientById({ id }, { signal: options.signal });
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
  getPatientDemographics: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientById({ id }, { signal: options.signal });
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
  createPatient: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postPatients(
          normalizeCreatePatientPayload(data),
          { signal: options.signal },
        );
        return adaptV2PatientDetail(response?.data);
      }
      return await apiClient.post('/patients/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create patient'));
      }
      throw new Error(handleApiError(error, 'Failed to create patient'));
    }
  },

  /**
   * Update a patient's demographics
   * @param {string} id - Patient ID
   * @param {Object} data - Patient data to update (wrap in local_data for backend)
   * @returns {Promise<Object>} Updated patient data
   */
  updatePatient: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchPatientById(
          { id },
          normalizeUpdatePatientPayload(data),
          { signal: options.signal },
        );
        return adaptV2PatientDetail(response?.data);
      }
      return await apiClient.put(`/patients/${id}/update_patient/`, { local_data: data });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update patient'));
      }
      throw new Error(handleApiError(error, 'Failed to update patient'));
    }
  },

  /**
   * Delete a patient
   * @param {string} id - Patient ID
   * @returns {Promise<void>}
   */
  deletePatient: async (id) => {
    if (isRustV2ApiMode()) {
      throw new Error('Patient deletion is not supported by Rust V2');
    }
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
  getPatientHistory: async (id, _options = {}) => {
    if (isRustV2ApiMode()) {
      return [];
    }
    try {
      return await apiClient.get(`/patients/${id}/history/`);
    } catch (error) {
      rethrowAbortError(error);
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
  getRecentPatients: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const limit = Math.min(Math.max(Number(params.limit || 10), 1), 20);
        const response = await v2Api.getPatients({
          query: { limit },
          signal: options.signal,
        });
        return adaptV2PatientListResponse(response, { limit }).results;
      }
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/patients/recent/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch recent patients'));
      }
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
    if (isRustV2ApiMode()) {
      throw new Error('Break-glass access is not supported by Rust V2');
    }
    return apiClient.post(`/patients/${id}/break-glass/`, data);
  },

  /**
   * Get context-specific patients based on user role
   * Returns ward patients for nurses, appointments for doctors, etc.
   * @param {Object} params - Query parameters (e.g., ward for nurses)
   * @returns {Promise<Object>} Context patients with metadata
   */
  getContextPatients: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientContextList({
          query: getV2PatientListQuery({ limit: 10, ...params }),
          signal: options.signal,
        });
        return adaptV2ContextPatientsResponse(response, params);
      }
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/dashboards/my-context-patients/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch context patients'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch context patients'));
    }
  },

  /**
   * Register a new patient
   * @param {Object} data - Patient registration data
   * @returns {Promise<Object>} Registered patient data
   */
  registerPatient: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postPatients(
          normalizeCreatePatientPayload(data),
          { signal: options.signal },
        );
        return adaptV2PatientDetail(response?.data);
      }
      return await apiClient.post('/patients/register/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to register patient'));
      }
      throw new Error(handleApiError(error, 'Failed to register patient'));
    }
  },

  /**
   * Update a patient with FHIR data
   * @param {string} id - Patient ID
   * @param {Object} data - Patient data with FHIR information
   * @returns {Promise<Object>} Updated patient data
   */
  updatePatientWithFHIR: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchPatientById(
          { id },
          normalizeUpdatePatientPayload(data),
          { signal: options.signal },
        );
        return adaptV2PatientDetail(response?.data);
      }
      return await apiClient.put(`/patients/${id}/update_patient/`, data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update patient'));
      }
      throw new Error(handleApiError(error, 'Failed to update patient'));
    }
  },

  /**
   * Get patient registration validation rules
   * @returns {Promise<Array>} Validation rules
   */
  getValidationRules: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientValidationRules({ signal: options.signal });
        return Array.isArray(response?.data) ? response.data : [];
      }
      return await apiClient.get('/patients/validation-rules/');
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch validation rules'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch validation rules'));
    }
  },
};
