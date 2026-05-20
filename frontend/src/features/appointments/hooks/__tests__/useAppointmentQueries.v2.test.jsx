import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAppointmentType,
  useAppointmentTypes,
  useAvailabilityRule,
} from '../useAppointmentQueries';
import { appointmentsApi } from '@/features/appointments/api';

vi.mock('@/features/appointments/api', () => ({
  appointmentsApi: {
    getAppointmentType: vi.fn(),
    getAppointmentTypes: vi.fn(),
    getAvailabilityRule: vi.fn(),
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

describe('useAppointmentQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appointmentsApi.getAppointmentType.mockResolvedValue({});
    appointmentsApi.getAppointmentTypes.mockResolvedValue([]);
    appointmentsApi.getAvailabilityRule.mockResolvedValue(null);
  });

  it('threads React Query AbortSignal into appointment metadata and availability reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useAppointmentTypes(), { wrapper });
    renderHook(() => useAppointmentType('type-1'), { wrapper });
    renderHook(() => useAvailabilityRule('rule-1'), { wrapper });

    await waitFor(() => {
      expect(appointmentsApi.getAppointmentTypes).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal),
      });
      expect(appointmentsApi.getAppointmentType).toHaveBeenCalledWith('type-1', {
        signal: expect.any(AbortSignal),
      });
      expect(appointmentsApi.getAvailabilityRule).toHaveBeenCalledWith('rule-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });
});
