import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prefetchPatientChronicleData } from '../prefetch'
import { encountersApi } from '@/features/encounters/api'
import { patientsApi } from '@/features/patients/api'
import { fetchChronicleContext } from '@/hooks/useChronicleContext'

const mockPrefetchQuery = vi.fn().mockResolvedValue(undefined)
const mockPrefetchInfiniteQuery = vi.fn().mockResolvedValue(undefined)

const queryClient = {
  prefetchQuery: mockPrefetchQuery,
  prefetchInfiniteQuery: mockPrefetchInfiniteQuery,
}

vi.mock('@/features/patients/api', () => ({
  patientsApi: { getPatient: vi.fn() },
}))

vi.mock('@/features/encounters/api', () => ({
  encountersApi: { getEncountersForPatient: vi.fn() },
}))

vi.mock('@/features/patients/hooks/usePatientQueries', () => ({
  patientKeys: { detail: (id) => ['patients', id] },
}))

vi.mock('@/features/encounters/hooks/useEncounterQueries', () => ({
  encounterKeys: { forPatient: (id) => ['encounters', id] },
}))

vi.mock('@/hooks/useChronicleContext', () => ({
  chronicleKeys: { context: (id) => ['chronicle', 'context', id] },
  fetchChronicleContext: vi.fn(),
}))

vi.mock('@/hooks/useTimelineQueries', () => ({
  fetchTimelinePage: vi.fn(),
  timelineKeys: { listParams: (...args) => ['timeline', ...args] },
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}))

describe('prefetchPatientChronicleData hover mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT call prefetchQuery for patient detail in hover mode', () => {
    prefetchPatientChronicleData(queryClient, 'patient-1', { mode: 'hover' })
    const calls = mockPrefetchQuery.mock.calls
    const detailCall = calls.find((c) => JSON.stringify(c[0]?.queryKey).includes('patient-1'))
    expect(detailCall).toBeUndefined()
  })

  it('does NOT call prefetchQuery for chronicle context in hover mode', () => {
    prefetchPatientChronicleData(queryClient, 'patient-2', { mode: 'hover' })
    const calls = mockPrefetchQuery.mock.calls
    const contextCall = calls.find((c) => JSON.stringify(c[0]?.queryKey).includes('context'))
    expect(contextCall).toBeUndefined()
  })

  it('DOES call prefetchQuery for patient detail in navigation mode', () => {
    prefetchPatientChronicleData(queryClient, 'patient-3', { mode: 'navigation' })
    const calls = mockPrefetchQuery.mock.calls
    const detailCall = calls.find((c) =>
      Array.isArray(c[0]?.queryKey) && c[0].queryKey.includes('patient-3')
    )
    expect(detailCall).toBeDefined()
  })

  it('prefetches Chronicle context through the shared bridge in navigation mode', async () => {
    const signal = new AbortController().signal
    prefetchPatientChronicleData(queryClient, 'patient-4', { mode: 'navigation' })
    const contextCall = mockPrefetchQuery.mock.calls.find((c) =>
      Array.isArray(c[0]?.queryKey) && c[0].queryKey.includes('context')
    )

    expect(contextCall).toBeDefined()
    await contextCall[0].queryFn({ signal })
    expect(fetchChronicleContext).toHaveBeenCalledWith('patient-4', { signal })
  })

  it('threads prefetch AbortSignal into patient detail and encounter reads', async () => {
    const signal = new AbortController().signal
    prefetchPatientChronicleData(queryClient, 'patient-5', { mode: 'navigation' })

    const detailCall = mockPrefetchQuery.mock.calls.find((c) =>
      Array.isArray(c[0]?.queryKey) && c[0].queryKey.includes('patient-5')
    )
    const encounterCall = mockPrefetchQuery.mock.calls.find((c) =>
      Array.isArray(c[0]?.queryKey) && c[0].queryKey.includes('encounters')
    )

    expect(detailCall).toBeDefined()
    expect(encounterCall).toBeDefined()

    await detailCall[0].queryFn({ signal })
    await encounterCall[0].queryFn({ signal })

    expect(patientsApi.getPatient).toHaveBeenCalledWith('patient-5', { signal })
    expect(encountersApi.getEncountersForPatient).toHaveBeenCalledWith('patient-5', { signal })
  })
})
