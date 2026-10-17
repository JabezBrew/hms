import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, admissionMoveManualReview, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { moveCommand } from '../model';
import { actorId, caseId, context, destination, facilityId, ids, json, page, patientId, receipt, scope, snapshot, user as initialUser } from './fixtures';
vi.mock('@/features/patients/components/MobileWorkspaceContextDock', () => ({ default: () => null }));
const oldFetch = globalThis.fetch, runtime = window.__HMS_RUNTIME_CONFIG__;
const proof = { can_view_full_clinical: true };
let current, candidate, saved, mode, posts, user, denied, client, pendingResolve, events, recordedMoves, unavailableMove;
function serve(url, options = {}) {
  const path = new URL(url).pathname;
  if (options.method === 'POST') {
    const body = JSON.parse(options.body); posts.push(structuredClone(body));
    if (mode === 'destination-changed') return Promise.resolve(json({ error: { code: 'admission_move_destination_changed', message: 'Review the current destination.' } }, 409));
    if (!saved) {
      if (mode === 'not-recorded') return Promise.reject(new TypeError('Synthetic lost response before recording'));
      const input = moveCommand({ scope, source: current, destination: candidate, reason: body.reason, requestId: body.client_request_id, actorId }); saved = receipt(input);
      current = context({ placement_revision: saved.movement.placement_revision, placement_token: 'd'.repeat(64), current_placement: saved.movement.destination_placement, ward_id: saved.movement.destination.ward_id, ward_name: saved.movement.destination.ward_name, bed_id: candidate.bed_id, bed_code: candidate.bed_code, task_membership_token: 'e'.repeat(64), assigned_open_task_count: 0 });
    }
    if (mode === 'lost') return Promise.reject(new TypeError('Synthetic lost saved response'));
    if (mode === 'pending') return new Promise(resolve => { pendingResolve = () => resolve(json({ data: saved })); });
    return Promise.resolve(json({ data: mode === 'malformed' ? { ...saved, movement: { ...saved.movement, admission_case_id: ids[20] } } : saved }));
  }
  if (denied) return Promise.resolve(json({ error: { code: 'admission_move_unavailable', message: 'Current placement access unavailable.' } }, 403));
  if (path.endsWith('/placement')) return Promise.resolve(json({ data: current }));
  if (path.endsWith('/move-destinations')) return Promise.resolve(page([candidate]));
  if (path.includes('/move-requests/')) return Promise.resolve(saved ? json({ data: saved }) : json({ error: { code: 'admission_move_not_found', message: 'No saved original result.' } }, 404));
  if (path.endsWith('/moves')) { const cursor = new URL(url).searchParams.get('cursor'); return Promise.resolve(page(recordedMoves.filter(row => !cursor || row.placement_revision < Number(cursor.slice(2))).slice(0, 1).map(({ reason: _reason, episode: _episode, source_placement: _source, destination_placement: _destination, task_policy: _policy, task_result: _tasks, source_bed_release: _release, placement_history_partial: _partial, ...row }) => row), !cursor && recordedMoves.length > 1 ? `v:${recordedMoves[0].placement_revision}` : null)); }
  if (path.includes('/moves/')) { const move = recordedMoves.find(row => row.id === path.split('/').at(-1)); return Promise.resolve(move && move.id !== unavailableMove ? json({ data: move }) : json({ error: { code: 'admission_move_not_found' } }, 404)); }
  return Promise.resolve(json({ error: { code: 'not_found' } }, 404));
}
function bind() { const principal = { id: user.id, facility_id: facilityId, active_profile: 'hospital' }; const authority = authorizationIdentity(user), transport = getV2ClientScopeKey(); bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority, transport }); }
beforeEach(async () => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; user = structuredClone(initialUser); current = context(); candidate = destination(); saved = null; mode = 'saved'; posts = []; denied = false; pendingResolve = null; recordedMoves = []; unavailableMove = null; configureV2ApiClient({ getAccessToken: () => 'synthetic-move-token', getFacilityCode: () => 'QA', canRefreshSession: () => false }); bind(); globalThis.fetch = vi.fn(serve); events = userEvent.setup(); await vi.waitFor(async () => expect(await admissionMoveManualReview('candidate', { scope })).toBe(false)); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } } }); });
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = oldFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount(initial = {}) {
  let props = { open: true, patient: { id: patientId, name: 'Synthetic patient', current_admission_id: caseId }, selectedAdmissionId: caseId, selectedPlacementRevision: 4, selectedWardId: current.ward_id, chronicleAllHistory: false, clinicalPermissions: proof, ...initial };
  const tree = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { access_allowed: true, read_only: props.readOnly === true, classification: props.readOnly ? 'offsite' : 'onsite', mode: 'read_only', policy_version: 1 } }}><ChronicleClinicalPermissionsContext.Provider value={props.clinicalPermissions}><ChronicleWorkspaceHost activeWorkspace={props.open ? 'admissionMove' : null} workspaceContext={{ ...props, patientId, requestedMoveAdmissionId: props.requestedMoveAdmissionId || null, onClose: () => { props.open = false; view.rerender(tree()); } }} /></ChronicleClinicalPermissionsContext.Provider></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>;
  const view = render(tree()); return { unmount: view.unmount, update(next) { props = { ...props, ...next }; view.rerender(tree()); } };
}
async function review() { await screen.findByRole('radio'); expect(screen.getByRole('radio')).not.toBeChecked(); fireEvent.click(screen.getByRole('radio')); fireEvent.change(screen.getByLabelText('Reason for the move'), { target: { value: '  Synthetic explicit move  ' } }); await events.click(screen.getByRole('button', { name: 'Review move and task routing' })); await screen.findByLabelText('I reviewed the destination, all-open task routing and source-bed cleaning'); }
async function confirm() { await review(); fireEvent.click(screen.getByLabelText('I reviewed the destination, all-open task routing and source-bed cleaning')); fireEvent.click(screen.getByRole('button', { name: 'Confirm move now' })); }
it('reviews explicit same-ward destination, complete counts and cleaning before recording the move through the real Host', async () => {
  mount(); await review(); expect(screen.getByText(/All 3 open tasks route/)).toBeInTheDocument(); expect(screen.getByText(/2 assignments clear/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm move now' })).toBeDisabled(); fireEvent.click(screen.getByLabelText('I reviewed the destination, all-open task routing and source-bed cleaning')); fireEvent.click(screen.getByRole('button', { name: 'Confirm move now' })); await screen.findByRole('region', { name: 'Original saved move' }); expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ destination_bed_id: candidate.bed_id, task_policy: 'route_all_clear_assignees', reason: 'Synthetic explicit move' }); expect(fetch.mock.calls.some(([url]) => url.includes('/nursing/tasks'))).toBe(false); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['lost', 'malformed'])('keeps a %s outcome across close/reopen and recovers only the exact original result', async failure => {
  mode = failure; const panel = mount(); await confirm(); await screen.findByRole('button', { name: 'Check original saved move' }); const original = structuredClone(posts[0]); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); panel.update({ open: false }); expect(screen.queryByRole('dialog')).toBeNull(); panel.update({ open: true }); fireEvent.click(await screen.findByRole('button', { name: 'Check original saved move' })); await screen.findByRole('region', { name: 'Original saved move' }); expect(posts).toEqual([original]); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('retains exact unknown retry after its source eligibility changes, while preserving an unchanged original request', async () => { mode = 'lost'; mount(); await confirm(); await screen.findByRole('button', { name: 'Retry exact reviewed move' }); const original = structuredClone(posts[0]); current = { ...current, can_move: false, unavailable_reason: 'source_inactive' }; fireEvent.click(screen.getByRole('button', { name: 'Refresh current placement' })); await screen.findByRole('button', { name: 'Retry exact reviewed move' }); mode = 'saved'; fireEvent.click(screen.getByRole('button', { name: 'Retry exact reviewed move' })); await screen.findByRole('region', { name: 'Original saved move' }); expect(posts).toEqual([original, original]); });
it('invalidates unsent move consent on source A→B→A while retaining pure reason text', async () => { mount(); await review(); fireEvent.click(screen.getByLabelText('I reviewed the destination, all-open task routing and source-bed cleaning')); const original = current; current = { ...current, placement_token: 'f'.repeat(64) }; fireEvent.click(screen.getByRole('button', { name: 'Refresh current placement' })); await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm move now' })).toBeNull()); current = original; fireEvent.click(screen.getByRole('button', { name: 'Refresh current placement' })); await screen.findByRole('button', { name: 'Review move and task routing' }); expect(screen.getByLabelText('Reason for the move')).toHaveValue('  Synthetic explicit move  '); await waitFor(() => expect(screen.getByRole('button', { name: 'Review move and task routing' })).toBeEnabled()); await events.click(screen.getByRole('button', { name: 'Review move and task routing' })); expect(await screen.findByLabelText('I reviewed the destination, all-open task routing and source-bed cleaning')).not.toBeChecked(); expect(posts).toHaveLength(0); });
it('hides protected local reason and original unknown intent on a current403, retaining only opaque recovery', async () => { mode = 'lost'; mount(); await confirm(); await screen.findByRole('button', { name: 'Retry exact reviewed move' }); denied = true; fireEvent.click(screen.getByRole('button', { name: 'Refresh current placement' })); await screen.findByText('Admission placement unavailable'); expect(screen.queryByText('Synthetic explicit move')).toBeNull(); expect(screen.queryByRole('button', { name: 'Retry exact reviewed move' })).toBeNull(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); });
it('supports explicit current-placement recovery after no receipt and lost RAM, without claiming the earlier outcome', async () => {
  mode = 'not-recorded'; const first = mount(); await confirm(); await screen.findByRole('button', { name: 'Check original saved move' }); fireEvent.click(screen.getByRole('button', { name: 'Check original saved move' })); await screen.findByRole('button', { name: 'Retry exact reviewed move' }); first.unmount(); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Review current saved placement' })); await screen.findByText(/It cannot identify the outcome of the earlier move/); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); fireEvent.click(screen.getByLabelText('I reviewed the current saved placement')); fireEvent.click(screen.getByRole('button', { name: 'Continue after placement review' })); await waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(0)); expect(posts).toHaveLength(1);
});
it('does not select a current admission from all history but honors an explicit exact-case handoff', async () => { const panel = mount({ chronicleAllHistory: true, selectedAdmissionId: null }); await screen.findByText('Select an exact admission'); expect(fetch).not.toHaveBeenCalled(); panel.update({ requestedMoveAdmissionId: caseId }); await screen.findByRole('radio'); expect(fetch.mock.calls.some(([url]) => url.includes(`/${caseId}/placement`))).toBe(true); });
it('keeps current read-only placement available with no move editor or destination query', async () => { mount({ readOnly: true }); await screen.findByText(/Current access is read-only/); expect(screen.queryByLabelText('Reason for the move')).toBeNull(); expect(fetch.mock.calls.some(([url]) => url.includes('move-destinations'))).toBe(false); });
it('reports complete overflow counts without offering a partial move or task download', async () => { current = context({ open_task_count: 509, assigned_open_task_count: 503, task_membership_token: null, can_move: false, unavailable_reason: 'too_many_open_tasks' }); mount(); await screen.findByText(/More than 500 open tasks/); expect(screen.getByText('509 open tasks · 503 current assignments')).toBeInTheDocument(); expect(screen.queryByRole('radio')).toBeNull(); });
it('invalidates reviewed move consent for a same-case same-ward physical revision while preserving pure reason text', async () => {
  const panel = mount(); await review(); fireEvent.click(screen.getByLabelText('I reviewed the destination, all-open task routing and source-bed cleaning'));
  const labels = { ...current.current_placement.labels, bed_id: ids[22], bed_code: 'S-03' };
  current = context({ placement_revision: 5, placement_token: 'f'.repeat(64), bed_id: labels.bed_id, bed_code: labels.bed_code, current_placement: snapshot({ id: ids[23], placement_revision: 5, labels, origin: 'move' }) });
  panel.update({ selectedPlacementRevision: 5 });
  await screen.findByLabelText('Reason for the move'); expect(screen.getByLabelText('Reason for the move')).toHaveValue('  Synthetic explicit move  '); expect(screen.queryByLabelText('I reviewed the destination, all-open task routing and source-bed cleaning')).toBeNull(); expect(posts).toHaveLength(0);
});
it('keeps a definite conflict definite, preserves the reason and requires a fresh reviewed attempt without automatic retry', async () => {
  mode = 'destination-changed'; mount(); await confirm(); await screen.findByText('Review the current destination.'); expect(posts).toHaveLength(1); expect(saved).toBeNull(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0); expect(screen.queryByRole('button', { name: 'Confirm move now' })).toBeNull(); expect(screen.getByLabelText('Reason for the move')).toHaveValue('  Synthetic explicit move  ');
});
it('blocks close and duplicate dispatch while a move is pending and suppresses late old-patient feedback', async () => { mode = 'pending'; const panel = mount(); await confirm(); await waitFor(() => expect(pendingResolve).toBeTypeOf('function')); await events.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(posts).toHaveLength(1); panel.update({ patient: { id: ids[20], name: 'Other synthetic patient' }, clinicalPermissions: { can_view_full_clinical: false } }); await act(async () => pendingResolve()); expect(screen.queryByRole('region', { name: 'Original saved move' })).toBeNull(); expect(posts).toHaveLength(1); });

it('reads one bounded history page at a time and shows exact original evidence independently of current placement', async () => {
  const savedMove = receipt().movement; const older = { ...savedMove, id: ids[24], placement_revision: 4, source_placement: { ...savedMove.source_placement, placement_revision: 3 }, destination_placement: { ...savedMove.destination_placement, placement_revision: 4 }, reason: 'Earlier original reason' }; recordedMoves = [savedMove, older];
  mount(); await screen.findByRole('radio'); fireEvent.click(screen.getByRole('button', { name: 'Recorded moves' }));
  const history = await screen.findByRole('region', { name: 'Recorded admission moves' });
  await waitFor(() => expect(within(history).getByRole('button', { name: 'Next move page' })).toBeEnabled());
  expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/moves'))).toHaveLength(1);
  fireEvent.click(within(history).getByRole('button', { name: /Synthetic origin ward.*Synthetic origin ward/ }));
  const original = await screen.findByRole('region', { name: 'Recorded move' }); expect(within(original).getByText('Synthetic reviewed move reason')).toBeInTheDocument(); expect(within(original).getByText(/The current placement may since have changed/)).toBeInTheDocument();
  fireEvent.click(within(history).getByRole('button', { name: 'Next move page' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Recorded move' })).toBeNull());
  await waitFor(() => expect(within(history).getByRole('button', { name: 'Next move page' })).toBeDisabled());
  expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/moves')).map(([url]) => new URL(url).searchParams.get('cursor'))).toEqual([null, 'v:5']);
  fireEvent.click(within(history).getByRole('button', { name: /Synthetic origin ward.*Synthetic origin ward/ })); await screen.findByText('Earlier original reason');
});
it('shows unknown placement chronology honestly and never substitutes current placement for an unavailable exact historical move', async () => {
  current = context({ current_placement: snapshot({ origin: 'legacy_current_observation', legacy_unknown_prefix: true }), placement_history_partial: true }); recordedMoves = [receipt().movement]; unavailableMove = recordedMoves[0].id;
  mount(); await screen.findByText(/The earlier placement start is unknown/); fireEvent.click(screen.getByRole('button', { name: 'Recorded moves' }));
  const history = await screen.findByRole('region', { name: 'Recorded admission moves' }); fireEvent.click(await within(history).findByRole('button', { name: /Synthetic origin ward.*Synthetic origin ward/ }));
  await screen.findByText('The exact recorded move is unavailable. No current-placement substitute is shown.'); expect(screen.queryByRole('region', { name: 'Recorded move' })).toBeNull(); expect(posts).toHaveLength(0);
});
