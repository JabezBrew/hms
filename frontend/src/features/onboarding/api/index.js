import { apiClient } from '@/lib/api-client'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'

// Rust V2 has no guided-onboarding producer contract. Do not fall through to
// the legacy server when this optional startup surface is unavailable.
export const isOnboardingTransportAvailable = () => !isRustV2ApiMode()

export class OnboardingUnavailableError extends Error {
  constructor() {
    super('Guided onboarding is unavailable.')
    this.name = 'OnboardingUnavailableError'
  }
}

function requireOnboardingTransport() {
  if (!isOnboardingTransportAvailable()) throw new OnboardingUnavailableError()
}

export const onboardingApi = {
  getActiveFlows: async ({ signal } = {}) => {
    requireOnboardingTransport()
    return apiClient.get('/workflows/onboarding/flows/active/', { signal })
  },

  getProgress: async (flowKeys = [], { signal } = {}) => {
    requireOnboardingTransport()
    const params = new URLSearchParams()
    if (flowKeys.length > 0) {
      params.set('flow_keys', flowKeys.join(','))
    }
    const query = params.toString()
    return apiClient.get(`/workflows/onboarding/progress/${query ? `?${query}` : ''}`, { signal })
  },

  startProgress: async ({ flow_key, flow_version }) => {
    requireOnboardingTransport()
    return apiClient.post('/workflows/onboarding/progress/start/', {
      flow_key,
      ...(flow_version ? { flow_version } : {}),
    })
  },

  ingestEvents: async (events) => {
    requireOnboardingTransport()
    return apiClient.post('/workflows/onboarding/events/ingest/', { events })
  },

  skipStep: async ({ flow_key, flow_version, step_id, reason }) => {
    requireOnboardingTransport()
    return apiClient.post('/workflows/onboarding/steps/skip/', {
      flow_key,
      step_id,
      ...(flow_version ? { flow_version } : {}),
      ...(reason ? { reason } : {}),
    })
  },
}
