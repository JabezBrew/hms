import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schedulingApi } from '../scheduling';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 scheduling bridge', () => {
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

  it('lists scheduling exceptions through Rust V2 with date filters', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'exception-1',
              session_id: 'session-1',
              starts_at: '2026-06-04T09:00:00Z',
              ends_at: '2026-06-04T10:00:00Z',
              reason: 'Practitioner unavailable',
              created_at: '2026-06-01T08:00:00Z',
            },
          ],
          page: { limit: 10, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await schedulingApi.listExceptions({
      start_date: '2026-06-04',
      end_date: '2026-06-04',
      limit: 10,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/scheduling/exceptions?start_date=2026-06-04&end_date=2026-06-04&limit=10',
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
      expect.objectContaining({
        id: 'exception-1',
        session_id: 'session-1',
        reason: 'Practitioner unavailable',
      }),
    ]);
  });

  it('creates a scheduling exception through Rust V2', async () => {
    const payload = {
      session_id: 'session-1',
      starts_at: '2026-06-04T09:00:00Z',
      ends_at: '2026-06-04T10:00:00Z',
      reason: 'Practitioner unavailable',
    };
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'exception-1',
            ...payload,
            created_at: '2026-06-01T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await schedulingApi.createException(payload);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/scheduling/exceptions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(payload),
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'Content-Type': 'application/json',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual(expect.objectContaining(payload));
  });
});
