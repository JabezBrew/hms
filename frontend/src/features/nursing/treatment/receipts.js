import { evidenceUnavailable, stockPolicy, stopEvidence } from './contracts';
import { instant, integer, sameInstant, text, uuid } from './model';

const sameTime = sameInstant;
const samePolicy = (a, b) => stockPolicy(a) && a !== null && b !== null && a.stock_unit === b.stock_unit && a.stock_units_per_dose === b.stock_units_per_dose;
export function courseReceipt(value, command) {
  const { source, context, payload, actorId, kind, patientId, caseId } = command;
  if (value?.client_request_id !== payload.client_request_id || value.operation !== (kind === 'stop' ? 'stopped' : 'supply_window_created') || typeof value.replayed !== 'boolean' || value.patient_id !== patientId || value.admission_case_id !== caseId || value.course_id !== source.summary.id || value.prescription_id !== source.summary.prescription_id || value.recorded_by_user_id !== actorId || !text(value.recorded_by_display_name) || !instant(value.recorded_at)) throw evidenceUnavailable();
  const reviewed = value.reviewed_input;
  if (!reviewed || Object.keys(reviewed).length !== Object.keys(payload).length || Object.keys(payload).some((key) => ['expected_scheduled_through', 'scheduled_before'].includes(key) ? !sameTime(reviewed[key], payload[key]) : reviewed[key] !== payload[key])) throw evidenceUnavailable();
  if (kind === 'stop') {
    const result = stopEvidence(value.result);
    if (result.reason !== payload.reason || result.recorded_by_user_id !== actorId || result.recorded_by_display_name !== value.recorded_by_display_name || !sameTime(result.recorded_at, value.recorded_at) || result.ward_id !== context.current_ward_id || result.ward_name !== context.current_ward_name || result.source_status_at_stop !== source.summary.source_status) throw evidenceUnavailable();
  } else {
    const result = value.result; const rows = result?.created_doses;
    if (!sameTime(result?.previous_scheduled_through, payload.expected_scheduled_through) || !sameTime(result?.scheduled_through, payload.scheduled_before) || !uuid(result?.fulfillment_id) || !integer(result.created_dose_count) || result.created_dose_count < 1 || result.created_dose_count > 512 || !Array.isArray(rows) || rows.length !== result.created_dose_count || !samePolicy(result.scheduled_stock_policy, source.scheduled_stock_policy)) throw evidenceUnavailable();
    let previous = -Infinity;
    for (const row of rows) {
      const at = Date.parse(row?.scheduled_at);
      if (!uuid(row?.id) || !instant(row.scheduled_at) || !integer(row.dose_sequence) || row.dose_sequence < 1 || !samePolicy(row.scheduled_stock_policy, result.scheduled_stock_policy) || at < Date.parse(payload.expected_scheduled_through) || at >= Date.parse(payload.scheduled_before) || at <= previous) throw evidenceUnavailable();
      previous = at;
    }
    if (new Set(rows.map((row) => row.id)).size !== rows.length || new Set(rows.map((row) => row.dose_sequence)).size !== rows.length) throw evidenceUnavailable();
  }
  return value;
}
