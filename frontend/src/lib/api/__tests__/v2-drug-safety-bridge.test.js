import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drugSafetyApi } from '../drug-safety';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 drug safety allergy bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({
      getAccessToken: () => 'access-token-123',
      getFacilityCode: () => 'HMS',
    });
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('loads patient allergies through patient-scoped Rust /api/v2 clinical allergies', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'allergy-1',
              patient_id: 'patient-1',
              substance: 'Penicillin',
              reaction: 'Rash',
              severity: 'moderate',
              status: 'active',
              created_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: {
            limit: 50,
            has_next: false,
            next_cursor: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await drugSafetyApi.getPatientAllergies(
      'patient-1',
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/allergies?limit=50',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual({
      count: 1,
      allergies: [
        {
          id: 'allergy-1',
          patient: 'patient-1',
          patient_id: 'patient-1',
          allergen_name: 'Penicillin',
          substance: 'Penicillin',
          reaction_description: 'Rash',
          severity: 'moderate',
          status: 'active',
          is_active: true,
          allergy_type: 'other',
          allergy_type_display: 'Other',
          notes: '',
          created_at: '2026-05-12T08:00:00Z',
          created_by_name: 'HMS V2',
          verified_by: null,
          verified_by_name: null,
          verified_at: null,
        },
      ],
    });
  });

  it('creates patient allergies through the Rust patient-scoped allergy contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'allergy-2',
            patient_id: 'patient-1',
            substance: 'Latex',
            reaction: 'Wheezing',
            severity: 'severe',
            status: 'active',
            created_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await drugSafetyApi.createAllergy({
      patient: 'patient-1',
      allergen_name: 'Latex',
      reaction_description: 'Wheezing',
      severity: 'life_threatening',
      allergy_type: 'environmental',
      notes: 'Operating theatre reaction',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/allergies',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          substance: 'Latex',
          reaction: 'Wheezing',
          severity: 'severe',
        }),
      }),
    );
    expect(response).toEqual(expect.objectContaining({
      id: 'allergy-2',
      patient: 'patient-1',
      allergen_name: 'Latex',
      reaction_description: 'Wheezing',
      is_active: true,
    }));
  });

  it('uses patient-scoped Rust allergy lists and refuses unbounded global allergy fetches', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [],
          page: {
            limit: 25,
            has_next: false,
            next_cursor: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await expect(drugSafetyApi.getAllergies({ patient_id: 'patient-1', limit: 25 })).resolves.toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/allergies?limit=25',
      expect.objectContaining({ method: 'GET' }),
    );

    globalThis.fetch.mockClear();
    await expect(drugSafetyApi.getAllergies()).resolves.toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves AbortError from Rust allergy reads', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      drugSafetyApi.getPatientAllergies('patient-1', { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('fails closed for allergy operations without Rust V2 contracts', async () => {
    await expect(drugSafetyApi.getAllergy('allergy-1')).rejects.toThrow(
      'Drug safety allergy operation is not supported by Rust V2',
    );
    await expect(drugSafetyApi.updateAllergy('allergy-1', { severity: 'mild' })).rejects.toThrow(
      'Drug safety allergy operation is not supported by Rust V2',
    );
    await expect(drugSafetyApi.deleteAllergy('allergy-1')).rejects.toThrow(
      'Drug safety allergy operation is not supported by Rust V2',
    );
    await expect(drugSafetyApi.verifyAllergy('allergy-1')).rejects.toThrow(
      'Drug safety allergy operation is not supported by Rust V2',
    );
    await expect(drugSafetyApi.deactivateAllergy('allergy-1')).rejects.toThrow(
      'Drug safety allergy operation is not supported by Rust V2',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for drug knowledge and alert operations without Rust V2 contracts', async () => {
    await expect(
      drugSafetyApi.checkPrescriptionSafety({
        patient_id: 'patient-1',
        medication_name: 'Warfarin',
      }),
    ).rejects.toThrow('/api/v2 drug safety check contract is unavailable in Rust V2 mode.');

    await expect(drugSafetyApi.searchDrugs('warfarin')).rejects.toThrow(
      '/api/v2 drug search contract is unavailable in Rust V2 mode.',
    );
    await expect(drugSafetyApi.getDrugForms('11289')).rejects.toThrow(
      '/api/v2 drug forms contract is unavailable in Rust V2 mode.',
    );
    await expect(drugSafetyApi.getAlerts({ patient_id: 'patient-1' })).rejects.toThrow(
      '/api/v2 drug safety alerts contract is unavailable in Rust V2 mode.',
    );
    await expect(drugSafetyApi.getAlert('alert-1')).rejects.toThrow(
      '/api/v2 drug safety alerts contract is unavailable in Rust V2 mode.',
    );
    await expect(drugSafetyApi.overrideAlert('alert-1', 'Clinician reviewed')).rejects.toThrow(
      '/api/v2 drug safety alerts contract is unavailable in Rust V2 mode.',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
