import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

const RUST_V2_MY_PATIENTS_MUTATION_UNSUPPORTED =
  'My Patients curated-list mutations are not supported by Rust V2';

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function birthYearToDate(value) {
  if (!value) {
    return null;
  }
  return `${String(value).padStart(4, '0')}-01-01`;
}

function adaptV2ContextPatientToMyPatientEntry(patient) {
  const displayName = patient.display_name || patient.name || 'Unknown';
  const patientCode = patient.patient_code || patient.medical_record_number || patient.mrn || null;
  const updatedAt = patient.updated_at || patient.created_at || null;

  return {
    id: patient.id,
    patient: patient.id,
    patient_details: {
      id: patient.id,
      patient_profile: patient.id,
      medical_record_number: patientCode,
      mrn: patientCode,
      name: displayName,
      date_of_birth: patient.date_of_birth || birthYearToDate(patient.birth_year),
      gender: patient.sex || patient.gender || null,
      registry_status: patient.status || patient.registry_status || null,
      patient_location: null,
      active_clinic_names: [],
      local_data: {
        id: patient.id,
        medical_record_number: patientCode,
      },
      user_details: {
        first_name: displayName,
        last_name: '',
      },
    },
    is_pinned: false,
    notes: patient.context_kind || '',
    added_at: updatedAt,
  };
}

function adaptV2ContextPatientsResponse(response) {
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptV2ContextPatientToMyPatientEntry)
    : [];

  return {
    count: results.length + (response?.page?.has_next ? 1 : 0),
    next: response?.page?.next_cursor || null,
    previous: null,
    results,
  };
}

function throwRustV2MyPatientsMutationUnsupported() {
  throw new Error(RUST_V2_MY_PATIENTS_MUTATION_UNSUPPORTED);
}

/**
 * My Patients API service
 * Manages user's personal patient list for quick access
 */
export const myPatientsApi = {
  /**
   * Get user's personal patient list
   * @returns {Promise<Array>} List of patients in user's list
   */
  getMyPatients: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientContextList({
          query: { limit: 50 },
          signal: options.signal,
        });
        return adaptV2ContextPatientsResponse(response);
      }
      return await apiClient.get('/users/my-patients/');
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch my patients'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch my patients'));
    }
  },

  /**
   * Add a patient to user's list
   * @param {string} patientId - Patient ID to add
   * @param {Object} options - Optional settings (notes, is_pinned)
   * @returns {Promise<Object>} Created list entry
   */
  addPatient: async (patientId, options = {}) => {
    if (isRustV2ApiMode()) {
      throwRustV2MyPatientsMutationUnsupported();
    }
    try {
      return await apiClient.post('/users/my-patients/add_patient/', {
        patient_id: patientId,
        notes: options.notes || '',
        is_pinned: options.is_pinned || false,
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to add patient to list'));
    }
  },

  /**
   * Remove a patient from user's list
   * @param {string} patientId - Patient ID to remove
   * @returns {Promise<Object>} Success message
   */
  removePatient: async (patientId) => {
    if (isRustV2ApiMode()) {
      throwRustV2MyPatientsMutationUnsupported();
    }
    try {
      return await apiClient.delete(`/users/my-patients/remove_patient/?patient_id=${patientId}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to remove patient from list'));
    }
  },

  /**
   * Remove a list entry by its ID
   * @param {string} entryId - List entry ID
   * @returns {Promise<void>}
   */
  removeEntry: async (entryId) => {
    if (isRustV2ApiMode()) {
      throwRustV2MyPatientsMutationUnsupported();
    }
    try {
      return await apiClient.delete(`/users/my-patients/${entryId}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to remove patient from list'));
    }
  },

  /**
   * Toggle pin status for a patient in the list
   * @param {string} entryId - List entry ID
   * @returns {Promise<Object>} Updated entry
   */
  togglePin: async (entryId) => {
    if (isRustV2ApiMode()) {
      throwRustV2MyPatientsMutationUnsupported();
    }
    try {
      return await apiClient.post(`/users/my-patients/${entryId}/toggle_pin/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to toggle pin status'));
    }
  },

  /**
   * Update notes for a patient in the list
   * @param {string} entryId - List entry ID
   * @param {string} notes - New notes
   * @returns {Promise<Object>} Updated entry
   */
  updateNotes: async (entryId, notes) => {
    if (isRustV2ApiMode()) {
      throwRustV2MyPatientsMutationUnsupported();
    }
    try {
      return await apiClient.patch(`/users/my-patients/${entryId}/update_notes/`, { notes });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update notes'));
    }
  },

  /**
   * Check if a patient is in user's list
   * @param {string} patientId - Patient ID to check
   * @returns {Promise<Object>} { in_list: boolean }
   */
  checkPatient: async (patientId, options = {}) => {
    if (!patientId) {
      return { in_list: false };
    }
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientContextList({
          query: {
            limit: 25,
            search: String(patientId),
          },
          signal: options.signal,
        });
        const entries = Array.isArray(response?.data) ? response.data : [];
        return {
          in_list: entries.some((entry) => (
            entry.id === patientId
            || entry.patient_id === patientId
            || entry.patient_code === patientId
            || entry.medical_record_number === patientId
          )),
        };
      }
      return await apiClient.get(`/users/my-patients/check_patient/?patient_id=${patientId}`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to check patient status'));
      }
      throw new Error(handleApiError(error, 'Failed to check patient status'));
    }
  },
};
