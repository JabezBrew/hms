import { apiClient, handleApiError } from '@/lib/api-client'

export const aiAssistantApi = {
  parseOmniIntent: async ({ text, context } = {}) => {
    try {
      return await apiClient.post('/ai/omni/parse/', {
        text,
        ...(context ? { context } : {}),
      })
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to parse AI intent'))
    }
  },

  executeOmniPreview: async ({ text, intent, context } = {}) => {
    const payload = {}
    if (text !== undefined && text !== null) {
      payload.text = String(text)
    }
    if (intent && typeof intent === 'object') {
      payload.intent = intent
    }
    if (context && typeof context === 'object') {
      payload.context = context
    }

    try {
      return await apiClient.post('/ai/omni/execute-preview/', payload)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to preview AI command'))
    }
  },

  interpretLabResult: async ({ resultId, audience = 'clinician' } = {}) => {
    try {
      return await apiClient.post('/ai/labs/interpret/', {
        result_id: resultId,
        audience,
      })
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to interpret lab result'))
    }
  },

  interpretLabOrder: async ({ orderId, audience = 'clinician' } = {}) => {
    try {
      return await apiClient.post('/ai/labs/interpret/', {
        order_id: orderId,
        audience,
      })
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to interpret lab order'))
    }
  },
}
