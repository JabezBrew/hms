import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import PatientHandoverPanel from '../PatientHandoverPanel';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import { ids, patientId, admissionId, actorId, detail, current, narrative, receipt, json, page } from './fixtures';
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
let user; let readOnly; let server; let writes; let mode; let saved; let denyDetail; let failList; let listCalls; let pendingResolve; let client;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user }) }));
vi.mock('@/contexts/ReadOnlyModeContext', () => ({ useReadOnlyMode: () => readOnly }));
vi.mock('@/features/patients/components/MobileWorkspaceContextDock', () => ({ default: () => null }));
function serve(url, options = {}) {
  const parsed = new URL(url); const path = parsed.pathname;
  if (options.method === 'POST') {
    const body = JSON.parse(options.body); writes.push(body);
    const kind = path.endsWith('/amend') ? 'amend' : path.endsWith('/void') ? 'void' : 'record';
    saved = receipt({ kind, payload: body, source: server, patientId, admissionId, actorId });
    server = structuredClone(saved.handover);
    if (mode === 'lost' || mode === 'missing') return Promise.reject(new TypeError('Synthetic lost response'));
    if (mode === 'generic409') return Promise.resolve(json({ error: { code: 'patient_handover_write_unconfirmed' } }, 409));
    if (mode === 'pending') return new Promise((resolve) => { pendingResolve = () => resolve(json({ data: saved })); });
    if (mode === 'refresh-fails') failList = true;
    return Promise.resolve(json({ data: saved }));
  }
  if (path.endsWith('/recipients')) return Promise.resolve(page([]));
  if (path.includes('/requests/')) return Promise.resolve(mode === 'missing' ? json({ error: { code: 'not_found' } }, 404) : json({ data: { ...saved, replayed: true } }));
  if (path.endsWith('/history')) return Promise.resolve(page([{ ...current, narrative: undefined, reason: undefined }]));
  if (path.includes('/revisions/')) return Promise.resolve(json({ data: current }));
  if (path.endsWith('/patient-handovers')) { listCalls += 1; return Promise.resolve(failList ? json({ error: { code: 'unavailable' } }, 503) : page([server])); }
  return Promise.resolve(denyDetail ? json({ error: { code: 'forbidden' } }, 403) : json({ data: server }));
}
beforeEach(() => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-handover-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  user = { id: actorId, adminAccess: { capabilities: ['nursing.task.manage'] }, accessContext: { permission_version: 1, session_version: 1, features: ['nursing'], patient_visibility: ['full_clinical'] } };
  readOnly = { isReadOnly: false }; server = structuredClone(detail); writes = []; saved = null; mode = 'saved'; denyDetail = false; failList = false; listCalls = 0; pendingResolve = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 1 } } });
  globalThis.fetch = vi.fn(serve);
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
const patient = { id: patientId, name: 'Synthetic Patient', code: 'SYNTHETIC-IDENTIFIER', current_admission_id: admissionId };
const proof = { can_view_full_clinical: true, can_add_note: true, can_record_vitals: true, can_prescribe: true };
function mount({ host = false, open = true, clinicalPermissions = proof } = {}) {
  let props = { open, onClose: vi.fn(), patient, admission: { id: admissionId }, clinicalPermissions };
  const wrap = () => <QueryClientProvider client={client}><MemoryRouter>{host ? <ChronicleWorkspaceHost activeWorkspace={props.open ? 'handover' : null} workspaceContext={{ patient: props.patient, selectedAdmissionId: props.selectedAdmissionId, onClose: props.onClose, clinicalPermissions: props.clinicalPermissions }} /> : <PatientHandoverPanel {...props} />}</MemoryRouter></QueryClientProvider>;
  const result = render(wrap());
  return { ...result, close: props.onClose, update(next) { props = { ...props, ...next }; result.rerender(wrap()); } };
}
async function reviewNew() {
  const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: 'Record handover' }));
  fireEvent.change(screen.getByLabelText('Shift'), { target: { value: 'night' } });
  const fields = ['Current condition (required)', 'Ongoing issues (optional)', 'Pending tasks for the next shift (optional)', 'Medication changes (optional)', 'Key events (optional)', 'Care plan updates (optional)', 'Family communication (optional)'];
  for (const [index, name] of fields.entries()) fireEvent.change(screen.getByLabelText(name), { target: { value: Object.values(narrative)[index] } });
  await events.click(screen.getByRole('button', { name: 'Review handover change' }));
  expect(screen.getByRole('button', { name: 'Save reviewed handover' })).toBeDisabled();
  await events.click(screen.getByLabelText('I confirmed this patient and admission and reviewed every field.'));
  return events;
}
async function save(events) { await events.click(screen.getByRole('button', { name: 'Save reviewed handover' })); }
it('records all seven explicit fields only after patient review and shows immutable saved evidence', async () => {
  mount(); const events = await reviewNew(); expect(writes).toHaveLength(0); await save(events);
  await screen.findByText(/Handover change saved/); expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ patient_id: patientId, admission_case_id: admissionId, narrative });
  expect(screen.getByRole('region', { name: 'Original saved result' })).toBeInTheDocument(); expect(screen.getByText(/does not confirm delivery or acknowledgment/)).toBeInTheDocument(); expect(writes[0]).not.toHaveProperty('author_user_id');
});
it.each(['lost', 'generic409'])('keeps an exact unknown %s command across actual Host close and original-result recovery', async (failure) => {
  mode = failure; const panel = mount({ host: true }); const events = await reviewNew(); await save(events); await screen.findByRole('button', { name: 'Check original saved result' }); const original = structuredClone(writes[0]);
  panel.update({ open: false }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByText(narrative.patient_condition)).not.toBeInTheDocument(); const reads = globalThis.fetch.mock.calls.length;
  await act(async () => { await Promise.resolve(); }); expect(globalThis.fetch).toHaveBeenCalledTimes(reads);
  panel.update({ open: true }); await screen.findByRole('button', { name: 'Check original saved result' }); await events.click(screen.getByRole('button', { name: 'Check original saved result' })); await screen.findByText(/Handover change saved/); expect(writes).toEqual([original]);
});
it('does not replace an unknown command after a missing lookup and exact retry reuses UUID and body', async () => {
  mode = 'missing'; mount(); const events = await reviewNew(); await save(events); await screen.findByRole('button', { name: 'Check original saved result' }); const original = structuredClone(writes[0]);
  await events.click(screen.getByRole('button', { name: 'Check original saved result' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Retry exact handover change' })).toBeEnabled()); expect(writes).toHaveLength(1); expect(screen.queryByLabelText('Current condition (required)')).not.toBeInTheDocument();
  mode = 'saved'; await events.click(screen.getByRole('button', { name: 'Retry exact handover change' })); await screen.findByText(/Handover change saved/); expect(writes).toEqual([original, original]);
});
it('blocks Escape and duplicate submission while a write is pending', async () => {
  mode = 'pending'; const panel = mount(); const events = await reviewNew(); await save(events); await waitFor(() => expect(pendingResolve).toBeTypeOf('function')); await events.keyboard('{Escape}'); expect(panel.close).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(screen.getAllByRole('button', { name: 'Close', exact: true }).some((button) => button.disabled)).toBe(true); await events.click(screen.getAllByRole('button', { name: 'Close', exact: true }).find((button) => !button.disabled)); expect(panel.close).not.toHaveBeenCalled(); expect(writes).toHaveLength(1);
  await act(async () => pendingResolve()); await screen.findByText(/Handover change saved/); expect(writes).toHaveLength(1);
});
it('retains known saved status when a later list refresh fails and recovers the original receipt', async () => {
  mode = 'refresh-fails'; mount(); const events = await reviewNew(); await save(events); await screen.findByText(/The last reviewed change was saved/); expect(writes).toHaveLength(1); expect(screen.queryByText(narrative.patient_condition)).not.toBeInTheDocument(); failList = false; await events.click(screen.getByRole('button', { name: 'Refresh handovers' })); await screen.findByText(/Handover change saved/); expect(writes).toHaveLength(1);
});
it('keeps historical void evidence reachable and expands one immutable revision', async () => {
  server.status = 'voided'; server.current.kind = 'voided'; mount(); const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: /2026-10-16.*night/ })); await screen.findByText('Voided report. Original and correction evidence remain in history.'); expect(screen.queryByRole('button', { name: 'Correct handover' })).not.toBeInTheDocument(); await events.click(screen.getByRole('button', { name: 'Review history' })); await events.click(await screen.findByRole('button', { name: 'Review revision 1 · recorded' })); await screen.findByRole('region', { name: 'Historical evidence' });
});
it('hides cached narrative immediately when the current detail read is denied', async () => {
  mount(); const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: /2026-10-16.*night/ })); await screen.findByText(narrative.patient_condition); denyDetail = true; await act(async () => { await client.invalidateQueries(); }); await screen.findByText(/Current ward assignment and full clinical access could not be confirmed/); expect(screen.queryByText(narrative.patient_condition)).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Correct handover' })).not.toBeInTheDocument();
});
it.each(['patient', 'admission', 'authority', 'capability', 'proof'])('discards copied narrative on %s change instead of exposing another context', async (change) => {
  const panel = mount(); await reviewNew(); expect(screen.getByText(narrative.patient_condition)).toBeInTheDocument();
  if (change === 'patient') panel.update({ patient: { ...patient, id: ids[8] } });
  if (change === 'admission') panel.update({ admission: { id: ids[9] } });
  if (change === 'authority') { user = { ...user, accessContext: { ...user.accessContext, permission_version: 2 } }; panel.update({}); }
  if (change === 'capability') { user = { ...user, adminAccess: { capabilities: [] } }; panel.update({}); }
  if (change === 'proof') panel.update({ clinicalPermissions: { ...proof, can_view_full_clinical: false } });
  expect(screen.queryByText(narrative.patient_condition)).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Save reviewed handover' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('keeps unopened Host handover lazy and mounted closed reads disabled', async () => {
  const panel = mount({ host: true, open: false }); await act(async () => { await Promise.resolve(); }); expect(globalThis.fetch).not.toHaveBeenCalled(); panel.update({ open: true }); await screen.findByRole('button', { name: 'Record handover' }); expect(listCalls).toBe(1); panel.update({ open: false }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); await act(async () => { await client.invalidateQueries(); }); expect(listCalls).toBe(1);
});
it('does not mount or fetch a raw direct-query handover when authoritative full access is false or unknown', async () => {
  const panel = mount({ host: true, clinicalPermissions: null }); await screen.findByText('Clinical workspace unavailable'); expect(globalThis.fetch).not.toHaveBeenCalled(); panel.update({ clinicalPermissions: { can_view_full_clinical: false } }); expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('clears the retained Host controller when full clinical proof is withdrawn and restored', async () => {
  mode = 'lost'; const panel = mount({ host: true }); const events = await reviewNew(); await save(events); await screen.findByRole('button', { name: 'Check original saved result' });
  panel.update({ clinicalPermissions: { can_view_full_clinical: false } }); await screen.findByText('Clinical workspace unavailable'); expect(screen.queryByText(narrative.patient_condition)).not.toBeInTheDocument();
  panel.update({ clinicalPermissions: proof }); await screen.findByRole('button', { name: 'Record handover' }); expect(screen.queryByRole('button', { name: 'Retry exact handover change' })).not.toBeInTheDocument(); expect(screen.queryByText(narrative.patient_condition)).not.toBeInTheDocument(); expect(writes).toHaveLength(1);
});
it('moves current-admission/all-history and voided scope to the server without filtering first pages', async () => {
  mount(); const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: 'All patient handover history' })); await screen.findByRole('button', { name: 'Selected admission history' });
  await events.click(screen.getByRole('button', { name: 'Show voided reports' })); await screen.findByRole('button', { name: 'Hide voided reports' });
  const reads = globalThis.fetch.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname.endsWith('/patient-handovers'));
  expect(reads[0].searchParams.get('admission_case_id')).toBe(admissionId); expect(reads.at(-1).searchParams.has('admission_case_id')).toBe(false); expect(reads.at(-1).searchParams.get('include_voided')).toBe('true'); expect(reads.every((url) => url.searchParams.get('patient_id') === patientId)).toBe(true);
});
it('uses the real adapted Chronicle medical_record_number in the explicit patient confirmation', async () => {
  const panel = mount(); panel.update({ patient: { name: 'Synthetic Patient', local_data: { id: patientId, medical_record_number: 'SYNTHETIC-ACTUAL-SHAPE' } } }); await reviewNew(); expect(screen.getAllByText(/Synthetic Patient · SYNTHETIC-ACTUAL-SHAPE/).length).toBeGreaterThan(0); expect(screen.queryByText(/Patient identifier unavailable/)).not.toBeInTheDocument();
});

it('keeps actual Host lost-response retry bound to its original command through the real durable guard', async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const principal={id:actorId,facility_id:ids[10],active_profile:'hospital'};
  const bind=()=>{const guard=bindNetworkAccessGuard({transportScope:getV2ClientScopeKey(),authorityScope:'synthetic-handover-authority',principal});guard.update({confirmed:true,decision:{access_allowed:true,read_only:false,classification:'onsite',policy_version:1}});activateWriteUncertainty(principal);};bind();
  mode='lost';const panel=mount({host:true});const events=await reviewNew();await save(events);await screen.findByRole('button',{name:'Retry exact handover change'});const original=structuredClone(writes[0]);expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  panel.update({open:false});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();bind();panel.update({open:true});await screen.findByRole('button',{name:'Retry exact handover change'});
  mode='saved';await events.click(screen.getByRole('button',{name:'Retry exact handover change'}));await screen.findByText(/Handover change saved/);expect(writes).toEqual([original,original]);expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});

it('binds retained Host command state to the selected Chronicle admission, not only current_admission_id',async()=>{
  const panel=mount({host:true});await reviewNew();expect(screen.getByText(narrative.patient_condition)).toBeInTheDocument();
  server={...server,admission_case_id:ids[9]};panel.update({selectedAdmissionId:ids[9]});expect(screen.queryByText(narrative.patient_condition)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Save reviewed handover'})).not.toBeInTheDocument();
  await screen.findByRole('button',{name:'Record handover'});
  const reads=globalThis.fetch.mock.calls.map(([url])=>new URL(url)).filter((url)=>url.pathname.endsWith('/patient-handovers'));expect(reads.at(-1).searchParams.get('admission_case_id')).toBe(ids[9]);expect(writes).toHaveLength(0);
});
