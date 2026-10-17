import { v2Api } from '@/lib/api/v2/client';
import { validDate, validId } from '../model';
import { templateSummary } from './workspace';

const failure = () => new Error('The selected template revision evidence could not be confirmed.');
const nullableText = (value) => value === null || typeof value === 'string';
export function templateHistoryItem(value, templateId, { body = false } = {}) {
  if (!validId(value?.id) || value.template_id !== templateId || !Number.isSafeInteger(value.version) || value.version < 1
    || typeof value.title !== 'string' || !value.title.trim() || !['doctor_note', 'nursing_note', 'allied_health_note'].includes(value.note_type)
    || typeof value.is_active !== 'boolean' || !nullableText(value.change_summary) || !validDate(value.created_at)
    || !(value.created_by_user_id === null || validId(value.created_by_user_id)) || !nullableText(value.created_by_display_name)
    || (value.created_by_user_id === null && value.created_by_display_name !== null) || typeof value.imported_legacy !== 'boolean'
    || (!body && Object.hasOwn(value, 'body_template'))) throw failure();
  return value;
}
export function templateVersionDetail(value, templateId, versionId, expected) {
  templateHistoryItem(value, templateId, { body: true });
  if (value.id !== versionId || typeof value.body_template !== 'string') throw failure();
  templateSummary(value.current_template, { id: templateId });
  if (value.current_template.version < value.version || (value.current_template.version === value.version && (value.current_template.current_revision_id !== value.id || ['title', 'note_type', 'is_active'].some((key) => value[key] !== value.current_template[key])))) throw failure();
  if (expected && ['id', 'template_id', 'version', 'title', 'note_type', 'is_active', 'created_at', 'created_by_user_id', 'change_summary', 'imported_legacy'].some((key) => value[key] !== expected[key])) throw failure();
  return value;
}
export const noteTemplateHistoryApi = {
  async history(id, { limit = 25, cursor } = {}, { signal } = {}) {
    if (!validId(id) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && !/^v:[1-9][0-9]*$/.test(cursor))) throw failure();
    const response = await v2Api.getClinicalNoteTemplateHistory({ id }, { query: { limit, cursor }, signal });
    const rows = response?.data; const page = response?.page;
    if (!Array.isArray(rows) || rows.length > limit || !page || typeof page.has_next !== 'boolean'
      || (page.has_next && (!rows.length || typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor === cursor))
      || (!page.has_next && page.next_cursor !== null) || new Set(rows.map((row) => row.id)).size !== rows.length
      || new Set(rows.map((row) => row.version)).size !== rows.length) throw failure();
    rows.forEach((row, index) => { templateHistoryItem(row, id); if ((cursor && row.version >= Number(cursor.slice(2))) || (index && row.version >= rows[index - 1].version)) throw failure(); });
    return { rows, hasNext: page.has_next, cursor: page.next_cursor };
  },
  async version(id, versionId, { signal, expected } = {}) {
    if (!validId(id) || !validId(versionId)) throw failure();
    return templateVersionDetail((await v2Api.getClinicalNoteTemplateVersion({ id, version_id: versionId }, { signal }))?.data, id, versionId, expected);
  },
};

export async function readTemplateEvidence(read, signal, onDenied) {
  try { return await read(); } catch (error) { if (!signal?.aborted && error.status === 403) onDenied?.(); throw error; }
}
