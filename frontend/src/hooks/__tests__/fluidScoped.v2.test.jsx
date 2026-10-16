import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { getV2FluidBalanceEntries, getV2FluidBalanceSummary, getV2FluidBalanceTrends, normalizeV2FluidBalancePayload } from '../nursingQueriesV2Bridge';
import { useFluidBalance, useFluidBalanceSummary, useFluidBalanceTrends, useFluidBalanceAlerts, useCreateFluidBalance, useTodayFluidBalance } from '../nursing/useFluidBalanceQueries';

const originalFetch = globalThis.fetch;
const originalConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;
const response = (data, page = { has_next: false, next_cursor: null }) => new Response(JSON.stringify({ data, page }), { status: 200, headers: { 'content-type': 'application/json' } });
const totals = (count) => ({ entry_count: count, total_intake_ml: count * 10, total_output_ml: count * 4, net_ml: count * 6 });
function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('complete scoped Rust fluid balance', () => {
  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({ getAccessToken: () => 'synthetic-access', getFacilityCode: () => 'HMS' });
  });
  afterEach(() => {
    __resetV2ApiClientForTests(); globalThis.fetch = originalFetch; globalThis.window.__HMS_RUNTIME_CONFIG__ = originalConfig;
  });

  it('loads all selected patient records after over100 unrelated records using server scoped cursors', async () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ id: `synthetic-${index}`, patient_id: index < 150 ? 'other-patient' : 'selected-patient', admission_case_id: index < 150 ? 'other-admission' : 'selected-admission', recorded_at: '2026-05-12T08:00:00Z', intake_ml: 10, output_ml: 4 }));
    globalThis.fetch.mockImplementation(async (url, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      const params = new URL(url).searchParams;
      expect(params.get('patient_id')).toBe('selected-patient');
      expect(params.get('admission_case_id')).toBe('selected-admission');
      expect(params.get('recorded_from')).toBe('2026-05-12T00:00:00.000Z');
      expect(params.get('recorded_before')).toBe('2026-05-13T00:00:00.000Z');
      const selected = rows.filter((row) => row.patient_id === params.get('patient_id'));
      const offset = Number(params.get('cursor') || 0); const limit = Number(params.get('limit')); const next = offset + limit;
      return response(selected.slice(offset, next), { has_next: next < selected.length, next_cursor: next < selected.length ? String(next) : null });
    });
    const { result } = renderHook(() => useFluidBalance('selected-patient', { admission: 'selected-admission', date: '2026-05-12', entry_type: 'intake' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(150));
    expect(result.current.data.every((row) => row.patient_id === 'selected-patient' && row.entry_type === 'intake')).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('loads totals from the complete server aggregate without fetching raw entry pages', async () => {
    globalThis.fetch.mockImplementation(async (url) => {
      const parsed = new URL(url);
      expect(parsed.pathname.endsWith('/fluid-balance/summary')).toBe(true);
      expect(parsed.searchParams.get('patient_id')).toBe('selected-patient');
      expect(parsed.searchParams.get('admission_case_id')).toBe('selected-admission');
      return response(totals(1000));
    });
    const { result } = renderHook(() => useFluidBalanceSummary('selected-patient', '2026-05-12', { admission_id: 'selected-admission' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.entry_count).toBe(1000));
    expect(result.current.data).toMatchObject({ total_intake: 10000, total_output: 4000, balance: 6000 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('sends only supported complete-summary scope and range fields, preserving AbortSignal', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockImplementation(async (url, options) => {
      const parsed = new URL(url); expect(parsed.pathname).toBe('/api/v2/nursing/fluid-balance/summary'); expect(Object.fromEntries(parsed.searchParams)).toEqual({ patient_id: 'selected-patient', admission_case_id: 'selected-admission', recorded_from: '2026-05-12T00:00:00.000Z', recorded_before: '2026-05-13T00:00:00.000Z' }); expect(options.signal).toBe(signal); return response(totals(1000));
    });
    await expect(getV2FluidBalanceSummary('selected-patient', { admission_id: 'selected-admission', date: '2026-05-12', limit: 7, cursor: 'synthetic-page', descending: true }, { signal })).resolves.toMatchObject({ entry_count: 1000, balance: 6000 }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses an explicitly supplied panel day for the today summary', async () => {
    globalThis.fetch.mockImplementation(async (url) => {
      const params = new URL(url).searchParams;
      expect(params.get('recorded_from')).toBe('2026-05-12T00:00:00.000Z');
      expect(params.get('recorded_before')).toBe('2026-05-13T00:00:00.000Z');
      return response(totals(1));
    });
    const { result } = renderHook(() => useTodayFluidBalance('selected-patient', { date: '2026-05-12' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.entry_count).toBe(1));
  });

  it('never automatically repeats a saved recording when its response is lost', async () => {
    let saved = 0;
    globalThis.fetch.mockImplementation(async (_url, options) => {
      expect(options.method).toBe('POST');
      saved += 1;
      throw new TypeError('Synthetic response lost after persistence');
    });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 1, retryDelay: 0 }, queries: { retry: false } } });
    const { result } = renderHook(() => useCreateFluidBalance(), { wrapper: wrapper(client) });
    await act(async () => {
      await expect(result.current.mutateAsync({ admission: 'selected-admission', entry_type: 'intake', volume_ml: 250 }))
        .rejects.toMatchObject({ name: 'FluidBalanceWriteUnconfirmedError' });
    });
    expect(saved).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('preserves All history by paging complete server daily aggregates', async () => {
    const days = Array.from({ length: 125 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), ...totals(1000) }));
    globalThis.fetch.mockImplementation(async (url) => {
      const parsed = new URL(url); const params = parsed.searchParams;
      expect(parsed.pathname.endsWith('/fluid-balance/trends')).toBe(true);
      expect(params.has('recorded_from')).toBe(false);
      const offset = Number(params.get('cursor') || 0); const next = offset + Number(params.get('limit'));
      return response(days.slice(offset, next), { has_next: next < days.length, next_cursor: next < days.length ? String(next) : null });
    });
    const { result } = renderHook(() => useFluidBalanceTrends('selected-patient'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(125));
    expect(result.current.data.reduce((sum, day) => sum + day.intake, 0)).toBe(1250000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['entries', 'trends'])('does not return partial %s after a later page fails', async (kind) => {
    globalThis.fetch.mockResolvedValueOnce(response([], { has_next: true, next_cursor: 'next' })).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    const signal = new AbortController().signal;
    const load = kind === 'entries' ? getV2FluidBalanceEntries : getV2FluidBalanceTrends;
    await expect(load('selected-patient', {}, { signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(globalThis.fetch.mock.calls.every(([, options]) => options.signal === signal)).toBe(true);
  });

  it('fails closed for repeated or absent cursors', async () => {
    globalThis.fetch.mockImplementation(async () => response([], { has_next: true, next_cursor: 'repeated' }));
    await expect(getV2FluidBalanceEntries('selected-patient')).rejects.toThrow('fully loaded');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('reads admission-scoped server assessments instead of inventing facility defaults or inferring no-data alarms', async () => {
    const policy = { version: 2, configured: true, values: { min_daily_intake_target: 1500, max_daily_output_threshold: 3000, negative_balance_alert_threshold: -500, positive_balance_alert_threshold: 2000, enable_intake_alerts: true, enable_output_alerts: true, enable_balance_alerts: true } };
    globalThis.fetch.mockImplementation(async (url) => { const parsed = new URL(url); expect(parsed.pathname.endsWith('/fluid-monitoring/assessment')).toBe(true); expect(parsed.searchParams.get('admission_case_id')).toBe('selected-admission'); return response({ admission_case_id: 'selected-admission', date: '2026-05-12', status: 'assessed', settings: policy, entry_count: 1000, total_intake_ml: 10000, total_output_ml: 4000, net_ml: 6000, conditions: [{ kind: 'positive_balance', severity: 'warning', value_ml: 6000, threshold_ml: 2000 }] }); });
    const { result } = renderHook(() => useFluidBalanceAlerts('selected-patient', '2026-05-12', { admission_id: 'selected-admission' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.summary.total_intake_ml).toBe(10000)); expect(result.current.data.alerts).toContainEqual(expect.objectContaining({ kind: 'positive_balance' }));
    const noAdmission = renderHook(() => useFluidBalanceAlerts('other-patient', '2026-05-12'), { wrapper: wrapper() }); await waitFor(() => expect(noAdmission.result.current.data?.status).toBe('admission_required')); expect(noAdmission.result.current.data.alerts).toEqual([]); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    globalThis.fetch.mockResolvedValueOnce(response([])); const invalid = renderHook(() => useFluidBalanceSummary('other-patient', '2026-05-12'), { wrapper: wrapper() }); await waitFor(() => expect(invalid.result.current.isError).toBe(true)); expect(invalid.result.current.data).toBeUndefined();
  });

  it('does not share entry cache data across canonical filters or authorization scope', async () => {
    let facility = 'synthetic-one'; let calls = 0;
    configureV2ApiClient({ getAccessToken: () => 'private-synthetic-token', getFacilityCode: () => facility });
    globalThis.fetch.mockImplementation(async () => response([{ id: `read-${++calls}`, patient_id: 'selected-patient', admission_case_id: 'selected-admission', intake_ml: 10, output_ml: 0, recorded_at: '2026-05-12T08:00:00Z' }]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const initial = { recorded_from: '2026-05-12T00:00:00Z', recorded_before: '2026-05-13T00:00:00Z' };
    const { result, rerender } = renderHook((filters) => useFluidBalance('selected-patient', filters), { initialProps: initial, wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data?.[0]?.source_id).toBe('read-1'));
    act(() => rerender({ ...initial, descending: true }));
    await waitFor(() => expect(result.current.data?.[0]?.source_id).toBe('read-2'));
    act(() => rerender({ ...initial, cursor: 'opaque-cursor' }));
    await waitFor(() => expect(result.current.data?.[0]?.source_id).toBe('read-3'));
    facility = 'synthetic-two'; act(() => rerender({ ...initial, cursor: 'opaque-cursor' }));
    await waitFor(() => expect(result.current.data?.[0]?.source_id).toBe('read-4'));
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain('private-synthetic-token');
    client.clear();
  });

  it('rejects fractional or invalid fluid volumes instead of truncating a write', () => {
    expect(() => normalizeV2FluidBalancePayload({ admission: 'selected-admission', entry_type: 'intake', volume_ml: '1.5' })).toThrow('whole');
    expect(() => normalizeV2FluidBalancePayload({ admission: 'selected-admission', intake_ml: -1 })).toThrow('non-negative');
  });
});
