import { webcrypto } from 'node:crypto';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '@/lib/react-query';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { useCreateConsentGrant } from '../useConsentQueries';
import { useBulkVerifyLabResults, useVerifyLabResult } from '../useLabQueries';

const principal = { id: '73000000-0000-4000-8000-000000000001', facility_id: '73000000-0000-4000-8000-000000000002', active_profile: 'hospital' };
const patient = '73000000-0000-4000-8000-000000000003';
const resultId = '73000000-0000-4000-8000-000000000004';
const cases = [
  ['consent creation', useCreateConsentGrant, { patient_id: patient, scope: 'internal_care_team', purpose: 'Synthetic consent' }, 'consent_create', '/consents'],
  ['single laboratory verification', useVerifyLabResult, { id: resultId }, 'lab_result_verify', `/laboratory/results/${resultId}/verify`],
  ['bulk laboratory verification', useBulkVerifyLabResults, { result_ids: [resultId] }, 'lab_results_bulk_verify', '/laboratory/results/bulk-verify'],
];
const oldRuntime = window.__HMS_RUNTIME_CONFIG__;
const oldDefaults = queryClient.getDefaultOptions();
const reply = (status, code) => new Response(JSON.stringify({ error: { code, message: 'Synthetic write response', details: {} }, request_id: 'synthetic-request' }), { status, headers: { 'content-type': 'application/json' } });
const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn());
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests();
  sessionStorage.clear();
  queryClient.clear();
  // Use the real application's retry policy; only shorten its backoff for this test.
  queryClient.setDefaultOptions({ ...oldDefaults, mutations: { ...oldDefaults.mutations, retryDelay: 0 } });
  configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'QA', canRefreshSession: () => false });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-authority', principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  activateWriteUncertainty(principal);
});
afterEach(() => {
  cleanup(); queryClient.clear(); queryClient.setDefaultOptions(oldDefaults);
  __resetV2ApiClientForTests(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = oldRuntime;
});

describe.each(cases)('%s uses the production mutation policy', (_name, hook, payload, prefix, path) => {
  it('does not automatically repeat a dispatched write after a definite error', async () => {
    fetch.mockImplementation(() => Promise.resolve(reply(409, `${prefix}_failed`)));
    const { result } = renderHook(hook, { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(payload)).rejects.toBeDefined(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8080/api/v2${path}`);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(getWriteUncertaintySnapshot().entries).toEqual([]);
    // A definite rejection allows a deliberate new attempt, but no automatic POST.
    await act(async () => { await expect(result.current.mutateAsync(payload)).rejects.toBeDefined(); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains the opaque review barrier on an unconfirmed write and blocks another dispatch', async () => {
    fetch.mockImplementation(() => Promise.resolve(reply(409, `${prefix}_write_unconfirmed`)));
    const { result } = renderHook(hook, { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(payload)).rejects.toBeDefined(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    for (const privateValue of [patient, resultId, principal.id, principal.facility_id, 'Synthetic consent', 'synthetic-token']) expect(stored).not.toContain(privateValue);
    await act(async () => { await expect(result.current.mutateAsync(payload)).rejects.toBeDefined(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  });
});

it('preserves the production retry for reads', async () => {
  const read = vi.fn().mockRejectedValueOnce(new TypeError('Synthetic transient read')).mockResolvedValueOnce('saved value');
  await expect(queryClient.fetchQuery({ queryKey: ['synthetic-retry-control'], queryFn: read, retryDelay: 0 })).resolves.toBe('saved value');
  expect(read).toHaveBeenCalledTimes(2);
});
