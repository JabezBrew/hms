import { webcrypto } from 'node:crypto';
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/react-query';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary';
import { FactorLogin } from '../FactorLogin';
import { __resetV2ApiClientForTests, getV2ClientScopeKey, performV2TokenRefresh, v2Request } from '@/lib/api/v2/session';
import { getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { clearWorkflowContinuity, getWorkflowContinuity } from '@/shared/lib/workflowContinuity';
import { requestAuthorizationScope } from '@/shared/lib/authorizationScope';
import { dismissFactorRequirement, publishFactorRequirement } from '@/shared/lib/factorRequiredSignal';
import { caseRow, context, patientId, caseId } from '@/features/admissions/advisory/__tests__/fixtures';
import { credential, failure, json, jwtFor, networkDecision, options, pending, token } from './fixtures';

const runtime = window.__HMS_RUNTIME_CONFIG__;
const proof = { can_view_full_clinical: true, can_add_note: true, can_record_vitals: true, can_prescribe: true };
const pointerNames = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'];
const pointerOriginals = new Map(pointerNames.map((key) => [key, Object.getOwnPropertyDescriptor(Element.prototype, key)]));
const privateDraft = 'SYNTHETIC PRIVATE CLINICAL DRAFT';
let auth; let initial; let upgraded; let afterProof; let newReads; let heldReads; let posts; let lost; let pendingWrite; let finishRequest; let finishRefresh;
const defer = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function authenticated() {
  const value = token('passkey', { permissions: ['patient.demographics.view', 'clinical_documentation.view', 'clinical_documentation.manage', 'nursing.task.manage', 'admission.manage'], features: ['patients', 'encounters', 'nursing', 'admissions'], patient_visibility: ['full_clinical'] });
  value.access_token = jwtFor(value, { auth_time: Math.floor(Date.now() / 1000) - 60 });
  return value;
}
function Harness({ workspace }) {
  auth = useAuth();
  const [activeWorkspace, setWorkspace] = useState(workspace);
  return <><button onClick={() => auth.login('synthetic@example.test', 'Synthetic password', 'HMS').catch(() => {})}>Begin test sign-in</button>
    <button onClick={() => auth.reauthenticate(auth.user.email, 'Synthetic password confirmation', 'HMS').catch(() => {})}>Verify current identity</button>
    <button onClick={() => setWorkspace(workspace)}>Reopen test workspace</button>
    {!auth.user ? <FactorLogin /> : <NetworkAccessBoundary><p>Synthetic authorized clinical page</p><ChronicleClinicalPermissionsContext.Provider value={proof}><ChronicleWorkspaceHost activeWorkspace={activeWorkspace} workspaceContext={{ patient: { id: patientId, name: 'Synthetic patient', local_data: { id: patientId, medical_record_number: 'SYNTHETIC MRN' } }, patientId, selectedAdmissionId: caseId, selectedEncounter: null, requestedAdvisoryCaseId: caseId, clinicalPermissions: proof, onClose: () => setWorkspace(null) }} /></ChronicleClinicalPermissionsContext.Provider></NetworkAccessBoundary>}</>;
}
async function mount(workspace = 'note') {
  render(<QueryClientProvider client={queryClient}><MemoryRouter><HelmetProvider><BreadcrumbProvider><AuthProvider><Harness workspace={workspace} /></AuthProvider></BreadcrumbProvider></HelmetProvider></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByText('Begin test sign-in'));
  fireEvent.click(await screen.findByText('Use an existing passkey'));
  await screen.findByText('Synthetic authorized clinical page');
}
async function confirm() {
  fireEvent.click(screen.getByText('Verify current identity'));
  await waitFor(() => expect(auth.user.accessContext.auth_security.session_assurance.verified_at).toBe(upgraded.user.auth_security.session_assurance.verified_at));
}
async function fill(workspace) {
  if (workspace === 'note') { fireEvent.change(await screen.findByLabelText('Note title'), { target: { value: 'Synthetic title' } }); fireEvent.change(screen.getByLabelText('Note'), { target: { value: privateDraft } }); }
  else if (workspace === 'fluids') { fireEvent.change(await screen.findByLabelText('Intake volume (ml)'), { target: { value: '250' } }); await userEvent.click(screen.getByLabelText('Intake category')); await userEvent.click(screen.getByRole('option', { name: 'Oral' })); fireEvent.change(screen.getByLabelText('Observation notes (optional)'), { target: { value: privateDraft } }); }
  else { await userEvent.click(await screen.findByRole('button', { name: 'Add follow-up' })); await userEvent.click(screen.getByRole('combobox', { name: 'Follow-up type' })); await userEvent.click(screen.getByRole('option', { name: 'Transport' })); fireEvent.change(screen.getByLabelText('Follow-up note'), { target: { value: privateDraft } }); }
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); queryClient.clear(); queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } }); __resetV2ApiClientForTests(); clearWorkflowContinuity();
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' };
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('PublicKeyCredential', class {}); vi.stubGlobal('navigator', { ...navigator, credentials: { get: vi.fn().mockResolvedValue(credential()) } });
  for (const key of pointerNames) Object.defineProperty(Element.prototype, key, { configurable: true, value: key === 'hasPointerCapture' ? () => false : () => {} });
  initial = authenticated(); upgraded = structuredClone(initial); upgraded.user.auth_security.assurance_version += 1; upgraded.user.auth_security.session_assurance.verified_at = new Date(Date.now()).toISOString(); upgraded.access_token = jwtFor(upgraded, { auth_time: Math.floor(Date.now() / 1000) });
  afterProof = networkDecision(); newReads = 0; heldReads = []; posts = []; lost = false; pendingWrite = false; finishRequest = null; finishRefresh = null;
  vi.stubGlobal('fetch', vi.fn(async (input, request = {}) => {
    const url = new URL(input); const path = url.pathname;
    if (path.endsWith('/auth/login')) return json(pending());
    if (path.endsWith('/login/passkey/options') || path.endsWith('/assurance/options')) return json(options());
    if (path.endsWith('/login/passkey/verify')) return json(initial);
    if (path.endsWith('/assurance/verify')) return json(upgraded);
    if (path.endsWith('/auth/network-access')) {
      if (request.headers.Authorization === `Bearer ${upgraded.access_token}`) { newReads += 1; if (newReads > 1) { const waiting = defer(); heldReads.push(waiting); return waiting.promise; } return afterProof instanceof Response ? afterProof : json(afterProof); }
      return json(networkDecision());
    }
    if (path.endsWith('/auth/refresh')) { const pendingRefresh = defer(); finishRefresh = pendingRefresh.resolve; return pendingRefresh.promise; }
    if (path.endsWith('/auth/me') || path.endsWith('/auth/logout')) return json({});
    if (path.endsWith('/synthetic-delayed')) { const waiting = defer(); finishRequest = waiting.resolve; return waiting.promise; }
    if (path.endsWith('/admission-advisory-cases')) return new Response(JSON.stringify({ data: [caseRow()], page: { has_next: false, next_cursor: null } }), { status: 200 });
    if (path.endsWith('/advisories')) return json(context());
    if (path.endsWith('/fluid-observations/context')) return json({ patient_id: patientId, admission_case_id: caseId, status: 'admitted', can_record_observation: true });
    if (path.endsWith('/fluid-observations') && request.method === 'POST') {
      const body = JSON.parse(request.body); posts.push(body); if (pendingWrite) return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Synthetic pending response aborted', 'AbortError')), { once: true })); if (lost) throw new TypeError('Synthetic lost response');
      return json({ client_request_id: body.client_request_id, root_entry_id: '99999999-9999-4999-8999-000000000019', entry_id: '99999999-9999-4999-8999-000000000019', revision: 1, action: 'created', replayed: posts.length > 1 });
    }
    if (path.endsWith('/fluid-observations')) return new Response(JSON.stringify({ data: [], page: { has_next: false, next_cursor: null, limit: 25 } }), { status: 200 });
    if (path.endsWith('/fluid-observations/summary')) return json({ entry_count: 0, total_intake_ml: 0, total_output_ml: 0, net_ml: 0, intake_breakdown: [], output_breakdown: [] });
    if (path.endsWith('/fluid-observations/assessment')) return failure('synthetic_assessment_unavailable', 503);
    throw new Error(`Unexpected synthetic route: ${path}`);
  }));
});
afterEach(() => { cleanup(); dismissFactorRequirement(); queryClient.clear(); clearWorkflowContinuity(); __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear(); window.__HMS_RUNTIME_CONFIG__ = runtime; for (const key of pointerNames) { const value = pointerOriginals.get(key); if (value) Object.defineProperty(Element.prototype, key, value); else delete Element.prototype[key]; } vi.unstubAllGlobals(); });

it('loads the real signalled verification dialog and retains a closed note draft through proof', async () => {
  await mount('note'); await fill('note');
  fireEvent.click(screen.getByText('Close', { selector: 'button' }));
  expect(screen.queryByDisplayValue(privateDraft)).not.toBeInTheDocument();
  act(() => publishFactorRequirement(requestAuthorizationScope(auth.user, getV2ClientScopeKey())));
  fireEvent.click(await screen.findByRole('button', { name: 'Verify identity' }));
  fireEvent.change(screen.getByLabelText('Current password (if required)'), { target: { value: 'Synthetic explicit password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use passkey' }));
  await waitFor(() => expect(auth.user.accessContext.auth_security.session_assurance.verified_at).toBe(upgraded.user.auth_security.session_assurance.verified_at));
  fireEvent.click(screen.getByText('Reopen test workspace'));
  expect(await screen.findByDisplayValue(privateDraft)).toBeInTheDocument();
  expect(posts).toHaveLength(0);
  await act(async () => heldReads.splice(0).forEach((waiting) => waiting.resolve(json(networkDecision()))));
});

it('sends no assurance request when confirmation is cancelled during deferred module loading', async () => {
  await mount('note'); await fill('note'); const previous = getV2ClientScopeKey(); const controller = new AbortController(); let promise;
  act(() => { promise = auth.reauthenticate(auth.user.email, 'Synthetic password', 'HMS', { signal: controller.signal }).catch((error) => error); controller.abort(); });
  let failure; await act(async () => { failure = await promise; });
  expect(failure.name).toBe('AbortError');
  expect(fetch.mock.calls.some(([url]) => url.includes('/assurance/'))).toBe(false);
  expect(getV2ClientScopeKey()).toBe(previous);
  expect(screen.getByDisplayValue(privateDraft)).toBeInTheDocument();
});

it.each(['note', 'fluids', 'admissionAdvisory'])('preserves the actual %s Host draft across a same-session proof with a staged fresh network decision', async (workspace) => {
  await mount(workspace); await fill(workspace); const previousTransport = getV2ClientScopeKey(); await confirm();
  expect(getV2ClientScopeKey()).not.toBe(previousTransport); expect(getWorkflowContinuity()).not.toBeNull(); expect(screen.getByDisplayValue(privateDraft)).toBeInTheDocument(); expect(posts).toHaveLength(0);
  await waitFor(() => expect(heldReads.length).toBeGreaterThan(0)); expect(screen.getByText('Synthetic authorized clinical page')).toBeInTheDocument();
  await act(async () => heldReads.splice(0).forEach((waiting) => waiting.resolve(json(networkDecision())))); expect(screen.getByDisplayValue(privateDraft)).toBeInTheDocument();
});
it('retains a real fluid unknown UUID and exact body through proof without automatically replaying it', async () => {
  await mount('fluids'); await fill('fluids'); lost = true; fireEvent.click(screen.getByText('Record fluid observation')); await screen.findByText('Retry exact observation'); const original = structuredClone(posts[0]); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await confirm(); expect(posts).toHaveLength(1); expect(screen.getByText('Retry exact observation')).toBeInTheDocument(); expect(screen.getByDisplayValue(privateDraft)).toBeDisabled();
  await act(async () => heldReads.splice(0).forEach((waiting) => waiting.resolve(json(networkDecision())))); lost = false; fireEvent.click(screen.getByText('Retry exact observation')); await screen.findByText('Fluid observation saved.'); expect(posts).toHaveLength(2); expect(posts[1]).toEqual(original); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('aborts an old pending fluid request on proof upgrade and retains its exact uncertain command', async () => {
  await mount('fluids'); await fill('fluids'); pendingWrite = true; fireEvent.click(screen.getByText('Record fluid observation')); await waitFor(() => expect(posts).toHaveLength(1)); const original = structuredClone(posts[0]); const signal = fetch.mock.calls.find(([url, request]) => url.endsWith('/fluid-observations') && request.method === 'POST')[1].signal;
  await confirm(); await screen.findByText('Retry exact observation'); expect(signal.aborted).toBe(true); expect(posts).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await act(async () => heldReads.splice(0).forEach((waiting) => waiting.resolve(json(networkDecision())))); pendingWrite = false; fireEvent.click(screen.getByText('Retry exact observation')); await screen.findByText('Fluid observation saved.'); expect(posts[1]).toEqual(original);
});
it('removes retained clinical content when the post-install authoritative recheck denies access', async () => {
  await mount(); await fill('note'); await confirm(); expect(screen.getByDisplayValue(privateDraft)).toBeInTheDocument(); await waitFor(() => expect(heldReads.length).toBeGreaterThan(0));
  await act(async () => heldReads.splice(0).forEach((waiting) => waiting.resolve(json({ ...networkDecision(), classification: 'offsite', access_allowed: false, mode: 'deny', reason: 'offsite_denied' }))));
  await waitFor(() => expect(screen.queryByText('Synthetic authorized clinical page')).not.toBeInTheDocument()); expect(screen.queryByDisplayValue(privateDraft)).not.toBeInTheDocument(); expect(getWorkflowContinuity()).toBeNull();
});
it.each(['deny', 'error', 'unknown'])('discards copied note state when the new authoritative connection is %s', async (kind) => {
  await mount(); await fill('note'); afterProof = kind === 'error' ? failure('synthetic_unavailable', 503) : { ...networkDecision(), ...(kind === 'deny' ? { classification: 'offsite', access_allowed: false, mode: 'deny', reason: 'offsite_denied' } : { classification: 'unknown', provenance: 'unknown', read_only: true, policy_version: null, mode: null, reason: 'client_unknown' }) };
  await confirm(); expect(getWorkflowContinuity()).toBeNull(); expect(screen.queryByDisplayValue(privateDraft)).not.toBeInTheDocument();
  await waitFor(() => expect(heldReads.length).toBeGreaterThan(0)); await act(async () => heldReads.splice(0).forEach((waiting) => waiting.resolve(kind === 'error' ? failure('synthetic_unavailable', 503) : json(afterProof)))); expect(screen.queryByDisplayValue(privateDraft)).not.toBeInTheDocument();
});
it.each([{ factor_version: 2 }, { passkey_enrolled: false }, { passkey_required: true }])('does not retain a clinical draft after actual security policy changes %j', async (change) => {
  await mount(); await fill('note'); Object.assign(upgraded.user.auth_security, change); await confirm(); expect(getWorkflowContinuity()).toBeNull(); expect(screen.queryByDisplayValue(privateDraft)).not.toBeInTheDocument();
});
it('does not replay a delayed old-token 401 after proof changes the strict authority', async () => {
  await mount(); const request = v2Request({ method: 'POST', path: '/api/v2/synthetic-delayed', body: { value: 'Synthetic original command' } }).catch((error) => error); await waitFor(() => expect(finishRequest).toBeTypeOf('function')); await confirm(); await act(async () => finishRequest(failure('authentication_required', 401))); expect(await request).toMatchObject({ status: 403, data: { error: { code: 'request_scope_changed' } } }); expect(fetch.mock.calls.filter(([url]) => url.endsWith('/synthetic-delayed'))).toHaveLength(1); expect(finishRefresh).toBeNull();
});
it('does not install a late old refresh token over the newly verified same-session token', async () => {
  await mount(); const refresh = performV2TokenRefresh(); await waitFor(() => expect(finishRefresh).toBeTypeOf('function')); await confirm(); const strict = getV2ClientScopeKey(); await act(async () => finishRefresh(json({ ...initial, access_token: 'synthetic-late-old-refresh' }))); expect(await refresh).toBeNull(); expect(getV2ClientScopeKey()).toBe(strict);
});
it('clears copied clinical state when actual same-actor permissions change during verification', async () => {
  await mount(); await fill('note'); upgraded.user.permissions = ['patient.demographics.view']; fireEvent.click(screen.getByText('Verify current identity')); await waitFor(() => expect(auth.user).toBeNull()); expect(screen.queryByDisplayValue(privateDraft)).not.toBeInTheDocument(); expect(getWorkflowContinuity()).toBeNull();
});
