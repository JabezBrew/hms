export const COURSE_STATUS = ['active', 'on_hold', 'stopped', 'completed'];
export const COURSE_KIND = ['scheduled', 'prn', 'once', 'unrecognized'];
export const DOSE_STATUS = ['scheduled', 'administered', 'missed', 'refused', 'held'];
export const SUPPLY_STATUS = ['pending', 'partially_dispensed', 'dispensed', 'rejected', 'cancelled'];
export const SUPPLY_KIND = ['initial_generation', 'prn_aggregate', 'scheduled_window'];
export const ADMISSION_STATUS = ['ready_for_activation', 'admitted', 'discharge_pending', 'discharged', 'cancelled'];
export const UNAVAILABLE = {
  network_write_unavailable: 'This connection currently allows review only. Confirm current network access before making changes.',
  admission_inactive: 'This admission is not active. Its recorded courses remain available for review.',
  permission_denied: 'Current permission allows review only.',
  course_terminal: 'This admission course has ended. Review its recorded evidence or the source prescription.',
  source_not_active: 'The source prescription and admission course must both be active before adding scheduled doses.',
  source_changed: 'The source prescription no longer matches this captured course. Review the prescription before planning further doses.',
  stock_policy_review_required: 'The captured stock basis requires prescribing review.',
  stock_item_not_actionable: 'The linked stock item is unavailable for a new schedule.',
  stock_unit_changed: 'The stock unit changed. Review the prescription and its physical stock basis.',
  unsupported_schedule: 'This schedule cannot be extended here. Review the source prescription.',
  window_elapsed: 'The recorded schedule boundary has elapsed. Review the prescription rather than create past dose records.',
  generation_boundary_unavailable: 'The original schedule boundary could not be confirmed.',
};
export const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const token = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const instant = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
export function sameInstant(a, b) {
  const canonical = (value) => { const normalized = value.replace('+00:00', 'Z'); const [stem, fraction = ''] = normalized.slice(0, -1).split('.'); return `${stem}.${fraction.padEnd(9, '0')}Z`; };
  return instant(a) && instant(b) && canonical(a) === canonical(b);
}
export const integer = (value) => Number.isSafeInteger(value) && value >= 0;
export const nullable = (check, value) => value === null || check(value);
export const text = (value) => typeof value === 'string';
export const label = (value) => String(value || '').replaceAll('_', ' ');
export function utcTime(value) {
  if (!instant(value)) return 'Not recorded';
  let shown = value.replace('+00:00', 'Z').slice(0, -1).replace('T', ' ');
  if (shown.includes('.')) shown = shown.replace(/0+$/, '').replace(/\.$/, '');
  if (shown.endsWith(':00')) shown = shown.slice(0, -3);
  return `${shown} UTC`;
}
export function patientIdentity(patient) {
  const local = patient?.local_data;
  const details = local?.user_details || patient?.user_details;
  return {
    id: local?.id || patient?.id,
    name: patient?.name || patient?.display_name || [details?.first_name, details?.last_name].filter(Boolean).join(' ') || 'Patient Chronicle',
    code: local?.medical_record_number || patient?.medical_record_number || patient?.patient_code || patient?.mrn || 'Patient identifier unavailable',
  };
}
function reviewedText(value, maximum, required) {
  if (typeof value !== 'string') throw new Error('Enter the reviewed reason or note.');
  const normalized = value.trim();
  if (required && !normalized) throw new Error('Enter the reason for this admission-course change.');
  if (new TextEncoder().encode(normalized).length > maximum) throw new Error(required ? 'This reason is too long. Shorten it before reviewing.' : 'This note is too long. Shorten it before reviewing.');
  return normalized || null;
}
function reviewedTokens(source, context, clientRequestId) {
  if (!uuid(clientRequestId) || !token(source?.source_token) || !token(source?.course_token) || !token(source?.context_token) || source.context_token !== context?.context_token) throw new Error('Reload and review the current admission and course before continuing.');
  return { client_request_id: clientRequestId, expected_source_token: source.source_token, expected_course_token: source.course_token, expected_context_token: source.context_token };
}
export function commandPayload(kind, source, context, form, clientRequestId) {
  const payload = reviewedTokens(source, context, clientRequestId);
  if (!context.can_manage_courses) throw new Error('Current admission access allows review only.');
  if (kind === 'stop') {
    if (!source.can_stop_course) throw new Error(UNAVAILABLE[source.stop_unavailable_reason] || 'This course cannot be stopped with the current admission or access state.');
    return { ...payload, reason: reviewedText(form.reason, 2000, true) };
  }
  if (!source.can_request_schedule_window || source.summary.kind !== 'scheduled' || !instant(source.summary.scheduled_through)) throw new Error(UNAVAILABLE[source.window_unavailable_reason] || 'A new schedule window is unavailable.');
  const input = form.scheduled_before;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input || '')) throw new Error('Choose an explicit schedule cutoff in UTC.');
  const date = new Date(`${input}:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== input) throw new Error('Choose a valid schedule cutoff in UTC.');
  const start = Date.parse(source.summary.scheduled_through); const end = date.getTime();
  if (end <= start || end - start > 31 * 86400000) throw new Error('Choose a cutoff after the current boundary and within the next 31 elapsed days.');
  const maximum = source.supply_window_constraints?.scheduled_before_max;
  if (!instant(maximum) || end > Date.parse(maximum)) throw new Error('Choose a cutoff within the latest allowed limit. Reload the course if that limit changed.');
  return { ...payload, expected_scheduled_through: source.summary.scheduled_through, scheduled_before: date.toISOString(), note: reviewedText(form.note || '', 1000, false) };
}
