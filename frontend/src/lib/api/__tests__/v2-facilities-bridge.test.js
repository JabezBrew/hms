import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { facilitiesApi } from '../facilities';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 facilities bridge', () => {
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

  it('lists active facilities from Rust organization units without calling the old facilities endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'facility-1',
              code: 'HMS',
              name: 'HMS Main',
              unit_type: 'facility',
              is_active: true,
              created_at: '2026-05-12T09:00:00Z',
            },
            {
              id: 'facility-2',
              code: 'OLD',
              name: 'Closed Site',
              unit_type: 'facility',
              is_active: false,
              created_at: '2026-05-12T09:00:00Z',
            },
            {
              id: 'department-1',
              code: 'LAB',
              name: 'Laboratory',
              unit_type: 'department',
              is_active: true,
              created_at: '2026-05-12T09:00:00Z',
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await facilitiesApi.listFacilities();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/org-units?limit=100',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual([
      {
        id: 'facility-1',
        code: 'HMS',
        name: 'HMS Main',
        is_active: true,
      },
    ]);
  });

  it('can include inactive facilities from Rust V2 when requested', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'facility-1',
              code: 'HMS',
              name: 'HMS Main',
              unit_type: 'facility',
              is_active: true,
              created_at: '2026-05-12T09:00:00Z',
            },
            {
              id: 'facility-2',
              code: 'OLD',
              name: 'Closed Site',
              unit_type: 'facility',
              is_active: false,
              created_at: '2026-05-12T09:00:00Z',
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await facilitiesApi.listFacilities({ includeInactive: true });

    expect(response.map((facility) => facility.code)).toEqual(['HMS', 'OLD']);
  });
});
