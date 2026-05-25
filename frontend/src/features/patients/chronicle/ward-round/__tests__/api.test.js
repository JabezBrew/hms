import { describe, expect, it, vi } from 'vitest'
import { WARD_ROUND_COMMIT_PATH, WARD_ROUNDS_PATH, wardRoundApi } from '../api'

vi.mock('@/lib/api/v2/client', () => ({
  v2Request: vi.fn(),
}))

vi.mock('@/lib/api/v2/errors', () => ({
  handleV2ApiError: (_error, message) => message,
}))

import { v2Request } from '@/lib/api/v2/client'

describe('wardRoundApi', () => {
  it('saves drafts and commits through patient Chronicle ward-round resource endpoints with AbortSignal', async () => {
    const signal = new AbortController().signal
    const payload = {
      patient_id: 'patient-1',
      admission_case_id: 'admission-1',
      note: { assessment: 'Improving', plan: 'Continue treatment' },
      actions: {},
    }
    vi.mocked(v2Request)
      .mockResolvedValueOnce({ data: { id: 'round-1', version: 1, actions: [] } })
      .mockResolvedValueOnce({ data: { id: 'round-1', version: 2, actions: [] } })
      .mockResolvedValueOnce({ data: { ward_round: { id: 'round-1' } } })

    await wardRoundApi.saveDraft('patient-1', payload, { signal })
    await wardRoundApi.commit('patient-1', payload, { signal })

    expect(v2Request).toHaveBeenNthCalledWith(1, {
      method: 'POST',
      path: WARD_ROUNDS_PATH,
      pathParams: { patient_id: 'patient-1' },
      body: {
        admission_case_id: 'admission-1',
        note_sections: {
          interval_history: null,
          examination: null,
          assessment: 'Improving',
          plan: 'Continue treatment',
          clinical_readiness_blockers: [],
        },
        rendered_note: 'ASSESSMENT\nImproving\n\nPLAN\nContinue treatment',
      },
      signal,
    })
    expect(v2Request).toHaveBeenNthCalledWith(2, {
      method: 'POST',
      path: WARD_ROUNDS_PATH,
      pathParams: { patient_id: 'patient-1' },
      body: {
        admission_case_id: 'admission-1',
        note_sections: {
          interval_history: null,
          examination: null,
          assessment: 'Improving',
          plan: 'Continue treatment',
          clinical_readiness_blockers: [],
        },
        rendered_note: 'ASSESSMENT\nImproving\n\nPLAN\nContinue treatment',
      },
      signal,
    })
    expect(v2Request).toHaveBeenNthCalledWith(3, {
      method: 'POST',
      path: WARD_ROUND_COMMIT_PATH,
      pathParams: { patient_id: 'patient-1', round_id: 'round-1' },
      body: { expected_version: 2 },
      signal,
    })
  })
})
