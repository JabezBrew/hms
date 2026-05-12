import { apiClient, handleApiError } from '@/lib/api-client'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'

const RUST_V2_AI_DEFERRED_MESSAGE =
  'AI assistant features are intentionally deferred in Rust V2 pending product decisions on model provider, PHI boundary, audit retention, safety review, and rollout controls.'

function throwIfRustV2AiDeferred() {
  if (isRustV2ApiMode()) {
    throw new Error(RUST_V2_AI_DEFERRED_MESSAGE)
  }
}

export const aiAssistantApi = {
  parseOmniIntent: async ({ text, context } = {}) => {
    throwIfRustV2AiDeferred()
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
    throwIfRustV2AiDeferred()
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
    throwIfRustV2AiDeferred()
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
    throwIfRustV2AiDeferred()
    try {
      return await apiClient.post('/ai/labs/interpret/', {
        order_id: orderId,
        audience,
      })
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to interpret lab order'))
    }
  },

  summarizeChronicle: async ({
    patientId,
    timeWindow = '24h',
    focus = 'handoff',
    encounterId,
  } = {}) => {
    throwIfRustV2AiDeferred()
    if (!patientId) {
      throw new Error('Patient ID is required for chronicle summary')
    }

    const payload = {
      time_window: String(timeWindow || '24h'),
      focus,
    }
    if (encounterId) {
      payload.encounter_id = encounterId
    }

    try {
      return await apiClient.post(`/ai/chronicle/${patientId}/summarize/`, payload)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to summarize chronicle'))
    }
  },

  askChronicle: async ({
    patientId,
    question,
    timeWindow = '24h',
    encounterId,
    constraints,
  } = {}) => {
    throwIfRustV2AiDeferred()
    if (!patientId) {
      throw new Error('Patient ID is required for chronicle Q&A')
    }
    if (!String(question || '').trim()) {
      throw new Error('Question is required')
    }

    const payload = {
      question: String(question).trim(),
      time_window: String(timeWindow || '24h'),
    }
    if (encounterId) {
      payload.encounter_id = encounterId
    }
    if (constraints && typeof constraints === 'object') {
      payload.constraints = constraints
    }

    try {
      return await apiClient.post(`/ai/chronicle/${patientId}/ask/`, payload)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to ask chronicle copilot'))
    }
  },

  generateNoteDraft: async ({
    patientId,
    templateId,
    templateRevisionId,
    encounterId,
    prompt,
  } = {}) => {
    throwIfRustV2AiDeferred()
    if (!patientId) {
      throw new Error('Patient ID is required for note draft generation')
    }
    if (!templateId) {
      throw new Error('Template ID is required for note draft generation')
    }
    if (!templateRevisionId) {
      throw new Error('Template revision ID is required for note draft generation')
    }

    const payload = {
      patient_id: patientId,
      template_id: templateId,
      template_revision_id: templateRevisionId,
    }
    if (encounterId) {
      payload.encounter_id = encounterId
    }
    if (String(prompt || '').trim()) {
      payload.prompt = String(prompt).trim()
    }

    try {
      return await apiClient.post('/ai/notes/draft/', payload)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to generate note draft'))
    }
  },

  lintNoteDraft: async ({
    patientId,
    templateId,
    templateRevisionId,
    encounterId,
    noteData,
  } = {}) => {
    throwIfRustV2AiDeferred()
    if (!patientId) {
      throw new Error('Patient ID is required for note lint')
    }
    if (!templateId) {
      throw new Error('Template ID is required for note lint')
    }
    if (!templateRevisionId) {
      throw new Error('Template revision ID is required for note lint')
    }

    const payload = {
      patient_id: patientId,
      template_id: templateId,
      template_revision_id: templateRevisionId,
      note_data: noteData && typeof noteData === 'object' ? noteData : {},
    }
    if (encounterId) {
      payload.encounter_id = encounterId
    }

    try {
      return await apiClient.post('/ai/notes/lint/', payload)
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to run note quality check'))
    }
  },
}
