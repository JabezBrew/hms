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

function hasQueryValue(value) {
  return value !== undefined && value !== null && value !== '';
}

const patientCursorCache = new Map();
const PATIENT_ORDERING_FIELDS = {
  created_at: 'created_at',
  registered_at: 'created_at',
  medical_record_number: 'patient_code',
  mrn: 'patient_code',
  patient_code: 'patient_code',
  name: 'display_name',
  display_name: 'display_name',
  date_of_birth: 'date_of_birth',
  birth_year: 'date_of_birth',
  gender: 'sex',
  sex: 'sex',
  registry_status: 'status',
  status: 'status',
};

function cacheCursorForNextPage(params, response) {
  cacheScopedCursorForNextPage(patientCursorCache, 'patients', params, response);
}

function resolvePatientCursorPage(params = {}) {
  return resolveScopedCursorPage(patientCursorCache, 'patients', params);
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
    date_of_birth: patient.date_of_birth || birthYearToDate(patient.birth_year),
    gender: patient.sex,
    patient_location: patient.patient_location || null,
    active_clinic_names: Array.isArray(patient.active_clinic_names) ? patient.active_clinic_names : [],
    active_admission: activeAdmission,
    ward_name: wardName,
    bed_code: bedCode,
    current_ward: wardName,
    current_bed: bedCode,
    registry_status: patient.record_status || patient.status,
    legacy_status: patient.status,
    record_status: patient.record_status || patient.status,
    vital_status: patient.vital_status || 'unknown',
    superseded_by_patient_id: patient.superseded_by_patient_id || null,
    record_status_reason_code: patient.record_status_reason_code || null,
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
    registry_status: patient.record_status || patient.status,
    legacy_status: patient.status,
    record_status: patient.record_status || patient.status,
    vital_status: patient.vital_status || 'unknown',
    superseded_by_patient_id: patient.superseded_by_patient_id || null,
    record_status_reason_code: patient.record_status_reason_code || null,
    created_at: patient.created_at,
    updated_at: patient.updated_at,
    local_data: {
      id: patient.id,
      medical_record_number: patient.patient_code,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      gender: patient.sex,
      record_status: patient.record_status || patient.status,
      vital_status: patient.vital_status || 'unknown',
    },
  };
}

function adaptV2PatientListResponse(response, params = {}) {
  const limit = Number(response?.page?.limit || params.page_size || params.limit || 25);
  const resolvedPage = resolvePatientCursorPage(params);
  const currentPage = resolvedPage.page;
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptV2PatientListItem)
    : [];
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const knownResultCount = ((currentPage - 1) * limit) + results.length;
  const exactTotal = response?.meta?.count_exact === true
    ? Number(response?.meta?.total_count)
    : NaN;
  const hasExactTotal = Number.isFinite(exactTotal) && exactTotal >= 0;

  cacheCursorForNextPage(params, response);

  return {
    results,
    page: currentPage,
    current_page: currentPage,
    requested_page: resolvedPage.requestedPage ?? currentPage,
    resolved_page: currentPage,
    cursor_missing: Boolean(resolvedPage.cursorMissing),
    page_size: limit,
    count: hasExactTotal ? exactTotal : knownResultCount,
    total: hasExactTotal ? exactTotal : knownResultCount,
    count_exact: hasExactTotal || !hasNext,
    total_is_lower_bound: !hasExactTotal && hasNext,
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
  if (hasQueryValue(params.record_status)) {
    query.record_status = params.record_status;
  }
  if (hasQueryValue(params.vital_status)) {
    query.vital_status = params.vital_status;
  }
  applyLegacyRegistryStatusFilter(query, params.status || params.registry_scope);
  if (params.include_total === true || params.include_total === 'true') {
    query.include_total = true;
  }
  const ordering = normalizePatientOrdering(params.ordering || params.sort);
  if (ordering) {
    query.ordering = ordering;
  }
  if (hasQueryValue(params.patient_id)) {
    query.patient_id = params.patient_id;
  }
  if (hasQueryValue(params.admission_start)) {
    query.admission_start = params.admission_start;
  }
  if (hasQueryValue(params.admission_end)) {
    query.admission_end = params.admission_end;
  }
  const wardId = params.ward_id || params.ward;
  if (hasQueryValue(wardId)) {
    query.ward_id = wardId;
  }
  if (hasQueryValue(params.admission_status)) {
    query.admission_status = params.admission_status;
  }
  if (hasQueryValue(params.attending_id)) {
    query.attending_id = params.attending_id;
  }
  if (hasQueryValue(params.age_min)) {
    query.age_min = params.age_min;
  }
  if (hasQueryValue(params.age_max)) {
    query.age_max = params.age_max;
  }
  const { cursor } = resolvePatientCursorPage(params);
  if (cursor) {
    query.cursor = cursor;
  }
  return query;
}

async function requestV2PatientList(params = {}, options = {}) {
  const query = getV2PatientListQuery(params);
  if (query.search || query.patient_id) {
    return v2Request({
      method: 'POST',
      path: '/api/v2/patients/search',
      body: query,
      signal: options.signal,
    });
  }
  return v2Api.getPatients({
    query,
    signal: options.signal,
  });
}

function getV2PatientContextListQuery(params = {}) {
  const limit = Number(params.page_size || params.limit || 10);
  const query = {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 10,
  };
  const search = typeof params === 'string' ? params : (params.query || params.search);
  if (search) {
    query.search = search;
  }
  if (params.patient_id) {
    query.patient_id = params.patient_id;
  }
  const cursor = params.cursor || params.next_cursor;
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
  if (normalized === 'admitted' || normalized === 'registered' || normalized === 'discharged') {
    return 'active';
  }
  return undefined;
}

function applyLegacyRegistryStatusFilter(query, value) {
  if (!value) {
    return;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === 'all') {
    return;
  }

  if (normalized === 'deceased') {
    query.record_status = query.record_status || 'registered';
    query.vital_status = query.vital_status || 'deceased';
    return;
  }

  if (normalized === 'inactive' || normalized === 'restricted') {
    query.record_status = query.record_status || 'restricted';
    return;
  }

  if (normalized === 'entered_in_error') {
    query.record_status = query.record_status || 'entered_in_error';
    return;
  }

  if (normalized === 'superseded' || normalized === 'merged') {
    query.record_status = query.record_status || 'superseded';
    return;
  }

  if (normalized === 'discharged') {
    query.record_status = query.record_status || 'registered';
    query.admission_status = query.admission_status || 'discharged';
    return;
  }

  if (normalized === 'active') {
    query.record_status = query.record_status || 'registered';
    query.vital_status = query.vital_status || 'presumed_alive';
    return;
  }

  if (normalized === 'admitted' || normalized === 'registered') {
    query.record_status = query.record_status || 'registered';
  }
}

function normalizePatientOrdering(value) {
  if (!value) {
    return undefined;
  }
  const raw = String(value).trim();
  if (!raw) {
    return undefined;
  }
  const isDescending = raw.startsWith('-');
  const field = isDescending ? raw.slice(1) : raw;
  const normalizedField = PATIENT_ORDERING_FIELDS[field];
  if (!normalizedField) {
    return undefined;
  }
  return `${isDescending ? '-' : ''}${normalizedField}`;
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
  if (source.duplicate_review) {
    payload.duplicate_review = source.duplicate_review;
  }

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
    record_status: source.record_status,
    vital_status: source.vital_status,
    superseded_by_patient_id: source.superseded_by_patient_id,
    status_reason_code: source.status_reason_code,
    status_reason_note: source.status_reason_note,
  });
}

function adaptV2PatientContextListItem(patient) {
  return {
    id: patient.id,
    updated_at: patient.updated_at,
    created_at: patient.updated_at,
    medical_record_number: patient.patient_code,
    name: patient.display_name,
    date_of_birth: patient.date_of_birth || birthYearToDate(patient.birth_year),
    gender: patient.sex,
    patient_location: null,
    active_clinic_names: [],
    registry_status: patient.record_status || patient.status,
    legacy_status: patient.status,
    record_status: patient.record_status || patient.status,
    vital_status: patient.vital_status || 'unknown',
    superseded_by_patient_id: patient.superseded_by_patient_id || null,
    context_kind: patient.context_kind,
  };
}

function normalizeIdentityLookupPayload(data = {}) {
  return compactDefined({
    patient_code: data.patient_code || data.medical_record_number || data.mrn,
    first_name: data.first_name,
    last_name: data.last_name,
    date_of_birth: normalizeDateOnly(data.date_of_birth || data.birth_date),
    sex: normalizePatientSex(data.sex || data.gender),
    limit: data.limit,
  });
}

function normalizeCurrentContexts(response) {
  const data = response?.data && typeof response.data === 'object' ? response.data : response;
  return {
    patient_id: data?.patient_id || null,
    outpatient: Array.isArray(data?.outpatient) ? data.outpatient : [],
    inpatient: Array.isArray(data?.inpatient) ? data.inpatient : [],
    emergency: Array.isArray(data?.emergency) ? data.emergency : [],
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
        const response = await requestV2PatientList(params, options);
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

  lookupIdentity: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postPatientIdentityLookup(
          normalizeIdentityLookupPayload(data),
          { signal: options.signal },
        );
        return response?.data || response;
      }
      const queryString = new URLSearchParams(normalizeIdentityLookupPayload(data)).toString();
      return await apiClient.get(`/patients/search/${queryString ? `?${queryString}` : ''}`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to look up patient identity'));
      }
      throw new Error(handleApiError(error, 'Failed to look up patient identity'));
    }
  },

  getCurrentContexts: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientCurrentContexts({ id }, { signal: options.signal });
        return normalizeCurrentContexts(response);
      }
      return {
        patient_id: id,
        outpatient: [],
        inpatient: [],
        emergency: [],
      };
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch patient current contexts'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch patient current contexts'));
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
        const response = await requestV2PatientList(queryParams, options);
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
        const response = await requestV2PatientList(queryParams, options);
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
        const query = getV2PatientContextListQuery({ limit: 10, ...params });
        const response = query.search || query.patient_id
          ? await v2Request({
              method: 'POST',
              path: '/api/v2/patients/context/search',
              body: query,
              signal: options.signal,
            })
          : await v2Api.getPatientContextList({
              query,
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
