import { patientsApi } from '@/features/patients/api'
import { patientKeys } from '@/features/patients/hooks/usePatientQueries'
import { encounterKeys } from '@/features/encounters/hooks/useEncounterQueries'
import { encountersApi } from '@/features/encounters/api'
import { chronicleKeys } from '@/hooks/useChronicleContext'
import { fetchTimelinePage, timelineKeys } from '@/hooks/useTimelineQueries'
import { apiClient } from '@/lib/api-client'

const PREFETCH_MODE = {
  HOVER: 'hover',
  NAVIGATION: 'navigation',
}

const PREFETCH_CACHE_TTL_MS = 10 * 60 * 1000
const PREFETCH_CACHE_MAX_ITEMS = 50

// Bounded LRU cache of patient prefetch state to prevent unbounded growth.
const prefetchedPatients = new Map()

let patientDetailRoutePromise = null
let patientRegistryRoutePromise = null
let myPatientsRoutePromise = null

function prunePrefetchCache(now = Date.now()) {
  for (const [patientId, state] of prefetchedPatients) {
    if (now - state.lastTouchedAt > PREFETCH_CACHE_TTL_MS) {
      prefetchedPatients.delete(patientId)
    }
  }

  while (prefetchedPatients.size > PREFETCH_CACHE_MAX_ITEMS) {
    const oldestPatientId = prefetchedPatients.keys().next().value
    if (oldestPatientId === undefined) {
      break
    }
    prefetchedPatients.delete(oldestPatientId)
  }
}

function getPrefetchState(patientId, now = Date.now()) {
  prunePrefetchCache(now)

  const existingState = prefetchedPatients.get(patientId)
  if (existingState) {
    prefetchedPatients.delete(patientId)
    const updatedState = { ...existingState, lastTouchedAt: now }
    prefetchedPatients.set(patientId, updatedState)
    return updatedState
  }

  const newState = {
    hoverPrefetched: false,
    navigationPrefetched: false,
    lastTouchedAt: now,
  }
  prefetchedPatients.set(patientId, newState)
  prunePrefetchCache(now)
  return newState
}

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
      fetchTimelinePage(patientId, { page: pageParam, page_size: 20 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage?.has_next ? lastPage.page + 1 : undefined),
    staleTime: 30 * 1000,
  })
}

export function prefetchPatientChronicleData(queryClient, patientId, options = {}) {
  if (!queryClient || !patientId) {
    return
  }

  const mode = options.mode === PREFETCH_MODE.NAVIGATION
    ? PREFETCH_MODE.NAVIGATION
    : PREFETCH_MODE.HOVER
  const prefetchState = getPrefetchState(patientId)

  if (mode === PREFETCH_MODE.HOVER) {
    if (prefetchState.hoverPrefetched || prefetchState.navigationPrefetched) {
      return
    }
    prefetchState.hoverPrefetched = true
    prefetchPatientDetailRoute()
    return
  }

  if (prefetchState.navigationPrefetched) {
    return
  }
  prefetchState.hoverPrefetched = true
  prefetchState.navigationPrefetched = true

  if (
    typeof document !== 'undefined' && document.visibilityState !== 'visible'
  ) {
    return
  }

  prefetchPatientDetailRoute()

  void queryClient.prefetchQuery({
    queryKey: patientKeys.detail(patientId),
    queryFn: () => patientsApi.getPatient(patientId),
    staleTime: 5 * 60 * 1000,
  })

  void prefetchChronicleContext(queryClient, patientId)

  void prefetchTimelineFirstPage(queryClient, patientId)
  void queryClient.prefetchQuery({
    queryKey: encounterKeys.forPatient(patientId),
    queryFn: () => encountersApi.getEncountersForPatient(patientId),
    staleTime: 60 * 1000,
  })
}
