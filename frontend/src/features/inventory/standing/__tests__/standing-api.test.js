import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { standingApi } from '../api';
const originalFetch = globalThis.fetch;
const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const payload = { name: 'Ward supplies', requesting_location_id: 'ward', fulfilling_location_id: 'store', frequency: 'weekly', next_run_on: '2026-10-15', monthly_day: null, notes: null, items: [{ item_id: 'item-1', quantity: 2, expected_unit: 'pack' }] };
const detail = { ...payload, id: 'template-1', version: 4, status: 'active', requesting_location_name: 'Ward A', fulfilling_location_name: 'Main store', line_count: 1, items: [{ id: 'line-1', item_id: 'item-1', item_name: 'Bandages', item_code: 'BAND', unit: 'pack', current_unit: 'pack', requires_unit_review: false, quantity: 2 }] };
const request = { id: 'request-1', source_template_id: 'template-1', template_version: 4, scheduled_for: '2026-10-15', status: 'requested', requesting_location_id: 'ward', fulfilling_location_id: 'store', items: [{ id: 'request-line-1', item_id: 'item-1', item_name: 'Bandages', item_code: 'BAND', unit: 'pack', quantity_requested: 2, quantity_issued: 0 }] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  globalThis.fetch = vi.fn();
});
afterEach(() => { globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
function lastWrite() { const [url, options] = globalThis.fetch.mock.calls.at(-1); return { path: new URL(url).pathname, method: options.method, body: options.body && JSON.parse(options.body) }; }
describe('standing-template generated Rust contracts', () => {
  it('uses bounded scoped list and active item/location search contracts with cancellation', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockImplementation(async () => json({ data: [], page: { limit: 25, has_next: false, next_cursor: null } }));
    await standingApi.list({ limit: 25, cursor: 'opaque-next', status: 'active', due_only: true, search: 'Ward' }, { signal });
    const [url, options] = globalThis.fetch.mock.calls[0]; const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/v2/inventory/standing-order-templates'); expect(parsed.searchParams.get('cursor')).toBe('opaque-next'); expect(parsed.searchParams.get('due_only')).toBe('true'); expect(options.signal).toBe(signal);
    await standingApi.choices('items', { limit: 25, search: 'Band' }, { signal }); expect(new URL(globalThis.fetch.mock.calls.at(-1)[0]).searchParams.get('status')).toBe('active');
    await standingApi.choices('locations', { limit: 25, cursor: 'locations-next' }, { signal }); expect(lastWrite().path).toBe('/api/v2/inventory/storage-locations');
    const aborted = new DOMException('Aborted', 'AbortError'); globalThis.fetch.mockRejectedValueOnce(aborted); await expect(standingApi.get('template-1', { signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('posts exact create/edit/status/due-occurrence payloads and validates persisted configuration', async () => {
    globalThis.fetch.mockResolvedValueOnce(json({ data: detail })); await expect(standingApi.create(payload)).resolves.toEqual(detail); expect(lastWrite()).toEqual({ path: '/api/v2/inventory/standing-order-templates', method: 'POST', body: payload });
    const update = { expected_version: 4, template: payload }; globalThis.fetch.mockResolvedValueOnce(json({ data: { ...detail, version: 5 } })); await standingApi.update('template-1', update); expect(lastWrite()).toEqual({ path: '/api/v2/inventory/standing-order-templates/template-1', method: 'PATCH', body: update });
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...detail, status: 'paused' } })); await standingApi.status('template-1', { expected_version: 4, status: 'paused' }); expect(lastWrite().body).toEqual({ expected_version: 4, status: 'paused' }); expect(lastWrite().path).toBe('/api/v2/inventory/standing-order-templates/template-1/status');
    globalThis.fetch.mockResolvedValueOnce(json({ data: request })); await standingApi.run('template-1', { expected_version: 4, scheduled_for: '2026-10-15' }); expect(lastWrite()).toEqual({ path: '/api/v2/inventory/standing-order-templates/template-1/runs', method: 'POST', body: { expected_version: 4, scheduled_for: '2026-10-15' } });
  });
  it('keeps approval separate and confirms a complete server-returned stock issue', async () => {
    const action = { expected_source_version: 4 };
    globalThis.fetch.mockResolvedValueOnce(json({ data: request })); await standingApi.review('request-1'); expect(lastWrite().path).toBe('/api/v2/inventory/requisitions/request-1/review');
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...request, status: 'approved', approved_at: '2026-10-15T12:00:00Z' } })); await standingApi.approve('request-1', action); expect(lastWrite()).toEqual({ path: '/api/v2/inventory/requisitions/request-1/review/approve', method: 'POST', body: action });
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...request, status: 'fulfilled', fulfilled_at: '2026-10-15T12:01:00Z', items: request.items.map((item) => ({ ...item, quantity_issued: 2 })) } })); await standingApi.issue('request-1', action); expect(lastWrite()).toEqual({ path: '/api/v2/inventory/requisitions/request-1/issue', method: 'POST', body: action });
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...request, status: 'cancelled', cancelled_at: '2026-10-15T12:00:00Z' } })); await standingApi.cancel('request-1', action); expect(lastWrite()).toEqual({ path: '/api/v2/inventory/requisitions/request-1/review/cancel', method: 'POST', body: action });
  });
  it.each([
    ['create', () => standingApi.create(payload), 'standing_template_create_unconfirmed'],
    ['update', () => standingApi.update('template-1', { expected_version: 4, template: payload }), 'standing_template_update_unconfirmed'],
    ['status', () => standingApi.status('template-1', { expected_version: 4, status: 'paused' }), 'standing_template_status_unconfirmed'],
    ['run', () => standingApi.run('template-1', { expected_version: 4, scheduled_for: '2026-10-15' }), 'standing_template_run_unconfirmed'],
    ['approve', () => standingApi.approve('request-1', { expected_source_version: 4 }), 'standing_request_approve_unconfirmed'],
    ['issue', () => standingApi.issue('request-1', { expected_source_version: 4 }), 'standing_request_issue_unconfirmed'],
    ['cancel', () => standingApi.cancel('request-1', { expected_source_version: 4 }), 'standing_request_cancel_unconfirmed'],
  ])('treats a generic409 after %s as an uncertain commit without retry', async (_operation, call, code) => {
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code, message: 'The write result could not be confirmed.' } }, 409)); await expect(call()).rejects.toMatchObject({ code: 'standing_write_unconfirmed' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not claim success for wrong quantities, status, source versions or partial stock issue', async () => {
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...detail, items: [{ ...detail.items[0], quantity: 99 }] } })); await expect(standingApi.create(payload)).rejects.toMatchObject({ code: 'standing_write_unconfirmed' });
    globalThis.fetch.mockResolvedValueOnce(json({ data: detail })); await expect(standingApi.status('template-1', { expected_version: 4, status: 'paused' })).rejects.toMatchObject({ code: 'standing_write_unconfirmed' });
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...request, template_version: 8 } })); await expect(standingApi.run('template-1', { expected_version: 4, scheduled_for: '2026-10-15' })).rejects.toMatchObject({ code: 'standing_write_unconfirmed' });
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...request, status: 'fulfilled', items: [{ ...request.items[0], quantity_issued: 1 }] } })); await expect(standingApi.issue('request-1', { expected_source_version: 4 })).rejects.toMatchObject({ code: 'standing_write_unconfirmed' });
  });
  it('preserves definite denied/unit/version conflicts and fails closed against an older backend', async () => {
    for (const [status, code] of [[403, 'permission_denied'], [409, 'standing_template_unit_changed'], [409, 'standing_template_version_conflict']]) {
      globalThis.fetch.mockResolvedValueOnce(json({ error: { code, message: 'Review current configuration before continuing.' } }, status)); await expect(standingApi.update('template-1', { expected_version: 4, template: payload })).rejects.toMatchObject({ status, data: { error: { code } } });
    }
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'not_found', message: 'Not found' } }, 404)); await expect(standingApi.list({ limit: 25 })).rejects.toMatchObject({ status: 404 }); expect(lastWrite().path).toBe('/api/v2/inventory/standing-order-templates');
  });
});
