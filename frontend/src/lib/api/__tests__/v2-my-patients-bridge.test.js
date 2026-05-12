import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { myPatientsApi } from '../my-patients';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 my-patients bridge', () => {
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

  it('loads context patients through Rust /api/v2 and adapts them for the existing my-patients page', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'patient-1',
              patient_code: 'MRN-MAIN-2026-000001',
              display_name: 'Ama Mensah',
              sex: 'female',
              birth_year: 1989,
              status: 'active',
              context_kind: 'care_team',
              updated_at: '2026-05-12T08:00:00Z',
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

    const response = await myPatientsApi.getMyPatients({ signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/context?limit=50',
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
      next: null,
      previous: null,
      results: [
        {
          id: 'patient-1',
          patient: 'patient-1',
          patient_details: expect.objectContaining({
            id: 'patient-1',
            medical_record_number: 'MRN-MAIN-2026-000001',
            gender: 'female',
            registry_status: 'active',
            user_details: {
              first_name: 'Ama Mensah',
              last_name: '',
            },
          }),
          is_pinned: false,
          notes: 'care_team',
          added_at: '2026-05-12T08:00:00Z',
        },
      ],
    });
  });

  it('checks context membership without calling legacy my-patients endpoints', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'patient-2',
              patient_code: 'MRN-MAIN-2026-000002',
              display_name: 'Kojo Asare',
              sex: 'male',
              birth_year: 1975,
              status: 'active',
              context_kind: 'assigned',
              updated_at: '2026-05-12T08:00:00Z',
            },
          ],
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

    await expect(myPatientsApi.checkPatient('patient-2')).resolves.toEqual({
      in_list: true,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/context?limit=25&search=patient-2',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('preserves AbortError from Rust context-patient reads', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      myPatientsApi.getMyPatients({ signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('fails closed for curated-list mutations that do not have a Rust V2 contract', async () => {
    await expect(myPatientsApi.addPatient('patient-1')).rejects.toThrow(
      'My Patients curated-list mutations are not supported by Rust V2',
    );
    await expect(myPatientsApi.removePatient('patient-1')).rejects.toThrow(
      'My Patients curated-list mutations are not supported by Rust V2',
    );
    await expect(myPatientsApi.removeEntry('patient-1')).rejects.toThrow(
      'My Patients curated-list mutations are not supported by Rust V2',
    );
    await expect(myPatientsApi.togglePin('patient-1')).rejects.toThrow(
      'My Patients curated-list mutations are not supported by Rust V2',
    );
    await expect(myPatientsApi.updateNotes('patient-1', 'note')).rejects.toThrow(
      'My Patients curated-list mutations are not supported by Rust V2',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
