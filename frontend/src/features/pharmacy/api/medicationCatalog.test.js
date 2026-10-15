import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { getMedicationCatalog, medicationCatalogKeys } from './medicationCatalog';

describe('Generated prescribing catalog contract', () => {
  beforeEach(() => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    __resetV2ApiClientForTests();
    configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetV2ApiClientForTests();
    delete window.__HMS_RUNTIME_CONFIG__;
  });
  it('preserves server paging, encoded search and cancellation on the generated route', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], page: { has_next: false } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const response = await getMedicationCatalog({ search: ' Code % ', cursor: 'opaque-cursor', signal });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toContain('/api/v2/clinical/medication-catalog?');
    expect(new URL(url).searchParams.get('search')).toBe('Code %');
    expect(new URL(url).searchParams.get('cursor')).toBe('opaque-cursor');
    expect(new URL(url).searchParams.get('limit')).toBe('25');
    expect(request.signal).toBe(signal);
    expect(response.page.has_next).toBe(false);
  });
  it('preserves AbortError and changes catalog keys across authorization scopes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
    await expect(getMedicationCatalog()).rejects.toMatchObject({ name: 'AbortError' });
    const before = medicationCatalogKeys.search('request');
    configureV2ApiClient({ getAccessToken: () => 'another-synthetic-token' });
    expect(medicationCatalogKeys.search('request')).not.toEqual(before);
    expect(JSON.stringify(before)).not.toContain('synthetic-token');
  });
});
