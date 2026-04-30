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
import { clinicRoutes } from '@/features/clinics/routes'
import { triageRoutes } from '@/features/triage/routes'
import { referralRoutes } from '@/features/referrals/routes'
import { inboxRoutes } from '@/features/inbox/routes'
import { staffRoutes } from '@/features/staff/routes'
import { workflowRoutes } from '@/features/workflows/routes'
import { clinicalNotesRoutes } from '@/features/clinical-notes/routes'
import { chartRoutes } from '@/features/charts/routes'
import { validateRoutes } from './routeTypes'
import { withFeature } from '@/shared/lib/features'

export const featureRoutes = [
  ...withFeature(appointmentRoutes, 'appointments'),
  ...patientRoutes,
  ...encounterRoutes,
  ...withFeature(wardRoutes, 'wards'),
  ...withFeature(admissionRoutes, 'inpatient_admissions'),
  ...withFeature(inventoryRoutes, 'inventory'),
  ...withFeature(billingRoutes, 'billing'),
  ...withFeature(laboratoryRoutes, 'laboratory'),
  ...withFeature(pharmacyRoutes, 'pharmacy'),
  ...withFeature(nursingRoutes, 'nursing_workflows'),
  ...dashboardRoutes,
  ...adminRoutes,
  ...settingsRoutes,
  ...withFeature(clinicRoutes, 'outpatient_encounters'),
  ...withFeature(triageRoutes, 'emergency_encounters'),
  ...withFeature(referralRoutes, 'referrals'),
  ...inboxRoutes,
  ...staffRoutes,
  ...workflowRoutes,
  ...withFeature(clinicalNotesRoutes, 'clinical_notes'),
  ...chartRoutes,
]

if (import.meta.env.DEV) {
  validateRoutes(featureRoutes, { source: 'featureRoutes' })
}
