const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value, name, max, required = false) => {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) throw new Error(`Review ${name} before saving the round.`);
  return result;
};
const nullable = (value) => value || null;
const types = ['prescription', 'lab_order', 'nursing_task', 'discharge_request'];
const permissions = ['can_view', 'can_edit_draft', 'can_commit', 'can_add_prescription', 'can_order_labs', 'can_create_nursing_task', 'can_request_discharge', 'read_only'];
const statuses = ['ready_for_activation', 'admitted', 'discharge_pending', 'discharged', 'cancelled'];
const unavailable = () => new Error('The selected admission and round evidence could not be confirmed. Refresh before continuing.');
export function normalizeRoundSections(sections) {
  return { ...Object.fromEntries(['interval_history', 'examination', 'assessment', 'plan'].map((key) => [key, sections[key] === null ? null : text(sections[key], key.replaceAll('_', ' '), 8000)])), clinical_readiness_blockers: sections.clinical_readiness_blockers.map((value) => text(value, 'structured readiness note', 1000, true)) };
}
export const emptyRoundNote = () => ({ overnight_events: '', examination: '', assessment: '', plan: '', summary: '' });
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function validPermissions(value) { return value && permissions.every((key) => typeof value[key] === 'boolean'); }
function validTarget(value) {
  if (!uuid(value?.resource_id) || !['prescription', 'lab_test', 'lab_panel'].includes(value.resource_type) || typeof value.display_name !== 'string' || !value.display_name.trim() || !(value.code === null || typeof value.code === 'string') || typeof value.selected !== 'boolean') return false;
  if (value.resource_type !== 'prescription') return value.prescription === null;
  return value.prescription && ['medication_name', 'dose', 'route', 'frequency'].every((key) => typeof value.prescription[key] === 'string') && ['active', 'on_hold', 'stopped', 'completed'].includes(value.prescription.status);
}
function reviewedTargetsMatch(action) {
  if (!Array.isArray(action.reviewed_targets) || !action.reviewed_targets.every(validTarget)) return false;
  const selected = action.reviewed_targets.filter((row) => row.selected);
  if (action.action_type === 'prescription' && action.payload.operation === 'status') return selected.length === 1 && selected[0].resource_type === 'prescription' && selected[0].resource_id === action.payload.prescription_id;
  if (action.action_type === 'lab_order') {
    const expected = [...(action.payload.test_ids || []).map((id) => `lab_test:${id}`), ...(action.payload.panel_ids || []).map((id) => `lab_panel:${id}`)].sort();
    return canonical(selected.map((row) => `${row.resource_type}:${row.resource_id}`).sort()) === canonical(expected);
  }
  return selected.length === 0;
}
export function roundDetail(value, { patientId, admissionId, id } = {}) {
  if (!uuid(value?.id) || (id && value.id !== id) || value.patient_id !== patientId || value.admission_case_id !== admissionId
    || !['draft', 'committed'].includes(value.status) || !Number.isSafeInteger(value.version) || value.version < 1
    || !validPermissions(value.permissions) || !instant(value.created_at) || !instant(value.updated_at)
    || !(value.signed_at === null || instant(value.signed_at)) || !(value.rendered_note === null || typeof value.rendered_note === 'string')
    || !value.note_sections || !['interval_history', 'examination', 'assessment', 'plan'].every((key) => value.note_sections[key] === null || typeof value.note_sections[key] === 'string')
    || !Array.isArray(value.note_sections.clinical_readiness_blockers) || !value.note_sections.clinical_readiness_blockers.every((item) => typeof item === 'string')
    || !Array.isArray(value.actions) || value.actions.length > 100 || new Set(value.actions.map((item) => item.id)).size !== value.actions.length
    || !value.actions.every((item) => uuid(item.id) && item.ward_round_id === value.id && types.includes(item.action_type) && ['draft', 'committed', 'cancelled'].includes(item.status) && item.payload && typeof item.payload === 'object' && Array.isArray(item.reviewed_targets) && item.reviewed_targets.every(validTarget))
    || !Array.isArray(value.artifacts) || !value.artifacts.every((item) => uuid(item.resource_id) && typeof item.resource_type === 'string' && typeof item.title === 'string')) throw unavailable();
  return value;
}
export function roundWorkspace(value, context) {
  if (value?.patient_id !== context.patientId || value.admission_case_id !== context.admissionId || !statuses.includes(value.admission_status) || !uuid(value.ward_id) || (!validPermissions(value.permissions) || value.permissions.can_view !== true)) throw unavailable();
  if (value.ward_round !== null) roundDetail(value.ward_round, context);
  return value;
}
function scheduledAction(medication) {
  const frequency = text(medication.frequency, 'medication frequency', 120, true);
  if (/\b(prn|as\s+needed|when\s+required)\b/i.test(frequency)) throw new Error('Use the prescription panel to review an as-needed policy before prescribing.');
  const start = medication.start_date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(start || '') ? new Date(`${start}T00:00:00.000Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) throw new Error('Choose the prescription start date.');
  const duration = medication.duration_days === '' || medication.duration_days == null ? null : Number(medication.duration_days);
  if (duration !== null && (!Number.isSafeInteger(duration) || duration < 1 || duration > 2147483647)) throw new Error('Choose a supported positive whole number of prescription days.');
  if (medication.first_dose_at && !instant(medication.first_dose_at)) throw new Error('Choose a valid first dose time.');
  return { action_type: 'prescription', payload: { operation: 'start', medication_name: text(medication.medication_name, 'medication name', 160, true), dose: text(medication.dose, 'dose', 120, true), route: text(medication.route, 'route', 120, true), frequency, instructions: text(medication.instructions, 'medication instructions', 4000), reason: text(medication.reason, 'prescribing reason', 2000), start_date: start, duration_days: duration, first_dose_at: medication.first_dose_at ? (/Z$/.test(medication.first_dose_at) ? medication.first_dose_at : new Date(medication.first_dose_at).toISOString().replace('.000Z', 'Z')) : null } };
}
export function buildRoundDraft(form, current = null, requestId = crypto.randomUUID()) {
  if (!uuid(form.patientId) || !uuid(form.admissionId) || !uuid(requestId)) throw new Error('Select an admission before saving a ward round.');
  if (form.unsupportedActions?.length) throw new Error('Review and explicitly remove unsupported earlier actions before saving this draft.');
  const note = form.note || {};
  const sections = normalizeRoundSections(form.preservedSections || { interval_history: nullable(text(note.overnight_events, 'overnight events', 8000)), examination: nullable(text(note.examination, 'examination', 8000)), assessment: nullable(text(note.assessment, 'assessment', 8000)), plan: nullable(text(note.plan || note.summary, 'plan', 8000)), clinical_readiness_blockers: form.discharge?.note?.trim() ? [text(form.discharge.note, 'discharge readiness', 1000)] : [] });
  const rendered = [['Overnight events', sections.interval_history], ['Examination', sections.examination], ['Assessment', sections.assessment], ['Plan', sections.plan], ['Summary', text(note.summary, 'summary', 8000)], ['Discharge readiness', sections.clinical_readiness_blockers.join('\n')]].filter(([, body]) => body).map(([heading, body]) => `${heading.toUpperCase()}\n${body}`).join('\n\n');
  const staged = [];
  const append = (action, position) => staged.push({ action, position: Number.isInteger(position) ? position : Number.MAX_SAFE_INTEGER });
  for (const medication of form.medications || []) {
    if (!medication.prescription_id) append(scheduledAction(medication), medication.position);
    else {
      if (!uuid(medication.prescription_id) || !/^[0-9a-f]{64}$/i.test(medication.expected_snapshot_token || '') || !['active', 'on_hold', 'stopped', 'completed'].includes(medication.status)) throw new Error('Refresh and explicitly review the current prescription before adding its decision.');
      append({ action_type: 'prescription', payload: { operation: 'status', prescription_id: medication.prescription_id, expected_snapshot_token: medication.expected_snapshot_token, status: medication.status } }, medication.position);
    }
  }
  if (form.labOrders?.length) {
    if (form.labOrders.length > 100 || !form.labOrders.every((row) => uuid(row.id) && ['test', 'panel'].includes(row.kind)) || new Set(form.labOrders.map((row) => `${row.kind}:${row.id}`)).size !== form.labOrders.length) throw new Error('Review each selected laboratory test or panel.');
    append({ action_type: 'lab_order', payload: { test_ids: form.labOrders.filter((row) => row.kind === 'test').map((row) => row.id), panel_ids: form.labOrders.filter((row) => row.kind === 'panel').map((row) => row.id), priority: form.labPriority || 'routine' } }, form.labPosition);
  }
  for (const task of form.nursingTasks || []) {
    if (!instant(task.due_at)) throw new Error('Choose a due time for every nursing task.');
    append({ action_type: 'nursing_task', payload: { title: text(task.title, 'task title', 240, true), instruction: text(task.instruction, 'task instruction', 4000, true), due_at: (/Z$/.test(task.due_at) ? task.due_at : new Date(task.due_at).toISOString().replace('.000Z', 'Z')), task_type: 'ward_round', assigned_to_user_id: null } }, task.position);
  }
  if (form.discharge?.request_discharge) append({ action_type: 'discharge_request', payload: {} }, form.dischargePosition);
  const actions = staged.sort((left, right) => left.position - right.position).map((row) => row.action);
  if (actions.length > 100) throw new Error('A round can include at most 100 reviewed actions.');
  const narrative = Object.hasOwn(form, 'renderedNote') ? text(form.renderedNote, 'round note', 32000) : rendered || null;
  return { client_request_id: requestId, ward_round_id: current?.id ?? null, expected_version: current?.version ?? 0, admission_case_id: form.admissionId, note_sections: sections, rendered_note: narrative, actions };
}
export function validateRoundReceipt(value, command) {
  const detail = roundDetail(value?.ward_round, { patientId: command.patientId, admissionId: command.admissionId, id: command.roundId || command.wire.ward_round_id });
  const draft = command.kind === 'draft'; const wire = command.wire;
  const active = detail.actions.filter((row) => row.status === (draft ? 'draft' : 'committed'));
  if (value.client_request_id !== wire.client_request_id || value.operation !== (draft ? 'saved_draft' : 'committed') || typeof value.replayed !== 'boolean'
    || detail.status !== (draft ? 'draft' : 'committed') || detail.version !== wire.expected_version + 1 || !Array.isArray(value.created_artifacts)
    || !active.every((row, index) => row.position === index && reviewedTargetsMatch(row))
    || (draft && !active.every((row) => row.committed_resource_id === null && row.committed_resource_type === null))
    || (!draft && (!instant(detail.signed_at) || detail.signed_by_user_id !== command.actorId))
    || (draft && value.created_artifacts.length !== 0)
    || (!draft && !confirmedArtifacts(active, value.created_artifacts, detail.artifacts))) throw unavailable();
  const reviewed = draft ? wire : command.reviewed;
  if (!reviewed || canonical(detail.note_sections) !== canonical(reviewed.note_sections) || detail.rendered_note !== reviewed.rendered_note
    || canonical(active.map((row) => ({ action_type: row.action_type, payload: row.payload }))) !== canonical(reviewed.actions)) throw unavailable();
  return value;
}

function confirmedArtifacts(actions, created, retained) {
  if (created.length !== actions.length || retained.length !== actions.length) return false;
  const resourceType = { prescription: 'prescription', lab_order: 'lab_order', nursing_task: 'nursing_task', discharge_request: 'discharge_case' };
  const key = (row) => `${row.resource_type}:${row.resource_id}`;
  const createdKeys = new Set(created.map(key));
  if (createdKeys.size !== created.length) return false;
  if (new Set(actions.map((row) => `${row.committed_resource_type}:${row.committed_resource_id}`)).size !== actions.length) return false;
  const sorted = (rows) => rows.map((row) => ({ resource_id: row.resource_id, resource_type: row.resource_type, title: row.title })).sort((left, right) => key(left).localeCompare(key(right)));
  if (canonical(sorted(created)) !== canonical(sorted(retained))) return false;
  return actions.every((row) => uuid(row.committed_resource_id) && row.committed_resource_type === resourceType[row.action_type]
    && createdKeys.has(`${row.committed_resource_type}:${row.committed_resource_id}`)
    && (row.action_type !== 'prescription' || row.payload.operation !== 'status' || row.committed_resource_id === row.payload.prescription_id));
}
