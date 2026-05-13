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
      return 'awaiting_clearance'
    case 'completed':
      return 'finalized'
    default:
      return status || 'awaiting_clearance'
  }
}

function buildV2Blockers(discharge) {
  if (discharge?.status === 'completed') return []
  if (discharge?.status === 'cancelled') return []
  return [
    {
      id: `${discharge.id}:billing_clearance`,
      task_type: 'billing_clearance',
      status: 'pending',
      blocking: true,
    },
    {
      id: `${discharge.id}:nursing_finalization`,
      task_type: 'nursing_finalization',
      status: 'pending',
      blocking: true,
    },
  ]
}

function adaptV2Discharge(discharge) {
  if (!discharge) return discharge
  const blockers = buildV2Blockers(discharge)
  return {
    ...discharge,
    admission: discharge.admission_case_id,
    admission_case: discharge.admission_case_id,
    patient: discharge.patient_id,
    patient_name: discharge.patient_display_name,
    medical_record_number: discharge.patient_code,
    ward_name: discharge.ward_name || 'Ward not specified',
    status: mapV2Status(discharge.status),
    v2_status: discharge.status,
    medical_ready_at: discharge.requested_at,
    billing_cutoff_at: null,
    finalized_at: discharge.discharged_at || null,
    advisory_tasks_open: 0,
    invoice_summary: {
      invoice_count: 0,
      patient_balance_due: '0.00',
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
  getTasks: (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return []
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
  cancelCase: (id, reason = '') => (
    isRustV2ApiMode()
      ? unsupportedInRustV2('Rust V2 does not expose discharge cancellation yet')
      : apiClient.post(`/discharges/cases/${id}/cancel/`, { reason })
  ),
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
