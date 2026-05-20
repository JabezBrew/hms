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

  it('searches through Rust /api/v2/search/omni without putting PHI in the URL', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            query: 'Ama',
            types: ['patients'],
            limit: 5,
            took_ms: 4,
            index_status: [],
            groups: {
              recent_patients: [],
              patients: [{
                id: 'patient-1',
                resource_type: 'patients',
                title: 'Ama Mensah',
                subtitle: 'MRN MRN-001',
                route_path: '/patients/patient-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-001',
                patient_name: 'Ama Mensah',
                patient_date_of_birth: '1990-02-14',
                status_label: 'active',
                metadata: { sex: 'female', status: 'active' },
                score: 201,
              }],
              staff: [],
            },
          },
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
      'http://localhost:8080/api/v2/search/omni',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        signal,
        body: JSON.stringify({
          q: 'Ama',
          types: ['patients'],
          limit: 5,
        }),
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'Content-Type': 'application/json',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(result).toEqual({
      query: 'Ama',
      types: ['patients'],
      limit: 5,
      index_status: [],
      took_ms: 4,
      groups: expect.objectContaining({
        recent_patients: [],
        patients: [
          expect.objectContaining({
            id: 'patient-1',
            name: 'Ama Mensah',
            medical_record_number: 'MRN-001',
            date_of_birth: '1990-02-14',
            gender: 'female',
            admission_status: 'active',
          }),
        ],
        staff: [],
        wards: [],
      }),
    });
  });

  it('does not fetch for one-character searches', async () => {
    await expect(omniSearchApi.search({ q: 'A', limit: 8 })).resolves.toEqual(
      expect.objectContaining({
        groups: expect.objectContaining({ patients: [], recent_patients: [] }),
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
