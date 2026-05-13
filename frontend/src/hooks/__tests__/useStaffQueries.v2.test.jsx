import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStaffMember } from '../useStaffQueries';
import { staffApi } from '@/features/staff/api';

vi.mock('@/features/staff/api', () => ({
  staffApi: {
    getStaffMember: vi.fn(),
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

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useStaffQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staffApi.getStaffMember.mockResolvedValue({ id: 'staff-1' });
  });

  it('threads React Query AbortSignal into staff detail reads', async () => {
    const { result } = renderHook(() => useStaffMember('staff-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(staffApi.getStaffMember).toHaveBeenCalledWith('staff-1', {
      signal: expect.any(AbortSignal),
    });
  });
});
