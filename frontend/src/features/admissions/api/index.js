import { apiClient, handleApiError } from '@/lib/api-client'
import { handleV2ApiError } from '@/lib/api/v2/errors'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { v2Api } from '@/lib/api/v2/client'

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error
  }
}

function normalizeListResponse(response) {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.results)) return response.results
  return []
}

function normalizeLimit(params = {}, fallback = 25) {
  const value = Number(params.page_size || params.limit || fallback)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, 1), 100)
}

function adaptV2AdmissionCase(item) {
  if (!item) {
    return item
  }
  const requestedBedLabel = item.bed_code
    ? `${item.ward_name || 'Ward'} · Bed ${item.bed_code}`
    : item.ward_name || null

  return {
    id: item.id,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_name: item.patient_display_name,
    medical_record_number: item.patient_code,
    requested_ward: item.ward_id,
    requested_ward_name: item.ward_name,
    requested_bed: item.bed_id,
    requested_bed_label: requestedBedLabel,
    status: item.status,
    requested_at: item.created_at,
    ready_for_activation_at: item.status === 'ready_for_activation' ? item.created_at : null,
    admission_source: 'direct',
    admission_id: null,
    admitted_at: item.admitted_at,
    discharged_at: item.discharged_at,
    blockers: [],
    tasks: [],
    active_reservation: item.bed_id
      ? {
          ward: item.ward_id,
          ward_name: item.ward_name,
          bed: item.bed_id,
          bed_number: item.bed_code,
          reserved_at: item.created_at,
        }
      : null,
    can_activate: item.status === 'ready_for_activation',
  }
}

function adaptV2AdmissionCaseList(response) {
  return Array.isArray(response?.data)
    ? response.data.map(adaptV2AdmissionCase)
    : []
}

export const admissionsApi = {
  getAdmissions: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/wards/admissions/', {
        ...options,
        params,
      })
      return normalizeListResponse(response)
    } catch (error) {
      rethrowAbortError(error)
      throw new Error(handleApiError(error, 'Failed to fetch admissions'))
    }
  },

  getAdmission: async (id) => {
    try {
      return await apiClient.get(`/wards/admissions/${id}/`)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admission'))
    }
  },

  createAdmission: async (data) => {
    try {
      return await apiClient.post('/wards/admissions/', data)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create admission'))
    }
  },

  updateAdmission: async (id, data) => {
    try {
      return await apiClient.put(`/wards/admissions/${id}/`, data)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update admission'))
    }
  },

  dischargePatient: async (id, data) => {
    try {
      return await apiClient.post(`/wards/admissions/${id}/discharge/`, data)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to discharge patient'))
    }
  },

  getCases: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const query = { limit: normalizeLimit(params) }
        if (params.cursor || params.next_cursor) {
          query.cursor = params.cursor || params.next_cursor
        }
        const response = await v2Api.getAdmissionCases({ query, signal: options.signal })
        return adaptV2AdmissionCaseList(response)
      }
      return await apiClient.get('/admissions/cases/', { ...options, params })
    } catch (error) {
      rethrowAbortError(error)
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admission cases'))
      }
      throw new Error(handleApiError(error, 'Failed to fetch admission cases'))
    }
  },
  getCase: (id) => apiClient.get(`/admissions/cases/${id}/`),
  getTasks: (params = {}) => apiClient.get('/admissions/tasks/', { params }),
  startCase: (data) => apiClient.post('/admissions/cases/start/', data),
  clearRegistration: (id, notes = '') => apiClient.post(`/admissions/cases/${id}/registration-clear/`, { notes }),
  clearFinancial: (id, notes = '') => apiClient.post(`/admissions/cases/${id}/financial-clear/`, { notes }),
  reserveBed: (id, data) => apiClient.post(`/admissions/cases/${id}/reserve-bed/`, data),
  addAdvisoryTask: (id, data) => apiClient.post(`/admissions/cases/${id}/advisory-tasks/`, data),
  activateCase: (id, data = {}) => apiClient.post(`/admissions/cases/${id}/activate/`, data),
  completeIntake: (id) => apiClient.post(`/admissions/cases/${id}/complete-intake/`, {}),
  cancelCase: (id, notes = '') => apiClient.post(`/admissions/cases/${id}/cancel/`, { notes }),
  completeTask: (id, notes = '') => apiClient.post(`/admissions/tasks/${id}/complete/`, { notes }),
  acknowledgeTask: (id, notes = '') => apiClient.post(`/admissions/tasks/${id}/acknowledge/`, { notes }),

  searchPatients: async (query) => {
    try {
      if (!query || query.length < 2) {
        return []
      }
      return await apiClient.get(`/patients/search/?query=${encodeURIComponent(query)}`)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search patients'))
    }
  },

  searchPractitioners: async (query, doctorsOnly = false) => {
    try {
      if (!query || query.length < 2) {
        return []
      }

      const params = new URLSearchParams({ q: query })
      if (doctorsOnly) {
        params.append('doctors_only', 'true')
      }

      const response = await apiClient.get(`/users/practitioners/search/?${params.toString()}`)
      if (response?.practitioners) {
        return response.practitioners
      }
      return Array.isArray(response) ? response : []
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search practitioners'))
    }
  },
}
