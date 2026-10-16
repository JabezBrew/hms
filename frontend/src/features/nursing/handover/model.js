export const HANDOVER_FIELDS = Object.freeze([
  ['patient_condition', 'Current condition', 4000],
  ['ongoing_issues', 'Ongoing issues', 2000],
  ['pending_tasks', 'Pending tasks for the next shift', 2000],
  ['medication_changes', 'Medication changes', 2000],
  ['key_events', 'Key events', 2000],
  ['care_plan_updates', 'Care plan updates', 2000],
  ['family_updates', 'Family communication', 2000],
]);
export const emptyHandover = () => ({ shift_date: new Date().toISOString().slice(0, 10), shift_type: '', intended_recipient_user_id: null, recipient_name: '', narrative: Object.fromEntries(HANDOVER_FIELDS.map(([key]) => [key, ''])), reason: '' });
export const draftFromSource = (source) => ({ shift_date: source.current.shift_date, shift_type: source.current.shift_type, intended_recipient_user_id: source.current.intended_recipient_user_id, recipient_name: source.current.intended_recipient_display_name || '', narrative: { ...source.current.narrative }, reason: '' });
export function handoverPayload(kind, form, { patientId, admissionId, source, requestId }) {
  if (!requestId || !patientId || (kind === 'record' && !admissionId)) throw new Error('A current patient and admission are required.');
  const payload = { client_request_id: requestId };
  if (kind !== 'record') { if (!source || source.status === 'voided') throw new Error('Reload a current handover before changing it.'); payload.expected_revision = source.revision; const reason = form.reason.trim(); if (!reason || [...reason].length > 2000) throw new Error('Record a reason using 2000 characters or fewer.'); payload.reason = reason; }
  if (kind === 'void') return payload;
  const day = form.shift_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('Choose a valid shift date (UTC).');
  if (!['day', 'evening', 'night'].includes(form.shift_type)) throw new Error('Choose the shift explicitly.');
  const narrative = Object.fromEntries(HANDOVER_FIELDS.map(([key, label, max]) => { const value = String(form.narrative[key] || '').trim(); if ((key === 'patient_condition' && !value) || [...value].length > max) throw new Error(`${label} ${key === 'patient_condition' ? 'is required and must use' : 'must use'} ${max} characters or fewer.`); return [key, value]; }));
  Object.assign(payload, { shift_date: day, shift_type: form.shift_type, intended_recipient_user_id: form.intended_recipient_user_id || null, narrative });
  if (kind === 'record') Object.assign(payload, { patient_id: patientId, admission_case_id: admissionId });
  return payload;
}
