import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSearchQuery } from '../useSearchQuery';

vi.mock('../use-debounce', () => ({
  useDebounce: (value) => value,
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

describe('useSearchQuery Rust V2 behavior', () => {
  it('threads React Query AbortSignal into debounced search functions', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(
      () => useSearchQuery(['patients', 'search'], queryFn, { debounceMs: 10 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.setSearchTerm('ama');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryFn).toHaveBeenCalledWith('ama', {
      signal: expect.any(AbortSignal),
    });
  });
});
