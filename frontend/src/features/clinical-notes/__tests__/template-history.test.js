import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient } from '@/lib/api/v2/client';
import { noteTemplateHistoryApi } from '../api/templateHistory';
import { noteWorkspaceApi } from '../api/workspace';
import { copyBodyEditable, sharedCopyDraft, templateEditorDraft, templatePayload } from '../templateModel';
import { actorId, command, ids, json, page, receipt, requestId, template, time } from './fixtures';

const runtime = window.__HMS_RUNTIME_CONFIG__; const fetchBefore = globalThis.fetch;
const savedRevision = (version = 3) => ({ id: ids[10], template_id: template.id, version, title: 'Saved synthetic template', note_type: 'nursing_note', is_active: true, created_by_user_id: null, created_by_display_name: null, change_summary: null, imported_legacy: true, created_at: time });
const exact = () => ({ ...savedRevision(), body_template: 'Saved synthetic starter', current_template: { ...template, version: 5, is_active: false } });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = fetchBefore; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('loads bounded metadata pages beyond 100 only through explicit cursors and preserves AbortSignal', async () => {
  const signal = new AbortController().signal;
  for (const [top, cursor, next] of [[125, undefined, 'v:76'], [75, 'v:76', 'v:26'], [25, 'v:26', null]]) {
    const rows = Array.from({ length: top > 25 ? 50 : 25 }, (_, i) => ({ ...savedRevision(top - i), id: `90000000-0000-4000-8000-${String(top - i + 1000).padStart(12, '0')}` }));
    globalThis.fetch.mockResolvedValueOnce(page(rows, next));
    const result = await noteTemplateHistoryApi.history(template.id, { limit: 50, cursor }, { signal }); expect(result.rows).toHaveLength(rows.length);
    expect(globalThis.fetch).toHaveBeenCalledTimes(top === 125 ? 1 : top === 75 ? 2 : 3);
    const [url, options] = globalThis.fetch.mock.calls.at(-1); expect(new URL(url).searchParams.get('limit')).toBe('50'); expect(new URL(url).searchParams.get('cursor')).toBe(cursor || null); expect(options.signal).toBe(signal);
  }
});
it('loads one exact saved revision with independently current availability and unknown imported author', async () => {
  globalThis.fetch.mockResolvedValueOnce(json({ data: exact() }));
  await expect(noteTemplateHistoryApi.version(template.id, ids[10], { expected: savedRevision() })).resolves.toMatchObject({ is_active: true, imported_legacy: true, created_by_user_id: null, current_template: { is_active: false, version: 5 } });
  expect(globalThis.fetch.mock.calls[0][0]).toContain(`/note-templates/${template.id}/versions/${ids[10]}`);
});
it.each(['foreign-template', 'wrong-id', 'wrong-version', 'missing-body', 'foreign-current', 'invented-author'])('rejects malformed %s selected revision evidence', async (fault) => {
  const value = exact(); if (fault === 'foreign-template') value.template_id = ids[21]; if (fault === 'wrong-id') value.id = ids[21]; if (fault === 'wrong-version') value.version += 1; if (fault === 'missing-body') delete value.body_template; if (fault === 'foreign-current') value.current_template.id = ids[21]; if (fault === 'invented-author') value.created_by_display_name = 'Unbound synthetic name';
  globalThis.fetch.mockResolvedValueOnce(json({ data: value })); await expect(noteTemplateHistoryApi.version(template.id, ids[10], { expected: savedRevision() })).rejects.toThrow(/could not be confirmed/);
});
it.each(['body-in-list', 'duplicate', 'ascending', 'same-cursor', 'unknown-next'])('rejects malformed %s metadata pages without substituting current content', async (fault) => {
  let rows = [savedRevision(3)]; let next = null;
  if (fault === 'body-in-list') rows[0].body_template = 'Unrequested body'; if (fault === 'duplicate') rows.push(rows[0]); if (fault === 'ascending') rows.push({ ...savedRevision(4), id: ids[11] }); if (fault === 'same-cursor') next = 'v:3';
  globalThis.fetch.mockResolvedValueOnce(fault === 'unknown-next' ? json({ data: rows, page: { has_next: false } }) : page(rows, next));
  await expect(noteTemplateHistoryApi.history(template.id, { cursor: 'v:3' })).rejects.toThrow(/could not be confirmed/);
});
it('preserves AbortError from actual history and exact-version transport', async () => {
  const error = new DOMException('Cancelled', 'AbortError'); globalThis.fetch.mockRejectedValueOnce(error).mockRejectedValueOnce(error);
  await expect(noteTemplateHistoryApi.history(template.id)).rejects.toBe(error); await expect(noteTemplateHistoryApi.version(template.id, ids[10])).rejects.toBe(error);
});
function copyForm(body) { const seed = sharedCopyDraft({ ...exact(), body_template: body }); return { ...templateEditorDraft(seed), preserveSeedBody: true, seedBodyEdited: false, originalSeedBody: body }; }
it.each(['  Plain starter\n', '[ {"section":"Review", "type":"custom", "unknown":{"x":1}} ]', '{ "unknown": [1,null], "sections": [{"name":"Review", "defaultText":"Starter", "privateMeta":9}] }'])('preserves exact unedited saved representation in a new inactive record', (body) => {
  const form = copyForm(body); form.title = 'Reviewed shared copy'; const payload = templatePayload(form, null, requestId);
  expect(payload).toMatchObject({ body_template: body, is_active: false }); expect(payload).not.toHaveProperty('expected_version'); expect(payload).not.toHaveProperty('template_id');
});
it.each([true, false])('preserves array/envelope and unknown metadata when a section is deliberately edited (array=%s)', (array) => {
  const sections = [{ name: 'Review', defaultText: 'Starter', extra: { x: 3 } }]; const original = array ? sections : { extra: [1], sections }; const form = copyForm(JSON.stringify(original)); form.seedBodyEdited = true; form.sections[0].default_text = 'Reviewed starter';
  const result = JSON.parse(templatePayload(form, null, requestId).body_template); const items = array ? result : result.sections;
  expect(Array.isArray(result)).toBe(array); expect(items[0]).toEqual({ ...sections[0], defaultText: 'Reviewed starter' }); if (!array) expect(result.extra).toEqual([1]);
});
it.each(['[null]', '{"sections":[{"section":"Review","required":"yes"}]}'])('keeps malformed historical schema read-only and never prepares it as a new copy', (body) => { expect(() => sharedCopyDraft({ ...exact(), body_template: body })).toThrow(/read-only/); });
it.each(['source-id', 'source-revision', 'wrong-owner', 'wrong-body', 'live-capability'])('keeps malformed %s shared-copy 2xx receipts uncertain', async (fault) => {
  const input = command('templateRecord'); input.copySource = { templateId: ids[20], revisionId: ids[21], version: 3 }; input.actorId = actorId; const value = receipt(input);
  if (fault === 'source-id') value.template.id = input.copySource.templateId; if (fault === 'source-revision') value.template.current_revision_id = input.copySource.revisionId; if (fault === 'wrong-owner') value.template.owner_user_id = ids[20]; if (fault === 'wrong-body') value.template.body_template += 'changed'; if (fault === 'live-capability') value.template.can_manage = true;
  globalThis.fetch.mockResolvedValueOnce(json({ data: value })); await expect(noteWorkspaceApi.write(input)).rejects.toMatchObject({ name: 'ClinicalNoteUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

it.each([
  '{"metadata":{"external_code":9007199254740993},"sections":[{"section":"Review","default_text":"Starter","hidden_code":9007199254740993}]}',
  '[{"section":"Review","default_text":"Starter","hidden_code":9007199254740993}]',
  '{"metadata":1,"metadata":2,"sections":[{"section":"Review"}]}'
])('permits exact copying but rejects structured editing when JSON round-trip loses untouched evidence', (body) => {
  expect(copyBodyEditable(body)).toBe(false); const form = copyForm(body); expect(templatePayload(form, null, requestId).body_template).toBe(body);
  form.seedBodyEdited = true; form.sections[0].default_text = 'Reviewed starter'; expect(() => templatePayload(form, null, requestId)).toThrow(/unreviewed metadata/);
});
