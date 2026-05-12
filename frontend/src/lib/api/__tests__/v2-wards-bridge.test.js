import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wardsApi } from '../wards';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 wards bridge', () => {
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

  it('lists wards through /api/v2 and adapts Rust ward counters for the existing ward UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'ward-1',
              code: 'general',
              name: 'General Ward',
              status: 'active',
              active_bed_count: 20,
              occupied_bed_count: 5,
              created_at: '2026-05-12T03:12:42Z',
            },
          ],
          page: { limit: 25, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await wardsApi.getWards({ page_size: 25 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toMatchObject([
      {
        id: 'ward-1',
        code: 'general',
        name: 'General Ward',
        ward_type: 'general',
        description: '',
        total_beds: 20,
        available_beds_count: 15,
        occupied_beds_count: 5,
        occupancy_rate: 25,
        is_active: true,
        status: 'active',
        created_at: '2026-05-12T03:12:42Z',
      },
    ]);
  });
});
