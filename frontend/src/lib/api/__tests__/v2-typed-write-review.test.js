import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteReview, acknowledgeWriteResponse, copyWriteResponseMetadata, activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { requestPrnDose } from '@/features/nursing/api/prn';
import { standingApi } from '@/features/inventory/standing/api';
import { createPrescription } from '@/hooks/usePrescriptionMutations';
import { billingApi } from '@/lib/api/billing';
import { applyCatalogCorrection, catalogToday } from '@/features/inventory/api/catalogCorrections';

const principal = { id: '70000000-0000-4000-8000-000000000001', facility_id: '70000000-0000-4000-8000-000000000002', active_profile: 'hospital' };
const prescription = '70000000-0000-4000-8000-000000000003';
const admission = '70000000-0000-4000-8000-000000000004';
const key = '70000000-0000-4000-8000-000000000005';
const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
function activate() {
  const guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-same-authority', principal });
  guard.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  activateWriteUncertainty(principal);
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests();
  configureV2ApiClient({ getAccessToken: () => 'synthetic-private-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  activate(); globalThis.fetch = vi.fn();
});
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; });

describe('typed success validation and durable opaque write review', () => {
  it.each(['network', 'dispatched-abort', 'invalid-json', 'malformed-envelope'])('retains opaque attempt metadata for recoverable %s errors', async (kind) => {
    if (kind === 'network') globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic connection lost'));
    if (kind === 'dispatched-abort') globalThis.fetch.mockRejectedValueOnce(new DOMException('Synthetic dispatched abort', 'AbortError'));
    if (kind === 'invalid-json') globalThis.fetch.mockResolvedValueOnce(new Response('{', { headers: { 'content-type': 'application/json' } }));
    if (kind === 'malformed-envelope') globalThis.fetch.mockResolvedValueOnce(json({ unexpected: true }));
    const original = await v2Request({ method: 'PATCH', path: `/api/v2/clinical/prescriptions/${prescription}/documentation`, body: { client_request_id: key, expected_snapshot_token: 'a'.repeat(64), instructions: 'SYNTHETIC-PRIVATE-TEXT', reason: 'SYNTHETIC-PRIVATE-REASON' } }).catch((error) => error);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    const wrapped = copyWriteResponseMetadata(new Error('Typed uncertainty'), original);
    expect(wrapped.data).toBeUndefined();
    expect(() => acknowledgeWriteResponse(wrapped)).toThrow();
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    globalThis.fetch.mockResolvedValueOnce(json({ data: { id: prescription } }));
    await v2Request({ path: '/api/v2/clinical/prescriptions/{id}', pathParams: { id: prescription } });
    expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);
    acknowledgeWriteResponse(wrapped);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  });

  it('forwards opaque attempt metadata through a typed error without copying server or request data', async () => {
    const body = { client_request_id: key, expected_snapshot_token: 'a'.repeat(64), instructions: 'SYNTHETIC-PRIVATE-TEXT', reason: 'SYNTHETIC-PRIVATE-REASON' };
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'prescription_action_unconfirmed', message: 'SYNTHETIC-PRIVATE-SERVER-CONTENT' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    const original = await v2Request({ method: 'PATCH', path: `/api/v2/clinical/prescriptions/${prescription}/documentation`, body }).catch((error) => error);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    const wrapped = copyWriteResponseMetadata(new Error('Typed change could not be confirmed'), original);
    expect(wrapped.data).toBeUndefined();
    expect(JSON.stringify(wrapped)).not.toContain('SYNTHETIC-PRIVATE');
    expect(() => acknowledgeWriteResponse(wrapped)).toThrow();
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    globalThis.fetch.mockResolvedValueOnce(json({ data: { id: prescription } }));
    await v2Request({ path: '/api/v2/clinical/prescriptions/{id}', pathParams: { id: prescription } });
    expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);
    acknowledgeWriteResponse(wrapped);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  });

  it.each([['PATCH', 'documentation'], ['POST', 'new-course']])('permits only the exact explicitly retried prescription %s %s command', async (method, action) => {
    const path = `/api/v2/clinical/prescriptions/${prescription}/${action}`;
    const payload = { client_request_id: key, expected_snapshot_token: 'a'.repeat(64), instructions: 'SYNTHETIC-PRIVATE-INSTRUCTIONS', reason: 'SYNTHETIC-PRIVATE-REASON' };
    const write = (body) => v2Request({ method, path, body });
    globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost'));
    await expect(write(payload)).rejects.toMatchObject({ status: 0 });
    resetWriteUncertaintyForTests({ preserveStorage: true }); activate();
    await expect(write({ ...payload, client_request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(write({ ...payload, instructions: 'Changed clinical text' })).rejects.toMatchObject({ status: 409 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    globalThis.fetch.mockResolvedValueOnce(json({ data: { client_request_id: key } }));
    await expect(write(payload)).resolves.toMatchObject({ data: { client_request_id: key } });
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
    const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    for (const secret of [payload.instructions, payload.reason, prescription]) expect(stored).not.toContain(secret);
  });

  it.each([
    ['prescription_create_failed', () => createPrescription({ patient_id: admission, medication_name: 'SYNTHETIC-PRIVATE-MEDICATION', dose: '1 tablet', frequency: 'daily' })],
    ['nhis_batch_create_failed', () => billingApi.createNhisClaimBatch({ claim_ids: [admission] })],
    ['nhis_batch_export_failed', () => billingApi.exportNhisClaimBatch(admission)],
    ['nhis_mapping_create_failed', () => billingApi.createPayerServiceCode({ service_id: admission, nhis_code: 'SYNTHETIC-PRIVATE-CODE', effective_from: '2026-10-16' })],
  ])('keeps an ambiguous typed409 %s across a guard remount before any second write', async (code, write) => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code, message: 'Synthetic service could not confirm the write' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    await expect(write()).rejects.toThrow();
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    resetWriteUncertaintyForTests({ preserveStorage: true }); activate();
    await expect(standingApi.create({ name: 'Blocked duplicate' })).rejects.toMatchObject({ status: 409, data: { error: { code: 'write_review_required' } } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retains malformed catalog confirmation without storing the correction fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(json({ data: {} }));
    await expect(applyCatalogCorrection(admission, { code: 'SYNTHETIC-PRIVATE-CODE', name: 'SYNTHETIC-PRIVATE-NAME', unit: 'tablet', effective_from: catalogToday(), reason: 'SYNTHETIC-PRIVATE-REASON' })).rejects.toMatchObject({ code: 'catalog_correction_unconfirmed' });
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    for (const secret of ['SYNTHETIC-PRIVATE-CODE', 'SYNTHETIC-PRIVATE-NAME', 'SYNTHETIC-PRIVATE-REASON', admission]) expect(stored).not.toContain(secret);
    resetWriteUncertaintyForTests({ preserveStorage: true }); activate();
    await expect(standingApi.create({ name: 'Blocked duplicate' })).rejects.toMatchObject({ status: 409 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retains a malformed PRN receipt, blocks a new UUID, and accepts only the exact original retry', async () => {
    const payload = { prescription_id: prescription, admission_case_id: admission, client_request_id: key, indication: 'SYNTHETIC-PRIVATE-INDICATION' };
    globalThis.fetch.mockResolvedValueOnce(json({ data: {} }));
    await expect(requestPrnDose(payload)).rejects.toMatchObject({ name: 'PrnRequestUnconfirmedError' });
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    for (const privateValue of [payload.indication, prescription, admission, 'synthetic-private-token', '/api/v2/nursing/prn-dose-requests']) expect(stored).not.toContain(privateValue);
    await expect(requestPrnDose({ ...payload, client_request_id: '70000000-0000-4000-8000-000000000006' })).rejects.toMatchObject({ status: 409, data: { error: { code: 'write_review_required' } } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    globalThis.fetch.mockResolvedValueOnce(json({ data: { medication_administration_id: '70000000-0000-4000-8000-000000000007', pharmacy_fulfillment_id: '70000000-0000-4000-8000-000000000008', prescription_id: prescription, admission_case_id: admission, client_request_id: key } }));
    await expect(requestPrnDose(payload)).resolves.toMatchObject({ client_request_id: key });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  });

  it('keeps a non-idempotent standing create blocked after reload until fresh related review and explicit acknowledgment', async () => {
    const item = '70000000-0000-4000-8000-000000000009';
    const payload = { name: 'SYNTHETIC-PRIVATE-TEMPLATE', requesting_location_id: admission, fulfilling_location_id: prescription, frequency: 'weekly', next_run_on: '2026-10-16', monthly_day: null, notes: 'SYNTHETIC-PRIVATE-NOTE', items: [{ item_id: item, expected_unit: 'tablet', quantity: 1 }] };
    globalThis.fetch.mockResolvedValueOnce(json({ data: {} }));
    await expect(standingApi.create(payload)).rejects.toMatchObject({ code: 'standing_write_unconfirmed' });
    resetWriteUncertaintyForTests({ preserveStorage: true }); activate();
    await expect(standingApi.create(payload)).rejects.toMatchObject({ status: 409, data: { error: { code: 'write_review_required' } } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    let entry = getWriteUncertaintySnapshot().entries[0];
    await expect(acknowledgeWriteReview(entry.id, principal)).rejects.toMatchObject({ status: 409 });
    globalThis.fetch.mockResolvedValueOnce(json({ data: [{ id: '70000000-0000-4000-8000-000000000010', items: [{ item_id: item }] }], page: { has_next: false, next_cursor: null } }));
    await standingApi.list({ limit: 25 });
    entry = getWriteUncertaintySnapshot().entries[0]; expect(entry.reviewed).toBe(true);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    await acknowledgeWriteReview(entry.id, principal);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  });
});
