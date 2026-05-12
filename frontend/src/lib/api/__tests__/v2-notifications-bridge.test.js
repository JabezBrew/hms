import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationsApi } from '../notifications';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 notification bridge', () => {
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

  it('loads inbox counts from the Rust notification list without calling the old Django endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'notification-1',
              notification_type: 'dashboard',
              title: 'HMS V2 foundation ready',
              body: 'Production cutover baseline is available.',
              priority: 'normal',
              created_at: '2026-05-12T03:26:23Z',
              read_at: null,
            },
          ],
          page: { limit: 50, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await notificationsApi.getInboxCounts();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/notifications?limit=50&unread_only=true',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual({
      unread: 1,
      action_required: 0,
      total: 1,
    });
  });
});
