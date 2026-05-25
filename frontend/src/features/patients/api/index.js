import { patientsApi as basePatientsApi } from '@/lib/api/patients'
import { myPatientsApi } from '@/lib/api/my-patients'
import { v2Request } from '@/lib/api/v2/client'
import { handleV2ApiError } from '@/lib/api/v2/errors'

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error
  }
}

function throwV2Error(error, message) {
  rethrowAbortError(error)
  const wrapped = new Error(handleV2ApiError(error, message))
  if (error?.status) {
    wrapped.status = error.status
  }
  throw wrapped
}

function compactDefined(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  )
}

function normalizeChronicleQuery(params = {}) {
  return compactDefined({
    cursor: params.cursor || params.next_cursor,
    limit: params.limit || params.pageSize || params.page_size,
    type: params.type || params.entry_type,
    search: params.search,
    encounter_id: params.encounterId || params.encounter_id,
  })
}

function normalizeStatus(value) {
  return typeof value === 'string' ? value.replace(/_/g, '-') : value
}

function adaptPatient(patient) {
  if (!patient) {
    return patient
  }
  return {
    id: patient.id,
    medical_record_number: patient.patient_code,
    mrn: patient.patient_code,
    first_name: patient.first_name,
    last_name: patient.last_name,
    name: patient.display_name,
    date_of_birth: patient.date_of_birth,
    gender: patient.sex,
    registry_status: patient.status,
    created_at: patient.created_at,
    updated_at: patient.updated_at,
    local_data: {
      id: patient.id,
      medical_record_number: patient.patient_code,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      gender: patient.sex,
    },
  }
}

function adaptEncounter(encounter) {
  if (!encounter) {
    return null
  }
  return {
    ...encounter,
    status: normalizeStatus(encounter.status),
    type: encounter.encounter_type,
    start_time: encounter.started_at,
    end_time: encounter.ended_at,
  }
}

function adaptAdmission(admission) {
  if (!admission) {
    return null
  }
  return {
    ...admission,
    id: admission.admission_id,
    admission_id: admission.admission_id,
    status: normalizeStatus(admission.status),
    bed_number: admission.bed_code || null,
  }
}

function adaptLabResult(result) {
  if (!result) {
    return result
  }
  return {
    ...result,
    name: result.test_name,
    timestamp: result.entered_at,
    is_abnormal: false,
  }
}

function adaptTimelineEntry(entry) {
  if (!entry) {
    return entry
  }
  const type = entry.type || entry.entry_type || 'progress_note'
  return {
    ...entry,
    id: entry.id || entry.entry_id,
    type,
    entry_type: entry.entry_type || type,
    timestamp: entry.timestamp || entry.occurred_at,
    content: entry.summary || entry.title || '',
    data: entry.data || {},
  }
}

function adaptChronicleListResponse(response) {
  const page = response?.page || {}
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptTimelineEntry)
    : Array.isArray(response?.results)
      ? response.results.map(adaptTimelineEntry)
      : []
  const hasNext = Boolean(page.has_next || response?.has_next)
  return {
    results,
    count: results.length + (hasNext ? 1 : 0),
    page: response?.page_number || 1,
    page_size: page.limit || response?.page_size || results.length,
    has_next: hasNext,
    has_previous: false,
    next_cursor: page.next_cursor || response?.next_cursor || null,
  }
}

function adaptChronicleStartup(response) {
  const data = response?.data || response || {}
  const activeEncounter = adaptEncounter(data.active_context?.encounter || data.active_encounter)
  const activeAdmission = adaptAdmission(data.active_context?.admission || data.active_admission)
  const labs = Array.isArray(data.lab_results)
    ? data.lab_results.map(adaptLabResult)
    : Array.isArray(data.summaries?.labs)
      ? data.summaries.labs.map(adaptLabResult)
      : []

  return {
    ...data,
    patient: adaptPatient(data.patient),
    active_context: {
      ...(data.active_context || {}),
      encounter: activeEncounter,
      admission: activeAdmission,
    },
    active_encounter: activeEncounter,
    active_admission: activeAdmission,
    active_medications: data.active_medications || data.summaries?.medications || [],
    allergies: data.allergies || data.summaries?.allergies || [],
    problems: data.problems || data.summaries?.problems || [],
    lab_results: labs,
    timeline: adaptChronicleListResponse(data.timeline),
  }
}

async function getPatientChronicleStartup(id, params = {}, options = {}) {
  try {
    const response = await v2Request({
      method: 'GET',
      path: '/api/v2/patients/{id}/chronicle',
      pathParams: { id },
      query: normalizeChronicleQuery(params),
      signal: options.signal,
    })
    return adaptChronicleStartup(response)
  } catch (error) {
    throwV2Error(error, 'Failed to fetch patient Chronicle')
  }
}

async function getPatientChronicleTimeline(id, params = {}, options = {}) {
  try {
    const response = await v2Request({
      method: 'GET',
      path: '/api/v2/patients/{id}/chronicle/timeline',
      pathParams: { id },
      query: normalizeChronicleQuery(params),
      signal: options.signal,
    })
    return adaptChronicleListResponse(response)
  } catch (error) {
    throwV2Error(error, 'Failed to fetch patient Chronicle timeline')
  }
}

export const patientsApi = {
  ...basePatientsApi,
  getPatientChronicleStartup,
  getPatientChronicleTimeline,
}

export { myPatientsApi }
