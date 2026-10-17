import { ADMISSION_STATUS, COURSE_KIND, COURSE_STATUS, DOSE_STATUS, SUPPLY_KIND, SUPPLY_STATUS, UNAVAILABLE, instant, integer, nullable, sameInstant, text, token, uuid } from './model';

export const evidenceUnavailable = () => new Error('The selected admission medication-course evidence could not be confirmed. Reload before continuing.');
const bool = (value) => typeof value === 'boolean';
const optionalReason = (value) => value === null || Object.hasOwn(UNAVAILABLE, value);
export function stockPolicy(value) { return value === null || (text(value?.stock_unit) && value.stock_unit.trim() !== '' && integer(value.stock_units_per_dose) && value.stock_units_per_dose > 0); }
function prnPolicy(value) { return value === null || (stockPolicy(value) && integer(value.minimum_interval_hours) && value.minimum_interval_hours > 0 && integer(value.maximum_doses_per_24_hours) && value.maximum_doses_per_24_hours > 0 && text(value.indication)); }
export function contextEvidence(value, scope) {
  if (value?.patient_id !== scope.patientId || value.admission_case_id !== scope.caseId || !ADMISSION_STATUS.includes(value.admission_status) || !uuid(value.current_ward_id) || !text(value.current_ward_name) || !token(value.context_token) || value.can_view !== true || !bool(value.can_manage_courses) || !integer(value.generated_course_count) || value.coverage !== 'generated_courses_only' || !nullable((v) => ['network_write_unavailable', 'admission_inactive', 'permission_denied'].includes(v), value.management_unavailable_reason)) throw evidenceUnavailable();
  return value;
}
export function courseHeader(value, scope, id) {
  if (!uuid(value?.id) || (id && value.id !== id) || value.patient_id !== scope.patientId || value.admission_case_id !== scope.caseId || !uuid(value.prescription_id) || !COURSE_KIND.includes(value.kind) || !COURSE_STATUS.includes(value.status) || !COURSE_STATUS.includes(value.source_status)
    || !['medication_name', 'dose', 'route', 'frequency'].every((key) => text(value[key])) || !value.medication_name.trim() || !nullable(uuid, value.inventory_item_id)
    || !['first_dose_at', 'generation_window_start', 'generation_window_end', 'created_at'].every((key) => instant(value[key])) || !nullable(instant, value.scheduled_through) || !bool(value.has_local_stop) || !bool(value.has_reviewed_stock_policy)) throw evidenceUnavailable();
  return value;
}
const countKeys = ['generated_scheduled_doses', 'requested_prn_doses', 'supplied_doses', 'given_doses', 'awaiting_supply_doses', 'supplied_pending_doses', 'missed_doses', 'refused_doses', 'held_doses', 'explicit_non_given_doses', 'unrecorded_held_doses', 'issued_stock_unrecorded_doses'];
export function courseCounts(value) {
  if (!value || countKeys.some((key) => !integer(value[key])) || !nullable(integer, value.issued_stock_quantity) || !nullable((v) => text(v) && v.trim(), value.issued_stock_unit) || !nullable((v) => ['missing_evidence', 'mixed_units', 'quantity_overflow'].includes(v), value.stock_total_unavailable_reason) || value.days_of_supply !== null) throw evidenceUnavailable();
  const total = value.generated_scheduled_doses + value.requested_prn_doses;
  if (!integer(total) || ['supplied_doses', 'given_doses', 'awaiting_supply_doses', 'supplied_pending_doses', 'held_doses', 'missed_doses', 'refused_doses'].some((key) => value[key] > total)
    || value.issued_stock_unrecorded_doses > value.supplied_doses || value.unrecorded_held_doses > value.held_doses || (value.issued_stock_quantity > 0 && !value.issued_stock_unit)
    || ((value.issued_stock_unrecorded_doses > 0 || value.stock_total_unavailable_reason) && (value.issued_stock_quantity !== null || value.issued_stock_unit !== null))) throw evidenceUnavailable();
  return value;
}
export function stopEvidence(value) {
  if (!uuid(value?.id) || !text(value.reason) || !value.reason.trim() || !uuid(value.recorded_by_user_id) || !text(value.recorded_by_display_name) || !instant(value.recorded_at) || !uuid(value.ward_id) || !text(value.ward_name) || !COURSE_STATUS.includes(value.source_status_at_stop) || !integer(value.retired_pending_dose_count) || !integer(value.cancelled_fulfillment_count) || !token(value.retired_dose_membership_token)) throw evidenceUnavailable();
  return value;
}
export function courseDetail(value, scope, id) {
  courseHeader(value?.summary, scope, id);
  if (!['source_token', 'course_token', 'context_token'].every((key) => token(value[key])) || !text(value.source_instructions) || !text(value.source_reason) || !stockPolicy(value.scheduled_stock_policy) || !prnPolicy(value.prn_policy)
    || !['stock_item_name', 'stock_item_code', 'stock_item_current_unit'].every((key) => nullable(text, value[key])) || !bool(value.source_matches_course) || !bool(value.can_stop_course) || !bool(value.can_request_schedule_window) || !optionalReason(value.stop_unavailable_reason) || !optionalReason(value.window_unavailable_reason)) throw evidenceUnavailable();
  courseCounts(value.counts); if (value.local_stop !== null) stopEvidence(value.local_stop);
  const bounds = value.supply_window_constraints;
  if (bounds !== null && (!bounds || !instant(bounds.scheduled_from) || !instant(bounds.scheduled_before_max) || !sameInstant(bounds.scheduled_from, value.summary.scheduled_through) || Date.parse(bounds.scheduled_before_max) <= Date.parse(bounds.scheduled_from) || Date.parse(bounds.scheduled_before_max) - Date.parse(bounds.scheduled_from) > 31 * 86400000 || bounds.maximum_new_doses !== 512)) throw evidenceUnavailable();
  if (value.can_request_schedule_window && bounds === null) throw evidenceUnavailable();
  if ((value.can_stop_course && !['active', 'on_hold'].includes(value.summary.status)) || (value.can_request_schedule_window && (!value.source_matches_course || value.summary.kind !== 'scheduled' || value.summary.status !== 'active' || value.summary.source_status !== 'active' || value.scheduled_stock_policy === null))) throw evidenceUnavailable();
  if (value.summary.has_local_stop !== (value.local_stop !== null) || (value.summary.has_local_stop && (value.summary.status !== 'stopped' || value.can_stop_course || value.can_request_schedule_window))) throw evidenceUnavailable();
  return value;
}
function physicalPair(value) { return nullable(integer, value.dispensed_stock_quantity) && nullable((v) => text(v) && v.trim(), value.dispensed_stock_unit); }
export function courseDose(value) {
  if (!uuid(value?.id) || !instant(value.scheduled_at) || !nullable(integer, value.dose_sequence) || !DOSE_STATUS.includes(value.status) || !bool(value.is_dispensed) || !bool(value.prescription_held) || !physicalPair(value)
    || !['pharmacy_fulfillment_id', 'prn_request_id', 'outcome_recorded_by_user_id', 'local_stop_id'].every((key) => nullable(uuid, value[key]))
    || !['prn_indication', 'reason_not_given', 'administration_notes', 'outcome_recorded_by_display_name'].every((key) => nullable(text, value[key])) || !['dispensed_at', 'administered_at', 'outcome_recorded_at'].every((key) => nullable(instant, value[key]))) throw evidenceUnavailable();
  const member = value.original_request_membership;
  if (member !== null && (!member || member.medication_administration_id !== value.id || !instant(member.scheduled_at) || !nullable(integer, member.dose_sequence) || !nullable(uuid, member.pharmacy_fulfillment_id) || !DOSE_STATUS.includes(member.status_at_command) || !bool(member.was_dispensed) || !stockPolicy(member.scheduled_stock_policy))) throw evidenceUnavailable();
  return value;
}
export function supplyWindow(value) {
  if (!uuid(value?.id) || !SUPPLY_KIND.includes(value.kind) || !SUPPLY_STATUS.includes(value.status) || !instant(value.coverage_start) || !instant(value.coverage_end) || !['requested_dose_count', 'dispensed_dose_count', 'remaining_scheduled_unsupplied_dose_count'].every((key) => integer(value[key])) || value.dispensed_dose_count > value.requested_dose_count || value.remaining_scheduled_unsupplied_dose_count > value.requested_dose_count || !instant(value.created_at) || !nullable(instant, value.dispensed_at) || !['inventory_item_id', 'dispensing_location_id'].every((key) => nullable(uuid, value[key]))) throw evidenceUnavailable();
  return value;
}
export function coursePage(response, validate, query = {}) {
  const rows = response?.data; const page = response?.page;
  if (!Array.isArray(rows) || rows.length > (query.limit || 25) || !page || !bool(page.has_next) || (page.has_next && (!text(page.next_cursor) || !page.next_cursor || page.next_cursor === query.cursor)) || (!page.has_next && page.next_cursor !== null)) throw evidenceUnavailable();
  rows.forEach(validate); if (new Set(rows.map((row) => row.id)).size !== rows.length) throw evidenceUnavailable();
  return { rows, next: page.has_next ? page.next_cursor : null };
}
