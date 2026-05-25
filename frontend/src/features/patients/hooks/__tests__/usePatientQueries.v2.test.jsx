import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePatientChronicleStartup, usePatientHistory } from '../usePatientQueries';
import { patientsApi } from '@/features/patients/api';

vi.mock('@/features/patients/api', () => ({
  patientsApi: {
    getPatientHistory: vi.fn(),
    getPatientChronicleStartup: vi.fn(),
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

describe('usePatientQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientsApi.getPatientHistory.mockResolvedValue([]);
    patientsApi.getPatientChronicleStartup.mockResolvedValue({ patient: { id: 'patient-1' } });
  });

  it('threads React Query AbortSignal into patient history reads', async () => {
    renderHook(() => usePatientHistory('patient-1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(patientsApi.getPatientHistory).toHaveBeenCalledWith('patient-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into shaped Chronicle startup reads', async () => {
    renderHook(() => usePatientChronicleStartup('patient-1', {}, { enabled: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(patientsApi.getPatientChronicleStartup).toHaveBeenCalledWith('patient-1', {}, {
        signal: expect.any(AbortSignal),
      });
    });
  });
});
