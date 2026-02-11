import { describe, it, expect } from 'vitest'
import {
  deriveStepsFromTemplate,
  mapInitialDataToWorkflowSteps,
} from '../useNoteWorkflow'

describe('mapInitialDataToWorkflowSteps', () => {
  it('maps section keys case-insensitively for edit prefill', () => {
    const template = {
      structure: {
        sections: [
          { name: 'Subjective', type: 'text' },
          { name: 'Objective', type: 'text' },
        ],
      },
    }
    const steps = deriveStepsFromTemplate(template)

    const result = mapInitialDataToWorkflowSteps(
      {
        subjective: 'Headache started yesterday',
        OBJECTIVE: 'BP 120/80',
      },
      steps
    )

    expect(result).toEqual({
      Subjective: 'Headache started yesterday',
      Objective: 'BP 120/80',
    })
  })

  it('maps legacy string values into first structured subsection', () => {
    const template = {
      structure: {
        sections: [
          {
            name: 'Subjective',
            type: 'structured',
            subsections: [
              { name: 'Chief Complaint', type: 'text' },
              { name: 'History of Present Illness', type: 'text' },
            ],
          },
        ],
      },
    }
    const steps = deriveStepsFromTemplate(template)

    const result = mapInitialDataToWorkflowSteps(
      {
        Subjective: 'Persistent cough for three days',
      },
      steps
    )

    expect(result).toEqual({
      Subjective: {
        chief_complaint: 'Persistent cough for three days',
      },
    })
  })

  it('maps structured subsection values from human-readable keys', () => {
    const template = {
      structure: {
        sections: [
          {
            name: 'Subjective',
            type: 'structured',
            subsections: [
              { name: 'Chief Complaint', type: 'text' },
              { name: 'History of Present Illness', type: 'text' },
            ],
          },
        ],
      },
    }
    const steps = deriveStepsFromTemplate(template)

    const result = mapInitialDataToWorkflowSteps(
      {
        Subjective: {
          'Chief Complaint': 'Fever',
          'History of Present Illness': 'Started after travel',
        },
      },
      steps
    )

    expect(result).toEqual({
      Subjective: {
        chief_complaint: 'Fever',
        history_of_present_illness: 'Started after travel',
      },
    })
  })
})
