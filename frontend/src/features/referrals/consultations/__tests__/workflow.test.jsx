import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { consultationApi, ConsultationUnconfirmedError } from '../api';
import { useLinkedConsultationNote } from '../hooks/useLinkedConsultationNote';
import { consultationContext, inputDigest, redactedIntent } from '../model';
import { actorId, admissionId, at, context, encounter, encounterId, facilityId, inpatient, link, linked, otherId, patientId, referralId, selected, source, visitId } from './fixtures';

// This suite tests the real retained Host and actual note child at the feature
// service seam. Generated consultation transport is verified separately.
vi.mock('@/features/patients/components/MobileWorkspaceContextDock', () => ({ default: () => null }));
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch;
let current, user, client, writeMode, reads, writes, readOnly, restricted, noteWrites, finishPending;
function bind() { const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' }; const binding = { transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal }; bindNetworkAccessGuard(binding).update({ confirmed: true, decision: { access_allowed: true, read_only: readOnly, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority: binding.authorityScope, transport: binding.transportScope }); }
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  user = { id: actorId, adminAccess: { capabilities: ['encounter.view', 'encounter.manage', 'referral.manage', 'patient.demographics.view', 'clinical_documentation.view', 'clinical_documentation.manage'] }, accessContext: { facility_id: facilityId, active_profile: 'hospital', permission_version: 1, features: ['patients', 'referrals', 'encounters'], patient_visibility: ['full_clinical'] } };
  readOnly = false; current = structuredClone(context); reads = []; writes = []; noteWrites = []; writeMode = 'ready'; restricted = false; finishPending = null;
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-CONSULTATION-TOKEN', getFacilityCode: () => 'QA', canRefreshSession: () => false }); bind(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 2 } } });
  vi.spyOn(consultationApi, 'context').mockImplementation(async (scope, choice) => {
    reads.push({ scope, choice });
    if (writeMode === 'denied') throw Object.assign(new Error('Current consultation access unavailable'), { status: 403 });
    let value = structuredClone(current);
    if (choice && !value.link) {
      value = { ...value, can_start: true, unavailable_reason: null, selection: { ...selected.selection, source: choice, restricted_override_required: restricted }, can_override_restricted_record: restricted };
      if (choice.mode === 'existing_admission_encounter') value.selection = structuredClone(inpatient.selection);
      else if (choice.visit.choice === 'existing_visit') value.selection.visit = { id: visitId, patient_id: patientId, appointment_id: null, clinic_id: null, clinic_name: null, status: 'waiting', checked_in_at: at, consultation_started_at: null };
    }
    return consultationContext(value, scope, choice);
  });
  vi.spyOn(consultationApi, 'write').mockImplementation(async command => {
    writes.push(structuredClone(command));
    if (writeMode === 'lost') throw new ConsultationUnconfirmedError();
    if (writeMode === 'pending') return new Promise(resolve => { finishPending = () => resolve({ link }); });
    if (writeMode === 'invalid') throw Object.assign(new Error('Synthetic definite refusal'), { status: 400 });
    current = structuredClone(linked);
    return { client_request_id: command.payload.client_request_id, replayed: false, recorded_at: at, input_digest: await inputDigest(command.payload), reviewed_input: redactedIntent(command.payload), link: structuredClone(link) };
  });
  vi.spyOn(consultationApi, 'recover').mockRejectedValue(Object.assign(new Error('Original result unavailable'), { status: 404 }));
  globalThis.fetch = vi.fn(async (_url, options = {}) => { if (options.method === 'POST') noteWrites.push(JSON.parse(options.body)); throw new TypeError('Synthetic note reply lost'); });
});
afterEach(async () => { cleanup(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); client.clear(); vi.restoreAllMocks(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount(initial = {}) {
  let value = { patient: { id: patientId, name: 'Synthetic patient' }, requestedReferralId: referralId, clinicalPermissions: { can_view_full_clinical: true, can_add_note: true }, selectedEncounter: { ...encounter, visit_id: visitId, admission: { admission_id: admissionId, encounter_id: encounterId } }, ...initial }, open = true;
  const tree = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { access_allowed: true, read_only: readOnly, classification: 'onsite', policy_version: 1 } }}><ChronicleClinicalPermissionsContext.Provider value={value.clinicalPermissions}><ChronicleWorkspaceHost activeWorkspace={open ? 'consultation' : null} workspaceContext={{ ...value, onClose: () => { open = false; view.rerender(tree()); } }} /></ChronicleClinicalPermissionsContext.Provider></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>;
  const view = render(tree()); return { ...view, update(next) { value = { ...value, ...next }; view.rerender(tree()); }, close() { open = false; view.rerender(tree()); }, reopen() { open = true; view.rerender(tree()); } };
}
async function choose(ev, visit = false) { await ev.click(await screen.findByLabelText('Create a new outpatient encounter')); await ev.click(screen.getByLabelText(visit ? 'Use the actual visit associated with the selected encounter' : 'Start without a visit. No visit or check-in is created.')); await screen.findByRole('region', { name: 'Reviewed consultation source' }); if (!restricted) await waitFor(() => expect(screen.getByRole('button', { name: 'Review consultation start' })).toBeEnabled()); }
async function review(ev) { await ev.click(screen.getByRole('button', { name: 'Review consultation start' })); await ev.click(await screen.findByLabelText('I reviewed this patient, referral and exact consultation source.')); }
it('mounts without a source default or mutation, then requires explicit no-visit selection, fresh review and confirmation', async () => {
  mount(); const ev = userEvent.setup(); await screen.findByLabelText('Consultation source'); expect(screen.getAllByRole('radio').every(element => element.getAttribute('data-state') === 'unchecked')).toBe(true); expect(writes).toHaveLength(0);
  await choose(ev); expect(writes).toHaveLength(0); await review(ev); expect(writes).toHaveLength(0); await ev.click(screen.getByRole('button', { name: 'Confirm consultation start' })); await screen.findByRole('region', { name: 'Original consultation start result' }); expect(writes).toHaveLength(1); expect(writes[0].payload.source).toEqual(source); expect(current.referral.status).toBe('accepted'); expect(noteWrites).toHaveLength(0);
});
it('uses only the actual distinct visit scalar selected in Chronicle', async () => {
  mount(); const ev = userEvent.setup(); await choose(ev, true); await review(ev); await ev.click(screen.getByRole('button', { name: 'Confirm consultation start' })); await screen.findByRole('region', { name: 'Original consultation start result' }); expect(writes[0].payload.source.visit.visit_id).toBe(visitId); expect(visitId).not.toBe(encounterId); expect(reads.some(value => value.choice?.visit?.visit_id === encounterId)).toBe(false);
});
it.each(['all-history', 'ambiguous', 'missing'])('cannot choose an admission from %s selection and never substitutes active encounter', async fault => {
  const value = { selectedEncounter: { ...encounter, admission: { admission_id: admissionId, encounter_id: encounterId } }, activeEncounter: { id: otherId } };
  if (fault === 'all-history') value.chronicleAllHistory = true;
  if (fault === 'ambiguous') value.selectedEncounter.admission_link_ambiguous = true;
  if (fault === 'missing') value.selectedEncounter.admission = null;
  mount(value); const ev = userEvent.setup(); await ev.click(await screen.findByLabelText('Use the exact selected admission encounter')); expect(await screen.findByText(/All history or an ambiguous association/)).toBeInTheDocument(); expect(writes).toHaveLength(0); expect(reads.every(value => value.choice === null)).toBe(true);
});
it('retains a reviewed exact unknown start across ordinary close and referral URL clearing', async () => {
  const view = mount(); const ev = userEvent.setup(); await choose(ev); await review(ev); writeMode = 'lost'; await ev.click(screen.getByRole('button', { name: 'Confirm consultation start' })); await screen.findByRole('button', { name: 'Retry exact reviewed start' }); const original = writes[0].payload;
  view.close(); view.update({ requestedReferralId: null }); view.reopen(); writeMode = 'ready'; await ev.click(await screen.findByRole('button', { name: 'Retry exact reviewed start' })); await screen.findByRole('region', { name: 'Original consultation start result' }); expect(writes).toHaveLength(2); expect(writes[1].payload).toEqual(original);
});
it('clears private override text after current403 and leaves no protected local draft visible', async () => {
  restricted = true; mount(); const ev = userEvent.setup(); await choose(ev); await ev.click(screen.getByLabelText('Use an explicit restricted-record override')); fireEvent.change(screen.getByLabelText('Override reason code'), { target: { value: 'reviewed-intake' } }); fireEvent.change(screen.getByLabelText('Optional override note'), { target: { value: 'Synthetic private override text' } });
  writeMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Refresh current consultation' })); await screen.findByText('Consultation unavailable'); expect(screen.queryByDisplayValue('Synthetic private override text')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('opens the actual exact-link note child and retains its unsaved text on ordinary close', async () => {
  current = structuredClone(linked); const view = mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Open clinical note for linked encounter' })); fireEvent.change(await screen.findByLabelText('Note title'), { target: { value: 'Synthetic retained consultation note' } });
  view.close(); view.reopen(); expect(await screen.findByLabelText('Note title')).toHaveValue('Synthetic retained consultation note'); expect(writes).toHaveLength(0); expect(noteWrites).toHaveLength(0);
});
it('preserves actual note unknown intent and global barrier on close without a null or active encounter fallback', async () => {
  current = structuredClone(linked); const view = mount({ activeEncounter: { id: otherId } }); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Open clinical note for linked encounter' })); fireEvent.change(await screen.findByLabelText('Note title'), { target: { value: 'Synthetic note' } }); fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Synthetic complete clinical narrative' } }); await ev.click(screen.getByRole('button', { name: 'Review note before saving' })); await ev.click(screen.getByLabelText('I confirmed this patient and reviewed the complete note.')); await ev.click(screen.getByRole('button', { name: 'Save reviewed note' })); await screen.findByRole('button', { name: 'Retry exact note change' });
  expect(noteWrites).toHaveLength(1); expect(noteWrites[0].encounter_id).toBe(encounterId); expect(noteWrites[0].encounter_id).not.toBe(otherId); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); view.close(); view.reopen(); await screen.findByRole('button', { name: 'Retry exact note change' }); expect(noteWrites).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
});
it('unmounts protected note copies after a fresh terminal linked encounter and refuses another note mount', async () => {
  current = structuredClone(linked); mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Open clinical note for linked encounter' })); fireEvent.change(await screen.findByLabelText('Note title'), { target: { value: 'Synthetic discarded terminal note' } }); await ev.keyboard('{Escape}'); current = { ...linked, can_resume: false, current_linked_encounter: { ...encounter, status: 'completed', ended_at: at } }; await ev.click(screen.getByRole('button', { name: 'Refresh current consultation' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Open clinical note for linked encounter' })).toBeDisabled()); expect(screen.queryByDisplayValue('Synthetic discarded terminal note')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});

it('invalidates unsent consent after an actual current referral context A→B→A refresh', async () => {
  mount(); const ev = userEvent.setup(); await choose(ev); await review(ev); expect(screen.getByRole('button', { name: 'Confirm consultation start' })).toBeEnabled();
  current = { ...context, context_token: 'c'.repeat(64) }; await ev.click(screen.getByRole('button', { name: 'Refresh current consultation' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm consultation start' })).not.toBeInTheDocument());
  current = structuredClone(context); await ev.click(screen.getByRole('button', { name: 'Refresh current consultation' })); await screen.findByRole('button', { name: 'Review consultation start' });
  expect(screen.queryByLabelText('I reviewed this patient, referral and exact consultation source.')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it.each(['permission', 'Full', 'referral'])('suppresses stale pending start output after a %s scope transition', async change => {
  const view = mount(); const ev = userEvent.setup(); await choose(ev); await review(ev); writeMode = 'pending'; await ev.click(screen.getByRole('button', { name: 'Confirm consultation start' })); await waitFor(() => expect(finishPending).toBeTypeOf('function'));
  if (change === 'permission') { user = { ...user, accessContext: { ...user.accessContext, permission_version: 2 } }; view.update({}); }
  if (change === 'Full') view.update({ clinicalPermissions: { can_view_full_clinical: false, can_add_note: false } });
  if (change === 'referral') { current = { ...context, referral_id: otherId }; view.update({ requestedReferralId: otherId }); }
  await act(async () => finishPending()); expect(screen.queryByRole('region', { name: 'Original consultation start result' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Retry exact reviewed start' })).not.toBeInTheDocument(); expect(writes).toHaveLength(1);
});
it('rechecks the exact linked encounter but requires independent note authority before mounting an editor', async () => {
  current = structuredClone(linked); user = { ...user, adminAccess: { capabilities: user.adminAccess.capabilities.filter(value => value !== 'clinical_documentation.manage') } }; bind(); mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Open clinical note for linked encounter' })); await screen.findByText('Clinical note unavailable'); expect(screen.queryByLabelText('Note title')).not.toBeInTheDocument(); expect(writes).toHaveLength(0); expect(noteWrites).toHaveLength(0);
});

it('shows bounded start metadata without documentation view and cannot open its note child', async () => {
  current = { ...structuredClone(linked), can_resume: false }; user = { ...user, adminAccess: { capabilities: user.adminAccess.capabilities.filter(value => !value.startsWith('clinical_documentation.')) } }; bind(); mount();
  await screen.findByRole('region', { name: 'Recorded consultation link' }); expect(screen.getByRole('button', { name: 'Open clinical note for linked encounter' })).toBeDisabled(); expect(screen.queryByLabelText('Note title')).not.toBeInTheDocument(); expect(noteWrites).toHaveLength(0); expect(writes).toHaveLength(0);
});
it('resets unsent review consent when protected patient identity is corrected', async () => {
  mount(); const ev = userEvent.setup(); await choose(ev); await review(ev); expect(screen.getByRole('button', { name: 'Confirm consultation start' })).toBeEnabled();
  current = { ...context, patient: { ...context.patient, display_name: 'Synthetic corrected consultation identity' }, context_token: 'd'.repeat(64) }; await ev.click(screen.getByRole('button', { name: 'Refresh current consultation' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm consultation start' })).not.toBeInTheDocument()); expect(screen.getAllByText('Synthetic corrected consultation identity').length).toBeGreaterThan(0); expect(screen.queryByLabelText('I reviewed this patient, referral and exact consultation source.')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});

function NoteLifetimeAuthority({ children }) { return <AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }}>{children}</ReadOnlyModeProvider></AuthContext.Provider>; }
it.each(['pending', 'opened'])('requires a new explicit note-open after preparation authority A→denied→A (%s)', async phase => {
  let finish;
  const query = { refetch: vi.fn(() => new Promise(resolve => { finish = () => resolve({ data: linked }); })) };
  const view = renderHook(({ enabled }) => useLinkedConsultationNote({ query, current: linked, accessScope: 'synthetic-note-lifetime', locked: false, onDenied: vi.fn(), enabled }), { initialProps: { enabled: true }, wrapper: NoteLifetimeAuthority });
  let opening;
  act(() => { opening = view.result.current.begin(); });
  if (phase === 'opened') { await act(async () => { finish(); await opening; }); expect(view.result.current.linked).toBe(true); }
  view.rerender({ enabled: false }); expect(view.result.current.linked).toBe(false); view.rerender({ enabled: true });
  if (phase === 'pending') await act(async () => { finish(); await opening; });
  expect(view.result.current.open).toBe(false); expect(view.result.current.linked).toBe(false); expect(view.result.current.opening).toBe(false);
});
it('allows the current explicitly requested exact note-open without an authority change', async () => {
  const query = { refetch: vi.fn().mockResolvedValue({ data: linked }) };
  const view = renderHook(() => useLinkedConsultationNote({ query, current: linked, accessScope: 'synthetic-note-lifetime', locked: false, onDenied: vi.fn(), enabled: true }), { wrapper: NoteLifetimeAuthority });
  await act(async () => view.result.current.begin()); expect(view.result.current.open).toBe(true); expect(view.result.current.linked).toBe(true); expect(query.refetch).toHaveBeenCalledTimes(1);
});
