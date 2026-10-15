import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { getV2MedicationAdministrations, medicationAdministrationQuery } from '../nursingQueriesV2Bridge';
import { useMARGrid } from '../nursing/useTreatmentSupplyQueries';
import { useMedicationAdministrationHistory, useMedicationAdministrations } from '../useNursingQueries';

const originalFetch = globalThis.fetch;
const originalConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;
const response = (data, page = { has_next: false, next_cursor: null }) => new Response(JSON.stringify({ data, page }), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const dose = (index, patient = 'selected-patient', admission = 'selected-admission') => ({
  id: `synthetic-dose-${patient}-${index}`, patient_id: patient, admission_case_id: admission,
  medication_name: 'Synthetic medication', medication_course_id: 'synthetic-course',
  dose: '1 tablet', route: 'oral', frequency: 'q4h', status: 'scheduled',
  scheduled_at: new Date(Date.UTC(2026, 4, 12, 0, index)).toISOString(),
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('scoped Rust MAR reads', () => {
  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({ getAccessToken: () => 'synthetic-access', getFacilityCode: () => 'HMS' });
  });
  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.fetch = originalFetch;
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalConfig;
  });

  it('loads every scoped grid page despite over100 unrelated facility doses', async () => {
    const rows = [
      ...Array.from({ length: 150 }, (_, index) => dose(index, 'other-patient', 'other-admission')),
      ...Array.from({ length: 123 }, (_, index) => dose(index)),
    ];
    globalThis.fetch.mockImplementation(async (url) => {
      const params = new URL(url).searchParams;
      expect(params.get('admission_case_id')).toBe('selected-admission');
      expect(params.get('scheduled_from')).toBe('2026-05-12T00:00:00.000Z');
      expect(params.get('scheduled_before')).toBe('2026-05-19T00:00:00.000Z');
      const scoped = rows.filter((row) => row.admission_case_id === params.get('admission_case_id'));
      const offset = Number(params.get('cursor') || 0);
      const limit = Number(params.get('limit'));
      const next = offset + limit;
      return response(scoped.slice(offset, next), { has_next: next < scoped.length, next_cursor: next < scoped.length ? String(next) : null });
    });
    const { result } = renderHook(() => useMARGrid('selected-admission', '2026-05-12', 7), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data.medications[0].total_doses_required).toBe(123);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps server cursors and unknown totals for medication history', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(response([dose(3), dose(2)], { has_next: true, next_cursor: 'opaque-next' }))
      .mockResolvedValueOnce(response([dose(1)], { has_next: false, next_cursor: null }));
    const { result, rerender } = renderHook(({ page, cursor }) => useMedicationAdministrationHistory({
      patient: 'selected-patient', page, cursor, page_size: 2, ordering: '-scheduled_time',
    }), { initialProps: { page: 1, cursor: undefined }, wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.results).toHaveLength(2));
    expect(result.current.data).toMatchObject({ has_next: true, next_cursor: 'opaque-next', count_exact: false, count: 2 });
    expect(new URL(globalThis.fetch.mock.calls[0][0]).searchParams.get('patient_id')).toBe('selected-patient');
    expect(new URL(globalThis.fetch.mock.calls[0][0]).searchParams.get('descending')).toBe('true');
    act(() => rerender({ page: 2, cursor: result.current.data.next_cursor }));
    await waitFor(() => expect(result.current.data?.results[0]?.id).toBe(dose(1).id));
    expect(new URL(globalThis.fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('opaque-next');
    expect(result.current.data).toMatchObject({ has_next: false, has_previous: true, count_exact: false, count: 3 });
    expect(result.current.data.total_pages).toBeUndefined();
  });

  it('does not return a partial grid after a later page fails or is aborted', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch
      .mockResolvedValueOnce(response([dose(1)], { has_next: true, next_cursor: 'next' }))
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(getV2MedicationAdministrations({ patient: 'selected-patient', date: '2026-05-12' }, { signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls.every(([, options]) => options.signal === signal)).toBe(true);
  });

  it('rejects a later server failure instead of returning the first medication page', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(response([dose(1)], { has_next: true, next_cursor: 'next' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Unavailable' } }), {
        status: 503, headers: { 'content-type': 'application/json' },
      }));
    await expect(getV2MedicationAdministrations({ admission: 'selected-admission' })).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('requires the server cursor for a later history page', async () => {
    const { result } = renderHook(() => useMedicationAdministrationHistory({ patient: 'selected-patient', page: 2 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toContain('next history page');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('separates every canonical MAR query field and authorization scope in the cache', async () => {
    let facility = 'synthetic-facility-one';
    configureV2ApiClient({ getAccessToken: () => 'private-synthetic-token', getFacilityCode: () => facility });
    let requests = 0;
    globalThis.fetch.mockImplementation(async () => response([{ ...dose(1), id: `read-${++requests}` }]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const provider = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const initial = { patient_id: 'selected-patient', scheduled_from: '2026-05-12T00:00:00Z', scheduled_before: '2026-05-13T00:00:00Z', limit: 10 };
    const { result, rerender } = renderHook((filters) => useMedicationAdministrations(filters), { initialProps: initial, wrapper: provider });
    await waitFor(() => expect(result.current.data?.[0]?.id).toBe('read-1'));
    const variants = [
      { ...initial, descending: true },
      { ...initial, scheduled_before: '2026-05-14T00:00:00Z' },
      { ...initial, cursor: 'opaque-cursor' },
      { ...initial, limit: 20 },
    ];
    for (const [index, filters] of variants.entries()) {
      act(() => rerender(filters));
      await waitFor(() => expect(result.current.data?.[0]?.id).toBe(`read-${index + 2}`));
    }
    facility = 'synthetic-facility-two';
    act(() => rerender({ ...variants[3] }));
    await waitFor(() => expect(result.current.data?.[0]?.id).toBe('read-6'));
    const keys = JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey));
    expect(keys).not.toContain('private-synthetic-token');
    expect(keys).not.toContain('synthetic-facility-one');
    expect(keys).not.toContain('synthetic-facility-two');
    client.clear();
  });

  it('rejects broken cursor chains instead of claiming completeness', async () => {
    globalThis.fetch.mockImplementation(async () => response([dose(1)], { has_next: true, next_cursor: 'repeated' }));
    await expect(getV2MedicationAdministrations({ patient: 'selected-patient' })).rejects.toThrow('fully loaded');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects absent pagination metadata instead of assuming the first page is complete', async () => {
    globalThis.fetch.mockResolvedValueOnce(response([dose(1)], {}));
    await expect(getV2MedicationAdministrations({ patient: 'selected-patient' })).rejects.toThrow('pagination');
  });

  it('uses an exclusive UTC date end and rejects impossible dates or unsupported outcomes', () => {
    expect(medicationAdministrationQuery({ patient: 'selected-patient', date: '2026-05-12' })).toMatchObject({
      patient_id: 'selected-patient', scheduled_from: '2026-05-12T00:00:00.000Z', scheduled_before: '2026-05-13T00:00:00.000Z',
    });
    expect(() => medicationAdministrationQuery({ date: '2026-02-30' })).toThrow('valid');
    expect(medicationAdministrationQuery({ status: 'refused' })).toMatchObject({ status: 'refused' });
    expect(() => medicationAdministrationQuery({ status: 'cancelled' })).toThrow('not supported');
  });
});
