import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  exportAuditLogs,
  useAuditFilters,
  useAuditLogs,
  useAuditStats,
} from '../useAuditLogs';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function v2AuditEvent(overrides = {}) {
  return {
    id: 'audit-1',
    actor_user_id: 'user-1',
    actor_display_name: 'Admin User',
    request_id: 'req-1',
    event_type: 'permission_assignment.created',
    resource_type: 'permission_assignment',
    resource_id: 'resource-1',
    occurred_at: '2026-05-12T08:30:00Z',
    ...overrides,
  };
}

describe('Rust V2 audit log bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;
  const originalCreateObjectURL = globalThis.URL.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-audit-export');
    globalThis.URL.revokeObjectURL = vi.fn();
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
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('loads audit logs from Rust admin audit events without calling the old Django endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [v2AuditEvent()],
          page: {
            limit: 35,
            has_next: true,
            next_cursor: 'cursor-next',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(
      () => useAuditLogs({ search: 'permission', ordering: '-timestamp' }, 1, 35),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data?.results).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/audit-events?limit=35&search=permission',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(result.current.data).toEqual({
      results: [
        expect.objectContaining({
          id: 'audit-1',
          timestamp: '2026-05-12T08:30:00Z',
          user_display: 'Admin User',
          user_email: null,
          action: 'CREATE',
          action_display: 'Permission Assignment Created',
          category: 'ADMIN',
          resource_type: 'permission_assignment',
          resource_name: 'permission_assignment resource-1',
          description: 'Permission Assignment Created on permission_assignment resource-1',
          request_id: 'req-1',
        }),
      ],
      count: 1,
      next: 'cursor-next',
      previous: null,
      page: {
        limit: 35,
        has_next: true,
        next_cursor: 'cursor-next',
      },
      count_exact: false,
    });
  });

  it('derives stats and filter options without falling back to legacy audit endpoints in Rust mode', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            v2AuditEvent({ id: 'audit-1', occurred_at: now.toISOString() }),
            v2AuditEvent({ id: 'audit-2', occurred_at: yesterday.toISOString() }),
          ],
          page: {
            limit: 100,
            has_next: false,
            next_cursor: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const stats = renderHook(() => useAuditStats(), { wrapper: createWrapper() });
    const filters = renderHook(() => useAuditFilters(), { wrapper: createWrapper() });

    await waitFor(() => expect(stats.result.current.data?.total_logs).toBe(2));
    await waitFor(() => expect(filters.result.current.data?.categories.length).toBeGreaterThan(0));

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/audit-events?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(stats.result.current.data).toEqual({
      total_logs: 2,
      logs_today: 1,
      logs_this_week: 2,
      active_sessions: 0,
    });
    expect(filters.result.current.data.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'CREATE', label: 'Create' }),
        expect.objectContaining({ value: 'UPDATE', label: 'Update' }),
      ]),
    );
  });

  it('exports a bounded Rust audit-event page instead of using the legacy export endpoint', async () => {
    const realCreateElement = document.createElement.bind(document);
    const anchor = realCreateElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {});
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const removeChild = vi.spyOn(document.body, 'removeChild');
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [v2AuditEvent()],
          page: {
            limit: 100,
            has_next: false,
            next_cursor: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await exportAuditLogs({ search: 'permission' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/audit-events?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();

    appendChild.mockRestore();
    removeChild.mockRestore();
    click.mockRestore();
    document.createElement.mockRestore();
  });
});
