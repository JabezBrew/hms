import { useEffect } from 'react'

const ROUTE_CHUNK_LOADERS = [
  () => import('@/features/patients/pages/PatientChronicleListPage'),
  () => import('@/features/patients/pages/PatientPage'),
  () => import('@/features/patients/pages/PatientChroniclePage'),
  () => import('@/components/chronicle/ClinicalSummarySidebar'),
  () => import('@/components/chronicle/ChronicleNoteBody'),
  () => import('@/features/patients/chronicle/ChronicleTimelinePanel'),
  () => import('@/features/patients/components/ChronicleWorkspaceHost'),
  () => import('@/features/ward-board/pages/WardBoardPage'),
  () => import('@/features/laboratory/pages/LabOrdersPage'),
  () => import('@/features/inventory/pages/ItemsPage'),
]

function publishWarmupDone(done) {
  if (typeof window !== 'undefined') {
    window.__hmsRouteChunkWarmupDone = done
  }
}

function scheduleIdle(callback) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1200 })
    return () => window.cancelIdleCallback(id)
  }

  const id = window.setTimeout(callback, 800)
  return () => window.clearTimeout(id)
}

async function warmRouteChunks(isCancelled) {
  if (isCancelled()) {
    return
  }

  await Promise.all(ROUTE_CHUNK_LOADERS.map((loadRouteChunk) => loadRouteChunk().catch(() => null)))

  if (!isCancelled()) {
    publishWarmupDone(true)
  }
}

export default function RouteChunkWarmup() {
  useEffect(() => {
    let cancelled = false
    publishWarmupDone(false)
    const cancelIdle = scheduleIdle(() => {
      void warmRouteChunks(() => cancelled)
    })

    return () => {
      cancelled = true
      cancelIdle()
    }
  }, [])

  return null
}
