import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prefetchPatientChronicleData } from '../prefetch'

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
})
