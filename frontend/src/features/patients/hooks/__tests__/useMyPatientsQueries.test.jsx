import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCheckPatientInList, useMyPatients } from '../useMyPatientsQueries';
import { myPatientsApi } from '@/features/patients/api';

vi.mock('@/features/patients/api', () => ({
  myPatientsApi: {
    getMyPatients: vi.fn(),
    checkPatient: vi.fn(),
    addPatient: vi.fn(),
    removePatient: vi.fn(),
    removeEntry: vi.fn(),
    togglePin: vi.fn(),
    updateNotes: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useMyPatientsQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads React Query AbortSignal into the my-patients list API call', async () => {
    myPatientsApi.getMyPatients.mockResolvedValueOnce({ results: [] });

    const { result } = renderHook(() => useMyPatients(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(myPatientsApi.getMyPatients).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });

  it('threads React Query AbortSignal into patient membership checks', async () => {
    myPatientsApi.checkPatient.mockResolvedValueOnce({ in_list: true });

    const { result } = renderHook(() => useCheckPatientInList('patient-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(myPatientsApi.checkPatient).toHaveBeenCalledWith('patient-1', {
      signal: expect.any(AbortSignal),
    });
  });
});
