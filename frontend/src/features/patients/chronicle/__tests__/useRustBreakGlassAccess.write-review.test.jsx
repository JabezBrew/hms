import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteReview, activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { useRustBreakGlassAccess } from '../useRustBreakGlassAccess';

const patientId = 'f1400000-0000-4000-8000-000000000001';
const actorId = 'f1400000-0000-4000-8000-000000000002';
const facilityId = 'f1400000-0000-4000-8000-000000000003';
const user = {
  id: actorId, email: 'synthetic@example.com', facilityCode: 'HMS',
  adminAccess: { capabilities: ['patient.break_glass.invoke'] },
  accessContext: { facility_id: facilityId, active_profile: 'hospital' },
};
const payload = { password: 'Synthetic private password', category: 'urgent_clinical_continuity', reason: 'Synthetic private handover' };
const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const originalFetch = globalThis.fetch;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let clients;
let responseCode;
let posted;
let grant;

function bind() {
  const context = { transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-break-glass-authority', principal: { id: actorId, facility_id: facilityId, active_profile: 'hospital' } };
  bindNetworkAccessGuard(context).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  activateWriteUncertainty(context.principal, { authority: context.authorityScope, transport: context.transportScope });
}

function setup(overrides = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 2, retryDelay: 0 } } });
  clients.push(client);
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useRustBreakGlassAccess({ enabled: true, patientId, user, reauthenticate: vi.fn().mockResolvedValue(user), refetchContext: vi.fn().mockResolvedValue({ data: {} }), ...overrides }), { wrapper });
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  __resetV2ApiClientForTests();
  clients = []; responseCode = 'break_glass_grant_unconfirmed'; posted = []; grant = null;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => 'synthetic-private-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  bind();
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const route = new URL(url).pathname;
    if (options.method === 'POST') {
      posted.push(route.endsWith('/end') ? 'end' : 'start');
      if (route.endsWith('/end')) grant = null;
      if (route.endsWith('/end') && responseCode === null) return json({ data: { ended_count: 1 } });
      return json({ error: { code: responseCode, message: 'Synthetic outcome could not be confirmed' } }, 409);
    }
    if (route.endsWith('/break-glass')) return json({ data: { grant } });
    throw new Error('Unexpected synthetic route');
  });
});

afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  __resetV2ApiClientForTests();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
});

describe('emergency-access write review through the real generated transport', () => {
  it('requires fresh saved-status review and explicit acknowledgement before ending a possible grant', async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.statusLoading).toBe(false));
    await act(async () => { await view.result.current.submit(payload); });
    expect(view.result.current.error).toMatch(/review the recovery notice/);
    await act(async () => { await view.result.current.end(); });
    expect(posted).toEqual(['start']);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);

    grant = { id: 'f1400000-0000-4000-8000-000000000005', expires_at: new Date(Date.now() + 300000).toISOString() };
    await act(async () => { await view.result.current.refreshAccess(); });
    await waitFor(() => expect(view.result.current.grant?.id).toBe(grant.id));
    await waitFor(() => expect(getWriteUncertaintySnapshot().entries[0]?.reviewed).toBe(true));
    // Saved-status refresh never silently confirms the original command.
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    await act(async () => { await acknowledgeWriteReview(getWriteUncertaintySnapshot().entries[0].id, { id: actorId, facility_id: facilityId, active_profile: 'hospital' }); });
    responseCode = null;
    await act(async () => { await view.result.current.end(); });
    expect(posted).toEqual(['start', 'end']);
    expect(view.result.current.grant).toBeNull();
    expect(view.result.current.unconfirmed).toBe(false);
    expect(getWriteUncertaintySnapshot().entries).toEqual([]);
  });

  it('preserves an unknown grant marker across remount and blocks a second non-keyed POST', async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current.statusLoading).toBe(false));
    await act(async () => { expect(await view.result.current.submit(payload)).toBe(false); });
    expect(view.result.current.unconfirmed).toBe(true);
    expect(view.result.current.error).toMatch(/grant may already exist/);
    expect(posted).toEqual(['start']);
    const saved = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    expect(JSON.parse(saved).entries).toEqual([expect.objectContaining({ state: 'uncertain', uuid: null })]);
    for (const privateValue of [patientId, actorId, facilityId, payload.password, payload.reason, 'synthetic-private-token']) expect(saved).not.toContain(privateValue);
    view.unmount();
    resetWriteUncertaintyForTests({ preserveStorage: true });
    bind();
    const reloaded = setup();
    await waitFor(() => expect(reloaded.result.current.statusLoading).toBe(false));
    await act(async () => { expect(await reloaded.result.current.submit(payload)).toBe(false); });
    expect(posted).toEqual(['start']);
    expect(JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).entries).toHaveLength(1);
  });

  it('does not preserve a fresh marker for a definite typed grant-exists denial', async () => {
    responseCode = 'break_glass_grant_exists';
    const { result } = setup();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    await act(async () => { expect(await result.current.submit(payload)).toBe(false); });
    expect(result.current.unconfirmed).toBe(false);
    expect(posted).toEqual(['start']);
    expect(JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).entries).toHaveLength(0);
  });

  it('preserves an unknown end marker and refreshes actual status without claiming the end response was confirmed', async () => {
    responseCode = 'break_glass_end_unconfirmed';
    grant = { id: 'f1400000-0000-4000-8000-000000000004', expires_at: new Date(Date.now() + 300000).toISOString() };
    const refetchContext = vi.fn().mockResolvedValue({ isError: true, error: { status: 403 } });
    const { result } = setup({ refetchContext });
    await waitFor(() => expect(result.current.grant?.id).toBe(grant.id));
    await act(async () => { await result.current.end(); });
    expect(result.current.unconfirmed).toBe(true);
    expect(result.current.error).toMatch(/grant may already have ended/);
    expect(result.current.blocked).toBe(true);
    expect(result.current.grant).toBeNull();
    expect(refetchContext).toHaveBeenCalled();
    expect(posted).toEqual(['end']);
    expect(JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).entries).toEqual([expect.objectContaining({ state: 'uncertain', uuid: null })]);
  });
});
