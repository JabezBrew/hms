import { apiClient } from '@/lib/api-client'

export const onboardingApi = {
  getActiveFlows: async () => {
    return apiClient.get('/workflows/onboarding/flows/active/')
  },

  getProgress: async (flowKeys = []) => {
    const params = new URLSearchParams()
    if (flowKeys.length > 0) {
      params.set('flow_keys', flowKeys.join(','))
    }
    const query = params.toString()
    return apiClient.get(`/workflows/onboarding/progress/${query ? `?${query}` : ''}`)
  },

  startProgress: async ({ flow_key, flow_version }) => {
    return apiClient.post('/workflows/onboarding/progress/start/', {
      flow_key,
      ...(flow_version ? { flow_version } : {}),
    })
  },

  ingestEvents: async (events) => {
    return apiClient.post('/workflows/onboarding/events/ingest/', { events })
  },

  skipStep: async ({ flow_key, flow_version, step_id, reason }) => {
    return apiClient.post('/workflows/onboarding/steps/skip/', {
      flow_key,
      step_id,
      ...(flow_version ? { flow_version } : {}),
      ...(reason ? { reason } : {}),
    })
  },
}
