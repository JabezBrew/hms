import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { consultationCommand, consultationContext, consultationSource, contextQuery, inputDigest, receiptEvidence, redactedIntent, startReceipt } from '../model';
import { actorId, appointment, at, context, encounter, encounterId, existingVisit, inpatient, inpatientSource, link, linked, otherId, requestId, scope, selected, source, visitId } from './fixtures';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const command = (sourceContext = selected, selection = source, override = null) => consultationCommand({ scope, source: sourceContext, selection, override, requestId, actorId });
async function receipt(input) { return { client_request_id: requestId, replayed: false, recorded_at: at, input_digest: await inputDigest(input.payload), reviewed_input: redactedIntent(input.payload), link: structuredClone(link) }; }

it('requires an explicit mode and explicit visit choice with no implicit context query defaults', () => {
  expect(contextQuery()).toEqual({}); expect(consultationContext(context, scope)).toBe(context);
  for (const invalid of [{}, { mode: 'new_outpatient' }, { mode: 'new_outpatient', visit: {} }, { ...source, encounter_id: encounterId }, { ...inpatientSource, admission_case_id: null }]) expect(() => consultationSource(invalid)).toThrow();
  expect(contextQuery(source)).toEqual({ mode: 'new_outpatient', visit_choice: 'no_visit' }); expect(contextQuery(existingVisit)).toEqual({ mode: 'new_outpatient', visit_choice: 'existing_visit', visit_id: visitId });
});
it('uses current source and start authority independently from resumable saved link evidence', () => {
  expect(consultationContext(linked, scope)).toBe(linked);
  expect(consultationContext({ ...context, can_issue_start_command: false }, scope).can_start).toBe(false);
  expect(() => consultationContext({ ...selected, can_issue_start_command: false }, scope, source)).toThrow();
  expect(() => consultationContext({ ...linked, can_resume: true, current_linked_encounter: { ...encounter, status: 'completed', ended_at: at } }, scope)).toThrow();
});
it.each(['patient', 'referral', 'encounter', 'visit', 'type', 'started', 'null-encounter'])('rejects wrong-but-valid linked %s rather than substituting an active encounter', fault => {
  const value = structuredClone(linked);
  if (fault === 'patient') value.patient_id = otherId;
  if (fault === 'referral') value.referral_id = otherId;
  if (fault === 'encounter') value.current_linked_encounter.id = otherId;
  if (fault === 'visit') value.current_linked_encounter.visit_id = otherId;
  if (fault === 'type') value.current_linked_encounter.encounter_type = 'inpatient';
  if (fault === 'started') value.current_linked_encounter.started_at = '2026-10-16T09:00:00Z';
  if (fault === 'null-encounter') value.current_linked_encounter = null;
  expect(() => consultationContext(value, scope)).toThrow();
});
it('keeps restricted override private in RAM and digests the complete exact intent', async () => {
  const restricted = { ...selected, can_override_restricted_record: true, selection: { ...selected.selection, restricted_override_required: true } };
  await expect(command(restricted)).rejects.toThrow();
  const input = await command(restricted, source, { reason_code: '  reviewed-intake ', reason_note: '  Synthetic private reason  ' });
  expect(input.payload.restricted_record_override).toEqual({ reason_code: 'reviewed-intake', reason_note: 'Synthetic private reason' });
  const result = await receipt(input); expect(JSON.stringify(result)).not.toContain('Synthetic private reason'); expect(result.reviewed_input.restricted_record_override).toEqual({ reason_code: 'reviewed-intake', reason_note_present: true });
  expect(await startReceipt(result, input)).toBe(result);
  expect(await inputDigest({ ...input.payload, restricted_record_override: { ...input.payload.restricted_record_override, reason_note: 'Different synthetic reason' } })).not.toBe(input.inputDigest);
  expect(receiptEvidence(result, scope, requestId, actorId)).toBe(result);
});
it('refuses unused restricted override and byte-overlong reason code or note', async () => {
  await expect(command(selected, source, { reason_code: 'reason', reason_note: null })).rejects.toThrow();
  const restricted = { ...selected, can_override_restricted_record: true, selection: { ...selected.selection, restricted_override_required: true } };
  await expect(command(restricted, source, { reason_code: 'é'.repeat(33), reason_note: null })).rejects.toThrow(/64 bytes/);
  await expect(command(restricted, source, { reason_code: 'reason', reason_note: 'é'.repeat(251) })).rejects.toThrow(/500 bytes/);
});
it.each(['inpatient', 'emergency', 'triage'])('preserves actual %s admission encounter and all original episode evidence', async type => {
  const before = { ...inpatient, selection: { ...inpatient.selection, encounter: { ...inpatient.selection.encounter, encounter_type: type } } }; const input = await command(before, inpatientSource);
  const result = await receipt(input); result.link = { ...result.link, source_mode: 'existing_admission_encounter', encounter_created: false, encounter_type: type, encounter_started_at: before.selection.encounter.started_at, visit_id: visitId, admission_case_id: inpatientSource.admission_case_id, admission_admitted_at: before.selection.admission.admitted_at, admission_placement_revision_at_start: 4 };
  expect(await startReceipt(result, input)).toBe(result); result.link.admission_placement_revision_at_start = 5; await expect(startReceipt(result, input)).rejects.toThrow();
});
it.each(['actor', 'uuid', 'digest', 'private-note', 'source', 'capability', 'visit'])('rejects malformed successful %s receipt as original success', async fault => {
  const input = await command(), result = await receipt(input);
  if (fault === 'actor') result.link.recorded_by_user_id = otherId;
  if (fault === 'uuid') result.client_request_id = otherId;
  if (fault === 'digest') result.input_digest = 'c'.repeat(64);
  if (fault === 'private-note') result.reviewed_input.restricted_record_override = { reason_code: 'reason', reason_note: 'Synthetic private note' };
  if (fault === 'source') result.link.source_referral_status = 'scheduled';
  if (fault === 'capability') result.can_start = true;
  if (fault === 'visit') result.link.visit_id = visitId;
  await expect(startReceipt(result, input)).rejects.toThrow();
});

it.each(['missing', 'wrong-patient', 'blank-name', 'blank-code', 'extra-chart'])('rejects %s protected consultation identity', fault => {
  const value = structuredClone(context);
  if (fault === 'missing') delete value.patient;
  if (fault === 'wrong-patient') value.patient.id = otherId;
  if (fault === 'blank-name') value.patient.display_name = ' ';
  if (fault === 'blank-code') value.patient.patient_code = '';
  if (fault === 'extra-chart') value.patient.date_of_birth = '2000-01-01';
  expect(() => consultationContext(value, scope)).toThrow();
});
it.each(['id', 'status', 'starts_at', 'ends_at', 'clinic_id', 'practitioner_user_id'])('binds scheduled receipt to the reviewed immutable appointment %s', async field => {
  const scheduled = { ...selected, referral: { ...selected.referral, status: 'scheduled', scheduled_appointment_id: appointment.id }, selection: { ...selected.selection, appointment: structuredClone(appointment) } };
  const input = await command(scheduled), result = await receipt(input);
  result.link = { ...result.link, source_referral_status: 'scheduled', resulting_referral_status: 'scheduled', scheduled_appointment_id: appointment.id, appointment_at_start: structuredClone(appointment) };
  expect(await startReceipt(result, input)).toBe(result);
  const changes = { id: visitId, status: 'checked_in', starts_at: '2026-10-17T09:01:00Z', ends_at: '2026-10-17T10:01:00Z', clinic_id: null, practitioner_user_id: null };
  result.link.appointment_at_start[field] = changes[field];
  await expect(startReceipt(result, input)).rejects.toThrow();
});
it('rejects an accepted start carrying a booking and a scheduled start missing original booking evidence', async () => {
  const input = await command(), accepted = await receipt(input);
  accepted.link.scheduled_appointment_id = appointment.id; accepted.link.appointment_at_start = appointment;
  expect(() => receiptEvidence(accepted, scope, requestId, actorId)).toThrow();
  const scheduled = { ...selected, referral: { ...selected.referral, status: 'scheduled', scheduled_appointment_id: appointment.id }, selection: { ...selected.selection, appointment } };
  const scheduledInput = await command(scheduled), result = await receipt(scheduledInput);
  result.link = { ...result.link, source_referral_status: 'scheduled', resulting_referral_status: 'scheduled', scheduled_appointment_id: appointment.id, appointment_at_start: null };
  await expect(startReceipt(result, scheduledInput)).rejects.toThrow();
});
