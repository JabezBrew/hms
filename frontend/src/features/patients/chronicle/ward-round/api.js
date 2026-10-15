import { v2Api, v2Request } from '@/lib/api/v2/client'
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
  if (decision === 'hold' || decision === 'on_hold') return 'on_hold'
  if (decision === 'stop' || decision === 'stopped') return 'stopped'
  if (decision === 'complete' || decision === 'completed') return 'completed'
  return 'active'
}

function buildRenderedNote(payload = {}) {
  const note = payload.note || {}
  return [
    ['OVERNIGHT EVENTS', note.overnight_events],
    ['EXAMINATION', note.examination],
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
  const originalBlockers = payload.actions?.discharge?.original_blockers || []
  return {
    interval_history: emptyToNull(note.overnight_events),
    examination: emptyToNull(note.examination),
    assessment: emptyToNull(note.assessment),
    plan: emptyToNull(note.plan || note.summary),
    clinical_readiness_blockers: dischargeNote
      ? originalBlockers.join('\n') === dischargeNote ? originalBlockers : [dischargeNote]
      : [],
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

  const labGroups = new Map()
  ;(actions.lab_orders || []).forEach((order) => {
    const id = order.catalog_item_id || order.id
    if (!id) return
    const priority = order.priority || actions.lab_priority || 'routine'
    if (!labGroups.has(priority)) labGroups.set(priority, { test_ids: [], panel_ids: [], names: [] })
    const group = labGroups.get(priority)
    if ((order.catalog_item_type || order.kind) === 'panel') {
      group.panel_ids.push(id)
    } else {
      group.test_ids.push(id)
    }
    if (order.test_name || order.name) {
      group.names.push(order.test_name || order.name)
    }
  })

  const labAction = [...labGroups.entries()].map(([priority, group]) => ({
        action_type: 'lab_order',
        title: group.names.length > 0 ? group.names.join(', ') : 'Laboratory order',
        instruction: null,
        payload: {
          test_ids: group.test_ids,
          panel_ids: group.panel_ids,
          priority,
        },
      }))

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
  if (payload.ward_round_id) {
    try {
      const body = buildRoundPayload(payload)
      const response = await v2Api.patchPatientChronicleWardRound(
        { patient_id: patientId, round_id: payload.ward_round_id },
        { expected_version: payload.expected_version, note_sections: body.note_sections, rendered_note: body.rendered_note },
        { signal: options.signal },
      )
      return unwrapObject(response)
    } catch (error) {
      throwWardRoundError(error, 'Failed to update ward round draft')
    }
  }
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
  try {
    for (const action of draftActions) {
      current = await deleteAction(patientId, current.id, action.id, options)
    }
    for (const actionRequest of actionRequests) {
      current = await createAction(patientId, current.id, actionRequest, options)
    }
  } catch (error) {
    throw withConfirmedDraftIdentity(error, current)
  }
  return current
}

function withConfirmedDraftIdentity(error, draft) {
  if (draft?.id && Number.isSafeInteger(draft.version)) {
    error.confirmedDraftIdentity = { id: draft.id, version: draft.version }
  }
  return error
}

export const wardRoundApi = {
  current: async (patientId, options = {}) => {
    try {
      return unwrapObject(await v2Api.getPatientChronicleCurrentWardRound(
        { patient_id: patientId },
        { signal: options.signal },
      ))
    } catch (error) {
      if (error?.status === 404 && error?.data?.error?.code === 'ward_round_not_found') return null
      throwWardRoundError(error, 'Failed to load ward round draft')
    }
  },
  saveDraft: async (patientId, payload, options = {}) => {
    const draft = await upsertDraft(patientId, payload, options)
    return replaceDraftActions(patientId, draft, buildActionRequests(payload), options)
  },
  commit: async (patientId, payload, options = {}) => {
    const draft = await wardRoundApi.saveDraft(patientId, payload, options)
    try {
      const response = await requestWardRound({
        method: 'POST',
        path: WARD_ROUND_COMMIT_PATH,
        pathParams: { patient_id: patientId, round_id: draft.id },
        body: { expected_version: draft.version },
        signal: options.signal,
      }, 'Failed to sign ward round')
      return unwrapObject(response)
    } catch (error) {
      throw withConfirmedDraftIdentity(error, draft)
    }
  },
}
