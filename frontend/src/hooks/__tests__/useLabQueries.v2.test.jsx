import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useLabOrder,
  useLabPanel,
  useLabResult,
  useLabSpecimen,
  useLabTest,
} from '../useLabQueries';
import { laboratoryApi } from '@/features/laboratory/api';

vi.mock('@/features/laboratory/api', () => ({
  laboratoryApi: {
    getLabTest: vi.fn(),
    getLabPanel: vi.fn(),
    getLabOrder: vi.fn(),
    getLabSpecimen: vi.fn(),
    getLabResult: vi.fn(),
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

async function expectSuccessfulHook(render) {
  const { result } = renderHook(render, { wrapper: createWrapper() });
  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true);
  });
}

describe('useLabQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(laboratoryApi).forEach((mockFn) => {
      mockFn.mockResolvedValue({});
    });
  });

  it('threads React Query AbortSignal into lab detail reads', async () => {
    await expectSuccessfulHook(() => useLabTest('test-1'));
    await expectSuccessfulHook(() => useLabPanel('panel-1'));
    await expectSuccessfulHook(() => useLabOrder('order-1'));
    await expectSuccessfulHook(() => useLabSpecimen('specimen-1'));
    await expectSuccessfulHook(() => useLabResult('result-1'));

    expect(laboratoryApi.getLabTest).toHaveBeenCalledWith('test-1', {
      signal: expect.any(AbortSignal),
    });
    expect(laboratoryApi.getLabPanel).toHaveBeenCalledWith('panel-1', {
      signal: expect.any(AbortSignal),
    });
    expect(laboratoryApi.getLabOrder).toHaveBeenCalledWith('order-1', {
      signal: expect.any(AbortSignal),
    });
    expect(laboratoryApi.getLabSpecimen).toHaveBeenCalledWith('specimen-1', {
      signal: expect.any(AbortSignal),
    });
    expect(laboratoryApi.getLabResult).toHaveBeenCalledWith('result-1', {
      signal: expect.any(AbortSignal),
    });
  });
});
