import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/patients/pages/PatientChronicleListPage', () => ({}))
vi.mock('@/features/patients/pages/PatientPage', () => ({}))
vi.mock('@/features/patients/pages/PatientChroniclePage', () => ({}))
vi.mock('@/components/chronicle/ClinicalSummarySidebar', () => ({}))
vi.mock('@/components/chronicle/ChronicleNoteBody', () => ({}))
vi.mock('@/features/patients/chronicle/ChronicleTimelinePanel', () => ({}))
vi.mock('@/features/patients/components/ChronicleWorkspaceHost', () => ({}))
vi.mock('@/features/ward-board/pages/WardBoardPage', () => ({}))
vi.mock('@/features/laboratory/pages/LabOrdersPage', () => ({}))
vi.mock('@/features/inventory/pages/ItemsPage', () => ({}))
vi.mock('@/features/dashboards/pages/AdminDashboard', () => ({}))

describe('critical route chunk preloading', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('shares one preload across patient routes during a long session', async () => {
    const { preloadCriticalRouteForPath } = await import('../preloadCriticalRoute')
    const promises = Array.from({ length: 2000 }, (_, index) => (
      preloadCriticalRouteForPath(`/patients/synthetic-${index}`)
    ))

    expect(new Set(promises).size).toBe(1)
    await promises[0]
    expect(preloadCriticalRouteForPath('/patients/synthetic-next/')).toBe(promises[0])
    expect(preloadCriticalRouteForPath('/patients/synthetic-next/chronicle')).toBe(promises[0])
  })

  it('uses separate preload groups for registry, Chronicle, and ward board', async () => {
    const { preloadCriticalRouteForPath } = await import('../preloadCriticalRoute')
    const registry = preloadCriticalRouteForPath('/patients')
    const chronicle = preloadCriticalRouteForPath('/patients/synthetic')
    const wardBoard = preloadCriticalRouteForPath('/ward-board')

    expect(new Set([registry, chronicle, wardBoard]).size).toBe(3)
    await Promise.all([registry, chronicle, wardBoard])
  })

  it('deduplicates paths with query parameters and anchors', async () => {
    const { preloadCriticalRouteForPath } = await import('../preloadCriticalRoute')
    const plain = preloadCriticalRouteForPath('/patients')

    expect(preloadCriticalRouteForPath('/patients?tab=active')).toBe(plain)
    expect(preloadCriticalRouteForPath('/patients#registry')).toBe(plain)
    await plain
  })

  it('does not preload unknown routes', async () => {
    const { preloadCriticalRouteForPath } = await import('../preloadCriticalRoute')

    expect(preloadCriticalRouteForPath('/unavailable')).toBeNull()
    expect(preloadCriticalRouteForPath('/patients/synthetic/edit')).toBeNull()
    expect(preloadCriticalRouteForPath('/patients/synthetic/profile')).toBeNull()
    expect(preloadCriticalRouteForPath(null)).toBeNull()
  })
})
