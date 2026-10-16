import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { getDispensingLocations } from './dispensingLocations';
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
describe('pharmacy-specific generated location contract', () => {
  it('uses bounded name/code search and opaque cursor with the original AbortSignal', async () => {
    const signal = new AbortController().signal; const page = { data: [{ id: 'location-opaque', name: 'Main pharmacy', code: 'PHARM' }], page: { has_next: true, next_cursor: 'next-page', limit: 25 } };
    globalThis.fetch.mockResolvedValueOnce(json(page)); await expect(getDispensingLocations({ search: ' Main ', cursor: 'prior-page', signal })).resolves.toEqual(page);
    const [url, options] = globalThis.fetch.mock.calls[0]; const parsed = new URL(url); expect(parsed.pathname).toBe('/api/v2/pharmacy/dispensing-locations'); expect(parsed.searchParams.get('limit')).toBe('25'); expect(parsed.searchParams.get('search')).toBe('Main'); expect(parsed.searchParams.get('cursor')).toBe('prior-page'); expect(options.signal).toBe(signal);
  });
  it('preserves denied/cancelled reads and refuses malformed or cycling pages', async () => {
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'permission_denied', message: 'Denied' } }, 403)); await expect(getDispensingLocations()).rejects.toMatchObject({ status: 403 });
    globalThis.fetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError')); await expect(getDispensingLocations()).rejects.toMatchObject({ name: 'AbortError' });
    globalThis.fetch.mockResolvedValueOnce(json({ data: [], page: { has_next: true, next_cursor: 'same' } })); await expect(getDispensingLocations({ cursor: 'same' })).rejects.toThrow(/could not be confirmed/);
  });
});
