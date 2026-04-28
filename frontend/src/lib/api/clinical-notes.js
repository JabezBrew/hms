/**
 * Clinical Notes API service
 */
import { apiClient, handleApiError } from '../api-client';

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

export const clinicalNotesApi = {
  /**
   * Get all note templates with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of note templates
   */
  getNoteTemplates: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/clinical-notes/templates/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch note templates'));
    }
  },

  /**
   * Get a single note template by ID
   * @param {string} id - Note template ID
   * @returns {Promise<Object>} Note template data
   */
  getNoteTemplate: async (id) => {
    try {
      return await apiClient.get(`/clinical-notes/templates/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch note template'));
    }
  },

  /**
   * Create a new note template
   * @param {Object} data - Note template data
   * @returns {Promise<Object>} Created note template data
   */
  createNoteTemplate: async (data) => {
    try {
      return await apiClient.post('/clinical-notes/templates/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create note template'));
    }
  },

  /**
   * Update a note template
   * @param {string} id - Note template ID
   * @param {Object} data - Note template data to update
   * @returns {Promise<Object>} Updated note template data
   */
  updateNoteTemplate: async (id, data) => {
    try {
      return await apiClient.put(`/clinical-notes/templates/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update note template'));
    }
  },

  /**
   * Delete a note template
   * @param {string} id - Note template ID
   * @returns {Promise<Object>} Empty object or operation outcome
   */
  deleteNoteTemplate: async (id) => {
    try {
      return await apiClient.delete(`/clinical-notes/templates/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete note template'));
    }
  },

  /**
   * Get all note entries with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of note entries
   */
  getNoteEntries: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/clinical-notes/entries/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch note entries'));
    }
  },

  /**
   * Get a single note entry by ID
   * @param {string} id - Note entry ID
   * @returns {Promise<Object>} Note entry data
   */
  getNoteEntry: async (id) => {
    try {
      return await apiClient.get(`/clinical-notes/entries/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch note entry'));
    }
  },

  /**
   * Create a new note entry
   * @param {Object} data - Note entry data
   * @returns {Promise<Object>} Created note entry data
   */
  createNoteEntry: async (data) => {
    try {
      return await apiClient.post('/clinical-notes/entries/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create note entry'));
    }
  },

  /**
   * Get note entries for an encounter
   * @param {string} encounterId - Encounter ID
   * @returns {Promise<Array>} List of note entries for the encounter
   */
  getNoteEntriesForEncounter: async (encounterId, params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/clinical-notes/entries/', {
        ...options,
        params: {
          ...params,
          encounter_id: encounterId,
        },
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch note entries for encounter'));
    }
  },

  /**
   * Get active note templates
   * @returns {Promise<Array>} List of active note templates
   */
  getActiveNoteTemplates: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/clinical-notes/templates/', {
        ...options,
        params: {
          ...params,
          is_active: true,
        },
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch active note templates'));
    }
  },

  /**
   * Get available templates for the current user (for note creation)
   * Only returns active templates that the user can see
   * @returns {Promise<Array>} List of available note templates
   */
  getAvailableTemplates: async (options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/clinical-notes/templates/available/', options);
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch available templates'));
    }
  },

  /**
   * Get templates created by the current user
   * @returns {Promise<Array>} List of user's own templates
   */
  getMyTemplates: async (options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/clinical-notes/templates/mine/', options);
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch your templates'));
    }
  },

  /**
   * Get available template categories
   * @returns {Promise<Array>} List of category options
   */
  getTemplateCategories: async () => {
    try {
      return await apiClient.get('/clinical-notes/templates/categories/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch template categories'));
    }
  },

  /**
   * Duplicate an existing template
   * @param {string} id - Template ID to duplicate
   * @returns {Promise<Object>} The newly created template copy
   */
  duplicateTemplate: async (id) => {
    try {
      return await apiClient.post(`/clinical-notes/templates/${id}/duplicate/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to duplicate template'));
    }
  },

  /**
   * Get template revisions
   * @param {string} id - Template ID
   * @returns {Promise<Array>} Template revisions
   */
  getTemplateRevisions: async (id, options = {}) => {
    try {
      const response = await apiClient.getWithPagination(`/clinical-notes/templates/${id}/revisions/`, options);
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch template revisions'));
    }
  },

  /**
   * Render template defaults for note prefill
   * @param {string} id - Template ID
   * @param {Object} data - Render payload
   * @returns {Promise<Object>} Rendered defaults with revision metadata
   */
  renderTemplate: async (id, data = {}) => {
    try {
      return await apiClient.post(`/clinical-notes/templates/${id}/render/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to render template defaults'));
    }
  },

  /**
   * Get available sections for copying from a note entry
   * @param {string} id - Note entry ID
   * @returns {Promise<Array>} List of sections with preview info
   */
  getNoteEntrySections: async (id) => {
    try {
      return await apiClient.get(`/clinical-notes/entries/${id}/sections/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch note sections'));
    }
  },

  /**
   * Clone a note entry with selective section copying
   * @param {string} id - Source note entry ID
   * @param {Object} data - Clone options (sections, encounter, patient)
   * @returns {Promise<Object>} The newly created note entry
   */
  cloneNoteEntry: async (id, data = {}) => {
    try {
      return await apiClient.post(`/clinical-notes/entries/${id}/clone/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to copy note'));
    }
  },

  /**
   * Update a note entry with version tracking
   * @param {string} id - Note entry ID
   * @param {Object} data - Updated note data
   * @param {string} editReason - Optional reason for the edit
   * @returns {Promise<Object>} Updated note entry data
   */
  updateNoteEntry: async (id, data, editReason = '') => {
    try {
      return await apiClient.put(`/clinical-notes/entries/${id}/`, {
        data,
        edit_reason: editReason
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update note entry'));
    }
  },

  /**
   * Get version history for a note entry
   * @param {string} id - Note entry ID
   * @returns {Promise<Object>} Version history with all versions
   */
  getNoteEntryHistory: async (id) => {
    try {
      return await apiClient.get(`/clinical-notes/entries/${id}/history/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch note history'));
    }
  },

  /**
   * Get a specific version of a note entry
   * @param {string} id - Note entry ID
   * @param {number} versionNumber - Version number to retrieve
   * @returns {Promise<Object>} Version data
   */
  getNoteEntryVersion: async (id, versionNumber) => {
    try {
      return await apiClient.get(`/clinical-notes/entries/${id}/history/${versionNumber}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch note version'));
    }
  },

  /**
   * Compare two versions of a note entry
   * @param {string} id - Note entry ID
   * @param {number} versionA - First version number (0 for current)
   * @param {number} versionB - Second version number (0 for current)
   * @returns {Promise<Object>} Comparison data with both versions
   */
  compareNoteVersions: async (id, versionA, versionB) => {
    try {
      return await apiClient.get(`/clinical-notes/entries/${id}/compare/${versionA}/${versionB}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to compare versions'));
    }
  }
};
