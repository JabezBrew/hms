/**
 * Drug Safety API service
 */
import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

const RUST_V2_ALLERGY_OPERATION_UNSUPPORTED =
  'Drug safety allergy operation is not supported by Rust V2';

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function normalizeListResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function getV2AllergyLimit(params = {}) {
  const requested = Number(params.limit || params.page_size || 50);
  return Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
}

function adaptV2Allergy(allergy) {
  const isActive = (allergy.status || 'active') === 'active';
  return {
    id: allergy.id,
    patient: allergy.patient_id,
    patient_id: allergy.patient_id,
    allergen_name: allergy.substance,
    substance: allergy.substance,
    reaction_description: allergy.reaction || '',
    severity: allergy.severity || 'unknown',
    status: allergy.status || 'active',
    is_active: isActive,
    allergy_type: 'other',
    allergy_type_display: 'Other',
    notes: '',
    created_at: allergy.created_at,
    created_by_name: 'HMS V2',
    verified_by: null,
    verified_by_name: null,
    verified_at: null,
  };
}

function adaptV2PatientAllergiesResponse(response) {
  const allergies = Array.isArray(response?.data)
    ? response.data.map(adaptV2Allergy)
    : [];
  return {
    count: allergies.length + (response?.page?.has_next ? 1 : 0),
    allergies,
  };
}

function normalizeAllergySeverity(value) {
  const severity = String(value || 'unknown').trim().toLowerCase();
  if (severity === 'life_threatening' || severity === 'critical') {
    return 'severe';
  }
  if (['mild', 'moderate', 'severe', 'unknown'].includes(severity)) {
    return severity;
  }
  return 'unknown';
}

function normalizeCreateAllergyPayload(data = {}) {
  const patientId = data.patient_id || data.patient;
  const substance = String(data.substance || data.allergen_name || '').trim();
  if (!patientId) {
    throw new Error('Patient ID is required to create an allergy in Rust V2');
  }
  if (!substance) {
    throw new Error('Allergen name is required to create an allergy in Rust V2');
  }

  return {
    patientId,
    payload: {
      substance,
      reaction: data.reaction || data.reaction_description || null,
      severity: normalizeAllergySeverity(data.severity),
    },
  };
}

function normalizeUpdateAllergyPayload(data = {}) {
  const payload = {};
  if (data.substance !== undefined || data.allergen_name !== undefined) {
    payload.substance = data.substance ?? data.allergen_name;
  }
  if (data.reaction !== undefined || data.reaction_description !== undefined) {
    payload.reaction = data.reaction ?? data.reaction_description;
  }
  if (data.severity !== undefined) {
    payload.severity = normalizeAllergySeverity(data.severity);
  }
  if (data.status !== undefined) {
    payload.status = data.status === 'inactive' || data.is_active === false ? 'inactive' : 'active';
  } else if (data.is_active === false) {
    payload.status = 'inactive';
  }
  return payload;
}

function getPatientIdFromAllergyParams(params = {}) {
  return params.patient_id || params.patient || params.patientId;
}

function throwRustV2AllergyUnsupported() {
  throw new Error(RUST_V2_ALLERGY_OPERATION_UNSUPPORTED);
}

function throwRustV2Unsupported(contractName) {
  throw new Error(`${contractName} is unavailable in Rust V2 mode.`);
}

export const drugSafetyApi = {
  /**
   * Perform comprehensive drug safety check
   * @param {Object} data - Safety check request { patient_id, medication_name, encounter_id? }
   * @returns {Promise<Object>} Safety check response with alerts
   */
  checkPrescriptionSafety: async (data) => {
    if (isRustV2ApiMode()) {
      throwRustV2Unsupported('/api/v2 drug safety check contract');
    }
    try {
      return await apiClient.post('/drug-safety/safety/check/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to perform safety check'));
    }
  },

  /**
   * Search for drugs using RxNorm
   * @param {string} query - Search query
   * @param {number} maxResults - Maximum number of results
   * @returns {Promise<Object>} Search results { results: [...] }
   */
  searchDrugs: async (query, maxResults = 10, options = {}) => {
    if (isRustV2ApiMode()) {
      throwRustV2Unsupported('/api/v2 drug search contract');
    }
    try {
      const params = new URLSearchParams({ q: query, max_results: maxResults });
      return await apiClient.get(`/drug-safety/safety/search_drugs/?${params.toString()}`, options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to search drugs'));
    }
  },

  /**
   * Get available drug forms (strengths and dose forms) for a drug
   * @param {string} rxcui - RxNorm Concept Unique Identifier
   * @returns {Promise<Object>} Drug forms { forms: [...] }
   */
  getDrugForms: async (rxcui, options = {}) => {
    if (isRustV2ApiMode()) {
      throwRustV2Unsupported('/api/v2 drug forms contract');
    }
    try {
      const params = new URLSearchParams({ rxcui });
      return await apiClient.get(`/drug-safety/safety/drug_forms/?${params.toString()}`, options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch drug forms'));
    }
  },

  /**
   * Get patient allergies
   * @param {string} patientId - Patient ID
   * @returns {Promise<Object>} Patient allergies { count, allergies: [...] }
   */
  getPatientAllergies: async (patientId, options = {}) => {
    if (!patientId) {
      return { count: 0, allergies: [] };
    }
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientAllergies(
          { patient_id: patientId },
          {
            query: { limit: getV2AllergyLimit(options) },
            signal: options.signal,
          },
        );
        return adaptV2PatientAllergiesResponse(response);
      }
      const params = new URLSearchParams({ patient_id: patientId });
      return await apiClient.get(`/drug-safety/safety/patient_allergies/?${params.toString()}`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch patient allergies'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch patient allergies'));
    }
  },

  /**
   * Get all allergies with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of allergies
   */
  getAllergies: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const patientId = getPatientIdFromAllergyParams(params);
        if (!patientId) {
          return [];
        }
        const response = await v2Api.getPatientAllergies(
          { patient_id: patientId },
          {
            query: { limit: getV2AllergyLimit(params) },
            signal: options.signal,
          },
        );
        return adaptV2PatientAllergiesResponse(response).allergies;
      }
      const response = await apiClient.getWithPagination('/drug-safety/allergies/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch allergies'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch allergies'));
    }
  },

  /**
   * Get a single allergy by ID
   * @param {string} id - Allergy ID
   * @returns {Promise<Object>} Allergy data
   */
  getAllergy: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getClinicalAllergyById(
          { id },
          { signal: options.signal },
        );
        return adaptV2Allergy(response?.data);
      }
      return await apiClient.get(`/drug-safety/allergies/${id}/`, options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch allergy'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch allergy'));
    }
  },

  /**
   * Create a new allergy
   * @param {Object} data - Allergy data
   * @returns {Promise<Object>} Created allergy data
   */
  createAllergy: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const { patientId, payload } = normalizeCreateAllergyPayload(data);
        const response = await v2Api.postPatientAllergies(
          { patient_id: patientId },
          payload,
          { signal: options.signal },
        );
        return adaptV2Allergy(response?.data);
      }
      return await apiClient.post('/drug-safety/allergies/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create allergy'));
      }
      throw new Error(handleApiError(error, 'Failed to create allergy'));
    }
  },

  /**
   * Update an allergy
   * @param {string} id - Allergy ID
   * @param {Object} data - Allergy data to update
   * @returns {Promise<Object>} Updated allergy data
   */
  updateAllergy: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchClinicalAllergy(
          { id },
          normalizeUpdateAllergyPayload(data),
          { signal: options.signal },
        );
        return adaptV2Allergy(response?.data);
      }
      return await apiClient.patch(`/drug-safety/allergies/${id}/`, data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update allergy'));
      }
      throw new Error(handleApiError(error, 'Failed to update allergy'));
    }
  },

  /**
   * Delete an allergy
   * @param {string} id - Allergy ID
   * @returns {Promise<Object>} Empty object or operation outcome
   */
  deleteAllergy: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.deleteClinicalAllergy(
          { id },
          { signal: options.signal },
        );
        return adaptV2Allergy(response?.data);
      }
      return await apiClient.delete(`/drug-safety/allergies/${id}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to delete allergy'));
      }
      throw new Error(handleApiError(error, 'Failed to delete allergy'));
    }
  },

  /**
   * Verify an allergy (doctors only)
   * @param {string} id - Allergy ID
   * @returns {Promise<Object>} Verified allergy data
   */
  verifyAllergy: async (id) => {
    if (isRustV2ApiMode()) {
      throwRustV2AllergyUnsupported();
    }
    try {
      return await apiClient.post(`/drug-safety/allergies/${id}/verify/`, {});
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to verify allergy'));
    }
  },

  /**
   * Deactivate an allergy
   * @param {string} id - Allergy ID
   * @returns {Promise<Object>} Deactivated allergy data
   */
  deactivateAllergy: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.deleteClinicalAllergy(
          { id },
          { signal: options.signal },
        );
        return adaptV2Allergy(response?.data);
      }
      return await apiClient.post(`/drug-safety/allergies/${id}/deactivate/`, {});
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to deactivate allergy'));
      }
      throw new Error(handleApiError(error, 'Failed to deactivate allergy'));
    }
  },

  /**
   * Get all safety alerts with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of safety alerts
   */
  getAlerts: async (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      throwRustV2Unsupported('/api/v2 drug safety alerts contract');
    }
    try {
      const response = await apiClient.getWithPagination('/drug-safety/alerts/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch safety alerts'));
    }
  },

  /**
   * Get a single safety alert by ID
   * @param {string} id - Alert ID
   * @returns {Promise<Object>} Alert data
   */
  getAlert: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      throwRustV2Unsupported('/api/v2 drug safety alerts contract');
    }
    try {
      return await apiClient.get(`/drug-safety/alerts/${id}/`, options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch safety alert'));
    }
  },

  /**
   * Override a safety alert (doctors only)
   * @param {string} id - Alert ID
   * @param {string} overrideReason - Reason for override
   * @returns {Promise<Object>} Overridden alert data
   */
  overrideAlert: async (id, overrideReason) => {
    if (isRustV2ApiMode()) {
      throwRustV2Unsupported('/api/v2 drug safety alerts contract');
    }
    try {
      return await apiClient.post(`/drug-safety/alerts/${id}/override/`, {
        override_reason: overrideReason,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to override alert'));
    }
  },
};
