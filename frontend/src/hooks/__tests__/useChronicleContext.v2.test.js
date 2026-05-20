import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchChronicleContext } from '../useChronicleContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 Chronicle context bridge', () => {
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

  it('loads Chronicle context through Rust /api/v2 and adapts the existing UI shape', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            patient: {
              id: 'patient-1',
              patient_code: 'MRN-MAIN-2026-000001',
              display_name: 'Ama Mensah',
              first_name: 'Ama',
              last_name: 'Mensah',
              date_of_birth: '1989-04-15',
              sex: 'female',
              status: 'active',
              created_at: '2026-05-12T08:00:00Z',
              updated_at: '2026-05-12T08:00:00Z',
            },
            generated_at: '2026-05-12T09:00:00Z',
            notes: [],
            problems: [
              {
                id: 'problem-1',
                patient_id: 'patient-1',
                label: 'Hypertension',
                status: 'active',
                onset_date: null,
                created_at: '2026-05-12T08:10:00Z',
              },
            ],
            allergies: [
              {
                id: 'allergy-1',
                patient_id: 'patient-1',
                substance: 'Penicillin',
                reaction: 'Rash',
                severity: 'moderate',
                status: 'active',
                created_at: '2026-05-12T08:20:00Z',
              },
            ],
            prescriptions: [
              {
                id: 'rx-1',
                patient_id: 'patient-1',
                medication_name: 'Amlodipine',
                dose: '5 mg',
                frequency: 'daily',
                status: 'active',
                prescribed_at: '2026-05-12T08:30:00Z',
              },
            ],
            chart_entries: [
              {
                id: 'chart-1',
                patient_id: 'patient-1',
                entry_type: 'temperature',
                measured_at: '2026-05-12T08:40:00Z',
                value: '37.2',
                unit: 'C',
              },
              {
                id: 'chart-2',
                patient_id: 'patient-1',
                entry_type: 'pulse',
                measured_at: '2026-05-12T08:41:00Z',
                value: '88',
                unit: 'bpm',
              },
            ],
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await fetchChronicleContext('patient-1', { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/chronicle',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        patient: expect.objectContaining({
          id: 'patient-1',
          medical_record_number: 'MRN-MAIN-2026-000001',
          name: 'Ama Mensah',
        }),
        active_problems: [
          expect.objectContaining({ id: 'problem-1', name: 'Hypertension' }),
        ],
        allergies: [
          expect.objectContaining({ id: 'allergy-1', substance: 'Penicillin' }),
        ],
        active_medications: [
          expect.objectContaining({ id: 'rx-1', medication_name: 'Amlodipine' }),
        ],
        latest_vitals: expect.objectContaining({
          id: 'chart-2',
          recorded_at: '2026-05-12T08:41:00Z',
          temperature: '37.2',
          heart_rate: '88',
        }),
      }),
    );
  });

  it('preserves AbortError from Rust Chronicle context calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      fetchChronicleContext('patient-1', { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
