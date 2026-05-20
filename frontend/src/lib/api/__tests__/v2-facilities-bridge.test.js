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

  it('lists active facilities from Rust organization units with server-side filters', async () => {
    const controller = new AbortController();
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

    const response = await facilitiesApi.listFacilities({ signal: controller.signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/org-units?unit_type=facility&is_active=true',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
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

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/org-units?unit_type=facility',
      expect.any(Object),
    );

    expect(response.map((facility) => facility.code)).toEqual(['HMS', 'OLD']);
  });

  it('preserves AbortError from Rust V2 facility reads', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      facilitiesApi.listFacilities({ signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
