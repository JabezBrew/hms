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
  visits: [],
  clinics: [],
  laboratory: [],
  billing: [],
  inventory: [],
  referrals: [],
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(String(limit || 8), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 8
  return Math.min(parsed, 25)
}

function normalizeTypes(types) {
  if (!Array.isArray(types)) return []
  const aliases = {
    patient: 'patients',
    ward: 'wards',
    encounter: 'encounters',
    appointment: 'appointments',
    admission: 'admissions',
    visit: 'visits',
    clinic: 'clinics',
    lab: 'laboratory',
    labs: 'laboratory',
    referral: 'referrals',
  }
  const normalizedTypes = []
  for (const type of types) {
    const normalizedType = String(type || '').trim().toLowerCase()
    if (normalizedType) {
      normalizedTypes.push(aliases[normalizedType] || normalizedType)
    }
  }
  return normalizedTypes
}

function emptySearchResponse({ q, types, limit }) {
  return {
    query: String(q || '').trim(),
    types: normalizeTypes(types),
    limit: normalizeLimit(limit),
    groups: { ...EMPTY_GROUPS },
  }
}

function adaptV2SearchItem(item) {
  const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {}
  return {
    id: item?.id,
    resource_type: item?.resource_type,
    title: item?.title,
    subtitle: item?.subtitle,
    route_path: item?.route_path,
    status_label: item?.status_label,
    occurred_at: item?.occurred_at,
    metadata,
    score: item?.score,
  }
}

function adaptV2Patient(item) {
  const base = adaptV2SearchItem(item)
  return {
    ...base,
    id: item?.patient_id || base.id,
    name: item?.patient_name || item?.title,
    medical_record_number: item?.patient_code,
    date_of_birth: item?.patient_date_of_birth,
    gender: item?.metadata?.sex,
    admission_status: item?.status_label || item?.metadata?.status,
    match_reason: 'rust_v2_omni_search',
  }
}

function adaptV2Ward(item) {
  return {
    ...adaptV2SearchItem(item),
    name: item?.title,
    ward_type: item?.metadata?.code || item?.status_label,
  }
}

function adaptV2Encounter(item) {
  return {
    ...adaptV2SearchItem(item),
    patient_name: item?.patient_name || item?.title,
    reason: item?.subtitle || item?.metadata?.encounter_type || item?.status_label,
  }
}

function adaptV2Appointment(item) {
  return {
    ...adaptV2SearchItem(item),
    patient_name: item?.patient_name || item?.title,
    practitioner_name: item?.metadata?.clinic_name,
    start_time: item?.metadata?.starts_at || item?.occurred_at,
  }
}

function adaptV2Admission(item) {
  return {
    ...adaptV2SearchItem(item),
    patient_name: item?.patient_name || item?.title,
    ward_name: item?.metadata?.ward_name,
    bed_number: item?.metadata?.bed_number,
  }
}

function adaptV2Staff(item) {
  return {
    ...adaptV2SearchItem(item),
    name: item?.title,
    employee_id: item?.metadata?.employee_id || item?.subtitle,
  }
}

function adaptV2Generic(item) {
  return {
    ...adaptV2SearchItem(item),
    label: item?.title,
    description: item?.subtitle || item?.status_label,
    href: item?.route_path,
  }
}

function adaptV2Groups(groups = {}) {
  return {
    recent_patients: (groups.recent_patients || []).map(adaptV2Patient),
    patients: (groups.patients || []).map(adaptV2Patient),
    wards: (groups.wards || []).map(adaptV2Ward),
    encounters: (groups.encounters || []).map(adaptV2Encounter),
    appointments: (groups.appointments || []).map(adaptV2Appointment),
    admissions: (groups.admissions || []).map(adaptV2Admission),
    staff: (groups.staff || []).map(adaptV2Staff),
    visits: (groups.visits || []).map(adaptV2Generic),
    clinics: (groups.clinics || []).map(adaptV2Generic),
    laboratory: (groups.laboratory || []).map(adaptV2Generic),
    billing: (groups.billing || []).map(adaptV2Generic),
    inventory: (groups.inventory || []).map(adaptV2Generic),
    referrals: (groups.referrals || []).map(adaptV2Generic),
  }
}

async function searchRustV2Omni({ q, types, limit, signal } = {}) {
  const query = String(q || '').trim()
  const pageLimit = normalizeLimit(limit)
  if (query.length > 0 && query.length < 2) {
    return emptySearchResponse({ q, types, limit: pageLimit })
  }

  const response = await v2Api.postSearchOmni(
    {
      q: query,
      types: normalizeTypes(types),
      limit: pageLimit,
    },
    { signal }
  )
  const data = response?.data || {}

  return {
    query: data.query ?? query,
    types: Array.isArray(data.types) ? data.types : normalizeTypes(types),
    limit: data.limit ?? pageLimit,
    groups: { ...EMPTY_GROUPS, ...adaptV2Groups(data.groups || {}) },
    index_status: data.index_status || [],
    took_ms: data.took_ms,
  }
}

export const omniSearchApi = {
  search: ({ q, types, limit, signal } = {}) => {
    if (isRustV2ApiMode()) {
      return searchRustV2Omni({ q, types, limit, signal })
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
