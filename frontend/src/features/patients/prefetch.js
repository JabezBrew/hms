import { patientsApi } from '@/features/patients/api'
import { patientKeys } from '@/features/patients/hooks/usePatientQueries'
import { encounterKeys } from '@/features/encounters/hooks/useEncounterQueries'
import { encountersApi } from '@/features/encounters/api'
import { chronicleKeys } from '@/hooks/useChronicleContext'
import { timelineKeys } from '@/hooks/useTimelineQueries'
import { chartKeys } from '@/hooks/useChartQueries'
import { apiClient } from '@/lib/api-client'

const prefetchedPatientIds = new Set()

let patientDetailRoutePromise = null
let patientRegistryRoutePromise = null
let myPatientsRoutePromise = null

function loadPatientPageRoute() {
  return import('@/features/patients/pages/PatientPage')
}

function loadPatientChroniclePage() {
  return import('@/features/patients/pages/PatientChroniclePage')
}

function loadPatientRegistryPage() {
  return import('@/features/patients/pages/PatientChronicleListPage')
}

function loadMyPatientsPage() {
  return import('@/features/patients/pages/MyPatientsPage')
}

export function prefetchPatientDetailRoute() {
  if (!patientDetailRoutePromise) {
    patientDetailRoutePromise = Promise.all([
      loadPatientPageRoute(),
      loadPatientChroniclePage(),
    ]).catch(() => {
      patientDetailRoutePromise = null
    })
  }
  return patientDetailRoutePromise
}

export function prefetchPatientRegistryRoute() {
  if (!patientRegistryRoutePromise) {
    patientRegistryRoutePromise = loadPatientRegistryPage().catch(() => {
      patientRegistryRoutePromise = null
    })
  }
  return patientRegistryRoutePromise
}

export function prefetchMyPatientsRoute() {
  if (!myPatientsRoutePromise) {
    myPatientsRoutePromise = loadMyPatientsPage().catch(() => {
      myPatientsRoutePromise = null
    })
  }
  return myPatientsRoutePromise
}

function prefetchChronicleContext(queryClient, patientId) {
  return queryClient.prefetchQuery({
    queryKey: chronicleKeys.context(patientId),
    queryFn: async () => {
      const response = await apiClient.get(`/clinical-notes/chronicle/${patientId}/context/`)
      return response?.data ?? response ?? {}
    },
    staleTime: 5 * 60 * 1000,
  })
}

function prefetchTimelineFirstPage(queryClient, patientId) {
  return queryClient.prefetchInfiniteQuery({
    queryKey: timelineKeys.listParams(patientId, 'all', '', 20, undefined, undefined, undefined),
    queryFn: ({ pageParam = 1 }) =>
      apiClient.getWithPagination(`/clinical-notes/timeline/${patientId}/?page=${pageParam}&page_size=20`),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage?.has_next ? lastPage.page + 1 : undefined),
    staleTime: 30 * 1000,
  })
}

function prefetchChartAssignments(queryClient, patientId) {
  return queryClient.prefetchQuery({
    queryKey: chartKeys.assignmentListParams(patientId, undefined, undefined, 'active'),
    queryFn: () => apiClient.get(`/charts/assignments/?patient=${patientId}&status=active`),
    staleTime: 30 * 1000,
  })
}

export function prefetchPatientChronicleData(queryClient, patientId) {
  if (!queryClient || !patientId || prefetchedPatientIds.has(patientId)) {
    return
  }

  prefetchedPatientIds.add(patientId)

  // Warm route chunks and the first set of chronicle queries to reduce time-to-interaction.
  prefetchPatientDetailRoute()

  void queryClient.prefetchQuery({
    queryKey: patientKeys.detail(patientId),
    queryFn: () => patientsApi.getPatient(patientId),
    staleTime: 5 * 60 * 1000,
  })

  void prefetchChronicleContext(queryClient, patientId)
  void prefetchTimelineFirstPage(queryClient, patientId)
  void prefetchChartAssignments(queryClient, patientId)

  void queryClient.prefetchQuery({
    queryKey: encounterKeys.forPatient(patientId),
    queryFn: () => encountersApi.getEncountersForPatient(patientId),
    staleTime: 60 * 1000,
  })
}
