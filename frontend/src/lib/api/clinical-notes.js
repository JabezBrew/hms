/**
 * Clinical Notes API service
 */
import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

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

function normalizeIdentifier(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    return normalizeIdentifier(value.id ?? value.uuid);
  }
  return null;
}

function patientIdFrom(value = {}) {
  return normalizeIdentifier(value.patient_id ?? value.patientId ?? value.patient);
}

function v2Limit(value, fallback = 25) {
  const limit = Number(value || fallback);
  return Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : fallback;
}

function v2CursorQuery(params = {}) {
  const query = { limit: v2Limit(params.limit || params.page_size) };
  if (params.cursor || params.next_cursor) {
    query.cursor = params.cursor || params.next_cursor;
  }
  return query;
}

function parseNoteBody(value) {
  if (!value) return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { note: value };
  }
}

function serializeNoteBody(data = {}) {
  const source = data.data ?? data.body ?? data.content ?? data.note ?? {};
  if (typeof source === 'string') {
    return source;
  }
  return JSON.stringify(source);
}

function normalizeNotePayload(data = {}) {
  const noteType = String(data.note_type || data.type || data.template?.note_type || 'clinical_note').trim();
  const title = String(data.title || data.note_title || data.template?.title || 'Clinical note').trim();
  return {
    note_type: noteType || 'clinical_note',
    title: title || 'Clinical note',
    body: serializeNoteBody(data),
  };
}

function selectNoteSections(body = {}, sections = []) {
  if (!Array.isArray(sections) || sections.length === 0 || typeof body !== 'object' || body === null || Array.isArray(body)) {
    return body;
  }
  return sections.reduce((selected, section) => {
    if (Object.prototype.hasOwnProperty.call(body, section)) {
      selected[section] = body[section];
    }
    return selected;
  }, {});
}

function adaptV2Template(template) {
  return {
    ...template,
    name: template.title,
    category: template.note_type,
    is_active: template.is_active !== false,
    structure: template.body_template,
  };
}

function normalizeTemplatePayload(data = {}) {
  const payload = {};
  if (data.title !== undefined || data.name !== undefined) {
    payload.title = data.title ?? data.name;
  }
  if (data.note_type !== undefined || data.category !== undefined || data.type !== undefined) {
    payload.note_type = data.note_type ?? data.category ?? data.type;
  }
  if (data.body_template !== undefined || data.structure !== undefined || data.template !== undefined) {
    payload.body_template = data.body_template ?? data.structure ?? data.template;
  }
  if (data.is_active !== undefined) {
    payload.is_active = Boolean(data.is_active);
  }
  return payload;
}

function adaptV2Note(note, body) {
  return {
    ...note,
    patient: note.patient_id,
    patient_id: note.patient_id,
    version_number: note.version,
    created_at: note.updated_at,
    data: body === undefined ? undefined : parseNoteBody(body),
  };
}

function adaptV2Version(version) {
  return {
    ...version,
    note: version.note_id,
    note_id: version.note_id,
    version_number: version.version,
    data: parseNoteBody(version.body),
  };
}

function adaptV2VersionHistory(response) {
  const versions = (Array.isArray(response?.data) ? response.data : [])
    .map(adaptV2Version)
    .sort((left, right) => Number(right.version_number || 0) - Number(left.version_number || 0));
  const current = versions[0] || null;
  return {
    id: current?.note_id || null,
    updated_at: current?.created_at || null,
    current_data: current?.data || null,
    version_count: versions.length,
    versions,
  };
}

export const clinicalNotesApi = {
  /**
   * Get all note templates with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of note templates
   */
  getNoteTemplates: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getClinicalNoteTemplates({
          query: { limit: v2Limit(params.limit || params.page_size, 25) },
          signal: options.signal,
        });
        return (Array.isArray(response?.data) ? response.data : []).map(adaptV2Template);
      }
      const response = await apiClient.getWithPagination('/clinical-notes/templates/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch note templates'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch note templates'));
    }
  },

  /**
   * Get a single note template by ID
   * @param {string} id - Note template ID
   * @returns {Promise<Object>} Note template data
   */
  getNoteTemplate: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getClinicalNoteTemplateById({ id }, { signal: options.signal });
        return adaptV2Template(response?.data);
      }
      return await apiClient.get(`/clinical-notes/templates/${id}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch note template'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch note template'));
    }
  },

  /**
   * Create a new note template
   * @param {Object} data - Note template data
   * @returns {Promise<Object>} Created note template data
   */
  createNoteTemplate: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postClinicalNoteTemplates(normalizeTemplatePayload(data), {
          signal: options.signal,
        });
        return adaptV2Template(response?.data);
      }
      return await apiClient.post('/clinical-notes/templates/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create note template'));
      }
      throw new Error(handleApiError(error, 'Failed to create note template'));
    }
  },

  /**
   * Update a note template
   * @param {string} id - Note template ID
   * @param {Object} data - Note template data to update
   * @returns {Promise<Object>} Updated note template data
   */
  updateNoteTemplate: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchClinicalNoteTemplate(
          { id },
          normalizeTemplatePayload(data),
          { signal: options.signal },
        );
        return adaptV2Template(response?.data);
      }
      return await apiClient.patch(`/clinical-notes/templates/${id}/`, data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update note template'));
      }
      throw new Error(handleApiError(error, 'Failed to update note template'));
    }
  },

  /**
   * Delete a note template
   * @param {string} id - Note template ID
   * @returns {Promise<Object>} Empty object or operation outcome
   */
  deleteNoteTemplate: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.deleteClinicalNoteTemplate({ id }, { signal: options.signal });
        return adaptV2Template(response?.data);
      }
      return await apiClient.delete(`/clinical-notes/templates/${id}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to delete note template'));
      }
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
      if (isRustV2ApiMode()) {
        const patientId = patientIdFrom(params);
        if (!patientId) {
          return [];
        }
        const response = await v2Api.getPatientClinicalNotes(
          { patient_id: patientId },
          { query: v2CursorQuery(params), signal: options.signal },
        );
        return (Array.isArray(response?.data) ? response.data : []).map(adaptV2Note);
      }
      const response = await apiClient.getWithPagination('/clinical-notes/entries/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch note entries'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch note entries'));
    }
  },

  /**
   * Get a single note entry by ID
   * @param {string} id - Note entry ID
   * @returns {Promise<Object>} Note entry data
   */
  getNoteEntry: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getClinicalNoteById({ note_id: id }, { signal: options.signal });
        return adaptV2Note(response?.data, response?.data?.body);
      }
      return await apiClient.get(`/clinical-notes/entries/${id}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch note entry'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch note entry'));
    }
  },

  /**
   * Create a new note entry
   * @param {Object} data - Note entry data
   * @returns {Promise<Object>} Created note entry data
   */
  createNoteEntry: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const patientId = patientIdFrom(data);
        if (!patientId) {
          throw new Error('Patient id is required to create a clinical note in Rust V2');
        }
        const response = await v2Api.postPatientClinicalNotes(
          { patient_id: patientId },
          normalizeNotePayload(data),
          { signal: options.signal },
        );
        return adaptV2Note(response?.data, serializeNoteBody(data));
      }
      return await apiClient.post('/clinical-notes/entries/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create note entry'));
      }
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
      if (isRustV2ApiMode()) {
        const patientId = patientIdFrom(params);
        if (!patientId) {
          return [];
        }
        return clinicalNotesApi.getNoteEntries({ ...params, patient_id: patientId }, options);
      }
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
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch note entries for encounter'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch note entries for encounter'));
    }
  },

  /**
   * Get active note templates
   * @returns {Promise<Array>} List of active note templates
   */
  getActiveNoteTemplates: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await clinicalNotesApi.getNoteTemplates(params, options);
      }
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
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch active note templates'));
      }
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
      if (isRustV2ApiMode()) {
        return await clinicalNotesApi.getNoteTemplates({}, options);
      }
      const response = await apiClient.getWithPagination('/clinical-notes/templates/available/', options);
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch available templates'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch available templates'));
    }
  },

  /**
   * Get templates created by the current user
   * @returns {Promise<Array>} List of user's own templates
   */
  getMyTemplates: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await clinicalNotesApi.getNoteTemplates({}, options);
      }
      const response = await apiClient.getWithPagination('/clinical-notes/templates/mine/', options);
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch your templates'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch your templates'));
    }
  },

  /**
   * Get available template categories
   * @returns {Promise<Array>} List of category options
   */
  getTemplateCategories: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const templates = await clinicalNotesApi.getNoteTemplates({}, options);
        return [...new Set(templates.map((template) => template.note_type).filter(Boolean))];
      }
      return await apiClient.get('/clinical-notes/templates/categories/', options);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch template categories'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch template categories'));
    }
  },

  /**
   * Duplicate an existing template
   * @param {string} id - Template ID to duplicate
   * @returns {Promise<Object>} The newly created template copy
   */
  duplicateTemplate: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const template = await clinicalNotesApi.getNoteTemplate(id, options);
        return await clinicalNotesApi.createNoteTemplate(
          {
            title: `Copy of ${template.title}`,
            note_type: template.note_type,
            body_template: template.body_template,
          },
          { signal: options.signal },
        );
      }
      return await apiClient.post(`/clinical-notes/templates/${id}/duplicate/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to duplicate template'));
      }
      throw new Error(handleApiError(error, 'Failed to duplicate template'));
    }
  },

  /**
   * Get template revisions
   * @param {string} id - Template ID
   * @returns {Promise<Array>} Template revisions
   */
  getTemplateRevisions: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      return [];
    }
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
      if (isRustV2ApiMode()) {
        return {
          rendered_data: data.base_data || {},
          revision_id: data.revision_id || null,
          revision_version: null,
        };
      }
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
  getNoteEntrySections: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      return [];
    }
    try {
      return await apiClient.get(`/clinical-notes/entries/${id}/sections/`, options);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch note sections'));
    }
  },

  /**
   * Clone a note entry with selective section copying
   * @param {string} id - Source note entry ID
   * @param {Object} data - Clone options (sections, encounter, patient)
   * @returns {Promise<Object>} The newly created note entry
   */
  cloneNoteEntry: async (id, data = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const source = await clinicalNotesApi.getNoteEntry(id, { signal: options.signal });
        const patientId = patientIdFrom(data) || source.patient_id;
        if (!patientId) {
          throw new Error('Patient id is required to copy a clinical note in Rust V2');
        }
        return await clinicalNotesApi.createNoteEntry(
          {
            patient_id: patientId,
            note_type: data.note_type || source.note_type,
            title: data.title || source.title || 'Clinical note',
            data: selectNoteSections(source.data || {}, data.sections),
          },
          { signal: options.signal },
        );
      }
      return await apiClient.post(`/clinical-notes/entries/${id}/clone/`, data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to copy note'));
      }
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
  updateNoteEntry: async (id, data, editReason = '', options = {}) => {
    const requestOptions = typeof editReason === 'object' && editReason !== null
      ? editReason
      : options;
    const resolvedEditReason = typeof editReason === 'object' && editReason !== null
      ? ''
      : editReason;
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postClinicalNoteVersions(
          { note_id: id },
          { body: serializeNoteBody({ data }) },
          { signal: requestOptions.signal },
        );
        return adaptV2Version(response?.data);
      }
      return await apiClient.patch(`/clinical-notes/entries/${id}/`, {
        data,
        edit_reason: resolvedEditReason
      });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update note entry'));
      }
      throw new Error(handleApiError(error, 'Failed to update note entry'));
    }
  },

  /**
   * Get version history for a note entry
   * @param {string} id - Note entry ID
   * @returns {Promise<Object>} Version history with all versions
   */
  getNoteEntryHistory: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getClinicalNoteVersions(
          { note_id: id },
          { signal: options.signal },
        );
        return adaptV2VersionHistory(response);
      }
      return await apiClient.get(`/clinical-notes/entries/${id}/history/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch note history'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch note history'));
    }
  },

  /**
   * Get a specific version of a note entry
   * @param {string} id - Note entry ID
   * @param {number} versionNumber - Version number to retrieve
   * @returns {Promise<Object>} Version data
   */
  getNoteEntryVersion: async (id, versionNumber, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const history = await clinicalNotesApi.getNoteEntryHistory(id, options);
        if (Number(versionNumber) === 0) {
          return { version_number: 0, data: history.current_data, created_at: history.updated_at };
        }
        return history.versions.find((version) => Number(version.version_number) === Number(versionNumber)) || null;
      }
      return await apiClient.get(`/clinical-notes/entries/${id}/history/${versionNumber}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch note version'));
      }
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
  compareNoteVersions: async (id, versionA, versionB, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const history = await clinicalNotesApi.getNoteEntryHistory(id, options);
        const resolveVersion = (versionNumber) => {
          if (Number(versionNumber) === 0) {
            return { version_number: 'current', data: history.current_data };
          }
          return history.versions.find((version) => Number(version.version_number) === Number(versionNumber)) || null;
        };
        return {
          version_a: resolveVersion(versionA),
          version_b: resolveVersion(versionB),
          changes: [],
        };
      }
      return await apiClient.get(`/clinical-notes/entries/${id}/compare/${versionA}/${versionB}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to compare versions'));
      }
      throw new Error(handleApiError(error, 'Failed to compare versions'));
    }
  }
};
