import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePatientAllergies } from '../useDrugSafetyQueries';
import { drugSafetyApi } from '@/shared/api/drugSafety';

vi.mock('@/shared/api/drugSafety', () => ({
  drugSafetyApi: {
    getPatientAllergies: vi.fn(),
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

describe('useDrugSafetyQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('threads React Query AbortSignal into patient allergy reads', async () => {
    drugSafetyApi.getPatientAllergies.mockResolvedValueOnce({ count: 0, allergies: [] });

    const { result } = renderHook(() => usePatientAllergies('patient-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(drugSafetyApi.getPatientAllergies).toHaveBeenCalledWith('patient-1', {
      signal: expect.any(AbortSignal),
    });
  });
});
