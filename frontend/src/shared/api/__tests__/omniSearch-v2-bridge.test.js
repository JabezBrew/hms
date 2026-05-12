import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { omniSearchApi } from '../omniSearch';
import { omniSearchKeys } from '@/shared/lib/omniSearchKeys';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 omni search bridge', () => {
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

  it('searches patients through Rust /api/v2 without calling the legacy omni endpoint', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'patient-1',
              patient_code: 'MRN-001',
              display_name: 'Ama Mensah',
              birth_year: 1990,
              sex: 'female',
              status: 'active',
              created_at: '2026-05-12T09:00:00Z',
            },
          ],
          page: { limit: 5, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await omniSearchApi.search({
      q: 'Ama',
      types: ['patients'],
      limit: 5,
      signal,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients?limit=5&search=Ama',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal,
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(result).toEqual({
      query: 'Ama',
      types: ['patients'],
      limit: 5,
      groups: expect.objectContaining({
        recent_patients: [],
        patients: [
          expect.objectContaining({
            id: 'patient-1',
            name: 'Ama Mensah',
            medical_record_number: 'MRN-001',
            date_of_birth: '1990-01-01',
            gender: 'female',
            admission_status: 'active',
          }),
        ],
        staff: [],
        wards: [],
      }),
    });
  });

  it('does not fetch unbounded data for empty searches or unsupported type filters', async () => {
    await expect(omniSearchApi.search({ q: '', limit: 8 })).resolves.toEqual(
      expect.objectContaining({
        groups: expect.objectContaining({ patients: [], recent_patients: [] }),
      }),
    );
    await expect(omniSearchApi.search({ q: 'nurse', types: ['staff'], limit: 8 })).resolves.toEqual(
      expect.objectContaining({
        groups: expect.objectContaining({ patients: [], staff: [] }),
      }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('hashes raw search text out of React Query keys', () => {
    const key = omniSearchKeys.results({
      facilityCode: 'HMS',
      q: 'Ama Mensah MRN-001',
      types: ['patients'],
      limit: 8,
    });

    expect(JSON.stringify(key)).not.toContain('Ama Mensah');
    expect(JSON.stringify(key)).not.toContain('MRN-001');
    expect(JSON.stringify(key)).toContain('q_hash');
  });
});
