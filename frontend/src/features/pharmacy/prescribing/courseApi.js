import { savedStockPolicy, scheduledPolicyMatches } from './scheduledStockPolicy';
import { v2Request } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';

const validId = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function prescriptionDetail(value, { id, patientId } = {}) {
  if (!validId(value?.id) || !validId(value.patient_id) || (id && value.id !== id) || (patientId && value.patient_id !== patientId)
    || !['active', 'on_hold', 'stopped', 'completed'].includes(value.status) || typeof value.medication_name !== 'string' || !value.medication_name
    || typeof value.dose !== 'string' || typeof value.route !== 'string' || typeof value.frequency !== 'string'
    || typeof value.instructions !== 'string' || typeof value.reason !== 'string' || !date(value.updated_at)
    || !/^[0-9a-f]{64}$/i.test(value.snapshot_token) || typeof value.has_generated_course !== 'boolean'
    || !(value.stock_unit === null || typeof value.stock_unit === 'string')
    || !(value.start_date === null || /^\d{4}-\d{2}-\d{2}$/.test(value.start_date))
    || !(value.duration_days === null || (Number.isSafeInteger(value.duration_days) && value.duration_days > 0))
    || !(value.first_dose_at === null || date(value.first_dose_at))
    || !(value.inventory_item_id === null || validId(value.inventory_item_id))
    || !(value.successor_prescription_id === null || validId(value.successor_prescription_id))
    || (value.scheduled_stock_policy != null && (!savedStockPolicy(value.scheduled_stock_policy) || value.prn_policy || value.frequency.trim().toLowerCase() === 'prn'))
    || (value.provenance && (!validId(value.provenance.source_prescription_id) || !['renewal', 'replacement'].includes(value.provenance.relation) || !date(value.provenance.recorded_at) || typeof value.provenance.change_reason !== 'string'))
    || (value.prn_policy && (!Number.isSafeInteger(value.prn_policy.minimum_interval_hours) || !Number.isSafeInteger(value.prn_policy.maximum_doses_per_24_hours) || !Number.isSafeInteger(value.prn_policy.stock_units_per_dose) || typeof value.prn_policy.indication !== 'string' || typeof value.prn_policy.stock_unit !== 'string'))) throw new Error('The current prescription details could not be confirmed.');
  return value;
}
export class PrescriptionActionUnconfirmedError extends Error { constructor() { super('This change may already be saved. Keep the request unchanged. Check its saved result or explicitly retry the same request.'); this.name = 'PrescriptionActionUnconfirmedError'; } }
const uncertain = (error) => !error?.status || error.status >= 500 || error.data?.error?.code === 'prescription_action_unconfirmed';
function documentationReceipt(value, source, payload) {
  const detail = prescriptionDetail(value?.prescription, { id: source.id, patientId: source.patient_id });
  if (value.client_request_id !== payload.client_request_id || typeof value.replayed !== 'boolean' || detail.instructions !== payload.instructions || detail.reason !== payload.reason
    || ['stock_unit', 'stock_units_per_dose'].some((key) => (detail.scheduled_stock_policy?.[key] ?? null) !== (source.scheduled_stock_policy?.[key] ?? null))
    || ['medication_name', 'dose', 'route', 'frequency', 'status', 'inventory_item_id', 'start_date', 'duration_days', 'first_dose_at'].some((key) => (detail[key] ?? null) !== (source[key] ?? null))) throw new PrescriptionActionUnconfirmedError();
  return value;
}
function courseReceipt(value, source, payload) {
  const detail = prescriptionDetail(value?.prescription, { patientId: source.patient_id });
  const after = payload.relation === 'replacement' ? 'stopped' : source.status;
  if (value.client_request_id !== payload.client_request_id || value.source_prescription_id !== source.id || value.relation !== payload.relation || value.source_status_before !== source.status || value.source_status_after !== after || !date(value.recorded_at) || typeof value.replayed !== 'boolean'
    || detail.id === source.id || detail.status !== 'active' || detail.has_generated_course || ['medication_name', 'dose', 'route', 'frequency', 'start_date', 'instructions', 'reason'].some((key) => detail[key] !== payload[key])
    || (detail.duration_days ?? null) !== (payload.duration_days ?? null) || (detail.inventory_item_id ?? null) !== (payload.inventory_item_id ?? null) || detail.stock_unit !== (payload.expected_stock_unit ?? null)
    || (payload.first_dose_at ? Date.parse(detail.first_dose_at) !== Date.parse(payload.first_dose_at) : detail.first_dose_at !== null)
    || ['encounter_id', 'visit_id'].some((key) => (detail[key] ?? null) !== (payload[key] ?? null))
    || detail.provenance?.source_prescription_id !== source.id || detail.provenance.relation !== payload.relation || detail.provenance.change_reason !== payload.change_reason) throw new PrescriptionActionUnconfirmedError();
  if (payload.scheduled_stock_policy ? !scheduledPolicyMatches(detail.scheduled_stock_policy, payload.scheduled_stock_policy) : detail.scheduled_stock_policy != null) throw new PrescriptionActionUnconfirmedError();
  if (payload.prn_policy) { const saved = detail.prn_policy; if (!saved || ['minimum_interval_hours', 'maximum_doses_per_24_hours', 'indication', 'stock_units_per_dose'].some((key) => saved[key] !== payload.prn_policy[key]) || saved.stock_unit !== payload.expected_stock_unit) throw new PrescriptionActionUnconfirmedError(); }
  else if (detail.prn_policy) throw new PrescriptionActionUnconfirmedError();
  return value;
}
async function write(request, validate) { let response; try { response = await request(); const saved = validate(response?.data); acknowledgeWriteResponse(response); return saved; } catch (error) { if (uncertain(error)) { markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new PrescriptionActionUnconfirmedError(), response || error); } throw error; } }
export const courseApi = {
  async detail(id, patientId, { signal } = {}) { return prescriptionDetail((await v2Request({ path: '/api/v2/clinical/prescriptions/{id}', pathParams: { id }, signal }))?.data, { id, patientId }); },
  documentation(source, payload, { signal } = {}) { return write(() => v2Request({ method: 'PATCH', path: '/api/v2/clinical/prescriptions/{id}/documentation', pathParams: { id: source.id }, body: payload, signal }), (value) => documentationReceipt(value, source, payload)); },
  course(source, payload, { signal } = {}) { return write(() => v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions/{id}/new-course', pathParams: { id: source.id }, body: payload, signal }), (value) => courseReceipt(value, source, payload)); },
  async recover(kind, source, payload, { signal } = {}) { const response = await v2Request({ path: `/api/v2/clinical/prescriptions/{id}/${kind === 'documentation' ? 'documentation' : 'new-course'}/requests/{request_id}`, pathParams: { id: source.id, request_id: payload.client_request_id }, signal }); return kind === 'documentation' ? documentationReceipt(response?.data, source, payload) : courseReceipt(response?.data, source, payload); },
};
