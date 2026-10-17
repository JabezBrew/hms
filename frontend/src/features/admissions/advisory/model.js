export const ADVISORY_TYPES = Object.freeze({
  pharmacy_med_rec: 'Medication reconciliation', baseline_lab_followup: 'Baseline laboratory follow-up',
  infection_control: 'Infection control', dietary: 'Dietary support', social_work: 'Social work',
  transport: 'Transport', documents: 'Documents', other: 'Other follow-up',
});
export const ADVISORY_STATUS = Object.freeze({ pending: 'Pending', completed: 'Completed', acknowledged_unresolved: 'Acknowledged unresolved', cancelled: 'Cancelled' });
export const CASE_STATUS = Object.freeze({ ready_for_activation: 'Ready for activation', admitted: 'Admitted', discharge_pending: 'Discharge pending', discharged: 'Discharged', cancelled: 'Cancelled' });
export const DECISIONS = Object.freeze({ completed: 'Complete', acknowledged_unresolved: 'Acknowledge unresolved', cancelled: 'Cancel' });
export const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function reviewedText(value, max, required, label) {
  const text = String(value ?? '').trim();
  if ((required && !text) || [...text].length > max) throw new Error(`${label}${required ? ' is required and' : ''} must use ${max} characters or fewer.`);
  return text;
}
export function advisoryPayload(draft) {
  if (!uuid(draft.requestId) || !/^[0-9a-f]{64}$/i.test(draft.context?.context_token || '')) throw new Error('Reload the selected admission before reviewing this follow-up.');
  const base = { client_request_id: draft.requestId, expected_context_token: draft.context.context_token };
  if (draft.kind === 'create') {
    if (!Object.hasOwn(ADVISORY_TYPES, draft.taskType) || !draft.context.available_types.includes(draft.taskType)) throw new Error('Choose an available follow-up type.');
    return { ...base, task_type: draft.taskType, notes: reviewedText(draft.notes, 4000, true, 'Follow-up note') };
  }
  if (!Object.hasOwn(DECISIONS, draft.decision) || draft.source?.status !== 'pending' || !Number.isSafeInteger(draft.source.version)) throw new Error('Reload a pending follow-up before recording a decision.');
  return { ...base, expected_version: draft.source.version, decision: draft.decision, reason: reviewedText(draft.reason, 2000, draft.decision !== 'completed', 'Decision note') || null };
}
export function draftIsStale(draft, context) {
  return Boolean(draft && (draft.context.context_token !== context?.context_token || (draft.kind === 'create' && draft.taskType && !context?.available_types.includes(draft.taskType)) || (draft.kind === 'decision' && context?.advisories.find((row) => row.id === draft.source.id)?.version !== draft.source.version)));
}
export function patientLabel(patient) {
  const local = patient?.local_data || patient;
  return `${patient?.name || patient?.display_name || local?.name || 'Selected patient'} · ${local?.patient_code || local?.medical_record_number || local?.mrn || patient?.medical_record_number || patient?.code || 'Patient identifier unavailable'}`;
}
export const retirementLabel = (source) => ({ admission_case_cancelled: 'Retired when the admission case was cancelled', admission_discharged: 'Retired when the admission ended' })[source] || 'Recorded task decision';
