import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import RustTemplateCatalogPage from '../pages/RustTemplateCatalogPage';
import { actorId, facilityId, ids, json, page, receipt, template, time } from './fixtures';

const initialRuntime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
const savedBody = ' { "metadata":{"keep":[1,null]}, "sections":[{"section":"Historical review","defaultText":"Saved synthetic starter","unknown":true}] } ';
const originalRow = { id: ids[10], template_id: template.id, version: 3, title: 'Saved synthetic title', note_type: 'nursing_note', is_active: true, change_summary: 'Synthetic review', created_by_user_id: null, created_by_display_name: null, imported_legacy: true, created_at: time };
let user; let current; let revision; let writes; let saved; let mode; let denyHistory; let denyVersion; let client; let resolvePending; let historyRows; let readOnly;
function server(url, options = {}) {
  const path = new URL(url).pathname;
  if (options.method === 'POST') {
    const payload = JSON.parse(options.body); writes.push({ path, payload });
    saved = receipt({ kind: 'templateRecord', actorId: user.id, source: null, payload }); saved.template.id = ids[14]; saved.template.current_revision_id = ids[15];
    if (mode === 'lost') return Promise.reject(new TypeError('Synthetic lost response'));
    if (mode === 'pending') return new Promise((resolve) => { resolvePending = () => resolve(json({ data: saved })); });
    if (mode === 'old-root') saved.template.id = template.id;
    return Promise.resolve(json({ data: saved }));
  }
  if (path.includes('/note-templates/requests/')) return Promise.resolve(mode === 'missing' ? json({ error: { code: 'not_found' } }, 404) : json({ data: saved }));
  if (path.endsWith('/history')) {
    if (denyHistory) return Promise.resolve(json({ error: { code: 'permission_denied' } }, 403));
    const cursor = new URL(url).searchParams.get('cursor');
    return Promise.resolve(historyRows ? page(historyRows.filter((row) => !cursor || row.version < Number(cursor.slice(2))).slice(0, 25), (() => { const rows = historyRows.filter((row) => !cursor || row.version < Number(cursor.slice(2))); return rows.length > 25 ? `v:${rows[24].version}` : null; })()) : page([originalRow]));
  }
  if (path.includes('/versions/')) return Promise.resolve(denyVersion ? json({ error: { code: 'permission_denied' } }, 403) : json({ data: { ...revision, current_template: current } }));
  if (path.endsWith('/note-templates')) return Promise.resolve(page(new URL(url).searchParams.get('activity') === 'active' && !current.is_active ? [] : [current]));
  return Promise.resolve(json({ data: current }));
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  user = { id: actorId, facilityCode: 'HMS', adminAccess: { capabilities: ['clinical_documentation.view', 'clinical_documentation.manage'] }, accessContext: { facility_id: facilityId, active_profile: 'hospital', permission_version: 1, features: ['encounters'], patient_visibility: [] } };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' }; const guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal }); guard.update({ confirmed: true, decision: { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 } }); activateWriteUncertainty(principal);
  current = { ...template, version: 5, owner_user_id: ids[19], owner_display_name: 'Synthetic other owner', can_manage: false, is_active: false, body_template: 'Current synthetic starter' }; revision = { ...originalRow, body_template: savedBody }; writes = []; saved = null; mode = 'saved'; denyHistory = false; denyVersion = false; resolvePending = null; historyRows = null; readOnly = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } } }); globalThis.fetch = vi.fn(server);
});
afterEach(() => { client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = initialRuntime; });
function mount() {
  const tree = () => <MemoryRouter><HelmetProvider><BreadcrumbProvider><QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { classification: 'onsite', access_allowed: true, read_only: readOnly, policy_version: 1 } }}><RustTemplateCatalogPage /></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider></BreadcrumbProvider></HelmetProvider></MemoryRouter>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function openHistory() {
  const events = userEvent.setup(); fireEvent.keyDown(screen.getByRole('combobox', { name: 'Availability' }), { key: 'ArrowDown' }); fireEvent.click(await screen.findByRole('option', { name: 'All templates' })); await events.click(await screen.findByRole('button', { name: /Synthetic history template/ })); await screen.findByText('Current synthetic starter');
  await events.click(screen.getByRole('tab', { name: 'Revision history' })); await screen.findByRole('button', { name: /Revision 3 · Saved synthetic title/ }); return events;
}
async function openCopy() { const events = await openHistory(); await events.click(screen.getByRole('button', { name: /Revision 3 · Saved synthetic title/ })); await events.click(await screen.findByRole('button', { name: 'Create shared copy' })); await screen.findByRole('dialog'); return events; }
async function reviewCopy(events) { await events.click(screen.getByRole('button', { name: 'Review template before saving' })); await events.click(screen.getByLabelText('I reviewed the complete template content and availability.')); }
it('reads history without source ownership or FullClinical, then one exact immutable revision with distinct availability/provenance', async () => {
  mount(); const events = await openHistory(); expect(globalThis.fetch.mock.calls.some(([url]) => url.includes('/versions/'))).toBe(false); expect(screen.queryByRole('button', { name: 'Edit template and availability' })).not.toBeInTheDocument();
  await events.click(screen.getByRole('button', { name: /Revision 3 ·/ })); await screen.findByText('Saved synthetic starter'); expect(screen.getByText('Not recorded')).toBeInTheDocument(); expect(screen.getByText(/Imported historical evidence/)).toBeInTheDocument(); expect(screen.getByText('Availability recorded in this revision').nextSibling).toHaveTextContent('Active'); expect(screen.getByText('Current template availability').nextSibling).toHaveTextContent('Inactive · revision 5'); expect(screen.queryByText('Current synthetic starter')).not.toBeInTheDocument();
});
it('pages a 126-revision history explicitly past 100 without hidden requests or false completion', async () => {
  historyRows = Array.from({ length: 126 }, (_, index) => ({ ...originalRow, id: `90000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`, version: 126 - index })); mount(); const events = userEvent.setup(); fireEvent.keyDown(screen.getByRole('combobox', { name: 'Availability' }), { key: 'ArrowDown' }); fireEvent.click(await screen.findByRole('option', { name: 'All templates' })); await events.click(await screen.findByRole('button', { name: /Synthetic history template/ })); await events.click(screen.getByRole('tab', { name: 'Revision history' })); await screen.findByRole('button', { name: /Revision 126 ·/ });
  expect(globalThis.fetch.mock.calls.filter(([url]) => url.includes('/history'))).toHaveLength(1);
  for (const version of [101, 76, 51, 26, 1]) { await events.click(screen.getByRole('button', { name: 'Older revisions' })); await screen.findByRole('button', { name: new RegExp(`Revision ${version} ·`) }); }
  expect(screen.getByRole('button', { name: 'Older revisions' })).toBeDisabled(); expect(globalThis.fetch.mock.calls.filter(([url]) => url.includes('/history'))).toHaveLength(6); expect(globalThis.fetch.mock.calls.some(([url]) => url.includes('/versions/'))).toBe(false);
});
it('creates a new inactive facility-shared copy with exact body, new identity/current owner and zero changes to source', async () => {
  mount(); const events = await openCopy(); expect(screen.getByLabelText('Available for new notes in this facility')).not.toBeChecked(); expect(screen.getByText(/owned by you. It starts inactive/)).toBeInTheDocument(); await reviewCopy(events); await events.click(screen.getByRole('button', { name: 'Save reviewed template' })); await screen.findByText(/Template revision saved/);
  expect(writes).toHaveLength(1); expect(writes[0].path).toBe('/api/v2/clinical/note-templates/record'); expect(writes[0].payload).toMatchObject({ note_type: 'nursing_note', body_template: savedBody, is_active: false }); expect(writes[0].payload).not.toHaveProperty('expected_version'); expect(writes[0].payload).not.toHaveProperty('template_id'); expect(current).toMatchObject({ id: template.id, version: 5, owner_user_id: ids[19], is_active: false });
});
it('requires current management permission for shared-copy creation but keeps authorized historical reads', async () => {
  user.adminAccess.capabilities = ['clinical_documentation.view']; mount(); const events = await openHistory(); await events.click(screen.getByRole('button', { name: /Revision 3 ·/ })); await screen.findByText('Saved synthetic starter'); expect(screen.queryByRole('button', { name: 'Create shared copy' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Create note template' })).not.toBeInTheDocument();
});
it('does not infer View from Manage alone', () => { user.adminAccess.capabilities = ['clinical_documentation.manage']; mount(); expect(screen.getByText('Template access unavailable')).toBeInTheDocument(); expect(globalThis.fetch).not.toHaveBeenCalled(); });
it('keeps malformed imported structure readable and disables copy with no write', async () => {
  revision.body_template = '[null]'; mount(); const events = await openHistory(); await events.click(screen.getByRole('button', { name: /Revision 3 ·/ })); expect(await screen.findByRole('button', { name: 'Create shared copy' })).toBeDisabled(); expect(screen.getByText(/This historical structure is read-only/)).toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it.each(['history', 'version'])('clears a copied draft/controller when a fresh %s read is denied', async (kind) => {
  mount(); await openCopy(); fireEvent.change(screen.getByLabelText('Template title'), { target: { value: 'Synthetic copied private draft' } }); if (kind === 'history') denyHistory = true; else denyVersion = true;
  await act(async () => { await client.invalidateQueries({ predicate: (query) => query.queryKey.includes(kind) }); }); await screen.findByText('Template access unavailable'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByDisplayValue('Synthetic copied private draft')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it.each(['actor', 'facility', 'permission', 'feature', 'manage', 'network'])('discards copied values on %s scope loss and never publishes a write', async (change) => {
  const view = mount(); await openCopy(); fireEvent.change(screen.getByLabelText('Template title'), { target: { value: 'Synthetic copied private draft' } });
  if (change === 'network') readOnly = true; if (change === 'manage') user = { ...user, adminAccess: { capabilities: ['clinical_documentation.view'] } }; if (change === 'actor') user = { ...user, id: ids[21] }; if (change === 'facility') user = { ...user, accessContext: { ...user.accessContext, facility_id: ids[21] } }; if (change === 'permission') user = { ...user, accessContext: { ...user.accessContext, permission_version: 2 } }; if (change === 'feature') user = { ...user, accessContext: { ...user.accessContext, features: [] } }; view.update(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByDisplayValue('Synthetic copied private draft')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it.each(['lost', 'old-root'])('retains exact %s copy request across close/reopen and confirms only a valid original receipt', async (failure) => {
  mode = failure; mount(); const events = await openCopy(); await reviewCopy(events); await events.click(screen.getByRole('button', { name: 'Save reviewed template' })); await screen.findByRole('button', { name: 'Check original template result' }); const original = structuredClone(writes[0]); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await events.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close', exact: true }).at(0)); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); await events.click(screen.getByRole('button', { name: 'Review pending template change' })); mode = 'missing'; await events.click(screen.getByRole('button', { name: 'Check original template result' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Retry exact template change' })).toBeEnabled()); expect(writes).toEqual([original]);
  mode = 'saved'; await events.click(screen.getByRole('button', { name: 'Retry exact template change' })); await screen.findByText(/Template revision saved/); expect(writes).toEqual([original, original]); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('blocks close/repeated saves while pending and suppresses late feedback after actor change', async () => {
  mode = 'pending'; const view = mount(); const events = await openCopy(); await reviewCopy(events); await events.click(screen.getByRole('button', { name: 'Save reviewed template' })); await waitFor(() => expect(resolvePending).toBeTypeOf('function')); expect(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close', exact: true }).at(0)).toBeDisabled(); await events.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close', exact: true }).find((button) => !button.disabled)); await events.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(writes).toHaveLength(1);
  user = { ...user, id: ids[21] }; view.update(); await act(async () => resolvePending()); expect(screen.queryByText(/Template revision saved/)).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(writes).toHaveLength(1);
});

it('keeps unsafe numeric metadata exact and makes only body editing unavailable for a shared copy', async () => {
  const body = '{"metadata":{"external_code":9007199254740993},"sections":[{"section":"Review","default_text":"Starter","hidden_code":9007199254740993}]}';
  revision.body_template = body; mount(); const events = await openCopy(); expect(screen.getByText(/This saved JSON cannot be edited here/)).toBeInTheDocument(); expect(screen.queryByLabelText('Section 1 name')).not.toBeInTheDocument(); expect(screen.getByLabelText('Template title')).toBeEnabled();
  await reviewCopy(events); await events.click(screen.getByRole('button', { name: 'Save reviewed template' })); await screen.findByText(/Template revision saved/); expect(writes[0].payload.body_template).toBe(body); expect(writes[0].payload.is_active).toBe(false);
});
