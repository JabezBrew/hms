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

function adaptV2FeatureEntitlement(item = {}) {
  const featureKey = item.feature || item.feature_key || item.key
  return {
    id: featureKey,
    feature: featureKey,
    feature_key: featureKey,
    scope: 'global',
    is_enabled: item.override_enabled ?? item.enabled,
    effective_enabled: item.enabled,
    profile_default: item.profile_default,
    source: item.override_enabled === null ? 'deployment_profile' : 'global_override',
    updated_at: item.updated_at || null,
    updated_by_user_id: item.updated_by_user_id || null,
  }
}

function adaptV2FeatureEntitlementList(response) {
  const results = Array.isArray(response?.data)
    ? response.data
      .filter((item) => item.override_enabled !== null)
      .map(adaptV2FeatureEntitlement)
    : []

  return {
    results,
    count: results.length,
    next: null,
    previous: null,
  }
}

function normalizeFeatureEnabled(data = {}) {
  if (data.is_enabled !== undefined) {
    return Boolean(data.is_enabled)
  }
  return Boolean(data.enabled)
}

function assertGlobalFeatureOverride(data = {}) {
  if (data.scope && data.scope !== 'global') {
    throw new Error('Rust V2 exposes only global feature overrides; facility feature overrides are not available yet.')
  }
}

async function patchV2FeatureEntitlement(featureKey, data = {}, options = {}) {
  const response = await v2Api.patchAdminFeature(
    { key: featureKey },
    { enabled: normalizeFeatureEnabled(data) },
    { signal: options.signal },
  )
  return adaptV2FeatureEntitlement(response?.data)
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
  getFeatureEntitlements: async (params, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return adaptV2FeatureEntitlementList(
          await v2Api.getAdminFeatures({ signal: options.signal }),
        )
      }
      return apiClient.getWithPagination('/settings/feature-entitlements/', { ...options, params })
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to load feature entitlements'))
      }
      throw error
    }
  },
  createFeatureEntitlement: async (data, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        assertGlobalFeatureOverride(data)
        return await patchV2FeatureEntitlement(data.feature_key || data.feature, data, options)
      } catch (error) {
        if (/facility feature overrides/i.test(error?.message || '')) {
          throw error
        }
        throw new Error(handleV2ApiError(error, 'Failed to create feature entitlement'))
      }
    }
    return apiClient.post('/settings/feature-entitlements/', data)
  },
  updateFeatureEntitlement: async (id, data, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        assertGlobalFeatureOverride(data)
        return await patchV2FeatureEntitlement(data.feature_key || data.feature || id, data, options)
      } catch (error) {
        if (/facility feature overrides/i.test(error?.message || '')) {
          throw error
        }
        throw new Error(handleV2ApiError(error, 'Failed to update feature entitlement'))
      }
    }
    return apiClient.patch(`/settings/feature-entitlements/${id}/`, data)
  },
  deleteFeatureEntitlement: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.deleteAdminFeature(
          { key: id },
          { signal: options.signal },
        )
        return adaptV2FeatureEntitlement(response?.data)
      } catch (error) {
        throw new Error(handleV2ApiError(error, 'Failed to remove feature entitlement'))
      }
    }
    return apiClient.delete(`/settings/feature-entitlements/${id}/`)
  },
}
