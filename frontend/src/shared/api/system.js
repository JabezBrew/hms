import { apiClient } from '@/lib/api-client'
import { handleV2ApiError } from '@/lib/api/v2/errors'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { v2Api } from '@/lib/api/v2/client'

const V2_FEATURE_ALIASES = Object.freeze({
  patients: ['patient_chronicle', 'patient_registration'],
  encounters: ['outpatient_encounters', 'clinical_notes', 'emergency_encounters'],
  wards: ['ward_task_board'],
  admissions: ['inpatient_admissions', 'discharge_workflows'],
  nursing: ['nursing_workflows'],
  nhis: ['insurance_claims'],
  admin: ['audit', 'department_rosters'],
})

function expandV2FeatureMap(features = {}) {
  const expanded = { ...features }
  Object.entries(V2_FEATURE_ALIASES).forEach(([sourceFeature, aliases]) => {
    aliases.forEach((alias) => {
      expanded[alias] = Boolean(features[sourceFeature])
    })
  })
  return expanded
}

function adaptV2DeploymentCapabilities(response) {
  const data = response?.data
  if (!data) {
    return response
  }
  return {
    ...data,
    features: expandV2FeatureMap(data.features),
  }
}

export const systemApi = {
  getDeploymentCapabilities: async () => {
    try {
      if (isRustV2ApiMode()) {
        return adaptV2DeploymentCapabilities(await v2Api.getSystemDeploymentCapabilities())
      }
      return apiClient.get('/settings/deployment-capabilities/')
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to load deployment capabilities'))
      }
      throw error
    }
  },
  getFeatureEntitlements: (params, options = {}) =>
    apiClient.getWithPagination('/settings/feature-entitlements/', { ...options, params }),
  createFeatureEntitlement: (data) => apiClient.post('/settings/feature-entitlements/', data),
  updateFeatureEntitlement: (id, data) => apiClient.patch(`/settings/feature-entitlements/${id}/`, data),
  deleteFeatureEntitlement: (id) => apiClient.delete(`/settings/feature-entitlements/${id}/`),
}
