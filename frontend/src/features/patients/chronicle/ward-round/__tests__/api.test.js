import { describe, expect, it, vi } from 'vitest'
import { WARD_ROUND_COMMIT_PATH, WARD_ROUNDS_PATH, wardRoundApi } from '../api'

vi.mock('@/lib/api/v2/client', () => ({
  v2Request: vi.fn(),
  v2Api: { getPatientChronicleCurrentWardRound: vi.fn(), patchPatientChronicleWardRound: vi.fn() },
}))

vi.mock('@/lib/api/v2/errors', () => ({
  handleV2ApiError: (_error, message) => message,
}))

import { v2Api, v2Request } from '@/lib/api/v2/client'

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
  it('loads existing drafts with cancellation and distinguishes no draft from access or patient errors', async () => {
    const signal = new AbortController().signal
    v2Api.getPatientChronicleCurrentWardRound.mockResolvedValueOnce({ data: { id: 'round-1' } })
    expect(await wardRoundApi.current('patient-1', { signal })).toEqual({ id: 'round-1' })
    expect(v2Api.getPatientChronicleCurrentWardRound).toHaveBeenCalledWith({ patient_id: 'patient-1' }, { signal })
    v2Api.getPatientChronicleCurrentWardRound.mockRejectedValueOnce({ status: 404, data: { error: { code: 'ward_round_not_found' } } })
    expect(await wardRoundApi.current('patient-1')).toBeNull()
    v2Api.getPatientChronicleCurrentWardRound.mockRejectedValueOnce({ status: 404, data: { error: { code: 'patient_not_found' } } })
    await expect(wardRoundApi.current('patient-1')).rejects.toMatchObject({ status: 404 })
    const abort = new DOMException('Cancelled', 'AbortError')
    v2Api.getPatientChronicleCurrentWardRound.mockRejectedValueOnce(abort)
    await expect(wardRoundApi.current('patient-1')).rejects.toBe(abort)
  })

  it('updates a restored draft using its expected version instead of blind upsert', async () => {
    const signal = new AbortController().signal
    const payload = { ward_round_id: 'round-1', expected_version: 7, admission_case_id: 'admission-1', note: { assessment: 'Improving' }, actions: {} }
    v2Api.patchPatientChronicleWardRound.mockResolvedValue({ data: { id: 'round-1', version: 8, actions: [] } })
    await expect(wardRoundApi.saveDraft('patient-1', payload, { signal })).resolves.toMatchObject({ id: 'round-1', version: 8 })
    expect(v2Api.patchPatientChronicleWardRound).toHaveBeenCalledWith(
      { patient_id: 'patient-1', round_id: 'round-1' },
      expect.objectContaining({ expected_version: 7, note_sections: expect.objectContaining({ assessment: 'Improving' }) }),
      { signal },
    )
    expect(v2Request).not.toHaveBeenCalled()
  })

  it('does not replace draft actions after a stale-version conflict', async () => {
    v2Api.patchPatientChronicleWardRound.mockRejectedValue({ status: 409 })
    await expect(wardRoundApi.saveDraft('patient-1', { ward_round_id: 'round-1', expected_version: 7, note: {}, actions: { medications: [{ medication_name: 'Test medication' }] } })).rejects.toMatchObject({ status: 409 })
    expect(v2Request).not.toHaveBeenCalled()
  })

  it('preserves restored prescription states when rebuilding draft actions', async () => {
    v2Api.patchPatientChronicleWardRound.mockResolvedValue({ data: { id: 'round-1', version: 2, actions: [] } })
    v2Request.mockResolvedValue({ data: { id: 'round-1', version: 3, actions: [] } })
    await wardRoundApi.saveDraft('patient-1', {
      ward_round_id: 'round-1', expected_version: 1, note: {},
      actions: { medications: ['on_hold', 'stopped', 'completed'].map((status) => ({ prescription_id: `prescription-${status}`, medication_name: 'Test medication', status })) },
    })
    expect(v2Request.mock.calls.map(([request]) => request.body.payload.status)).toEqual(['on_hold', 'stopped', 'completed'])
  })

  it('retains the last acknowledged draft version after partial action save failure', async () => {
    v2Api.patchPatientChronicleWardRound.mockResolvedValue({ data: { id: 'round-1', version: 8, actions: [{ id: 'old-action', status: 'draft' }] } })
    v2Request.mockResolvedValueOnce({ data: { id: 'round-1', version: 9, actions: [] } }).mockRejectedValueOnce(new Error('Offline'))
    await expect(wardRoundApi.saveDraft('patient-1', {
      ward_round_id: 'round-1', expected_version: 7, note: {},
      actions: { medications: [{ medication_name: 'Test medication', dose: '1 g', frequency: 'Daily' }] },
    })).rejects.toMatchObject({ confirmedDraftIdentity: { id: 'round-1', version: 9 } })
  })

  it('retains the saved draft version when the subsequent commit is rejected', async () => {
    v2Api.patchPatientChronicleWardRound.mockResolvedValue({ data: { id: 'round-1', version: 8, actions: [] } })
    v2Request.mockRejectedValueOnce({ status: 409 })
    await expect(wardRoundApi.commit('patient-1', { ward_round_id: 'round-1', expected_version: 7, note: {}, actions: {} })).rejects.toMatchObject({
      status: 409, confirmedDraftIdentity: { id: 'round-1', version: 8 },
    })
  })

})
