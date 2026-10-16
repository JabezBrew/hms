import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { seriesApi } from '../api';
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const payload = { client_request_id: 'request-key', patient_id: 'patient-1', clinic_id: 'clinic-1', service_id: 'service-1', occurrences: [{ session_id: 'session-1', starts_at: '2027-01-01T09:00:00Z', ends_at: '2027-01-01T10:00:00Z' }, { session_id: 'session-2', starts_at: '2027-01-08T09:00:00Z', ends_at: '2027-01-08T10:00:00Z', overbook_reason: 'Capacity approved' }] };
const detail = { id: 'series-1', patient_id: payload.patient_id, clinic_id: payload.clinic_id, service_id: payload.service_id, snapshot_token: 'opaque-snapshot', occurrence_count: 2, appointments: payload.occurrences.map((row, i) => ({ id: `member-${i}`, clinic_session_id: row.session_id, starts_at: row.starts_at, ends_at: row.ends_at, status: 'scheduled' })) };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
function last() { const [url, options] = globalThis.fetch.mock.calls.at(-1); return { path: new URL(url).pathname, method: options.method, body: options.body && JSON.parse(options.body), signal: options.signal }; }
describe('appointment group real generated contracts', () => {
  it('posts one flat atomic request and reads the exact group/by-request contracts with cancellation', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(json({ data: detail })); await expect(seriesApi.create(payload, { signal })).resolves.toEqual(detail); expect(last()).toEqual({ path: '/api/v2/scheduling/appointment-series', method: 'POST', body: payload, signal });
    globalThis.fetch.mockResolvedValueOnce(json({ data: detail })); await seriesApi.get(detail.id, { signal }); expect(last()).toEqual({ path: '/api/v2/scheduling/appointment-series/series-1', method: 'GET', body: undefined, signal });
    globalThis.fetch.mockResolvedValueOnce(json({ data: detail })); await seriesApi.recover(payload.client_request_id, { signal }); expect(last().path).toBe('/api/v2/scheduling/appointment-series/requests/request-key');
  });
  it('preserves saved cancellation cutoff, membership and actual counts', async () => {
    const receipt = { series: { ...detail, appointments: [{ ...detail.appointments[0], status: 'cancelled' }, { ...detail.appointments[1], status: 'arrived' }] }, cutoff_at: '2026-10-16T00:00:00Z', cancelled_appointment_ids: ['member-0'], retained_appointment_ids: ['member-1'], cancelled_count: 1 };
    const action = { client_request_id: 'cancel-key', expected_snapshot_token: detail.snapshot_token, reason: 'Plans changed' };
    globalThis.fetch.mockResolvedValueOnce(json({ data: receipt })); await expect(seriesApi.cancel(detail.id, action)).resolves.toEqual(receipt); expect(last().path).toBe('/api/v2/scheduling/appointment-series/series-1/cancel-future'); expect(last().body).toEqual(action);
  });
  it('rejects malformed success and mismatched membership as unknown writes', async () => {
    for (const data of [{}, { ...detail, patient_id: 'other-patient' }, { ...detail, occurrence_count: 1 }, { ...detail, appointments: [detail.appointments[0], detail.appointments[0]] }, { ...detail, appointments: detail.appointments.map((member) => ({ ...member, clinic_session_id: 'wrong-session' })) }, { ...detail, appointments: detail.appointments.map((member) => ({ ...member, starts_at: '2027-01-01T15:00:00Z', ends_at: '2027-01-01T16:00:00Z' })) }]) { globalThis.fetch.mockResolvedValueOnce(json({ data })); await expect(seriesApi.create(payload)).rejects.toMatchObject({ name: 'AppointmentSeriesUnconfirmedError' }); }
    globalThis.fetch.mockResolvedValueOnce(json({ data: { series: detail, cutoff_at: '2026-10-16T00:00:00Z', cancelled_count: 2, cancelled_appointment_ids: ['member-0', 'member-1'], retained_appointment_ids: [] } })); await expect(seriesApi.cancel(detail.id, {})).rejects.toMatchObject({ name: 'AppointmentSeriesUnconfirmedError' });
  });
  it('allows a legitimate later reschedule on explicit replay or original-request recovery', async () => {
    const rescheduled = { ...detail, appointments: detail.appointments.map((member) => ({ ...member, starts_at: '2027-01-01T15:00:00Z', ends_at: '2027-01-01T16:00:00Z' })) };
    globalThis.fetch.mockResolvedValueOnce(json({ data: rescheduled })); await expect(seriesApi.create(payload, { currentMembership: true })).resolves.toEqual(rescheduled); expect(last().body).toEqual(payload);
    globalThis.fetch.mockResolvedValueOnce(json({ data: rescheduled })); await expect(seriesApi.recover(payload.client_request_id, { expected: payload })).resolves.toEqual(rescheduled);
  });
  it.each(['appointment_series_create_unconfirmed', 'appointment_series_cancel_unconfirmed'])('keeps generic409 %s uncertain with no automatic retry', async (code) => {
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code, message: 'Save result unknown' } }, 409)); await expect(code.includes('cancel') ? seriesApi.cancel(detail.id, {}) : seriesApi.create(payload)).rejects.toMatchObject({ name: 'AppointmentSeriesUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps definite stale/denied failures and unknown recovery reads distinct', async () => {
    for (const [status, code] of [[403, 'permission_denied'], [409, 'appointment_series_snapshot_conflict']]) { globalThis.fetch.mockResolvedValueOnce(json({ error: { code, message: 'Review current group' } }, status)); await expect(seriesApi.cancel(detail.id, {})).rejects.toMatchObject({ status, data: { error: { code } } }); }
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'not_found', message: 'Not found' } }, 404)); await expect(seriesApi.recover('request-key')).rejects.toMatchObject({ status: 404 });
  });
  it('loads bounded actual availability with the original signal and preserves AbortError', async () => {
    const signal = new AbortController().signal; globalThis.fetch.mockResolvedValueOnce(json({ data: { slots: [] } })); await seriesApi.slots({ start_date: '2027-01-01', end_date: '2027-01-01', clinic_id: 'clinic-1', service_id: 'service-1' }, { signal }); const url = new URL(globalThis.fetch.mock.calls[0][0]); expect(url.pathname).toBe('/api/v2/scheduling/availability'); expect(url.searchParams.get('limit')).toBe('100'); expect(last().signal).toBe(signal);
    globalThis.fetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError')); await expect(seriesApi.get(detail.id, { signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('refuses malformed availability rather than offering unconfirmed slots', async () => {
    globalThis.fetch.mockResolvedValueOnce(json({ data: { slots: [{ session_id: 'session-1', clinic_id: 'clinic-1', start: '2027-01-01T09:00:00Z', end: '2027-01-01T10:00:00Z' }] } })); await expect(seriesApi.slots({ clinic_id: 'clinic-1' })).rejects.toThrow(/availability could not be confirmed/);
  });
});
