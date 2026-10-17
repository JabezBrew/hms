import { webcrypto } from 'node:crypto';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/react-query';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary';
import { FactorLogin } from '@/features/auth/FactorLogin';
import { credential, jwtFor, networkDecision, options, pending, token } from '@/features/auth/__tests__/fixtures';
import { __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { clearWorkflowContinuity } from '@/shared/lib/workflowContinuity';
import { actorId, laterId as facilityId, patientId, referralId, context, revision } from './fixtures';
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

const runtime = window.__HMS_RUNTIME_CONFIG__; const proof = { can_view_full_clinical: true };
let auth, initial, upgraded, posts, lose, hold, oldSignal;
function Harness() {
  auth = useAuth();
  return <><button onClick={() => auth.login('synthetic@example.test', 'Synthetic password', 'HMS').catch(() => {})}>Begin synthetic sign-in</button><button onClick={() => auth.reauthenticate(auth.user.email, 'Synthetic password confirmation', 'HMS').catch(() => {})}>Confirm same-session proof</button>{!auth.user ? <FactorLogin /> : <NetworkAccessBoundary><p>Synthetic authorized response workspace</p><ChronicleClinicalPermissionsContext.Provider value={proof}><ChronicleWorkspaceHost activeWorkspace="referralResponse" workspaceContext={{ patient: { id: patientId, name: 'Synthetic response patient', local_data: { id: patientId, medical_record_number: 'SYNTHETIC-COURSE-MRN' } }, patientId, requestedReferralId: referralId, clinicalPermissions: proof, onClose: () => {} }} /></ChronicleClinicalPermissionsContext.Provider></NetworkAccessBoundary>}</>;
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); queryClient.clear(); queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } }); __resetV2ApiClientForTests(); clearWorkflowContinuity(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' };
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('PublicKeyCredential', class {}); vi.stubGlobal('navigator', { ...navigator, credentials: { get: vi.fn().mockResolvedValue(credential()) } });
  initial = token('passkey', { id: actorId, facility_id: facilityId, permissions: ['patient.demographics.view', 'referral.manage'], features: ['patients', 'referrals'], patient_visibility: ['full_clinical'] }); initial.access_token = jwtFor(initial, { auth_time: Math.floor(Date.now() / 1000) - 60 }); upgraded = structuredClone(initial); upgraded.user.auth_security.assurance_version += 1; upgraded.user.auth_security.session_assurance.verified_at = new Date().toISOString(); upgraded.access_token = jwtFor(upgraded, { auth_time: Math.floor(Date.now() / 1000) }); posts = []; lose = false; hold = false; oldSignal = null;
  vi.stubGlobal('fetch', vi.fn(async (input, request = {}) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/auth/login')) return json({ data: pending() });
    if (path.endsWith('/login/passkey/options') || path.endsWith('/assurance/options')) return json({ data: options() });
    if (path.endsWith('/login/passkey/verify')) return json({ data: initial });
    if (path.endsWith('/assurance/verify')) return json({ data: upgraded });
    if (path.endsWith('/auth/network-access')) return json({ data: networkDecision() });
    if (path.endsWith('/auth/me') || path.endsWith('/auth/logout')) return json({ data: {} });
    if (path.endsWith('/commands') && request.method === 'POST') {
      const payload = JSON.parse(request.body); posts.push(payload); oldSignal = request.signal;
      if (hold) return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Synthetic dispatched abort', 'AbortError')), { once: true }));
      if (lose) throw new TypeError('Synthetic saved response lost');
      const response = { ...revision, specialist_notes: payload.specialist_notes, recommendations: payload.recommendations };
      return json({ data: { client_request_id: payload.client_request_id, operation: 'draft_saved', replayed: false, recorded_at: response.recorded_at, response } });
    }
    return json({ data: context });
  }));
});
afterEach(() => { cleanup(); queryClient.clear(); clearWorkflowContinuity(); __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear(); window.__HMS_RUNTIME_CONFIG__ = runtime; vi.unstubAllGlobals(); });
async function mountAndDraft() {
  render(<QueryClientProvider client={queryClient}><MemoryRouter><HelmetProvider><BreadcrumbProvider><AuthProvider><Harness /></AuthProvider></BreadcrumbProvider></HelmetProvider></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByText('Begin synthetic sign-in')); fireEvent.click(await screen.findByText('Use an existing passkey')); await screen.findByText('Synthetic authorized response workspace'); fireEvent.click(await screen.findByRole('button', { name: 'Draft or complete response' })); fireEvent.change(screen.getByLabelText('Specialist notes'), { target: { value: 'SYNTHETIC PRIVATE RESPONSE DRAFT' } });
}
async function confirmProof() { const old = getV2ClientScopeKey(); fireEvent.click(screen.getByText('Confirm same-session proof')); await waitFor(() => expect(auth.user.accessContext.auth_security.assurance_version).toBe(upgraded.user.auth_security.assurance_version)); expect(getV2ClientScopeKey()).not.toBe(old); }
async function dispatch() { fireEvent.click(screen.getByRole('button', { name: 'Review draft save' })); fireEvent.click(await screen.findByRole('checkbox', { name: /I confirmed this patient/ })); fireEvent.click(screen.getByRole('button', { name: 'Save response draft', exact: true })); await waitFor(() => expect(posts).toHaveLength(1)); }
it('retains a real response draft only through validated same-session staged proof while request transport changes', async () => {
  await mountAndDraft(); await confirmProof(); expect(screen.getByDisplayValue('SYNTHETIC PRIVATE RESPONSE DRAFT')).toBeInTheDocument(); expect(screen.getByText('Synthetic authorized response workspace')).toBeInTheDocument(); expect(posts).toHaveLength(0);
});
it('retains exact unknown UUID/body through proof without automatic retry and confirms explicit exact replay', async () => {
  await mountAndDraft(); lose = true; await dispatch(); await screen.findByRole('button', { name: 'Retry exact reviewed response' }); const original = structuredClone(posts[0]); await confirmProof(); expect(posts).toHaveLength(1); expect(screen.getByRole('button', { name: 'Retry exact reviewed response' })).toBeInTheDocument(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); lose = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry exact reviewed response' })); await screen.findByText('Original saved response · version 1'); expect(posts[1]).toEqual(original); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('aborts an old pending command on proof upgrade while preserving its exact uncertain command for reviewed replay', async () => {
  await mountAndDraft(); hold = true; await dispatch(); const original = structuredClone(posts[0]); await confirmProof(); await screen.findByRole('button', { name: 'Retry exact reviewed response' }); expect(oldSignal.aborted).toBe(true); expect(posts).toHaveLength(1); hold = false;
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry exact reviewed response' }))); await screen.findByText('Original saved response · version 1'); expect(posts[1]).toEqual(original); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
