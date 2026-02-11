import { appointmentRoutes } from '@/features/appointments/routes'
import { patientRoutes } from '@/features/patients/routes'
import { encounterRoutes } from '@/features/encounters/routes'
import { wardRoutes } from '@/features/wards/routes'
import { admissionRoutes } from '@/features/admissions/routes'
import { inventoryRoutes } from '@/features/inventory/routes'
import { billingRoutes } from '@/features/billing/routes'
import { laboratoryRoutes } from '@/features/laboratory/routes'
import { pharmacyRoutes } from '@/features/pharmacy/routes'
import { nursingRoutes } from '@/features/nursing/routes'
import { dashboardRoutes } from '@/features/dashboards/routes'
import { adminRoutes } from '@/features/admin/routes'
import { settingsRoutes } from '@/features/settings/routes'
import { chartRoutes } from '@/features/charts/routes'
import { clinicRoutes } from '@/features/clinics/routes'
import { triageRoutes } from '@/features/triage/routes'
import { referralRoutes } from '@/features/referrals/routes'
import { inboxRoutes } from '@/features/inbox/routes'
import { staffRoutes } from '@/features/staff/routes'
import { workflowRoutes } from '@/features/workflows/routes'
import { clinicalNotesRoutes } from '@/features/clinical-notes/routes'
import type { AppRoute } from '@/types/routes'
import { validateRoutes } from './routeTypes'

export const featureRoutes: AppRoute[] = [
  ...appointmentRoutes,
  ...patientRoutes,
  ...encounterRoutes,
  ...wardRoutes,
  ...admissionRoutes,
  ...inventoryRoutes,
  ...billingRoutes,
  ...laboratoryRoutes,
  ...pharmacyRoutes,
  ...nursingRoutes,
  ...dashboardRoutes,
  ...adminRoutes,
  ...settingsRoutes,
  ...chartRoutes,
  ...clinicRoutes,
  ...triageRoutes,
  ...referralRoutes,
  ...inboxRoutes,
  ...staffRoutes,
  ...workflowRoutes,
  ...clinicalNotesRoutes,
]

if (import.meta.env.DEV) {
  validateRoutes(featureRoutes, { source: 'featureRoutes' })
}
