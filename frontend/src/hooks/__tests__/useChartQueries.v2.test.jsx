import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useChartTemplates,
  useCreateChartAssignment,
  useCreateChartEntry,
  usePatientChartEntries,
} from '../useChartQueries';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
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

async function captureMutationError(action) {
  let caught = null;
  await act(async () => {
    try {
      await action();
    } catch (error) {
      caught = error;
    }
  });
  return caught;
}

describe('Rust V2 chart query bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({
      getAccessToken: () => 'access-token-123',
      getFacilityCode: () => 'HMS',
    });
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('loads patient chart entries from the generated Rust patient clinical endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'entry-1',
              patient_id: 'patient-1',
              entry_type: 'temperature',
              measured_at: '2026-05-12T08:00:00Z',
              value: '37.1',
              unit: 'C',
            },
          ],
          page: { limit: 25, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => usePatientChartEntries('patient-1', { limit: 25 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.results).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/chart-entries?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(result.current.data).toEqual(expect.objectContaining({
      count: 1,
      results: [
        expect.objectContaining({
          id: 'entry-1',
          patient_id: 'patient-1',
          observation_datetime: '2026-05-12T08:00:00Z',
          entry_type: 'temperature',
          data: { temperature: '37.1' },
          unit: 'C',
        }),
      ],
    }));
  });

  it('creates patient chart entries through the generated Rust endpoint when patient_id is explicit', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'entry-1',
            patient_id: 'patient-1',
            entry_type: 'pulse',
            measured_at: '2026-05-12T08:30:00Z',
            value: '82',
            unit: 'bpm',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useCreateChartEntry(), {
      wrapper: createWrapper(),
    });

    let created;
    await act(async () => {
      created = await result.current.mutateAsync({
        patient_id: 'patient-1',
        entry_type: 'pulse',
        measured_at: '2026-05-12T08:30:00Z',
        value: 82,
        unit: 'bpm',
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/chart-entries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          entry_type: 'pulse',
          measured_at: '2026-05-12T08:30:00Z',
          value: '82',
          unit: 'bpm',
        }),
      }),
    );
    expect(created).toEqual(expect.objectContaining({
      id: 'entry-1',
      observation_datetime: '2026-05-12T08:30:00Z',
      data: { pulse: '82' },
    }));
  });

  it('fails closed for chart templates because Rust V2 has no chart builder contract', async () => {
    const { result } = renderHook(() => useChartTemplates({ enabled: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error.message).toContain('no generated /api/v2 chart builder contract');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for chart assignments because Rust V2 has no assignment contract', async () => {
    const { result } = renderHook(() => useCreateChartAssignment(), {
      wrapper: createWrapper(),
    });

    const error = await captureMutationError(() => result.current.mutateAsync({
      patient: 'patient-1',
      template: 'template-1',
    }));

    expect(error.message).toContain('no generated /api/v2 chart builder contract');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
