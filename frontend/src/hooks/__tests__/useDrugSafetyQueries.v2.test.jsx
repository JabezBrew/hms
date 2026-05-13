import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAlert,
  useAllergy,
  useDrugForms,
  useDrugSearch,
  usePatientAllergies,
} from '../useDrugSafetyQueries';
import { drugSafetyApi } from '@/shared/api/drugSafety';

vi.mock('@/shared/api/drugSafety', () => ({
  drugSafetyApi: {
    getAlert: vi.fn(),
    getAllergy: vi.fn(),
    getDrugForms: vi.fn(),
    getPatientAllergies: vi.fn(),
    searchDrugs: vi.fn(),
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
    drugSafetyApi.getAlert.mockResolvedValue({});
    drugSafetyApi.getAllergy.mockResolvedValue({});
    drugSafetyApi.getDrugForms.mockResolvedValue({ forms: [] });
    drugSafetyApi.searchDrugs.mockResolvedValue({ results: [] });
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

  it('threads React Query AbortSignal into drug safety search and detail reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useDrugSearch('warfarin', { maxResults: 5 }), { wrapper });
    renderHook(() => useDrugForms('11289'), { wrapper });
    renderHook(() => useAllergy('allergy-1'), { wrapper });
    renderHook(() => useAlert('alert-1'), { wrapper });

    await waitFor(() => {
      expect(drugSafetyApi.searchDrugs).toHaveBeenCalledWith('warfarin', 5, {
        signal: expect.any(AbortSignal),
      });
      expect(drugSafetyApi.getDrugForms).toHaveBeenCalledWith('11289', {
        signal: expect.any(AbortSignal),
      });
      expect(drugSafetyApi.getAllergy).toHaveBeenCalledWith('allergy-1', {
        signal: expect.any(AbortSignal),
      });
      expect(drugSafetyApi.getAlert).toHaveBeenCalledWith('alert-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });
});
