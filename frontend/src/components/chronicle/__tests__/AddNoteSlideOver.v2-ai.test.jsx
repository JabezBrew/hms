import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AddNoteSlideOver from '../AddNoteSlideOver'

vi.mock('../DynamicWorkflowStep', () => ({
  default: () => <div data-testid="dynamic-workflow-step" />,
}))

vi.mock('../NoteTypeSelector', () => ({
  default: () => <div data-testid="note-type-selector" />,
}))

vi.mock('@/hooks/useNoteWorkflow', () => ({
  useNoteWorkflow: () => ({
    template: {
      id: 'template-1',
      title: 'Progress Note',
      category: 'progress',
    },
    templateRevisionId: 'revision-1',
    steps: [{ id: 'subjective', title: 'Subjective' }],
    totalSteps: 1,
    currentStep: 1,
    formData: { subjective: '' },
    isSaving: false,
    lastSaved: null,
    error: null,
    isLoading: false,
    startWorkflow: vi.fn(),
    updateStepData: vi.fn(),
    saveDraft: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    goToStep: vi.fn(),
    completeWorkflow: vi.fn(),
    resetWorkflow: vi.fn(),
  }),
}))

vi.mock('@/features/clinical-notes/hooks', () => ({
  applyDraftToWorkflowData: vi.fn(() => ({})),
  buildStepDiff: vi.fn(() => ({ baseline: '', current: '', segments: [] })),
  buildWorkflowNoteData: vi.fn(() => ({})),
  evaluateLintGate: vi.fn(() => ({ canComplete: true, requiresLintRun: false })),
  mapDraftSectionsToWorkflow: vi.fn(() => ({
    draftTextByStepId: {},
    citationsByStepId: {},
  })),
  sortLintIssues: vi.fn(() => []),
  useAINoteDraft: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useAINoteLint: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

function renderSlideOver() {
  return render(
    <AddNoteSlideOver
      open
      onClose={vi.fn()}
      patient={{ id: 'patient-1', name: 'Ama Mensah' }}
    />
  )
}

describe('AddNoteSlideOver Rust V2 AI guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__
  })

  it('hides AI note assistant controls in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }

    renderSlideOver()

    expect(screen.queryByText('AI Note Assistant')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /generate draft/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run quality check/i })).not.toBeInTheDocument()
  })

  it('keeps AI note assistant controls available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }

    renderSlideOver()

    expect(screen.getByText('AI Note Assistant')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate draft/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /run quality check/i }).length).toBeGreaterThan(0)
  })
})
