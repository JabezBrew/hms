import { useMutation } from '@tanstack/react-query'

import { aiAssistantApi } from '@/shared/api/aiAssistant'

export const COPILOT_TIME_WINDOWS = Object.freeze([
  { value: '24h', label: '24h' },
  { value: '72h', label: '72h' },
  { value: '7d', label: '7d' },
])

const BAND_META = Object.freeze({
  normal: {
    label: 'Normal',
    className: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  },
  advisory: {
    label: 'Advisory',
    className: 'bg-amber-50 border-amber-200 text-amber-700',
  },
  needs_review: {
    label: 'Needs Review',
    className: 'bg-rose-50 border-rose-200 text-rose-700',
  },
  fallback: {
    label: 'Fallback',
    className: 'bg-rose-50 border-rose-200 text-rose-700',
  },
})

export function getCopilotConfidenceMeta(confidenceBand) {
  return BAND_META[confidenceBand] || BAND_META.needs_review
}

export function formatCopilotCitation(citation) {
  const sourceType = String(citation?.type || citation?.source || 'source').trim()
  const sourceId = String(citation?.id || citation?.source_id || '').trim()
  if (!sourceId) return sourceType

  const shortId = sourceId.length > 10 ? sourceId.slice(0, 10) : sourceId
  return `${sourceType}:${shortId}`
}

export function useChronicleCopilotSummary() {
  // No cache invalidation: summaries are transient generated responses and do not mutate chronicle data.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: ({
      patientId,
      timeWindow = '24h',
      focus = 'handoff',
      encounterId,
    } = {}) =>
      aiAssistantApi.summarizeChronicle({
        patientId,
        timeWindow,
        focus,
        encounterId,
      }),
  })
}

export function useChronicleCopilotAsk() {
  // No cache invalidation: Q&A returns a transient answer and does not persist patient state.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: ({
      patientId,
      question,
      timeWindow = '24h',
      encounterId,
      constraints,
    } = {}) =>
      aiAssistantApi.askChronicle({
        patientId,
        question,
        timeWindow,
        encounterId,
        constraints,
      }),
  })
}
