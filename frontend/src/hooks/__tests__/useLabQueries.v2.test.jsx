import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  labKeys,
  patchLabOrderStatusSummary,
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

  it('patches lab order status summaries without broad list invalidation', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const orderedKey = labKeys.ordersPaginatedList({ status: 'ordered' });
    const completedKey = labKeys.ordersPaginatedList({ status: 'completed' });
    queryClient.setQueryData(labKeys.order('order-1'), {
      id: 'order-1',
      status: 'ordered',
      status_display: 'Ordered',
    });
    queryClient.setQueryData(orderedKey, {
      count: 1,
      results: [{ id: 'order-1', status: 'ordered', status_display: 'Ordered' }],
    });
    queryClient.setQueryData(completedKey, {
      count: 0,
      results: [],
    });

    const patched = patchLabOrderStatusSummary(queryClient, {
      id: 'order-1',
      status: 'completed',
      status_display: 'Completed',
      patient_mrn: 'P-10001',
    });

    expect(patched).toBe(true);
    expect(queryClient.getQueryData(labKeys.order('order-1'))).toMatchObject({
      id: 'order-1',
      status: 'completed',
      status_display: 'Completed',
    });
    expect(queryClient.getQueryData(orderedKey)).toMatchObject({
      count: 0,
      results: [],
    });
    expect(JSON.stringify(queryClient.getQueryData(labKeys.order('order-1')))).not.toContain('P-10001');
  });
});
