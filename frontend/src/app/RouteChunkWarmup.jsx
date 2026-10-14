import { useEffect } from 'react'
import { scheduleRouteChunkWarmup } from './routeChunkWarmup'

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

export default function RouteChunkWarmup() {
  useEffect(() => {
    publishWarmupDone(false)
    return scheduleRouteChunkWarmup(ROUTE_CHUNK_LOADERS, () => publishWarmupDone(true))
  }, [])

  return null
}
