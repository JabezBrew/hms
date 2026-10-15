const NOTE_HEADINGS = ['OVERNIGHT EVENTS', 'EXAMINATION', 'ASSESSMENT', 'PLAN', 'SUMMARY', 'DISCHARGE READINESS'];

function renderedSection(renderedNote, heading) {
  const pattern = new RegExp(`(?:^|\\n\\n)${heading}\\n([\\s\\S]*?)(?=\\n\\n(?:${NOTE_HEADINGS.join('|')})\\n|$)`);
  return String(renderedNote || '').match(pattern)?.[1] || '';
}

function medicationDecision(status, prescriptionId) {
  if (status === 'on_hold') return 'hold';
  if (status === 'stopped') return 'stop';
  if (status === 'completed') return 'complete';
  return prescriptionId ? 'continue' : 'start';
}

export function wardRoundDraftState(round) {
  const draft = round?.status === 'draft' ? round : null;
  const sections = draft?.note_sections || {};
  const actions = (draft?.actions || []).filter((action) => action.status === 'draft');
  const labActions = actions.filter((action) => action.action_type === 'lab_order');
  const renderedSummary = renderedSection(draft?.rendered_note, 'SUMMARY');
  const hasHeadings = NOTE_HEADINGS.some((heading) => String(draft?.rendered_note || '').includes(`${heading}\n`));
  const discharge = actions.find((action) => action.action_type === 'discharge_request');
  return {
    note: {
      overnight_events: sections.interval_history || '',
      examination: sections.examination || '',
      assessment: sections.assessment || '',
      plan: renderedSection(draft?.rendered_note, 'PLAN') || (renderedSummary ? '' : sections.plan || ''),
      summary: renderedSummary || (!hasHeadings ? draft?.rendered_note || '' : ''),
    },
    medications: actions.filter((action) => action.action_type === 'prescription').map((action) => {
      const payload = action.payload || {};
      return {
        id: action.id,
        prescription_id: payload.prescription_id || null,
        medication_name: payload.medication_name || action.title || '',
        dose: payload.dose || '',
        frequency: payload.frequency || '',
        status: payload.status || 'active',
        decision: medicationDecision(payload.status, payload.prescription_id),
      };
    }),
    labOrders: labActions.flatMap((action) => {
      const payload = action.payload || {};
      const items = [
        ...(payload.test_ids || []).map((id) => ({ id, kind: 'test' })),
        ...(payload.panel_ids || []).map((id) => ({ id, kind: 'panel' })),
      ];
      const names = String(action.title || '').split(', ');
      return items.map((item, index) => ({
        ...item,
        name: names.length === items.length ? names[index] : `Saved laboratory ${item.kind}`,
        priority: payload.priority || 'routine',
      }));
    }),
    nursingTasks: actions.filter((action) => action.action_type === 'nursing_task').map((action) => ({
      ...action.payload,
      id: action.id,
      title: action.payload?.title || action.title || '',
      instruction: action.payload?.instruction || action.instruction || '',
    })),
    dischargeRequest: {
      status: discharge?.payload?.requested ? 'ready' : sections.clinical_readiness_blockers?.length ? 'review_today' : 'not_ready',
      request_discharge: Boolean(discharge?.payload?.requested),
      note: (sections.clinical_readiness_blockers || []).join('\n') || discharge?.instruction || '',
      original_blockers: sections.clinical_readiness_blockers || [],
    },
    identity: draft ? { id: draft.id, version: draft.version } : null,
  };
}
