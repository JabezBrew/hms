import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { noteWorkspaceApi } from '../api/workspace';
import { actorId, facilityId, command, detail, history, ids, json, noteId, page, patientId, receipt, requestId, revision, template, versionId } from './fixtures';
const originalFetch = globalThis.fetch; const runtime = window.__HMS_RUNTIME_CONFIG__;
beforeEach(() => { vi.stubGlobal('crypto',webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('loads fresh expanded note evidence and preserves its signal and patient scope', async () => {
  const signal = new AbortController().signal; globalThis.fetch.mockResolvedValueOnce(json({ data: detail })); await expect(noteWorkspaceApi.detail(noteId, patientId, { signal })).resolves.toMatchObject({ body: detail.body, can_amend: true });
  expect(globalThis.fetch.mock.calls[0][0]).toContain(`/clinical/notes/${noteId}`); expect(globalThis.fetch.mock.calls[0][1].signal).toBe(signal);
  globalThis.fetch.mockResolvedValueOnce(json({ data: { ...detail, patient_id: ids[20] } })); await expect(noteWorkspaceApi.detail(noteId, patientId)).rejects.toThrow(/could not be confirmed/);
});
it('loads bounded metadata history before one exact historical body', async () => {
  const signal = new AbortController().signal; globalThis.fetch.mockResolvedValueOnce(page([history], 'opaque-next-page'));
  await expect(noteWorkspaceApi.history(noteId, { limit: 20, cursor: 'opaque-page' }, { signal })).resolves.toMatchObject({ rows: [history], hasNext: true, cursor: 'opaque-next-page' });
  const url = new URL(globalThis.fetch.mock.calls[0][0]); expect(url.searchParams.get('cursor')).toBe('opaque-page'); expect(url.searchParams.get('limit')).toBe('20');
  globalThis.fetch.mockResolvedValueOnce(json({ data: { ...history, body: 'Synthetic historical body' } })); await noteWorkspaceApi.version(noteId, versionId, { signal }); expect(globalThis.fetch.mock.calls[1][0]).toContain(`/versions/${versionId}`);
  globalThis.fetch.mockResolvedValueOnce(json({ data: { ...history, id: ids[19], body: 'Synthetic wrong version' } })); await expect(noteWorkspaceApi.version(noteId, versionId)).rejects.toThrow(/could not be confirmed/);
});
it('preserves server catalog filtering and cursor without loading every page', async () => {
  globalThis.fetch.mockResolvedValueOnce(page([template], 'next')); await noteWorkspaceApi.templates({ limit: 15, search: 'Synthetic %_needle', cursor: 'cursor', activity: 'all', note_type: 'doctor_note' });
  const url = new URL(globalThis.fetch.mock.calls[0][0]); expect(Object.fromEntries(url.searchParams)).toMatchObject({ limit: '15', search: 'Synthetic %_needle', cursor: 'cursor', activity: 'all', note_type: 'doctor_note' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
it('rejects repeated cursors, duplicate metadata and active pages containing inactive templates', async () => {
  globalThis.fetch.mockResolvedValueOnce(page([template], 'same')); await expect(noteWorkspaceApi.templates({ limit: 15, cursor: 'same', activity: 'all' })).rejects.toThrow(/page could not be confirmed/);
  globalThis.fetch.mockResolvedValueOnce(page([template, template])); await expect(noteWorkspaceApi.templates({ limit: 15, activity: 'all' })).rejects.toThrow(/page could not be confirmed/);
  globalThis.fetch.mockResolvedValueOnce(page([{ ...template, is_active: false }])); await expect(noteWorkspaceApi.templates({ limit: 15, activity: 'active' })).rejects.toThrow(/could not be confirmed/);
});
it.each(['record', 'amend', 'templateRecord', 'templateChange'])('sends the strict %s command and confirms its immutable saved result', async (kind) => {
  const input = command(kind); globalThis.fetch.mockResolvedValueOnce(json({ data: receipt(input) })); await expect(noteWorkspaceApi.write(input)).resolves.toMatchObject({ client_request_id: requestId });
  const [url, request] = globalThis.fetch.mock.calls[0]; expect(url).toContain(kind === 'record' ? `/patients/${patientId}/clinical/notes/record` : kind === 'amend' ? `/notes/${noteId}/amendments` : kind === 'templateRecord' ? '/note-templates/record' : `/note-templates/${template.id}/changes`); expect(request.method).toBe('POST'); expect(JSON.parse(request.body)).toEqual(input.payload);
});
it.each(['patient', 'body', 'title', 'encounter', 'author', 'version', 'status', 'template'])('keeps a malformed %s note receipt unconfirmed', async (fault) => {
  const input = command('record'); const value = receipt(input); if (fault === 'patient') value.note.patient_id = ids[20]; if (fault === 'body') value.note.body = 'Different synthetic text'; if (fault === 'title') value.note.title = 'Different synthetic title'; if (fault === 'encounter') value.note.encounter_id = null; if (fault === 'author') value.note.author_user_id = ids[20]; if (fault === 'version') value.note.version = 4; if (fault === 'status') value.note.status = 'signed'; if (fault === 'template') value.note.template_revision = {};
  globalThis.fetch.mockResolvedValueOnce(json({ data: value })); await expect(noteWorkspaceApi.write(input)).rejects.toMatchObject({ name: 'ClinicalNoteUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
it('validates amendment reason and template owner/revision evidence', async () => {
  const amended = command('amend'); const value = receipt(amended); value.reason = 'Different reason'; globalThis.fetch.mockResolvedValueOnce(json({ data: value })); await expect(noteWorkspaceApi.write(amended)).rejects.toMatchObject({ name: 'ClinicalNoteUnconfirmedError' });
  const changed = command('templateChange'); const wrong = receipt(changed); wrong.template.current_revision_id = changed.source.current_revision_id; globalThis.fetch.mockResolvedValueOnce(json({ data: wrong })); await expect(noteWorkspaceApi.write(changed)).rejects.toMatchObject({ name: 'ClinicalNoteUnconfirmedError' });
});
it('preserves unknown legacy authorship on an explicitly authorized administrative amendment', async () => {
  const input = command('amend'); input.source.author_user_id = null; input.source.author_display_name = null;
  globalThis.fetch.mockResolvedValueOnce(json({ data: receipt(input) })); await expect(noteWorkspaceApi.write(input)).resolves.toMatchObject({ note: { author_user_id: null, version: 2 } });
});
it('confirms the complete captured template revision, not just a matching revision identifier', async () => {
  const input = command('record'); input.payload.template_revision_id = revision.id; input.templateRevision = revision;
  globalThis.fetch.mockResolvedValueOnce(json({ data: receipt(input) })); await expect(noteWorkspaceApi.write(input)).resolves.toMatchObject({ note: { template_revision: revision } });
  const malformed = receipt(input); malformed.note.template_revision = { ...revision, body_template: 'Different synthetic template content' }; globalThis.fetch.mockResolvedValueOnce(json({ data: malformed })); await expect(noteWorkspaceApi.write(input)).rejects.toMatchObject({ name: 'ClinicalNoteUnconfirmedError' });
});
it('preserves definite conflicts and classifies explicit commit uncertainty with no automatic retry', async () => {
  globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'clinical_note_source_changed', message: 'Reload current source.' } }, 409)); await expect(noteWorkspaceApi.write(command('amend'))).rejects.toMatchObject({ status: 409 });
  globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'clinical_note_write_unconfirmed' } }, 409)); await expect(noteWorkspaceApi.write(command('amend'))).rejects.toMatchObject({ name: 'ClinicalNoteUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});
it.each(['record', 'amend', 'templateRecord', 'templateChange'])('looks up the original actor-bound %s result without making another write', async (kind) => {
  const principal={id:actorId,facility_id:facilityId,active_profile:'hospital'},transport=getV2ClientScopeKey(),authority='synthetic-note-api-authority';bindNetworkAccessGuard({transportScope:transport,authorityScope:authority,principal}).update({confirmed:true,decision:{access_allowed:true,read_only:false,classification:'onsite',policy_version:1}});activateWriteUncertainty(principal,{authority,transport});
  const input = command(kind); const signal = new AbortController().signal; globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic original reply loss')); await expect(noteWorkspaceApi.write(input)).rejects.toMatchObject({name:'ClinicalNoteUnconfirmedError'}); globalThis.fetch.mockResolvedValueOnce(json({ data: { ...receipt(input), replayed: true } })); await expect(noteWorkspaceApi.recover(input, { signal })).resolves.toMatchObject({ replayed: true });
  const [url, request] = globalThis.fetch.mock.calls[1]; expect(globalThis.fetch.mock.calls.filter(([,options])=>options.method==='POST')).toHaveLength(1); expect(url).toContain(`/requests/${requestId}`.replace('/requests/', kind.startsWith('template') ? '/requests/' : '/clinical/note-requests/')); expect(request.method).toBe('GET'); expect(request.signal).toBe(signal);
});
