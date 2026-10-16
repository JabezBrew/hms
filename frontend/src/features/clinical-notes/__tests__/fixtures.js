export const ids = Array.from({ length: 25 }, (_, index) => `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
export const [patientId, noteId, actorId, templateId, revisionId, versionId, requestId, encounterId, admissionId, facilityId] = ids;
export const time = '2026-10-16T12:00:00Z';
export const body = 'Synthetic protected note narrative';
export const template = { id: templateId, title: 'Synthetic history template', note_type: 'doctor_note', is_active: true, version: 1, current_revision_id: revisionId, owner_user_id: actorId, owner_display_name: 'Synthetic clinician', can_manage: true, updated_at: time, body_template: JSON.stringify({ description: 'Synthetic usage', sections: [{ section: 'Assessment', type: 'text', required: true, default_text: 'Synthetic starter' }] }) };
export const revision = { id: revisionId, template_id: templateId, version: 1, title: template.title, note_type: template.note_type, body_template: template.body_template };
export const detail = { id: noteId, patient_id: patientId, encounter_id: encounterId, note_type: 'doctor_note', title: 'Synthetic recorded note', body, status: 'draft', version: 1, created_at: time, updated_at: time, author_user_id: actorId, author_display_name: 'Synthetic clinician', can_amend: true, template_revision: null };
export const recorded = { kind: 'record', patientId, actorId, payload: { client_request_id: requestId, template_revision_id: null, encounter_id: encounterId, note_type: 'doctor_note', title: detail.title, body } };
export function command(kind) {
  if (kind === 'record') return structuredClone(recorded);
  if (kind === 'amend') return { kind, patientId, actorId, source: structuredClone(detail), payload: { client_request_id: requestId, expected_version: 1, reason: 'Synthetic correction', body: 'Synthetic amended note' } };
  return { kind, actorId, source: kind === 'templateChange' ? structuredClone(template) : null, payload: { client_request_id: requestId, title: template.title, note_type: template.note_type, body_template: template.body_template, is_active: true, ...(kind === 'templateChange' ? { expected_version: 1, change_summary: 'Synthetic clarification' } : {}) } };
}
export function receipt(input = recorded) {
  const { kind, payload, source } = input;
  if (kind === 'record' || kind === 'amend') return { client_request_id: payload.client_request_id, action: kind === 'record' ? 'recorded' : 'amended', replayed: false, reason: kind === 'amend' ? payload.reason : null, note: { ...(source || detail), id: source?.id || noteId, title: source?.title || payload.title, note_type: source?.note_type || payload.note_type, encounter_id: source ? source.encounter_id : payload.encounter_id ?? null, template_revision: source?.template_revision || (payload.template_revision_id ? revision : null), body: payload.body, version: kind === 'amend' ? payload.expected_version + 1 : 1, status: kind === 'amend' ? 'amended' : 'draft', author_user_id: source ? source.author_user_id : input.actorId, can_amend: false } };
  return { client_request_id: payload.client_request_id, action: source ? 'changed' : 'created', replayed: false, template: { ...template, ...payload, id: source?.id || templateId, version: source ? payload.expected_version + 1 : 1, current_revision_id: source ? ids[12] : revisionId, owner_user_id: source ? source.owner_user_id : input.actorId, can_manage: false } };
}
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
export const page = (data, next = null) => json({ data, page: { has_next: Boolean(next), next_cursor: next } });
export const history = { id: versionId, note_id: noteId, version: 1, created_at: time, recorded_by_user_id: actorId, recorded_by_display_name: 'Synthetic clinician', edit_reason: null };
