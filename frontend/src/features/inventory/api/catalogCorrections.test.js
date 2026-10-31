import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCatalogCorrection, catalogCorrectionSchema, catalogToday } from './catalogCorrections';
const runtime = window.__HMS_RUNTIME_CONFIG__;
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; });
afterEach(() => { vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
describe('closed legacy catalog compatibility entry', () => {
 it.each([{}, { client_request_id: '24242424-0000-4000-8000-000000000004', expected_version: 1 }, { price: 999 }])('never upgrades or submits an old UUID-less correction body %j', async extra => {
  await expect(applyCatalogCorrection('item-1', { code: 'OLD', name: 'Old labels', unit: 'pack', effective_from: catalogToday(), reason: 'Old correction', ...extra })).rejects.toThrow(/Open catalog administration/); expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps legacy mode unavailable without invoking a Rust adapter', async () => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }; await expect(applyCatalogCorrection('item-1', {})).rejects.toThrow(/current inventory service/); expect(fetch).not.toHaveBeenCalled(); });
 it.each([{ reason: ' ' }, { code: 'x'.repeat(121) }, { effective_from: '2026-02-31' }, { effective_from: '9999-01-01' }])('retains old schema validation for isolated legacy callers %j', invalid => {
  expect(catalogCorrectionSchema.safeParse({ code: 'OLD', name: 'Old label', unit: 'pack', effective_from: catalogToday(), reason: 'Legacy reason', ...invalid }).success).toBe(false);
 });
});
