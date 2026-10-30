import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, v2Request, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NetworkAccessBoundary } from '../NetworkAccessBoundary';
import { networkDecision } from './fixtures';
import { fixtureClock, jwtFor, token as authToken } from '@/features/auth/__tests__/fixtures';
import { webcrypto } from 'node:crypto';

const originalFetch = globalThis.fetch; const runtime = window.__HMS_RUNTIME_CONFIG__; let client; let token; let oldToken; let refreshReply; let boundaryUser; let passwordAuthTime;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function prepareSession(authTime = Math.floor(Date.now() / 1000) - 5) {
  const initial = authToken(); const issued = Math.floor(Date.now() / 1000); passwordAuthTime = authTime;
  initial.user.auth_security.assurance_version = 0;
  initial.access_token = jwtFor(initial, { session_id: '99999999-0000-4000-8000-000000000020', auth_time: authTime, iat: issued, exp: issued + 600 });
  initial.user.auth_security.auth_clock = fixtureClock(Date.now(), initial.access_token);
  oldToken = initial.access_token; token = oldToken;
  refreshReply = structuredClone(initial); delete refreshReply.status;
  // Routine refresh rotates the actual session identifier, retaining the
  // original password proof and ordinary no-factor policy/authority.
  refreshReply.access_token = jwtFor(refreshReply, { session_id: '99999999-0000-4000-8000-000000000021', auth_time: authTime, iat: issued, exp: issued + 600 });
  refreshReply.user.auth_security.auth_clock = fixtureClock(Date.now(), refreshReply.access_token);
  boundaryUser = { id: initial.user.id, email: initial.user.email, facilityCode: initial.user.facility_code, accessContext: initial.user, adminAccess: { capabilities: [] } };
}
function decisionFor(bearer, changes = {}) { const now = Date.now(); return { ...networkDecision, reauth_expires_at: null, evaluated_at: new Date(now).toISOString(), auth_clock: fixtureClock(now, bearer), ...changes }; }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); prepareSession(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => token, setAccessToken: (value) => { token = value; }, getFacilityCode: () => 'HMS', canRefreshSession: () => true }); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); client.clear(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; __resetV2ApiClientForTests(); });
function mount() { return render(<AuthContext.Provider value={{ user: boundaryUser, login: vi.fn(), logout: vi.fn() }}><QueryClientProvider client={client}><MemoryRouter><HelmetProvider><BreadcrumbProvider><NetworkAccessBoundary><p>Synthetic clinical workspace</p></NetworkAccessBoundary></BreadcrumbProvider></HelmetProvider></MemoryRouter></QueryClientProvider></AuthContext.Provider>); }
it('waits for authoritative rotated-scope status before replaying a definitively unauthorized request, preserving body and signal', async () => {
  let finishStatus; let workflowCalls = 0; const bodies = []; const signals = [];
  globalThis.fetch = vi.fn(async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/auth/network-access')) return token === oldToken ? json({ data: decisionFor(token) }) : new Promise((resolve) => { const bearer = token; finishStatus = () => resolve(json({ data: decisionFor(bearer) })); });
    if (path.endsWith('/auth/refresh')) return json({ data: refreshReply });
    workflowCalls += 1; bodies.push(options.body); signals.push(options.signal); return workflowCalls === 1 ? json({ error: { code: 'unauthorized', message: 'Expired token' } }, 401) : json({ data: { saved: true } });
  });
  mount(); await screen.findByText('Synthetic clinical workspace'); const signal = new AbortController().signal; let completed = false; let pending;
  await act(async () => { pending = v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: { synthetic: 'unchanged' }, signal }).then((value) => { completed = true; return value; }); }); await waitFor(() => expect(finishStatus).toBeTypeOf('function')); expect(workflowCalls).toBe(1); expect(completed).toBe(false); expect(screen.queryByText('Synthetic clinical workspace')).not.toBeVisible(); await act(async () => finishStatus()); await waitFor(() => expect(completed).toBe(true)); await expect(pending).resolves.toEqual({ data: { saved: true } }); expect(workflowCalls).toBe(2); expect(bodies[1]).toBe(bodies[0]); expect(signals).toEqual([signal, signal]);
});
it('never treats a token refresh as fresh credential proof for an expired offsite write', async () => {
  prepareSession(Math.floor(Date.now() / 1000) - 901);
  let workflowCalls = 0;
  globalThis.fetch = vi.fn(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/auth/network-access')) return json({ data: decisionFor(token, token === oldToken ? { mode: 'fresh_reauth' } : { classification: 'offsite', mode: 'fresh_reauth', reason: 'reauth_required', read_only: true, reauth_required: true, reauth_expires_at: new Date((passwordAuthTime + 900) * 1000).toISOString() }) });
    if (path.endsWith('/auth/refresh')) return json({ data: refreshReply }); workflowCalls += 1; return json({ error: { code: 'unauthorized', message: 'Expired token' } }, 401);
  });
  mount(); await screen.findByText('Synthetic clinical workspace'); let pending; let result; await act(async () => { pending = v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: { synthetic: true } }).catch((error) => { result = error; return error; }); }); await waitFor(() => expect(result).toMatchObject({ status: 403 })); await expect(pending).resolves.toMatchObject({ status: 403 }); expect(workflowCalls).toBe(1);
});
