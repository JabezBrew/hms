import { apiClient } from '@/lib/api-client'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { v2Api } from '@/lib/api/v2/client'

const EMPTY_GROUPS = {
  recent_patients: [],
  patients: [],
  wards: [],
  encounters: [],
  appointments: [],
  admissions: [],
  staff: [],
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(String(limit || 8), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 8
  return Math.min(parsed, 25)
}

function normalizeTypes(types) {
  if (!Array.isArray(types)) return []
  return types.map((type) => String(type || '').trim().toLowerCase()).filter(Boolean)
}

function emptySearchResponse({ q, types, limit }) {
  return {
    query: String(q || '').trim(),
    types: normalizeTypes(types),
    limit: normalizeLimit(limit),
    groups: { ...EMPTY_GROUPS },
  }
}

function shouldSearchPatients(types) {
  const normalized = normalizeTypes(types)
  return normalized.length === 0 || normalized.includes('patients') || normalized.includes('patient')
}

function dateFromBirthYear(value) {
  if (!value) return null
  return `${String(value).padStart(4, '0')}-01-01`
}

function adaptV2Patient(patient) {
  return {
    id: patient.id,
    name: patient.display_name,
    medical_record_number: patient.patient_code,
    date_of_birth: patient.date_of_birth || dateFromBirthYear(patient.birth_year),
    gender: patient.sex,
    admission_status: patient.status,
    match_reason: 'rust_v2_patient_search',
  }
}

async function searchRustV2Patients({ q, types, limit, signal } = {}) {
  const query = String(q || '').trim()
  const pageLimit = normalizeLimit(limit)
  if (query.length < 2 || !shouldSearchPatients(types)) {
    return emptySearchResponse({ q, types, limit: pageLimit })
  }

  const response = await v2Api.getPatients({
    query: {
      limit: pageLimit,
      search: query,
    },
    signal,
  })

  return {
    query,
    types: normalizeTypes(types),
    limit: pageLimit,
    groups: {
      ...EMPTY_GROUPS,
      patients: Array.isArray(response?.data) ? response.data.map(adaptV2Patient) : [],
    },
  }
}

export const omniSearchApi = {
  search: ({ q, types, limit, signal } = {}) => {
    if (isRustV2ApiMode()) {
      return searchRustV2Patients({ q, types, limit, signal })
    }
    const params = {}
    if (q !== undefined && q !== null) {
      params.q = String(q)
    }
    if (Array.isArray(types) && types.length > 0) {
      params.types = types.join(',')
    }
    if (limit !== undefined && limit !== null) {
      params.limit = limit
    }
    return apiClient.get('/search/omni/', { params })
  },
}
