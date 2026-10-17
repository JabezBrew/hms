import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import TreatmentCoursesPanel from '../TreatmentCoursesPanel';
import { user, actorId, facilityId, patientId, caseId, otherCaseId, ids, context, counts, detail, dose, receipt, supply, json } from './fixtures';

const runtime = window.__HMS_RUNTIME_CONFIG__; const oldFetch = globalThis.fetch;
const decision = { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 };
const proof = { can_view_full_clinical: true, can_add_note: false, can_record_vitals: false, can_prescribe: false };
const onClose = vi.fn(); const onReviewPrescriptions = vi.fn(); const onReviewMar = vi.fn();
let client, current, currentContext, requests, writes, receipts, lose, malformed, slow, finishWrite, contextStatus, detailStatus, historyStatus, afterSaveFailure, listEmpty, paged, pendingDetail;
function Harness({ open = true, selected = caseId, history = false, actor = user, readonly = false, host = false, full = true, patient = patientId }) {
  const person = { id: patient, name: 'Synthetic course patient', local_data: { id: patient, medical_record_number: 'SYNTHETIC-COURSE-MRN', current_admission_id: otherCaseId } }; const clinicalPermissions = { ...proof, can_view_full_clinical: full };
  return <AuthContext.Provider value={{ user: actor }}><QueryClientProvider client={client}><ReadOnlyModeProvider network={{ confirmed: true, decision: { ...decision, read_only: readonly } }}><ChronicleClinicalPermissionsContext.Provider value={clinicalPermissions}>{host ? <ChronicleWorkspaceHost activeWorkspace={open ? 'medicationCourses' : null} workspaceContext={{ patient: person, patientId: patient, selectedAdmissionId: selected, chronicleAllHistory: history, clinicalPermissions, onClose, onReviewPrescriptions, onReviewSelectedAdmissionMar: onReviewMar }} /> : <TreatmentCoursesPanel {...{ open, onClose, onReviewPrescriptions, onReviewMar, clinicalPermissions }} patient={person} selectedAdmissionId={selected} allHistory={history} />}</ChronicleClinicalPermissionsContext.Provider></ReadOnlyModeProvider></QueryClientProvider></AuthContext.Provider>;
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-COURSE-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal: { id: actorId, facility_id: facilityId, active_profile: 'hospital' } }).update({ confirmed: true, decision }); activateWriteUncertainty({ id: actorId, facility_id: facilityId, active_profile: 'hospital' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 3 } } }); current = detail(); currentContext = context(); requests = []; writes = []; receipts = new Map(); lose = false; malformed = false; slow = false; finishWrite = null; contextStatus = 200; detailStatus = 200; historyStatus = 200; afterSaveFailure = false; listEmpty = false; paged = false; pendingDetail = null; onClose.mockClear(); onReviewPrescriptions.mockClear(); onReviewMar.mockClear();
  globalThis.fetch = vi.fn(async (input, options = {}) => {
    const url = new URL(input); const path = url.pathname; const parts = path.split('/').filter(Boolean); const targetPatient = parts[3]; const targetCase = parts[6]; const scoped = { ...current, summary: { ...current.summary, patient_id: targetPatient, admission_case_id: targetCase } }; const scopedContext = { ...currentContext, patient_id: targetPatient, admission_case_id: targetCase }; requests.push({ url, options });
    if (path.endsWith('/context')) return json(contextStatus === 200 ? { data: scopedContext } : { error: { code: 'synthetic_context_unavailable', message: 'Synthetic context unavailable' } }, contextStatus);
    if (path.includes('/requests/')) { const saved = receipts.get(parts.at(-1)); return saved ? json({ data: { ...saved, replayed: true } }) : json({ error: { code: 'not_found', message: 'Synthetic missing result' } }, 404); }
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body); writes.push({ path, payload, signal: options.signal });
      const perform = () => {
        const earlier = receipts.get(payload.client_request_id); if (earlier) return json({ data: { ...earlier, replayed: true } });
        const kind = path.endsWith('/stop') ? 'stop' : 'window'; const original = { kind, payload, patientId: targetPatient, caseId: targetCase, actorId, source: structuredClone(scoped), context: structuredClone(scopedContext) }; const saved = receipt(original); receipts.set(payload.client_request_id, saved);
        if (kind === 'stop') current = { ...current, summary: { ...current.summary, status: 'stopped', has_local_stop: true }, local_stop: saved.result, can_stop_course: false, can_request_schedule_window: false, stop_unavailable_reason: 'course_terminal', window_unavailable_reason: 'course_terminal', course_token: 'e'.repeat(64), counts: counts({ held_doses: 2, unrecorded_held_doses: 2, awaiting_supply_doses: 0, supplied_pending_doses: 0 }) };
        else current = { ...current, summary: { ...current.summary, scheduled_through: payload.scheduled_before }, course_token: 'e'.repeat(64), supply_window_constraints: { ...current.supply_window_constraints, scheduled_from: payload.scheduled_before }, counts: counts({ generated_scheduled_doses: 5, awaiting_supply_doses: 3 }) };
        if (afterSaveFailure) contextStatus = 503; if (lose) { lose = false; throw new TypeError('Synthetic saved response lost'); }
        return json({ data: malformed ? { ...saved, recorded_by_user_id: ids[25] } : saved });
      };
      if (slow) return new Promise((resolve, reject) => { options.signal?.addEventListener('abort', () => reject(new DOMException('Synthetic dispatched abort', 'AbortError')), { once: true }); finishWrite = () => { try { resolve(perform()); } catch (error) { reject(error); } }; });
      return perform();
    }
    if (path.endsWith('/medication-courses')) return json({ data: listEmpty ? [] : [scoped.summary], page: { has_next: paged && !url.searchParams.has('cursor'), next_cursor: paged && !url.searchParams.has('cursor') ? 'synthetic-second' : null } });
    if (path.endsWith('/doses')) {
      if (historyStatus !== 200) return json({ error: { code: 'synthetic_history_unavailable', message: 'Synthetic history unavailable' } }, historyStatus);
      const request = url.searchParams.get('request_id'); const rows = request ? [0, 1].map((index) => dose({ id: ids[9 + index], status: 'held', local_stop_id: ids[13], original_request_membership: { medication_administration_id: ids[9 + index], scheduled_at: dose().scheduled_at, dose_sequence: index + 1, pharmacy_fulfillment_id: ids[10], status_at_command: 'scheduled', was_dispensed: false, scheduled_stock_policy: current.scheduled_stock_policy } })) : [dose()];
      return json({ data: rows, page: { has_next: false, next_cursor: null } });
    }
    if (path.endsWith('/supply')) return json({ data: [supply()], page: { has_next: false, next_cursor: null } });
    if (pendingDetail) return pendingDetail.promise;
    return json(detailStatus === 200 ? { data: scoped } : { error: { code: 'patient_access_denied', message: 'Synthetic course denied' } }, detailStatus);
  });
});
afterEach(() => { cleanup(); client?.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = oldFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
async function selectCourse() { fireEvent.click(await screen.findByRole('button', { name: /Synthetic reviewed medication/ })); await screen.findByText('Synthetic private source instructions'); }
async function prepare(kind = 'stop') {
  await selectCourse(); fireEvent.click(screen.getByRole('button', { name: kind === 'stop' ? 'Stop this admission course' : 'Add next scheduled supply window' }));
  if (kind === 'stop') fireEvent.change(await screen.findByLabelText('Reason for stopping this admission course'), { target: { value: 'Synthetic reviewed admission-local stop' } }); else fireEvent.change(await screen.findByLabelText('Schedule doses before (UTC)'), { target: { value: '2030-05-19T06:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review course change' })); fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed this patient/ }));
}
async function save(kind = 'stop') { await prepare(kind); fireEvent.click(screen.getByRole('button', { name: kind === 'stop' ? 'Confirm admission-course stop' : 'Create reviewed schedule window' })); }

it('reviews the selected historical stay, whole-course totals and null physical evidence without following the current admission', async () => {
  currentContext = context({ admission_status: 'discharged', can_manage_courses: false, management_unavailable_reason: 'admission_inactive' }); current = detail({ can_stop_course: false, can_request_schedule_window: false, stop_unavailable_reason: 'admission_inactive', window_unavailable_reason: 'admission_inactive', counts: counts({ issued_stock_quantity: null, issued_stock_unit: null, issued_stock_unrecorded_doses: 1, stock_total_unavailable_reason: 'missing_evidence' }) });
  render(<Harness host />); await selectCourse(); expect(screen.getByText('Not recorded as a complete stock total')).toBeInTheDocument(); expect(screen.getByText('Not estimated')).toBeInTheDocument(); expect(screen.getByText(/SYNTHETIC-COURSE-MRN/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Stop this admission course' })).not.toBeInTheDocument(); expect(requests.every(({ url }) => url.pathname.includes(`/admissions/${caseId}/`))).toBe(true); expect(writes).toHaveLength(0);
});
it('records an explicit local stop with immutable original membership and leaves the source active', async () => {
  render(<Harness />); await save(); await screen.findByText('This admission course was stopped.'); expect(writes).toHaveLength(1); expect(writes[0].payload.reason).toBe('Synthetic reviewed admission-local stop'); expect(screen.getByText(/active · unchanged by this admission-local stop/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review original affected dose membership' })); await screen.findAllByText(/Original command membership/); expect(screen.getAllByText(/Retired by admission-course stop/)).toHaveLength(2); expect(requests.some(({ url }) => url.searchParams.get('request_id') === writes[0].payload.client_request_id)).toBe(true);
});
it('uses an explicit future UTC cutoff and confirms exact dose membership only after saving without physical stock claims', async () => {
  render(<Harness />); await prepare('window'); expect(screen.getByText(/exact new dose count is confirmed after saving/)).toBeInTheDocument(); expect(writes).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Create reviewed schedule window' })); await screen.findByText('Additional dose records and supply demand were saved.'); expect(writes[0].payload).toMatchObject({ expected_scheduled_through: '2030-05-18T06:00:00Z', scheduled_before: '2030-05-19T06:00:00.000Z', note: null }); expect(writes[0].payload).not.toHaveProperty('quantity'); expect(screen.getByText(/did not issue physical stock/)).toBeInTheDocument(); expect(screen.getByRole('region', { name: 'Original created dose membership' })).toBeInTheDocument();
});
it('preserves the exact unknown command across actual Host close/reopen and acknowledges only validated original recovery', async () => {
  lose = true; const view = render(<Harness host />); await save(); await screen.findByRole('button', { name: 'Retry exact course change' }); const wire = structuredClone(writes[0].payload); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  view.rerender(<Harness host open={false} />); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); const previous = fetch.mock.calls.length; await act(async () => Promise.resolve()); expect(fetch).toHaveBeenCalledTimes(previous);
  view.rerender(<Harness host />); fireEvent.click(await screen.findByRole('button', { name: 'Check original saved result' })); await screen.findByText('This admission course was stopped.'); expect(writes).toHaveLength(1); expect(writes[0].payload).toEqual(wire); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('keeps a malformed success locked to explicit exact replay instead of changing the command', async () => {
  malformed = true; render(<Harness />); await save('window'); await screen.findByRole('button', { name: 'Retry exact course change' }); const wire = structuredClone(writes[0].payload); malformed = false; fireEvent.click(screen.getByRole('button', { name: 'Retry exact course change' })); await screen.findByText('Additional dose records and supply demand were saved.'); expect(writes).toHaveLength(2); expect(writes[1].payload).toEqual(wire);
});
it('blocks duplicate dispatch and Escape/top-close/footer dismissal while a real request is pending', async () => {
  slow = true; render(<Harness />); await save(); await waitFor(() => expect(writes).toHaveLength(1)); fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true })); fireEvent.click(screen.getByRole('button', { name: 'Close medication courses' })); expect(onClose).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Saving course change…' })); expect(writes).toHaveLength(1); await act(async () => finishWrite()); await screen.findByText('This admission course was stopped.');
});
it('preserves a confirmed receipt when current refresh fails', async () => {
  afterSaveFailure = true; render(<Harness />); await save(); await screen.findByText(/The original course change is confirmed/); expect(screen.queryByText('Synthetic reviewed admission-local stop')).not.toBeInTheDocument(); expect(writes).toHaveLength(1); contextStatus = 200; fireEvent.click(screen.getByRole('button', { name: 'Recheck admission access' })); await screen.findByText('This admission course was stopped.');
});
it('separates no-generated-course from no-prescription and invokes the real Chronicle prescription handoff', async () => {
  listEmpty = true; currentContext.generated_course_count = 0; render(<Harness />); await screen.findByText(/This does not mean there are no prescriptions/); fireEvent.click(screen.getByRole('button', { name: 'Review prescriptions in Chronicle' })); expect(onReviewPrescriptions).toHaveBeenCalledOnce(); expect(writes).toHaveLength(0);
});
it.each([{ selected: null }, { history: true }, { full: false }])('does not load rich data for no selection/all history/Summary (%j)', async (props) => {
  render(<Harness host {...props} />); await screen.findByRole('dialog'); expect(fetch).not.toHaveBeenCalled(); expect(screen.queryByText('Synthetic private source instructions')).not.toBeInTheDocument();
});
it('discards copied draft on explicit admission change and never publishes the prior late source result', async () => {
  const view = render(<Harness host />); await prepare(); expect(screen.getByText(/Reason: Synthetic reviewed admission-local stop/)).toBeInTheDocument(); view.rerender(<Harness host selected={otherCaseId} />); await screen.findByRole('button', { name: /Synthetic reviewed medication/ }); expect(screen.queryByText(/Reason: Synthetic reviewed admission-local stop/)).not.toBeInTheDocument(); expect(writes).toHaveLength(0); expect(requests.some(({ url }) => url.pathname.includes(`/admissions/${otherCaseId}/`))).toBe(true);
});
it('removes every cached protected body/action when a rich history read returns403', async () => {
  render(<Harness />); await selectCourse(); await screen.findByText('Not recorded as supplied'); historyStatus = 403; fireEvent.click(screen.getByRole('button', { name: 'Refresh current history page' })); await screen.findByText('Medication courses unavailable'); expect(screen.queryByText('Synthetic private source instructions')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Stop this admission course' })).not.toBeInTheDocument();
});
it('removes current and copied content on detail403 and authority withdrawal before accepting a late write', async () => {
  const view = render(<Harness />); await selectCourse(); detailStatus = 403; fireEvent.click(screen.getByRole('button', { name: 'Refresh current access and course' })); await screen.findByText('Medication courses unavailable'); expect(screen.queryByText('Synthetic private source instructions')).not.toBeInTheDocument();
  detailStatus = 200; cleanup(); slow = true; const next = render(<Harness />); await save(); await waitFor(() => expect(writes).toHaveLength(1)); next.rerender(<Harness actor={{ ...user, accessContext: { ...user.accessContext, patient_visibility: ['clinical_summary'] } }} />); expect(screen.getByText('Medication courses unavailable')).toBeInTheDocument(); expect(screen.queryByText(/Reason: Synthetic reviewed admission-local stop/)).not.toBeInTheDocument(); expect(writes[0].signal.aborted).toBe(true); await act(async () => finishWrite()); expect(screen.queryByText('This admission course was stopped.')).not.toBeInTheDocument(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); view.unmount();
});
it('keeps course changes disabled on readonly network while allowing honest Full review', async () => {
  render(<Harness readonly />); await selectCourse(); expect(screen.getByRole('button', { name: 'Stop this admission course' })).toBeDisabled(); expect(screen.getByText(/This connection has read-only access/)).toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('does not interpret nursing task permission as prescribing authority or mislabel it as a network restriction', async () => {
  render(<Harness actor={{ ...user, adminAccess: { capabilities: ['clinical_documentation.view', 'nursing.task.manage'] } }} />); await selectCourse(); expect(screen.getByRole('button', { name: 'Stop this admission course' })).toBeDisabled(); expect(screen.getByText(/Current permission allows course review. Changes require prescribing permission/)).toBeInTheDocument(); expect(screen.queryByText(/This connection has read-only access/)).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('preserves a stale copied review for explicit discard and never silently substitutes new CAS tokens', async () => {
  render(<Harness />); await prepare(); currentContext.context_token = 'f'.repeat(64); current.context_token = 'f'.repeat(64); current.source_token = 'e'.repeat(64); fireEvent.click(screen.getByRole('button', { name: 'Refresh current access and course' })); await screen.findByText(/The admission changed after this review/); expect(screen.getByRole('button', { name: 'Confirm admission-course stop' })).toBeDisabled(); expect(screen.getByText(/Reason: Synthetic reviewed admission-local stop/)).toBeInTheDocument(); expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Discard course change' })); await screen.findByText('Synthetic private source instructions'); expect(screen.queryByText(/Reason: Synthetic reviewed admission-local stop/)).not.toBeInTheDocument();
});
it('honors fresh action eligibility even when its non-authority CAS tokens did not change', async () => {
  render(<Harness />); await prepare('window'); current.can_request_schedule_window = false; current.window_unavailable_reason = 'window_elapsed'; current.supply_window_constraints = null; fireEvent.click(screen.getByRole('button', { name: 'Refresh current access and course' })); await screen.findByText(/recorded schedule boundary has elapsed/); expect(screen.getByRole('button', { name: 'Create reviewed schedule window' })).toBeDisabled(); expect(writes).toHaveLength(0);
});
it('permits explicit local retirement of a changed or terminal source without offering schedule expansion', async () => {
  current.source_matches_course = false; current.summary.source_status = 'completed'; current.can_request_schedule_window = false; current.window_unavailable_reason = 'source_changed'; current.supply_window_constraints = null;
  render(<Harness />); await save(); await screen.findByText('This admission course was stopped.'); expect(screen.getByText(/completed · unchanged by this admission-local stop/)).toBeInTheDocument(); expect(writes).toHaveLength(1);
});
it('does not render an old admission detail that finishes after explicit selection changes', async () => {
  const view = render(<Harness host />); await screen.findByRole('button', { name: /Synthetic reviewed medication/ }); let resolve; pendingDetail = { promise: new Promise((done) => { resolve = done; }) }; fireEvent.click(screen.getByRole('button', { name: /Synthetic reviewed medication/ })); await waitFor(() => expect(requests.some(({ url }) => url.pathname.endsWith(`/medication-courses/${current.summary.id}`))).toBe(true));
  pendingDetail = null; current.source_instructions = 'Synthetic new selected admission instructions'; view.rerender(<Harness host selected={otherCaseId} />); fireEvent.click(await screen.findByRole('button', { name: /Synthetic reviewed medication/ })); await screen.findByText('Synthetic new selected admission instructions'); await act(async () => resolve(json({ data: detail() }))); expect(screen.queryByText('Synthetic private source instructions')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('locks course selection during fresh review and never opens a closed/reopened late review automatically', async () => {
  const view = render(<Harness host />); await selectCourse(); let resolve; pendingDetail = { promise: new Promise((done) => { resolve = done; }) }; fireEvent.click(screen.getByRole('button', { name: 'Stop this admission course' })); await screen.findByText('Refreshing the admission and source course before review…'); expect(screen.getByRole('button', { name: /Synthetic reviewed medication/ })).toBeDisabled();
  view.rerender(<Harness host open={false} />); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); view.rerender(<Harness host />); pendingDetail = null; await act(async () => resolve(json({ data: detail() }))); await screen.findByText('Synthetic private source instructions'); expect(screen.queryByLabelText('Reason for stopping this admission course')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('never renders a retained clinical review before the new open-cycle access read returns403', async () => {
  const view = render(<Harness host />); await prepare(); view.rerender(<Harness host open={false} />); const original = fetch.getMockImplementation(); let resolve; const pending = new Promise((done) => { resolve = done; }); fetch.mockImplementation((input, options) => new URL(input).pathname.endsWith('/context') ? pending : original(input, options));
  view.rerender(<Harness host />); expect(screen.queryByText(/Reason: Synthetic reviewed admission-local stop/)).not.toBeInTheDocument(); expect(screen.queryByText('Synthetic private source instructions')).not.toBeInTheDocument(); await act(async () => resolve(json({ error: { code: 'patient_access_denied', message: 'Synthetic revoked case relationship' } }, 403))); await screen.findByText('Medication courses unavailable'); expect(screen.queryByText(/Reason: Synthetic reviewed admission-local stop/)).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it.each(['doses', 'supply'])('starts %s history on its first page when switching generated courses', async (kind) => {
  const firstId = current.summary.id; const secondId = ids[24]; const original = fetch.getMockImplementation();
  currentContext.generated_course_count = 2;
  fetch.mockImplementation((input, options) => {
    const url = new URL(input); const path = url.pathname;
    if (path.endsWith('/medication-courses')) return json({ data: [current.summary, { ...current.summary, id: secondId, medication_name: 'Synthetic second medication' }], page: { has_next: false, next_cursor: null } });
    if (path.endsWith(`/${secondId}`)) return json({ data: { ...current, summary: { ...current.summary, id: secondId, medication_name: 'Synthetic second medication' } } });
    if (path.endsWith(`/${kind}`)) {
      requests.push({ url, options });
      const first = path.includes(`/${firstId}/`); const next = first && !url.searchParams.has('cursor');
      return json({ data: [kind === 'doses' ? dose() : supply()], page: { has_next: next, next_cursor: next ? 'synthetic-first-course-page2' : null } });
    }
    return original(input, options);
  });
  render(<Harness />); await selectCourse();
  if (kind === 'supply') fireEvent.mouseDown(screen.getByRole('tab', { name: 'Supply requests' }), { button: 0, ctrlKey: false });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next history page' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Next history page' }));
  await screen.findByText('Page 2 · total pages unknown'); await waitFor(() => expect(screen.getByRole('button', { name: 'Next history page' })).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: /Synthetic second medication/ })); await screen.findByText('Synthetic private source instructions');
  if (kind === 'supply') fireEvent.mouseDown(screen.getByRole('tab', { name: 'Supply requests' }), { button: 0, ctrlKey: false });
  await waitFor(() => expect(requests.some(({ url }) => url.pathname.endsWith(`/${secondId}/${kind}`))).toBe(true));
  expect(requests.filter(({ url }) => url.pathname.endsWith(`/${secondId}/${kind}`)).every(({ url }) => !url.searchParams.has('cursor'))).toBe(true);
  expect(screen.getByText('Page 1 · total pages unknown')).toBeInTheDocument(); expect(writes).toHaveLength(0);
});
