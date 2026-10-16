import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient } from '@/lib/api/v2/client';
import { getV2Handoffs, getV2NursingAlerts, getV2TreatmentSheets, nursingListCacheScope } from '../nursingQueriesV2Bridge';
import { useAcknowledgeAlert, useActiveAlerts, useNursingAlerts, useShiftHandoffs, useTodayHandoffs, useTreatmentSheetByAdmission } from '../useNursingQueries';

const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const patient = 'f2000000-0000-4000-8000-000000000001'; const admission = 'f2000000-0000-4000-8000-000000000002'; const other = 'f2000000-0000-4000-8000-000000000003'; const ward = 'f2000000-0000-4000-8000-000000000004';
const alert = { id: 'f2000000-0000-4000-8000-000000000005', patient_id: patient, admission_case_id: admission, severity: 'critical', status: 'open', title: 'Synthetic alert', created_at: '2026-10-16T01:00:00Z' };
const handoff = { id: alert.id, ward_id: ward, shift_label: 'night', status: 'draft', created_at: alert.created_at };
const sheet = { id: alert.id, patient_id: patient, admission_case_id: admission, status: 'active', sheet_date: '2026-10-16', updated_at: alert.created_at };
const page = (data, cursor = null) => new Response(JSON.stringify({ data, page: { has_next: !!cursor, next_cursor: cursor, limit: 50 } }), { headers: { 'content-type': 'application/json' } });
let client; let token;
function Wrapper({ children }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
beforeEach(() => { token = 'SYNTHETIC-PRIVATE-TOKEN'; __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false }); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); globalThis.fetch = vi.fn(); });
afterEach(() => { client.clear(); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = originalRuntime; globalThis.fetch = originalFetch; });

describe('server-scoped nursing cursor pages', () => {
  it('keeps today handoff reads disabled until their caller enables them', async () => {
    globalThis.fetch.mockResolvedValueOnce(page([]));
    const { result, rerender } = renderHook(({ enabled }) => useTodayHandoffs({ enabled }), { initialProps: { enabled: false }, wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle'); expect(globalThis.fetch).not.toHaveBeenCalled();
    rerender({ enabled: true }); await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URL(globalThis.fetch.mock.calls[0][0]).searchParams;
    expect(params.get('created_from')).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  });
  it('requests active high/critical alerts before the limit and exposes overflow without loading a facility collection', async () => {
    globalThis.fetch.mockResolvedValueOnce(page([alert], 'next-page'));
    const { result } = renderHook(() => useActiveAlerts({ criticalOnly: true }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URL(globalThis.fetch.mock.calls[0][0]).searchParams;
    expect(Object.fromEntries(params)).toEqual({ limit: '50', descending: 'true', status: 'open', critical_only: 'true' });
    expect(result.current.data).toHaveLength(1); expect(result.current.hasNextPage).toBe(true); expect(result.current.nextCursor).toBe('next-page'); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('sends patient/admission/ward and half-open UTC bounds to the server for alert pages', async () => {
    globalThis.fetch.mockResolvedValueOnce(page([alert])); const signal = new AbortController().signal;
    const result = await getV2NursingAlerts({ patient, admission, ward, date: '2026-10-16', status: 'open', severity: 'critical', cursor: 'opaque-page' }, { signal });
    const params = new URL(globalThis.fetch.mock.calls[0][0]).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ patient_id: patient, admission_case_id: admission, ward_id: ward, created_from: '2026-10-16T00:00:00.000Z', created_before: '2026-10-17T00:00:00.000Z', cursor: 'opaque-page' });
    expect(globalThis.fetch.mock.calls[0][1].signal).toBe(signal); expect(result.has_next).toBe(false);
  });
  it.each([
    ['alerts', () => getV2NursingAlerts({ patient_id: patient, admission_case_id: admission }), { ...alert, admission_case_id: other }],
    ['treatment', () => getV2TreatmentSheets({ patient_id: patient, admission_case_id: admission }), { ...sheet, patient_id: other }],
    ['handoffs', () => getV2Handoffs({ ward_id: ward, shift_label: 'night' }), { ...handoff, ward_id: other }],
  ])('rejects an out-of-scope %s response rather than filtering it into a false empty state', async (_kind, load, row) => { globalThis.fetch.mockResolvedValueOnce(page([row])); await expect(load()).rejects.toThrow(/scope/); });
  it('requests an exact treatment ID rather than searching a facility preview', async () => {
    globalThis.fetch.mockResolvedValueOnce(page([sheet])); const result = await getV2TreatmentSheets({ id: sheet.id, admission, date: '2026-10-16', limit: 1 });
    const params = new URL(globalThis.fetch.mock.calls[0][0]).searchParams; expect(params.get('id')).toBe(sheet.id); expect(params.get('admission_case_id')).toBe(admission); expect(params.get('sheet_date')).toBe('2026-10-16'); expect(result.results[0].id).toBe(sheet.id);
  });
  it('uses actual ward/shift/date/status handoff fields and refuses a patient association that does not exist', async () => {
    globalThis.fetch.mockResolvedValueOnce(page([handoff])); await getV2Handoffs({ ward, shift: 'night', date: '2026-10-16', status: 'draft' });
    const params = new URL(globalThis.fetch.mock.calls[0][0]).searchParams; expect(params.get('ward_id')).toBe(ward); expect(params.get('shift_label')).toBe('night'); expect(params.get('status')).toBe('draft'); expect(params.get('created_before')).toBe('2026-10-17T00:00:00.000Z');
    await expect(getV2Handoffs({ patient })).rejects.toThrow(/patient handover is not available/); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('makes a failed later page unavailable and keeps the earlier page cached only under its own cursor', async () => {
    globalThis.fetch.mockResolvedValueOnce(page([handoff], 'second-page')).mockRejectedValueOnce(new Error('Synthetic later-page failure'));
    const { result, rerender } = renderHook(({ cursor }) => useShiftHandoffs({ ward, cursor }), { initialProps: { cursor: undefined }, wrapper: Wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true)); rerender({ cursor: 'second-page' }); await waitFor(() => expect(result.current.isError).toBe(true)); expect(result.current.data).toBeUndefined();
    const params = new URL(globalThis.fetch.mock.calls[1][0]).searchParams; expect(params.get('cursor')).toBe('second-page'); expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['a repeated cursor', () => getV2NursingAlerts({ cursor: 'same' }), () => page([alert], 'same')],
    ['missing pagination', () => getV2TreatmentSheets(), () => new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } })],
    ['an empty page claiming more data', () => getV2Handoffs(), () => page([], 'next')],
    ['duplicate IDs', () => getV2NursingAlerts(), () => page([alert, alert])],
  ])('fails closed for %s', async (_label, load, response) => { globalThis.fetch.mockResolvedValueOnce(response()); await expect(load()).rejects.toBeInstanceOf(Error); });
  it('preserves AbortError and refuses page numbers without a server cursor', async () => {
    globalThis.fetch.mockRejectedValueOnce(new DOMException('Synthetic cancellation', 'AbortError')); await expect(getV2Handoffs({}, { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(getV2NursingAlerts({ page: 2 })).rejects.toThrow(/server cursor/); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps canonical aliases, scope, direction, cursor and authorization isolated without putting request text in cache keys', async () => {
    const privatePatient = 'SYNTHETIC-PRIVATE-PATIENT-MRN'; const privateAdmission = 'SYNTHETIC-PRIVATE-ADMISSION'; const privateShift = 'SYNTHETIC-PRIVATE-NAME-MRN';
    globalThis.fetch.mockImplementation(async (url) => new URL(url).pathname.endsWith('/handoffs') ? page([]) : page([]));
    const alerts = renderHook(({ filters }) => useNursingAlerts(filters), { initialProps: { filters: { patient_id: privatePatient, admission_case_id: privateAdmission } }, wrapper: Wrapper });
    const handoffs = renderHook(() => useShiftHandoffs({ ward_id: ward, shift_label: privateShift }), { wrapper: Wrapper });
    const treatments = renderHook(() => useTreatmentSheetByAdmission(privateAdmission), { wrapper: Wrapper });
    await waitFor(() => expect(alerts.result.current.isSuccess && handoffs.result.current.isSuccess && treatments.result.current.isSuccess).toBe(true));
    const originalKeys = client.getQueryCache().getAll().map((entry) => entry.queryKey);
    const serialized = JSON.stringify(originalKeys); for (const secret of [privatePatient, privateAdmission, privateShift, token]) expect(serialized).not.toContain(secret);
    expect(nursingListCacheScope('alerts', { patient: patient, admission })).toBe(nursingListCacheScope('alerts', { patient_id: patient, admission_case_id: admission }));
    const scopes = [{ patient_id: patient }, { patient_id: other }, { patient_id: patient, descending: true }, { patient_id: patient, cursor: 'page-2' }].map((query) => nursingListCacheScope('alerts', query)); expect(new Set(scopes).size).toBe(4);
    token = 'SYNTHETIC-OTHER-TOKEN'; alerts.rerender({ filters: { patient_id: privatePatient, admission_case_id: privateAdmission } }); await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(4));
    const currentKey = client.getQueryCache().getAll().find((entry) => entry.queryKey[0] === 'nursing-alerts').queryKey;
    expect(currentKey).not.toEqual(originalKeys.find((key) => key[0] === 'nursing-alerts'));
  });
  it('reports invalid filters as a query error without throwing from render or leaking their input into keys', async () => {
    const { result } = renderHook(() => useNursingAlerts({ page: 2, patient: 'SYNTHETIC-PRIVATE-TEXT' }), { wrapper: Wrapper }); await waitFor(() => expect(result.current.isError).toBe(true)); expect(globalThis.fetch).not.toHaveBeenCalled(); expect(JSON.stringify(client.getQueryCache().getAll().map((entry) => entry.queryKey))).not.toContain('SYNTHETIC-PRIVATE-TEXT');
    await expect(getV2NursingAlerts({ patient_id: patient, patient: other })).rejects.toThrow(/inconsistent/);
  });
  it.each([
    ['a mismatched saved alert', () => new Response(JSON.stringify({ data: { ...alert, id: other, status: 'acknowledged', acknowledged_at: alert.created_at } }), { headers: { 'content-type': 'application/json' } })],
    ['a missing acknowledgment timestamp', () => new Response(JSON.stringify({ data: { ...alert, status: 'acknowledged' } }), { headers: { 'content-type': 'application/json' } })],
    ['a generic persistence conflict', () => new Response(JSON.stringify({ error: { code: 'alert_acknowledge_unconfirmed', message: 'Acknowledgment could not be confirmed.' } }), { status: 409, headers: { 'content-type': 'application/json' } })],
    ['a lost response', () => Promise.reject(new TypeError('Synthetic response lost after save'))],
  ])('requires review for %s without automatically acknowledging twice', async (_label, response) => {
    client.setDefaultOptions({ mutations: { retry: 1 } });
    globalThis.fetch.mockImplementationOnce(response);
    const { result } = renderHook(() => useAcknowledgeAlert(), { wrapper: Wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ alertId: alert.id })).rejects.toMatchObject({ name: 'NursingAlertAcknowledgmentUnconfirmedError' }); });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
