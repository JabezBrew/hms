import { v2Request } from '@/lib/api/v2/client'
import { handleV2ApiError } from '@/lib/api/v2/errors'

export const WARD_ROUNDS_PATH = '/api/v2/patients/{patient_id}/chronicle/ward-rounds'
export const WARD_ROUND_PATH = '/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}'
export const WARD_ROUND_ACTIONS_PATH = '/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}/actions'
export const WARD_ROUND_ACTION_PATH = '/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}/actions/{action_id}'
export const WARD_ROUND_COMMIT_PATH = '/api/v2/patients/{patient_id}/chronicle/ward-rounds/{round_id}/commit'

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error
  }
}

function throwWardRoundError(error, message) {
  rethrowAbortError(error)
  const wrapped = new Error(handleV2ApiError(error, message))
  if (error?.status) {
    wrapped.status = error.status
  }
  throw wrapped
}

function unwrapObject(response) {
  return response?.data || response
}

function emptyToNull(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function mapPrescriptionStatus(action = {}) {
  const decision = action.status || action.decision
  if (decision === 'hold') return 'on_hold'
  if (decision === 'stop') return 'stopped'
  if (decision === 'complete') return 'completed'
  return 'active'
}

function buildRenderedNote(payload = {}) {
  const note = payload.note || {}
  return [
    ['OVERNIGHT EVENTS', note.overnight_events],
    ['ASSESSMENT', note.assessment],
    ['PLAN', note.plan],
    ['SUMMARY', note.summary],
    ['DISCHARGE READINESS', payload.actions?.discharge?.note],
  ]
    .map(([heading, value]) => [heading, emptyToNull(value)])
    .filter(([, value]) => value)
    .map(([heading, value]) => `${heading}\n${value}`)
    .join('\n\n')
}

function buildNoteSections(payload = {}) {
  const note = payload.note || {}
  const dischargeNote = emptyToNull(payload.actions?.discharge?.note)
  return {
    interval_history: emptyToNull(note.overnight_events),
    examination: null,
    assessment: emptyToNull(note.assessment),
    plan: emptyToNull(note.plan || note.summary),
    clinical_readiness_blockers: dischargeNote ? [dischargeNote] : [],
  }
}

function buildRoundPayload(payload = {}) {
  return {
    admission_case_id: payload.admission_case_id || null,
    note_sections: buildNoteSections(payload),
    rendered_note: buildRenderedNote(payload),
  }
}

function buildActionRequests(payload = {}) {
  const actions = payload.actions || {}
  const medicationActions = (actions.medications || []).map((action) => ({
    action_type: 'prescription',
    title: emptyToNull(action.medication_name) || 'Prescription',
    instruction: null,
    payload: {
      prescription_id: action.prescription_id || null,
      medication_name: emptyToNull(action.medication_name),
      dose: emptyToNull(action.dose),
      frequency: emptyToNull(action.frequency),
      status: mapPrescriptionStatus(action),
    },
  }))

  const testIds = []
  const panelIds = []
  const labNames = []
  ;(actions.lab_orders || []).forEach((order) => {
    const id = order.catalog_item_id || order.id
    if (!id) return
    if ((order.catalog_item_type || order.kind) === 'panel') {
      panelIds.push(id)
    } else {
      testIds.push(id)
    }
    if (order.test_name || order.name) {
      labNames.push(order.test_name || order.name)
    }
  })

  const labAction = testIds.length > 0 || panelIds.length > 0
    ? [{
        action_type: 'lab_order',
        title: labNames.length > 0 ? labNames.join(', ') : 'Laboratory order',
        instruction: null,
        payload: {
          test_ids: testIds,
          panel_ids: panelIds,
          priority: actions.lab_priority || 'routine',
        },
      }]
    : []

  const nursingActions = (actions.nursing_tasks || []).map((task) => ({
    action_type: 'nursing_task',
    title: emptyToNull(task.title) || 'Ward round task',
    instruction: emptyToNull(task.instruction),
    payload: {
      title: emptyToNull(task.title) || 'Ward round task',
      instruction: emptyToNull(task.instruction),
      due_at: task.due_at || new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      task_type: task.task_type || 'ward_round',
      assigned_to_user_id: task.assigned_to_user_id || null,
    },
  }))

  const dischargeAction = actions.discharge?.request_discharge
    ? [{
        action_type: 'discharge_request',
        title: 'Discharge requested',
        instruction: emptyToNull(actions.discharge.note),
        payload: { requested: true },
      }]
    : []

  return [
    ...medicationActions,
    ...labAction,
    ...nursingActions,
    ...dischargeAction,
  ]
}

async function requestWardRound(config, failureMessage) {
  try {
    return await v2Request(config)
  } catch (error) {
    throwWardRoundError(error, failureMessage)
  }
}

async function upsertDraft(patientId, payload, options = {}) {
  const response = await requestWardRound({
    method: 'POST',
    path: WARD_ROUNDS_PATH,
    pathParams: { patient_id: patientId },
    body: buildRoundPayload(payload),
    signal: options.signal,
  }, 'Failed to save ward round draft')
  return unwrapObject(response)
}

async function deleteAction(patientId, roundId, actionId, options = {}) {
  const response = await requestWardRound({
    method: 'DELETE',
    path: WARD_ROUND_ACTION_PATH,
    pathParams: { patient_id: patientId, round_id: roundId, action_id: actionId },
    signal: options.signal,
  }, 'Failed to save ward round draft')
  return unwrapObject(response)
}

async function createAction(patientId, roundId, action, options = {}) {
  const response = await requestWardRound({
    method: 'POST',
    path: WARD_ROUND_ACTIONS_PATH,
    pathParams: { patient_id: patientId, round_id: roundId },
    body: action,
    signal: options.signal,
  }, 'Failed to save ward round draft')
  return unwrapObject(response)
}

async function replaceDraftActions(patientId, round, actionRequests, options = {}) {
  let current = round
  const draftActions = (current.actions || []).filter((action) => action.status === 'draft')
  for (const action of draftActions) {
    current = await deleteAction(patientId, current.id, action.id, options)
  }
  for (const actionRequest of actionRequests) {
    current = await createAction(patientId, current.id, actionRequest, options)
  }
  return current
}

export const wardRoundApi = {
  saveDraft: async (patientId, payload, options = {}) => {
    const draft = await upsertDraft(patientId, payload, options)
    return replaceDraftActions(patientId, draft, buildActionRequests(payload), options)
  },
  commit: async (patientId, payload, options = {}) => {
    const draft = await wardRoundApi.saveDraft(patientId, payload, options)
    const response = await requestWardRound({
      method: 'POST',
      path: WARD_ROUND_COMMIT_PATH,
      pathParams: { patient_id: patientId, round_id: draft.id },
      body: { expected_version: draft.version },
      signal: options.signal,
    }, 'Failed to sign ward round')
    return unwrapObject(response)
  },
}
