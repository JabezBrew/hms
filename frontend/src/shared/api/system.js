import { apiClient } from '@/lib/api-client'

export const systemApi = {
  getDeploymentCapabilities: () => apiClient.get('/settings/deployment-capabilities/'),
  getFeatureEntitlements: (params, options = {}) =>
    apiClient.getWithPagination('/settings/feature-entitlements/', { ...options, params }),
  createFeatureEntitlement: (data) => apiClient.post('/settings/feature-entitlements/', data),
  updateFeatureEntitlement: (id, data) => apiClient.patch(`/settings/feature-entitlements/${id}/`, data),
  deleteFeatureEntitlement: (id) => apiClient.delete(`/settings/feature-entitlements/${id}/`),
}
