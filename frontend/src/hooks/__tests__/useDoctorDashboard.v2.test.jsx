import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useClinicSchedule,
  useDoctorDashboard,
} from '../useDoctorDashboard';
import { dashboardsApi } from '@/features/dashboards/api';

vi.mock('@/features/dashboards/api', () => ({
  dashboardsApi: {
    getMyWorkDashboard: vi.fn(),
    getClinicSchedule: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ facilityCode: 'HMS' }),
}));

vi.mock('@/features/dashboards/hooks/useDoctorDashboardLiveUpdates', () => ({
  useDoctorDashboardLiveUpdates: () => ({ isConnected: false }),
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

describe('useDoctorDashboard Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardsApi.getMyWorkDashboard.mockResolvedValue({});
    dashboardsApi.getClinicSchedule.mockResolvedValue({});
  });

  it('threads React Query AbortSignal into doctor dashboard reads', async () => {
    const dashboard = renderHook(() => useDoctorDashboard(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(dashboard.result.current.isFetching).toBe(false);
    });

    const schedule = renderHook(
      () => useClinicSchedule('2026-05-12', 'practitioner-1'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => {
      expect(schedule.result.current.isSuccess).toBe(true);
    });

    expect(dashboardsApi.getMyWorkDashboard).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(dashboardsApi.getClinicSchedule).toHaveBeenCalledWith({
      date: '2026-05-12',
      practitioner_id: 'practitioner-1',
      signal: expect.any(AbortSignal),
    });
  });
});
