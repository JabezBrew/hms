import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  labKeys,
  patchLabOrderStatusSummary,
  useCancelLabOrder,
  useCollectLabOrder,
  useCompleteLabOrder,
  useCreateLabResult,
  useCreateLabSpecimen,
  useLabOrder,
  useLabPanel,
  useLabResult,
  useLabSpecimen,
  useLabTest,
  usePaginatedLabOrders,
  useReceiveLabOrder,
  useStartProcessingLabOrder,
  useSubmitLabOrder,
  useVerifyLabResult,
} from '../useLabQueries';
import { laboratoryApi } from '@/features/laboratory/api';

vi.mock('@/features/laboratory/api', () => ({
  laboratoryApi: {
    getLabTest: vi.fn(),
    getLabPanel: vi.fn(),
    getLabOrder: vi.fn(),
    getLabSpecimen: vi.fn(),
    getLabResult: vi.fn(),
    getLabOrdersPaginated: vi.fn(),
    submitLabOrder: vi.fn(),
    collectLabOrder: vi.fn(),
    receiveLabOrder: vi.fn(),
    startProcessingLabOrder: vi.fn(),
    completeLabOrder: vi.fn(),
    cancelLabOrder: vi.fn(),
    createLabSpecimen: vi.fn(),
    createLabResult: vi.fn(),
    verifyLabResult: vi.fn(),
  },
}));

function createWrapper(queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })) {

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

  const transitions = [
    { name: 'collection', hook: useCollectLabOrder, api: 'collectLabOrder', from: 'ordered', to: 'collected', variables: 'order-1' },
    { name: 'processing', hook: useStartProcessingLabOrder, api: 'startProcessingLabOrder', from: 'collected', to: 'processing', variables: 'order-1' },
    { name: 'submission', hook: useSubmitLabOrder, api: 'submitLabOrder', from: 'draft', to: 'ordered', variables: 'order-1' },
    { name: 'receipt', hook: useReceiveLabOrder, api: 'receiveLabOrder', from: 'collected', to: 'received', variables: 'order-1' },
    { name: 'completion', hook: useCompleteLabOrder, api: 'completeLabOrder', from: 'processing', to: 'completed', variables: 'order-1' },
    { name: 'cancellation', hook: useCancelLabOrder, api: 'cancelLabOrder', from: 'ordered', to: 'cancelled', variables: { id: 'order-1', cancellationReason: 'Synthetic cancellation' } },
  ];

  it.each(transitions)('refreshes a previously empty destination partition after $name', async ({ hook, api, from, to, variables }) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: 0 } },
    });
    const wrapper = createWrapper(queryClient);
    const order = (status) => ({ id: 'order-1', status, order_tests: [{ id: 'synthetic-test' }] });
    let serverStatus = from;
    queryClient.setQueryData(labKeys.order('order-1'), order(from));
    queryClient.setQueryData(labKeys.ordersPaginatedList({ status: from }), { results: [order(from)], count: 1 });
    queryClient.setQueryData(labKeys.ordersPaginatedList({ status: to }), { results: [], count: 0 });
    laboratoryApi.getLabOrdersPaginated.mockImplementation(async ({ status }) => ({
      results: status === serverStatus ? [order(serverStatus)] : [],
      count: status === serverStatus ? 1 : 0,
    }));
    laboratoryApi[api].mockImplementation(async () => {
      serverStatus = to;
      return { id: 'order-1', status: to };
    });
    const source = renderHook(() => ({ list: usePaginatedLabOrders({ status: from }), mutation: hook() }), { wrapper });

    await act(async () => { await source.result.current.mutation.mutateAsync(variables); });

    expect(queryClient.getQueryData(labKeys.order('order-1'))).toMatchObject(order(to));
    await waitFor(() => { expect(source.result.current.list.data.results).toEqual([]); });
    const destination = renderHook(() => usePaginatedLabOrders({ status: to }), { wrapper });
    await waitFor(() => {
      expect(destination.result.current.data.results).toEqual([order(to)]);
      expect(destination.result.current.data.count).toBe(1);
    });
  });

  it('keeps collection pending until active source and destination partitions finish refetching', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: 0 } },
    });
    const wrapper = createWrapper(queryClient);
    const ordered = { id: 'order-1', status: 'ordered', order_tests: [{ id: 'synthetic-test' }] };
    const collected = { ...ordered, status: 'collected' };
    queryClient.setQueryData(labKeys.order('order-1'), ordered);
    queryClient.setQueryData(labKeys.ordersPaginatedList({ status: 'ordered' }), { results: [ordered], count: 1 });
    queryClient.setQueryData(labKeys.ordersPaginatedList({ status: 'collected' }), { results: [], count: 0 });
    queryClient.setQueryData(['clinical-notes', 'list'], { results: [] });
    let finishDestination;
    const destinationFetch = new Promise((resolve) => { finishDestination = resolve; });
    laboratoryApi.getLabOrdersPaginated.mockImplementation(({ status }) => (
      status === 'collected' ? destinationFetch : Promise.resolve({ results: [], count: 0 })
    ));
    laboratoryApi.collectLabOrder.mockResolvedValue({ id: 'order-1', status: 'collected' });
    const view = renderHook(() => ({
      source: usePaginatedLabOrders({ status: 'ordered' }),
      destination: usePaginatedLabOrders({ status: 'collected' }),
      mutation: useCollectLabOrder(),
    }), { wrapper });
    let mutationPromise;
    let settled = false;
    await act(async () => {
      mutationPromise = view.result.current.mutation.mutateAsync('order-1');
      mutationPromise.then(() => { settled = true; });
    });
    await waitFor(() => { expect(laboratoryApi.getLabOrdersPaginated).toHaveBeenCalledTimes(2); });
    expect(settled).toBe(false);
    expect(view.result.current.mutation.isPending).toBe(true);
    expect(queryClient.getQueryData(labKeys.order('order-1'))).toMatchObject(collected);
    expect(queryClient.getQueryState(['clinical-notes', 'list']).isInvalidated).toBe(false);

    await act(async () => {
      finishDestination({ results: [collected], count: 1 });
      await mutationPromise;
    });
    await waitFor(() => { expect(view.result.current.mutation.isSuccess).toBe(true); });
    expect(settled).toBe(true);
    expect(view.result.current.destination.data).toEqual({ results: [collected], count: 1 });
  });

  it.each([
    { name: 'specimen creation', hook: useCreateLabSpecimen, api: 'createLabSpecimen', from: 'ordered', to: 'collected', variables: { order_id: 'order-1' } },
    { name: 'result creation', hook: useCreateLabResult, api: 'createLabResult', from: 'collected', to: 'processing', variables: { order_id: 'order-1' } },
    { name: 'result verification', hook: useVerifyLabResult, api: 'verifyLabResult', from: 'processing', to: 'completed', variables: { id: 'result-1' } },
  ])('refreshes parent partitions after Rust $name with only order_id', async ({ hook, api, from, to, variables }) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: 0 } },
    });
    const wrapper = createWrapper(queryClient);
    let serverStatus = from;
    const order = (status) => ({ id: 'order-1', status });
    queryClient.setQueryData(labKeys.ordersPaginatedList({ status: from }), { results: [order(from)], count: 1 });
    queryClient.setQueryData(labKeys.ordersPaginatedList({ status: to }), { results: [], count: 0 });
    laboratoryApi.getLabOrdersPaginated.mockImplementation(async ({ status }) => ({
      results: status === serverStatus ? [order(serverStatus)] : [],
      count: status === serverStatus ? 1 : 0,
    }));
    laboratoryApi[api].mockImplementation(async () => {
      serverStatus = to;
      return { id: 'synthetic-child', order_id: 'order-1' };
    });
    const source = renderHook(() => ({ list: usePaginatedLabOrders({ status: from }), mutation: hook() }), { wrapper });
    await act(async () => { await source.result.current.mutation.mutateAsync(variables); });
    await waitFor(() => { expect(source.result.current.list.data.results).toEqual([]); });
    const destination = renderHook(() => usePaginatedLabOrders({ status: to }), { wrapper });
    await waitFor(() => { expect(destination.result.current.data.results).toEqual([order(to)]); });
  });
});
