import { appointmentRoutes } from '@/features/appointments/routes'
import { patientRoutes } from '@/features/patients/routes'
import { encounterRoutes } from '@/features/encounters/routes'
import { wardRoutes } from '@/features/wards/routes'
import { admissionRoutes } from '@/features/admissions/routes'
import { inventoryRoutes } from '@/features/inventory/routes'
import { billingRoutes } from '@/features/billing/routes'
import { laboratoryRoutes } from '@/features/laboratory/routes'
import { pharmacyRoutes } from '@/features/pharmacy/routes'
import { dashboardRoutes } from '@/features/dashboards/routes'
import { adminRoutes } from '@/features/admin/routes'
import { settingsRoutes } from '@/features/settings/routes'
import { clinicRoutes } from '@/features/clinics/routes'
import { triageRoutes } from '@/features/triage/routes'
import { referralRoutes } from '@/features/referrals/routes'
import { inboxRoutes } from '@/features/inbox/routes'
import { staffRoutes } from '@/features/staff/routes'
import { workflowRoutes } from '@/features/workflows/routes'
import { clinicalNotesRoutes } from '@/features/clinical-notes/routes'
import { chartRoutes } from '@/features/charts/routes'
import { opsRoutes } from '@/features/ops/routes'
import { wardBoardRoutes } from '@/features/ward-board/routes'
import { careAreaRoutes } from '@/features/care-areas/routes'
import { validateRoutes } from './routeTypes'
import { withFeature } from '@/shared/lib/features'

const WARD_TASK_BOARD_ROUTE_FEATURES = [
  'ward_task_board',
  'patient_chronicle',
  'wards',
  'inpatient_admissions',
  'nursing_workflows',
]
const WARD_TASK_BOARD_OPTIONAL_LANES = new Set([
  'discharge_workflows',
  'laboratory',
  'pharmacy',
  'referrals',
])

const patientRouteFeatures = (route) => {
  if (
    route.path === '/patients/create'
    || route.path === '/patients/find-or-register'
    || route.path === '/patients/:id/edit'
  ) {
    return ['patient_chronicle', 'patient_registration']
  }
  return ['patient_chronicle']
}

const clinicalNoteRouteFeatures = (route) => {
  if (route.path?.startsWith('/encounters')) {
    return ['clinical_notes', 'outpatient_encounters']
  }
  return ['clinical_notes']
}

const resolveWardTaskBoardRouteModule = (routeModule) => {
  const routes = routeModule.wardTaskBoardRoutes
    || routeModule.wardBoardRoutes
    || routeModule.routes
    || routeModule.default

  if (!Array.isArray(routes)) {
    return []
  }

  return routes.map((route) => ({
    ...route,
    features: Array.from(new Set([
      ...(Array.isArray(route.features) ? route.features : [])
        .filter((feature) => !WARD_TASK_BOARD_OPTIONAL_LANES.has(feature)),
      ...WARD_TASK_BOARD_ROUTE_FEATURES,
    ])),
  }))
}

const wardTaskBoardRoutes = resolveWardTaskBoardRouteModule({ wardBoardRoutes })

export const featureRoutes = [
  ...withFeature(appointmentRoutes, 'appointments'),
  ...withFeature(patientRoutes, patientRouteFeatures),
  ...withFeature(encounterRoutes, 'outpatient_encounters'),
  ...withFeature(wardRoutes, 'wards'),
  ...wardTaskBoardRoutes,
  ...withFeature(admissionRoutes, 'inpatient_admissions'),
  ...withFeature(inventoryRoutes, 'inventory'),
  ...withFeature(billingRoutes, 'billing'),
  ...withFeature(laboratoryRoutes, 'laboratory'),
  ...withFeature(pharmacyRoutes, 'pharmacy'),
  ...dashboardRoutes,
  ...careAreaRoutes,
  ...adminRoutes,
  ...settingsRoutes,
  ...withFeature(clinicRoutes, 'outpatient_encounters'),
  ...withFeature(triageRoutes, 'emergency_encounters'),
  ...withFeature(referralRoutes, 'referrals'),
  ...inboxRoutes,
  ...staffRoutes,
  ...workflowRoutes,
  ...withFeature(clinicalNotesRoutes, clinicalNoteRouteFeatures),
  ...chartRoutes,
  ...opsRoutes,
]

if (import.meta.env.DEV) {
  validateRoutes(featureRoutes, { source: 'featureRoutes' })
}
