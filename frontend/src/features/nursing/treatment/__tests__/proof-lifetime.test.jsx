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
import { actorId, facilityId, patientId, caseId, context, detail, receipt, json } from './fixtures';

const runtime = window.__HMS_RUNTIME_CONFIG__; const proof = { can_view_full_clinical: true };
let auth, initial, upgraded, posts, lose, hold, oldSignal;
function Harness() {
  auth = useAuth();
  return <><button onClick={() => auth.login('synthetic@example.test', 'Synthetic password', 'HMS').catch(() => {})}>Begin synthetic sign-in</button><button onClick={() => auth.reauthenticate(auth.user.email, 'Synthetic password confirmation', 'HMS').catch(() => {})}>Confirm same-session proof</button>{!auth.user ? <FactorLogin /> : <NetworkAccessBoundary><p>Synthetic authorized course workspace</p><ChronicleClinicalPermissionsContext.Provider value={proof}><ChronicleWorkspaceHost activeWorkspace="medicationCourses" workspaceContext={{ patient: { id: patientId, name: 'Synthetic course patient', local_data: { id: patientId, medical_record_number: 'SYNTHETIC-COURSE-MRN' } }, patientId, selectedAdmissionId: caseId, clinicalPermissions: proof, onClose: () => {} }} /></ChronicleClinicalPermissionsContext.Provider></NetworkAccessBoundary>}</>;
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); queryClient.clear(); queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } }); __resetV2ApiClientForTests(); clearWorkflowContinuity(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' };
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('PublicKeyCredential', class {}); vi.stubGlobal('navigator', { ...navigator, credentials: { get: vi.fn().mockResolvedValue(credential()) } });
  initial = token('passkey', { id: actorId, facility_id: facilityId, permissions: ['patient.demographics.view', 'clinical_documentation.view', 'clinical_documentation.manage'], features: ['patients', 'encounters', 'nursing'], patient_visibility: ['full_clinical'] }); initial.access_token = jwtFor(initial, { auth_time: Math.floor(Date.now() / 1000) - 60 }); upgraded = structuredClone(initial); upgraded.user.auth_security.assurance_version += 1; upgraded.user.auth_security.session_assurance.verified_at = new Date().toISOString(); upgraded.access_token = jwtFor(upgraded, { auth_time: Math.floor(Date.now() / 1000) }); posts = []; lose = false; hold = false; oldSignal = null;
  vi.stubGlobal('fetch', vi.fn(async (input, request = {}) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/auth/login')) return json({ data: pending() });
    if (path.endsWith('/login/passkey/options') || path.endsWith('/assurance/options')) return json({ data: options() });
    if (path.endsWith('/login/passkey/verify')) return json({ data: initial });
    if (path.endsWith('/assurance/verify')) return json({ data: upgraded });
    if (path.endsWith('/auth/network-access')) return json({ data: networkDecision() });
    if (path.endsWith('/auth/me') || path.endsWith('/auth/logout')) return json({ data: {} });
    if (path.endsWith('/context')) return json({ data: context() });
    if (path.endsWith('/medication-courses')) return json({ data: [detail().summary], page: { has_next: false, next_cursor: null } });
    if (path.endsWith('/doses') || path.endsWith('/supply')) return json({ data: [], page: { has_next: false, next_cursor: null } });
    if (path.endsWith('/stop') && request.method === 'POST') {
      const payload = JSON.parse(request.body); posts.push(payload); oldSignal = request.signal;
      if (hold) return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Synthetic dispatched abort', 'AbortError')), { once: true }));
      if (lose) throw new TypeError('Synthetic saved response lost');
      return json({ data: receipt({ kind: 'stop', payload, source: detail(), context: context(), actorId, patientId, caseId }) });
    }
    return json({ data: detail() });
  }));
});
afterEach(() => { cleanup(); queryClient.clear(); clearWorkflowContinuity(); __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear(); window.__HMS_RUNTIME_CONFIG__ = runtime; vi.unstubAllGlobals(); });
async function mountAndDraft() {
  render(<QueryClientProvider client={queryClient}><MemoryRouter><HelmetProvider><BreadcrumbProvider><AuthProvider><Harness /></AuthProvider></BreadcrumbProvider></HelmetProvider></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByText('Begin synthetic sign-in')); fireEvent.click(await screen.findByText('Use an existing passkey')); await screen.findByText('Synthetic authorized course workspace'); fireEvent.click(await screen.findByRole('button', { name: /Synthetic reviewed medication/ })); fireEvent.click(await screen.findByRole('button', { name: 'Stop this admission course' })); fireEvent.change(await screen.findByLabelText('Reason for stopping this admission course'), { target: { value: 'SYNTHETIC PRIVATE LOCAL STOP DRAFT' } });
}
async function confirmProof() { const old = getV2ClientScopeKey(); fireEvent.click(screen.getByText('Confirm same-session proof')); await waitFor(() => expect(auth.user.accessContext.auth_security.assurance_version).toBe(upgraded.user.auth_security.assurance_version)); expect(getV2ClientScopeKey()).not.toBe(old); }
async function dispatch() { fireEvent.click(screen.getByRole('button', { name: 'Review course change' })); fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed this patient/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm admission-course stop' })); await waitFor(() => expect(posts).toHaveLength(1)); }
it('retains a real course draft only through validated same-session staged proof while request transport changes', async () => {
  await mountAndDraft(); await confirmProof(); expect(screen.getByDisplayValue('SYNTHETIC PRIVATE LOCAL STOP DRAFT')).toBeInTheDocument(); expect(screen.getByText('Synthetic authorized course workspace')).toBeInTheDocument(); expect(posts).toHaveLength(0);
});
it('retains exact unknown UUID/body through proof without automatic retry and confirms explicit exact replay', async () => {
  await mountAndDraft(); lose = true; await dispatch(); await screen.findByRole('button', { name: 'Retry exact course change' }); const original = structuredClone(posts[0]); await confirmProof(); expect(posts).toHaveLength(1); expect(screen.getByRole('button', { name: 'Retry exact course change' })).toBeInTheDocument(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); lose = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry exact course change' })); await screen.findByText('This admission course was stopped.'); expect(posts[1]).toEqual(original); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('aborts an old pending command on proof upgrade while preserving its exact uncertain command for reviewed replay', async () => {
  await mountAndDraft(); hold = true; await dispatch(); const original = structuredClone(posts[0]); await confirmProof(); await screen.findByRole('button', { name: 'Retry exact course change' }); expect(oldSignal.aborted).toBe(true); expect(posts).toHaveLength(1); hold = false;
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry exact course change' }))); await screen.findByText('This admission course was stopped.'); expect(posts[1]).toEqual(original); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
