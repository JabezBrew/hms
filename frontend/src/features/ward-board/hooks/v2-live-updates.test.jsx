import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  patchWardBoardQueueStatus,
  patchWardBoardTaskDelta,
  useWardBoardLiveUpdates,
  wardBoardKeys,
} from './index';
import { WardBoardWebSocket } from '@/lib/websocket';

const websocketMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { user_type: 'nurse' },
    facilityCode: 'HMS',
    getAccessToken: () => 'access-token-123',
    refreshAccessToken: vi.fn(),
  }),
}));

vi.mock('@/lib/websocket', () => ({
  WardBoardWebSocket: vi.fn(function WardBoardWebSocketMock() {
    return {
    on: websocketMocks.on,
    connect: websocketMocks.connect,
    disconnect: websocketMocks.disconnect,
    };
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper() {
  const queryClient = createQueryClient();

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useWardBoardLiveUpdates in Rust V2 mode', () => {
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
  });

  it('does not open the legacy ward-board websocket', () => {
    const { result } = renderHook(() => useWardBoardLiveUpdates(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toEqual({
      isConnected: false,
      connectionError: null,
    });
    expect(WardBoardWebSocket).not.toHaveBeenCalled();
    expect(websocketMocks.connect).not.toHaveBeenCalled();
  });
});

describe('ward-board realtime cache patches', () => {
  it('patches task state without refetching the full board', () => {
    const queryClient = createQueryClient();
    const key = wardBoardKeys.board({ ward_id: 'ward-1' });
    queryClient.setQueryData(key, {
      count: 1,
      results: [
        {
          patient_id: 'local-patient-1',
          open_task_count: 1,
          tasks: [{ id: 'task-1', status: 'pending', title: 'Review vitals' }],
        },
      ],
    });

    const patched = patchWardBoardTaskDelta(queryClient, {
      event_type: 'ward_board.task_state_changed',
      entity_type: 'ward_board_task',
      entity_id: 'task-1',
      version: 2,
      changed_fields: ['status'],
      occurred_at: '2026-05-22T12:00:00Z',
      patch: { status: 'completed' },
    });

    expect(patched).toBe(true);
    expect(queryClient.getQueryData(key).results[0]).toMatchObject({
      open_task_count: 0,
      tasks: [
        expect.objectContaining({
          id: 'task-1',
          status: 'completed',
          state: 'completed',
        }),
      ],
    });
  });

  it('patches queue freshness from PHI-free realtime metadata', () => {
    const queryClient = createQueryClient();
    const key = wardBoardKeys.board({ ward_id: 'ward-1' });
    queryClient.setQueryData(key, {
      count: 2,
      results: [],
      summary: { open_tasks: 4, last_updated: '2026-05-22T11:00:00Z' },
    });

    const patched = patchWardBoardQueueStatus(queryClient, {
      event_type: 'ward_board.queue_status_updated',
      entity_type: 'ward_board_projection',
      entity_id: 'facility-projection',
      version: 3,
      changed_fields: ['open_task_count', 'queue_status'],
      occurred_at: '2026-05-22T12:05:00Z',
      patch: { open_tasks: 3, patient_mrn: 'P-10001' },
    });

    const data = queryClient.getQueryData(key);
    expect(patched).toBe(true);
    expect(data.summary).toMatchObject({
      open_tasks: 3,
      last_updated: '2026-05-22T12:05:00Z',
    });
    expect(JSON.stringify(data)).not.toContain('P-10001');
  });
});
