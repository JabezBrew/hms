import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useSearchPractitioners,
  useSearchStaff,
  useStaffMember,
} from '../useStaffQueries';
import { staffApi } from '@/features/staff/api';

vi.mock('../use-debounce', () => ({
  useDebounce: (value) => value,
}));

vi.mock('@/features/staff/api', () => ({
  staffApi: {
    getStaffMember: vi.fn(),
    searchPractitioners: vi.fn(),
    searchStaff: vi.fn(),
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
    staffApi.searchPractitioners.mockResolvedValue([]);
    staffApi.searchStaff.mockResolvedValue([]);
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

  it('threads React Query AbortSignal into practitioner searches', async () => {
    const { result } = renderHook(() => useSearchPractitioners(true), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setSearchTerm('ama');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(staffApi.searchPractitioners).toHaveBeenCalledWith('ama', true, {
      signal: expect.any(AbortSignal),
    });
  });

  it('threads React Query AbortSignal into staff searches', async () => {
    const filters = { practitionersOnly: true };
    const { result } = renderHook(() => useSearchStaff(filters), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setSearchTerm('ama');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(staffApi.searchStaff).toHaveBeenCalledWith('ama', {
      practitionersOnly: true,
      signal: expect.any(AbortSignal),
    });
  });
});
