const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
const referrals = new Set(['sent', 'accepted', 'scheduled', 'declined', 'completed', 'cancelled']);
const encounters = new Set(['in_progress', 'completed', 'cancelled']);
const types = new Set(['outpatient', 'inpatient', 'emergency', 'triage']);
const visits = new Set(['waiting', 'called', 'in_triage', 'triaged', 'in_consultation', 'on_hold', 'ready_checkout', 'checked_out', 'no_show', 'cancelled']);
export const unavailableCopy = {
  selection_required: 'Choose an explicit consultation source before reviewing a start.',
  already_started: 'A consultation is already linked. Review its exact saved encounter.',
  start_authority_required: 'Current consultation start authority could not be confirmed.',
  practitioner_required: 'An active local practitioner profile is required to start this consultation.',
  referral_state_unavailable: 'The referral is not currently available for a new consultation start.',
  patient_intake_unavailable: 'New care intake is unavailable for this patient record.',
  restricted_override_authority_required: 'This restricted record requires current patient update authority and an explicit reviewed override.',
  selected_visit_unavailable: 'The exact selected visit is unavailable. No different visit was selected.',
  selected_admission_unavailable: 'The exact selected admission encounter is unavailable.',
  appointment_unavailable: 'The referral booking could not be confirmed for this selection.',
  source_inconsistent: 'The selected consultation source needs review before a start.',
};
export const validId = value => typeof value === 'string' && UUID.test(value) && value !== NIL;
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value));
const nullableId = value => value === null || validId(value);
const nullableDate = value => value === null || date(value);
const bytes = value => new TextEncoder().encode(value).length;
export const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
export async function inputDigest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
const invalid = () => new Error('The exact consultation evidence could not be confirmed. Refresh this patient and referral before continuing.');
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
export function consultationScope(scope) { if (!validId(scope?.patientId) || !validId(scope.referralId)) throw invalid(); return { patient_id: scope.patientId, referral_id: scope.referralId }; }
export function consultationSource(source) {
  if (source?.mode === 'new_outpatient') {
    if (!keys(source, ['mode', 'visit'])) throw invalid();
    if (source.visit?.choice === 'no_visit' && keys(source.visit, ['choice'])) return source;
    if (source.visit?.choice === 'existing_visit' && keys(source.visit, ['choice', 'visit_id']) && validId(source.visit.visit_id)) return source;
  }
  if (source?.mode === 'existing_admission_encounter' && keys(source, ['mode', 'admission_case_id', 'encounter_id']) && validId(source.admission_case_id) && validId(source.encounter_id)) return source;
  throw invalid();
}
export function contextQuery(source = null) {
  if (!source) return {};
  consultationSource(source);
  return source.mode === 'new_outpatient' ? { mode: source.mode, visit_choice: source.visit.choice, ...(source.visit.choice === 'existing_visit' ? { visit_id: source.visit.visit_id } : {}) } : { mode: source.mode, admission_case_id: source.admission_case_id, encounter_id: source.encounter_id };
}
export function encounterState(value, patientId) {
  if (!validId(value?.id) || value.patient_id !== patientId || !nullableId(value.visit_id) || !types.has(value.encounter_type) || !encounters.has(value.status) || !date(value.started_at) || !nullableDate(value.ended_at) || (value.status === 'in_progress' && value.ended_at !== null) || (value.status !== 'in_progress' && value.ended_at === null)) throw invalid();
  return value;
}
function appointmentEvidence(value) {
  if (!keys(value, ['id', 'status', 'starts_at', 'ends_at', 'clinic_id', 'practitioner_user_id']) || !validId(value.id) || !['scheduled', 'checked_in', 'completed', 'cancelled'].includes(value.status) || !date(value.starts_at) || !date(value.ends_at) || !nullableId(value.clinic_id) || !nullableId(value.practitioner_user_id)) throw invalid();
  return value;
}
export function startEvidence(value, scope) {
  consultationScope(scope);
  if (!validId(value?.id) || value.patient_id !== scope.patientId || value.referral_id !== scope.referralId || value.link_version !== 1 || !['new_outpatient', 'existing_admission_encounter'].includes(value.source_mode)
    || !validId(value.encounter_id) || !nullableId(value.visit_id) || !nullableId(value.admission_case_id) || !nullableId(value.scheduled_appointment_id) || typeof value.encounter_created !== 'boolean'
    || !types.has(value.encounter_type) || value.encounter_status_at_start !== 'in_progress' || !date(value.encounter_started_at) || !nullableDate(value.admission_admitted_at)
    || !(value.admission_placement_revision_at_start === null || (Number.isSafeInteger(value.admission_placement_revision_at_start) && value.admission_placement_revision_at_start >= 0))
    || !['accepted', 'scheduled'].includes(value.source_referral_status) || value.resulting_referral_status !== value.source_referral_status || !validId(value.recorded_by_user_id) || !validId(value.recorded_by_practitioner_profile_id) || !text(value.recorded_by_display_name) || !date(value.recorded_at)) throw invalid();
  if (value.source_referral_status === 'scheduled') {
    const appointment = appointmentEvidence(value.appointment_at_start);
    if (appointment.id !== value.scheduled_appointment_id || !['scheduled', 'checked_in'].includes(appointment.status)) throw invalid();
  } else if (value.scheduled_appointment_id !== null || value.appointment_at_start !== null) throw invalid();
  if (value.source_mode === 'new_outpatient') {
    if (!value.encounter_created || value.encounter_type !== 'outpatient' || value.admission_case_id !== null || value.admission_admitted_at !== null || value.admission_placement_revision_at_start !== null || value.encounter_started_at !== value.recorded_at) throw invalid();
  } else if (value.encounter_created || !validId(value.admission_case_id) || !date(value.admission_admitted_at) || !Number.isSafeInteger(value.admission_placement_revision_at_start)) throw invalid();
  if (value.visit_transition !== null) {
    if (value.source_mode !== 'new_outpatient' || value.visit_transition?.visit_id !== value.visit_id || !visits.has(value.visit_transition.before_status) || value.visit_transition.after_status !== 'in_consultation') throw invalid();
  }
  return value;
}
function checkedSelection(value, scope, source) {
  if (!value || !same(consultationSource(value.source), source) || typeof value.restricted_override_required !== 'boolean') throw invalid();
  if (value.encounter !== null) encounterState(value.encounter, scope.patientId);
  if (value.visit !== null && (!validId(value.visit?.id) || value.visit.patient_id !== scope.patientId || !nullableId(value.visit.appointment_id) || !nullableId(value.visit.clinic_id) || !visits.has(value.visit.status) || !date(value.visit.checked_in_at) || !nullableDate(value.visit.consultation_started_at))) throw invalid();
  if (value.appointment !== null) appointmentEvidence(value.appointment);
  if (source.mode === 'existing_admission_encounter') {
    const admission = value.admission;
    if (!admission || admission.id !== source.admission_case_id || admission.encounter_id !== source.encounter_id || !nullableId(admission.visit_id) || !['admitted', 'discharge_pending'].includes(admission.status) || !date(admission.admitted_at) || !Number.isSafeInteger(admission.placement_revision) || admission.placement_revision < 0 || !validId(admission.ward_id) || !text(admission.ward_name) || value.encounter?.id !== source.encounter_id || value.encounter.visit_id !== admission.visit_id) throw invalid();
  } else {
    if (value.admission !== null || value.encounter !== null) throw invalid();
    if (source.visit.choice === 'no_visit' && value.visit !== null) throw invalid();
    if (source.visit.choice === 'existing_visit' && value.visit?.id !== source.visit.visit_id) throw invalid();
  }
  return value;
}
export function consultationContext(value, scope, source = null) {
  consultationScope(scope);
  if (!keys(value?.patient, ['id', 'display_name', 'patient_code']) || value.patient.id !== scope.patientId || !text(value.patient.display_name) || !text(value.patient.patient_code)) throw invalid();
  if (value?.patient_id !== scope.patientId || value.referral_id !== scope.referralId || !referrals.has(value.referral?.status) || !text(value.referral.to_service) || !['routine', 'urgent', 'emergency'].includes(value.referral.priority) || !nullableId(value.referral.scheduled_appointment_id)
    || ![0, 1].includes(value.link_version) || !TOKEN.test(value.context_token) || ['can_start', 'can_resume', 'can_issue_start_command', 'can_override_restricted_record'].some(key => typeof value[key] !== 'boolean') || !(value.unavailable_reason === null || Object.hasOwn(unavailableCopy, value.unavailable_reason))) throw invalid();
  if (value.link === null) { if (value.link_version !== 0 || value.current_linked_encounter !== null || value.can_resume) throw invalid(); }
  else {
    startEvidence(value.link, scope); const encounter = encounterState(value.current_linked_encounter, scope.patientId);
    if (value.link_version !== 1 || encounter.id !== value.link.encounter_id || encounter.visit_id !== value.link.visit_id || encounter.encounter_type !== value.link.encounter_type || encounter.started_at !== value.link.encounter_started_at || value.can_start || (value.can_resume && encounter.status !== 'in_progress')) throw invalid();
  }
  if (source) { if (value.selection !== null) checkedSelection(value.selection, scope, source); }
  else if (value.selection !== null || value.can_start) throw invalid();
  if (value.can_start && (!value.selection || value.link_version !== 0 || !value.can_issue_start_command || value.unavailable_reason !== null || !['accepted', 'scheduled'].includes(value.referral.status))) throw invalid();
  if (value.can_start && (value.referral.status === 'accepted' ? value.referral.scheduled_appointment_id !== null || value.selection.appointment !== null : value.selection.appointment?.id !== value.referral.scheduled_appointment_id || !['scheduled', 'checked_in'].includes(value.selection.appointment?.status))) throw invalid();
  if (!value.can_start && value.unavailable_reason === null) throw invalid();
  return value;
}
export function restrictedOverride(value) {
  if (value === null) return null;
  if (!keys(value, ['reason_code', 'reason_note']) || !text(value.reason_code)) throw new Error('Enter the required existing override reason code.');
  const code = value.reason_code.trim(), note = typeof value.reason_note === 'string' ? value.reason_note.trim() || null : null;
  if (bytes(code) > 64 || (note !== null && bytes(note) > 500)) throw new Error('Keep the reason code within 64 bytes and the optional note within 500 bytes.');
  return { reason_code: code, reason_note: note };
}
export function redactedIntent(payload) { return { ...payload, restricted_record_override: payload.restricted_record_override ? { reason_code: payload.restricted_record_override.reason_code, reason_note_present: payload.restricted_record_override.reason_note !== null } : null }; }
export async function consultationCommand({ scope, source, selection, override = null, requestId, actorId }) {
  consultationContext(source, scope, selection); consultationSource(selection);
  const reviewedOverride = restrictedOverride(override);
  if (!source.can_start || !validId(requestId) || !validId(actorId) || !same(source.selection?.source, selection) || (source.selection.restricted_override_required && (!source.can_override_restricted_record || !reviewedOverride)) || (!source.selection.restricted_override_required && reviewedOverride)) throw new Error('Choose and review a currently eligible explicit consultation source before starting.');
  const payload = { client_request_id: requestId, expected_link_version: 0, expected_context_token: source.context_token, source: selection, restricted_record_override: reviewedOverride };
  return { ...scope, actorId, source, payload, inputDigest: await inputDigest(payload) };
}
export async function validateCommand(command) {
  const expected = await consultationCommand({ scope: command, source: command.source, selection: command.payload?.source, override: command.payload?.restricted_record_override ?? null, requestId: command.payload?.client_request_id, actorId: command.actorId });
  if (!same(expected.payload, command.payload) || expected.inputDigest !== command.inputDigest) throw invalid();
  return command;
}
export async function startReceipt(value, command) {
  const link = startEvidence(value?.link, command), payload = command.payload, original = command.source;
  if (value.client_request_id !== payload.client_request_id || typeof value.replayed !== 'boolean' || value.recorded_at !== link.recorded_at || value.input_digest !== await inputDigest(payload) || !same(value.reviewed_input, redactedIntent(payload)) || link.recorded_by_user_id !== command.actorId || link.source_mode !== payload.source.mode || link.source_referral_status !== original.referral.status || link.scheduled_appointment_id !== original.referral.scheduled_appointment_id || !same(link.appointment_at_start, original.selection.appointment) || ['can_start', 'can_resume', 'can_issue_start_command', 'can_override_restricted_record'].some(key => value[key] === true)) throw invalid();
  if (payload.source.mode === 'new_outpatient') {
    const chosen = payload.source.visit.choice === 'existing_visit' ? payload.source.visit.visit_id : null;
    if (link.visit_id !== chosen || (chosen === null && link.visit_transition !== null) || (chosen !== null && link.visit_transition?.before_status !== original.selection.visit.status)) throw invalid();
  } else {
    const before = original.selection;
    if (link.encounter_id !== payload.source.encounter_id || link.admission_case_id !== payload.source.admission_case_id || link.visit_id !== before.encounter.visit_id || link.encounter_type !== before.encounter.encounter_type || link.encounter_started_at !== before.encounter.started_at || link.admission_admitted_at !== before.admission.admitted_at || link.admission_placement_revision_at_start !== before.admission.placement_revision || link.visit_transition !== null) throw invalid();
  }
  return value;
}
export function receiptEvidence(value, scope, requestId, actorId) {
  const link = startEvidence(value?.link, scope), intent = value.reviewed_input;
  if (value.client_request_id !== requestId || !validId(requestId) || typeof value.replayed !== 'boolean' || value.recorded_at !== link.recorded_at || link.recorded_by_user_id !== actorId || !TOKEN.test(value.input_digest) || !keys(intent, ['client_request_id', 'expected_link_version', 'expected_context_token', 'source', 'restricted_record_override']) || intent.client_request_id !== requestId || intent.expected_link_version !== 0 || !TOKEN.test(intent.expected_context_token)) throw invalid();
  const source = consultationSource(intent.source), override = intent.restricted_record_override;
  if (override !== null && (!keys(override, ['reason_code', 'reason_note_present']) || !text(override.reason_code) || override.reason_code !== override.reason_code.trim() || bytes(override.reason_code) > 64 || typeof override.reason_note_present !== 'boolean')) throw invalid();
  if (source.mode !== link.source_mode || (source.mode === 'new_outpatient' && link.visit_id !== (source.visit.choice === 'existing_visit' ? source.visit.visit_id : null)) || (source.mode === 'existing_admission_encounter' && (source.encounter_id !== link.encounter_id || source.admission_case_id !== link.admission_case_id)) || ['can_start', 'can_resume', 'can_issue_start_command', 'can_override_restricted_record'].some(key => value[key] === true)) throw invalid();
  return value;
}
