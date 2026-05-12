import { apiClient, handleApiError } from '@/lib/api-client'
import { handleV2ApiError } from '@/lib/api/v2/errors'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { v2Api } from '@/lib/api/v2/client'

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error
  }
}

function normalizeListResponse(response) {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.results)) return response.results
  return []
}

function normalizeLimit(params = {}, fallback = 25) {
  const value = Number(params.page_size || params.limit || fallback)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, 1), 100)
}

function v2ListData(response) {
  return Array.isArray(response?.data) ? response.data : []
}

function rustV2Unsupported(contractName) {
  return Promise.reject(new Error(`Rust V2 does not expose ${contractName} yet.`))
}

function adaptV2AdmissionCase(item) {
  if (!item) {
    return item
  }
  const requestedBedLabel = item.bed_code
    ? `${item.ward_name || 'Ward'} · Bed ${item.bed_code}`
    : item.ward_name || null

  return {
    id: item.id,
    patient: item.patient_id,
    patient_id: item.patient_id,
    patient_name: item.patient_display_name,
    medical_record_number: item.patient_code,
    requested_ward: item.ward_id,
    requested_ward_name: item.ward_name,
    requested_bed: item.bed_id,
    requested_bed_label: requestedBedLabel,
    status: item.status,
    requested_at: item.created_at,
    ready_for_activation_at: item.status === 'ready_for_activation' ? item.created_at : null,
    admission_source: 'direct',
    admission_id: null,
    admitted_at: item.admitted_at,
    discharged_at: item.discharged_at,
    blockers: [],
    tasks: [],
    active_reservation: item.bed_id
      ? {
          ward: item.ward_id,
          ward_name: item.ward_name,
          bed: item.bed_id,
          bed_number: item.bed_code,
          reserved_at: item.created_at,
        }
      : null,
    can_activate: item.status === 'ready_for_activation',
  }
}

function adaptV2WardBoardAdmission(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || item.name || 'Unnamed patient'
  const admissionId = item.admission_id || item.id
  const wardId = item.ward_id || item.ward || null
  const wardName = item.ward_name || ''
  const bedId = item.bed_id ?? null
  const bedNumber = item.bed_code || item.bed_number || ''
  const patientCode = item.patient_code || item.medical_record_number || ''
  const status = item.admission_status || item.status || 'admitted'

  return {
    ...item,
    id: admissionId,
    admission_id: admissionId,
    patient_id: item.patient_id,
    patient_name: patientName,
    medical_record_number: patientCode,
    ward: wardId,
    ward_id: wardId,
    ward_name: wardName,
    bed_id: bedId,
    bed: bedId
      ? {
          id: bedId,
          bed_number: bedNumber,
          bed_code: bedNumber,
          name: bedNumber,
          ward: wardId,
          ward_id: wardId,
        }
      : null,
    bed_details: bedId
      ? {
          id: bedId,
          bed_number: bedNumber,
          bed_code: bedNumber,
          name: bedNumber,
          ward: wardId,
          ward_id: wardId,
          ward_details: {
            id: wardId,
            name: wardName,
          },
        }
      : null,
    status,
    admission_status: status,
    admitted_at: item.admitted_at,
    patient: {
      id: item.patient_id,
      medical_record_number: patientCode,
      patient_code: patientCode,
      name: patientName,
      display_name: patientName,
      full_name: patientName,
      user: {
        full_name: patientName,
      },
      user_details: {
        full_name: patientName,
      },
    },
    patient_details: {
      id: item.patient_id,
      medical_record_number: patientCode,
      user_details: {
        full_name: patientName,
      },
    },
  }
}

function adaptV2PatientSearchItem(patient = {}) {
  const name = patient.full_name
    || patient.display_name
    || patient.name
    || patient.user_details?.full_name
    || patient.user?.full_name
    || 'Unnamed patient'
  return {
    ...patient,
    id: patient.id || patient.patient_id,
    name,
    display_name: name,
    medical_record_number: patient.medical_record_number || patient.patient_code || '',
    user: {
      ...(patient.user || {}),
      full_name: patient.user?.full_name || name,
    },
    user_details: {
      ...(patient.user_details || {}),
      full_name: patient.user_details?.full_name || name,
    },
  }
}

function adaptV2PractitionerSearchItem(practitioner = {}) {
  const name = practitioner.full_name
    || practitioner.display_name
    || practitioner.name
    || practitioner.staff_details?.user_details?.full_name
    || practitioner.user_details?.full_name
    || practitioner.user?.full_name
    || 'Unnamed practitioner'
  return {
    ...practitioner,
    id: practitioner.id || practitioner.practitioner_id || practitioner.staff_id,
    name,
    display_name: name,
    role: practitioner.role || practitioner.position || practitioner.user_type || '',
    user: {
      ...(practitioner.user || {}),
      full_name: practitioner.user?.full_name || name,
    },
    staff_details: {
      ...(practitioner.staff_details || {}),
      user_details: {
        ...(practitioner.staff_details?.user_details || {}),
        full_name: practitioner.staff_details?.user_details?.full_name || name,
      },
    },
  }
}

function adaptV2AdmissionCaseList(response) {
  return Array.isArray(response?.data)
    ? response.data.map(adaptV2AdmissionCase)
    : []
}

function entityId(value, keys = ['id']) {
  if (!value) {
    return null
  }
  if (typeof value !== 'object') {
    return value
  }
  for (const key of keys) {
    if (value[key]) {
      return value[key]
    }
  }
  return null
}

function admissionPayloadFrom(data = {}) {
  const bedId = entityId(data.bed, ['id', 'bed_id']) || data.bed_id || null
  const wardId = entityId(data.ward, ['id', 'ward_id'])
    || data.ward_id
    || data.requested_ward
    || entityId(data.requested_ward, ['id', 'ward_id'])
    || entityId(data.bed, ['ward_id', 'ward'])
    || null
  return {
    patient_id: entityId(data.patient, ['id', 'patient_id']) || data.patient_id || null,
    ward_id: wardId,
    bed_id: bedId,
  }
}

function admissionCasePayloadFrom(data = {}) {
  const payload = admissionPayloadFrom(data)
  return {
    patient_id: payload.patient_id,
    ward_id: payload.ward_id,
  }
}

function bedReservationPayloadFrom(data = {}) {
  return {
    bed_id: entityId(data.bed, ['id', 'bed_id']) || data.bed_id || null,
  }
}

async function getV2WardBoardAdmissions(params = {}, options = {}) {
  const response = await v2Api.getWardBoard({
    query: {
      limit: normalizeLimit(params, 100),
      cursor: params.cursor || params.next_cursor,
      ward_id: params.ward_id || params.ward,
    },
    signal: options.signal,
  })
  return v2ListData(response).map(adaptV2WardBoardAdmission)
}

async function findV2Admission(id, options = {}) {
  const admissions = await getV2WardBoardAdmissions({ limit: 100 }, options)
  return admissions.find((item) => item.id === id || item.admission_id === id) || null
}

export const admissionsApi = {
  getAdmissions: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const status = String(params.status || '').toLowerCase()
        if (status && !['active', 'admitted'].includes(status)) {
          const response = await v2Api.getAdmissionCases({
            query: {
              limit: normalizeLimit(params, 100),
              cursor: params.cursor || params.next_cursor,
            },
            signal: options.signal,
          })
          return adaptV2AdmissionCaseList(response)
        }
        return await getV2WardBoardAdmissions(params, options)
      }
      const response = await apiClient.getWithPagination('/wards/admissions/', {
        ...options,
        params,
      })
      return normalizeListResponse(response)
    } catch (error) {
      rethrowAbortError(error)
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admissions'))
      }
      throw new Error(handleApiError(error, 'Failed to fetch admissions'))
    }
  },

  getAdmission: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return await findV2Admission(id, options)
      }
      return await apiClient.get(`/wards/admissions/${id}/`)
    } catch (error) {
      rethrowAbortError(error)
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admission'))
      }
      throw new Error(handleApiError(error, 'Failed to fetch admission'))
    }
  },

  createAdmission: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const payload = admissionPayloadFrom(data)
        if (!payload.patient_id || !payload.ward_id) {
          throw new Error('Rust V2 admission creation requires a patient and ward.')
        }
        if (!payload.bed_id) {
          const response = await v2Api.postAdmissionCase(admissionCasePayloadFrom(data), {
            signal: options.signal,
          })
          const admissionCase = adaptV2AdmissionCase(response?.data)
          return {
            ...admissionCase,
            activated: false,
            admission_case_id: admissionCase?.id,
          }
        }
        const response = await v2Api.postAdmissions(payload, { signal: options.signal })
        return adaptV2WardBoardAdmission(response?.data)
      }
      return await apiClient.post('/wards/admissions/', data)
    } catch (error) {
      rethrowAbortError(error)
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create admission'))
      }
      throw new Error(handleApiError(error, 'Failed to create admission'))
    }
  },

  updateAdmission: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('/api/v2 admission update contract')
      }
      return await apiClient.put(`/wards/admissions/${id}/`, data)
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update admission'))
      }
      throw new Error(handleApiError(error, 'Failed to update admission'))
    }
  },

  dischargePatient: async (id, data) => {
    try {
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('/api/v2 admission discharge contract')
      }
      return await apiClient.post(`/wards/admissions/${id}/discharge/`, data)
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to discharge patient'))
      }
      throw new Error(handleApiError(error, 'Failed to discharge patient'))
    }
  },

  getCases: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const query = { limit: normalizeLimit(params) }
        if (params.cursor || params.next_cursor) {
          query.cursor = params.cursor || params.next_cursor
        }
        const response = await v2Api.getAdmissionCases({ query, signal: options.signal })
        return adaptV2AdmissionCaseList(response)
      }
      return await apiClient.get('/admissions/cases/', { ...options, params })
    } catch (error) {
      rethrowAbortError(error)
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch admission cases'))
      }
      throw new Error(handleApiError(error, 'Failed to fetch admission cases'))
    }
  },
  getCase: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      const response = await v2Api.getAdmissionCases({
        query: { limit: 100 },
        signal: options.signal,
      })
      return adaptV2AdmissionCaseList(response).find((item) => item.id === id) || null
    }
    return apiClient.get(`/admissions/cases/${id}/`, options)
  },
  getTasks: (params = {}, options = {}) => (
    isRustV2ApiMode()
      ? []
      : apiClient.get('/admissions/tasks/', { ...options, params })
  ),
  startCase: async (data, options = {}) => {
    if (isRustV2ApiMode()) {
      const payload = admissionCasePayloadFrom(data)
      const response = await v2Api.postAdmissionCase(payload, { signal: options.signal })
      return adaptV2AdmissionCase(response?.data)
    }
    return apiClient.post('/admissions/cases/start/', data)
  },
  clearRegistration: (id, notes = '') => (
    isRustV2ApiMode()
      ? rustV2Unsupported('/api/v2 admission registration clearance contract')
      : apiClient.post(`/admissions/cases/${id}/registration-clear/`, { notes })
  ),
  clearFinancial: (id, notes = '') => (
    isRustV2ApiMode()
      ? rustV2Unsupported('/api/v2 admission financial clearance contract')
      : apiClient.post(`/admissions/cases/${id}/financial-clear/`, { notes })
  ),
  reserveBed: async (id, data, options = {}) => {
    if (isRustV2ApiMode()) {
      const response = await v2Api.postAdmissionCaseReserveBed(
        { id },
        bedReservationPayloadFrom(data),
        { signal: options.signal },
      )
      return adaptV2AdmissionCase(response?.data)
    }
    return apiClient.post(`/admissions/cases/${id}/reserve-bed/`, data)
  },
  addAdvisoryTask: (id, data) => (
    isRustV2ApiMode()
      ? rustV2Unsupported('/api/v2 admission advisory task contract')
      : apiClient.post(`/admissions/cases/${id}/advisory-tasks/`, data)
  ),
  activateCase: async (id, data = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      const response = await v2Api.postAdmissionCaseActivate({ id }, { signal: options.signal })
      return adaptV2AdmissionCase(response?.data)
    }
    return apiClient.post(`/admissions/cases/${id}/activate/`, data)
  },
  completeIntake: (id) => (
    isRustV2ApiMode()
      ? rustV2Unsupported('/api/v2 admission intake completion contract')
      : apiClient.post(`/admissions/cases/${id}/complete-intake/`, {})
  ),
  cancelCase: async (id, notes = '', options = {}) => {
    if (isRustV2ApiMode()) {
      const response = await v2Api.postAdmissionCaseCancel({ id }, { signal: options.signal })
      return adaptV2AdmissionCase(response?.data)
    }
    return apiClient.post(`/admissions/cases/${id}/cancel/`, { notes })
  },
  completeTask: (id, notes = '') => (
    isRustV2ApiMode()
      ? rustV2Unsupported('/api/v2 admission task completion contract')
      : apiClient.post(`/admissions/tasks/${id}/complete/`, { notes })
  ),
  acknowledgeTask: (id, notes = '') => (
    isRustV2ApiMode()
      ? rustV2Unsupported('/api/v2 admission task acknowledgement contract')
      : apiClient.post(`/admissions/tasks/${id}/acknowledge/`, { notes })
  ),

  searchPatients: async (query, options = {}) => {
    try {
      if (!query || query.length < 2) {
        return []
      }
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatients({
          query: { limit: 10, search: query },
          signal: options.signal,
        })
        return v2ListData(response).map(adaptV2PatientSearchItem)
      }
      return await apiClient.get(`/patients/search/?query=${encodeURIComponent(query)}`)
    } catch (error) {
      rethrowAbortError(error)
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to search patients'))
      }
      throw new Error(handleApiError(error, 'Failed to search patients'))
    }
  },

  searchPractitioners: async (query, doctorsOnly = false, options = {}) => {
    try {
      if (!query || query.length < 2) {
        return []
      }

      if (isRustV2ApiMode()) {
        const response = await v2Api.getStaffDirectory({
          query: { limit: 20 },
          signal: options.signal,
        })
        const normalizedQuery = query.toLowerCase()
        return v2ListData(response)
          .map(adaptV2PractitionerSearchItem)
          .filter((practitioner) => {
            const haystack = `${practitioner.name || ''} ${practitioner.email || ''}`.toLowerCase()
            if (!haystack.includes(normalizedQuery)) {
              return false
            }
            if (!doctorsOnly) {
              return true
            }
            return String(practitioner.role || '').toLowerCase().includes('doctor')
          })
      }

      const params = new URLSearchParams({ q: query })
      if (doctorsOnly) {
        params.append('doctors_only', 'true')
      }

      const response = await apiClient.get(`/users/practitioners/search/?${params.toString()}`)
      if (response?.practitioners) {
        return response.practitioners
      }
      return Array.isArray(response) ? response : []
    } catch (error) {
      rethrowAbortError(error)
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to search practitioners'))
      }
      throw new Error(handleApiError(error, 'Failed to search practitioners'))
    }
  },
}
