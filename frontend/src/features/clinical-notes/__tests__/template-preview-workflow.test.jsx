import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { ChronicleClinicalPermissionsContext } from '@/features/patients/chronicle/clinicalPermissions';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { actorId, encounterId, facilityId, ids, json, page, patientId, receipt, template } from './fixtures';
vi.mock('@/features/patients/components/MobileWorkspaceContextDock', () => ({ default: () => null }));
const runtime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
let user; let client; let previews; let writes; let mode; let resolvePending; let templates; let responsePatch; let readOnly; let guard;
const proof = { can_view_full_clinical: true, can_add_note: false, can_record_vitals: false, can_prescribe: false };
const makeResponse = (payload, id) => ({ patient_id: id, encounter_id: payload.encounter_id, template_id: payload.template_id, template_revision_id: payload.template_revision_id, template_revision_version: 1, rendered_on: '2026-10-17', date_basis: 'utc', kind: typeof responsePatch === 'string' ? 'plain' : 'structured', patch: responsePatch, applied_sections: typeof responsePatch === 'string' ? ['text'] : Object.keys(responsePatch), unresolved: [], unresolved_truncated: false });
function serve(url, options = {}) {
  const parsed = new URL(url); const path = parsed.pathname;
  if (path.endsWith('/note-template-previews')) {
    const payload = JSON.parse(options.body); previews.push({ path, payload }); const id = path.split('/')[4]; const response = makeResponse(payload, id);
    if (mode === 'invalid') return Promise.resolve(json({ error: { code: 'note_template_context_unavailable', message: 'Selected encounter unavailable for preview.' } }, 400));
    if (mode === 'denied') return Promise.resolve(json({ error: { code: 'patient_access_denied', message: 'Current patient access unavailable.' } }, 403));
    if (mode === 'pending') return new Promise((resolve) => { resolvePending = () => resolve(json({ data: response })); });
    return Promise.resolve(json({ data: response }));
  }
  if (options.method === 'POST') {
    writes.push({ path, body: options.body });
    if (mode === 'save' && path.endsWith('/clinical/notes/record')) { const payload = JSON.parse(options.body); const value = receipt({ kind: 'record', actorId: user.id, patientId, payload }); const source = templates[0]; value.note.template_revision = { id: source.current_revision_id, template_id: source.id, version: source.version, title: source.title, note_type: source.note_type, body_template: source.body_template }; return Promise.resolve(json({ data: value })); }
    return Promise.resolve(json({ error: { code: 'unexpected_write' } }, 400));
  }
  if (path.endsWith('/note-templates')) return Promise.resolve(page(templates));
  return Promise.resolve(json({ data: templates.find((item) => path.endsWith(item.id)) || template }));
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  user = { id: actorId, facilityCode: 'HMS', adminAccess: { capabilities: ['clinical_documentation.view'] }, accessContext: { facility_id: facilityId, active_profile: 'hospital', permission_version: 1, features: ['patients', 'encounters'], patient_visibility: ['full_clinical'] } };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-PREVIEW-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' }; guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal }); guard.update({ confirmed: true, decision: { access_allowed: true, read_only: true, classification: 'offsite', mode: 'read_only', policy_version: 1 } }); activateWriteUncertainty(principal);
  readOnly = true; client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } } }); mode = 'ready'; previews = []; writes = []; resolvePending = null; templates = [{ ...template, body_template: '{"sections":[{"section":"Assessment","default_text":"Hello {{patient_name}}"}]}' }]; responsePatch = { assessment: 'Synthetic server patient text · 2026-10-17' }; globalThis.fetch = vi.fn(serve);
});
afterEach(() => { client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount(initial = {}, workspace = 'noteTemplatePreview') {
  let context = { patient: { local_data: { id: patientId, medical_record_number: 'SYNTHETIC' }, name: 'Synthetic patient' }, selectedEncounter: { id: encounterId, v2_status: 'in_progress' }, selectedEncounterId: encounterId, selectedAdmissionId: ids[8], clinicalPermissions: proof, ...initial }; let open = true;
  const tree = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { access_allowed: true, read_only: readOnly, classification: readOnly ? 'offsite' : 'onsite', mode: 'read_only', policy_version: 1 } }}><ChronicleClinicalPermissionsContext.Provider value={context.clinicalPermissions}><ChronicleWorkspaceHost activeWorkspace={open ? workspace : null} workspaceContext={{ ...context, onClose: () => { open = false; view.rerender(tree()); } }} /></ChronicleClinicalPermissionsContext.Provider></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>;
  const view = render(tree()); return { ...view, update(next) { context = { ...context, ...next }; view.rerender(tree()); }, close() { open = false; view.rerender(tree()); }, reopen() { open = true; view.rerender(tree()); } };
}
async function choose() { const events = userEvent.setup(); await events.click(await screen.findByRole('button', { name: 'Choose a template' })); await events.click(await screen.findByRole('button', { name: /Synthetic history template/ })); await events.click(await screen.findByRole('button', { name: 'Use this template revision' })); return events; }
async function preview(events) { await events.click(screen.getByRole('button', { name: 'Generate patient-aware preview' })); await screen.findByRole('region', { name: 'Proposed template patch' }); }
it('opens a real retained read-only Chronicle preview, applies only after explicit review and has no persistence action', async () => {
  mount(); const events = await choose(); expect(screen.getByText(/Local unsaved preview. This panel saves nothing/)).toBeInTheDocument(); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue(''); expect(screen.queryByRole('button', { name: 'Review note before saving' })).not.toBeInTheDocument(); await preview(events); expect(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })).toBeDisabled(); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('');
  await events.click(screen.getByLabelText('I reviewed this patient and the generated text to apply to empty sections.')); await events.click(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })); expect(screen.getByLabelText('Assessment')).toHaveValue(responsePatch.assessment); expect(writes).toHaveLength(0); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('uses all-history null encounter without substituting the active encounter', async () => {
  mount({ selectedEncounter: null, selectedEncounterId: null, activeEncounter: { id: ids[20] } }); const events = await choose(); await preview(events); expect(previews[0].payload.encounter_id).toBeNull();
});
it('preserves typed content on template choice and requires explicit destructive reset before a new empty draft', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('Note', { exact: true }), { target: { value: 'Synthetic typed work' } }); const events = await choose(); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Synthetic typed work'); await preview(events); await events.click(screen.getByLabelText('I reviewed this patient and the generated text to apply to empty sections.')); await events.click(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })); expect(screen.getByText(/existing text cannot be merged/)).toBeInTheDocument(); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Synthetic typed work'); expect(screen.getByRole('button', { name: 'Start empty template draft' })).toBeDisabled(); await events.click(screen.getByLabelText('Discard all entered note content and start empty for this selected revision.')); await events.click(screen.getByRole('button', { name: 'Start empty template draft' })); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue(''); expect(writes).toHaveLength(0);
});
it('requires explicit all-section overwrite confirmation and preserves false/zero/unselected metadata', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('Note', { exact: true }), { target: { value: '{"assessment":"typed","plan":false,"_meta":{"score":0}}' } }); const events = await choose(); fireEvent.keyDown(screen.getByRole('combobox', { name: 'Apply to' }), { key: 'ArrowDown' }); fireEvent.click(await screen.findByRole('option', { name: 'All generated sections' })); await preview(events); expect(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })).toBeDisabled(); await events.click(screen.getByLabelText('I reviewed this patient and explicitly confirm replacing the generated sections shown above.')); await events.click(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })); expect(screen.getByLabelText('Assessment')).toHaveValue(responsePatch.assessment); expect(screen.getByLabelText('Plan')).not.toBeChecked(); expect(screen.getByLabelText('Meta · Score')).toHaveValue(0); expect(previews[0].payload.base_body).toBe('{"assessment":"typed","plan":false,"_meta":{"score":0}}');
});
it('hides the last protected patch on current denial and keeps entered draft unchanged', async () => {
  mount(); const events = await choose(); await preview(events); expect(screen.getByText(/Synthetic server patient text/)).toBeInTheDocument(); mode = 'denied'; await events.click(screen.getByRole('button', { name: 'Generate patient-aware preview' })); await screen.findByText('Template preview access unavailable'); expect(screen.queryByRole('region', { name: 'Proposed template patch' })).not.toBeInTheDocument(); expect(screen.queryByText(/Synthetic server patient text/)).not.toBeInTheDocument(); expect(screen.queryByLabelText('Note', { exact: true })).not.toBeInTheDocument();
});
it.each(['body', 'patient', 'encounter', 'admission', 'permission', 'feature', 'actor', 'facility', 'template', 'close'])('discards late preview after %s changes with no write or stale feedback', async (change) => {
  mode = 'pending'; const view = mount(); const events = await choose(); await events.click(screen.getByRole('button', { name: 'Generate patient-aware preview' })); await waitFor(() => expect(resolvePending).toBeTypeOf('function')); const finish = resolvePending;
  if (change === 'body') fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'New typed content' } });
  if (change === 'patient') view.update({ patient: { id: ids[20], name: 'Different synthetic patient' } });
  if (change === 'admission') view.update({ selectedAdmissionId: ids[20] });
  if (change === 'encounter') view.update({ selectedEncounter: { id: ids[20], v2_status: 'in_progress' }, selectedEncounterId: ids[20] });
  if (change === 'permission') { user = { ...user, accessContext: { ...user.accessContext, permission_version: 2 } }; view.update({}); }
  if (change === 'actor') { user = { ...user, id: ids[20] }; view.update({}); }
  if (change === 'facility') { user = { ...user, accessContext: { ...user.accessContext, facility_id: ids[20] } }; view.update({}); }
  if (change === 'feature') { user = { ...user, accessContext: { ...user.accessContext, features: [] } }; view.update({}); }
  if (change === 'template') await events.click(screen.getByRole('button', { name: 'Start a freeform note' }));
  if (change === 'close') view.close(); await act(async () => finish()); expect(screen.queryByText(/Synthetic server patient text/)).not.toBeInTheDocument(); expect(screen.queryByRole('region', { name: 'Proposed template patch' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('refuses lossy numeric metadata application without changing the exact original request body', async () => {
  mount(); const body = '{"assessment":"","_meta":9007199254740993}'; fireEvent.change(await screen.findByLabelText('Note', { exact: true }), { target: { value: body } }); const events = await choose(); await preview(events); await events.click(screen.getByLabelText('I reviewed this patient and the generated text to apply to empty sections.')); await events.click(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })); await screen.findByText(/unreviewed JSON metadata/); await events.click(screen.getByRole('button', { name: 'Generate patient-aware preview' })); expect(previews[1].payload.base_body).toBe(body); expect(writes).toHaveLength(0);
});

it('clears an earlier applied hydrated body after a current403, then opens a new empty draft only on an explicit empty restart', async () => {
  mount(); const events = await choose(); await preview(events); await events.click(screen.getByLabelText('I reviewed this patient and the generated text to apply to empty sections.')); await events.click(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })); expect(screen.getByLabelText('Assessment')).toHaveValue(responsePatch.assessment);
  mode = 'denied'; await events.click(screen.getByRole('button', { name: 'Generate patient-aware preview' })); await screen.findByText('Template preview access unavailable'); expect(screen.queryByDisplayValue(responsePatch.assessment)).not.toBeInTheDocument(); expect(screen.queryByLabelText('Template title')).not.toBeInTheDocument(); mode = 'ready'; await events.click(screen.getByRole('button', { name: 'Start a new empty preview' })); await screen.findByLabelText('Note', { exact: true }); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue(''); expect(writes).toHaveLength(0);
});

it('treats unsupported historical context as a definite read refusal and keeps local typed work', async () => {
  mode = 'invalid'; mount({ selectedEncounter: { id: encounterId, v2_status: 'completed' } }); fireEvent.change(await screen.findByLabelText('Note', { exact: true }), { target: { value: 'Synthetic retained work' } }); const events = await choose(); await events.click(screen.getByRole('button', { name: 'Generate patient-aware preview' })); await screen.findByText('Selected encounter unavailable for preview.'); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue('Synthetic retained work'); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('uses explicit selected-section mode and applies plaintext as literal text without HTML execution', async () => {
  templates[0].body_template = 'Hello {{patient_name}}'; responsePatch = '<b>Synthetic server text</b>'; mount(); const events = await choose(); fireEvent.keyDown(screen.getByRole('combobox', { name: 'Apply to' }), { key: 'ArrowDown' }); fireEvent.click(await screen.findByRole('option', { name: 'Selected sections' })); expect(screen.getByRole('button', { name: 'Generate patient-aware preview' })).toBeDisabled(); await events.click(screen.getByLabelText('Note text')); await preview(events); expect(previews[0].payload.sections).toEqual(['text']); expect(screen.getByRole('region', { name: 'Proposed template patch' }).querySelector('b')).toBeNull(); await events.click(screen.getByLabelText('I reviewed this patient and explicitly confirm replacing the generated sections shown above.')); await events.click(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })); expect(screen.getByLabelText('Note', { exact: true })).toHaveValue(responsePatch); expect(writes).toHaveLength(0);
});

it('discards a completed confirmed preview permanently after A→B→A body changes', async () => {
  mount(); const events = await choose(); await preview(events); await events.click(screen.getByLabelText('I reviewed this patient and the generated text to apply to empty sections.')); expect(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })).toBeEnabled(); fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'Different local B' } }); expect(screen.queryByRole('region', { name: 'Proposed template patch' })).not.toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: '' } }); expect(screen.queryByRole('region', { name: 'Proposed template patch' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Apply reviewed preview to local draft' })).not.toBeInTheDocument(); expect(previews).toHaveLength(1); await preview(events); expect(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })).toBeDisabled();
});

it('requires the ordinary separate UUID note command after generated text is reviewed/applied, preserving the pinned revision and body', async () => {
  mode = 'save'; readOnly = false; user.adminAccess.capabilities.push('clinical_documentation.manage'); guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal: { id: actorId, facility_id: facilityId, active_profile: 'hospital' } }); guard.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); mount({ clinicalPermissions: { ...proof, can_add_note: true } }, 'note'); const events = await choose(); await preview(events); expect(writes).toHaveLength(0); await events.click(screen.getByLabelText('I reviewed this patient and the generated text to apply to empty sections.')); await events.click(screen.getByRole('button', { name: 'Apply reviewed preview to local draft' })); expect(writes).toHaveLength(0); await events.click(screen.getByRole('button', { name: 'Review note before saving' })); await events.click(screen.getByLabelText('I confirmed this patient and reviewed the complete note.')); await events.click(screen.getByRole('button', { name: 'Save reviewed note' })); await screen.findByText(/Note saved/); expect(writes).toHaveLength(1); const payload = JSON.parse(writes[0].body); expect(payload.template_revision_id).toBe(template.current_revision_id); expect(payload.encounter_id).toBe(encounterId); expect(JSON.parse(payload.body)).toEqual(responsePatch); expect(payload.client_request_id).toMatch(/^[0-9a-f-]{36}$/); expect(previews).toHaveLength(1); expect(previews[0].payload).not.toHaveProperty('client_request_id');
});
it('requires fresh discard confirmation after A→B→A typed-body changes', async () => {
  mount(); fireEvent.change(await screen.findByLabelText('Note', { exact: true }), { target: { value: 'Draft A' } }); const events = await choose(); const label = 'Discard all entered note content and start empty for this selected revision.'; await events.click(screen.getByLabelText(label)); expect(screen.getByRole('button', { name: 'Start empty template draft' })).toBeEnabled(); fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'Draft B' } }); fireEvent.change(screen.getByLabelText('Note', { exact: true }), { target: { value: 'Draft A' } }); expect(screen.getByLabelText(label)).not.toBeChecked(); expect(screen.getByRole('button', { name: 'Start empty template draft' })).toBeDisabled();
});
