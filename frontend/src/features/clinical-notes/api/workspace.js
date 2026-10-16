import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { NOTE_TYPES, validDate, validId } from '../model';

const noteType = (value) => NOTE_TYPES.some(([key]) => key === value);
const nullableId = (value) => value === null || validId(value);
const unavailable = () => new Error('The requested clinical note evidence could not be confirmed.');
function pinnedRevision(value) {
  if (!validId(value?.id) || !validId(value.template_id) || !Number.isSafeInteger(value.version) || value.version < 1 || typeof value.title !== 'string' || !noteType(value.note_type) || typeof value.body_template !== 'string') throw unavailable();
  return value;
}
export function noteDetail(value, { id, patientId } = {}) {
  if (!validId(value?.id) || (id && value.id !== id) || !validId(value.patient_id) || (patientId && value.patient_id !== patientId)
    || !nullableId(value.encounter_id) || !noteType(value.note_type) || typeof value.title !== 'string' || !value.title.trim() || typeof value.body !== 'string'
    || !Number.isSafeInteger(value.version) || value.version < 1 || !validDate(value.created_at) || !validDate(value.updated_at)
    || !nullableId(value.author_user_id) || !(value.author_display_name === null || typeof value.author_display_name === 'string') || typeof value.can_amend !== 'boolean' || !['draft', 'signed', 'amended'].includes(value.status)) throw unavailable();
  if (value.template_revision !== null) pinnedRevision(value.template_revision);
  return value;
}
export function templateSummary(value, { id } = {}) {
  if (!validId(value?.id) || (id && value.id !== id) || !noteType(value.note_type) || typeof value.title !== 'string' || !value.title.trim() || typeof value.is_active !== 'boolean'
    || !Number.isSafeInteger(value.version) || value.version < 1 || !validId(value.current_revision_id) || !nullableId(value.owner_user_id)
    || !(value.owner_display_name === null || typeof value.owner_display_name === 'string') || typeof value.can_manage !== 'boolean' || !validDate(value.updated_at)) throw new Error('The template and its current revision could not be confirmed.');
  return value;
}
export function templateDetail(value, scope) { templateSummary(value, scope); if (typeof value.body_template !== 'string') throw new Error('The selected template content could not be confirmed.'); return value; }
export function templateRevision(detail) { return { id: detail.current_revision_id, template_id: detail.id, version: detail.version, title: detail.title, note_type: detail.note_type, body_template: detail.body_template }; }
function page(envelope, query, validate) {
  const rows = envelope?.data; const p = envelope?.page;
  if (!Array.isArray(rows) || rows.length > (query.limit || 25) || !p || typeof p.has_next !== 'boolean' || new Set(rows.map((row) => row.id)).size !== rows.length
    || (p.has_next && (!rows.length || typeof p.next_cursor !== 'string' || !p.next_cursor || p.next_cursor === query.cursor))) throw new Error('This page could not be confirmed. Refresh before continuing.');
  return { rows: rows.map(validate), hasNext: p.has_next, cursor: p.next_cursor || null };
}
function version(value, noteId, versionId) {
  if (!validId(value?.id) || value.note_id !== noteId || (versionId && value.id !== versionId) || !Number.isSafeInteger(value.version) || value.version < 1 || !validDate(value.created_at)
    || !nullableId(value.recorded_by_user_id) || !(value.recorded_by_display_name === null || typeof value.recorded_by_display_name === 'string')
    || !(value.edit_reason === null || typeof value.edit_reason === 'string')) throw unavailable();
  return value;
}
function receipt(value, command) {
  const { payload, kind, source, patientId } = command;
  if (value?.client_request_id !== payload.client_request_id || typeof value.replayed !== 'boolean') throw unavailable();
  if (kind === 'record' || kind === 'amend') {
    const saved = noteDetail(value.note, { id: source?.id, patientId });
    if (value.action !== (kind === 'record' ? 'recorded' : 'amended') || saved.body !== payload.body || saved.version !== (kind === 'record' ? 1 : payload.expected_version + 1) || value.reason !== (kind === 'amend' ? payload.reason : null)) throw unavailable();
    if (saved.status !== (kind === 'record' ? 'draft' : 'amended') || saved.author_user_id !== (source ? source.author_user_id : command.actorId) || (source && saved.created_at !== source.created_at)) throw unavailable();
    const expected = source || payload;
    if (['note_type', 'title', 'encounter_id'].some((key) => (saved[key] ?? null) !== (expected[key] ?? null)) || (saved.template_revision?.id ?? null) !== (source?.template_revision?.id ?? payload.template_revision_id ?? null)) throw unavailable();
    const captured = source ? source.template_revision : command.templateRevision;
    if (saved.template_revision && (!captured || ['id', 'template_id', 'version', 'title', 'note_type', 'body_template'].some((key) => saved.template_revision[key] !== captured[key]))) throw unavailable();
  } else {
    const saved = templateDetail(value.template, { id: source?.id });
    if (value.action !== (kind === 'templateRecord' ? 'created' : 'changed') || saved.version !== (source ? payload.expected_version + 1 : 1)
      || ['title', 'note_type', 'body_template', 'is_active'].some((key) => saved[key] !== payload[key])) throw unavailable();
    if (saved.owner_user_id !== (source ? source.owner_user_id : command.actorId) || (source && saved.current_revision_id === source.current_revision_id)) throw unavailable();
  }
  return value;
}
export class ClinicalNoteUnconfirmedError extends Error { constructor() { super('This note or template change may already be saved. Keep the reviewed request unchanged and check its original saved result.'); this.name = 'ClinicalNoteUnconfirmedError'; } }
export const noteWorkspaceApi = {
  async detail(id, patientId, { signal } = {}) { return noteDetail((await v2Api.getClinicalNoteById({ note_id: id }, { signal }))?.data, { id, patientId }); },
  async history(id, query, { signal } = {}) { return page(await v2Api.getClinicalNoteHistory({ note_id: id }, { query, signal }), query, (row) => version(row, id)); },
  async version(id, versionId, { signal } = {}) { const value = version((await v2Api.getClinicalNoteVersion({ note_id: id, version_id: versionId }, { signal }))?.data, id, versionId); if (typeof value.body !== 'string') throw unavailable(); return value; },
  async templates(query, { signal } = {}) { return page(await v2Api.getClinicalNoteTemplates({ query, signal }), query, (row) => { templateSummary(row); if (query.activity === 'active' && !row.is_active) throw unavailable(); return row; }); },
  async template(id, { signal } = {}) { return templateDetail((await v2Api.getClinicalNoteTemplateById({ id }, { signal }))?.data, { id }); },
  async write(command, { signal } = {}) {
    const { kind, payload, source, patientId } = command; let response;
    try {
      response = kind === 'record' ? await v2Api.postClinicalNoteRecord({ patient_id: patientId }, payload, { signal }) : kind === 'amend' ? await v2Api.postClinicalNoteAmendment({ note_id: source.id }, payload, { signal }) : kind === 'templateRecord' ? await v2Api.postClinicalNoteTemplateRecord(payload, { signal }) : await v2Api.postClinicalNoteTemplateChange({ id: source.id }, payload, { signal });
      const saved = receipt(response?.data, command); acknowledgeWriteResponse(response); return saved;
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && !error.data?.error?.code?.endsWith('_write_unconfirmed')) throw error;
      markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new ClinicalNoteUnconfirmedError(), response || error);
    }
  },
  async recover(command, { signal } = {}) {
    const response = command.kind.startsWith('template') ? await v2Api.getClinicalNoteTemplateRequestReceipt({ request_id: command.payload.client_request_id }, { signal }) : await v2Api.getClinicalNoteRequestReceipt({ patient_id: command.patientId, request_id: command.payload.client_request_id }, { signal });
    return receipt(response?.data, command);
  },
};
