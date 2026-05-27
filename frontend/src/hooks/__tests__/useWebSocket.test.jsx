import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationWebSocket } from '../useWebSocket';

const authMock = vi.hoisted(() => ({
  value: {},
}));

const socketMock = vi.hoisted(() => ({
  instances: [],
  createSocket(token) {
    const socket = {
      token,
      handlers: new Map(),
      connectCalls: 0,
      disconnectCalls: 0,
      offCalls: [],
      on(event, handler) {
        socket.handlers.set(event, handler);
      },
      off(event, handler) {
        socket.offCalls.push([event, handler]);
        if (socket.handlers.get(event) === handler) {
          socket.handlers.delete(event);
        }
      },
      connect() {
        socket.connectCalls += 1;
      },
      disconnect() {
        socket.disconnectCalls += 1;
      },
      emit(event, payload) {
        socket.handlers.get(event)?.(payload);
      },
    };
    socketMock.instances.push(socket);
    return socket;
  },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => authMock.value,
}));

vi.mock('@/lib/websocket', () => ({
  NotificationWebSocket: class MockNotificationWebSocket {
    constructor(token) {
      return socketMock.createSocket(token);
    }
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { Wrapper, queryClient };
}

function setAuth(overrides = {}) {
  authMock.value = {
    isAuthenticated: true,
    user: { role: 'doctor' },
    getAccessToken: vi.fn(() => 'access-token'),
    refreshAccessToken: vi.fn(),
    ...overrides,
  };
}

describe('useNotificationWebSocket', () => {
  beforeEach(() => {
    socketMock.instances = [];
    setAuth();
  });

  it('connects notification websocket for authenticated doctors with an access token', async () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useNotificationWebSocket(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(socketMock.instances).toHaveLength(1));

    const socket = socketMock.instances[0];
    expect(socket.token).toBe('access-token');
    expect(socket.connectCalls).toBe(1);

    act(() => {
      socket.emit('connection.open', {});
    });

    expect(result.current.isConnected).toBe(true);
  });

  it('does not connect when the authenticated user is not a doctor role', async () => {
    setAuth({ user: { role: 'nurse' } });
    const { Wrapper } = createWrapper();

    renderHook(() => useNotificationWebSocket(), {
      wrapper: Wrapper,
    });

    await Promise.resolve();
    expect(socketMock.instances).toHaveLength(0);
  });

  it('refreshes the access token before connecting when no current token is available', async () => {
    setAuth({
      getAccessToken: vi.fn(() => null),
      refreshAccessToken: vi.fn().mockResolvedValue('refreshed-token'),
    });
    const { Wrapper } = createWrapper();

    renderHook(() => useNotificationWebSocket(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(socketMock.instances).toHaveLength(1));
    expect(authMock.value.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(socketMock.instances[0].token).toBe('refreshed-token');
  });

  it('records notifications, invalidates referral queries, and calls the latest callback', async () => {
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const onNotification = vi.fn();

    const { result } = renderHook(() => useNotificationWebSocket({ onNotification }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(socketMock.instances).toHaveLength(1));
    const notification = { id: 'notification-1', title: 'New referral' };

    act(() => {
      socketMock.instances[0].emit('notification.new', { notification });
    });

    expect(result.current.notifications).toEqual([notification]);
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(onNotification).toHaveBeenCalledWith(notification);

    act(() => {
      result.current.clearNotifications();
    });

    expect(result.current.notifications).toEqual([]);
  });

  it('unsubscribes and disconnects on unmount', async () => {
    const { Wrapper } = createWrapper();

    const { unmount } = renderHook(() => useNotificationWebSocket(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(socketMock.instances).toHaveLength(1));
    const socket = socketMock.instances[0];

    unmount();

    expect(socket.offCalls).toEqual([
      ['connection.open', expect.any(Function)],
      ['connection.close', expect.any(Function)],
      ['connection.error', expect.any(Function)],
      ['connection.failed', expect.any(Function)],
      ['notification.new', expect.any(Function)],
    ]);
    expect(socket.disconnectCalls).toBe(1);
  });
});
