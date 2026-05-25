/**
 * Encounters API service
 */
import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

const DEFAULT_ENCOUNTER_PAGE_SIZE = 50;

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function normalizeLimit(params = {}, fallback = DEFAULT_ENCOUNTER_PAGE_SIZE) {
  const rawLimit = params.limit || params.page_size || fallback;
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function normalizeIdentifier(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object') {
    return normalizeIdentifier(value.id || value.uuid || value.pk);
  }
  return null;
}

function splitDisplayName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return ['', ''];
  }
  if (parts.length === 1) {
    return [parts[0], ''];
  }
  return [parts[0], parts.slice(1).join(' ')];
}

function mapV2EncounterStatus(status) {
  if (status === 'in_progress') {
    return 'in-progress';
  }
  if (status === 'completed') {
    return 'finished';
  }
  return status || 'in-progress';
}

function mapUiEncounterStatus(status) {
  if (status === 'in-progress' || status === 'in_progress') {
    return 'in_progress';
  }
  if (status === 'finished' || status === 'completed') {
    return 'completed';
  }
  return status;
}

function normalizeEncounterType(value) {
  const normalized = String(value || 'outpatient').replace(/-/g, '_').toLowerCase();
  if (['outpatient', 'emergency', 'triage'].includes(normalized)) {
    return normalized;
  }
  return 'outpatient';
}

function unsupportedInRustV2(message) {
  return new Error(message);
}

function adaptV2Encounter(encounter) {
  if (!encounter) {
    return encounter;
  }

  const [firstName, lastName] = splitDisplayName(encounter.patient_display_name);
  const status = mapV2EncounterStatus(encounter.status);

  return {
    id: encounter.id,
    patient: encounter.patient_id,
    patient_id: encounter.patient_id,
    patient_name: encounter.patient_display_name || '',
    patient_mrn: encounter.patient_code || '',
    patient_identifier: encounter.patient_code || '',
    patient_details: {
      id: encounter.patient_id,
      medical_record_number: encounter.patient_code || '',
      user_details: {
        first_name: firstName,
        last_name: lastName,
      },
    },
    visit: encounter.visit_id || null,
    visit_id: encounter.visit_id || null,
    encounter_type: encounter.encounter_type,
    status,
    v2_status: encounter.status,
    start_time: encounter.started_at,
    end_time: encounter.ended_at || null,
    started_at: encounter.started_at,
    ended_at: encounter.ended_at || null,
    practitioner_name: '',
    location: null,
  };
}

function adaptV2EncounterPage(response, params = {}) {
  const limit = Number(response?.page?.limit || normalizeLimit(params));
  const currentPage = Number(params.page || 1);
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptV2Encounter)
    : [];
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const estimatedTotal = ((currentPage - 1) * limit) + results.length + (hasNext ? 1 : 0);

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

function getV2EncounterListQuery(params = {}) {
  const query = {
    limit: normalizeLimit(params),
  };
  if (params.cursor || params.next_cursor) {
    query.cursor = params.cursor || params.next_cursor;
  }
  if (params.patient_id || params.patient) {
    query.patient_id = normalizeIdentifier(params.patient_id || params.patient);
  }
  return query;
}

function normalizeCreatePayload(data = {}) {
  const patientId = normalizeIdentifier(data.patient_id || data.patient);
  if (!patientId) {
    throw new Error('Patient is required to create an encounter.');
  }

  return {
    patient_id: patientId,
    visit_id: normalizeIdentifier(data.visit_id || data.visit),
    encounter_type: normalizeEncounterType(data.encounter_type),
  };
}

function normalizeUpdatePayload(data = {}) {
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(data, 'visit_id') || Object.prototype.hasOwnProperty.call(data, 'visit')) {
    payload.visit_id = normalizeIdentifier(data.visit_id || data.visit);
  } else {
    payload.visit_id = null;
  }
  if (data.encounter_type) {
    payload.encounter_type = normalizeEncounterType(data.encounter_type);
  }
  if (data.status) {
    payload.status = mapUiEncounterStatus(data.status);
  }
  if (!payload.visit_id && !payload.encounter_type) {
    throw new Error('At least one encounter field must be supplied.');
  }
  delete payload.status;
  return payload;
}

function adaptV2PatientSearchItem(patient) {
  if (!patient) {
    return patient;
  }
  return {
    id: patient.id,
    medical_record_number: patient.patient_code,
    mrn: patient.patient_code,
    name: patient.display_name,
    first_name: patient.first_name,
    last_name: patient.last_name,
    gender: patient.sex,
    date_of_birth: patient.date_of_birth,
  };
}

function adaptV2PractitionerSearchItem(practitioner) {
  if (!practitioner) {
    return practitioner;
  }
  return {
    id: practitioner.id || practitioner.user_id,
    user_id: practitioner.user_id || practitioner.id,
    name: practitioner.display_name || practitioner.name || practitioner.email,
    email: practitioner.email,
    role: practitioner.role || practitioner.staff_role || null,
  };
}

export const encountersApi = {
  /**
   * Get encounters with pagination and filtering
   * @param {Object} params - Query parameters for filtering and pagination
   * @returns {Promise<Object>} Paginated response with results, count, next, previous
   */
  getEncounters: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getEncounters({
          query: getV2EncounterListQuery(params),
          signal: options.signal,
        });
        return adaptV2EncounterPage(response, params);
      }

      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/encounters/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.getWithPagination(endpoint, { signal: options.signal || params.signal });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch encounters'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch encounters'));
    }
  },

  /**
   * Get a single encounter by ID
   * @param {string} id - Encounter ID
   * @returns {Promise<Object>} Encounter data
   */
  getEncounter: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getEncounterById({ id }, { signal: options.signal });
        return adaptV2Encounter(response?.data);
      }
      return await apiClient.get(`/encounters/${id}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch encounter'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch encounter'));
    }
  },

  /**
   * Create a new encounter
   * @param {Object} data - Encounter data
   * @returns {Promise<Object>} Created encounter data
   */
  createEncounter: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postEncounters(normalizeCreatePayload(data), {
          signal: options.signal,
        });
        return adaptV2Encounter(response?.data);
      }
      return await apiClient.post('/encounters/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create encounter'));
      }
      throw new Error(handleApiError(error, 'Failed to create encounter'));
    }
  },

  /**
   * Update an encounter
   * @param {string} id - Encounter ID
   * @param {Object} data - Encounter data to update
   * @returns {Promise<Object>} Updated encounter data
   */
  updateEncounter: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchEncounterById({ id }, normalizeUpdatePayload(data), {
          signal: options.signal,
        });
        return adaptV2Encounter(response?.data);
      }
      return await apiClient.patch(`/encounters/${id}/`, data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update encounter'));
      }
      throw new Error(handleApiError(error, 'Failed to update encounter'));
    }
  },

  /**
   * Delete an encounter
   * @param {string} id - Encounter ID
   * @returns {Promise<Object>} Empty object or operation outcome
   */
  deleteEncounter: async (id) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 does not expose encounter deletion.');
    }
    try {
      return await apiClient.delete(`/encounters/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete encounter'));
    }
  },

  /**
   * Discharge a patient (for inpatient encounters)
   * @returns {Promise<Object>} Updated encounter data
   */
  dischargePatient: async (id, data) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 discharge is handled by admission discharge workflows.');
    }
    try {
      return await apiClient.post(`/encounters/${id}/discharge/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to discharge patient'));
    }
  },

  /**
   * Cancel an encounter
   * @param {string} id - Encounter ID
   * @returns {Promise<Object>} Updated encounter data
   */
  cancelEncounter: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postEncounterCancel({ id }, { signal: options.signal });
        return adaptV2Encounter(response?.data);
      }
      return await apiClient.post(`/encounters/${id}/cancel/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to cancel encounter'));
      }
      throw new Error(handleApiError(error, 'Failed to cancel encounter'));
    }
  },

  completeEncounter: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postEncounterComplete({ id }, { signal: options.signal });
        return adaptV2Encounter(response?.data);
      }
      return await apiClient.post(`/encounters/${id}/complete/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to complete encounter'));
      }
      throw new Error(handleApiError(error, 'Failed to complete encounter'));
    }
  },

  /**
   * Search patients for encounter
   * @param {string} query - Search query
   * @returns {Promise<Array>} List of matching patients
   */
  searchPatients: async (query, options = {}) => {
    try {
      if (!query || query.length < 2) {
        return [];
      }
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatients({
          query: { search: query, limit: 20 },
          signal: options.signal,
        });
        return Array.isArray(response?.data) ? response.data.map(adaptV2PatientSearchItem) : [];
      }

      const response = await apiClient.get(`/patients/search/?query=${encodeURIComponent(query)}`);

      if (response && response.patients) {
        return response.patients;
      }

      return Array.isArray(response) ? response : [];
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to search patients'));
      }
      throw new Error(handleApiError(error, 'Failed to search patients'));
    }
  },

  /**
   * Search practitioners for encounter
   * @param {string} query - Search query
   * @param {boolean} doctorsOnly - Whether to filter for doctors only
   * @returns {Promise<Array>} List of matching practitioners
   */
  searchPractitioners: async (query, doctorsOnly = false, options = {}) => {
    try {
      if (!query || query.length < 2) {
        return [];
      }

      if (isRustV2ApiMode()) {
        const response = await v2Api.getAdminPractitioners({
          query: {
            limit: 20,
            search: query.trim(),
            is_active: true,
          },
          signal: options.signal,
        });
        return Array.isArray(response?.data)
          ? response.data.map(adaptV2PractitionerSearchItem)
          : [];
      }

      const params = new URLSearchParams({
        q: query
      });

      if (doctorsOnly) {
        params.append('doctors_only', 'true');
      }

      const response = await apiClient.get(`/users/practitioners/search/?${params.toString()}`);

      if (response && response.practitioners) {
        return response.practitioners;
      }

      return Array.isArray(response) ? response : [];
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to search practitioners'));
      }
      throw new Error(handleApiError(error, 'Failed to search practitioners'));
    }
  },

  /**
   * Get all encounters for a specific patient
   * @param {string} patientId - Patient ID
   * @returns {Promise<Array>} List of encounters for the patient
   */
  getEncountersForPatient: async (patientId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getEncounters({
          query: {
            limit: DEFAULT_ENCOUNTER_PAGE_SIZE,
            patient_id: patientId,
          },
          signal: options.signal,
        });
        return Array.isArray(response?.data) ? response.data.map(adaptV2Encounter) : [];
      }
      return await apiClient.get('/encounters/for_patient/', {
        ...options,
        params: { patient_id: patientId },
      });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch patient encounters'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch patient encounters'));
    }
  }
};
