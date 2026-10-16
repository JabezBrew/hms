import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary';
import ProblemListSidebar from '@/features/problems/components/ProblemListSidebar';

const actorA = { id: 'a1000000-0000-4000-8000-000000000001', facilityCode: 'HMS', adminAccess: { capabilities: ['clinical_documentation.view', 'clinical_documentation.manage'] }, accessContext: { facility_id: 'a1000000-0000-4000-8000-000000000002', active_profile: 'hospital', session_version: 1, permission_version: 1, features: ['encounters'], patient_visibility: ['demographics', 'full_clinical'] } };
const actorB = { ...actorA, id: 'a1000000-0000-4000-8000-000000000003' };
const patient = 'a1000000-0000-4000-8000-000000000004';
const problem = { id: 'a1000000-0000-4000-8000-000000000005', patient_id: patient, label: 'SYNTHETIC-PRIVATE-A-CONDITION', status: 'active', onset_date: null, created_at: '2026-10-16T00:00:00Z' };
const response = (data) => new Response(JSON.stringify({ data, page: { has_next: false, next_cursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
const originalFetch = globalThis.fetch; const originalConfig = window.__HMS_RUNTIME_CONFIG__;
let client; let token; let finishWrite; let calls;
beforeEach(() => {
  window.matchMedia.mockImplementation((query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); sessionStorage.clear(); token = 'SYNTHETIC-TOKEN-A'; calls = []; finishWrite = null;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  globalThis.fetch = vi.fn(async (url, request = {}) => {
    const path = new URL(url).pathname; calls.push([path, request.method]);
    if (path.endsWith('/auth/network-access')) return response({ classification: 'onsite', provenance: 'direct', policy_version: 1, mode: 'readonly', access_allowed: true, read_only: false, reauth_required: false, reauth_expires_at: null, evaluated_at: new Date().toISOString(), reason: 'onsite' });
    if (request.method === 'POST' && path.endsWith('/status')) return new Promise((resolve, reject) => { finishWrite = (error = false) => error === 'network' ? reject(new TypeError('SYNTHETIC-PRIVATE-A-NETWORK')) : resolve(error ? new Response(JSON.stringify({ error: { code: 'synthetic_failure', message: 'SYNTHETIC-PRIVATE-A-ERROR' } }), { status: 409, headers: { 'content-type': 'application/json' } }) : response({ ...problem, status: 'resolved' })); });
    if (path.endsWith('/clinical/problems')) return response([problem]);
    throw new Error('Unexpected synthetic route');
  });
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); toast.dismiss(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalConfig; });
function Harness({ actor, withProblem = false }) {
  return <AuthContext.Provider value={{ user: actor, login: vi.fn(), logout: vi.fn() }}><QueryClientProvider client={client}><MemoryRouter><HelmetProvider><ThemeProvider><BreadcrumbProvider><NetworkAccessBoundary><p>Workspace {actor.id === actorA.id ? 'actor A' : 'actor B'}</p><Toaster />{withProblem && actor.id === actorA.id && <ProblemListSidebar patientId={patient} />}</NetworkAccessBoundary></BreadcrumbProvider></ThemeProvider></HelmetProvider></MemoryRouter></QueryClientProvider></AuthContext.Provider>;
}
async function switchActor(view, withProblem = false) { token = 'SYNTHETIC-TOKEN-B'; view.rerender(<Harness actor={actorB} withProblem={withProblem} />); await screen.findByText('Workspace actor B'); await waitFor(() => expect(client.isFetching()).toBe(0)); }

it('does not replay an already displayed store-only toast after an actual auth/network boundary remount', async () => {
  const view = render(<Harness actor={actorA} />); await screen.findByText('Workspace actor A'); act(() => { toast.error('SYNTHETIC-PRIVATE-A-OLD-TOAST', { duration: 60000 }); }); await screen.findByText('SYNTHETIC-PRIVATE-A-OLD-TOAST'); await switchActor(view); expect(screen.queryByText('SYNTHETIC-PRIVATE-A-OLD-TOAST')).not.toBeInTheDocument(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); }); expect(screen.queryByText('SYNTHETIC-PRIVATE-A-OLD-TOAST')).not.toBeInTheDocument();
});
it.each([false, true])('suppresses a late real problem-resolution %s response after the auth/network scope changes', async (error) => {
  const view = render(<Harness actor={actorA} withProblem />); await screen.findByText(problem.label); fireEvent.click(screen.getByTitle('Mark resolved')); await waitFor(() => expect(finishWrite).toBeTypeOf('function')); await switchActor(view, true); expect(screen.queryByText(problem.label)).not.toBeInTheDocument(); expect(screen.queryByText(`${problem.label} marked resolved.`)).not.toBeInTheDocument(); await act(async () => finishWrite(error)); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); expect(screen.queryByText(`${problem.label} marked resolved.`)).not.toBeInTheDocument(); expect(screen.queryByText('SYNTHETIC-PRIVATE-A-ERROR')).not.toBeInTheDocument(); expect(screen.getByText('Workspace actor B')).toBeInTheDocument();
});

it.each([false, true])('preserves a same-scope real problem-resolution %s notification', async (error) => { render(<Harness actor={actorA} withProblem />); await screen.findByText(problem.label); fireEvent.click(screen.getByTitle('Mark resolved')); await waitFor(() => expect(finishWrite).toBeTypeOf('function')); await act(async () => finishWrite(error)); await screen.findByText(error ? 'SYNTHETIC-PRIVATE-A-ERROR' : `${problem.label} marked resolved.`); });

it('suppresses a late network error after account change while retaining the original opaque uncertain write', async () => { const view = render(<Harness actor={actorA} withProblem />); await screen.findByText(problem.label); fireEvent.click(screen.getByTitle('Mark resolved')); await waitFor(() => expect(finishWrite).toBeTypeOf('function')); await switchActor(view, true); await act(async () => finishWrite('network')); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); expect(screen.queryByText('SYNTHETIC-PRIVATE-A-NETWORK')).not.toBeInTheDocument(); const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); expect(JSON.parse(stored).entries.some((entry) => entry.state === 'uncertain')).toBe(true); for (const secret of [problem.label, patient, problem.id, 'SYNTHETIC-PRIVATE-A-NETWORK', 'SYNTHETIC-TOKEN-A']) expect(stored).not.toContain(secret); });
