import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { patientsApi } from '../patients';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 patient bridge', () => {
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

  it('searches Rust /api/v2 patients and adapts cursor envelopes for the existing registry page', async () => {
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
              created_at: '2026-05-01T08:00:00Z',
            },
          ],
          page: {
            limit: 25,
            has_next: true,
            next_cursor: 'cursor-2',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await patientsApi.searchPatientsWithMeta(
      { query: 'Ama', page_size: 25, registry_scope: 'active', include_total: 'false' },
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients?limit=25&search=Ama',
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
      results: [
        {
          id: 'patient-1',
          created_at: '2026-05-01T08:00:00Z',
          medical_record_number: 'MRN-MAIN-2026-000001',
          name: 'Ama Mensah',
          date_of_birth: '1989-01-01',
          gender: 'female',
          patient_location: null,
          active_clinic_names: [],
          registry_status: 'active',
        },
      ],
      page: 1,
      page_size: 25,
      count: 2,
      total: 2,
      count_exact: false,
      next: 'cursor-2',
      previous: null,
      next_cursor: 'cursor-2',
    });
  });

  it('preserves AbortError from Rust patient list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      patientsApi.searchPatientsWithMeta({ query: 'Ama' }, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
