import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWardBoardLiveUpdates } from './index';
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

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
