import { ADVISORY_TYPES, ADVISORY_STATUS, CASE_STATUS, uuid, instant } from './model';
const unavailable = () => new Error('The selected admission follow-up evidence could not be confirmed. Reload before continuing.');
const flags = ['can_create', 'can_complete', 'can_acknowledge_unresolved', 'can_cancel'];
export function caseHeader(value, patientId) {
  if (!uuid(value?.admission_case_id) || value.patient_id !== patientId || !uuid(value.current_ward_id) || typeof value.current_ward_name !== 'string' || !Object.hasOwn(CASE_STATUS, value.admission_status) || !instant(value.created_at)) throw unavailable();
  return value;
}
export function advisoryHeader(value, { patientId, caseId, id } = {}) {
  if (!uuid(value?.id) || (id && value.id !== id) || value.patient_id !== patientId || value.admission_case_id !== caseId || !uuid(value.captured_ward_id)
    || !Object.hasOwn(ADVISORY_TYPES, value.task_type) || !Object.hasOwn(ADVISORY_STATUS, value.status) || !['pre_activation', 'post_activation'].includes(value.phase)
    || !Number.isSafeInteger(value.version) || value.version !== (value.status === 'pending' ? 1 : 2) || !instant(value.created_at)
    || flags.slice(1).some((key) => typeof value[key] !== 'boolean' || (value.status !== 'pending' && value[key]))
    || (value.status === 'pending' ? value.decided_at !== null : !instant(value.decided_at))) throw unavailable();
  return value;
}
export function advisoryContext(value, scope) {
  if (value?.patient_id !== scope.patientId || value.admission_case_id !== scope.caseId || !uuid(value.current_ward_id) || typeof value.current_ward_name !== 'string' || !Object.hasOwn(CASE_STATUS, value.admission_status)
    || !/^[0-9a-f]{64}$/i.test(value.context_token || '') || flags.some((key) => typeof value[key] !== 'boolean') || value.complete !== true || !Array.isArray(value.advisories) || value.advisories.length > 8
    || !Array.isArray(value.available_types) || value.available_types.some((key) => !Object.hasOwn(ADVISORY_TYPES, key)) || new Set(value.available_types).size !== value.available_types.length) throw unavailable();
  const rows = value.advisories.map((row) => advisoryHeader(row, scope));
  if (new Set([...rows.map((row) => row.task_type), ...value.available_types]).size !== Object.keys(ADVISORY_TYPES).length || new Set(rows.map((row) => row.id)).size !== rows.length || new Set(rows.map((row) => row.task_type)).size !== rows.length || value.available_types.some((key) => rows.some((row) => row.task_type === key))) throw unavailable();
  for (const status of Object.keys(ADVISORY_STATUS)) if (!Number.isSafeInteger(value.counts_by_status?.[status]) || value.counts_by_status[status] !== rows.filter((row) => row.status === status).length) throw unavailable();
  return value;
}
export function advisoryDetail(value, scope) {
  advisoryHeader(value, scope);
  if (typeof value.captured_ward_name !== 'string' || typeof value.notes !== 'string' || !value.notes.trim() || [...value.notes].length > 4000 || !uuid(value.created_by_user_id) || typeof value.created_by_display_name !== 'string') throw unavailable();
  const decision = value.decision;
  if (value.status === 'pending') { if (decision !== null) throw unavailable(); }
  else if (!decision || decision.status !== value.status || !['manual', 'admission_case_cancelled', 'admission_discharged'].includes(decision.source)
    || !uuid(decision.recorded_by_user_id) || !instant(decision.recorded_at) || decision.recorded_at !== value.decided_at || !uuid(decision.ward_id) || typeof decision.ward_name !== 'string'
    || typeof decision.recorded_by_display_name !== 'string' || !(decision.reason === null || (typeof decision.reason === 'string' && [...decision.reason].length <= 2000))
    || (decision.source === 'manual' ? decision.system_reason_code !== null || (value.status !== 'completed' && !decision.reason?.trim()) : value.status !== 'cancelled' || decision.reason !== null || decision.system_reason_code !== decision.source)) throw unavailable();
  return value;
}
export function casePage(response, patientId, query) {
  const rows = response?.data; const page = response?.page;
  if (!Array.isArray(rows) || rows.length > (query.limit || 25) || !page || typeof page.has_next !== 'boolean' || !(page.next_cursor == null || typeof page.next_cursor === 'string') || (page.has_next && (!rows.length || typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor === query.cursor))) throw unavailable();
  const result = rows.map((row) => caseHeader(row, patientId));
  if (new Set(result.map((row) => row.admission_case_id)).size !== result.length) throw unavailable();
  return { rows: result, hasNext: page.has_next, cursor: page.next_cursor || null };
}
export function advisoryReceipt(value, command) {
  const { patientId, caseId, actorId, payload, kind, source, context } = command;
  const detail = advisoryDetail(value?.advisory, { patientId, caseId, id: source?.id });
  if (flags.slice(1).some((key) => detail[key] !== false) || value.client_request_id !== payload.client_request_id || value.operation !== (kind === 'create' ? 'created' : 'decided') || typeof value.replayed !== 'boolean' || !instant(value.recorded_at)) throw unavailable();
  if (kind === 'create') {
    if (detail.status !== 'pending' || detail.task_type !== payload.task_type || detail.notes !== payload.notes || detail.created_by_user_id !== actorId || detail.captured_ward_id !== context.current_ward_id || detail.captured_ward_name !== context.current_ward_name || detail.phase !== (context.admission_status === 'ready_for_activation' ? 'pre_activation' : 'post_activation')) throw unavailable();
  } else if (detail.version !== payload.expected_version + 1 || detail.task_type !== source.task_type || detail.notes !== source.notes || detail.phase !== source.phase || detail.created_at !== source.created_at || detail.captured_ward_id !== source.captured_ward_id || detail.captured_ward_name !== source.captured_ward_name || detail.created_by_user_id !== source.created_by_user_id || detail.created_by_display_name !== source.created_by_display_name
    || detail.status !== payload.decision || detail.decision.source !== 'manual' || (detail.decision.reason || null) !== payload.reason || detail.decision.recorded_by_user_id !== actorId || detail.decision.ward_id !== context.current_ward_id || detail.decision.ward_name !== context.current_ward_name) throw unavailable();
  return value;
}
