import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAdminDashboard,
  useAdminDashboardV2Capacity,
  useAdminDashboardV2Compliance,
  useAdminDashboardV2Summary,
  useAdminDashboardV2Workforce,
  useClinicSchedule,
  useInpatientDashboard,
  useMyWorkDashboard,
  useReceptionistDashboard,
} from '../useDashboardQueries';
import { dashboardsApi } from '@/features/dashboards/api';

vi.mock('@/features/dashboards/api', () => ({
  dashboardsApi: {
    getInpatientDashboard: vi.fn(),
    getReceptionistDashboard: vi.fn(),
    getAdminDashboard: vi.fn(),
    getAdminDashboardV2: vi.fn(),
    getAdminDashboardV2Capacity: vi.fn(),
    getAdminDashboardV2Workforce: vi.fn(),
    getAdminDashboardV2Compliance: vi.fn(),
    getMyWorkDashboard: vi.fn(),
    getClinicSchedule: vi.fn(),
  },
}));

const authState = vi.hoisted(() => ({ auth: { facilityCode: 'HMS', user: { id: 'user-1', role: 'doctor' } } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => authState.auth }));

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

async function expectSuccessfulHook(render) {
  const { result } = renderHook(render, { wrapper: createWrapper() });
  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true);
  });
}

describe('useDashboardQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.auth = { facilityCode: 'HMS', user: { id: 'user-1', role: 'doctor' } };
    Object.values(dashboardsApi).forEach((mockFn) => {
      mockFn.mockResolvedValue({});
    });
  });

  it('threads React Query AbortSignal into role dashboard reads', async () => {
    await expectSuccessfulHook(() => useInpatientDashboard());
    await expectSuccessfulHook(() => useReceptionistDashboard());
    await expectSuccessfulHook(() => useAdminDashboard());

    expect(dashboardsApi.getInpatientDashboard).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(dashboardsApi.getReceptionistDashboard).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(dashboardsApi.getAdminDashboard).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });

  it('threads React Query AbortSignal into admin v2 dashboard section reads', async () => {
    await expectSuccessfulHook(() => useAdminDashboardV2Summary({ window: 'today' }));
    await expectSuccessfulHook(() => useAdminDashboardV2Capacity({ window: 'today' }));
    await expectSuccessfulHook(() => useAdminDashboardV2Workforce({ window: 'today' }));
    await expectSuccessfulHook(() => useAdminDashboardV2Compliance({ window: 'today' }));

    expect(dashboardsApi.getAdminDashboardV2).toHaveBeenCalledWith(
      { window: 'today' },
      { signal: expect.any(AbortSignal) },
    );
    expect(dashboardsApi.getAdminDashboardV2Capacity).toHaveBeenCalledWith(
      { window: 'today' },
      { signal: expect.any(AbortSignal) },
    );
    expect(dashboardsApi.getAdminDashboardV2Workforce).toHaveBeenCalledWith(
      { window: 'today' },
      { signal: expect.any(AbortSignal) },
    );
    expect(dashboardsApi.getAdminDashboardV2Compliance).toHaveBeenCalledWith(
      { window: 'today' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('threads React Query AbortSignal into operational doctor dashboard reads', async () => {
    await expectSuccessfulHook(() => useMyWorkDashboard({ date: '2026-05-12' }));
    await expectSuccessfulHook(() => useClinicSchedule({ date: '2026-05-12' }));

    expect(dashboardsApi.getMyWorkDashboard).toHaveBeenCalledWith({
      date: '2026-05-12',
      signal: expect.any(AbortSignal),
    });
    expect(dashboardsApi.getClinicSchedule).toHaveBeenCalledWith({
      date: '2026-05-12',
      signal: expect.any(AbortSignal),
    });
  });
  it('forwards enabled sections and isolates operational previews when the user changes', async () => {
    const sections = { ward_board: true, discharges: false, nursing_tasks: false };
    const { result, rerender } = renderHook(() => useInpatientDashboard({ sections }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dashboardsApi.getInpatientDashboard).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), sections });
    expect(dashboardsApi.getInpatientDashboard).toHaveBeenCalledTimes(1);
    authState.auth = { facilityCode: 'HMS', user: { id: 'user-2', role: 'doctor' } };
    rerender();
    await waitFor(() => expect(dashboardsApi.getInpatientDashboard).toHaveBeenCalledTimes(2));
  });

  it('includes reception section selection in the cache key and API request', async () => {
    const sections = { appointments: true, patients: false, invoices: false };
    await expectSuccessfulHook(() => useReceptionistDashboard({ sections }));
    expect(dashboardsApi.getReceptionistDashboard).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), sections });
  });

});
