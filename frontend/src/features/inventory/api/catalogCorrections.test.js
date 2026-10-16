import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCatalogCorrection, catalogToday } from './catalogCorrections';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

const payload = () => ({ code: ' NEW-1 ', name: ' Corrected item ', unit: ' tablet ', effective_from: catalogToday(), reason: ' Label correction ' });

describe('catalog correction Rust contract', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
  beforeEach(() => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS' });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
    __resetV2ApiClientForTests();
  });

  it('sends only supported trimmed fields and returns the persisted version', async () => {
    const version = { id: 'version-1', item_id: 'item-1', ...payload(), code: 'NEW-1', name: 'Corrected item', unit: 'tablet', reason: 'Label correction' };
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: version }), { headers: { 'content-type': 'application/json' } }));
    const signal = new AbortController().signal;
    await expect(applyCatalogCorrection('item-1', { ...payload(), price: 999 }, { signal })).resolves.toEqual(version);
    const [url, request] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:8080/api/v2/inventory/catalog-edits');
    expect(request).toMatchObject({ method: 'POST', signal });
    expect(JSON.parse(request.body)).toEqual({ item_id: 'item-1', code: 'NEW-1', name: 'Corrected item', unit: 'tablet', effective_from: catalogToday(), reason: 'Label correction' });
  });

  it.each([
    { reason: ' ' }, { code: 'x'.repeat(121) }, { effective_from: '2026-02-31' }, { effective_from: '9999-01-01' },
  ])('rejects invalid fields before a write: %j', async (invalid) => {
    await expect(applyCatalogCorrection('item-1', { ...payload(), ...invalid })).rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves a definite server rejection for correction', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'You do not have permission for this action.' } }), { status: 403, headers: { 'content-type': 'application/json' } }));
    await expect(applyCatalogCorrection('item-1', payload())).rejects.toMatchObject({ status: 403, message: 'You do not have permission for this action.' });
  });

  it('does not accept a catalog receipt for another item', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'version-2', item_id: 'other-item', code: 'NEW-1', name: 'Corrected item', unit: 'tablet', effective_from: catalogToday() } }), { headers: { 'content-type': 'application/json' } }));
    await expect(applyCatalogCorrection('item-1', payload())).rejects.toMatchObject({ code: 'catalog_correction_unconfirmed' });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('marks a lost response as unconfirmed and never retries the write', async () => {
    globalThis.fetch.mockRejectedValueOnce(new TypeError('Connection lost'));
    await expect(applyCatalogCorrection('item-1', payload())).rejects.toMatchObject({ code: 'catalog_correction_unconfirmed' });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
});
