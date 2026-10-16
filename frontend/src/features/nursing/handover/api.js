import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { HANDOVER_FIELDS } from './model';

const id = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const time = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
function header(value, scope = {}) {
  if (!id(value?.id) || !id(value.patient_id) || !id(value.admission_case_id) || !id(value.ward_id) || !id(value.author_user_id)
    || (scope.patientId && value.patient_id !== scope.patientId) || (scope.admissionId && value.admission_case_id !== scope.admissionId) || (scope.id && value.id !== scope.id)
    || !['recorded', 'voided'].includes(value.status) || !['day', 'evening', 'night'].includes(value.shift_type) || !/^\d{4}-\d{2}-\d{2}$/.test(value.shift_date)
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || !time(value.created_at) || !time(value.updated_at)
    || !(value.intended_recipient_user_id === null || id(value.intended_recipient_user_id))) throw new Error('The handover scope or current revision could not be confirmed.');
  return value;
}
function revision(value, rootId) {
  if (!id(value?.id) || value.handover_id !== rootId || !Number.isSafeInteger(value.revision) || value.revision < 1 || !['recorded', 'amended', 'voided'].includes(value.kind) || !id(value.recorded_by_user_id) || !time(value.recorded_at) || typeof value.reason !== 'string'
    || !['day', 'evening', 'night'].includes(value.shift_type) || !/^\d{4}-\d{2}-\d{2}$/.test(value.shift_date) || !(value.intended_recipient_user_id === null || id(value.intended_recipient_user_id))
    || HANDOVER_FIELDS.some(([key, , max]) => typeof value.narrative?.[key] !== 'string' || [...value.narrative[key]].length > max) || !value.narrative.patient_condition.trim()) throw new Error('The handover evidence could not be confirmed.');
  return value;
}
export function handoverDetail(value, scope) { header(value, scope); revision(value.current, value.id); if (value.current.revision !== value.revision || (value.current.kind === 'voided') !== (value.status === 'voided') || value.current.shift_date !== value.shift_date || value.current.shift_type !== value.shift_type || value.current.intended_recipient_user_id !== value.intended_recipient_user_id) throw new Error('The handover header and evidence do not agree.'); return value; }
function page(response, query, validate) { const rows = response?.data; const p = response?.page; if (!Array.isArray(rows) || !p || typeof p.has_next !== 'boolean' || rows.length > (query.limit || 25) || (p.has_next && (!rows.length || !p.next_cursor || p.next_cursor === query.cursor)) || new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error('The handover page could not be confirmed.'); return { rows: rows.map(validate), hasNext: p.has_next, cursor: p.next_cursor || null }; }
function saved(value, command) {
  const { payload, kind, source, patientId, admissionId, actorId } = command;
  const detail = handoverDetail(value?.handover, { patientId, admissionId: kind === 'record' ? admissionId : source.admission_case_id, id: source?.id });
  if (value.client_request_id !== payload.client_request_id || typeof value.replayed !== 'boolean' || detail.author_user_id !== actorId || detail.current.recorded_by_user_id !== actorId || detail.revision !== (kind === 'record' ? 1 : payload.expected_revision + 1) || detail.current.kind !== ({ record: 'recorded', amend: 'amended', void: 'voided' })[kind]) throw new Error('The saved handover command could not be confirmed.');
  const expected = kind === 'void' ? source.current : payload;
  if (detail.current.shift_date !== expected.shift_date || detail.current.shift_type !== expected.shift_type || detail.current.intended_recipient_user_id !== expected.intended_recipient_user_id || HANDOVER_FIELDS.some(([key]) => detail.current.narrative[key] !== expected.narrative[key]) || detail.current.reason !== (payload.reason || '')) throw new Error('The saved handover differs from the reviewed command.');
  return value;
}
export class HandoverUnconfirmedError extends Error { constructor() { super('This handover change may already be saved. Keep the request unchanged and check its original saved result before another change.'); this.name = 'HandoverUnconfirmedError'; } }
export const handoverApi = {
  async list(query, { signal } = {}) { return page(await v2Api.getPatientHandovers({ query, signal }), query, (r) => header(r, { patientId: query.patient_id, admissionId: query.admission_case_id })); },
  async detail(rootId, scope, { signal } = {}) { return handoverDetail((await v2Api.getPatientHandover({ id: rootId }, { signal }))?.data, { ...scope, id: rootId }); },
  async history(rootId, query, { signal } = {}) { return page(await v2Api.getPatientHandoverHistory({ id: rootId }, { query, signal }), query, (r) => { if (!id(r.id) || r.handover_id !== rootId || !Number.isSafeInteger(r.revision) || !time(r.recorded_at) || !['recorded', 'amended', 'voided'].includes(r.kind)) throw new Error('The handover history could not be confirmed.'); return r; }); },
  async revision(rootId, revisionId, { signal } = {}) { const value = revision((await v2Api.getPatientHandoverRevision({ id: rootId, revision_id: revisionId }, { signal }))?.data, rootId); if (value.id !== revisionId) throw new Error('The selected historical revision could not be confirmed.'); return value; },
  async recipients(query, { signal } = {}) { return page(await v2Api.getPatientHandoverRecipients({ query, signal }), query, (r) => { if (!id(r.id) || !id(r.user_id) || typeof r.display_name !== 'string' || !r.display_name || typeof r.role_name !== 'string' || !time(r.assigned_at)) throw new Error('The intended recipient page could not be confirmed.'); return r; }); },
  async write(command, { signal } = {}) {
    let response;
    try { response = command.kind === 'record' ? await v2Api.postPatientHandover(command.payload, { signal }) : await v2Api[command.kind === 'amend' ? 'postPatientHandoverAmend' : 'postPatientHandoverVoid']({ id: command.source.id }, command.payload, { signal }); const receipt = saved(response?.data, command); acknowledgeWriteResponse(response); return receipt; }
    catch (error) { if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'patient_handover_write_unconfirmed') throw error; markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new HandoverUnconfirmedError(), response || error); }
  },
  async recover(command, { signal } = {}) { return saved((await v2Api.getPatientHandoverReceipt({ request_id: command.payload.client_request_id }, { query: { patient_id: command.patientId }, signal }))?.data, command); },
};
