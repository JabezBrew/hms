import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __auditLogTestInternals } from '../useAuditLogs';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 audit log bridge', () => {
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

  it('sends audit filters to Rust /api/v2 instead of fetching an unfiltered page', async () => {
    const controller = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'event-1',
              actor_user_id: 'user-1',
              actor_display_name: 'Owner',
              request_id: 'request-1',
              event_type: 'billing.invoice.updated',
              resource_type: 'invoice',
              resource_id: 'invoice-1',
              occurred_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 35, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await __auditLogTestInternals.fetchAuditLogs(
      {
        category: 'BILLING',
        action: 'UPDATE',
        search: 'invoice',
        start_date: '2026-05-12',
        end_date: '2026-05-12',
      },
      1,
      35,
      { signal: controller.signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/audit-events?limit=35&search=invoice&category=BILLING&action=UPDATE&start_date=2026-05-12&end_date=2026-05-12',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      }),
    );
    expect(response.results).toEqual([
      expect.objectContaining({
        id: 'event-1',
        action: 'UPDATE',
        category: 'BILLING',
        resource_type: 'invoice',
      }),
    ]);
  });
});
