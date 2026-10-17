const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const statuses = new Set(['sent', 'accepted', 'scheduled', 'declined', 'completed', 'cancelled']);
const priorities = new Set(['routine', 'urgent', 'emergency']);
const versions = new Set(['legacy_observed', 'draft_saved', 'completed', 'amended']);
export const responseLabels = { legacy_observed: 'Imported response evidence', draft_saved: 'Response draft saved', completed: 'Referral completed', amended: 'Completed response amended' };
export const validId = value => typeof value === 'string' && UUID.test(value);
const date = value => typeof value === 'string' && value.length > 10 && Number.isFinite(Date.parse(value));
const nullableDate = value => value === null || date(value);
const nullableText = value => value === null || typeof value === 'string';
const nullableId = value => value === null || validId(value);
const chars = value => Array.from(value).length;
const invalid = () => new Error('The selected referral response evidence could not be confirmed. Refresh the exact referral before continuing.');
function bound(value, min, max) { return typeof value === 'string' && chars(value.trim()) >= min && chars(value) <= max; }
export function responseScope(scope) { if (!validId(scope?.patientId) || !validId(scope.referralId)) throw invalid(); return { patient_id: scope.patientId, referral_id: scope.referralId }; }
export function responseHistoryItem(value, scope) {
  responseScope(scope);
  if (!validId(value?.id) || value.patient_id !== scope.patientId || value.referral_id !== scope.referralId || !Number.isSafeInteger(value.version) || value.version < 1
    || !versions.has(value.operation) || !statuses.has(value.status) || typeof value.to_service !== 'string' || !value.to_service.trim() || !priorities.has(value.priority)
    || !nullableDate(value.completed_at) || !nullableId(value.recorded_by_user_id) || !nullableText(value.recorded_by_display_name)
    || (value.recorded_by_user_id === null && value.recorded_by_display_name !== null) || !date(value.recorded_at) || typeof value.imported_legacy !== 'boolean') throw invalid();
  if (value.operation === 'draft_saved' && !['accepted', 'scheduled'].includes(value.status)) throw invalid();
  if (['completed', 'amended'].includes(value.operation) && value.status !== 'completed') throw invalid();
  if (value.operation === 'completed' && value.completed_at === null) throw invalid();
  return value;
}
export function responseRevision(value, scope, versionId) {
  responseHistoryItem(value, scope);
  if ((versionId && value.id !== versionId) || !nullableText(value.specialist_notes) || !nullableText(value.recommendations) || !nullableText(value.amendment_reason)) throw invalid();
  if (value.operation !== 'legacy_observed' && (!bound(value.specialist_notes, 10, 20000) || !bound(value.recommendations, 0, 10000))) throw invalid();
  if (value.operation === 'amended' && !bound(value.amendment_reason, 1, 500)) throw invalid();
  return value;
}
export function responseContext(value, scope) {
  responseScope(scope);
  if (value?.patient_id !== scope.patientId || value.referral_id !== scope.referralId || typeof value.to_service !== 'string' || !value.to_service.trim() || !priorities.has(value.priority)
    || !date(value.created_at) || !statuses.has(value.status) || !Number.isSafeInteger(value.version) || value.version < 0 || !TOKEN.test(value.context_token)
    || !nullableId(value.scheduled_appointment_id) || !nullableDate(value.completed_at) || ['can_save_draft', 'can_complete', 'can_amend'].some(key => typeof value[key] !== 'boolean')) throw invalid();
  if (value.response === null) { if (value.version !== 0) throw invalid(); }
  else { responseRevision(value.response, scope); if (value.response.version !== value.version) throw invalid(); }
  if ((value.can_save_draft || value.can_complete) && !['accepted', 'scheduled'].includes(value.status)) throw invalid();
  if (value.can_amend && value.status !== 'completed') throw invalid();
  return value;
}
export function responsePage(envelope, scope, query = {}) {
  const rows = envelope?.data, page = envelope?.page, limit = query.limit || 25;
  if (!Array.isArray(rows) || rows.length > limit || !page || typeof page.has_next !== 'boolean' || page.limit !== limit || (page.has_next && (!rows.length || !/^v:[1-9][0-9]*$/.test(page.next_cursor) || page.next_cursor === query.cursor)) || (!page.has_next && page.next_cursor !== null)) throw invalid();
  const seen = new Set(); let before = query.cursor ? Number(query.cursor.slice(2)) : Infinity;
  rows.forEach(row => { responseHistoryItem(row, scope); if (['specialist_notes', 'recommendations', 'amendment_reason'].some(key => Object.hasOwn(row, key)) || seen.has(row.id) || row.version >= before) throw invalid(); seen.add(row.id); before = row.version; });
  return { rows, hasNext: page.has_next, cursor: page.next_cursor };
}
export function responseCommand({ scope, source, operation, specialistNotes, recommendations, amendmentReason, requestId, actorId }) {
  responseContext(source, scope);
  const flag = { save_draft: 'can_save_draft', complete: 'can_complete', amend: 'can_amend' }[operation];
  if (!flag || !source[flag] || !validId(requestId) || !validId(actorId) || !bound(specialistNotes, 10, 20000) || !bound(recommendations, 0, 10000)) throw new Error('Review the current referral, enter at least 10 characters of specialist notes, and keep notes within 20,000 and recommendations within 10,000 characters.');
  const reason = operation === 'amend' ? amendmentReason?.trim() : null;
  if ((operation === 'amend' && !bound(reason, 1, 500)) || (operation !== 'amend' && amendmentReason?.trim())) throw new Error('An explicit amendment reason of at most 500 characters is required only for a completed response amendment.');
  return { ...scope, actorId, source, payload: { client_request_id: requestId, expected_version: source.version, expected_context_token: source.context_token, operation, specialist_notes: specialistNotes, recommendations, amendment_reason: reason } };
}
export function responseReceipt(value, command) {
  const { source, payload, actorId } = command;
  const response = responseRevision(value?.response, command);
  const operation = { save_draft: 'draft_saved', complete: 'completed', amend: 'amended' }[payload.operation];
  if (value.client_request_id !== payload.client_request_id || value.operation !== operation || typeof value.replayed !== 'boolean' || !date(value.recorded_at)
    || response.operation !== operation || response.version !== payload.expected_version + 1 || response.specialist_notes !== payload.specialist_notes || response.recommendations !== payload.recommendations
    || response.amendment_reason !== payload.amendment_reason || response.recorded_by_user_id !== actorId || response.imported_legacy !== false || response.recorded_at !== value.recorded_at
    || response.to_service !== source.to_service || response.priority !== source.priority || response.status !== (payload.operation === 'save_draft' ? source.status : 'completed')
    || (payload.operation !== 'complete' && response.completed_at !== source.completed_at) || (payload.operation === 'complete' && response.completed_at === null)
    || ['can_save_draft', 'can_complete', 'can_amend'].some(key => value[key] === true || response[key] === true)) throw invalid();
  return value;
}
export function historyQuery(query = {}) {
  const limit = query.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (query.cursor !== undefined && (!/^v:[1-9][0-9]*$/.test(query.cursor) || !Number.isSafeInteger(Number(query.cursor.slice(2)))))) throw invalid();
  return { limit, cursor: query.cursor };
}
