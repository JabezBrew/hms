import { appointmentRoutes } from '@/features/appointments/routes'
import { patientRoutes } from '@/features/patients/routes'
import { encounterRoutes } from '@/features/encounters/routes'
import { wardRoutes } from '@/features/wards/routes'
import { admissionRoutes } from '@/features/admissions/routes'
import { validateRoutes } from './routeTypes'

export const featureRoutes = [
  ...appointmentRoutes,
  ...patientRoutes,
  ...encounterRoutes,
  ...wardRoutes,
  ...admissionRoutes,
]

if (import.meta.env.DEV) {
  validateRoutes(featureRoutes, { source: 'featureRoutes' })
}
