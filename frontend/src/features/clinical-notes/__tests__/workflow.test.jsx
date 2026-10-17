import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import AddNoteSlideOver from '@/components/chronicle/AddNoteSlideOver';
import NoteDetailModal from '@/components/chronicle/NoteDetailModal';
import { NotePatientContext } from '../NotePatientContext';
import RustTemplateCatalogPage from '../pages/RustTemplateCatalogPage';
import { body, command, detail, history, actorId, admissionId, encounterId, facilityId, ids, json, noteId, page, patientId, receipt, revision, template, versionId } from './fixtures';

vi.mock('@/features/patients/components/MobileWorkspaceContextDock', () => ({ default: () => null }));
const originalRuntime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
const proof = { can_view_full_clinical: true, can_add_note: true, can_record_vitals: true, can_prescribe: true };
const patient = { name: 'Synthetic Patient', local_data: { id: patientId, medical_record_number: 'SYNTHETIC-MRN' } };
let user; let server; let currentTemplate; let mode; let saved; let writes; let deny; let denyHistory; let denyVersion; let pendingResolve; let pendingReject; let client;
function serve(url, options = {}) {
  const parsed = new URL(url); const path = parsed.pathname;
  if (options.method === 'POST') {
    const payload = JSON.parse(options.body); writes.push({ path, payload });
    if (mode === 'conflict') return Promise.resolve(json({ error: { code: 'clinical_note_source_changed', message: 'Reload the current note before amending.' } }, 409));
    const kind = path.endsWith('/amendments') ? 'amend' : path.includes('/note-templates/') ? path.endsWith('/changes') ? 'templateChange' : 'templateRecord' : 'record';
    const original = { ...command(kind), payload, source: kind === 'amend' ? server : kind === 'templateChange' ? currentTemplate : null, patientId, actorId: user.id };
    saved = receipt(original); if (saved.note) server = { ...saved.note, can_amend: true }; else currentTemplate = { ...saved.template, can_manage: true };
    if (mode === 'lost' || mode === 'missing' || mode === 'malformed-lookup') return Promise.reject(new TypeError('Synthetic lost response'));
    if (mode === 'pending') return new Promise((resolve, reject) => { pendingResolve = () => resolve(json({ data: saved })); pendingReject = () => reject(new TypeError('Synthetic late failure')); });
    return Promise.resolve(json({ data: mode === 'malformed2xx' ? { ...saved, note: { ...saved.note, body: 'Different synthetic receipt' } } : saved }));
  }
  if (path.includes('/note-requests/') || path.includes('/note-templates/requests/')) {
    if (mode === 'missing') return Promise.resolve(json({ error: { code: 'not_found' } }, 404));
    return Promise.resolve(json({ data: mode === 'malformed-lookup' ? { ...saved, note: { ...saved.note, body: 'Different synthetic receipt' } } : saved }));
  }
  if (path.endsWith(`/clinical/notes/${noteId}`)) return Promise.resolve(deny ? json({ error: { code: 'patient_access_denied' } }, 403) : json({ data: server }));
  if (path.endsWith('/history')) return Promise.resolve(denyHistory ? json({ error: { code: 'patient_access_denied' } }, 403) : page([history], parsed.searchParams.get('cursor') ? null : 'older-page'));
  if (path.includes('/versions/')) return Promise.resolve(denyVersion ? json({ error: { code: 'patient_access_denied' } }, 403) : json({ data: { ...history, body: 'Synthetic immutable historical narrative' } }));
  if (path.endsWith('/note-templates')) { const activity = parsed.searchParams.get('activity'); const excluded = (activity === 'active' && !currentTemplate.is_active) || (activity === 'inactive' && currentTemplate.is_active); const rows = parsed.searchParams.get('search') === 'no match' || excluded ? [] : [currentTemplate]; return Promise.resolve(page(rows, !rows.length || parsed.searchParams.get('cursor') ? null : 'next-template-page')); }
  if (path.includes('/note-templates/')) return Promise.resolve(json({ data: currentTemplate }));
  return Promise.resolve(json({ error: { code: 'not_found' } }, 404));
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  user = { id: actorId, facilityCode: 'HMS', adminAccess: { capabilities: ['clinical_documentation.view', 'clinical_documentation.manage'] }, accessContext: { facility_id: facilityId, active_profile: 'hospital', permission_version: 1, features: ['encounters'], patient_visibility: ['full_clinical'] } };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-NOTE-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' }; const guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal }); guard.update({ confirmed: true, decision: { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 } }); activateWriteUncertainty(principal);
  server = structuredClone(detail); currentTemplate = structuredClone(template); mode = 'saved'; saved = null; writes = []; deny = false; denyHistory = false; denyVersion = false; pendingResolve = null; pendingReject = null; globalThis.fetch = vi.fn(serve); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } } });
});
afterEach(() => { client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; });
function mount(kind = 'new', initial = {}) {
  let props = { open: true, patient, encounter: { id: encounterId, status: 'in-progress', v2_status: 'in_progress' }, admissionId, clinicalPermissions: proof, ...initial }; const close = vi.fn();
  const tree = () => <MemoryRouter><HelmetProvider><BreadcrumbProvider><QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 } }}><ChronicleClinicalPermissionsContext.Provider value={props.clinicalPermissions}><NotePatientContext.Provider value={{ id: props.patient.local_data?.id || props.patient.id, name: props.patient.name, code: props.patient.local_data?.medical_record_number || 'SYNTHETIC-MRN', encounterId: props.encounter.id, encounterStatus: props.encounter.v2_status || props.encounter.status, admissionId: props.admissionId }}>{kind === 'catalog' ? <RustTemplateCatalogPage /> : kind === 'detail' ? <NoteDetailModal open={props.open} onOpenChange={(value) => { if (!value) close(); }} entry={{ id: noteId, patient_id: patientId, type: 'doctor_note', entry_type: 'note', title: 'Synthetic lean startup title' }} /> : kind === 'host' ? <ChronicleWorkspaceHost activeWorkspace={props.open ? 'note' : null} workspaceContext={{ ...props, patientId, activeEncounter: props.encounter, selectedEncounter: props.encounter, selectedEncounterId: props.encounter.id, selectedAdmissionId: props.admissionId, onClose: close }} /> : <AddNoteSlideOver {...props} onClose={close} />}</NotePatientContext.Provider></ChronicleClinicalPermissionsContext.Provider></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider></BreadcrumbProvider></HelmetProvider></MemoryRouter>;
  const view = render(tree()); return { close, unmount: view.unmount, update(next) { props = { ...props, ...next }; view.rerender(tree()); } };
}
async function reviewNew() { const events = userEvent.setup(); fireEvent.change(await screen.findByLabelText('Note title'), { target: { value: 'Synthetic reviewed note' } }); fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'SYNTHETIC-PRIVATE-LOCAL-DRAFT' } }); await events.click(screen.getByRole('button', { name: 'Review note before saving' })); await events.click(screen.getByLabelText('I confirmed this patient and reviewed the complete note.')); return events; }
it('opens real protected content from a lean startup entry and loads historical bodies only on selection', async () => {
  mount('detail'); await screen.findByText(body); expect(screen.queryByText('Synthetic lean startup title')).not.toBeInTheDocument(); expect(globalThis.fetch.mock.calls.some(([url]) => url.includes('/versions/'))).toBe(false);
  const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: /Version 1 ·/ })); await screen.findByText('Synthetic immutable historical narrative'); expect(globalThis.fetch.mock.calls.filter(([url]) => url.includes(`/versions/${versionId}`))).toHaveLength(1);
  await events.click(screen.getByRole('button', { name: 'Older versions' })); await waitFor(() => expect(globalThis.fetch.mock.calls.some(([url]) => url.includes('cursor=older-page'))).toBe(true));
});
it('waits for a fresh read and hides cached full content on a current denial', async () => {
  const first = mount('detail'); await screen.findByText(body); const cachedKey = client.getQueryCache().getAll().find((query) => query.queryKey.includes('detail') && query.state.data?.id === noteId).queryKey; first.unmount(); client.setQueryData(cachedKey, detail); deny = true; mount('detail'); expect(screen.queryByText(body)).not.toBeInTheDocument(); await screen.findByText('Note access denied'); expect(screen.queryByText(body)).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Amend recorded note' })).not.toBeInTheDocument();
});
it('hides previously loaded note content if a later protected history read is denied', async () => {
  mount('detail'); await screen.findByText(body); denyHistory = true; await act(async () => { await client.invalidateQueries({ predicate: (query) => query.queryKey.includes('history') }); }); await screen.findByText('Note access denied'); expect(screen.queryByText(body)).not.toBeInTheDocument();
});
it('hides current body and actions if an expanded historical version is denied', async () => {
  mount('detail'); await screen.findByText(body); denyVersion = true; const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: /Version 1 ·/ })); await screen.findByText('Note access denied'); expect(screen.queryByText(body)).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Amend recorded note' })).not.toBeInTheDocument();
});
it('appends an explicit reviewed amendment with current version and reason', async () => {
  mount('detail'); const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: 'Amend recorded note' })); fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'Synthetic corrected narrative' } }); fireEvent.change(screen.getByLabelText('Reason for amendment'), { target: { value: '  Synthetic correction reason  ' } }); await events.click(screen.getByRole('button', { name: 'Review note before saving' })); await events.click(screen.getByLabelText('I confirmed this patient and reviewed the complete note.')); await events.click(screen.getByRole('button', { name: 'Save reviewed amendment' })); await screen.findByText(/Note saved/);
  expect(writes).toHaveLength(1); expect(writes[0].payload).toMatchObject({ expected_version: 1, reason: 'Synthetic correction reason', body: 'Synthetic corrected narrative' }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('uses current server amendment capability rather than inferring it from management permission', async () => {
  server.can_amend = false; mount('detail'); await screen.findByText(body); expect(screen.queryByRole('button', { name: 'Amend recorded note' })).not.toBeInTheDocument(); expect(screen.getByText(/Amendment requires current author/)).toBeInTheDocument();
});
it.each(['lost', 'missing', 'malformed-lookup', 'malformed2xx'])('preserves an uncertain %s command across actual Host close/reopen and never invents a fresh request', async (failure) => {
  mode = failure; const panel = mount('host'); const events = await reviewNew(); await events.click(screen.getByRole('button', { name: 'Save reviewed note' })); await screen.findByRole('button', { name: 'Check original saved result' }); const original = structuredClone(writes[0]);
  panel.update({ open: false }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByText('SYNTHETIC-PRIVATE-LOCAL-DRAFT')).not.toBeInTheDocument(); const before = globalThis.fetch.mock.calls.length; await act(async () => { await client.invalidateQueries(); }); expect(globalThis.fetch).toHaveBeenCalledTimes(before);
  panel.update({ open: true }); await events.click(await screen.findByRole('button', { name: 'Check original saved result' }));
  if (failure === 'lost' || failure === 'malformed2xx') { await screen.findByText(/Note saved/); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0); }
  else { await waitFor(() => expect(screen.getByRole('button', { name: 'Retry exact note change' })).toBeEnabled()); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(screen.queryByLabelText('Note title')).not.toBeInTheDocument(); mode = 'saved'; await events.click(screen.getByRole('button', { name: 'Check original saved result' })); await screen.findByText(/Note saved/); }
  expect(writes).toEqual([original]);
});
it('keeps a local unsaved draft without rendering it in the closed Host or claiming it was saved', async () => {
  const panel = mount('host'); fireEvent.change(await screen.findByLabelText('Note title'), { target: { value: 'Synthetic unsaved title' } }); fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'SYNTHETIC-UNSAVED-TEXT' } }); expect(screen.queryByRole('button', { name: 'Save Draft' })).not.toBeInTheDocument(); expect(screen.getByText(/Unsaved text stays only/)).toBeInTheDocument();
  panel.update({ open: false }); expect(screen.queryByDisplayValue('SYNTHETIC-UNSAVED-TEXT')).not.toBeInTheDocument(); panel.update({ open: true }); await screen.findByDisplayValue('SYNTHETIC-UNSAVED-TEXT'); expect(writes).toHaveLength(0);
});
it('preserves an authorized pure note draft across same-ward bed revisions, then discards it on a ward-context change', async () => {
  const panel = mount('host', { selectedWardId: ids[21], selectedPlacementRevision: 4 });
  fireEvent.change(await screen.findByLabelText('Note title'), { target: { value: 'Synthetic long unsaved note' } });
  fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'SYNTHETIC-SAME-WARD-DRAFT' } });
  panel.update({ selectedPlacementRevision: 5 });
  expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('SYNTHETIC-SAME-WARD-DRAFT');
  panel.update({ selectedWardId: ids[22], selectedPlacementRevision: 6 });
  await waitFor(() => expect(screen.queryByDisplayValue('SYNTHETIC-SAME-WARD-DRAFT')).not.toBeInTheDocument());
  expect(writes).toHaveLength(0);
});
it('retains exact unknown note intent across same-ward physical change and leaves only opaque recovery after ward loss', async () => {
  mode = 'lost'; const panel = mount('host', { selectedWardId: ids[21], selectedPlacementRevision: 4 }); const events = await reviewNew();
  await events.click(screen.getByRole('button', { name: 'Save reviewed note' })); await screen.findByRole('button', { name: 'Retry exact note change' });
  const original = structuredClone(writes[0]); panel.update({ selectedPlacementRevision: 5 });
  expect(screen.getByRole('button', { name: 'Retry exact note change' })).toBeEnabled(); expect(screen.getByText('SYNTHETIC-PRIVATE-LOCAL-DRAFT')).toBeInTheDocument();
  panel.update({ selectedWardId: ids[22], selectedPlacementRevision: 6 });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry exact note change' })).not.toBeInTheDocument());
  expect(screen.queryByText('SYNTHETIC-PRIVATE-LOCAL-DRAFT')).not.toBeInTheDocument(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(writes).toEqual([original]);
});
it('blocks Escape, top close and duplicate save while a real POST is pending', async () => {
  mode = 'pending'; const panel = mount(); const events = await reviewNew(); await events.click(screen.getByRole('button', { name: 'Save reviewed note' })); await waitFor(() => expect(pendingResolve).toBeTypeOf('function')); await events.keyboard('{Escape}'); expect(panel.close).not.toHaveBeenCalled(); await events.click(screen.getAllByRole('button', { name: 'Close', exact: true }).find((button) => !button.disabled)); expect(panel.close).not.toHaveBeenCalled(); expect(writes).toHaveLength(1); await act(async () => pendingResolve()); await screen.findByText(/Note saved/);
});
it.each(['resolve', 'reject'])('suppresses a late %s after an actor switch rather than publishing old note feedback', async (outcome) => {
  mode = 'pending'; const panel = mount('host'); const events = await reviewNew(); await events.click(screen.getByRole('button', { name: 'Save reviewed note' })); await waitFor(() => expect(pendingResolve).toBeTypeOf('function')); user = { ...user, id: ids[20] }; panel.update({}); expect(screen.queryByText('SYNTHETIC-PRIVATE-LOCAL-DRAFT')).not.toBeInTheDocument(); await act(async () => { if (outcome === 'resolve') pendingResolve(); else pendingReject(); }); expect(screen.queryByText(/Note saved/)).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Retry exact note change' })).not.toBeInTheDocument(); expect(writes).toHaveLength(1);
});
it('requires an active explicitly selected encounter for new notes while preserving historical amendment', async () => {
  const panel = mount('host', { encounter: { id: encounterId, v2_status: 'completed', status: 'finished' } }); await screen.findByText('Selected encounter unavailable for new notes'); expect(screen.queryByLabelText('Note title')).not.toBeInTheDocument(); expect(globalThis.fetch).not.toHaveBeenCalled(); panel.unmount(); mount('detail', { encounter: { id: encounterId, v2_status: 'completed', status: 'finished' } }); await screen.findByRole('button', { name: 'Amend recorded note' }); expect(screen.getByRole('button', { name: 'Use as a new note draft' })).toBeDisabled();
});
it.each(['patient', 'admission', 'permissions', 'proof', 'manage', 'visibility', 'feature'])('discards copied note values on a %s change', async (change) => {
  const panel = mount('host'); await reviewNew(); expect(screen.getByText('SYNTHETIC-PRIVATE-LOCAL-DRAFT')).toBeInTheDocument();
  if (change === 'patient') panel.update({ patient: { ...patient, local_data: { ...patient.local_data, id: ids[18] } } });
  if (change === 'admission') panel.update({ admissionId: ids[18] });
  if (change === 'permissions') { user = { ...user, accessContext: { ...user.accessContext, permission_version: 2 } }; panel.update({}); }
  if (change === 'proof') panel.update({ clinicalPermissions: { ...proof, can_view_full_clinical: false, can_add_note: false } });
  if (change === 'manage') { user = { ...user, adminAccess: { capabilities: ['clinical_documentation.view'] } }; panel.update({}); }
  if (change === 'visibility') { user = { ...user, accessContext: { ...user.accessContext, patient_visibility: ['clinical_summary'] } }; panel.update({}); }
  if (change === 'feature') { user = { ...user, accessContext: { ...user.accessContext, features: [] } }; panel.update({}); }
  expect(screen.queryByText('SYNTHETIC-PRIVATE-LOCAL-DRAFT')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Save reviewed note' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('keeps a confirmed receipt visible after a later refresh failure', async () => {
  vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('Synthetic refresh unavailable')); mount(); const events = await reviewNew(); await events.click(screen.getByRole('button', { name: 'Save reviewed note' })); await screen.findByText(/Note saved/); await screen.findByText(/save is confirmed, but the current timeline could not refresh/); expect(writes).toHaveLength(1); expect(screen.queryByRole('button', { name: 'Retry exact note change' })).not.toBeInTheDocument();
});
it('shows a stale-source conflict without automatic resubmission and offers an explicit current read', async () => {
  mode = 'conflict'; mount('detail'); const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: 'Amend recorded note' })); fireEvent.change(screen.getByLabelText('Reason for amendment'), { target: { value: 'Synthetic reason' } }); await events.click(screen.getByRole('button', { name: 'Review note before saving' })); await events.click(screen.getByLabelText('I confirmed this patient and reviewed the complete note.')); await events.click(screen.getByRole('button', { name: 'Save reviewed amendment' })); await screen.findByText(/Reload the current note before amending/); expect(writes).toHaveLength(1); expect(screen.queryByRole('button', { name: 'Retry exact note change' })).not.toBeInTheDocument(); await events.click(screen.getByRole('button', { name: 'Discard draft and reload current note' })); await screen.findByRole('button', { name: 'Amend recorded note' }); expect(writes).toHaveLength(1);
});
it('requires fresh template owner capability rather than a generic manage permission', async () => {
  currentTemplate.can_manage = false; mount('catalog'); const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: /Synthetic history template/ })); await screen.findByText(/Changes require current owner/); expect(screen.queryByRole('button', { name: 'Edit template and availability' })).not.toBeInTheDocument();
});
it('retains inactive templates and searches on the server without raw search text in query keys', async () => {
  currentTemplate.is_active = false; mount('catalog'); const events = userEvent.setup(); fireEvent.keyDown(screen.getByRole('combobox', { name: 'Availability' }), { key: 'ArrowDown' }); fireEvent.click(await screen.findByRole('option', { name: 'Inactive', exact: true })); await screen.findByRole('button', { name: /Synthetic history template/ }); expect(globalThis.fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('activity') === 'inactive')).toBe(true);
  fireEvent.change(screen.getByLabelText('Search template titles'), { target: { value: 'no match' } }); await events.click(screen.getByRole('button', { name: 'Search templates' })); await screen.findByText('No templates match this page and search.'); expect(globalThis.fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('search') === 'no match')).toBe(true); expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain('no match');
});
it('preserves a pending template command across catalog dialog close and exact receipt recovery', async () => {
  mode = 'lost'; mount('catalog'); const events = userEvent.setup(); await events.click(screen.getByRole('button', { name: 'Create note template' })); fireEvent.change(screen.getByLabelText('Template title'), { target: { value: 'Synthetic new template' } }); await events.click(screen.getByRole('button', { name: 'Review template before saving' })); await events.click(screen.getByLabelText('I reviewed the complete template content and availability.')); await events.click(screen.getByRole('button', { name: 'Save reviewed template' })); await screen.findByRole('button', { name: 'Check original template result' }); const original = structuredClone(writes[0]); await events.click(screen.getAllByRole('button', { name: 'Close', exact: true }).at(0)); await screen.findByRole('button', { name: 'Review pending template change' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); await events.click(screen.getByRole('button', { name: 'Review pending template change' })); await events.click(screen.getByRole('button', { name: 'Check original template result' })); await screen.findByText(/Template revision saved/); expect(writes).toEqual([original]); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('selects a fresh exact revision without silently applying starter text, then saves manually reviewed content', async () => {
  mount(); const events = userEvent.setup(); await events.click(screen.getByRole('button', { name: 'Choose a template' })); await events.click(await screen.findByRole('button', { name: /Synthetic history template/ })); await events.click(await screen.findByRole('button', { name: 'Use this template revision' })); expect(screen.queryByDisplayValue('Synthetic starter')).not.toBeInTheDocument(); expect(screen.getByLabelText('Note title')).toHaveValue(template.title); fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: JSON.stringify({ assessment: 'Synthetic manually completed text' }) } }); await events.click(screen.getByRole('button', { name: 'Review note before saving' })); await events.click(screen.getByLabelText('I confirmed this patient and reviewed the complete note.')); await events.click(screen.getByRole('button', { name: 'Save reviewed note' })); await screen.findByText(/Note saved/); expect(writes[0].payload.template_revision_id).toBe(revision.id); expect(JSON.parse(writes[0].payload.body)).toEqual({ assessment: 'Synthetic manually completed text' });
});
it('uses real cursor/search/availability catalog reads and fresh owner capability for changes', async () => {
  mount('catalog'); const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: 'Next templates' })); await waitFor(() => expect(globalThis.fetch.mock.calls.some(([url]) => url.includes('cursor=next-template-page'))).toBe(true)); await events.click(screen.getByRole('button', { name: /Synthetic history template/ })); await events.click(await screen.findByRole('button', { name: 'Edit template and availability' })); expect(screen.getByLabelText('Template title')).toHaveValue(template.title); fireEvent.change(screen.getByLabelText('Template title'), { target: { value: 'Synthetic revised template' } }); await events.click(screen.getByRole('button', { name: 'Review template before saving' })); await events.click(screen.getByLabelText('I reviewed the complete template content and availability.')); await events.click(screen.getByRole('button', { name: 'Save reviewed template' })); await screen.findByText(/Template revision saved/); expect(writes[0].payload.expected_version).toBe(1); expect(writes[0].payload.title).toBe('Synthetic revised template');
});
it('shows malformed historical evidence read-only and saves an explicit unchanged deactivation', async () => {
  currentTemplate.body_template = '  [null]\n'; const raw = currentTemplate.body_template; mount('catalog'); const events = userEvent.setup();
  await events.click(await screen.findByRole('button', { name: /Synthetic history template/ })); await screen.findByRole('region', { name: 'Historical template evidence' });
  await events.click(screen.getByRole('button', { name: 'Deactivate historical template' })); expect(screen.queryByLabelText('Template title')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Template starter text')).not.toBeInTheDocument();
  expect(screen.getByText(/Proposed change: deactivate this historical template/)).toBeInTheDocument();
  await events.click(screen.getByRole('button', { name: 'Review template before saving' })); await events.click(screen.getByLabelText('I reviewed the complete template content and availability.')); await events.click(screen.getByRole('button', { name: 'Save reviewed template' })); await screen.findByText(/Template revision saved/);
  expect(writes).toHaveLength(1); expect(writes[0].payload).toMatchObject({ body_template: raw, is_active: false, expected_version: 1, title: template.title, note_type: template.note_type });
});
it('refuses malformed historical template selection without replacing a local draft', async () => {
  currentTemplate.body_template = JSON.stringify([{ section: 'Plan', required: 'yes' }]); mount(); const events = userEvent.setup();
  fireEvent.change(await screen.findByLabelText('Note', { exact: true }), { target: { value: 'Synthetic retained draft' } }); await events.click(screen.getByRole('button', { name: 'Choose a template' })); await events.click(await screen.findByRole('button', { name: /Synthetic history template/ }));
  expect(await screen.findByRole('button', { name: 'Use this template revision' })).toBeDisabled(); expect(screen.getByText(/historical template structure requires review/)).toBeInTheDocument(); expect(writes).toHaveLength(0);
  await events.click(screen.getByRole('button', { name: 'Back to templates' })); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Synthetic retained draft');
});
it('renders nontext historical starter metadata without coercion or a React child error', async () => {
  currentTemplate.body_template = JSON.stringify({ description: { preserved: true }, sections: [{ section: 'Assessment', default_text: { text: 'Synthetic raw starter' }, type: 'custom' }] }); mount('catalog'); const events = userEvent.setup();
  await events.click(await screen.findByRole('button', { name: /Synthetic history template/ })); await screen.findByText(/Original starter content is retained/); await events.click(screen.getByRole('button', { name: 'Edit template and availability' }));
  expect(screen.getByText(/existing starter content is preserved/)).toBeInTheDocument(); expect(screen.getByText(/existing description is kept/)).toBeInTheDocument(); expect(screen.queryByDisplayValue('[object Object]')).not.toBeInTheDocument();
});
