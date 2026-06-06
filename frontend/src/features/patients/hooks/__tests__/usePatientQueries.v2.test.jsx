import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  usePatientChronicleStartup,
  usePatientCurrentContexts,
  usePatientHistory,
  usePatientIdentityLookup,
} from '../usePatientQueries';
import { patientsApi } from '@/features/patients/api';

vi.mock('@/features/patients/api', () => ({
  patientsApi: {
    getCurrentContexts: vi.fn(),
    getPatientHistory: vi.fn(),
    getPatientChronicleStartup: vi.fn(),
    lookupIdentity: vi.fn(),
  },
}));

function createWrapperWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
        retry: false,
      },
    },
  });

  function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { queryClient, wrapper: Wrapper };
}

function createWrapper() {
  return createWrapperWithClient().wrapper;
}

describe('usePatientQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientsApi.getCurrentContexts.mockResolvedValue({
      patient_id: 'patient-1',
      outpatient: [],
      inpatient: [],
      emergency: [],
    });
    patientsApi.getPatientHistory.mockResolvedValue([]);
    patientsApi.getPatientChronicleStartup.mockResolvedValue({ patient: { id: 'patient-1' } });
    patientsApi.lookupIdentity.mockResolvedValue({
      lookup_id: 'lookup-1',
      candidates: [],
      strong_duplicate_found: false,
    });
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

  it('threads React Query AbortSignal into current context reads', async () => {
    renderHook(() => usePatientCurrentContexts('patient-1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(patientsApi.getCurrentContexts).toHaveBeenCalledWith('patient-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('runs identity lookup as a mutation so raw identity fields never become query keys', async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => usePatientIdentityLookup(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        first_name: 'Ama',
        last_name: 'Mensah',
        date_of_birth: '1989-04-15',
        phone_number: '0240000000',
      });
    });

    expect(patientsApi.lookupIdentity).toHaveBeenCalledWith({
      first_name: 'Ama',
      last_name: 'Mensah',
      date_of_birth: '1989-04-15',
      phone_number: '0240000000',
    });
    const serializedQueryKeys = JSON.stringify(
      queryClient.getQueryCache().getAll().map((query) => query.queryKey),
    );
    expect(serializedQueryKeys).not.toContain('Ama');
    expect(serializedQueryKeys).not.toContain('Mensah');
    expect(serializedQueryKeys).not.toContain('1989-04-15');
    expect(serializedQueryKeys).not.toContain('0240000000');
  });
});
