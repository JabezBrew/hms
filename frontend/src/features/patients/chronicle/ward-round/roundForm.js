import { emptyRoundNote } from './commandModel';
export function unavailableRoundActions(form, permissions) {
  return [
    { key: 'medications', title: 'Prescription decisions', allowed: permissions.can_add_prescription, rows: form.medications, label: (row) => row.medication_name || 'Reviewed prescription' },
    { key: 'labOrders', title: 'Laboratory selections', allowed: permissions.can_order_labs, rows: form.labOrders, label: (row) => row.name },
    { key: 'nursingTasks', title: 'Nursing tasks', allowed: permissions.can_create_nursing_task, rows: form.nursingTasks, label: (row) => row.title },
    { key: 'discharge', title: 'Discharge request', allowed: permissions.can_request_discharge, rows: form.discharge.request_discharge ? [form.discharge] : [], label: () => 'Create a discharge request' },
  ].filter((group) => !group.allowed && group.rows.length);
}
export function roundForm(patientId, admissionId, round) {
  const form = { patientId, admissionId, note: emptyRoundNote(), renderedNote: round?.rendered_note ?? '', preservedSections: round?.note_sections ?? { interval_history: null, examination: null, assessment: null, plan: null, clinical_readiness_blockers: [] }, medications: [], labOrders: [], labPriority: 'routine', labExpandedTargets: [], nursingTasks: [], discharge: { status: 'not_ready', request_discharge: false, note: '' }, unsupportedActions: [] };
  for (const [position, action] of (round?.actions || []).entries()) {
    if (action.status !== 'draft') continue;
    const payload = action.payload; const targets = action.reviewed_targets || [];
    const unsupported = () => form.unsupportedActions.push({ id: action.id, title: action.title || 'Earlier draft action', type: action.action_type });
    if (action.action_type === 'prescription' && payload.operation === 'start') form.medications.push({ ...payload, id: action.id, position });
    else if (action.action_type === 'prescription' && payload.operation === 'status') {
      const target = targets.find((row) => row.selected && row.resource_type === 'prescription' && row.resource_id === payload.prescription_id);
      if (!target?.prescription) { unsupported(); continue; }
      form.medications.push({ ...target.prescription, ...payload, id: action.id, position });
    } else if (action.action_type === 'lab_order' && Array.isArray(payload.test_ids) && Array.isArray(payload.panel_ids)) {
      const selected = [];
      for (const kind of ['test', 'panel']) for (const id of payload[kind === 'test' ? 'test_ids' : 'panel_ids']) {
        const target = targets.find((row) => row.selected && row.resource_type === `lab_${kind}` && row.resource_id === id);
        if (target) selected.push({ id, kind, name: target.display_name, code: target.code });
      }
      if (selected.length !== payload.test_ids.length + payload.panel_ids.length) { unsupported(); continue; }
      form.labOrders.push(...selected); form.labPriority = payload.priority; form.labPosition = position; form.labExpandedTargets = targets.filter((row) => !row.selected);
    } else if (action.action_type === 'nursing_task' && payload.task_type === 'ward_round' && payload.assigned_to_user_id == null) form.nursingTasks.push({ ...payload, id: action.id, position });
    else if (action.action_type === 'discharge_request' && Object.keys(payload).length === 0) { form.discharge = { ...form.discharge, status: 'ready', request_discharge: true }; form.dischargePosition = position; }
    else unsupported();
  }
  return form;
}
