import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  usePatientTimelineSimple,
  usePrefetchTimelinePage,
} from '../useTimelineQueries';
import { fetchChronicleContext } from '../useChronicleContext';

vi.mock('../useChronicleContext', () => ({
  fetchChronicleContext: vi.fn(),
}));

function createWrapper(queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 0,
      retry: false,
    },
  },
})) {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useTimelineQueries Rust V2 hook behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    fetchChronicleContext.mockResolvedValue({
      notes: [],
      prescriptions: [],
      chart_entries: [],
      problems: [],
      allergies: [],
    });
  });

  it('threads React Query AbortSignal into simple timeline reads', async () => {
    renderHook(() => usePatientTimelineSimple('patient-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(fetchChronicleContext).toHaveBeenCalledWith('patient-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into next timeline page prefetches', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    const { result } = renderHook(
      () => usePrefetchTimelinePage('patient-1', { type: 'notes', page_size: 10 }, 1),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.prefetchNextPage();
    });

    await waitFor(() => {
      expect(fetchChronicleContext).toHaveBeenCalledWith('patient-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });
});
