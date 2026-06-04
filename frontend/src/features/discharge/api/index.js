import { apiClient } from '@/lib/api-client'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { v2Api } from '@/lib/api/v2/client'

const DEFAULT_DISCHARGE_LIMIT = 25

function normalizeLimit(params = {}, fallback = DEFAULT_DISCHARGE_LIMIT) {
  const parsed = Number.parseInt(String(params.limit || params.page_size || fallback), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 100)
}

function mapV2Status(status) {
  switch (status) {
    case 'requested':
      return 'ready_for_finalization'
    case 'completed':
      return 'finalized'
    default:
      return status || 'awaiting_clearance'
  }
}

function dischargeWardBoardWorkflowPath(discharge) {
  const params = new URLSearchParams({ view: 'discharge' })
  if (discharge?.patient_id) params.set('patient', discharge.patient_id)
  if (discharge?.id) params.set('case', discharge.id)
  return `/ward-board?${params.toString()}`
}

function dischargeSummaryWorkflowPath(discharge) {
  if (!discharge?.patient_id) {
    return dischargeWardBoardWorkflowPath(discharge)
  }

  const params = new URLSearchParams({
    action: 'add_note',
    note_type: 'discharge_summary',
  })
  return `/patients/${encodeURIComponent(discharge.patient_id)}?${params.toString()}`
}

function mapV2Blocker(blocker, discharge) {
  const taskType = blocker.blocker_type || blocker.task_type
  const workflowPath = ['discharge_summary', 'nursing_release'].includes(taskType)
    ? workflowPathForBlocker(taskType, discharge)
    : blocker.workflow_path || workflowPathForBlocker(taskType, discharge)
  return {
    ...blocker,
    id: blocker.id || `${discharge.id}:${taskType}`,
    task_type: taskType,
    status: blocker.status || 'pending',
    blocking: blocker.blocking ?? true,
    workflow_label: blocker.workflow_label || taskType?.replace(/_/g, ' ') || 'Workflow',
    workflow_path: workflowPath,
    snapshot: {
      hold_reason: blocker.hold_reason || null,
      override_reason: blocker.override_reason || null,
      completed_at: blocker.completed_at || null,
    },
  }
}

function workflowPathForBlocker(taskType, discharge) {
  switch (taskType) {
    case 'discharge_summary':
      return dischargeSummaryWorkflowPath(discharge)
    case 'nursing_release':
      return dischargeWardBoardWorkflowPath(discharge)
    case 'billing_clearance':
      return `/billing/discharges?case=${discharge.id}`
    case 'pharmacy_clearance':
      return `/pharmacy/dispensing?patient=${discharge.patient_id}&discharge=${discharge.id}`
    default:
      return `/patients/${discharge.patient_id}`
  }
}

function buildFallbackV2Blockers(discharge) {
  if (discharge?.status === 'completed') return []
  if (discharge?.status === 'cancelled') return []
  return [
    {
      id: `${discharge.id}:discharge_summary`,
      task_type: 'discharge_summary',
      status: 'pending',
      blocking: true,
      workflow_label: 'Discharge summary',
      workflow_path: workflowPathForBlocker('discharge_summary', discharge),
    },
  ]
}

function adaptV2Discharge(discharge) {
  if (!discharge) return discharge
  const blockers = Array.isArray(discharge.blockers) && discharge.blockers.length > 0
    ? discharge.blockers.map((blocker) => mapV2Blocker(blocker, discharge))
    : buildFallbackV2Blockers(discharge)
  return {
    ...discharge,
    admission: discharge.admission_case_id,
    admission_case: discharge.admission_case_id,
    patient: discharge.patient_id,
    patient_name: discharge.patient_display_name,
    medical_record_number: discharge.patient_code,
    ward: discharge.ward_id,
    ward_name: discharge.ward_name || 'Ward not specified',
    status: mapV2Status(discharge.status),
    v2_status: discharge.status,
    medical_ready_at: discharge.requested_at,
    billing_cutoff_at: null,
    finalized_at: discharge.discharged_at || null,
    advisory_tasks_open: blockers.filter((task) => !task.blocking && task.status !== 'completed').length,
    invoice_summary: discharge.invoice_summary || {
      invoice_count: 0,
      patient_balance_due: '0.00',
      patient_balance_due_minor: 0,
      currency: 'GHS',
    },
    schedule_follow_up_action: discharge.schedule_follow_up_action || {
      label: 'Schedule follow-up',
      path: `/appointments/create?patient=${discharge.patient_id}`,
    },
    blockers,
    tasks: blockers,
  }
}

function filterV2Discharges(items, params = {}) {
  const admissionId = params.admission || params.admission_id || params.admissionCaseId
  if (!admissionId) return items
  return items.filter((item) => item.admission === admissionId || item.admission_case === admissionId)
}

function deriveV2DischargeTasks(cases, params = {}) {
  const taskType = params.task_type && params.task_type !== 'all'
    ? String(params.task_type)
    : null
  const status = params.status && params.status !== 'all'
    ? String(params.status)
    : null

  const tasks = []
  for (const item of cases) {
    for (const task of item.blockers || []) {
      if (taskType && task.task_type !== taskType) continue
      if (status && task.status !== status) continue
      tasks.push({
        ...task,
        discharge_case: item.id,
        discharge: item.id,
        admission_case: item.admission_case,
        admission: item.admission,
        patient: item.patient,
        patient_name: item.patient_name,
        medical_record_number: item.medical_record_number,
        ward_name: item.ward_name,
        created_at: item.medical_ready_at,
        updated_at: item.medical_ready_at,
      })
    }
  }
  return tasks
}

async function getV2DischargeCases(params = {}, options = {}) {
  const response = await v2Api.getDischarges({
    query: {
      cursor: params.cursor || params.next_cursor,
      limit: normalizeLimit(params),
    },
    signal: options.signal,
  })
  return filterV2Discharges(
    Array.isArray(response?.data) ? response.data.map(adaptV2Discharge) : [],
    params,
  )
}

function unsupportedInRustV2(message) {
  return Promise.reject(new Error(message))
}

export const dischargeApi = {
  getCases: (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return getV2DischargeCases(params, options)
    }
    return apiClient.get('/discharges/cases/', { ...options, params })
  },
  getCase: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      const response = await v2Api.getDischargeById({ id }, { signal: options.signal })
      return adaptV2Discharge(response?.data)
    }
    return apiClient.get(`/discharges/cases/${id}/`, options)
  },
  requestCase: async (admissionCaseId, options = {}) => {
    if (isRustV2ApiMode()) {
      const response = await v2Api.postDischarges(
        { admission_case_id: admissionCaseId },
        { signal: options.signal },
      )
      return adaptV2Discharge(response?.data)
    }
    return apiClient.post('/discharges/cases/', { admission_case_id: admissionCaseId }, options)
  },
  getTasks: (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return getV2DischargeCases(params, options).then((cases) =>
        deriveV2DischargeTasks(cases, params)
      )
    }
    return apiClient.get('/discharges/tasks/', { ...options, params })
  },
  updateBillingCutoff: (id, billingCutoffAt) =>
    isRustV2ApiMode()
      ? unsupportedInRustV2('Rust V2 does not expose discharge billing cutoff updates yet')
      :
    apiClient.post(`/discharges/cases/${id}/billing-cutoff/`, {
      billing_cutoff_at: billingCutoffAt,
    }),
  clearBilling: (id) => (
    isRustV2ApiMode()
      ? unsupportedInRustV2('Rust V2 does not expose discharge billing clearance yet')
      : apiClient.post(`/discharges/cases/${id}/billing-clear/`, {})
  ),
  addAdvisoryTask: (id, data) => (
    isRustV2ApiMode()
      ? unsupportedInRustV2('Rust V2 does not expose discharge advisory tasks yet')
      : apiClient.post(`/discharges/cases/${id}/advisory-tasks/`, data)
  ),
  finalizeCase: async (id, data = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      const response = await v2Api.postDischargeComplete({ id }, { signal: options.signal })
      return adaptV2Discharge(response?.data)
    }
    return apiClient.post(`/discharges/cases/${id}/finalize/`, data, options)
  },
  cancelCase: async (id, reason = '', options = {}) => {
    if (isRustV2ApiMode()) {
      const response = await v2Api.postDischargeCancel(
        { id },
        { reason },
        { signal: options.signal },
      )
      return adaptV2Discharge(response?.data)
    }
    return apiClient.post(`/discharges/cases/${id}/cancel/`, { reason }, options)
  },
  reopenCase: (id) => (
    isRustV2ApiMode()
      ? unsupportedInRustV2('Rust V2 does not expose discharge reopening yet')
      : apiClient.post(`/discharges/cases/${id}/reopen/`, {})
  ),
  completeTask: (id, notes = '') => (
    isRustV2ApiMode()
      ? unsupportedInRustV2('Rust V2 does not expose discharge task operations yet')
      : apiClient.post(`/discharges/tasks/${id}/complete/`, { notes })
  ),
  acknowledgeTask: (id, notes = '') => (
    isRustV2ApiMode()
      ? unsupportedInRustV2('Rust V2 does not expose discharge task operations yet')
      : apiClient.post(`/discharges/tasks/${id}/acknowledge/`, { notes })
  ),
}
