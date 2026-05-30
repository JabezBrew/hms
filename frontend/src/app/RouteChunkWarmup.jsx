import { useEffect } from 'react'

const ROUTE_CHUNK_LOADERS = [
  () => import('@/features/patients/pages/PatientChronicleListPage'),
  () => import('@/features/patients/pages/PatientPage'),
  () => import('@/features/patients/pages/PatientChroniclePage'),
  () => import('@/components/chronicle/ChronicleNoteBody'),
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

function waitForNextSlice() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 80)
  })
}

async function warmRouteChunks(isCancelled) {
  for (const loadRouteChunk of ROUTE_CHUNK_LOADERS) {
    if (isCancelled()) {
      return
    }
    await loadRouteChunk().catch(() => {})
    await waitForNextSlice()
  }
  publishWarmupDone(true)
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
