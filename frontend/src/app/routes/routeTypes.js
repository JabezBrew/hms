export const ROUTE_LAYOUTS = Object.freeze({
  APP: 'app',
  BARE: 'bare',
})

const TIER_CONTROLLED_ROUTE_PREFIXES = [
  ['/appointments', 'appointments'],
  ['/practitioner-availability', 'appointments'],
  ['/schedules', 'appointments'],
  ['/wards', 'wards'],
  ['/admissions', 'inpatient_admissions'],
  ['/billing', 'billing'],
  ['/inventory', 'inventory'],
  ['/laboratory', 'laboratory'],
  ['/pharmacy', 'pharmacy'],
  ['/nursing', 'nursing_workflows'],
  ['/clinics', 'outpatient_encounters'],
  ['/clinical-notes', 'clinical_notes'],
  ['/encounters/:id/clinical-notes', 'clinical_notes'],
  ['/triage', 'emergency_encounters'],
  ['/referrals', 'referrals'],
]

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
    const controlled = TIER_CONTROLLED_ROUTE_PREFIXES.find(([prefix]) => (
      route.path === prefix || route.path.startsWith(`${prefix}/`)
    ))
    if (controlled && !route.features?.includes(controlled[1])) {
      throw new Error(
        `[${source}] Route ${route.path} must declare feature ${controlled[1]}`
      )
    }
  })
}
