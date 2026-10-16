import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWardBoardTaskAction, wardBoardKeys } from '@/features/ward-board/hooks';
import { wardBoardApi } from '@/features/ward-board/api';
vi.mock('@/features/ward-board/api', () => ({ wardBoardApi: { runTaskAction: vi.fn() } }));
const runtime = window.__HMS_RUNTIME_CONFIG__;
let client, key;
const source = { results: [{ patient_id: 'synthetic-patient', open_nursing_task_count: 1, tasks: [{ id: 'synthetic-task', status: 'open' }] }] };
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 3 } } }); key = wardBoardKeys.board({ ward_id: 'synthetic-ward' }); client.setQueryData(key, source); vi.mocked(wardBoardApi.runTaskAction).mockReset(); });
afterEach(() => { client.clear(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function Wrapper({ children }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
it('keeps actual task state and counts until confirmed server refresh rather than optimistic completion', async () => {
  let finish; vi.mocked(wardBoardApi.runTaskAction).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { result } = renderHook(() => useWardBoardTaskAction(), { wrapper: Wrapper });
  let pending; act(() => { pending = result.current.mutateAsync({ taskId: 'synthetic-task', patientId: 'synthetic-patient', action: 'complete' }); });
  await waitFor(() => expect(finish).toBeTypeOf('function')); expect(client.getQueryData(key)).toEqual(source);
  await act(async () => { finish({ id: 'synthetic-task', status: 'completed' }); await pending; });
  expect(client.getQueryData(key)).toEqual(source); expect(client.getQueryState(key).isInvalidated).toBe(true);
});
it('does not retry an unknown task decision or fabricate a completed task', async () => {
  vi.mocked(wardBoardApi.runTaskAction).mockRejectedValue(Object.assign(new Error('Synthetic unconfirmed decision'), { name: 'NursingRecordUnconfirmedError' }));
  const { result } = renderHook(() => useWardBoardTaskAction(), { wrapper: Wrapper });
  await act(async () => { await expect(result.current.mutateAsync({ taskId: 'synthetic-task', action: 'complete' })).rejects.toMatchObject({ name: 'NursingRecordUnconfirmedError' }); });
  expect(wardBoardApi.runTaskAction).toHaveBeenCalledTimes(1); expect(client.getQueryData(key)).toEqual(source); expect(client.getQueryState(key).isInvalidated).toBe(true);
});
