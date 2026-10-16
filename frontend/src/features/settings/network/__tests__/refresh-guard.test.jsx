import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, v2Request, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NetworkAccessBoundary } from '../NetworkAccessBoundary';
import { networkDecision, networkUser } from './fixtures';
import { webcrypto } from 'node:crypto';

const originalFetch = globalThis.fetch; const runtime = window.__HMS_RUNTIME_CONFIG__; let client; let token;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const wireUser = { id: networkUser.id, facility_code: networkUser.facilityCode, ...networkUser.accessContext };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); token = 'synthetic-old-token'; window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => token, setAccessToken: (value) => { token = value; }, getFacilityCode: () => 'HMS', canRefreshSession: () => true }); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); client.clear(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; __resetV2ApiClientForTests(); });
function mount() { return render(<AuthContext.Provider value={{ user: networkUser, login: vi.fn(), logout: vi.fn() }}><QueryClientProvider client={client}><MemoryRouter><HelmetProvider><BreadcrumbProvider><NetworkAccessBoundary><p>Synthetic clinical workspace</p></NetworkAccessBoundary></BreadcrumbProvider></HelmetProvider></MemoryRouter></QueryClientProvider></AuthContext.Provider>); }
it('waits for authoritative rotated-scope status before replaying a definitively unauthorized request, preserving body and signal', async () => {
  let finishStatus; let workflowCalls = 0; const bodies = []; const signals = [];
  globalThis.fetch = vi.fn(async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/auth/network-access')) return token === 'synthetic-old-token' ? json({ data: networkDecision }) : new Promise((resolve) => { finishStatus = () => resolve(json({ data: networkDecision })); });
    if (path.endsWith('/auth/refresh')) return json({ data: { access_token: 'synthetic-new-token', user: wireUser } });
    workflowCalls += 1; bodies.push(options.body); signals.push(options.signal); return workflowCalls === 1 ? json({ error: { code: 'unauthorized', message: 'Expired token' } }, 401) : json({ data: { saved: true } });
  });
  mount(); await screen.findByText('Synthetic clinical workspace'); const signal = new AbortController().signal; let completed = false; let pending;
  await act(async () => { pending = v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: { synthetic: 'unchanged' }, signal }).then((value) => { completed = true; return value; }); }); await waitFor(() => expect(finishStatus).toBeTypeOf('function')); expect(workflowCalls).toBe(1); expect(completed).toBe(false); expect(screen.queryByText('Synthetic clinical workspace')).not.toBeInTheDocument(); await act(async () => finishStatus()); await waitFor(() => expect(completed).toBe(true)); await expect(pending).resolves.toEqual({ data: { saved: true } }); expect(workflowCalls).toBe(2); expect(bodies[1]).toBe(bodies[0]); expect(signals).toEqual([signal, signal]);
});
it('never treats a token refresh as fresh credential proof for an expired offsite write', async () => {
  let workflowCalls = 0;
  globalThis.fetch = vi.fn(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/auth/network-access')) return json({ data: token === 'synthetic-old-token' ? networkDecision : { ...networkDecision, classification: 'offsite', mode: 'fresh_reauth', reason: 'reauth_required', read_only: true, reauth_required: true, reauth_expires_at: '2026-01-01T00:00:00Z' } });
    if (path.endsWith('/auth/refresh')) return json({ data: { access_token: 'synthetic-new-token', user: wireUser } }); workflowCalls += 1; return json({ error: { code: 'unauthorized', message: 'Expired token' } }, 401);
  });
  mount(); await screen.findByText('Synthetic clinical workspace'); let pending; let result; await act(async () => { pending = v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: { synthetic: true } }).catch((error) => { result = error; return error; }); }); await waitFor(() => expect(result).toMatchObject({ status: 403 })); await expect(pending).resolves.toMatchObject({ status: 403 }); expect(workflowCalls).toBe(1);
});
