import { describe, expect, it } from 'vitest'

import {
  applyDraftToWorkflowData,
  buildStepDiff,
  buildWorkflowNoteData,
  evaluateLintGate,
  mapDraftSectionsToWorkflow,
} from '@/features/clinical-notes/hooks/useAINoteAssistant'

describe('useAINoteAssistant helpers', () => {
  it('maps draft sections to workflow steps and applies empty-only mode', () => {
    const steps = [
      { id: 'Subjective', title: 'Subjective', type: 'text' },
      { id: 'Assessment', title: 'Assessment', type: 'text' },
      {
        id: 'Plan',
        title: 'Plan',
        type: 'structured',
        subsections: [{ name: 'Immediate Plan', type: 'text' }],
      },
    ]

    const sections = [
      { section_key: 'subjective', section_title: 'Subjective', draft_text: 'AI subjective draft' },
      { section_key: 'assessment', section_title: 'Assessment', draft_text: 'AI assessment draft' },
      { section_key: 'plan', section_title: 'Plan', draft_text: 'AI plan draft' },
    ]

    const { draftTextByStepId } = mapDraftSectionsToWorkflow(steps, sections, [])
    const merged = applyDraftToWorkflowData({
      steps,
      currentFormData: {
        Subjective: 'Clinician entered subjective text',
      },
      draftTextByStepId,
      mode: 'empty_only',
    })

    expect(merged.Subjective).toBe('Clinician entered subjective text')
    expect(merged.Assessment).toBe('AI assessment draft')
    expect(merged.Plan).toEqual({ immediate_plan: 'AI plan draft' })
  })

  it('builds workflow note payload with only meaningful sections', () => {
    const steps = [
      { id: 'Subjective' },
      { id: 'Assessment' },
      { id: 'Plan' },
    ]

    const payload = buildWorkflowNoteData(steps, {
      Subjective: 'Patient improved overnight.',
      Assessment: '',
      Plan: { next_steps: 'Continue monitoring.' },
    })

    expect(payload).toEqual({
      Subjective: 'Patient improved overnight.',
      Plan: { next_steps: 'Continue monitoring.' },
    })
  })

  it('requires quality check rerun when lint result is stale', () => {
    const gate = evaluateLintGate({
      lintResult: {
        can_finalize: true,
        requires_major_acknowledgement: false,
      },
      lintDataHash: '{"Subjective":"old"}',
      currentDataHash: '{"Subjective":"new"}',
      majorAcknowledged: false,
    })

    expect(gate.canComplete).toBe(false)
    expect(gate.requiresLintRun).toBe(true)
  })

  it('blocks completion on critical issues and enforces major acknowledgement', () => {
    const criticalGate = evaluateLintGate({
      lintResult: {
        can_finalize: false,
        requires_major_acknowledgement: true,
      },
      lintDataHash: '{"Subjective":"same"}',
      currentDataHash: '{"Subjective":"same"}',
      majorAcknowledged: false,
    })
    expect(criticalGate.canComplete).toBe(false)
    expect(criticalGate.requiresLintRun).toBe(false)

    const majorGateMissingAck = evaluateLintGate({
      lintResult: {
        can_finalize: true,
        requires_major_acknowledgement: true,
      },
      lintDataHash: '{"Subjective":"same"}',
      currentDataHash: '{"Subjective":"same"}',
      majorAcknowledged: false,
    })
    expect(majorGateMissingAck.canComplete).toBe(false)

    const majorGateWithAck = evaluateLintGate({
      lintResult: {
        can_finalize: true,
        requires_major_acknowledgement: true,
      },
      lintDataHash: '{"Subjective":"same"}',
      currentDataHash: '{"Subjective":"same"}',
      majorAcknowledged: true,
    })
    expect(majorGateWithAck.canComplete).toBe(true)
  })

  it('produces diff segments for section comparison', () => {
    const diff = buildStepDiff('Patient has mild cough.', 'Patient has severe cough and fever.')
    const hasAdded = diff.segments.some((segment) => segment.added)
    const hasRemoved = diff.segments.some((segment) => segment.removed)

    expect(hasAdded).toBe(true)
    expect(hasRemoved).toBe(true)
    expect(diff.baseline).toContain('mild')
    expect(diff.current).toContain('severe')
  })
})
