import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPrescription,
  discontinuePrescription,
  fetchPatientActivePrescriptions,
  fetchPrescription,
  holdPrescription,
  resumePrescription,
  updatePrescription,
} from '../usePrescriptionMutations';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
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
      }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      medication_name: 'Amlodipine',
      dose: '5 mg',
      frequency: 'daily',
      route: 'oral',
    });
    expect(response).toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        dosage: '5 mg',
      }),
    );
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('generates MAR after creating a Rust V2 prescription when requested', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'rx-1',
              patient_id: 'patient-1',
              medication_name: 'Amlodipine',
              dose: '5 mg',
              route: 'oral',
              frequency: 'bid',
              status: 'active',
              prescribed_at: '2026-05-12T08:30:00Z',
            },
            meta: {},
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              prescription_id: 'rx-1',
              created_count: 14,
              existing_count: 0,
              requested_dose_count: 14,
            },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const response = await createPrescription({
      patient: 'patient-1',
      medication_name: 'Amlodipine',
      dosage: '5 mg',
      route: 'oral',
      frequency: 'bid',
      start_date: '2026-06-04',
      duration_days: 7,
      generate_mar: 'yes',
      mar_days: 7,
      admission_case_id: 'admission-1',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/patients/patient-1/clinical/prescriptions',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      medication_name: 'Amlodipine',
      dose: '5 mg',
      frequency: 'bid',
      route: 'oral',
      start_date: '2026-06-04',
      duration_days: 7,
      admission_case_id: 'admission-1',
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/clinical/prescriptions/rx-1/generate-mar',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body)).toEqual({
      admission_case_id: 'admission-1',
      days: 7,
    });
    expect(response).toEqual(
      expect.objectContaining({
        id: 'rx-1',
        mar_generated: true,
        mar_generation: expect.objectContaining({
          created_count: 14,
        }),
      }),
    );
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

  it('fetches prescription detail through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'rx-1',
            patient_id: 'patient-1',
            medication_name: 'Amlodipine',
            dose: '10 mg',
            frequency: 'twice daily',
            status: 'active',
            prescribed_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(fetchPrescription('rx-1', { signal: new AbortController().signal })).resolves.toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        dosage: '10 mg',
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/prescriptions/rx-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('fetches active patient prescriptions through the bounded Rust patient list contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'rx-active',
              patient_id: 'patient-1',
              medication_name: 'Amlodipine',
              dose: '10 mg',
              frequency: 'daily',
              status: 'active',
              prescribed_at: '2026-05-12T08:30:00Z',
            },
            {
              id: 'rx-stopped',
              patient_id: 'patient-1',
              medication_name: 'Lisinopril',
              dose: '5 mg',
              frequency: 'daily',
              status: 'stopped',
              prescribed_at: '2026-05-11T08:30:00Z',
            },
          ],
          page: { limit: 50, next_cursor: null },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      fetchPatientActivePrescriptions('patient-1', { signal: new AbortController().signal }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'rx-active',
        patient: 'patient-1',
        status: 'active',
      }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/prescriptions?limit=50',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it.each([
    ['discontinues', discontinuePrescription, { reason: 'Changed therapy' }, 'stopped'],
    ['holds', holdPrescription, { reason: 'NPO' }, 'on_hold'],
    ['resumes', resumePrescription, {}, 'active'],
  ])('%s prescriptions through Rust /api/v2 status updates', async (
    _label,
    action,
    variables,
    status,
  ) => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'rx-1',
            patient_id: 'patient-1',
            medication_name: 'Amlodipine',
            dose: '10 mg',
            frequency: 'twice daily',
            status,
            prescribed_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(action('rx-1', variables)).resolves.toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        status,
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/prescriptions/rx-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ status }),
      }),
    );
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
