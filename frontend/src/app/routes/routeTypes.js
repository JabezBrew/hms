export const ROUTE_LAYOUTS = Object.freeze({
  APP: 'app',
  BARE: 'bare',
})

export const SIDEBARS = Object.freeze({
  GLOBAL: 'global',
  PATIENTS: 'patients',
  PATIENT_WORKSPACE: 'patient-workspace',
  BILLING: 'billing',
  INVENTORY: 'inventory',
  LABORATORY: 'laboratory',
  PHARMACY: 'pharmacy',
  ADMIN: 'admin',
  SETTINGS: 'settings',
})

const TIER_CONTROLLED_ROUTE_REQUIREMENTS = [
  { prefix: '/appointments', features: ['appointments'] },
  { prefix: '/practitioner-availability', features: ['appointments'] },
  { prefix: '/schedules', features: ['appointments'] },
  { path: '/care-areas/outpatient', features: ['outpatient_encounters'] },
  { path: '/care-areas/inpatient', features: ['ward_task_board', 'patient_chronicle', 'wards', 'inpatient_admissions', 'nursing_workflows'] },
  { path: '/care-areas/emergency', features: ['emergency_encounters'] },
  { prefix: '/patients', features: ['patient_chronicle'] },
  { path: '/patients/create', features: ['patient_registration'] },
  { path: '/patients/:id/edit', features: ['patient_registration'] },
  { prefix: '/encounters', features: ['outpatient_encounters'] },
  { prefix: '/wards', features: ['wards'] },
  { path: '/wards/:wardId/board', features: ['ward_task_board', 'patient_chronicle', 'inpatient_admissions', 'nursing_workflows'] },
  { prefix: '/ward-board', features: ['ward_task_board', 'patient_chronicle', 'wards', 'inpatient_admissions', 'nursing_workflows'] },
  { prefix: '/admissions', features: ['inpatient_admissions'] },
  { path: '/billing/admissions', features: ['billing', 'inpatient_admissions'] },
  { path: '/billing/discharges', features: ['billing', 'discharge_workflows'] },
  { path: '/billing/claims', features: ['billing', 'insurance_claims'] },
  { prefix: '/billing/nhis', features: ['billing', 'insurance_claims'] },
  { prefix: '/billing', features: ['billing'] },
  { prefix: '/inventory', features: ['inventory'] },
  { prefix: '/laboratory', features: ['laboratory'] },
  { prefix: '/pharmacy', features: ['pharmacy'] },
  { path: '/dashboards/inpatient', features: ['inpatient_admissions'] },
  { path: '/workflows/ward-round', features: ['wards'] },
  { path: '/workflows/discharge', features: ['discharge_workflows'] },
  { path: '/patients/:id/ward-round', features: ['wards'] },
  { prefix: '/clinics', features: ['outpatient_encounters'] },
  { prefix: '/clinical-notes', features: ['clinical_notes'] },
  { prefix: '/charts', features: ['clinical_notes'] },
  { path: '/encounters/:id/clinical-notes', features: ['clinical_notes'] },
  { prefix: '/triage', features: ['emergency_encounters'] },
  { prefix: '/referrals', features: ['referrals'] },
  { path: '/admin/audit-logs', features: ['audit'] },
  { path: '/admin/organization/duty-roster', features: ['department_rosters'] },
  { path: '/admin/organization/roster-setup', features: ['department_rosters'] },
  { path: '/admin/organization/roster-builder', features: ['department_rosters'] },
]

function routeMatchesRequirement(routePath, requirement) {
  if (requirement.path) {
    return routePath === requirement.path
  }
  return routePath === requirement.prefix || routePath.startsWith(`${requirement.prefix}/`)
}

export function requiredFeaturesForRoute(routePath) {
  const features = new Set()
  TIER_CONTROLLED_ROUTE_REQUIREMENTS.forEach((requirement) => {
    if (routeMatchesRequirement(routePath, requirement)) {
      requirement.features.forEach((feature) => features.add(feature))
    }
  })
  return [...features]
}

export function validateRoutes(routes, { source = 'routes' } = {}) {
  if (!Array.isArray(routes)) {
    throw new Error(`[${source}] Expected routes array`)
  }

  routes.forEach((route) => {
    if (!route?.path) {
      throw new Error(`[${source}] Route is missing path`)
    }
    if (!route?.component) {
      throw new Error(`[${source}] Route ${route.path} is missing component`)
    }
    if (!route?.layout || !Object.values(ROUTE_LAYOUTS).includes(route.layout)) {
      throw new Error(`[${source}] Route ${route.path} has invalid layout`)
    }
    if (route.roles === undefined) {
      throw new Error(`[${source}] Route ${route.path} must declare roles (use null for all)`)
    }
    if (route.features !== undefined && !Array.isArray(route.features)) {
      throw new Error(`[${source}] Route ${route.path} features must be an array`)
    }
    if (route.capabilities !== undefined && !Array.isArray(route.capabilities)) {
      throw new Error(`[${source}] Route ${route.path} capabilities must be an array`)
    }
    if (route.sidebar !== undefined && !Object.values(SIDEBARS).includes(route.sidebar)) {
      throw new Error(`[${source}] Route ${route.path} has invalid sidebar`)
    }
    const missingFeatures = requiredFeaturesForRoute(route.path)
      .filter((feature) => !route.features?.includes(feature))
    if (missingFeatures.length > 0) {
      const featureLabel = missingFeatures.length === 1 ? 'feature' : 'features'
      throw new Error(
        `[${source}] Route ${route.path} must declare ${featureLabel} ${missingFeatures.join(', ')}`
      )
    }
  })
}
