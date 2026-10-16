export const ids = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
export const [rootId, patientId, admissionId, actorId, wardId, revisionId, requestId, recipientId, otherPatient, otherAdmission] = ids;
export const narrative = { patient_condition: 'Synthetic handover condition', ongoing_issues: 'Synthetic ongoing issues', pending_tasks: 'Synthetic pending tasks', medication_changes: 'Synthetic medication documentation', key_events: 'Synthetic key event', care_plan_updates: 'Synthetic care plan', family_updates: 'Synthetic family communication' };
export const payload = { client_request_id: requestId, patient_id: patientId, admission_case_id: admissionId, shift_date: '2026-10-16', shift_type: 'night', intended_recipient_user_id: null, narrative };
export const header = { id: rootId, patient_id: patientId, admission_case_id: admissionId, ward_id: wardId, ward_name: 'Synthetic ward', author_user_id: actorId, author_display_name: 'Synthetic nurse', shift_date: payload.shift_date, shift_type: payload.shift_type, intended_recipient_user_id: null, intended_recipient_display_name: null, status: 'recorded', revision: 1, created_at: '2026-10-16T08:00:00Z', updated_at: '2026-10-16T08:00:00Z' };
export const current = { id: revisionId, handover_id: rootId, revision: 1, kind: 'recorded', shift_date: payload.shift_date, shift_type: payload.shift_type, intended_recipient_user_id: null, intended_recipient_display_name: null, narrative, reason: '', recorded_by_user_id: actorId, recorded_by_display_name: 'Synthetic nurse', recorded_at: header.created_at };
export const detail = { ...header, current };
export const command = { kind: 'record', payload, patientId, admissionId, actorId, source: null };
export const receipt = (cmd = command) => {
  const p = cmd.payload; const kind = { record: 'recorded', amend: 'amended', void: 'voided' }[cmd.kind]; const number = cmd.kind === 'record' ? 1 : p.expected_revision + 1;
  const values = cmd.kind === 'void' ? cmd.source.current : p;
  return { client_request_id: p.client_request_id, replayed: false, handover: { ...header, shift_date: values.shift_date, shift_type: values.shift_type, intended_recipient_user_id: values.intended_recipient_user_id, revision: number, status: cmd.kind === 'void' ? 'voided' : 'recorded', current: { ...current, revision: number, kind, shift_date: values.shift_date, shift_type: values.shift_type, intended_recipient_user_id: values.intended_recipient_user_id, narrative: values.narrative, reason: p.reason || '' } } };
};
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
export const page = (rows, next = null) => json({ data: rows, page: { has_next: Boolean(next), next_cursor: next, limit: 25 } });
