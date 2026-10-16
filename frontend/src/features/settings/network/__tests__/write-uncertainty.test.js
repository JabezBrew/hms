import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteReview, activateWriteUncertainty, getWriteUncertaintySnapshot, markWriteResponseUncertain, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { networkDecision } from './fixtures';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WriteRecoveryNotice } from '../WriteRecoveryNotice';

const runtime = window.__HMS_RUNTIME_CONFIG__; const fetchOriginal = globalThis.fetch;
const patient = '00000000-0000-4000-8000-000000000001'; const admission = '00000000-0000-4000-8000-000000000002'; const key = '00000000-0000-4000-8000-000000000003';
const principal = { id: 'synthetic-actor', facility_id: 'synthetic-facility', active_profile: 'hospital' };
const path = '/api/v2/nursing/fluid-observations'; const body = { client_request_id: key, patient_id: patient, admission_case_id: admission, notes: 'Synthetic private note', intake_ml: 10 };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let token; let actor;
function bind() { const context = { transportScope: getV2ClientScopeKey(), authorityScope: `${actor.id}:authority`, principal: actor }; const lease = bindNetworkAccessGuard(context); lease.update({ confirmed: true, decision: networkDecision }); activateWriteUncertainty(actor, { authority: context.authorityScope, transport: context.transportScope }); return lease; }
const post = (payload = body, target = path) => v2Request({ method: 'POST', path: target, body: payload });
const read = (scope = admission) => v2Request({ path, query: { admission_case_id: scope } });
const entries = () => JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).entries;
async function loseWrite(payload = body, target = path) { globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(post(payload, target)).rejects.toMatchObject({ status: 0 }); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1)); }
beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('crypto', webcrypto); token = 'synthetic-token'; actor = principal; window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(async () => json({ data: { saved: true } })); bind(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = fetchOriginal; window.__HMS_RUNTIME_CONFIG__ = runtime; });

describe('opaque recovery evidence at the real fetch boundary', () => {
  it('survives a controller reload and credential rotation without storing clinical data or identifiers', async () => {
    await loseWrite(); const saved = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    for (const secret of [patient, admission, body.notes, token, actor.id, actor.facility_id, 'patient_id', 'notes', '?']) expect(saved).not.toContain(secret);
    expect(saved).toContain(key); resetWriteUncertaintyForTests({ preserveStorage: true }); token = 'synthetic-reauthenticated'; bind();
    await expect(post({ ...body, client_request_id: crypto.randomUUID() })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await post({ method: 'not a clinical mutation' }, '/api/v2/auth/login'); await v2Request({ method: 'POST', path: '/api/v2/patients/search', body: {} }); expect(globalThis.fetch).toHaveBeenCalledTimes(3); expect(entries()).toHaveLength(1);
  });
  it('allows only a supported UUID and the unchanged canonical command, including resource identity', async () => {
    await loseWrite(); for (const changed of [{ ...body, intake_ml: 20 }, { ...body, client_request_id: crypto.randomUUID() }, { ...body, admission_case_id: crypto.randomUUID() }]) await expect(post(changed)).rejects.toMatchObject({ status: 409 });
    await expect(post(body, `${path}/${patient}/corrections`)).rejects.toMatchObject({ status: 409 });
    await post(Object.fromEntries(Object.entries(body).reverse())); expect(globalThis.fetch).toHaveBeenCalledTimes(2); expect(entries()).toHaveLength(0);
  });
  it('never treats an arbitrary UUID as server idempotency support or repeats a legacy non-keyed create', async () => {
    await loseWrite(body, '/api/v2/clinical/prescriptions'); await expect(post(body, '/api/v2/clinical/prescriptions')).rejects.toMatchObject({ status: 409 }); expect(globalThis.fetch).toHaveBeenCalledTimes(1); expect(entries()[0].uuid).toBeNull();
  });
  it('never fingerprints credential-bearing bodies and keeps credential lifecycle available', async () => {
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle); const inputs = []; vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, bytes) => { inputs.push(new TextDecoder().decode(bytes)); return originalDigest(algorithm, bytes); });
    await loseWrite({ ...body, current_password: 'SyntheticCredentialNeverHash' }, '/api/v2/admin/staff'); expect(inputs.some((input) => input.includes('SyntheticCredentialNeverHash'))).toBe(false); expect(entries()[0].uuid).toBeNull();
    await post({ current_password: 'SyntheticCredentialNeverHash' }, '/api/v2/auth/password'); expect(entries()).toHaveLength(1);
  });
  it('keeps invalid JSON and typed malformed successes uncertain using nonenumerable original evidence', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response('{broken', { headers: { 'content-type': 'application/json' } })); await expect(post()).rejects.toBeInstanceOf(Error); expect(entries()).toHaveLength(1);
    const response = await post(); expect(entries()).toHaveLength(0); expect(JSON.stringify(response)).toBe('{"data":{"saved":true}}'); markWriteResponseUncertain(response.data); expect(entries()).toHaveLength(1); await expect(post({ ...body, intake_ml: 11 })).rejects.toMatchObject({ status: 409 });
  });
  it.each([null, [], 'unexpected', { success: true }])('keeps a malformed generic success %j uncertain even without an attachable domain envelope', async (value) => {
    globalThis.fetch.mockResolvedValueOnce(json(value)); await expect(post()).rejects.toMatchObject({ data: { error: { code: 'write_response_unconfirmed' } } }); expect(entries()).toHaveLength(1);
  });
  it('does not turn failed background telemetry into a clinical recovery barrier', async () => {
    globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic telemetry lost')); await expect(post({ events: [] }, '/api/v2/observability/rum')).rejects.toMatchObject({ status: 0 }); expect(entries()).toHaveLength(0); await post(); expect(entries()).toHaveLength(0);
  });
  it('does not clear a prior uncertain write merely because its exact retry is rejected', async () => {
    await loseWrite(); globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'forbidden' } }, 403)); await expect(post()).rejects.toMatchObject({ status: 403 }); expect(entries()).toHaveLength(1);
  });
  it('preserves a generic unconfirmed 409 and clears a fresh definite rejection only', async () => {
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'fluid_write_unconfirmed' } }, 409)); await expect(post()).rejects.toMatchObject({ status: 409 }); expect(entries()).toHaveLength(1);
    await post(); globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'validation_error' } }, 400)); await expect(post()).rejects.toMatchObject({ status: 400 }); expect(entries()).toHaveLength(0);
  });
  it.each(['access_grant_revoke_failed', 'prescription_create_failed', 'nhis_batch_create_failed', 'nhis_batch_export_failed', 'nhis_mapping_create_failed'])('retains existing generic commit-uncertain 409 code %s across reload', async (code) => {
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code } }, 409)); await expect(post().catch((error) => { markWriteResponseUncertain(error); throw error; })).rejects.toMatchObject({ status: 409 }); resetWriteUncertaintyForTests({ preserveStorage: true }); bind(); await expect(post({ ...body, client_request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 }); expect(globalThis.fetch).toHaveBeenCalledTimes(1); expect(entries()).toHaveLength(1);
  });
  it('requires a related read started after uncertainty plus a separate explicit review acknowledgment', async () => {
    let finishOldRead; globalThis.fetch.mockImplementationOnce(() => new Promise((resolve) => { finishOldRead = resolve; })); const oldRead = read(); await loseWrite(); const marker = entries()[0].id;
    finishOldRead(json({ data: [] })); await oldRead; expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
    await v2Request({ path: '/api/v2/auth/network-access' }); await read(crypto.randomUUID()); await v2Request({ path, query: { patient_id: patient, admission_case_id: crypto.randomUUID() } }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false); await expect(acknowledgeWriteReview(marker, actor)).rejects.toMatchObject({ status: 409 });
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'unavailable' } }, 503)); await expect(read()).rejects.toMatchObject({ status: 503 }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
    await read(); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); expect(entries()).toHaveLength(1); await expect(post({ ...body, intake_ml: 12 })).rejects.toMatchObject({ status: 409 });
    await acknowledgeWriteReview(marker, actor); await post({ ...body, intake_ml: 12 }); expect(entries()).toHaveLength(0);
  });
  it('supports actual PRN medication-record recovery instead of a nonexistent dose-request GET', async () => {
    await loseWrite({ ...body, prescription_id: patient }, '/api/v2/nursing/prn-dose-requests'); await v2Request({ path: '/api/v2/nursing/medication-administrations', query: { admission_case_id: admission } }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);
  });
  it('allows explicit facility collection review for a create without a canonical target while keeping known admission targets strict', async () => {
    await loseWrite({ requesting_location_id: patient, fulfilling_location_id: admission, items: [{ item_id: key, quantity: 1 }] }, '/api/v2/inventory/standing-order-templates'); globalThis.fetch.mockResolvedValueOnce(json({ data: [] })); await v2Request({ path: '/api/v2/inventory/standing-order-templates' }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);
    const marker = entries()[0].id; resetWriteUncertaintyForTests({ preserveStorage: true }); bind(); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries[0]?.reviewed).toBe(false)); await expect(acknowledgeWriteReview(marker, actor)).rejects.toMatchObject({ status: 409 });
  });
  it.each([
    ['/api/v2/nhis/batches', { claim_ids: [patient] }, '/api/v2/nhis/claims'],
    ['/api/v2/inventory/catalog-edits', { item_id: patient }, '/api/v2/inventory/items'],
  ])('supports the actual related read for %s instead of requiring a nonexistent write-family GET', async (writePath, payload, readPath) => {
    await loseWrite(payload, writePath); globalThis.fetch.mockResolvedValueOnce(json({ data: [{ id: patient }] })); await v2Request({ path: readPath }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);
  });
  it('does not expose, clear or replay one account’s marker from another account', async () => {
    await loseWrite(); const marker = entries()[0].id; actor = { ...principal, id: 'synthetic-other-actor' }; token = 'synthetic-other-token'; bind(); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(0));
    await expect(acknowledgeWriteReview(marker, actor)).rejects.toMatchObject({ status: 409 }); await post({ ...body, intake_ml: 90 }); expect(entries()).toHaveLength(1); actor = principal; bind(); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1)); await expect(post({ ...body, intake_ml: 90 })).rejects.toMatchObject({ status: 409 });
  });
  it.each(['invalid-json', 'invalid-shape', 'storage-unavailable', 'full'])('fails closed for %s while keeping authorized reads available and preserving stored evidence', async (kind) => {
    await loseWrite(); const raw = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    if (kind === 'invalid-json') sessionStorage.setItem(WRITE_UNCERTAINTY_KEY, '{');
    if (kind === 'invalid-shape') sessionStorage.setItem(WRITE_UNCERTAINTY_KEY, JSON.stringify({ version: 1, salt: crypto.randomUUID(), entries: {} }));
    if (kind === 'full') { const value = JSON.parse(raw); value.entries = Array.from({ length: 24 }, () => ({ ...value.entries[0], id: crypto.randomUUID(), scope: 'a'.repeat(64) })); sessionStorage.setItem(WRITE_UNCERTAINTY_KEY, JSON.stringify(value)); }
    resetWriteUncertaintyForTests({ preserveStorage: true }); if (kind === 'storage-unavailable') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Synthetic storage unavailable'); }); bind();
    await expect(post({ ...body, client_request_id: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 }); await expect(read()).resolves.toMatchObject({ data: { saved: true } }); expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    if (kind === 'full') expect(entries()).toHaveLength(24);
  });
  it('allows ordinary concurrent active writes but rechecks uncertainty after asynchronous fingerprint preparation', async () => {
    let rejectFirst; globalThis.fetch.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; })); const first = post().catch((failure) => failure); await vi.waitFor(() => expect(rejectFirst).toBeTypeOf('function'));
    await post({ ...body, client_request_id: crypto.randomUUID(), intake_ml: 30 }); expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle); let finishDigest;
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, bytes) => new TextDecoder().decode(bytes).includes(':family:') ? new Promise((resolve) => { finishDigest = () => originalDigest(algorithm, bytes).then(resolve); }) : originalDigest(algorithm, bytes));
    const second = post({ ...body, client_request_id: crypto.randomUUID(), intake_ml: 40 }).catch((failure) => failure); await vi.waitFor(() => expect(finishDigest).toBeTypeOf('function')); rejectFirst(new TypeError('Lost first response')); await first; await finishDigest(); await expect(second).resolves.toMatchObject({ status: 409 }); expect(globalThis.fetch).toHaveBeenCalledTimes(2); expect(entries()).toHaveLength(1);
  });
  it('sends the same frozen wire body that was fingerprinted despite caller mutation during asynchronous staging', async () => {
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle); let finishDigest; const originalBody = structuredClone(body); const mutable = structuredClone(body);
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce((algorithm, bytes) => new Promise((resolve) => { finishDigest = () => originalDigest(algorithm, bytes).then(resolve); }));
    globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); const pending = post(mutable).catch((failure) => failure); await vi.waitFor(() => expect(finishDigest).toBeTypeOf('function')); mutable.intake_ml = 999; mutable.patient_id = crypto.randomUUID(); await finishDigest(); await pending;
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual(originalBody); await post(originalBody); expect(entries()).toHaveLength(0); expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body)).toEqual(originalBody);
  });
  it('supports relative same-origin API URLs and an explicit fresh-record review acknowledgment in the actual notice', async () => {
    window.__HMS_RUNTIME_CONFIG__.v2ApiBaseUrl = '/api/v2'; render(createElement(WriteRecoveryNotice)); await act(async () => loseWrite());
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/v2/nursing/fluid-observations'); expect(screen.getByText('Nursing record change needs review')).toBeInTheDocument(); const button = screen.getByRole('button', { name: 'I reviewed the fresh workflow record' }); expect(button).toBeDisabled();
    await act(async () => read(crypto.randomUUID())); expect(button).toBeDisabled(); await act(async () => read()); expect(button).toBeEnabled(); expect(screen.getByText(/A related response was received/)).toBeInTheDocument();
    fireEvent.click(button); await waitFor(() => expect(screen.queryByRole('status', { name: 'Changes requiring review' })).not.toBeInTheDocument()); await act(async () => post({ ...body, intake_ml: 50 })); expect(entries()).toHaveLength(0);
  });
});
