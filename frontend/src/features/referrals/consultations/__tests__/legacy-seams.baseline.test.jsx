import { useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { visitsApi } from '@/lib/api/visits';
import { useConsultationWorkflow } from '@/hooks/useConsultationWorkflow';
import ConsultationSlideOver from '@/components/chronicle/ConsultationSlideOver';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import { useChronicleRouteState } from '@/features/patients/chronicle/useChronicleRouteState';
import { useChronicleWorkspaceActions } from '@/features/patients/chronicle/useChronicleWorkspaceActions';
import { buildChronicleWorkspaceProps } from '@/features/patients/chronicle/workspaceRegistry';

// Preserve the real Rust refusal; observe its position relative to actual visit
// transport. Presentation alone is replaced to avoid testing the retired wizard.
const probe = vi.hoisted(() => ({ onGuard: null }));
vi.mock('@/hooks/workflowV2Guard', async (original) => {
  const actual = await original();
  return { ...actual, ensureRustV2WorkflowSupported: (...args) => {
    probe.onGuard?.();
    return actual.ensureRustV2WorkflowSupported(...args);
  } };
});
vi.mock('@/components/chronicle/ConsultationSlideOverSections', () => ({
  ConsultationSlideOverPanel: ({ error }) => <div aria-label="Legacy consultation presentation">{error ? 'Unsupported workflow refused' : 'Legacy consultation mounting'}</div>,
}));
vi.mock('@/features/patients/components/MobileWorkspaceContextDock', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const ids = Array.from({ length: 12 }, (_, index) => `19191919-1919-4919-8919-${String(index + 1).padStart(12, '0')}`);
const [patientId, encounterId, visitId, referralId, selectedEncounterId, selectedVisitId, admissionId, actorId, facilityId] = ids;
const patient = { id: patientId, name: 'Synthetic baseline patient' };
const active = { id: encounterId, patient_id: patientId, visit_id: visitId, status: 'in-progress', encounter_type: 'outpatient' };
const selected = { id: selectedEncounterId, patient_id: patientId, visit_id: selectedVisitId, status: 'in-progress', encounter_type: 'emergency', admission: { admission_id: admissionId, encounter_id: selectedEncounterId } };
const user = { id: actorId, accessContext: { facility_id: facilityId, active_profile: 'hospital', features: ['patients', 'encounters', 'referrals'], patient_visibility: ['full_clinical'] }, adminAccess: { capabilities: ['patient.demographics.view', 'encounter.manage', 'referral.manage'] } };
const originalFetch = globalThis.fetch, originalRuntime = window.__HMS_RUNTIME_CONFIG__;
let client, calls, order, visitStatus;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const visit = () => ({ id: visitId, patient_id: patientId, patient_code: 'SYNTHETIC', patient_display_name: 'Synthetic baseline patient', appointment_id: null, encounter_id: encounterId, clinic_id: null, status: visitStatus, checked_in_at: '2026-10-17T09:00:00Z' });
function wrapper({ children }) { return <AuthContext.Provider value={{ user, facilityCode: 'QA' }}><QueryClientProvider client={client}>{children}</QueryClientProvider></AuthContext.Provider>; }
function observeGuard() { probe.onGuard = () => { order.push('guard'); }; }
beforeEach(() => {
  calls = []; order = []; visitStatus = 'waiting'; probe.onGuard = null;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-baseline-token', getFacilityCode: () => 'QA', canRefreshSession: () => false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = new URL(url).pathname, method = init.method || 'GET'; calls.push({ path, method });
    if (method === 'GET' && path === `/api/v2/visits/${visitId}`) return json({ data: visit() });
    if (method === 'POST' && path === `/api/v2/visits/${visitId}/start-consultation`) { order.push('visit-start'); visitStatus = 'in_consultation'; return json({ data: visit() }); }
    return json({ error: { code: 'not_found', message: 'Static baseline resource unavailable' } }, 404);
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  client.clear(); probe.onGuard = null; __resetV2ApiClientForTests(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
});

it('CONTROL actual generated visit adapter accepts the distinct visit ID without a mutation', async () => {
  const result = await visitsApi.get(visitId);
  expect(result.id === visitId && result.encounter_id === encounterId && visitId !== encounterId).toBe(true);
  expect(calls.length === 1 && calls[0].method === 'GET').toBe(true);
});
it('CONTROL actual consultation workflow hook refuses Rust before legacy transport', async () => {
  const hook = renderHook(() => useConsultationWorkflow(patientId, { referralId, encounterId }), { wrapper });
  let result;
  await act(async () => { result = await hook.result.current.startWorkflow(); });
  expect(result === null && hook.result.current.error?.includes('no generated /api/v2 workflow contract')).toBe(true);
  expect(calls.length === 0).toBe(true);
});
it('REGRESSION normal distinct-ID Host must never dereference an encounter as a visit and sends no start POST', async () => {
  observeGuard();
  const mounted = render(<ChronicleWorkspaceHost activeWorkspace="consultation" workspaceContext={{ patientId, patient, activeEncounter: active, selectedEncounter: active, selectedEncounterId: encounterId, referralId, clinicalPermissions: { can_view_full_clinical: true }, onClose: vi.fn() }} />, { wrapper });
  await screen.findByText('Consultation unavailable'); mounted.unmount();
  expect(order.includes('guard')).toBe(false);
  expect(calls.every(call => call.method !== 'POST')).toBe(true);
  expect(calls.length).toBe(0);
  expect(calls.every(call => call.path !== `/api/v2/visits/${encounterId}`), 'Encounter identity must not be used as a visit resource key').toBe(true);
});
it('REGRESSION visit-compatible legacy component argument must not mutate a visit before the real unsupported guard', async () => {
  observeGuard();
  // Explicit premise: the legacy public argument holds a real visit key. This
  // does not claim the normal distinct-ID Host successfully resolves its visit.
  const mounted = render(<ConsultationSlideOver open patient={patient} referralId={referralId} encounterId={visitId} onClose={vi.fn()} />, { wrapper });
  await screen.findByText('Consultation unavailable'); mounted.unmount();
  expect(order.includes('guard')).toBe(false);
  expect(order.includes('visit-start')).toBe(false);
  expect(calls.every(call => call.method !== 'POST'), 'Unsupported Rust consultation mount must issue no visit mutation').toBe(true);
});
function useRouteHandoff(action) {
  const [search, setSearch] = useState(`?action=${action}&referral_id=${referralId}`), [opened, setOpened] = useState(null), [options, setOptions] = useState(null);
  const open = useCallback((id, value) => { setOpened(id); setOptions(value); }, []), clear = useCallback(() => setSearch(''), []);
  const route = useChronicleRouteState({ id: patientId, search, openChronicleWorkspace: open, clearQueryParams: clear });
  const actions = useChronicleWorkspaceActions({ id: patientId, workspaceOptions: options, referralIdParam: route.referralIdParam, activeEncounter: active, chartContextEncounter: selected, chartContextAdmissionId: admissionId, slideOvers: {} });
  return { search, opened, props: opened ? buildChronicleWorkspaceProps(opened, { ...actions.workspaceContext, patient }) : null };
}
it('CONTROL existing response route retains exact referral after transient URL removal', async () => {
  const hook = renderHook(() => useRouteHandoff('referral_response'));
  await waitFor(() => expect(hook.result.current.search === '' && hook.result.current.opened === 'referralResponse').toBe(true));
  expect(hook.result.current.props.requestedReferralId === referralId).toBe(true);
});
it('REGRESSION consultation route must retain exact referral after transient URL removal', async () => {
  const hook = renderHook(() => useRouteHandoff('consultation'));
  await waitFor(() => expect(hook.result.current.search === '' && hook.result.current.opened === 'consultation').toBe(true));
  expect(hook.result.current.props.referralId === referralId, 'Exact referral must survive the real URL clear').toBe(true);
});
it('CONTROL existing note registry uses explicit selected encounter rather than active encounter', () => {
  const props = buildChronicleWorkspaceProps('note', { patient, activeEncounter: active, selectedEncounter: selected, selectedEncounterId, selectedAdmissionId: admissionId });
  expect(props.encounter?.id === selectedEncounterId && props.encounter?.visit_id === selectedVisitId && selectedEncounterId !== encounterId).toBe(true);
});
it('REGRESSION consultation registry must preserve explicit selected encounter instead of unrelated active encounter', () => {
  const props = buildChronicleWorkspaceProps('consultation', { patient, activeEncounter: active, selectedEncounter: selected, selectedEncounterId, selectedAdmissionId: admissionId, referralId });
  expect(props.encounterId === encounterId).toBe(false);
  expect(props.encounterId === selectedEncounterId, 'Consultation target must follow exact explicit selection').toBe(true);
});
