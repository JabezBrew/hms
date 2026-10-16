import { emptyScheduledStockForm, scheduledStockPolicyPayload, validateScheduledStockForm } from './scheduledStockPolicy';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { emptyPrnPolicyForm, prnPolicyPayload, validatePrnPolicyForm } from './prnPolicy';

export const PRESCRIBING_CAPABILITY = 'clinical_documentation.manage';
export const COURSE_ROUTES = ['oral', 'iv', 'im', 'sc', 'topical', 'inhaled', 'sublingual', 'rectal', 'ophthalmic', 'otic', 'nasal', 'transdermal', 'vaginal'];
export const COURSE_FREQUENCIES = ['once', 'daily', 'bid', 'tid', 'qid', 'q4h', 'q6h', 'q8h', 'q12h', 'qhs', 'stat', 'weekly'];
export const ROUTE_LABELS = { oral: 'Oral (PO)', iv: 'Intravenous (IV)', im: 'Intramuscular (IM)', sc: 'Subcutaneous (SC)', topical: 'Topical', inhaled: 'Inhaled', sublingual: 'Sublingual', rectal: 'Rectal', ophthalmic: 'Ophthalmic', otic: 'Otic', nasal: 'Nasal', transdermal: 'Transdermal', vaginal: 'Vaginal' };
export const FREQUENCY_LABELS = { once: 'Once', daily: 'Once daily', bid: 'Twice daily (BID)', tid: 'Three times daily (TID)', qid: 'Four times daily (QID)', q4h: 'Every 4 hours', q6h: 'Every 6 hours', q8h: 'Every 8 hours', q12h: 'Every 12 hours', qhs: 'At bedtime', stat: 'Immediately (STAT)', weekly: 'Weekly', prn: 'As needed (PRN)' };
export function prescribingScope(user, transport) { const context = user?.accessContext || {}; return hashQueryValue(JSON.stringify([transport, user?.id, user?.facilityCode, context.facility_id, context.active_profile, context.session_version, context.permission_version, [...(user?.adminAccess?.capabilities || user?.admin_access?.capabilities || [])].sort(), context.features, context.patient_visibility, context.auth_security])); }
export const isPrnSource = (source) => Boolean(source.prn_policy) || source.frequency?.trim().toLowerCase() === 'prn';
export const documentationAllowed = (source) => ['active', 'on_hold'].includes(source?.status) && !source.has_generated_course && !isPrnSource(source);
export const courseAllowed = (source, relation) => !source?.successor_prescription_id && (relation === 'renewal' ? ['stopped', 'completed'].includes(source?.status) : ['active', 'on_hold'].includes(source?.status));
export function emptyCourseDraft() { return { medication_name: '', dose: '', route: '', frequency: '', start_date: '', duration_days: '', first_dose_at: '', instructions: '', reason: '', change_reason: '', inventory_item_id: null, inventory_item_name: '', inventory_item_unit: '', inventory_item_controlled: false, ...emptyPrnPolicyForm(), ...emptyScheduledStockForm() }; }
export function reuseCourseDraft(source) {
  const draft = emptyCourseDraft();
  for (const key of ['medication_name', 'dose', 'route', 'frequency', 'instructions', 'reason']) draft[key] = source[key] || '';
  draft.route = String(source.route || '').trim().toLowerCase();
  draft.frequency = String(source.frequency || '').trim().toLowerCase();
  draft.duration_days = source.duration_days == null ? '' : String(source.duration_days);
  if (source.prn_policy) Object.assign(draft, { prn_minimum_interval_hours: String(source.prn_policy.minimum_interval_hours), prn_maximum_doses_per_24_hours: String(source.prn_policy.maximum_doses_per_24_hours), prn_indication: source.prn_policy.indication, prn_stock_units_per_dose: String(source.prn_policy.stock_units_per_dose) });
  return draft;
}
export function documentationPayload(form, source, id) {
  if (!documentationAllowed(source)) throw new Error('Documentation is locked for this course. Review a replacement course instead.');
  const instructions = form.instructions.trim(); const reason = form.reason.trim();
  if ([...instructions].length > 4000 || [...reason].length > 2000) throw new Error('Use at most 4000 characters for instructions and 2000 for the prescribing reason.');
  return { client_request_id: id, expected_snapshot_token: source.snapshot_token, instructions, reason };
}
function isoDay(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
export function coursePayload(form, source, relation, id) {
  if (!courseAllowed(source, relation)) throw new Error('The current source status does not allow this new course. Refresh and review it.');
  const fields = [['medication_name', 160], ['dose', 120], ['route', 120], ['frequency', 120], ['change_reason', 2000]];
  const payload = Object.fromEntries(fields.map(([key, max]) => { const value = String(form[key] || '').trim(); if (!value || [...value].length > max) throw new Error('Enter and review the complete medication, dose, route, frequency and reason for this new course.'); return [key, value]; }));
  if (!COURSE_ROUTES.includes(payload.route) || ![...COURSE_FREQUENCIES, 'prn'].includes(payload.frequency)) throw new Error('Choose an explicit route and frequency.');
  if (isPrnSource(source) !== (payload.frequency === 'prn')) throw new Error('Changing between scheduled and as-needed treatment is not available in a linked course.');
  if (!isoDay(form.start_date)) throw new Error('Choose the new course start date.');
  const instructions = String(form.instructions || '').trim(); const reason = String(form.reason || '').trim();
  if ([...instructions].length > 4000 || [...reason].length > 2000) throw new Error('Use at most 4000 characters for instructions and 2000 for the prescribing reason.');
  Object.assign(payload, { client_request_id: id, expected_snapshot_token: source.snapshot_token, relation, instructions, reason, start_date: form.start_date });
  if (form.duration_days !== '') { const days = Number(form.duration_days); if (!Number.isSafeInteger(days) || days < 1 || days > 2147483647) throw new Error('Duration must be a whole number of at least one day.'); payload.duration_days = days; }
  if (form.first_dose_at) { const time = new Date(`${form.first_dose_at}:00Z`); if (!Number.isFinite(time.getTime()) || time < new Date(`${form.start_date}T00:00:00Z`)) throw new Error('The first dose time must be at or after the new start date (UTC).'); payload.first_dose_at = time.toISOString(); }
  if (form.inventory_item_id) { if (!form.inventory_item_unit) throw new Error('Choose the stock item again to confirm its current unit.'); payload.inventory_item_id = form.inventory_item_id; payload.expected_stock_unit = form.inventory_item_unit; if (!isPrnSource(source)) { const errors = validateScheduledStockForm(form); if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]); payload.scheduled_stock_policy = scheduledStockPolicyPayload(form); } }
  if (isPrnSource(source)) { const errors = validatePrnPolicyForm(form); if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]); payload.prn_policy = prnPolicyPayload(form); }
  return payload;
}
