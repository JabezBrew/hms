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

  it('loads inbox counts from the Rust counts endpoint without paging through notifications', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            unread: 73,
            action_required: 0,
            total: 91,
          },
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
      'http://localhost:8080/api/v2/notifications/counts',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual({
      unread: 73,
      action_required: 0,
      total: 91,
    });
  });

  it('loads inbox items and marks notifications read through bounded Rust endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'notification-1',
                notification_type: 'system',
                title: 'HMS V2 foundation ready',
                body: 'Production cutover baseline is available.',
                priority: 'normal',
                read_at: null,
                created_at: '2026-05-12T08:00:00Z',
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'notification-1',
              notification_type: 'system',
              title: 'HMS V2 foundation ready',
              body: 'Production cutover baseline is available.',
              priority: 'normal',
              read_at: '2026-05-12T09:00:00Z',
              created_at: '2026-05-12T08:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const inbox = await notificationsApi.getInbox(
      { status: 'unread', page_size: 20 },
      { signal: new AbortController().signal },
    );
    const marked = await notificationsApi.markRead('notification-1', {
      signal: new AbortController().signal,
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/notifications?limit=20&unread_only=true',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/notifications/notification-1/read',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ read: true }),
      }),
    );
    expect(inbox).toEqual({
      results: [
        expect.objectContaining({
          id: 'notification-1',
          source_type: 'system',
          summary: 'Production cutover baseline is available.',
          occurred_at: '2026-05-12T08:00:00Z',
          is_read: false,
          status: 'unread',
          is_action_required: false,
        }),
      ],
      count: 1,
      next: null,
      previous: null,
      page: { limit: 20, has_next: false, next_cursor: null },
      count_exact: false,
    });
    expect(marked).toEqual(expect.objectContaining({
      id: 'notification-1',
      is_read: true,
      status: 'read',
    }));
  });
});
