import { apiClient } from '@/lib/api-client'

export const dischargeApi = {
  getCases: (params = {}) => apiClient.get('/discharges/cases/', { params }),
  getCase: (id) => apiClient.get(`/discharges/cases/${id}/`),
  getTasks: (params = {}) => apiClient.get('/discharges/tasks/', { params }),
  updateBillingCutoff: (id, billingCutoffAt) =>
    apiClient.post(`/discharges/cases/${id}/billing-cutoff/`, {
      billing_cutoff_at: billingCutoffAt,
    }),
  clearBilling: (id) => apiClient.post(`/discharges/cases/${id}/billing-clear/`, {}),
  addAdvisoryTask: (id, data) => apiClient.post(`/discharges/cases/${id}/advisory-tasks/`, data),
  finalizeCase: (id, data = {}) => apiClient.post(`/discharges/cases/${id}/finalize/`, data),
  cancelCase: (id, reason = '') => apiClient.post(`/discharges/cases/${id}/cancel/`, { reason }),
  reopenCase: (id) => apiClient.post(`/discharges/cases/${id}/reopen/`, {}),
  completeTask: (id, notes = '') => apiClient.post(`/discharges/tasks/${id}/complete/`, { notes }),
  acknowledgeTask: (id, notes = '') => apiClient.post(`/discharges/tasks/${id}/acknowledge/`, { notes }),
}

