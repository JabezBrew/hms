import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReferralNotificationCount } from '../useReferralQueries';
import { referralsApi } from '@/features/referrals/api';

vi.mock('@/features/referrals/api', () => ({
  referralsApi: {
    getUnreadNotificationCount: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
        retry: false,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useReferralQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    referralsApi.getUnreadNotificationCount.mockResolvedValue(0);
  });

  it('threads React Query AbortSignal into unread notification count reads', async () => {
    const { result } = renderHook(() => useReferralNotificationCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(referralsApi.getUnreadNotificationCount).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });
});
