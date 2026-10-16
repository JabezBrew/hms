import { expect, it } from 'vitest';
import { buildRoundDraft, roundWorkspace, validateRoundReceipt } from '../commandModel';
import { roundForm } from '../roundForm';
import { ids, patientId, admissionId, actor, workspace, receipt } from './command-fixtures';
const base = () => ({ ...roundForm(patientId, admissionId, null), renderedNote: 'Synthetic reviewed narrative' });
it('builds one complete patient/admission draft with no invented start date, due time or supply', () => {
  const form = base(); const body = buildRoundDraft(form, null, ids[8]);
  expect(body).toMatchObject({ client_request_id: ids[8], ward_round_id: null, expected_version: 0, admission_case_id: admissionId, rendered_note: form.renderedNote, actions: [] });
  expect(Object.keys(body).sort()).toEqual(['client_request_id','ward_round_id','expected_version','admission_case_id','note_sections','rendered_note','actions'].sort());
});
it.each(['prn', 'every 6 hours as needed'])('refuses implicit as-needed policy for %s', (frequency) => {
  const form = base(); form.medications = [{ medication_name: 'Synthetic', dose: '1 unit', route: 'oral', frequency, start_date: '2026-10-16' }];
  expect(() => buildRoundDraft(form, null, ids[8])).toThrow('prescription panel');
});
it('keeps explicit source snapshot decisions and refuses a missing source token', () => {
  const form = base(); form.medications = [{ prescription_id: ids[9], expected_snapshot_token: 'a'.repeat(64), status: 'on_hold' }];
  expect(buildRoundDraft(form, null, ids[8]).actions[0].payload).toEqual({ operation: 'status', prescription_id: ids[9], expected_snapshot_token: 'a'.repeat(64), status: 'on_hold' });
  delete form.medications[0].expected_snapshot_token; expect(() => buildRoundDraft(form, null, ids[8])).toThrow('current prescription');
});
it('requires every selected catalog item and explicit nursing instruction/time', () => {
  const form = base(); form.labOrders = [{ id: ids[10], kind: 'test', name: 'Synthetic test' }, { id: '', kind: 'panel' }];
  expect(() => buildRoundDraft(form, null, ids[8])).toThrow('selected laboratory');
  form.labOrders = []; form.nursingTasks = [{ title: 'Synthetic task', instruction: 'Synthetic instructions', due_at: '' }]; expect(() => buildRoundDraft(form, null, ids[8])).toThrow('due time');
});
it('preserves exact saved narrative and structured fields without parsing old free text', () => {
  const form = base(); const body = buildRoundDraft(form, null, ids[8]); const saved = receipt(body).ward_round;
  saved.note_sections.assessment = 'Synthetic structured assessment'; const reopened = roundForm(patientId, admissionId, saved);
  expect(reopened.renderedNote).toBe(saved.rendered_note); expect(reopened.preservedSections).toEqual(saved.note_sections); expect(buildRoundDraft(reopened, saved, ids[9])).toMatchObject({ rendered_note: saved.rendered_note, note_sections: saved.note_sections, expected_version: 1 });
});
it('validates exact full note/action receipt and rejects wrong valid context or reordered payload', () => {
  const wire = buildRoundDraft(base(), null, ids[8]); const command = { kind: 'draft', patientId, admissionId, actorId: actor.id, wire }; const saved = receipt(wire);
  expect(validateRoundReceipt(saved, command)).toBe(saved);
  expect(() => validateRoundReceipt({ ...saved, ward_round: { ...saved.ward_round, patient_id: ids[11] } }, command)).toThrow('could not be confirmed');
  expect(() => validateRoundReceipt({ ...saved, ward_round: { ...saved.ward_round, rendered_note: 'Synthetic different body' } }, command)).toThrow('could not be confirmed');
});
it('requires actual completing actor/time and the reviewed saved snapshot', () => {
  const wire = buildRoundDraft(base(), null, ids[8]); const draft = receipt(wire).ward_round;
  const command = { kind: 'commit', patientId, admissionId, actorId: actor.id, roundId: draft.id, wire: { client_request_id: ids[9], expected_version: 1 }, reviewed: { note_sections: draft.note_sections, rendered_note: draft.rendered_note, actions: [] } }; const saved = receipt(command.wire, 'commit', draft);
  expect(validateRoundReceipt(saved, command)).toBe(saved); saved.ward_round.signed_by_user_id = ids[11]; expect(() => validateRoundReceipt(saved, command)).toThrow('could not be confirmed');
});
it('rejects missing/stale admission facts instead of inferring active status', () => {
  const value = workspace(); expect(roundWorkspace(value, { patientId, admissionId })).toBe(value); delete value.admission_status; expect(() => roundWorkspace(value, { patientId, admissionId })).toThrow('could not be confirmed');
});
it('keeps earlier unknown targets unavailable rather than inventing medication or test names', () => {
  const wire = buildRoundDraft(base(), null, ids[8]); const saved = receipt(wire).ward_round; saved.actions = [{ id: ids[10], status: 'draft', action_type: 'prescription', title: null, payload: { operation: 'status', prescription_id: ids[9], expected_snapshot_token: 'a'.repeat(64), status: 'stopped' }, reviewed_targets: [] }];
  expect(roundForm(patientId, admissionId, saved).unsupportedActions).toHaveLength(1);
});

it('normalizes an explicitly reviewed copy of legacy section whitespace before receipt comparison', () => {
  const form = base(); form.preservedSections.assessment = '  Synthetic earlier assessment  '; form.preservedSections.clinical_readiness_blockers = [' Synthetic earlier readiness '];
  const wire = buildRoundDraft(form, null, ids[8]); expect(wire.note_sections.assessment).toBe('Synthetic earlier assessment'); expect(form.preservedSections.assessment).toBe('  Synthetic earlier assessment  ');
  expect(validateRoundReceipt(receipt(wire), { kind: 'draft', patientId, admissionId, actorId: actor.id, wire })).toBeDefined();
});
it('retains cancelled action evidence without recreating or requiring it as a new action', () => {
  const wire = buildRoundDraft(base(), null, ids[8]); const saved = receipt(wire); const row = { id: ids[10], ward_round_id: saved.ward_round.id, status: 'cancelled', action_type: 'nursing_task', title: 'Synthetic cancelled task', instruction: 'Synthetic earlier instructions', payload: { title: 'Synthetic cancelled task', instruction: 'Synthetic earlier instructions', due_at: '2026-10-16T05:00:00Z', task_type: 'ward_round', assigned_to_user_id: null }, reviewed_targets: [], position: null };
  saved.ward_round.actions.push(row); expect(roundForm(patientId, admissionId, saved.ward_round).nursingTasks).toHaveLength(0); expect(validateRoundReceipt(saved, { kind: 'draft', patientId, admissionId, actorId: actor.id, wire })).toBeDefined();
});

it('keeps a saved action order and precise first-dose evidence when restoring a draft', () => {
  const form = base(); const wire = buildRoundDraft(form, null, ids[8]); const saved = receipt(wire).ward_round;
  saved.actions = [{ id: ids[9], status: 'draft', action_type: 'nursing_task', payload: { title: 'Synthetic first task', instruction: 'Synthetic first instructions', due_at: '2026-10-16T05:00:00.123456Z', task_type: 'ward_round', assigned_to_user_id: null } }, { id: ids[10], status: 'draft', action_type: 'prescription', payload: { operation: 'start', medication_name: 'Synthetic scheduled source', dose: '1 unit', route: 'oral', frequency: 'daily', instructions: '', reason: '', start_date: '2026-10-16', duration_days: null, first_dose_at: '2026-10-16T05:00:00.123456Z' } }];
  const restored = roundForm(patientId, admissionId, saved); const next = buildRoundDraft(restored, saved, ids[11]);
  expect(next.actions.map((row) => row.action_type)).toEqual(['nursing_task', 'prescription']); expect(next.actions[0].payload.due_at).toBe(saved.actions[0].payload.due_at); expect(next.actions[1].payload.first_dose_at).toBe(saved.actions[1].payload.first_dose_at); expect(next.actions[0]).not.toHaveProperty('position');
});
it('requires a corresponding saved resource for every completed action, including exact source status identity', () => {
  const form = base(); form.nursingTasks = [{ title: 'Synthetic real task', instruction: 'Synthetic instructions', due_at: '2026-10-16T05:00:00Z' }]; const wire = buildRoundDraft(form, null, ids[8]); const draft = receipt(wire).ward_round;
  const command = { kind: 'commit', patientId, admissionId, actorId: actor.id, roundId: draft.id, wire: { client_request_id: ids[9], expected_version: 1 }, reviewed: { note_sections: draft.note_sections, rendered_note: draft.rendered_note, actions: wire.actions } }; const value = receipt(command.wire, 'commit', draft);
  expect(() => validateRoundReceipt(value, command)).toThrow('could not be confirmed');
  value.ward_round.actions[0].committed_resource_id = ids[10]; value.ward_round.actions[0].committed_resource_type = 'nursing_task'; const artifact = { resource_id: ids[10], resource_type: 'nursing_task', title: 'Synthetic real task' }; value.created_artifacts = [artifact]; value.ward_round.artifacts = [artifact]; expect(validateRoundReceipt(value, command)).toBe(value);
  value.created_artifacts = [{ ...artifact, resource_id: ids[11] }]; value.ward_round.artifacts = value.created_artifacts; expect(() => validateRoundReceipt(value, command)).toThrow('could not be confirmed');
  const payload = { operation: 'status', prescription_id: ids[9], expected_snapshot_token: 'a'.repeat(64), status: 'stopped' }; value.ward_round.actions[0].action_type = 'prescription'; value.ward_round.actions[0].payload = payload; value.ward_round.actions[0].reviewed_targets = [{ resource_type: 'prescription', resource_id: ids[9], display_name: 'Synthetic source', code: null, selected: true, prescription: { medication_name: 'Synthetic source', dose: '1 unit', route: 'oral', frequency: 'daily', status: 'active' } }]; value.ward_round.actions[0].committed_resource_type = 'prescription'; value.created_artifacts = [{ ...artifact, resource_type: 'prescription' }]; value.ward_round.artifacts = value.created_artifacts; command.reviewed.actions = [{ action_type: 'prescription', payload }]; expect(() => validateRoundReceipt(value, command)).toThrow('could not be confirmed');
});

it('rejects two completed actions claiming the same resource while an unrelated artifact masks the missing result', () => {
  const form = base(); form.nursingTasks = ['first', 'second'].map((name) => ({ title: `Synthetic ${name} task`, instruction: 'Synthetic instructions', due_at: '2026-10-16T05:00:00Z' }));
  const wire = buildRoundDraft(form, null, ids[8]); const draft = receipt(wire).ward_round;
  const command = { kind: 'commit', patientId, admissionId, actorId: actor.id, roundId: draft.id, wire: { client_request_id: ids[9], expected_version: 1 }, reviewed: { note_sections: draft.note_sections, rendered_note: draft.rendered_note, actions: wire.actions } };
  const value = receipt(command.wire, 'commit', draft);
  value.ward_round.actions.forEach((row) => { row.committed_resource_id = ids[10]; row.committed_resource_type = 'nursing_task'; });
  value.created_artifacts = [ids[10], ids[11]].map((resource_id) => ({ resource_id, resource_type: 'nursing_task', title: 'Synthetic task result' })); value.ward_round.artifacts = value.created_artifacts;
  expect(() => validateRoundReceipt(value, command)).toThrow('could not be confirmed');
  value.ward_round.actions[1].committed_resource_id = ids[11]; expect(validateRoundReceipt(value, command)).toBe(value);
});
