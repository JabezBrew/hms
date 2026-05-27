import { useMutation } from '@tanstack/react-query'
import { diffWords } from 'diff'

import { aiAssistantApi } from '@/shared/api/aiAssistant'

const SEVERITY_WEIGHT = Object.freeze({
  critical: 0,
  major: 1,
  minor: 2,
})

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function toSubsectionFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

export function hasMeaningfulStepValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulStepValue(item))
  if (typeof value === 'object') {
    return Object.values(value).some((item) => hasMeaningfulStepValue(item))
  }
  return true
}

function coerceDraftToStepValue(step, draftText) {
  const normalizedDraft = String(draftText || '').trim()
  if (!normalizedDraft) return ''

  if (step?.type === 'structured' && Array.isArray(step?.subsections) && step.subsections.length > 0) {
    const firstSubsection = step.subsections[0]
    const subsectionKey = toSubsectionFieldKey(firstSubsection?.name || '')
    if (!subsectionKey) return normalizedDraft
    return { [subsectionKey]: normalizedDraft }
  }

  if (step?.type === 'observation' && step?.observationType && step.observationType !== 'vitals') {
    return { notes: normalizedDraft }
  }

  if (step?.type === 'condition') {
    return { diagnosis: normalizedDraft }
  }

  if (step?.type === 'medication_administration') {
    return { notes: normalizedDraft }
  }

  return normalizedDraft
}

export function buildWorkflowNoteData(steps = [], formData = {}) {
  const finalData = {}
  steps.forEach((step) => {
    if (!step?.id) return
    const value = formData?.[step.id]
    if (!hasMeaningfulStepValue(value)) return
    finalData[step.id] = value
  })
  return finalData
}

export function mapDraftSectionsToWorkflow(steps = [], sections = [], citations = []) {
  const lookup = new Map()
  const sectionByStepId = {}
  const draftTextByStepId = {}
  const citationsByStepId = {}

  sections.forEach((section) => {
    if (!section || typeof section !== 'object') return
    const keyToken = normalizeToken(section.section_key || section.id)
    const titleToken = normalizeToken(section.section_title || section.section)
    if (keyToken && !lookup.has(keyToken)) lookup.set(keyToken, section)
    if (titleToken && !lookup.has(titleToken)) lookup.set(titleToken, section)
  })

  steps.forEach((step) => {
    if (!step?.id) return
    const idToken = normalizeToken(step.id)
    const titleToken = normalizeToken(step.title)
    const matched = lookup.get(idToken) || lookup.get(titleToken)
    if (!matched) return

    const stepId = step.id
    sectionByStepId[stepId] = matched
    draftTextByStepId[stepId] = String(matched.draft_text || '').trim()

    citationsByStepId[stepId] = citations.filter((citation) => {
      const citationIdToken = normalizeToken(citation?.id || citation?.source_id)
      const citationSectionToken = normalizeToken(citation?.section || citation?.source)
      const matchedKeyToken = normalizeToken(matched.section_key)
      const matchedTitleToken = normalizeToken(matched.section_title)
      if (citationIdToken && matchedKeyToken && citationIdToken === matchedKeyToken) return true
      if (citationSectionToken && matchedTitleToken && citationSectionToken === matchedTitleToken) return true
      return false
    })
  })

  return {
    sectionByStepId,
    draftTextByStepId,
    citationsByStepId,
  }
}

export function applyDraftToWorkflowData({
  steps = [],
  currentFormData = {},
  draftTextByStepId = {},
  mode = 'empty_only',
}) {
  const merged = { ...currentFormData }

  steps.forEach((step) => {
    const stepId = step?.id
    if (!stepId) return

    const draftText = draftTextByStepId[stepId]
    if (!String(draftText || '').trim()) return

    if (mode === 'empty_only' && hasMeaningfulStepValue(currentFormData?.[stepId])) {
      return
    }

    merged[stepId] = coerceDraftToStepValue(step, draftText)
  })

  return merged
}

export function stringifyStepValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = stringifyStepValue(item)
      return text ? [text] : []
    }).join('; ')
  }
  if (typeof value === 'object') {
    const lines = []
    Object.entries(value).forEach(([key, item]) => {
      const text = stringifyStepValue(item)
      if (!text) return
      lines.push(`${key}: ${text}`)
    })
    return lines.join('\n')
  }
  return String(value).trim()
}

export function buildStepDiff(baseValue, currentValue) {
  const baseline = stringifyStepValue(baseValue)
  const current = stringifyStepValue(currentValue)
  return {
    baseline,
    current,
    segments: diffWords(baseline || ' ', current || ' '),
  }
}

export function sortLintIssues(issues = []) {
  return issues.toSorted((left, right) => {
    const leftRank = SEVERITY_WEIGHT[String(left?.severity || '').toLowerCase()] ?? 99
    const rightRank = SEVERITY_WEIGHT[String(right?.severity || '').toLowerCase()] ?? 99
    if (leftRank !== rightRank) return leftRank - rightRank
    return String(left?.section || '').localeCompare(String(right?.section || ''))
  })
}

export function evaluateLintGate({
  lintResult,
  lintDataHash,
  currentDataHash,
  majorAcknowledged,
}) {
  if (!lintResult || !lintDataHash || lintDataHash !== currentDataHash) {
    return {
      canComplete: false,
      requiresLintRun: true,
      reason: 'Run quality check on the latest note changes.',
    }
  }

  if (lintResult.can_finalize === false) {
    return {
      canComplete: false,
      requiresLintRun: false,
      reason: 'Critical quality issues must be resolved before completion.',
    }
  }

  if (lintResult.requires_major_acknowledgement && !majorAcknowledged) {
    return {
      canComplete: false,
      requiresLintRun: false,
      reason: 'Acknowledge major issues to proceed.',
    }
  }

  return {
    canComplete: true,
    requiresLintRun: false,
    reason: null,
  }
}

export function useAINoteDraft() {
  // No cache invalidation: this mutation returns a transient AI draft preview and does not persist clinical note data.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: ({
      patientId,
      templateId,
      templateRevisionId,
      encounterId,
      prompt,
    } = {}) =>
      aiAssistantApi.generateNoteDraft({
        patientId,
        templateId,
        templateRevisionId,
        encounterId,
        prompt,
      }),
  })
}

export function useAINoteLint() {
  // No cache invalidation: linting evaluates the local draft payload and does not update server-side note state.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: ({
      patientId,
      templateId,
      templateRevisionId,
      encounterId,
      noteData,
    } = {}) =>
      aiAssistantApi.lintNoteDraft({
        patientId,
        templateId,
        templateRevisionId,
        encounterId,
        noteData,
      }),
  })
}
