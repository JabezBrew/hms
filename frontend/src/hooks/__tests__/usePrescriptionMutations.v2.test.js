import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrescription, updatePrescription } from '../usePrescriptionMutations';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

describe('Rust V2 prescription mutations bridge', () => {
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

  it('creates prescriptions through Rust /api/v2 with the generated patient-scoped contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'rx-1',
            patient_id: 'patient-1',
            medication_name: 'Amlodipine',
            dose: '5 mg',
            frequency: 'daily',
            status: 'active',
            prescribed_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await createPrescription({
      patient: 'patient-1',
      medication_name: 'Amlodipine',
      dosage: '5 mg',
      frequency: 'daily',
      route: 'oral',
    }, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/prescriptions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'Content-Type': 'application/json',
          'X-Facility-Code': 'HMS',
        }),
        body: JSON.stringify({
          medication_name: 'Amlodipine',
          dose: '5 mg',
          frequency: 'daily',
        }),
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        dosage: '5 mg',
      }),
    );
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('updates prescription dose, frequency, and status through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'rx-1',
            patient_id: 'patient-1',
            medication_name: 'Amlodipine',
            dose: '10 mg',
            frequency: 'twice daily',
            status: 'stopped',
            prescribed_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      updatePrescription(
        'rx-1',
        { dosage: '10 mg', frequency: 'twice daily', status: 'stopped' },
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        dosage: '10 mg',
        status: 'stopped',
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/prescriptions/rx-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          dose: '10 mg',
          frequency: 'twice daily',
          status: 'stopped',
        }),
      }),
    );
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});
