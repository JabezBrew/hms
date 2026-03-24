import { apiClient, handleApiError } from '@/lib/api-client'

export const admissionsApi = {
  getAdmissions: async (params = {}) => {
    try {
      return await apiClient.getAll('/wards/admissions/', { params })
    } catch (error) {
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

  getCases: (params = {}) => apiClient.get('/admissions/cases/', { params }),
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
